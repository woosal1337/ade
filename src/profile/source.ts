import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError, errnoCode, errorMessage } from "../core/errors.ts";
import { atomicWrite, ensureDir, statOrUndefined, tempSibling } from "../core/fsx.ts";
import type { CommandRunner } from "../secrets/resolve.ts";
import { materializeGitTree, resolveGitRef } from "../skills/git.ts";
import { importBundle } from "./bundle.ts";
import { type LoadedProfile, loadProfile, PROFILE_FILE } from "./load.ts";
import { ADE_MD_FILE, parseMarkdown } from "./markdown.ts";
import { type ProfileSpec, parseProfileSpec } from "./spec.ts";

export interface ProfileSource {
  readonly kind: "local" | "git";
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

export async function loadMarkdownProfile(file: string, ctx: Context): Promise<LoadedProfile> {
  const parsed = parseMarkdown(await fs.readFile(file, "utf8"), file);
  const dir = path.join(ctx.cacheDir, "md", parsed.digest.replace(/^sha256:/, "").slice(0, 32));
  if ((await statOrUndefined(path.join(dir, PROFILE_FILE)))?.isFile()) {
    return loadProfile(dir);
  }
  await fs.rm(dir, { recursive: true, force: true });
  const staging = tempSibling(dir);
  try {
    await importBundle(parsed.bundle, staging);
    await fs.rename(staging, dir);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    if (!(await statOrUndefined(path.join(dir, PROFILE_FILE)))?.isFile()) {
      throw error;
    }
  }
  return loadProfile(dir);
}

async function loadLocation(target: string, ctx: Context, label: string): Promise<LoadedProfile> {
  const stat = await statOrUndefined(target);
  if (stat?.isFile()) {
    return loadMarkdownProfile(target, ctx);
  }
  if (stat?.isDirectory()) {
    if ((await statOrUndefined(path.join(target, PROFILE_FILE)))?.isFile()) {
      return loadProfile(target);
    }
    if ((await statOrUndefined(path.join(target, ADE_MD_FILE)))?.isFile()) {
      return loadMarkdownProfile(path.join(target, ADE_MD_FILE), ctx);
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
    const loaded = await loadLocation(spec.dir, ctx, spec.dir);
    return {
      loaded,
      source: { kind: "local", display: spec.dir, canonical: spec.dir },
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
  const loaded = await loadLocation(
    target,
    ctx,
    `${spec.display} at commit ${commit.slice(0, 12)}`,
  );
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
