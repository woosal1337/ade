import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError, errnoCode, errorMessage } from "../core/errors.ts";
import { atomicWrite, ensureDir, statOrUndefined } from "../core/fsx.ts";
import type { CommandRunner } from "../secrets/resolve.ts";
import { materializeGitTree, resolveGitRef } from "../skills/git.ts";
import { type LoadedProfile, loadProfile, PROFILE_FILE } from "./load.ts";
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

export async function resolveProfile(
  input: string,
  ctx: Context,
  options: ResolveOptions = {},
): Promise<ResolvedProfile> {
  const spec = specFor(input, ctx, options.cwd);
  if (spec.kind === "local") {
    const loaded = await loadProfile(spec.dir);
    return {
      loaded,
      source: { kind: "local", display: loaded.dir, canonical: loaded.dir },
    };
  }
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
    { url: spec.url, ref, commit, subdir: spec.subdir },
    { allowFetch: options.offline !== true, runner: options.runner },
  );
  if (!(await statOrUndefined(path.join(dir, PROFILE_FILE)))?.isFile()) {
    throw new AdeError(
      "profile-not-found",
      `${spec.display} has no ${PROFILE_FILE} at commit ${commit.slice(0, 12)}.`,
      {
        hint: "The repository must hold an ade profile. Its owner can write one with `ade pack`.",
      },
    );
  }
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
  const loaded = await loadProfile(dir);
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
