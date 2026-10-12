import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Context } from "../core/context.ts";
import { encodePointer } from "../core/doc.ts";
import { AdeError, errnoCode, errorMessage } from "../core/errors.ts";
import { atomicWrite, ensureDir, listFiles, safeJoin, statOrUndefined } from "../core/fsx.ts";
import { compareText, hashValue, sha256 } from "../core/hash.ts";
import { listLeaves } from "../core/merge.ts";
import type { LoadedProfile } from "./load.ts";
import { type RiskItem, riskLines, riskSummary } from "./risk.ts";
import { isGitSkill, isLinkSkill } from "./schema.ts";
import type { ProfileSource, ResolvedProfile } from "./source.ts";

export interface TrustEntry {
  readonly display: string;
  readonly url?: string;
  readonly subdir?: string;
  readonly commit: string;
  readonly trustedAt: string;
  readonly risk: readonly string[];
  readonly entries?: Readonly<Record<string, string>>;
}

const TrustEntrySchema = z.object({
  display: z.string(),
  url: z.string().optional(),
  subdir: z.string().optional(),
  commit: z.string(),
  trustedAt: z.string(),
  risk: z.array(z.string()),
  entries: z.record(z.string(), z.string()).optional(),
});

const TrustStoreSchema = z.object({
  version: z.number(),
  sources: z.record(z.string(), TrustEntrySchema),
});

interface TrustStore {
  readonly version: number;
  readonly sources: Record<string, TrustEntry>;
}

export type TrustStatus =
  | { readonly state: "local" }
  | { readonly state: "trusted"; readonly entry: TrustEntry; readonly sameCommit: boolean }
  | { readonly state: "untrusted" }
  | {
      readonly state: "changed";
      readonly entry: TrustEntry;
      readonly added: readonly string[];
      readonly changed: readonly string[];
      readonly removed: readonly string[];
    };

const TRUST_FILE = "trust.json";
const STORE_VERSION = 2;

function trustFile(ctx: Context): string {
  return path.join(ctx.stateDir, TRUST_FILE);
}

export function trustKey(source: ProfileSource): string {
  return `${source.url ?? source.canonical}//${source.subdir ?? ""}`;
}

async function readStore(ctx: Context): Promise<TrustStore> {
  let text: string;
  try {
    text = await fs.readFile(trustFile(ctx), "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return { version: STORE_VERSION, sources: {} };
    }
    throw error;
  }
  try {
    return TrustStoreSchema.parse(JSON.parse(text)) as TrustStore;
  } catch (error) {
    throw new AdeError("parse-failed", `The trust file is not valid: ${trustFile(ctx)}.`, {
      details: [errorMessage(error)],
      hint: "Move the file away. Then trust each source again.",
      cause: error,
    });
  }
}

async function writeStore(ctx: Context, store: TrustStore): Promise<void> {
  await ensureDir(ctx.stateDir, 0o700);
  const sources = Object.fromEntries(
    Object.entries(store.sources).sort(([left], [right]) => compareText(left, right)),
  );
  await atomicWrite(
    trustFile(ctx),
    `${JSON.stringify({ version: STORE_VERSION, sources }, null, 2)}\n`,
    0o600,
  );
}

export function riskOf(resolved: ResolvedProfile): RiskItem[] {
  return riskSummary(resolved.loaded.profile, resolved.loaded.lock);
}

function executable(mode: number): string {
  return (mode & 0o111) === 0 ? "-" : "x";
}

async function contentHash(dir: string, relative: string): Promise<string> {
  const full = safeJoin(dir, relative, "the profile directory");
  const stat = await statOrUndefined(full);
  if (stat?.isFile()) {
    return `file:${sha256(await fs.readFile(full))}:${executable(stat.mode)}`;
  }
  if (stat?.isDirectory()) {
    const lines: string[] = [];
    for (const file of await listFiles(full)) {
      const item = path.join(full, ...file.split("/"));
      const itemStat = await fs.stat(item);
      lines.push(`${file} ${sha256(await fs.readFile(item))} ${executable(itemStat.mode)}`);
    }
    return `tree:${sha256(lines.join("\n"))}`;
  }
  return "missing";
}

