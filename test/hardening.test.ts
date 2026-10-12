import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { terminalText } from "../src/cli/output.ts";
import { AdeError } from "../src/core/errors.ts";
import { apply } from "../src/engine/apply.ts";
import { capture } from "../src/engine/capture.ts";
import { numstatPaths } from "../src/engine/external.ts";
import { revert } from "../src/engine/history.ts";
import { plan } from "../src/engine/plan.ts";
import { importBundle } from "../src/profile/bundle.ts";
import { loadProfile, saveProfile } from "../src/profile/load.ts";
import { parseMarkdown, writeMarkdown } from "../src/profile/markdown.ts";
import { buildProfileBundle, scanBundle } from "../src/profile/pack.ts";
import { isSafeRelative } from "../src/core/fsx.ts";
import { riskSummary } from "../src/profile/risk.ts";
import { ProfileSchema } from "../src/profile/schema.ts";
import { remoteHistory } from "../src/remote/client.ts";
import { createSecretResolver } from "../src/secrets/resolve.ts";
import { materializeGitTree, resolveGitRef, treeCacheDir } from "../src/skills/git.ts";
import { contextFor, offlineRunner, POSIX, tempDir, testGitEnv, writeText } from "./helpers.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: testGitEnv({ GIT_CONFIG_GLOBAL: path.join(cwd, ".no-global-config") }),
  }).trim();
}

async function repoWith(files: Record<string, string>): Promise<{ repo: string; url: string }> {
  const repo = await tempDir("ade-repo-");
  git(repo, "init", "--quiet", "-b", "main");
  for (const [name, text] of Object.entries(files)) {
    await writeText(path.join(repo, name), text);
  }
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "First");
  return { repo, url: pathToFileURL(repo).href };
}

function isCode(code: string) {
  return (error: unknown) => error instanceof AdeError && error.code === code;
}

describe("git input", () => {
  test("a ref matches only the exact branch or tag name", async () => {
    const { repo, url } = await repoWith({ "README.md": "one\n" });
    const first = git(repo, "rev-parse", "HEAD");
    git(repo, "tag", "v1");
    git(repo, "tag", "-a", "-m", "Release", "v2");
    await writeText(path.join(repo, "README.md"), "two\n");
    git(repo, "commit", "--quiet", "-am", "Second");
    git(repo, "branch", "feature/v1");
    const ctx = contextFor(await tempDir());
    assert.equal(await resolveGitRef(ctx, url, "v1"), first);
    assert.equal(await resolveGitRef(ctx, url, "v2"), first);
    assert.equal(await resolveGitRef(ctx, url, "refs/tags/v2"), first);
    git(repo, "branch", "v1");
    await assert.rejects(resolveGitRef(ctx, url, "v1"), isCode("conflict"));
    await assert.rejects(resolveGitRef(ctx, url, "v1/"), isCode("usage"));
  });

  test("ade refuses a URL or a ref that Git can read as an option", async () => {
    const { url } = await repoWith({ "README.md": "one\n" });
    const ctx = contextFor(await tempDir());
    await assert.rejects(resolveGitRef(ctx, "--upload-pack=x", "main"), isCode("usage"));
    await assert.rejects(resolveGitRef(ctx, url, "--output=x"), isCode("usage"));
    await assert.rejects(resolveGitRef(ctx, "ext::x", "main"), isCode("usage"));
    const parse = (profile: unknown) => ProfileSchema.safeParse(profile).success;
    assert.equal(parse({ version: 1, skills: { a: { git: "-x" } } }), false);
    assert.equal(parse({ version: 1, skills: { a: { git: url, ref: "-x" } } }), false);
    assert.equal(parse({ version: 1, plugins: { claude: { install: ["-x"] } } }), false);
    assert.equal(parse({ version: 1, skills: { a: { git: url, ref: "main" } } }), true);
  });

  test("the tree cache key holds the repository URL", () => {
    const ctx = contextFor("/home/test");
    const commit = "a".repeat(40);
    assert.notEqual(
      treeCacheDir(ctx, "https://example.com/one.git", commit, undefined),
      treeCacheDir(ctx, "https://example.com/two.git", commit, undefined),
    );
  });

  test("a path with a control character or a .git part is not safe", () => {
    assert.equal(isSafeRelative("a\nb"), false);
    assert.equal(isSafeRelative("repo/.git/hooks/x"), false);
    assert.equal(isSafeRelative(".GIT/config"), false);
    assert.equal(isSafeRelative(".gitconfig"), true);
    assert.equal(isSafeRelative("a/b"), true);
  });
});

