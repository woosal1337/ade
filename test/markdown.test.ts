import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { EXIT, runCli } from "../src/cli/main.ts";
import { AdeError } from "../src/core/errors.ts";
import { sha256 } from "../src/core/hash.ts";
import { exportBundle } from "../src/profile/bundle.ts";
import { loadProfile, saveProfile } from "../src/profile/load.ts";
import {
  digestOf,
  isMarkdownProfile,
  parseMarkdown,
  writeMarkdown,
} from "../src/profile/markdown.ts";
import { shareProfile } from "../src/profile/pack.ts";
import { resolveProfile } from "../src/profile/source.ts";
import { checkTrust } from "../src/profile/trust.ts";
import { contextFor, fakeIO, POSIX, tempDir, testGitEnv, writeText } from "./helpers.ts";

const NOW = new Date("2026-10-12T09:00:00.000Z");

async function sampleProfile(): Promise<string> {
  const dir = await tempDir("ade-profile-");
  await writeText(path.join(dir, "AGENTS.md"), "# Rules\n\n```bash\nnpm test\n```\n");
  await writeText(
    path.join(dir, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review.\n---\n",
  );
  await writeText(path.join(dir, "skills", "review", "fences.md"), "````\n```\ninner\n```\n````\n");
  await fs.writeFile(path.join(dir, "skills", "review", "icon.bin"), Buffer.from([0, 1, 2, 255]));
  await fs.writeFile(path.join(dir, "skills", "review", "no-eol.txt"), "last line");
  await fs.writeFile(path.join(dir, "skills", "review", "windows.txt"), "one\r\ntwo\r\n");
  await fs.writeFile(path.join(dir, "skills", "review", "empty.txt"), "");
  await writeText(path.join(dir, "files", "run.sh"), "#!/bin/sh\necho run\n");
  await fs.chmod(path.join(dir, "files", "run.sh"), 0o755);
  await saveProfile(dir, {
    version: 1,
    name: "team",
    description: "Team | rules",
    harnesses: ["claude", "pi"],
    instructions: { file: "AGENTS.md" },
    skills: { review: { path: "skills/review" } },
    mcp: {
      docs: { transport: "http", url: "https://docs.example.com/mcp" },
      api: {
        transport: "http",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer ${secret:API_TOKEN}" },
      },
    },
    files: [{ root: "home", target: "bin/run.sh", source: "files/run.sh" }],
    secrets: { API_TOKEN: { from: "env", name: "API_TOKEN" } },
  });
  return dir;
}

async function shared(dir: string, source?: string): Promise<string> {
  const ctx = contextFor(await tempDir(), {});
  return (await shareProfile(await loadProfile(dir), { ...ctx, now: () => NOW }, { source }))
    .markdown;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: testGitEnv() }).trim();
}

