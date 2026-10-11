import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError, errnoCode } from "../core/errors.ts";
import { ensureDir, isSafeRelative, statOrUndefined, tempSibling } from "../core/fsx.ts";
import { sha256 } from "../core/hash.ts";
import { type CommandResult, type CommandRunner, runCommand } from "../secrets/resolve.ts";

export const FULL_COMMIT = /^[0-9a-f]{40}$/;

export const GIT_LOCAL_VARIABLES = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
] as const;

export function isolatedGitEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { ...env, GIT_TERMINAL_PROMPT: "0" };
  for (const name of Object.keys(result)) {
    if (
      (GIT_LOCAL_VARIABLES as readonly string[]).includes(name) ||
      /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)
    ) {
      delete result[name];
    }
  }
  return result;
}

async function runGit(
  ctx: Context,
  runner: CommandRunner,
  args: readonly string[],
  timeoutMs = 120_000,
): Promise<CommandResult> {
  try {
    return await runner(["git", ...args], { env: isolatedGitEnv(ctx.env), timeoutMs });
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      throw new AdeError("git-failed", "Git is not installed, or it is not on the PATH.", {
        hint: "Install Git, then run the command again.",
      });
    }
    throw error;
  }
}

async function git(
  ctx: Context,
  runner: CommandRunner,
  args: readonly string[],
  action: string,
): Promise<string> {
  const result = await runGit(ctx, runner, args);
  if (result.code !== 0) {
    throw new AdeError("git-failed", `Git could not ${action}.`, {
      details: result.stderr.trim() === "" ? [] : [result.stderr.trim().split("\n")[0] ?? ""],
      hint: "Make sure that Git can reach the repository, then run the command again.",
    });
  }
  return result.stdout;
}

export async function resolveGitRef(
  ctx: Context,
  url: string,
  ref: string,
  runner: CommandRunner = runCommand,
): Promise<string> {
  if (FULL_COMMIT.test(ref)) {
    return ref;
  }
  const output = await git(ctx, runner, ["ls-remote", url, ref], `read the ref ${ref} from ${url}`);
  const lines = output
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 2 && FULL_COMMIT.test(parts[0] ?? ""));
  const peeled = lines.find((parts) => parts[1]?.endsWith("^{}"));
  const chosen = peeled ?? lines[0];
  if (chosen?.[0] === undefined) {
    throw new AdeError("git-failed", `The repository has no ref ${ref}: ${url}.`, {
      hint: "Use a branch, a tag, or a full commit hash that exists.",
    });
  }
  return chosen[0];
}

function repoCacheDir(ctx: Context, url: string): string {
  return path.join(ctx.cacheDir, "git", sha256(url).slice(0, 24));
}

export function treeCacheDir(ctx: Context, commit: string, subdir: string | undefined): string {
  return path.join(ctx.cacheDir, "trees", `${commit}-${sha256(subdir ?? "").slice(0, 12)}`);
}

async function hasCommit(
  ctx: Context,
  runner: CommandRunner,
  repo: string,
  commit: string,
): Promise<boolean> {
  const result = await runGit(
    ctx,
    runner,
    ["-C", repo, "cat-file", "-e", `${commit}^{commit}`],
    30_000,
  );
  return result.code === 0;
}

export interface GitTreeRequest {
  readonly url: string;
  readonly ref: string;
  readonly commit: string;
  readonly subdir?: string | undefined;
}

export async function materializeGitTree(
  ctx: Context,
  request: GitTreeRequest,
  options: { readonly allowFetch: boolean; readonly runner?: CommandRunner | undefined },
): Promise<string> {
  const runner = options.runner ?? runCommand;
  if (request.subdir !== undefined && !isSafeRelative(request.subdir)) {
    throw new AdeError(
      "path-outside-root",
      `The Git subdirectory is not valid: ${request.subdir}.`,
    );
  }
  const output = treeCacheDir(ctx, request.commit, request.subdir);
  const tree = path.join(output, "tree");
  if ((await statOrUndefined(tree))?.isDirectory()) {
    return tree;
  }
  if (!options.allowFetch) {
    throw new AdeError("not-found", `The Git source is not in the cache: ${request.url}.`, {
      hint: "Run the command without --offline to fetch it.",
    });
  }
  const repo = repoCacheDir(ctx, request.url);
  if (!(await statOrUndefined(path.join(repo, "HEAD")))) {
    await ensureDir(repo);
    await git(ctx, runner, ["init", "--quiet", "--bare", repo], "create the cache repository");
  }
  if (!(await hasCommit(ctx, runner, repo, request.commit))) {
    const byCommit = await runGit(ctx, runner, [
      "-C",
      repo,
      "fetch",
      "--quiet",
      "--depth",
      "1",
      request.url,
      request.commit,
    ]);
    if (byCommit.code !== 0 || !(await hasCommit(ctx, runner, repo, request.commit))) {
      await git(
        ctx,
        runner,
        ["-C", repo, "fetch", "--quiet", request.url, request.ref],
        `fetch ${request.ref} from ${request.url}`,
      );
    }
    if (!(await hasCommit(ctx, runner, repo, request.commit))) {
      throw new AdeError(
        "git-failed",
        `The commit ${request.commit} is not reachable from ${request.url}.`,
        { hint: "Use a ref that exists in the repository, then run the command again." },
      );
    }
  }
  const staging = tempSibling(output);
  await ensureDir(staging);
  try {
    await git(
      ctx,
      runner,
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.eol=lf",
        "--git-dir",
        repo,
        "--work-tree",
        staging,
        "checkout",
        "--force",
        request.commit,
        "--",
        request.subdir ?? ".",
      ],
      `check out ${request.commit}`,
    );
    const source = request.subdir === undefined ? staging : path.join(staging, request.subdir);
    if (!(await statOrUndefined(source))?.isDirectory()) {
      throw new AdeError(
        "not-found",
        `The repository has no directory ${request.subdir ?? "."} at ${request.commit}.`,
      );
    }
    await ensureDir(output);
    await fs.rename(source, tree);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return tree;
}
