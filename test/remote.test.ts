import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { AdeError } from "../src/core/errors.ts";
import { updateSkills } from "../src/engine/update.ts";
import { importBundle } from "../src/profile/bundle.ts";
import { loadProfile, saveProfile } from "../src/profile/load.ts";
import {
  type RemoteOptions,
  type RemoteTransport,
  remoteApply,
  remoteCapture,
  remoteHistory,
  remotePlan,
  remoteRevert,
  remoteStatus,
  shipProfile,
} from "../src/remote/client.ts";
import {
  contextFor,
  exists,
  readJson,
  SECRET_TOKEN,
  seedMachine,
  tempDir,
  testGitEnv,
  writeText,
} from "./helpers.ts";

const localTransport: RemoteTransport = (_target, script) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(script);
  });

let agentPath = "";

before(async () => {
  agentPath = path.join(await tempDir("ade-agent-"), "remote-agent.mjs");
  execFileSync(process.execPath, [path.join("tools", "build-agent.mjs"), agentPath], {
    stdio: "ignore",
  });
});

function remoteOptions(home: string): RemoteOptions {
  return { target: { host: "test-host" }, home, transport: localTransport, agentPath };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: testGitEnv(),
  });
}

async function remoteProfile(): Promise<string> {
  const repo = await tempDir("ade-repo-");
  git(repo, "init", "--quiet", "-b", "main");
  await writeText(
    path.join(repo, "deploy", "SKILL.md"),
    "---\nname: deploy\ndescription: Deploy.\n---\n",
  );
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "Add the skill");
  const dir = await tempDir("ade-profile-");
  await writeText(path.join(dir, "AGENTS.md"), "# Rules\n");
  await writeText(
    path.join(dir, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review.\n---\n",
  );
  await writeText(path.join(dir, "files", "notes.txt"), "remote notes\n");
  await saveProfile(dir, {
    version: 1,
    harnesses: ["claude", "pi"],
    instructions: { file: "AGENTS.md" },
    mcp: {
      private: {
        transport: "http",
        url: "https://private.example.com/mcp",
        headers: { Authorization: "Bearer ${secret:TOKEN}" },
      },
    },
    skills: {
      review: { path: "skills/review" },
      deploy: { git: pathToFileURL(repo).href, subdir: "deploy" },
    },
    settings: { pi: { defaultModel: "claude-opus-5-5" } },
    files: [{ root: "pi", target: "notes.txt", source: "files/notes.txt" }],
    secrets: { TOKEN: { from: "env", name: "ADE_TEST_LOCAL_ONLY_TOKEN" } },
  });
  return dir;
}

