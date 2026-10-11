import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { EXIT, runCli } from "../src/cli/main.ts";
import { parseDocText, stripJsonComments } from "../src/core/doc.ts";
import { AdeError } from "../src/core/errors.ts";
import { apply } from "../src/engine/apply.ts";
import { capture, writeCapture } from "../src/engine/capture.ts";
import { revert } from "../src/engine/history.ts";
import { inventory } from "../src/engine/inventory.ts";
import { plan } from "../src/engine/plan.ts";
import { zedExtensionsDir } from "../src/harness/paths.ts";
import { getAdapter } from "../src/harness/registry.ts";
import { loadProfile, saveProfile } from "../src/profile/load.ts";
import { riskSummary } from "../src/profile/risk.ts";
import type { Profile } from "../src/profile/schema.ts";
import {
  contextFor,
  exists,
  fakeClaude,
  fakeIO,
  offlineRunner,
  POSIX,
  readJson,
  tempDir,
  testGitEnv,
  writeJson,
  writeText,
} from "./helpers.ts";

function writes(summary: { create: number; update: number; delete: number }): number {
  return summary.create + summary.update + summary.delete;
}

async function profileDir(profile: Profile, files: Record<string, string> = {}): Promise<string> {
  const dir = await tempDir("ade-profile-");
  for (const [relative, content] of Object.entries(files)) {
    await writeText(path.join(dir, relative), content);
  }
  await saveProfile(dir, profile);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: testGitEnv() }).trim();
}

describe("formats", () => {
  test("JSON with comments parses, and the comments are counted", () => {
    const text =
      '{\n  // the theme\n  "theme": "One", /* inline */ "url": "https://a//b",\n  "s": "a \\" // no",\n  "list": [1, 2,],\n}\n';
    assert.deepEqual(parseDocText(text, "json", "settings.json"), {
      theme: "One",
      url: "https://a//b",
      s: 'a " // no',
      list: [1, 2],
    });
    assert.equal(stripJsonComments(text).comments, 2);
  });

  test("each harness gets its own MCP format", () => {
    const http = { transport: "http" as const, url: "https://docs.example.com/mcp" };
    const stdio = { transport: "stdio" as const, command: "uvx", args: ["tool"], env: { A: "1" } };
    assert.deepEqual(getAdapter("gemini").toNativeMcp(http).value, { httpUrl: http.url });
    assert.deepEqual(getAdapter("antigravity").toNativeMcp({ ...http, enabled: false }).value, {
      serverUrl: http.url,
      disabled: true,
    });
    assert.deepEqual(getAdapter("opencode").toNativeMcp(stdio).value, {
      type: "local",
      command: ["uvx", "tool"],
      environment: { A: "1" },
    });
    assert.deepEqual(getAdapter("opencode").toNativeMcp(http).value, {
      type: "remote",
      url: http.url,
    });
    assert.deepEqual(getAdapter("zed").toNativeMcp(http).value, { url: http.url });
    assert.equal(getAdapter("claude-desktop").toNativeMcp(http).value, undefined);
    for (const id of ["gemini", "antigravity", "opencode", "zed", "claude-desktop"] as const) {
      const adapter = getAdapter(id);
      const native = adapter.toNativeMcp(stdio).value;
      assert.deepEqual(adapter.fromNativeMcp(native), { ok: true, server: stdio }, id);
    }
    const back = getAdapter("antigravity").fromNativeMcp({ serverUrl: http.url, disabled: true });
    assert.deepEqual(back, { ok: true, server: { ...http, enabled: false } });
  });

  test("apply writes the new harness files, and a second plan changes nothing", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const dir = await profileDir(
      {
        version: 1,
        harnesses: ["gemini", "opencode", "zed", "claude-desktop", "antigravity"],
        instructions: { file: "AGENTS.md" },
        mcp: {
          docs: { transport: "http", url: "https://docs.example.com/mcp" },
          tools: { transport: "stdio", command: "uvx", args: ["tool"] },
        },
      },
      { "AGENTS.md": "# Rules\n" },
    );
    const loaded = await loadProfile(dir);
    const preview = await plan(loaded, ctx);
    assert.equal(
      preview.warnings.some((warning) => warning.includes("Claude Desktop accepts only stdio")),
      true,
    );
    assert.equal(preview.changes.filter((change) => change.path.endsWith("GEMINI.md")).length, 1);
    await apply(loaded, ctx);
    const gemini = await readJson(path.join(home, ".gemini", "settings.json"));
    assert.deepEqual((gemini.mcpServers as Record<string, unknown>).docs, {
      httpUrl: "https://docs.example.com/mcp",
    });
    const opencode = await readJson(getAdapter("opencode").mcpLocation(ctx).path);
    assert.deepEqual((opencode.mcp as Record<string, unknown>).docs, {
      type: "remote",
      url: "https://docs.example.com/mcp",
    });
    const zed = await readJson(getAdapter("zed").mcpLocation(ctx).path);
    assert.deepEqual(Object.keys(zed.context_servers as object), ["docs", "tools"]);
    const desktop = await readJson(getAdapter("claude-desktop").mcpLocation(ctx).path);
    assert.deepEqual(Object.keys(desktop.mcpServers as object), ["tools"]);
    const agy = await readJson(path.join(home, ".gemini", "config", "mcp_config.json"));
    assert.deepEqual((agy.mcpServers as Record<string, unknown>).docs, {
      serverUrl: "https://docs.example.com/mcp",
    });
    assert.equal(writes((await plan(loaded, ctx)).summary), 0);
  });
});

