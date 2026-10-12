import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { EXIT, runCli } from "../src/cli/main.ts";
import { type CliIO, createOutput, terminalText } from "../src/cli/output.ts";
import { renderChanges } from "../src/cli/render.ts";
import { type Context, createContext } from "../src/core/context.ts";
import { AdeError } from "../src/core/errors.ts";
import { isSafeRelative, listFiles } from "../src/core/fsx.ts";
import { escapeJsonControls } from "../src/core/text.ts";
import { apply } from "../src/engine/apply.ts";
import { capture, writeCapture } from "../src/engine/capture.ts";
import { checkInstalledMarketplace, numstatPaths } from "../src/engine/external.ts";
import { revert } from "../src/engine/history.ts";
import { plan } from "../src/engine/plan.ts";
import { type Bundle, importBundle, modeFlags } from "../src/profile/bundle.ts";
import { loadProfile, profileText, saveProfile } from "../src/profile/load.ts";
import { parseMarkdown, writeMarkdown } from "../src/profile/markdown.ts";
import { buildProfileBundle, scanBundle } from "../src/profile/pack.ts";
import { riskSummary } from "../src/profile/risk.ts";
import { ProfileSchema } from "../src/profile/schema.ts";
import { trustEntries } from "../src/profile/trust.ts";
import { semanticProblems } from "../src/profile/validate.ts";
import { remoteHistory } from "../src/remote/client.ts";
import { type CommandRunner, createSecretResolver } from "../src/secrets/resolve.ts";
import { materializeGitTree, resolveGitRef, treeCacheDir } from "../src/skills/git.ts";
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
  writeText,
} from "./helpers.ts";

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
    let text = "";
    const io: CliIO = {
      ...fakeIO("/"),
      stdoutIsTTY: true,
      env: {},
      stdout: (chunk: string) => {
        text += chunk;
      },
    };
    const out = createOutput(io, true);
    const forged = `${esc}[31m! fake${esc}[39m`;
    out.line(`${out.style("red", "!")} a${esc}[2Jb\rc\u202ed ${forged} one\ntwo`);
    assert.equal(text.startsWith(`${esc}[31m!${esc}[39m`), true);
    assert.equal(text.split(esc).length - 1, 2);
    assert.equal(text.includes("\r"), false);
    assert.equal(text.includes("\u202e"), false);
    assert.equal(text.trimEnd().includes("\n"), false);
    assert.equal(terminalText(forged, false).includes(esc), false);
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

async function cli(cwd: string, args: string[], io: CliIO = fakeIO(cwd)): Promise<number> {
  return runCli(args, io);
}

function bundleOf(files: Bundle["files"]): Bundle {
  return { format: "ade-bundle", version: 1, createdAt: new Date(0).toISOString(), files };
}

