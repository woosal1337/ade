import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { parse as parseToml } from "smol-toml";
import { AdeError } from "../src/core/errors.ts";
import { apply } from "../src/engine/apply.ts";
import { capture, writeCapture } from "../src/engine/capture.ts";
import { doctor } from "../src/engine/doctor.ts";
import { listApplies, revert } from "../src/engine/history.ts";
import { plan } from "../src/engine/plan.ts";
import { acquireLock } from "../src/engine/state.ts";
import { status } from "../src/engine/status.ts";
import { addMcpServer, removeEntry, setSetting } from "../src/profile/edit.ts";
import { type LoadedProfile, loadProfile, saveProfile } from "../src/profile/load.ts";
import {
  contextFor,
  exists,
  offlineRunner,
  POSIX,
  readJson,
  SECRET_TOKEN,
  seedMachine,
  tempDir,
  writeJson,
  writeText,
} from "./helpers.ts";

const SECRET_ENV = { PRIVATE_AUTHORIZATION: SECRET_TOKEN };

async function capturedProfile(): Promise<{ home: string; loaded: LoadedProfile }> {
  const home = await tempDir("ade-home-");
  await seedMachine(home);
  const ctx = contextFor(home, SECRET_ENV);
  const result = await capture(ctx, { runner: offlineRunner });
  const loaded = await writeCapture(path.join(await tempDir("ade-profile-"), "profile"), result);
  return { home, loaded };
}

function writes(summary: { create: number; update: number; delete: number }): number {
  return summary.create + summary.update + summary.delete;
}

describe("capture", () => {
  test("captures every harness without secret values", async () => {
    const { loaded } = await capturedProfile();
    const { profile } = loaded;
    assert.deepEqual(profile.harnesses, ["claude", "codex", "cursor", "grok", "pi"]);
    assert.deepEqual(profile.instructions, { file: "AGENTS.md" });
    assert.deepEqual(Object.keys(profile.skills ?? {}), ["review"]);
    assert.deepEqual(profile.mcp?.docs, {
      transport: "http",
      url: "https://docs.example.com/mcp",
      harnesses: ["claude", "codex", "cursor", "pi"],
      overrides: { codex: { startup_timeout_sec: 20 }, pi: { description: "Product docs" } },
    });
    assert.deepEqual(profile.mcp?.legacy, {
      transport: "stdio",
      command: "npx",
      args: ["-y", "legacy-mcp"],
      harnesses: ["claude"],
      overrides: { claude: { type: null } },
    });
    assert.equal(
      profile.mcp?.private?.transport === "http" && profile.mcp.private.headers?.Authorization,
      "Bearer ${secret:PRIVATE_AUTHORIZATION}",
    );
    assert.deepEqual(profile.secrets, {
      PRIVATE_AUTHORIZATION: { from: "env", name: "PRIVATE_AUTHORIZATION" },
    });
    const text = await fs.readFile(path.join(loaded.dir, "ade.json"), "utf8");
    assert.equal(text.includes(SECRET_TOKEN), false);
    assert.equal(profile.settings?.claude?.statusLine !== undefined, true);
    assert.deepEqual(profile.settings?.claude?.statusLine, {
      type: "command",
      command: `\${home}${path.sep}.claude${path.sep}statusline.sh`,
    });
    assert.deepEqual(profile.settings?.codex, { model: "gpt-5.5" });
    assert.deepEqual(profile.settings?.grok, { models: { default: "grok-4.7" } });
    assert.deepEqual(profile.settings?.pi, {
      defaultModel: "claude-opus-5-5",
      packages: ["npm:pi-tool"],
    });
  });

  test("a plan right after a capture changes nothing", async () => {
    const { home, loaded } = await capturedProfile();
    const result = await plan(loaded, contextFor(home, SECRET_ENV));
    assert.equal(
      writes(result.summary),
      0,
      JSON.stringify(result.changes.filter((c) => c.action !== "adopt")),
    );
    assert.equal(result.summary.adopt > 10, true);
  });
});