describe("git trees", { skip: !POSIX }, () => {
  test("a checkout writes a symbolic link as a plain file", async () => {
    const { repo, url } = await repoWith({ "skills/deploy/SKILL.md": "---\nname: deploy\n---\n" });
    await fs.symlink("../../README.md", path.join(repo, "skills", "deploy", "link.md"));
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Add a link");
    const home = await tempDir();
    const ctx = contextFor(home);
    const commit = git(repo, "rev-parse", "HEAD");
    const tree = await materializeGitTree(
      ctx,
      { url, ref: "main", commit, subdir: "skills/deploy" },
      { allowFetch: true },
    );
    const stat = await fs.lstat(path.join(tree, "link.md"));
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(await fs.readFile(path.join(tree, "link.md"), "utf8"), "../../README.md");
    assert.equal((await fs.stat(ctx.cacheDir)).mode & 0o777, 0o700);
  });

  test("a subdirectory that is a symbolic link is not a directory", async () => {
    const { repo, url } = await repoWith({ "real/SKILL.md": "---\nname: real\n---\n" });
    await fs.symlink("real", path.join(repo, "skills"));
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Add a folder link");
    const ctx = contextFor(await tempDir());
    const commit = git(repo, "rev-parse", "HEAD");
    await assert.rejects(
      materializeGitTree(ctx, { url, ref: "main", commit, subdir: "skills" }, { allowFetch: true }),
      (error: unknown) => error instanceof AdeError,
    );
  });
});

describe("terminal output", () => {
  const esc = String.fromCharCode(27);

  test("output escapes control characters in data and keeps the ade styles", () => {
    const styled = `${esc}[31m!${esc}[39m`;
    const shown = terminalText(`${styled} a${esc}[2Jb\rc\u202ed`, true);
    assert.equal(shown.startsWith(styled), true);
    assert.equal(shown.includes(`${esc}[2J`), false);
    assert.equal(shown.includes("\r"), false);
    assert.equal(shown.includes("\u202e"), false);
    assert.equal(terminalText(styled, false).includes(esc), false);
    assert.equal(terminalText("one\ntwo", false), "one\ntwo");
  });

  test("risk lines hold no control character", () => {
    const items = riskSummary({
      version: 1,
      mcp: { tool: { transport: "stdio", command: `run${esc}[2J` } },
    });
    for (const item of items) {
      for (const char of item.text) {
        assert.equal(char.charCodeAt(0) >= 0x20, true, JSON.stringify(item.text));
      }
    }
  });

  test("a remote result needs the envelope shape", async () => {
    const agentPath = path.join(await tempDir(), "agent.mjs");
    await writeText(agentPath, "");
    const reply = (envelope: unknown) => ({
      target: { host: "far" },
      agentPath,
      transport: async () => ({
        code: 0,
        stdout: `ADE-REMOTE-RESULT ${JSON.stringify(envelope)}\n`,
        stderr: "",
      }),
    });
    await assert.rejects(
      remoteHistory(reply({ protocol: 1, ok: true, result: [] })),
      isCode("remote-failed"),
    );
    await assert.rejects(
      remoteHistory(reply({ protocol: 1, ok: false, error: { code: "other", message: "m" } })),
      isCode("remote-failed"),
    );
    await assert.rejects(
      remoteHistory(reply({ protocol: 1, ok: false, error: { code: "locked", message: "m" } })),
      isCode("locked"),
    );
  });
});

