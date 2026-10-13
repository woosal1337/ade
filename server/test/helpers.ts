import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Bundle } from "../../src/profile/bundle.ts";
import { exportBundle } from "../../src/profile/bundle.ts";
import { loadProfile, saveProfile } from "../../src/profile/load.ts";
import type { Profile } from "../../src/profile/schema.ts";
import { tempDir, writeText } from "../../test/helpers.ts";
import { createApp } from "../src/app.ts";
import type { AuthProvider, Identity } from "../src/auth.ts";
import type { Db } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";

type Queryable = PGlite | Transaction;

function wrap(runner: Queryable, root: PGlite, inTransaction: boolean): Db {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await runner.query<T>(text, [...params]);
      return result.rows;
    },
    async transaction<R>(work: (tx: Db) => Promise<R>): Promise<R> {
      if (inTransaction) {
        return work(wrap(runner, root, true));
      }
      return root.transaction((tx) => work(wrap(tx, root, true)));
    },
    async close(): Promise<void> {
      await root.close();
    },
  };
}

export async function memoryDb(): Promise<Db> {
  const pg = await PGlite.create();
  const db = wrap(pg, pg, false);
  await migrate(db);
  return db;
}

export class FakeAuth implements AuthProvider {
  readonly configured: boolean;
  readonly tokens = new Map<string, string>();
  readonly identities = new Map<string, Identity>();
  readonly codes = new Map<string, string>();
  readonly sessions = new Map<string, string>();
  readonly refreshes = new Map<string, string>();
  readonly loggedOut: string[] = [];
  constructor(configured = true) {
    this.configured = configured;
  }
  addUser(id: string, login: string, name = login): Identity {
    const identity = {
      id,
      displayName: name,
      avatarUrl: null,
      githubLogin: login,
      handleHints: [login],
    };
    this.identities.set(id, identity);
    this.tokens.set(`token-${login}`, id);
    this.codes.set(`code-${login}`, id);
    return identity;
  }
  clientConfig() {
    return this.configured
      ? {
          clientId: "client_test",
          deviceAuthorizationUrl: "http://workos.test/user_management/authorize/device",
          tokenUrl: "http://workos.test/user_management/authenticate",
        }
      : undefined;
  }
  loginUrl(state: string, redirectUri: string): string {
    return `https://auth.test/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
  async completeLogin(code: string) {
    const id = this.codes.get(code);
    if (id === undefined || !this.identities.has(id)) {
      throw new Error("bad code");
    }
    const sealed = `sealed-${id}-${this.sessions.size}`;
    this.sessions.set(sealed, id);
    return { userId: id, sealed };
  }
  async readSession(sealed: string) {
    const refreshed = this.refreshes.get(sealed);
    const id = this.sessions.get(sealed);
    if (id === undefined || !this.identities.has(id)) {
      return undefined;
    }
    return refreshed === undefined ? { userId: id } : { userId: id, sealed: refreshed };
  }
  async logout(sealed: string) {
    this.loggedOut.push(sealed);
  }
  async verifyBearer(token: string) {
    return this.tokens.get(token);
  }
  async identity(userId: string) {
    const identity = this.identities.get(userId);
    if (identity === undefined) {
      throw new Error("unknown user");
    }
    return identity;
  }
}

export const SITE = "https://ade.test";
export const API = "https://ade.test/api";

export async function testApp(options: { configured?: boolean } = {}) {
  const db = await memoryDb();
  const auth = new FakeAuth(options.configured ?? true);
  const app = createApp({ db, auth, siteUrl: SITE, publicApiUrl: API });
  return { app, db, auth };
}

export function bearer(login: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer token-${login}` } };
}

export function jsonBody(method: string, body: unknown, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    method,
    headers: { ...(init.headers ?? {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function sampleBundle(
  change: (profile: Profile) => void = () => undefined,
): Promise<Bundle> {
  const dir = await tempDir("ade-server-profile-");
  await writeText(path.join(dir, "AGENTS.md"), "# Rules\n\nUse short sentences.\n");
  await writeText(
    path.join(dir, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review a change before a merge.\n---\n\n# Review\n",
  );
  const profile: Profile = {
    version: 1,
    name: "team",
    harnesses: ["pi"],
    instructions: { file: "AGENTS.md" },
    skills: { review: { path: "skills/review" } },
    mcp: {
      docs: {
        transport: "http",
        url: "https://docs.example.com/mcp",
        headers: { Authorization: "Bearer ${secret:DOCS_TOKEN}" },
      },
      local: { transport: "stdio", command: "npx", args: ["-y", "local-mcp"] },
    },
    settings: { pi: { defaultModel: "claude-opus-5-5", theme: "dark" } },
    secrets: { DOCS_TOKEN: { from: "command", argv: ["op", "read", "op://vault/docs/token"] } },
  };
  change(profile);
  await saveProfile(dir, profile);
  return exportBundle(await loadProfile(dir), new Date(0));
}