describe("apply", () => {
  test("builds a new home, and a second plan changes nothing", async () => {
    const { loaded } = await capturedProfile();
    const target = await tempDir("ade-target-");
    const ctx = contextFor(target, SECRET_ENV);
    const first = await plan(loaded, ctx);
    assert.equal(first.summary.create > 10, true);
    const result = await apply(loaded, ctx, { expectedFingerprint: first.fingerprint });
    assert.notEqual(result.applyId, undefined);
    const second = await plan(loaded, ctx);
    assert.equal(writes(second.summary), 0);
    assert.equal(second.summary.adopt, 0);

    const codex = JSON.parse(
      JSON.stringify(
        parseToml(await fs.readFile(path.join(target, ".codex", "config.toml"), "utf8")),
      ),
    );
    assert.deepEqual(codex, {
      model: "gpt-5.5",
      mcp_servers: { docs: { url: "https://docs.example.com/mcp", startup_timeout_sec: 20 } },
    });
    const cursor = await readJson(path.join(target, ".cursor", "mcp.json"));
    assert.deepEqual(cursor.mcpServers, {
      docs: { url: "https://docs.example.com/mcp" },
      private: {
        url: "https://private.example.com/mcp",
        headers: { Authorization: `Bearer ${SECRET_TOKEN}` },
      },
    });
    const claudeSettings = await readJson(path.join(target, ".claude", "settings.json"));
    assert.deepEqual(claudeSettings.statusLine, {
      type: "command",
      command: path.join(target, ".claude", "statusline.sh"),
    });
    assert.equal(
      await fs.readFile(path.join(target, ".agents", "skills", "review", "notes.md"), "utf8"),
      "Check the tests.\n",
    );
    if (POSIX) {
      assert.equal(
        await fs.readlink(path.join(target, ".claude", "skills", "review")),
        path.join(target, ".agents", "skills", "review"),
      );
      const stat = await fs.stat(path.join(target, ".cursor", "mcp.json"));
      assert.equal(stat.mode & 0o777, 0o600);
    }
  });

  test("keeps the keys and entries that the profile does not own", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    await writeJson(path.join(home, ".claude.json"), {
      numStartups: 9,
      mcpServers: { mine: { type: "http", url: "https://mine.example.com" } },
    });
    await writeJson(path.join(home, ".claude", "settings.json"), {
      theme: "dark",
      model: "sonnet",
    });
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["claude"],
      mcp: { docs: { transport: "http", url: "https://docs.example.com/mcp" } },
      settings: { claude: { model: "opus" } },
    });
    const loaded = await loadProfile(dir);
    await apply(loaded, ctx);
    assert.deepEqual(await readJson(path.join(home, ".claude.json")), {
      numStartups: 9,
      mcpServers: {
        mine: { type: "http", url: "https://mine.example.com" },
        docs: { type: "http", url: "https://docs.example.com/mcp" },
      },
    });
    assert.deepEqual(await readJson(path.join(home, ".claude", "settings.json")), {
      theme: "dark",
      model: "opus",
    });
  });

  test("removes only the entries that ade applied", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    await writeJson(path.join(home, ".pi", "agent", "mcp.json"), {
      mcpServers: { mine: { url: "https://mine.example.com" } },
    });
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      mcp: {
        docs: { transport: "http", url: "https://docs.example.com/mcp" },
        tools: { transport: "stdio", command: "uvx", args: ["tools-mcp"] },
      },
    });
    await apply(await loadProfile(dir), ctx);
    let loaded = await loadProfile(dir);
    await saveProfile(dir, removeEntry(loaded.profile, "mcp", "docs"));
    loaded = await loadProfile(dir);
    const result = await plan(loaded, ctx);
    assert.deepEqual(
      result.changes.filter((change) => change.action === "delete").map((change) => change.key),
      ["mcp:pi:docs"],
    );
    await apply(loaded, ctx);
    const doc = await readJson(path.join(home, ".pi", "agent", "mcp.json"));
    assert.deepEqual(doc.mcpServers, {
      mine: { url: "https://mine.example.com" },
      tools: { command: "uvx", args: ["tools-mcp"] },
    });
  });

  test("a null setting deletes the key", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    await writeJson(path.join(home, ".pi", "agent", "settings.json"), {
      steeringMode: "all",
      keep: 1,
    });
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      settings: { pi: { steeringMode: null } },
    });
    await apply(await loadProfile(dir), ctx);
    assert.deepEqual(await readJson(path.join(home, ".pi", "agent", "settings.json")), { keep: 1 });
  });

  test("writes through a linked settings file", { skip: !POSIX }, async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const real = path.join(home, "dotfiles", "settings.json");
    await writeJson(real, { theme: "dark" });
    await fs.mkdir(path.join(home, ".claude"), { recursive: true });
    await fs.symlink(real, path.join(home, ".claude", "settings.json"));
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["claude"],
      settings: { claude: { model: "opus" } },
    });
    const loaded = await loadProfile(dir);
    const result = await plan(loaded, ctx);
    assert.equal(result.changes.find((change) => change.action === "create")?.writesThrough, real);
    await apply(loaded, ctx);
    assert.equal(
      (await fs.lstat(path.join(home, ".claude", "settings.json"))).isSymbolicLink(),
      true,
    );
    assert.deepEqual(await readJson(real), { theme: "dark", model: "opus" });
  });

  test("blocks drift until --force, then restores the profile value", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      settings: { pi: { defaultModel: "a" } },
    });
    const loaded = await loadProfile(dir);
    await apply(loaded, ctx);
    await writeJson(path.join(home, ".pi", "agent", "settings.json"), { defaultModel: "changed" });
    const report = await status(loaded, ctx);
    assert.equal(report.inSync, false);
    assert.equal(report.drift, 1);
    await assert.rejects(
      apply(loaded, ctx),
      (error: unknown) => error instanceof AdeError && error.code === "conflict",
    );
    await apply(loaded, ctx, { force: true });
    assert.deepEqual(await readJson(path.join(home, ".pi", "agent", "settings.json")), {
      defaultModel: "a",
    });
    assert.equal((await status(loaded, ctx)).inSync, true);
  });

  test("leaves a removed entry in place when it changed outside ade", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      settings: { pi: { defaultModel: "a" } },
    });
    await apply(await loadProfile(dir), ctx);
    await writeJson(path.join(home, ".pi", "agent", "settings.json"), { defaultModel: "edited" });
    await saveProfile(dir, { version: 1, harnesses: ["pi"] });
    const loaded = await loadProfile(dir);
    const result = await plan(loaded, ctx);
    assert.deepEqual(
      result.changes.map((change) => [change.action, change.drift]),
      [["forget", true]],
    );
    await apply(loaded, ctx);
    assert.deepEqual(await readJson(path.join(home, ".pi", "agent", "settings.json")), {
      defaultModel: "edited",
    });
  });

  test("rejects a stale plan", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      settings: { pi: { defaultModel: "a" } },
    });
    const loaded = await loadProfile(dir);
    const first = await plan(loaded, ctx);
    await writeJson(path.join(home, ".pi", "agent", "settings.json"), { defaultModel: "b" });
    await assert.rejects(
      apply(loaded, ctx, { expectedFingerprint: first.fingerprint }),
      (error: unknown) => error instanceof AdeError && error.code === "target-changed",
    );
  });

  test("rolls back the finished writes when a later write fails", {
    skip: !POSIX || process.getuid?.() === 0,
  }, async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    await writeJson(path.join(home, ".pi", "agent", "settings.json"), { defaultModel: "old" });
    const locked = path.join(home, ".grok");
    await fs.mkdir(locked, { recursive: true });
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["grok", "pi"],
      settings: { pi: { defaultModel: "new" }, grok: { models: { default: "x" } } },
    });
    await fs.chmod(locked, 0o500);
    try {
      await assert.rejects(apply(await loadProfile(dir), ctx));
    } finally {
      await fs.chmod(locked, 0o700);
    }
    assert.deepEqual(await readJson(path.join(home, ".pi", "agent", "settings.json")), {
      defaultModel: "old",
    });
    assert.deepEqual(await listApplies(ctx), []);
  });

  test("holds a lock during an apply", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const release = await acquireLock(ctx.stateDir);
    try {
      const dir = await tempDir("ade-profile-");
      await saveProfile(dir, { version: 1, harnesses: ["pi"], settings: { pi: { a: 1 } } });
      await assert.rejects(
        apply(await loadProfile(dir), ctx),
        (error: unknown) => error instanceof AdeError && error.code === "locked",
      );
    } finally {
      await release();
    }
  });
});

