import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { AdeError } from "../src/core/errors.ts";
import { isSafeRelative } from "../src/core/fsx.ts";
import { ProfileSchema } from "../src/profile/schema.ts";
import { materializeGitTree, resolveGitRef, treeCacheDir } from "../src/skills/git.ts";
import { contextFor, POSIX, tempDir, testGitEnv, writeText } from "./helpers.ts";

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
