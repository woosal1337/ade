import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { EXIT, runCli } from "../src/cli/main.ts";
import { createContext } from "../src/core/context.ts";
import { exportBundle } from "../src/profile/bundle.ts";
import { loadProfile, saveProfile } from "../src/profile/load.ts";
import { writeMarkdown } from "../src/profile/markdown.ts";
import { parseProfileSpec } from "../src/profile/spec.ts";
import { exists, fakeIO, POSIX, tempDir, writeText } from "./helpers.ts";

interface FakeApi {
  url: string;
  accessCount: number;
  rejected: Set<string>;
  uploads: unknown[];
  markdown: string;
  expiredFirst: boolean;
  close(): Promise<void>;
}

function jwt(exp: number): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub: "user_1", exp })}.sig`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function reply(
  response: ServerResponse,
  status: number,
  value: unknown,
  type = "application/json",
) {
  response.statusCode = status;
  response.setHeader("content-type", type);
  response.end(typeof value === "string" ? value : JSON.stringify(value));
}

async function startApi(): Promise<FakeApi> {
  const tokens = new Set<string>();
  let polls = 0;
  const api: FakeApi = {
    url: "",
    accessCount: 0,
    rejected: new Set(),
    uploads: [],
    markdown: "",
    expiredFirst: false,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  const issue = () => {
    api.accessCount += 1;
    const expired = api.expiredFirst && api.accessCount === 1;
    const access = `${jwt(Math.floor(Date.now() / 1000) + (expired ? -30 : 600))}${api.accessCount}`;
    tokens.add(access);
    return { access_token: access, refresh_token: `refresh-${api.accessCount}` };
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fake");
    const auth = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const signedIn = tokens.has(auth) && !api.rejected.has(auth);
    if (url.pathname === "/v1/auth/config") {
      return reply(response, 200, {
        clientId: "client_test",
        deviceAuthorizationUrl: `${api.url}/device/authorize`,
        tokenUrl: `${api.url}/device/token`,
      });
    }
    if (url.pathname === "/device/authorize") {
      return reply(response, 200, {
        device_code: "device-1",
        user_code: "ABCD-EFGH",
        verification_uri: `${api.url}/device`,
        verification_uri_complete: `${api.url}/device?user_code=ABCD-EFGH`,
        expires_in: 60,
        interval: 0,
      });
    }
    if (url.pathname === "/device/token") {
      const form = new URLSearchParams(await readBody(request));
      if (form.get("client_id") !== "client_test") {
        return reply(response, 400, { error: "invalid_client" });
      }
      if (form.get("grant_type") === "refresh_token") {
        return form.get("refresh_token") === `refresh-${api.accessCount}`
          ? reply(response, 200, issue())
          : reply(response, 400, { error: "invalid_grant" });
      }
      polls += 1;
      return polls < 2
        ? reply(response, 400, { error: "authorization_pending" })
        : reply(response, 200, issue());
    }
    if (url.pathname === "/v1/me" && request.method === "GET") {
      return signedIn
        ? reply(response, 200, {
            account: { handle: "ege", displayName: "Ege", page: "https://ade.test/ege" },
          })
        : reply(response, 401, {
            error: { code: "unauthorized", message: "The access token is not valid." },
          });
    }
    if (url.pathname === "/v1/me/snapshots" && request.method === "POST") {
      if (!signedIn) {
        return reply(response, 401, { error: { code: "unauthorized", message: "No." } });
      }
      api.uploads.push(JSON.parse(await readBody(request)));
      return reply(response, 200, {
        digest: "d1",
        unchanged: false,
        items: 3,
        public: 0,
        changed: 0,
        hidden: 3,
        page: "https://ade.test/ege",
        dashboard: "https://ade.test/dashboard",
      });
    }
    if (url.pathname === "/v1/users/ege/ADE.md") {
      return reply(response, 200, api.markdown, "text/markdown");
    }
    return reply(response, 404, {
      error: { code: "not-found", message: "No ade page has this name." },
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return api;
}

let api: FakeApi;
const saved = { api: process.env.ADE_API_URL, site: process.env.ADE_SITE_URL };

before(async () => {
  api = await startApi();
  process.env.ADE_API_URL = api.url;
  process.env.ADE_SITE_URL = "https://ade.test";
  const dir = await tempDir("ade-shared-");
  await writeText(path.join(dir, "AGENTS.md"), "# Shared rules\n");
  const profile = {
    version: 1 as const,
    harnesses: ["pi" as const],
    instructions: { file: "AGENTS.md" },
    mcp: { docs: { transport: "http" as const, url: "https://docs.example.com/mcp" } },
  };
  await saveProfile(dir, profile);
  const bundle = await exportBundle(await loadProfile(dir), new Date(0));
  api.markdown = writeMarkdown(bundle, profile, { source: "@ege", createdAt: new Date(0) });
});

after(async () => {
  await api.close();
  for (const [key, value] of [
    ["ADE_API_URL", saved.api],
    ["ADE_SITE_URL", saved.site],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function accountFile(home: string): string {
  return path.join(createContext({ home }).stateDir, "account.json");
}

async function cli(args: string[], home: string) {
  const io = fakeIO(home);
  const code = await runCli([...args, "--home", home], io);
  return { code, out: io.output(), err: io.errors() };
}

describe("ade accounts", () => {
  test("the source parser reads @name and ade page links", () => {
    const context = {
      cwd: "/work",
      home: "/home/me",
      exists: () => false,
      siteUrl: "https://ade.test",
    };
    assert.deepEqual(parseProfileSpec("@Ege", context), {
      kind: "web",
      handle: "ege",
      display: "@ege",
      canonical: "https://ade.test/ege",
    });
    assert.equal(parseProfileSpec("https://ade.test/ege", context).kind, "web");
    assert.equal(parseProfileSpec("ade.test/ege/", context).kind, "web");
    assert.equal(parseProfileSpec("https://other.test/ege", context).kind, "git");
    assert.throws(() => parseProfileSpec("@dashboard", context), /not valid/);
    assert.throws(
      () => parseProfileSpec("@ege", { ...context, exists: () => true }),
      /names a local path and an ade page/,
    );
  });

  test("login stores private tokens, and whoami and logout use them", async () => {
    const home = await tempDir("ade-home-");
    const logged = await cli(["login"], home);
    assert.equal(logged.code, EXIT.ok, logged.err);
    assert.match(logged.out, /confirm the code ABCD-EFGH/);
    assert.match(logged.out, /Logged in as @ege\./);
    const file = accountFile(home);
    assert.equal(await exists(file), true);
    if (POSIX) {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    }
    const who = await cli(["whoami"], home);
    assert.match(who.out, /@ege \(Ege\)/);
    const out = await cli(["logout"], home);
    assert.match(out.out, /Logged out\./);
    assert.equal(await exists(file), false);
    const after = await cli(["whoami"], home);
    assert.equal(after.code, EXIT.failure);
    assert.match(after.err, /not logged in/);
  });

  test("push uploads the shared bundle and refreshes an old token", async () => {
    const home = await tempDir("ade-home-");
    api.expiredFirst = true;
    api.accessCount = 0;
    await cli(["login"], home);
    api.expiredFirst = false;
    const dir = path.join(home, "profile");
    await writeText(path.join(dir, "AGENTS.md"), "# Rules\n");
    await saveProfile(dir, {
      version: 1,
      instructions: { file: "AGENTS.md" },
      mcp: {
        docs: {
          transport: "http",
          url: "https://docs.example.com/mcp",
          headers: { Authorization: "Bearer ${secret:DOCS}" },
        },
      },
      secrets: { DOCS: { from: "env", name: "DOCS" } },
    });
    const before = api.uploads.length;
    const pushed = await cli(["push", "--profile", dir], home);
    assert.equal(pushed.code, EXIT.ok, pushed.err);
    assert.match(pushed.out, /Uploaded the profile: 3 items\./);
    assert.match(pushed.out, /https:\/\/ade\.test\/dashboard/);
    assert.equal(api.uploads.length, before + 1);
    const upload = api.uploads.at(-1) as {
      bundle: { files: { path: string }[] };
      client: { version: string };
    };
    assert.deepEqual(upload.bundle.files.map((file) => file.path).sort(), [
      "AGENTS.md",
      "ade.json",
    ]);
    assert.equal(upload.client.version, "0.1.0");
    const stored = JSON.parse(await fs.readFile(accountFile(home), "utf8"));
    assert.equal(stored.refreshToken, `refresh-${api.accessCount}`);
    api.rejected.add(stored.accessToken);
    const again = await cli(["push", "--profile", dir], home);
    assert.equal(again.code, EXIT.ok, again.err);
    await writeText(path.join(dir, "AGENTS.md"), `token ghp_${"a".repeat(36)}\n`);
    const count = api.uploads.length;
    const refused = await cli(["push", "--profile", dir], home);
    assert.equal(refused.code, EXIT.failure);
    assert.match(refused.err, /look like secrets/);
    assert.equal(api.uploads.length, count);
  });

  test("ade plan and apply read @name with the trust gate", async () => {
    const home = await tempDir("ade-home-");
    await fs.mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    const planned = await cli(["plan", "@ege"], home);
    assert.equal(planned.code, EXIT.ok, planned.err);
    assert.match(planned.out, /Source\s+@ege @ [0-9a-f]{12} \(not trusted\)/);
    const refused = await cli(["apply", "@ege", "--yes"], home);
    assert.equal(refused.code, EXIT.failure);
    assert.match(refused.err, /not trusted/);
    const applied = await cli(["apply", "https://ade.test/ege", "--yes", "--trust"], home);
    assert.equal(applied.code, EXIT.ok, applied.err);
    assert.equal(await exists(path.join(home, ".pi", "agent", "AGENTS.md")), true);
    const offline = await cli(["plan", "@ege", "--offline"], home);
    assert.equal(offline.code, EXIT.ok, offline.err);
    assert.match(offline.out, /\(trusted\)/);
    const missing = await cli(["plan", "@nobody"], home);
    assert.equal(missing.code, EXIT.failure);
    assert.match(missing.err, /@nobody has no ade page/);
  });
});