describe("revert", () => {
  test("restores the home, and a revert of the revert applies again", async () => {
    const { loaded } = await capturedProfile();
    const target = await tempDir("ade-target-");
    await writeJson(path.join(target, ".claude.json"), { numStartups: 1 });
    const ctx = contextFor(target, SECRET_ENV);
    const applied = await apply(loaded, ctx);
    await writeJson(path.join(target, ".claude.json"), {
      ...(await readJson(path.join(target, ".claude.json"))),
      numStartups: 2,
    });
    const reverted = await revert(ctx);
    assert.equal(reverted.reverted, applied.applyId);
    assert.deepEqual(await readJson(path.join(target, ".claude.json")), { numStartups: 2 });
    assert.equal(await exists(path.join(target, ".agents")), false);
    assert.equal(await exists(path.join(target, ".codex")), false);
    assert.equal(writes((await plan(loaded, ctx)).summary) > 10, true);
    await revert(ctx, { id: reverted.revertId });
    assert.equal(writes((await plan(loaded, ctx)).summary), 0);
    const history = await listApplies(ctx);
    assert.deepEqual(
      history.map((item) => item.kind),
      ["revert", "revert", "apply"],
    );
  });

  test("refuses to revert an entry that changed after the apply", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      settings: { pi: { defaultModel: "a" } },
    });
    await apply(await loadProfile(dir), ctx);
    await writeJson(path.join(home, ".pi", "agent", "settings.json"), { defaultModel: "edited" });
    await assert.rejects(
      revert(ctx),
      (error: unknown) => error instanceof AdeError && error.code === "revert-blocked",
    );
    await revert(ctx, { force: true });
    assert.equal(await exists(path.join(home, ".pi", "agent", "settings.json")), false);
  });
});