async function seedAssets(home: string): Promise<void> {
  await writeJson(path.join(home, ".claude", "settings.json"), {
    statusLine: { type: "command", command: path.join(home, ".claude", "statusline.sh") },
    hooks: {
      Stop: [
        { hooks: [{ type: "command", command: path.join(home, ".claude", "hooks", "check.sh") }] },
      ],
    },
  });
  await writeText(path.join(home, ".claude", "statusline.sh"), "#!/bin/sh\necho ok\n");
  await writeText(path.join(home, ".claude", "hooks", "check.sh"), "#!/bin/sh\nexit 0\n");
  await fs.chmod(path.join(home, ".claude", "hooks", "check.sh"), 0o755);
  await writeText(path.join(home, "dotfiles", "terse.md"), "Be terse.\n");
  await fs.mkdir(path.join(home, ".claude", "output-styles"), { recursive: true });
  await fs.symlink(
    path.join(home, "dotfiles", "terse.md"),
    path.join(home, ".claude", "output-styles", "terse.md"),
  );
  await writeText(path.join(home, ".claude", "notes.txt"), "My notes.\n");
  await writeText(path.join(home, ".claude", "state-dir", "0123456789abcdef.count"), "3\n");
  await writeText(path.join(home, ".claude", "sessions", "one.jsonl"), "{}\n");
  await writeText(path.join(home, ".claude", ".credentials.json"), '{"token":"x"}\n');
  await writeJson(path.join(home, ".claude.json"), {
    projects: {
      [path.join(home, "work", "app")]: {
        mcpServers: { local: { type: "stdio", command: "node", args: ["server.js"] } },
      },
    },
  });
  await writeJson(path.join(home, ".pi", "agent", "settings.json"), { defaultModel: "x" });
  await writeJson(path.join(home, ".pi", "agent", "models-store.json"), { cursor: { models: [] } });
  await writeText(path.join(home, ".pi", "agent", "extensions", "tool.ts"), "export {};\n");
  await writeText(path.join(home, ".pi", "agent", "pkg-config", "SYSTEM.md"), "System.\n");
}

describe("assets", () => {
  test("capture takes asset folders, links, seeds, referenced files, and extras", {
    skip: !POSIX,
  }, async () => {
    const home = await tempDir("ade-home-");
    await seedAssets(home);
    const ctx = contextFor(home);
    const result = await capture(ctx, { runner: offlineRunner });
    const files = Object.fromEntries(
      (result.profile.files ?? []).map((entry) => [`${entry.root}:${entry.target}`, entry]),
    );
    assert.deepEqual(Object.keys(files).sort(), [
      "claude:hooks",
      "claude:notes.txt",
      "claude:output-styles/terse.md",
      "claude:statusline.sh",
      "pi:extensions",
      "pi:models-store.json",
      "pi:pkg-config",
    ]);
    assert.equal(files["claude:output-styles/terse.md"]?.symlink, "${home}/dotfiles/terse.md");
    assert.equal(files["pi:models-store.json"]?.once, true);
    const projects = result.profile.settings?.["home:.claude.json"]?.projects as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(projects), ["${home}/work/app"]);

    const report = await inventory(ctx);
    const status = Object.fromEntries(report.rows.map((row) => [row.display, row.status]));
    assert.equal(status["~/.claude/.credentials.json"], "private");
    assert.equal(status["~/.claude/sessions"], "runtime");
    assert.equal(status["~/.claude/state-dir"], "runtime");
    assert.equal(status["~/.claude/notes.txt"], "extra");
    assert.equal(status["~/.claude/hooks"], "synced");
    assert.equal(report.summary.unknown, 0);

    const dir = path.join(await tempDir("ade-profile-"), "profile");
    const loaded = await writeCapture(dir, result);
    assert.equal(writes((await plan(loaded, ctx, { runner: offlineRunner })).summary), 0);

    const target = await tempDir("ade-target-");
    const targetCtx = contextFor(target);
    await apply(loaded, targetCtx, { runner: offlineRunner });
    const style = path.join(target, ".claude", "output-styles", "terse.md");
    assert.equal((await fs.lstat(style)).isFile(), true);
    assert.equal(await fs.readFile(style, "utf8"), "Be terse.\n");
    assert.equal(
      await fs.readFile(path.join(target, ".claude", "hooks", "check.sh"), "utf8"),
      "#!/bin/sh\nexit 0\n",
    );
    assert.equal(
      ((await fs.stat(path.join(target, ".claude", "hooks", "check.sh"))).mode & 0o111) !== 0,
      true,
    );
    const claudeJson = await readJson(path.join(target, ".claude.json"));
    assert.deepEqual(Object.keys(claudeJson.projects as object), [
      path.join(target, "work", "app"),
    ]);
    await writeJson(path.join(target, ".pi", "agent", "models-store.json"), { changed: true });
    assert.equal(writes((await plan(loaded, targetCtx, { runner: offlineRunner })).summary), 0);
    assert.equal(await exists(path.join(target, ".claude", "state-dir")), false);
    assert.equal(await exists(path.join(target, ".claude", ".credentials.json")), false);
  });
});