describe("secret handling", () => {
  test("plan output masks a long secret with a quote in it", async () => {
    const secret = `start"${"z".repeat(90)}end`;
    const home = await tempDir();
    const ctx = contextFor(home, { TOKEN: secret });
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      settings: { pi: { apiKey: "${secret:TOKEN}", other: { nested: "${secret:TOKEN}" } } },
      secrets: { TOKEN: { from: "env", name: "TOKEN" } },
    });
    const loaded = await loadProfile(dir);
    const result = await plan(loaded, ctx, {
      resolver: createSecretResolver(loaded.profile, ctx),
    });
    assert.equal(result.changes.length > 0, true);
    assert.equal(JSON.stringify(result).includes("z".repeat(10)), false);
  });

  test("apply sets mode 600 on a file that gets a secret", { skip: !POSIX }, async () => {
    const home = await tempDir();
    const ctx = contextFor(home, { TOKEN: "value-1234567890" });
    const settings = path.join(home, ".pi", "agent", "settings.json");
    await writeText(settings, "{}\n");
    await fs.chmod(settings, 0o644);
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      settings: { pi: { apiKey: "${secret:TOKEN}" } },
      secrets: { TOKEN: { from: "env", name: "TOKEN" } },
    });
    await apply(await loadProfile(dir), ctx, { runner: offlineRunner });
    assert.equal((await fs.stat(settings)).mode & 0o777, 0o600);
  });

  test("the token scan reads files that a bundle stores as base64", () => {
    const content = Buffer.from(`\u0000ghp_${"a".repeat(30)}\n`).toString("base64");
    const findings = scanBundle({
      format: "ade-bundle",
      version: 1,
      createdAt: new Date(0).toISOString(),
      files: [
        { path: "ade.json", encoding: "utf8", content: '{"version":1}\n' },
        { path: "blob.bin", encoding: "base64", content },
      ],
    });
    assert.deepEqual(
      findings.map((finding) => finding.file),
      ["blob.bin"],
    );
  });

  test("a private link target stays private in a bundle and an ADE.md", {
    skip: !POSIX,
  }, async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const target = path.join(home, "private.txt");
    await writeText(target, "private text\n");
    await fs.chmod(target, 0o600);
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      files: [{ root: "home", target: ".config/tool/private.txt", symlink: target }],
    });
    const loaded = await loadProfile(dir);
    const built = await buildProfileBundle(loaded, ctx, { vendorGit: false, vendorLinks: true });
    const vendored = built.bundle.files.find((file) => file.path.startsWith("vendor/files/"));
    assert.equal(vendored?.private, true);
    const markdown = writeMarkdown(built.bundle, built.profile, { createdAt: new Date(0) });
    assert.match(markdown, /mode="600"/);
    const parsed = parseMarkdown(markdown, "ADE.md");
    const out = path.join(await tempDir(), "profile");
    await importBundle(parsed.bundle, out);
    const copy = path.join(out, vendored?.path ?? "");
    assert.equal((await fs.stat(copy)).mode & 0o777, 0o600);
  });

  test("capture skips credential files and replaces credential arguments", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const gemini = path.join(home, ".gemini");
    await writeText(
      path.join(gemini, "settings.json"),
      `${JSON.stringify(
        {
          mcpServers: {
            tools: { command: "tool", args: ["--api-key", "abcd1234efgh5678", "--verbose"] },
            web: { httpUrl: "https://mcp.example.com/mcp?access_token=qrst1234uvwx5678&mode=fast" },
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeText(path.join(gemini, ".env"), "GEMINI_API_KEY=dummy-value-12345678\n");
    await writeText(path.join(gemini, "notes.txt"), "deploy_token: lmno1234pqrs5678\n");
    await writeText(path.join(gemini, "style.txt"), "Use short sentences.\n");
    const result = await capture(ctx, { harnesses: ["gemini"], runner: offlineRunner });
    const text =
      JSON.stringify(result.profile) +
      result.files.map((file) => file.content?.toString("utf8") ?? "").join("\n");
    for (const value of [
      "abcd1234efgh5678",
      "qrst1234uvwx5678",
      "dummy-value-12345678",
      "lmno1234pqrs5678",
    ]) {
      assert.equal(text.includes(value), false, value);
    }
    assert.equal(text.includes("Use short sentences."), true);
    assert.equal(
      result.warnings.some(
        (warning) => warning.includes("notes.txt") && warning.includes("secret"),
      ),
      true,
    );
    assert.match(JSON.stringify(result.profile.mcp?.tools), /\$\{secret:/);
    assert.match(JSON.stringify(result.profile.mcp?.web), /access_token=\$\{secret:/);
  });
});

describe("patches and ADE.md paths", () => {
  test("the numstat reader keeps both names of a rename", () => {
    assert.deepEqual(numstatPaths("1\t0\tb.txt\u00000\t0\t\u0000a.txt\u0000c.txt\u0000"), [
      "b.txt",
      "a.txt",
      "c.txt",
    ]);
  });

  test("revert restores each file of a patch with a rename", { skip: !POSIX }, async () => {
    const home = await tempDir("ade-home-");
    const repo = path.join(home, ".pi", "agent", "git", "github.com", "acme", "tool");
    await writeText(path.join(repo, "a.txt"), "a\n");
    await writeText(path.join(repo, "b.txt"), "b\n");
    git(repo, "init", "--quiet", "-b", "main");
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "First");
    git(repo, "mv", "a.txt", "c.txt");
    await writeText(path.join(repo, "b.txt"), "b\nx\n");
    git(repo, "add", "-A");
    const patch = `${git(repo, "diff", "--cached", "-M")}\n`;
    git(repo, "reset", "--quiet", "--hard");
    const dir = await tempDir("ade-profile-");
    await writeText(path.join(dir, "patches", "tool.patch"), patch);
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      patches: [{ root: "pi", target: "git/github.com/acme/tool", source: "patches/tool.patch" }],
    });
    const ctx = contextFor(home);
    await apply(await loadProfile(dir), ctx, { runner: offlineRunner });
    assert.equal(await fs.readFile(path.join(repo, "c.txt"), "utf8"), "a\n");
    await assert.rejects(fs.stat(path.join(repo, "a.txt")));
    await revert(ctx, { runner: offlineRunner });
    assert.equal(await fs.readFile(path.join(repo, "a.txt"), "utf8"), "a\n");
    assert.equal(await fs.readFile(path.join(repo, "b.txt"), "utf8"), "b\n");
    await assert.rejects(fs.stat(path.join(repo, "c.txt")));
  });

  test("an ADE.md path with a control character fails", async () => {
    const dir = await tempDir("ade-profile-");
    await writeText(path.join(dir, "AGENTS.md"), "# Rules\n");
    await saveProfile(dir, { version: 1, instructions: { file: "AGENTS.md" } });
    const loaded = await loadProfile(dir);
    const built = await buildProfileBundle(loaded, contextFor(await tempDir()), {
      vendorGit: false,
      vendorLinks: false,
    });
    const markdown = writeMarkdown(built.bundle, built.profile, { createdAt: new Date(0) });
    const edited = markdown.replace('path="AGENTS.md"', 'path="AGENTS\\nmd"');
    assert.notEqual(edited, markdown);
    assert.throws(
      () => parseMarkdown(edited, "ADE.md"),
      (error: unknown) => error instanceof AdeError && error.code === "bundle-invalid",
    );
  });
});