describe("ADE.md format", () => {
  test("a round trip keeps every byte and the executable mode", async () => {
    const dir = await sampleProfile();
    const markdown = await shared(dir, "acme/agents");
    assert.equal(isMarkdownProfile(markdown), true);
    assert.match(markdown, /^---\nade: 1\nname: "team"\n/);
    assert.match(markdown, /\nsecrets: \["API_TOKEN"\]\n/);
    assert.match(markdown, /ade apply acme\/agents/);
    assert.match(markdown, /Team \| rules/);
    assert.match(markdown, /encoding="base64"/);
    assert.match(markdown, /eol="none"/);
    if (POSIX) {
      assert.match(markdown, /mode="755"/);
    }
    const parsed = parseMarkdown(markdown, "ADE.md");
    const original = await exportBundle(await loadProfile(dir));
    const bytes = (files: typeof original.files) =>
      Object.fromEntries(
        files
          .filter((file) => file.path !== "ade.json" && file.path !== "ade.schema.json")
          .map((file) => [
            file.path,
            sha256(Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8")),
          ]),
      );
    assert.deepEqual(bytes(parsed.bundle.files), bytes(original.files));
    if (POSIX) {
      assert.equal(
        parsed.bundle.files.find((file) => file.path === "files/run.sh")?.executable,
        true,
      );
    }
    assert.equal(parsed.digest, parsed.meta.digest);
  });

  test("CRLF line endings in the ADE.md itself still parse", async () => {
    const markdown = await shared(await sampleProfile());
    const parsed = parseMarkdown(markdown.replaceAll("\n", "\r\n"), "ADE.md");
    assert.equal(parsed.bundle.files.length, parsed.meta.files);
  });

  test("a hand edit, a removed block, or an unsafe path fails", async () => {
    const markdown = await shared(await sampleProfile());
    const invalid = (text: string): void => {
      assert.throws(
        () => parseMarkdown(text, "ADE.md"),
        (error: unknown) => error instanceof AdeError && error.code === "bundle-invalid",
      );
    };
    invalid(markdown.replace("npm test", "npm run build"));
    invalid(markdown.replace(/### `AGENTS.md`[\s\S]*?\n### /, "### "));
    invalid(markdown.replace('path="AGENTS.md"', 'path="../AGENTS.md"'));
    invalid(markdown.replace(/\n## Files\n/, "\n## Other\n"));
    assert.throws(
      () => parseMarkdown(markdown.replace("ade: 1", "ade: 9"), "ADE.md"),
      (error: unknown) => error instanceof AdeError && error.code === "unsupported",
    );
  });

  test("the digest is a sorted manifest of paths and hashes", () => {
    const digest = digestOf([
      { path: "b", hash: "2" },
      { path: "a", hash: "1" },
    ]);
    assert.equal(digest, `sha256:${sha256("a 1\nb 2\n")}`);
  });

  test("share refuses a token value", async () => {
    const dir = await sampleProfile();
    await fs.writeFile(path.join(dir, "AGENTS.md"), "Key: ghp_abcdefghijklmnopqrstuvwxyz0123\n");
    await assert.rejects(
      shared(dir),
      (error: unknown) => error instanceof AdeError && error.code === "conflict",
    );
  });

  test("the writer refuses a path with a backtick", () => {
    assert.throws(
      () =>
        writeMarkdown(
          {
            format: "ade-bundle",
            version: 1,
            createdAt: NOW.toISOString(),
            files: [
              { path: "ade.json", encoding: "utf8", content: '{"version":1}\n' },
              { path: "a`b.md", encoding: "utf8", content: "x\n" },
            ],
          },
          { version: 1 },
          { createdAt: NOW },
        ),
      AdeError,
    );
  });
});

describe("ADE.md sources", () => {
  test("a local file and a folder with only an ADE.md load", async () => {
    const markdown = await shared(await sampleProfile());
    const folder = await tempDir("ade-share-");
    await fs.writeFile(path.join(folder, "ADE.md"), markdown);
    const ctx = contextFor(await tempDir());
    const fromFile = await resolveProfile(path.join(folder, "ADE.md"), ctx);
    const fromFolder = await resolveProfile(folder, ctx);
    assert.equal(fromFile.loaded.profile.name, "team");
    assert.equal(fromFolder.loaded.dir, fromFile.loaded.dir);
    assert.equal(fromFile.source.display, path.join(folder, "ADE.md"));
    assert.equal((await checkTrust(ctx, fromFile)).state, "local");
  });

  test("a Git repository with an ADE.md at its root or in a subfolder loads", async () => {
    const markdown = await shared(await sampleProfile());
    const repo = await tempDir("ade-repo-");
    await fs.writeFile(path.join(repo, "ADE.md"), markdown);
    await writeText(path.join(repo, "profiles", "work", "ADE.md"), markdown);
    await writeText(path.join(repo, "README.md"), "A project.\n");
    git(repo, "init", "--quiet", "-b", "main");
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Share the setup");
    const url = pathToFileURL(repo).href;
    const ctx = contextFor(await tempDir());
    for (const input of [url, `${url}//profiles/work`, `${url}//profiles/work/ADE.md`]) {
      const resolved = await resolveProfile(input, ctx);
      assert.equal(resolved.loaded.profile.name, "team", input);
      assert.equal(resolved.source.kind, "git");
      assert.equal((await checkTrust(ctx, resolved)).state, "untrusted");
    }
  });
});

describe("ADE.md commands", () => {
  test("share, verify, import, and plan work from the CLI", async () => {
    const root = await tempDir("ade-cli-");
    const dir = await sampleProfile();
    const home = path.join(root, "home");
    await fs.mkdir(home, { recursive: true });
    const run = async (args: string[]) => {
      const io = fakeIO(root);
      const code = await runCli(args, io);
      return { code, out: io.output(), err: io.errors() };
    };
    const file = path.join(root, "ADE.md");
    assert.equal(
      (await run(["share", "--profile", dir, "--out", file, "--repo", "acme/agents"])).code,
      EXIT.ok,
    );
    assert.equal((await run(["share", "--profile", dir, "--out", file])).code, EXIT.failure);
    const before = await fs.readFile(file, "utf8");
    assert.equal(
      (await run(["share", "--profile", dir, "--out", file, "--repo", "acme/agents", "--force"]))
        .code,
      EXIT.ok,
    );
    assert.equal(await fs.readFile(file, "utf8"), before);

    const verified = await run(["verify", file]);
    assert.equal(verified.code, EXIT.ok, verified.err);
    assert.match(verified.out, /valid: \d+ files/);
    await fs.writeFile(path.join(root, "bad.md"), before.replace("# Rules", "# Changed"));
    assert.equal((await run(["verify", path.join(root, "bad.md")])).code, EXIT.failure);

    const edit = await run(["set", "pi", "defaultModel", "x", "--profile", file]);
    assert.equal(edit.code, EXIT.usage);
    assert.match(edit.err, /ADE\.md file/);

    const imported = path.join(root, "imported");
    assert.equal((await run(["import", file, "--out", imported])).code, EXIT.ok);
    assert.equal((await loadProfile(imported)).profile.name, "team");

    const planned = JSON.parse((await run(["plan", file, "--home", home, "--json"])).out) as {
      result: { summary: { create: number }; warnings: string[] };
    };
    assert.equal(planned.result.summary.create > 3, true);
    assert.equal(
      planned.result.warnings.some((warning) => warning.includes("not set: API_TOKEN")),
      true,
    );
    const applied = await run(["apply", file, "--home", home, "--yes"]);
    assert.equal(applied.code, EXIT.failure);
    assert.match(applied.err, /API_TOKEN/);
  });

  test("the install script runs the plan with an installed ade", { skip: !POSIX }, async () => {
    const bin = await tempDir("ade-bin-");
    await writeText(
      path.join(bin, "ade"),
      `#!/bin/sh\nexec "${process.execPath}" "${path.resolve("src", "cli.ts")}" "$@"\n`,
    );
    await fs.chmod(path.join(bin, "ade"), 0o755);
    const home = await tempDir("ade-home-");
    const env = {
      ...process.env,
      ADE_SKIP_INSTALL: "1",
      HOME: home,
      ADE_STATE_DIR: path.join(home, "state"),
      ADE_CACHE_DIR: path.join(home, "cache"),
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    const script = path.resolve("scripts", "install.sh");
    const bare = execFileSync("sh", [script], { encoding: "utf8", env });
    assert.match(bare, /ade is installed/);
    const file = path.join(home, "ADE.md");
    await fs.writeFile(file, await shared(await sampleProfile()));
    const planned = execFileSync("sh", [script, file], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(planned, /Plan: \d+ to create/);
    assert.match(planned, /Next: run ade apply/);
  });
});
