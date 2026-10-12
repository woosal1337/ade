import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError, errnoCode, errorMessage } from "../core/errors.ts";
import {
  atomicWrite,
  ensureDir,
  ensurePrivateDir,
  statOrUndefined,
  tempSibling,
} from "../core/fsx.ts";
import { isSharedGitUrl } from "../core/git-input.ts";
import { sha256 } from "../core/hash.ts";
import type { CommandRunner } from "../secrets/resolve.ts";
import { materializeGitTree, resolveGitRef } from "../skills/git.ts";
import { importBundle } from "./bundle.ts";
import { type LoadedProfile, loadProfile, PROFILE_FILE } from "./load.ts";
import { ADE_MD_FILE, isMarkdownProfile, parseMarkdown } from "./markdown.ts";
import { isGitSkill, isLinkSkill } from "./schema.ts";
import { type ProfileSpec, parseProfileSpec } from "./spec.ts";

export interface ProfileSource {
  readonly kind: "local" | "git" | "file";
  readonly display: string;
  readonly canonical: string;
  readonly url?: string;
  readonly ref?: string;
  readonly subdir?: string;
  readonly commit?: string;
}

export interface ResolvedProfile {
  readonly loaded: LoadedProfile;
  readonly source: ProfileSource;
}

export interface ResolveOptions {
  readonly cwd?: string | undefined;
  readonly offline?: boolean | undefined;
  readonly runner?: CommandRunner | undefined;
}

interface FetchRecord {
  readonly commit: string;
  readonly fetchedAt: string;
}

interface SourceRecords {
  readonly version: 1;
  readonly fetched: Record<string, FetchRecord>;
}

interface Settings {
  readonly version: 1;
  readonly profile?: string;
}

const SOURCES_FILE = "sources.json";
const SETTINGS_FILE = "settings.json";

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return fallback;
    }
    throw new AdeError("parse-failed", `The file is not valid JSON: ${file}.`, {
      details: [errorMessage(error)],
      hint: "Move the file away, then run the command again.",
      cause: error,
    });
  }
}

export function sourceLabel(source: ProfileSource): string {
  return source.commit === undefined
    ? source.display
    : `${source.display} @ ${source.commit.slice(0, 12)}`;
}

export function specFor(input: string, ctx: Context, cwd = process.cwd()): ProfileSpec {
  return parseProfileSpec(input, { cwd, home: ctx.home, exists: existsSync });
}

async function cacheBundle(
  ctx: Context,
  kind: "md" | "bundles",
  digest: string,
  bundle: unknown,
): Promise<LoadedProfile> {
  await ensurePrivateDir(ctx.cacheDir);
  const dir = path.join(ctx.cacheDir, kind, digest);
  if ((await statOrUndefined(path.join(dir, PROFILE_FILE)))?.isFile()) {
    return loadProfile(dir);
  }
  await fs.rm(dir, { recursive: true, force: true });
  await ensureDir(path.dirname(dir));
  const staging = tempSibling(dir);
  try {
    await importBundle(bundle, staging);
    await fs.rename(staging, dir);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    if (!(await statOrUndefined(path.join(dir, PROFILE_FILE)))?.isFile()) {
      throw error;
    }
  }
  return loadProfile(dir);
}

interface SharedFile {
  readonly loaded: LoadedProfile;
  readonly digest: string;
}

async function loadSharedFile(file: string, ctx: Context): Promise<SharedFile> {
  const text = await fs.readFile(file, "utf8");
  if (isMarkdownProfile(text)) {
    const parsed = parseMarkdown(text, file);
    const digest = parsed.digest.replace(/^sha256:/, "");
    return { loaded: await cacheBundle(ctx, "md", digest, parsed.bundle), digest };
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new AdeError(
      "bundle-invalid",
      `The file is not an ADE.md and not a JSON bundle: ${file}.`,
      {
        cause: error,
      },
    );
  }
  const digest = sha256(text);
  return { loaded: await cacheBundle(ctx, "bundles", digest, input), digest };
}

export async function loadMarkdownProfile(file: string, ctx: Context): Promise<LoadedProfile> {
  return (await loadSharedFile(file, ctx)).loaded;
}

export function sharedProblems(loaded: LoadedProfile): string[] {
  const problems: string[] = [];
  for (const [name, skill] of Object.entries(loaded.profile.skills ?? {})) {
    if (isLinkSkill(skill)) {
      problems.push(`The skill ${name} links to the local path ${skill.link}.`);
    } else if (isGitSkill(skill) && !isSharedGitUrl(skill.git)) {
      problems.push(`The skill ${name} fetches ${skill.git}. Use an https or ssh URL.`);
    }
  }
  for (const [name, locked] of Object.entries(loaded.lock.skills)) {
    if (!isSharedGitUrl(locked.git)) {
      problems.push(`The lock entry of the skill ${name} fetches ${locked.git}.`);
    }
  }
  for (const entry of loaded.profile.files ?? []) {
    if (entry.symlink !== undefined) {
      problems.push(
        `The file ${entry.root}:${entry.target} links to the local path ${entry.symlink}.`,
      );
    }
  }
  return problems;
}