describe("audit run 2 fixes", () => {
  test("export refuses a token value and writes mode 600", async () => {
    const root = await tempDir("ade-cli-");
    const dir = path.join(root, "profile");
    await writeText(path.join(dir, "AGENTS.md"), `token ghp_${"a".repeat(30)}\n`);
    await saveProfile(dir, { version: 1, instructions: { file: "AGENTS.md" } });
    const out = path.join(root, "bundle.json");
    assert.equal(await cli(root, ["export", "--profile", dir, "--out", out]), EXIT.failure);
    assert.equal(await exists(out), false);
    await writeText(path.join(dir, "AGENTS.md"), "Use short sentences.\n");
    assert.equal(await cli(root, ["export", "--profile", dir, "--out", out]), EXIT.ok);
    if (POSIX) {
      assert.equal((await fs.stat(out)).mode & 0o777, 0o600);
    }
  });

  test("pack of a shared file needs trust", async () => {
    const root = await tempDir("ade-cli-");
    const home = path.join(root, "home");
    await fs.mkdir(home, { recursive: true });
    const dir = path.join(root, "profile");
    await writeText(path.join(dir, "AGENTS.md"), "Use short sentences.\n");
    await saveProfile(dir, { version: 1, name: "team", instructions: { file: "AGENTS.md" } });
    const file = path.join(root, "ADE.md");
    assert.equal(
      await cli(root, ["share", "--profile", dir, "--out", file, "--home", home]),
      EXIT.ok,
    );
    const out = path.join(root, "packed");
    assert.equal(await cli(root, ["pack", file, "--out", out, "--home", home]), EXIT.failure);
    assert.equal(await exists(out), false);
    assert.equal(await cli(root, ["pack", file, "--out", out, "--home", home, "--trust"]), EXIT.ok);
    assert.equal(await exists(path.join(out, "ade.json")), true);
  });

  test("remote capture needs trust and drops links to the other machine", {
    skip: !POSIX,
  }, async () => {
    const root = await tempDir("ade-cli-");
    const home = path.join(root, "home");
    await fs.mkdir(home, { recursive: true });
    const profile = {
      version: 1 as const,
      name: "far",
      files: [
        {
          root: "home" as const,
          target: ".config/app/notes.txt",
          source: "files/home/.config/app/notes.txt",
          symlink: "${home}/.ssh/dummy-local-file",
        },
      ],
      skills: { mine: { link: "~/skills/mine" } },
    };
    const envelope = {
      protocol: 1,
      ok: true,
      remote: {
        hostname: "far",
        platform: "linux",
        arch: "x64",
        node: "v24.0.0",
        home: "/home/far",
        stateDir: "/home/far/.local/state/ade",
        adeVersion: "0.1.0",
      },
      result: {
        bundle: bundleOf([
          { path: "ade.json", encoding: "utf8", content: profileText(profile) },
          { path: "files/home/.config/app/notes.txt", encoding: "utf8", content: "notes\n" },
        ]),
        warnings: [],
        secrets: [],
      },
    };
    const reply = path.join(root, "reply.txt");
    await writeText(reply, `ADE-REMOTE-RESULT ${JSON.stringify(envelope)}\n`);
    const ssh = path.join(root, "fake-ssh");
    await writeText(ssh, `#!/bin/sh\ncat > /dev/null\ncat "${reply}"\n`);
    await fs.chmod(ssh, 0o755);
    const agent = path.join(root, "agent.mjs");
    await writeText(agent, "");
    const previous = process.env.ADE_REMOTE_AGENT;
    process.env.ADE_REMOTE_AGENT = agent;
    try {
      const out = path.join(root, "captured");
      const args = ["remote", "far", "capture", "--out", out, "--ssh", ssh, "--home", home];
      assert.equal(await cli(root, args), EXIT.failure);
      assert.equal(await exists(out), false);
      assert.equal(await cli(root, [...args, "--trust"]), EXIT.ok);
      const captured = await loadProfile(out);
      assert.equal(captured.profile.skills, undefined);
      assert.deepEqual(captured.profile.files, [
        {
          root: "home",
          target: ".config/app/notes.txt",
          source: "files/home/.config/app/notes.txt",
        },
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.ADE_REMOTE_AGENT;
      } else {
        process.env.ADE_REMOTE_AGENT = previous;
      }
    }
  });

  test("the ADE.md digest holds the file mode, and case-only path pairs fail", async () => {
    const profile = {
      version: 1 as const,
      files: [{ root: "home" as const, target: "bin/x", source: "x" }],
    };
    const markdown = (executable: boolean) =>
      writeMarkdown(
        bundleOf([
          { path: "ade.json", encoding: "utf8", content: profileText(profile) },
          {
            path: "x",
            encoding: "utf8",
            content: "echo\n",
            ...(executable ? { executable: true } : {}),
          },
        ]),
        profile,
        { createdAt: new Date(0) },
      );
    const plain = parseMarkdown(markdown(false), "a").digest;
    const runnable = parseMarkdown(markdown(true), "b").digest;
    assert.notEqual(plain, runnable);
    const collided = markdown(false).replace('path="x"', 'path="ADE.json"');
    assert.throws(
      () => parseMarkdown(collided, "c"),
      (error: unknown) => error instanceof AdeError && /differ only in case/.test(error.message),
    );
    await assert.rejects(
      importBundle(
        bundleOf([
          { path: "ade.json", encoding: "utf8", content: profileText(profile) },
          { path: "Notes.md", encoding: "utf8", content: "a\n" },
          { path: "notes.md", encoding: "utf8", content: "b\n" },
        ]),
        path.join(await tempDir(), "profile"),
      ),
      isCode("bundle-invalid"),
    );
  });

  test("a mode-only change of a file changes its trust entry", { skip: !POSIX }, async () => {
    const dir = await tempDir("ade-profile-");
    await writeText(path.join(dir, "x.sh"), "echo\n");
    await saveProfile(dir, {
      version: 1,
      files: [{ root: "home", target: "bin/x", source: "x.sh" }],
    });
    const before = (await trustEntries(await loadProfile(dir)))["file:home:bin/x"];
    await fs.chmod(path.join(dir, "x.sh"), 0o755);
    const after = (await trustEntries(await loadProfile(dir)))["file:home:bin/x"];
    assert.notEqual(before, after);
  });

  test("a group-readable file counts as private in a bundle", () => {
    if (POSIX) {
      assert.equal(modeFlags(0o640).private, true);
    }
    assert.equal(modeFlags(0o644).private, undefined);
  });

  test("a revert of a revert keeps mode 600 on a file with a secret", {
    skip: !POSIX,
  }, async () => {
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
    const first = await revert(ctx, { runner: offlineRunner });
    await fs.chmod(settings, 0o644);
    await revert(ctx, { id: first.revertId, runner: offlineRunner });
    assert.equal((await readJson(settings)).apiKey, "value-1234567890");
    assert.equal((await fs.stat(settings)).mode & 0o777, 0o600);
  });

  test("capture skips credential files in asset folders and referenced paths", async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    const gemini = path.join(home, ".gemini");
    await writeText(
      path.join(gemini, "settings.json"),
      `${JSON.stringify({ tools: { discoveryCommand: `${home}/.config/tool/run.sh ${home}/.config/tool/secrets.env` } }, null, 2)}\n`,
    );
    await writeText(path.join(gemini, "commands", "review.toml"), 'prompt = "Review."\n');
    await writeText(path.join(gemini, "commands", ".env"), "MARKER_ENV=dummy\n");
    await writeText(path.join(gemini, "commands", "deploy.key"), "MARKER_KEY\n");
    await writeText(
      path.join(gemini, "commands", "tool.json"),
      '{ "api_key": "MARKER_JSON_123456" }\n',
    );
    await writeText(path.join(home, ".config", "tool", "run.sh"), "echo run\n");
    await writeText(path.join(home, ".config", "tool", "secrets.env"), "MARKER_REF=dummy\n");
    const result = await capture(ctx, { harnesses: ["gemini"], runner: offlineRunner });
    const out = path.join(await tempDir(), "profile");
    await writeCapture(out, result);
    let text = "";
    for (const file of await listFiles(out)) {
      text += await fs.readFile(path.join(out, ...file.split("/")), "utf8");
    }
    for (const marker of ["MARKER_ENV", "MARKER_KEY", "MARKER_JSON", "MARKER_REF"]) {
      assert.equal(text.includes(marker), false, marker);
    }
    assert.equal(text.includes("Review."), true);
    assert.equal(
      result.warnings.filter((warning) => warning.includes("ade does not capture it")).length >= 4,
      true,
    );
  });

  test("the token scan reports credential file names", () => {
    const findings = scanBundle(
      bundleOf([
        { path: "ade.json", encoding: "utf8", content: '{"version":1}\n' },
        { path: "files/home/.env", encoding: "utf8", content: "MODE=1\n" },
        { path: "files/home/.env.example", encoding: "utf8", content: "MODE=1\n" },
      ]),
    );
    assert.deepEqual(
      findings.map((finding) => [finding.file, finding.kind]),
      [["files/home/.env", "credential file"]],
    );
  });

  test("the risk summary names the ref and the locked commit of a Git skill", () => {
    const commit = "c".repeat(40);
    const items = riskSummary(
      { version: 1, skills: { a: { git: "https://example.com/skills.git", ref: "main" } } },
      {
        version: 1,
        skills: {
          a: { git: "https://example.com/skills.git", ref: "main", commit, hash: "d".repeat(64) },
        },
      },
    );
    assert.equal(
      items.some((item) =>
        item.text.endsWith(
          `comes from https://example.com/skills.git at main, commit ${"c".repeat(12)}`,
        ),
      ),
      true,
    );
  });

  test("JSON output escapes C1 and bidirectional characters", () => {
    const value = { text: "a\u202eb\u0085c" };
    const json = escapeJsonControls(JSON.stringify(value));
    assert.equal(json.includes("\u202e"), false);
    assert.equal(json.includes("\\u202e"), true);
    assert.deepEqual(JSON.parse(json), value);
  });

  test("a prompt question holds no control character", { skip: !POSIX }, async () => {
    const root = await tempDir("ade-cli-");
    const home = path.join(root, `home${String.fromCharCode(27)}[2J`);
    await fs.mkdir(home, { recursive: true });
    const dir = path.join(root, "profile");
    await writeText(path.join(dir, "AGENTS.md"), "Use short sentences.\n");
    await saveProfile(dir, { version: 1, harnesses: ["pi"], instructions: { file: "AGENTS.md" } });
    const questions: string[] = [];
    const io: CliIO = {
      ...fakeIO(root, ["no"]),
      prompt: async (question) => {
        questions.push(question);
        return "no";
      },
    };
    assert.equal(await cli(root, ["apply", "--profile", dir, "--home", home], io), EXIT.ok);
    assert.equal(questions.length, 1);
    assert.equal(questions[0]?.includes(String.fromCharCode(27)), false);
  });
});