export async function trustEntries(loaded: LoadedProfile): Promise<Record<string, string>> {
  const { profile, lock, dir } = loaded;
  const entries: Record<string, string> = {};
  const put = (key: string, value: unknown): void => {
    const hash = hashValue(value);
    if (Object.hasOwn(entries, key) && entries[key] !== hash) {
      throw new AdeError(
        "profile-invalid",
        `Two entries of the profile have the same key: ${key}.`,
        {
          hint: "Remove the duplicate entry from the profile.",
        },
      );
    }
    entries[key] = hash;
  };
  put("harnesses", { harnesses: profile.harnesses ?? null, install: profile.install ?? null });
  if (profile.instructions !== undefined) {
    put("instructions", {
      ...profile.instructions,
      content: await contentHash(dir, profile.instructions.file),
    });
  }
  for (const [name, server] of Object.entries(profile.mcp ?? {})) {
    put(`mcp:${name}`, server);
  }
  for (const [docKey, patch] of Object.entries(profile.settings ?? {})) {
    const leaves = listLeaves(patch);
    if (leaves.length === 0) {
      put(`setting:${docKey}`, patch);
    }
    for (const [pointer, value] of leaves) {
      put(`setting:${docKey}:${encodePointer(pointer)}`, value);
    }
  }
  for (const entry of profile.files ?? []) {
    put(`file:${entry.root}:${entry.target}`, {
      ...entry,
      content: entry.source === undefined ? null : await contentHash(dir, entry.source),
    });
  }
  for (const [harness, set] of Object.entries(profile.plugins ?? {})) {
    for (const [name, source] of Object.entries(set?.marketplaces ?? {})) {
      put(`plugin:${harness}:marketplace:${name}`, source);
    }
    for (const id of set?.install ?? []) {
      put(`plugin:${harness}:install:${id}`, id);
    }
  }
  for (const entry of profile.patches ?? []) {
    put(`patch:${entry.root}:${entry.target}`, {
      ...entry,
      content: await contentHash(dir, entry.source),
    });
  }
  for (const [name, source] of Object.entries(profile.secrets ?? {})) {
    put(`secret:${name}`, source);
  }
  for (const [name, skill] of Object.entries(profile.skills ?? {})) {
    if (isGitSkill(skill)) {
      put(`skill:${name}`, { ...skill, lock: lock.skills[name] ?? null });
    } else if (isLinkSkill(skill)) {
      put(`skill:${name}`, skill);
    } else {
      put(`skill:${name}`, { ...skill, content: await contentHash(dir, skill.path) });
    }
  }
  return entries;
}

export async function checkTrust(ctx: Context, resolved: ResolvedProfile): Promise<TrustStatus> {
  if (resolved.source.kind === "local") {
    return { state: "local" };
  }
  const entry = (await readStore(ctx)).sources[trustKey(resolved.source)];
  if (entry === undefined) {
    return { state: "untrusted" };
  }
  if (entry.commit === resolved.source.commit) {
    return { state: "trusted", entry, sameCommit: true };
  }
  const now = await trustEntries(resolved.loaded);
  const before = entry.entries ?? {};
  const keys = Object.keys(now).sort(compareText);
  const added = keys.filter((key) => !Object.hasOwn(before, key));
  const changed = keys.filter((key) => Object.hasOwn(before, key) && before[key] !== now[key]);
  const removed = Object.keys(before)
    .filter((key) => !Object.hasOwn(now, key))
    .sort(compareText);
  if (
    entry.entries !== undefined &&
    added.length === 0 &&
    changed.length === 0 &&
    removed.length === 0
  ) {
    return { state: "trusted", entry, sameCommit: false };
  }
  return { state: "changed", entry, added, changed, removed };
}

export async function recordTrust(ctx: Context, resolved: ResolvedProfile): Promise<TrustEntry> {
  const { source } = resolved;
  if (source.kind === "local" || source.commit === undefined) {
    throw new AdeError("usage", "A local profile needs no trust.");
  }
  const store = await readStore(ctx);
  const entry: TrustEntry = {
    display: source.display,
    ...(source.url === undefined ? {} : { url: source.url }),
    ...(source.subdir === undefined ? {} : { subdir: source.subdir }),
    commit: source.commit,
    trustedAt: ctx.now().toISOString(),
    risk: riskLines(riskOf(resolved)),
    entries: await trustEntries(resolved.loaded),
  };
  await writeStore(ctx, {
    version: STORE_VERSION,
    sources: { ...store.sources, [trustKey(source)]: entry },
  });
  return entry;
}

export async function listTrust(ctx: Context): Promise<TrustEntry[]> {
  return Object.values((await readStore(ctx)).sources);
}

export async function removeTrust(ctx: Context, source: ProfileSource): Promise<boolean> {
  const store = await readStore(ctx);
  const key = trustKey(source);
  if (!Object.hasOwn(store.sources, key)) {
    return false;
  }
  const sources = { ...store.sources };
  delete sources[key];
  await writeStore(ctx, { version: STORE_VERSION, sources });
  return true;
}