function checkShared(loaded: LoadedProfile, label: string): void {
  const problems = sharedProblems(loaded);
  if (problems.length > 0) {
    throw new AdeError(
      "profile-invalid",
      `The profile from ${label} names local paths or local repositories. ade refuses them in a shared profile.`,
      {
        details: problems,
        hint: "Ask the author to write the profile with `ade share`, which copies local files into it.",
      },
    );
  }
}

interface Located {
  readonly loaded: LoadedProfile;
  readonly file?: { readonly path: string; readonly digest: string };
}

async function loadLocation(target: string, ctx: Context, label: string): Promise<Located> {
  const stat = await statOrUndefined(target);
  if (stat?.isFile()) {
    const shared = await loadSharedFile(target, ctx);
    return { loaded: shared.loaded, file: { path: target, digest: shared.digest } };
  }
  if (stat?.isDirectory()) {
    if ((await statOrUndefined(path.join(target, PROFILE_FILE)))?.isFile()) {
      return { loaded: await loadProfile(target) };
    }
    const markdown = path.join(target, ADE_MD_FILE);
    if ((await statOrUndefined(markdown))?.isFile()) {
      const shared = await loadSharedFile(markdown, ctx);
      return { loaded: shared.loaded, file: { path: markdown, digest: shared.digest } };
    }
  }
  throw new AdeError(
    "profile-not-found",
    `${label} has no ${PROFILE_FILE} and no ${ADE_MD_FILE}.`,
    {
      hint: "Run `ade init` or `ade capture`, or give the profile with --profile. A shared repository holds an ADE.md from `ade share`.",
    },
  );
}

export async function resolveProfile(
  input: string,
  ctx: Context,
  options: ResolveOptions = {},
): Promise<ResolvedProfile> {
  const spec = specFor(input, ctx, options.cwd);
  if (spec.kind === "local") {
    const located = await loadLocation(spec.dir, ctx, spec.dir);
    if (located.file === undefined) {
      return {
        loaded: located.loaded,
        source: { kind: "local", display: spec.dir, canonical: spec.dir },
      };
    }
    checkShared(located.loaded, located.file.path);
    return {
      loaded: located.loaded,
      source: {
        kind: "file",
        display: located.file.path,
        canonical: located.file.path,
        commit: located.file.digest,
      },
    };
  }
  const markdownFile = spec.subdir?.toLowerCase().endsWith(".md")
    ? path.posix.basename(spec.subdir)
    : undefined;
  const treeSubdir =
    markdownFile === undefined
      ? spec.subdir
      : path.posix.dirname(spec.subdir as string) === "."
        ? undefined
        : path.posix.dirname(spec.subdir as string);
  const ref = spec.ref ?? "HEAD";
  const file = path.join(ctx.stateDir, SOURCES_FILE);
  const records = await readJsonFile<SourceRecords>(file, { version: 1, fetched: {} });
  const key = `${spec.url}#${ref}`;
  let commit: string;
  if (options.offline === true) {
    const record = records.fetched[key];
    if (record === undefined) {
      throw new AdeError("not-found", `ade has not fetched ${spec.display} yet.`, {
        hint: "Run the command without --offline one time.",
      });
    }
    commit = record.commit;
  } else {
    commit = await resolveGitRef(ctx, spec.url, ref, options.runner);
  }
  const dir = await materializeGitTree(
    ctx,
    { url: spec.url, ref, commit, subdir: treeSubdir },
    { allowFetch: options.offline !== true, runner: options.runner },
  );
  const target = markdownFile === undefined ? dir : path.join(dir, markdownFile);
  const { loaded } = await loadLocation(
    target,
    ctx,
    `${spec.display} at commit ${commit.slice(0, 12)}`,
  );
  checkShared(loaded, spec.display);
  if (options.offline !== true) {
    await ensureDir(ctx.stateDir, 0o700);
    await atomicWrite(
      file,
      `${JSON.stringify(
        {
          ...records,
          fetched: { ...records.fetched, [key]: { commit, fetchedAt: ctx.now().toISOString() } },
        },
        null,
        2,
      )}\n`,
      0o600,
    );
  }
  return {
    loaded,
    source: {
      kind: "git",
      display: spec.display,
      canonical: spec.canonical,
      url: spec.url,
      ref,
      ...(spec.subdir === undefined ? {} : { subdir: spec.subdir }),
      commit,
    },
  };
}

export async function readDefaultProfile(ctx: Context): Promise<string | undefined> {
  const settings = await readJsonFile<Settings>(path.join(ctx.stateDir, SETTINGS_FILE), {
    version: 1,
  });
  return settings.profile;
}

export async function writeDefaultProfile(
  ctx: Context,
  canonical: string | undefined,
): Promise<void> {
  await ensureDir(ctx.stateDir, 0o700);
  const next: Settings =
    canonical === undefined ? { version: 1 } : { version: 1, profile: canonical };
  await atomicWrite(
    path.join(ctx.stateDir, SETTINGS_FILE),
    `${JSON.stringify(next, null, 2)}\n`,
    0o600,
  );
}