describe("trust keys and the risk display", () => {
  test("a settings leaf and an empty settings file have separate trust keys", async () => {
    const dir = await tempDir("ade-profile-");
    const write = async (value: string) => {
      await saveProfile(dir, {
        version: 1,
        settings: { claude: { demo: { json: value } }, "claude:demo.json": {} },
      });
      return trustEntries(await loadProfile(dir));
    };
    const first = await write("one");
    const second = await write("two");
    assert.notDeepEqual(first, second);
    assert.equal(Object.keys(first).includes("setting:claude:/demo/json"), true);
  });

  test("two entries with the same key and other content fail", async () => {
    const dir = await tempDir("ade-profile-");
    await writeText(path.join(dir, "a.txt"), "a\n");
    await writeText(path.join(dir, "b.txt"), "b\n");
    const profile = {
      version: 1 as const,
      files: [
        { root: "home" as const, target: "x.txt", source: "a.txt" },
        { root: "home" as const, target: "x.txt", source: "b.txt" },
      ],
    };
    await assert.rejects(saveProfile(dir, profile), isCode("profile-invalid"));
    await assert.rejects(
      trustEntries({ dir, profile, lock: { version: 1, skills: {} } }),
      isCode("profile-invalid"),
    );
  });

  test("the risk summary shows full values, quoted arguments, and risky overrides", () => {
    const long = `run ${"x".repeat(200)} --then-more`;
    const items = riskSummary({
      version: 1,
      mcp: {
        tool: {
          transport: "stdio",
          command: "node",
          args: ["a b", "c"],
          overrides: { codex: { args: ["--other"] } },
        },
      },
      settings: { claude: { hooks: { Stop: long } } },
    });
    const text = items.map((item) => `${item.level} ${item.text}`);
    assert.equal(
      text.some((line) => line.includes('node "a b" c')),
      true,
    );
    assert.equal(
      text.some((line) => line.startsWith("high tool for codex adds")),
      true,
    );
    assert.equal(
      text.some((line) => line.includes("--then-more")),
      true,
    );
  });

  test("plan output escapes a new line in a label", () => {
    let text = "";
    const out = createOutput(
      {
        ...fakeIO("/"),
        stdout: (chunk: string) => {
          text += chunk;
        },
      },
      false,
    );
    renderChanges(
      out,
      "/home/test",
      [
        {
          key: "plugin:claude:x",
          kind: "plugin",
          scope: "claude",
          label: "x\n  + fake line",
          action: "create",
          path: "/home/test/x",
          drift: false,
          notes: ["note\nfake"],
        },
      ],
      false,
    );
    assert.equal(text.split("\n").filter((line) => line.includes("fake")).length, 2);
    assert.equal(text.includes("+ fake line"), true);
    assert.equal(
      text.split("\n").some((line) => line.trimStart().startsWith("+ fake")),
      false,
    );
  });
});