describe("files, instructions, and doctor", () => {
  test("a template file gets its secrets and mode 600", async () => {
    const home = await tempDir();
    const ctx = contextFor(home, { NPM_TOKEN: "npm-secret-value" });
    const dir = await tempDir("ade-profile-");
    await writeText(
      path.join(dir, "files", "npmrc"),
      "//registry.npmjs.org/:_authToken=${secret:NPM}\n",
    );
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      files: [{ root: "home", target: ".npmrc", source: "files/npmrc", template: true }],
      secrets: { NPM: { from: "env", name: "NPM_TOKEN" } },
    });
    const loaded = await loadProfile(dir);
    const preview = await plan(loaded, ctx);
    assert.equal(JSON.stringify(preview).includes("npm-secret-value"), false);
    await apply(loaded, ctx);
    assert.equal(
      await fs.readFile(path.join(home, ".npmrc"), "utf8"),
      "//registry.npmjs.org/:_authToken=npm-secret-value\n",
    );
    if (POSIX) {
      assert.equal((await fs.stat(path.join(home, ".npmrc"))).mode & 0o777, 0o600);
    }
    const state = await fs.readFile(path.join(ctx.stateDir, "state.json"), "utf8");
    assert.equal(state.includes("npm-secret-value"), false);
  });

  test("copy mode writes plain files", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const dir = await tempDir("ade-profile-");
    await writeText(path.join(dir, "AGENTS.md"), "# Rules\n");
    await writeText(
      path.join(dir, "skills", "one", "SKILL.md"),
      "---\nname: one\ndescription: One.\n---\n",
    );
    await saveProfile(dir, {
      version: 1,
      harnesses: ["claude", "pi"],
      install: "copy",
      instructions: { file: "AGENTS.md" },
      skills: { one: { path: "skills/one" } },
    });
    const loaded = await loadProfile(dir);
    await apply(loaded, ctx);
    for (const file of [
      path.join(home, ".claude", "CLAUDE.md"),
      path.join(home, ".pi", "agent", "AGENTS.md"),
      path.join(home, ".claude", "skills", "one", "SKILL.md"),
    ]) {
      assert.equal((await fs.lstat(file)).isFile(), true, file);
    }
    assert.equal(writes((await plan(loaded, ctx)).summary), 0);
  });

  test("doctor reports a missing secret and a skill without frontmatter", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const dir = await tempDir("ade-profile-");
    await writeText(path.join(dir, "skills", "bare", "SKILL.md"), "# Bare\n");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      skills: { bare: { path: "skills/bare" } },
      mcp: {
        api: {
          transport: "http",
          url: "https://api.example.com",
          headers: { Authorization: "${secret:API}" },
        },
      },
      secrets: { API: { from: "env", name: "API_KEY" } },
    });
    const report = await doctor(await loadProfile(dir), ctx);
    assert.equal(report.ok, false);
    assert.equal(
      report.checks.some((check) => check.level === "error" && check.area === "secret"),
      true,
    );
    assert.equal(
      report.checks.some(
        (check) => check.level === "warn" && check.message.includes("frontmatter"),
      ),
      true,
    );
  });

  test("a profile edit refuses an undeclared secret", async () => {
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, { version: 1 });
    const loaded = await loadProfile(dir);
    const next = addMcpServer(loaded.profile, "api", {
      transport: "http",
      url: "https://api.example.com",
      headers: { Authorization: "${secret:API}" },
    });
    await assert.rejects(
      saveProfile(dir, next),
      (error: unknown) => error instanceof AdeError && error.code === "profile-invalid",
    );
    await assert.rejects(
      saveProfile(dir, setSetting(loaded.profile, "codex", ["mcp_servers", "x"], { url: "u" })),
      (error: unknown) => error instanceof AdeError && error.code === "profile-invalid",
    );
  });
});
