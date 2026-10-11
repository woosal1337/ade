import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError } from "../core/errors.ts";
import { ensureDir, isSafeRelative, statOrUndefined, tempSibling } from "../core/fsx.ts";
import { sha256 } from "../core/hash.ts";
import { type CommandRunner, runCommand } from "../secrets/resolve.ts";

const FULL_COMMIT = /^[0-9a-f]{40}$/;

export interface GitRunner {
  readonly runner: CommandRunner;
}

async function git(
  ctx: Context,
  runner: CommandRunner,
  args: readonly string[],
  action: string,
): Promise<string> {
  const result = await runner(["git", ...args], {
    env: { ...ctx.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 120_000,
  });
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
  return path.join(ctx.cacheDir, "skills", `${commit}-${sha256(subdir ?? "").slice(0, 12)}`);
}

async function hasCommit(
  ctx: Context,
  runner: CommandRunner,
  repo: string,
  commit: string,
): Promise<boolean> {
  const result = await runner(["git", "-C", repo, "cat-file", "-e", `${commit}^{commit}`], {
    env: { ...ctx.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 30_000,
  });
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
  options: { readonly allowFetch: boolean; readonly runner?: CommandRunner },
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
    throw new AdeError("not-found", `The Git skill source is not in the cache: ${request.url}.`, {
      hint: "Run the command without --offline to fetch it.",
    });
  }
  const repo = repoCacheDir(ctx, request.url);
  if (!(await statOrUndefined(path.join(repo, "HEAD")))) {
    await ensureDir(repo);
    await git(ctx, runner, ["init", "--quiet", "--bare", repo], "create the cache repository");
  }
  if (!(await hasCommit(ctx, runner, repo, request.commit))) {
    const byCommit = await runner(
      ["git", "-C", repo, "fetch", "--quiet", "--depth", "1", request.url, request.commit],
      { env: { ...ctx.env, GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 120_000 },
    );
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
        { hint: "Run `ade update` to lock a commit that exists." },
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