describe("settings names, Grok installs, and extension keys", () => {
  test("a case variant of a main settings file needs the harness key", () => {
    const problems = semanticProblems({
      version: 1,
      settings: { "zed:Settings.json": { auto_install_extensions: { html: true } } },
    });
    assert.equal(
      problems.some((problem) => problem.includes('Use the key "zed"')),
      true,
    );
  });

  test("a Grok install from another marketplace fails", async () => {
    await checkInstalledMarketplace("deploy@team", ["deploy@team"]);
    await checkInstalledMarketplace("deploy@team", ["deploy"]);
    await assert.rejects(
      checkInstalledMarketplace("deploy@team", ["deploy@other"]),
      isCode("conflict"),
    );
  });

  test("extension auto-install settings are high-risk lines", () => {
    const items = riskSummary({
      version: 1,
      settings: { zed: { auto_install_extensions: { html: true } } },
    });
    assert.equal(
      items.some((item) => item.level === "high" && item.text.includes("auto_install_extensions")),
      true,
    );
  });
});

function pluginContext(home: string): Context {
  return createContext({
    home,
    env: { PATH: process.env.PATH ?? "" },
    stateDir: path.join(home, ".ade-state"),
    cacheDir: path.join(home, ".ade-cache"),
  });
}

describe("plugin installs and their undo", () => {
  test("a revert reinstalls the Cursor version that the apply replaced", async () => {
    const home = await tempDir();
    const registry = path.join(home, ".cursor", "extensions", "extensions.json");
    await writeText(
      registry,
      JSON.stringify([{ identifier: { id: "marker.ext" }, version: "2.0.0" }]),
    );
    const read = async () =>
      JSON.parse(await fs.readFile(registry, "utf8")) as {
        identifier: { id: string };
        version: string;
      }[];
    const runner: CommandRunner = async (argv) => {
      if (argv[0] !== "cursor") {
        throw Object.assign(new Error(`spawn ${argv[0]} ENOENT`), { code: "ENOENT" });
      }
      if (argv[1] === "--version") {
        return { code: 0, stdout: "1.0.0\n", stderr: "" };
      }
      const list = await read();
      const target = argv[2] ?? "";
      if (argv[1] === "--install-extension") {
        const at = target.lastIndexOf("@");
        const id = target.slice(0, at);
        const next = list.filter((item) => item.identifier.id !== id);
        next.push({ identifier: { id }, version: target.slice(at + 1) });
        await fs.writeFile(registry, JSON.stringify(next));
      } else if (argv[1] === "--uninstall-extension") {
        await fs.writeFile(
          registry,
          JSON.stringify(list.filter((item) => item.identifier.id !== target)),
        );
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["cursor"],
      plugins: { cursor: { install: ["marker.ext@1.0.0"] } },
    });
    const ctx = pluginContext(home);
    const loaded = await loadProfile(dir);
    const planned = await plan(loaded, ctx, { runner });
    const change = planned.changes.find((item) => item.key.startsWith("plugin:"));
    assert.equal(change?.action, "update");
    assert.equal(change?.before, "marker.ext@2.0.0");
    await apply(loaded, ctx, { runner });
    assert.deepEqual(
      (await read()).map((item) => item.version),
      ["1.0.0"],
    );
    await revert(ctx, { runner });
    assert.deepEqual(
      (await read()).map((item) => item.version),
      ["2.0.0"],
    );
  });

  test("a marketplace that gets another name fails, and ade removes it", async () => {
    const home = await tempDir();
    const claude = fakeClaude({ "acme/plugins": "acme-official" });
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["claude"],
      plugins: { claude: { marketplaces: { acme: "acme/plugins" } } },
    });
    await assert.rejects(
      apply(await loadProfile(dir), pluginContext(home), { runner: claude.runner }),
      (error: unknown) =>
        error instanceof AdeError &&
        error.code === "conflict" &&
        /acme-official/.test(error.message),
    );
    const known = await readJson(path.join(home, ".claude", "plugins", "known_marketplaces.json"));
    assert.deepEqual(Object.keys(known), []);
  });

  test("a Grok install from another marketplace fails, and ade removes it", async () => {
    const home = await tempDir();
    const state = path.join(home, "grok-plugins.json");
    await writeText(state, "[]");
    const runner: CommandRunner = async (argv) => {
      if (argv[0] !== "grok") {
        throw Object.assign(new Error(`spawn ${argv[0]} ENOENT`), { code: "ENOENT" });
      }
      if (argv[1] === "--version") {
        return { code: 0, stdout: "1.0.0\n", stderr: "" };
      }
      const list = JSON.parse(await fs.readFile(state, "utf8")) as {
        name: string;
        marketplace: string;
      }[];
      if (argv[2] === "list") {
        return { code: 0, stdout: JSON.stringify(list), stderr: "" };
      }
      if (argv[2] === "install") {
        list.push({ name: argv[3] ?? "", marketplace: "other" });
      } else if (argv[2] === "uninstall") {
        list.splice(0, list.length, ...list.filter((item) => item.name !== argv[3]));
      }
      await fs.writeFile(state, JSON.stringify(list));
      return { code: 0, stdout: "", stderr: "" };
    };
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["grok"],
      plugins: { grok: { install: ["deploy@team"] } },
    });
    await assert.rejects(
      apply(await loadProfile(dir), pluginContext(home), { runner }),
      (error: unknown) => error instanceof AdeError && error.code === "conflict",
    );
    assert.deepEqual(JSON.parse(await fs.readFile(state, "utf8")), []);
  });
});