describe("plugins", () => {
  const profile: Profile = {
    version: 1,
    harnesses: ["claude"],
    settings: { claude: { model: "opus" } },
    plugins: { claude: { marketplaces: { acme: "acme/plugins" }, install: ["tool@acme"] } },
  };

  test("apply runs the plugin commands first, and revert undoes them", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const fake = fakeClaude({ "acme/plugins": "acme" });
    const loaded = await loadProfile(await profileDir(profile));
    const preview = await plan(loaded, ctx, { runner: fake.runner });
    assert.equal(preview.changes.filter((change) => change.kind === "plugin").length, 2);
    await apply(loaded, ctx, { runner: fake.runner });
    assert.deepEqual(fake.calls, [
      "plugin marketplace add acme/plugins",
      "plugin install tool@acme --scope user",
    ]);
    assert.deepEqual(fake.settingsSeen, [false, false]);
    assert.equal(writes((await plan(loaded, ctx, { runner: fake.runner })).summary), 0);
    await revert(ctx, { runner: fake.runner });
    assert.deepEqual(fake.calls.slice(2), [
      "plugin uninstall tool@acme --scope user",
      "plugin marketplace remove acme",
    ]);
  });

  test("a plugin removed from the profile is uninstalled", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const fake = fakeClaude({ "acme/plugins": "acme" });
    const dir = await profileDir(profile);
    await apply(await loadProfile(dir), ctx, { runner: fake.runner });
    await saveProfile(dir, {
      ...profile,
      plugins: { claude: { marketplaces: { acme: "acme/plugins" } } },
    });
    const loaded = await loadProfile(dir);
    const preview = await plan(loaded, ctx, { runner: fake.runner });
    assert.deepEqual(
      preview.changes.filter((change) => change.action === "delete").map((change) => change.key),
      ["plugin:claude:tool@acme"],
    );
    await apply(loaded, ctx, { runner: fake.runner });
    assert.equal(fake.calls.at(-1), "plugin uninstall tool@acme --scope user");
  });

  test("a missing harness program gives a warning and no plugin change", async () => {
    const ctx = contextFor(await tempDir());
    const preview = await plan(await loadProfile(await profileDir(profile)), ctx, {
      runner: offlineRunner,
    });
    assert.equal(
      preview.warnings.some((warning) => warning.startsWith("claude is not on the PATH")),
      true,
    );
    assert.equal(
      preview.changes.some((change) => change.kind === "plugin"),
      false,
    );
  });

  test("Zed extensions use auto_install_extensions only when absent", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    await fs.mkdir(path.join(zedExtensionsDir(ctx), "html"), { recursive: true });
    const loaded = await loadProfile(
      await profileDir({
        version: 1,
        harnesses: ["zed"],
        plugins: { zed: { install: ["html", "toml"] } },
      }),
    );
    await apply(loaded, ctx);
    const settings = await readJson(getAdapter("zed").settingsLocation(ctx).path);
    assert.deepEqual(settings.auto_install_extensions, { toml: true });
    assert.equal(writes((await plan(loaded, ctx)).summary), 0);
  });
});