describe("remote", () => {
  test("ships Git and link skills as files, and sends secrets only on request", async () => {
    const dir = await remoteProfile();
    const local = contextFor(await tempDir(), { ADE_TEST_LOCAL_ONLY_TOKEN: "local-token" });
    await updateSkills(await loadProfile(dir), local);
    const loaded = await loadProfile(dir);
    const plain = await shipProfile(loaded, local);
    assert.equal(plain.secrets, undefined);
    const shippedProfile = JSON.parse(
      plain.bundle.files.find((file) => file.path === "ade.json")?.content ?? "{}",
    ) as { skills: Record<string, unknown> };
    const deploy = loaded.profile.skills?.deploy;
    assert.ok(deploy !== undefined && "git" in deploy);
    assert.deepEqual(shippedProfile.skills.deploy, {
      path: "vendor/skills/deploy",
      origin: { git: deploy.git, subdir: "deploy" },
    });
    assert.equal(
      plain.bundle.files.some((file) => file.path === "vendor/skills/deploy/SKILL.md"),
      true,
    );
    assert.equal(
      plain.bundle.files.some((file) => file.path === "ade.lock.json"),
      false,
    );
    const withSecrets = await shipProfile(loaded, local, { sendSecrets: true });
    assert.deepEqual(withSecrets.secrets, { TOKEN: "local-token" });
  });

  test("plans, applies, reports, and reverts on the remote home", async () => {
    const dir = await remoteProfile();
    const local = contextFor(await tempDir(), { ADE_TEST_LOCAL_ONLY_TOKEN: "local-token" });
    await updateSkills(await loadProfile(dir), local);
    const loaded = await loadProfile(dir);
    const home = await tempDir("ade-remote-home-");
    const options = remoteOptions(home);

    await assert.rejects(
      remotePlan(loaded, local, options),
      (error: unknown) =>
        error instanceof AdeError &&
        error.code === "secret-unresolved" &&
        error.message.startsWith("test-host: "),
    );

    const preview = await remotePlan(loaded, local, { ...options, sendSecrets: true });
    assert.equal(preview.remote.home, home);
    assert.equal(preview.result.summary.create > 5, true);
    assert.equal(JSON.stringify(preview.result).includes("local-token"), false);

    const applied = await remoteApply(loaded, local, {
      ...options,
      sendSecrets: true,
      expectedFingerprint: preview.result.fingerprint,
    });
    assert.notEqual(applied.result.applyId, undefined);
    assert.deepEqual(await readJson(path.join(home, ".pi", "agent", "mcp.json")), {
      mcpServers: {
        private: {
          url: "https://private.example.com/mcp",
          headers: { Authorization: "Bearer local-token" },
        },
      },
    });
    assert.equal(
      await fs.readFile(path.join(home, ".agents", "skills", "deploy", "SKILL.md"), "utf8"),
      "---\nname: deploy\ndescription: Deploy.\n---\n",
    );
    const notes = path.join(home, ".pi", "agent", "notes.txt");
    assert.equal((await fs.lstat(notes)).isFile(), true);
    assert.equal(await fs.readFile(notes, "utf8"), "remote notes\n");

    const again = await remotePlan(loaded, local, { ...options, sendSecrets: true });
    const writes =
      again.result.summary.create + again.result.summary.update + again.result.summary.delete;
    assert.equal(writes, 0);
    const report = await remoteStatus(loaded, local, { ...options, sendSecrets: true });
    assert.equal(report.result.inSync, true);

    const history = await remoteHistory(options);
    assert.equal(history.result.length, 1);
    assert.equal(history.result[0]?.profile, `${loaded.dir} (sent by ade remote)`);
    await remoteRevert(options);
    assert.equal(await exists(path.join(home, ".pi")), false);
    assert.equal(await exists(path.join(home, ".agents")), false);
  });

  test("captures the remote home into a local profile", async () => {
    const home = await tempDir("ade-remote-home-");
    await seedMachine(home);
    const response = await remoteCapture({ ...remoteOptions(home), name: "remote-box" });
    assert.equal(JSON.stringify(response.result.bundle).includes(SECRET_TOKEN), false);
    const target = path.join(await tempDir("ade-import-"), "profile");
    const imported = await importBundle(response.result.bundle, target);
    assert.equal(imported.profile.name, "remote-box");
    assert.deepEqual(imported.profile.settings?.pi, {
      defaultModel: "claude-opus-5-5",
      packages: ["npm:pi-tool"],
    });
    assert.deepEqual(
      response.result.secrets.map((secret) => secret.name),
      ["PRIVATE_AUTHORIZATION"],
    );
    assert.equal(await exists(path.join(target, "skills", "review", "SKILL.md")), true);
  });

  test("reports a missing Node.js and a broken route", async () => {
    const options = (stderr: string, code: number): RemoteOptions => ({
      target: { host: "far" },
      agentPath,
      transport: async () => ({ code, stdout: "", stderr }),
    });
    await assert.rejects(
      remoteHistory(options("bash: line 1: node: command not found\n", 127)),
      (error: unknown) =>
        error instanceof AdeError &&
        error.code === "remote-failed" &&
        /no Node\.js/.test(error.message),
    );
    await assert.rejects(
      remoteHistory(options("ssh: connect to host far port 22: Operation timed out\n", 255)),
      (error: unknown) =>
        error instanceof AdeError &&
        error.code === "remote-failed" &&
        /exit code 255/.test(error.message) &&
        error.details.some((line) => line.includes("timed out")),
    );
  });
});