describe("patches", () => {
  async function packageRepo(home: string, content: string): Promise<string> {
    const repo = path.join(home, ".pi", "agent", "git", "github.com", "acme", "tool");
    await writeText(path.join(repo, "index.ts"), "export const a = 1;\n");
    git(repo, "init", "--quiet", "-b", "main");
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Add the tool");
    await writeText(path.join(repo, "index.ts"), content);
    await writeJson(path.join(home, ".pi", "agent", "settings.json"), {
      packages: ["git:github.com/acme/tool"],
    });
    return repo;
  }

  test("capture finds a local change in a Pi package, and apply replays it", async () => {
    const home = await tempDir("ade-home-");
    await packageRepo(home, "export const a = 2;\n");
    const result = await capture(contextFor(home), { runner: offlineRunner });
    assert.deepEqual(result.profile.patches, [
      {
        root: "pi",
        target: "git/github.com/acme/tool",
        source: "patches/pi/github.com/acme/tool.patch",
      },
    ]);
    const loaded = await writeCapture(path.join(await tempDir("ade-profile-"), "profile"), result);

    const target = await tempDir("ade-target-");
    const ctx = contextFor(target);
    const repo = await packageRepo(target, "export const a = 1;\n");
    await apply(loaded, ctx, { runner: offlineRunner });
    assert.equal(await fs.readFile(path.join(repo, "index.ts"), "utf8"), "export const a = 2;\n");
    assert.equal(writes((await plan(loaded, ctx, { runner: offlineRunner })).summary), 0);
    await revert(ctx, { runner: offlineRunner });
    assert.equal(await fs.readFile(path.join(repo, "index.ts"), "utf8"), "export const a = 1;\n");

    const empty = contextFor(await tempDir("ade-target-"));
    const preview = await plan(loaded, empty, { runner: offlineRunner });
    assert.equal(
      preview.warnings.some((warning) => warning.includes("is not a Git checkout yet")),
      true,
    );
  });
});

describe("trust and validation", () => {
  test("the risk summary marks plugins, patches, and links", () => {
    const high = riskSummary({
      version: 1,
      plugins: { claude: { marketplaces: { acme: "acme/plugins" }, install: ["tool@acme"] } },
      patches: [{ root: "pi", target: "git/x", source: "patches/x.patch" }],
      files: [{ root: "claude", target: "styles/a.md", symlink: "${home}/a.md" }],
    })
      .filter((item) => item.level === "high")
      .map((item) => item.text);
    assert.deepEqual(high, [
      "writes claude:styles/a.md as a link to ${home}/a.md",
      "claude adds the marketplace acme from acme/plugins",
      "claude installs tool@acme",
      "changes the code in pi:git/x with patches/x.patch",
    ]);
  });

  test("the profile rejects a root key without a file and plugins without support", async () => {
    const dir = await tempDir("ade-profile-");
    await assert.rejects(
      saveProfile(dir, { version: 1, settings: { home: { a: 1 } } }),
      (error: unknown) => error instanceof AdeError && error.code === "profile-invalid",
    );
    await assert.rejects(
      saveProfile(dir, { version: 1, plugins: { opencode: { install: ["x"] } } }),
      (error: unknown) =>
        error instanceof AdeError &&
        error.details.some((line) => line.includes("no plugin support")),
    );
  });
});

describe("cli coverage", () => {
  test("add, list, and remove plugins, and show the inventory", async () => {
    const root = await tempDir("ade-cli-");
    const home = path.join(root, "home");
    await writeText(path.join(home, ".claude", "notes.txt"), "Notes.\n");
    const profile = path.join(root, "profile");
    const io = () => fakeIO(root);
    const run = async (args: string[]) => {
      const handle = io();
      const code = await runCli(args, handle);
      return { code, out: handle.output(), err: handle.errors() };
    };
    const common = ["--profile", profile, "--home", home];
    assert.equal((await run(["init", profile])).code, EXIT.ok);
    assert.equal(
      (await run(["add", "marketplace", "claude", "acme", "acme/plugins", ...common])).code,
      EXIT.ok,
    );
    assert.equal((await run(["add", "plugin", "claude", "tool@acme", ...common])).code, EXIT.ok);
    assert.equal((await run(["add", "plugin", "opencode", "x", ...common])).code, EXIT.usage);
    const listed = JSON.parse((await run(["list", "plugins", "--json", ...common])).out) as {
      result: { plugins: unknown };
    };
    assert.deepEqual(listed.result.plugins, {
      claude: { marketplaces: { acme: "acme/plugins" }, install: ["tool@acme"] },
    });
    assert.equal((await run(["remove", "plugin", "claude:tool@acme", ...common])).code, EXIT.ok);
    const report = JSON.parse((await run(["inventory", "--json", "--home", home])).out) as {
      result: { rows: { name: string; status: string }[] };
    };
    assert.deepEqual(
      report.result.rows.map((row) => [row.name, row.status]),
      [["notes.txt", "extra"]],
    );
  });
});
