import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError, errnoCode, errorMessage } from "../core/errors.ts";
import { atomicWrite, ensureDir } from "../core/fsx.ts";
import { compareText } from "../core/hash.ts";
import { type RiskItem, riskLines, riskSummary } from "./risk.ts";
import type { ProfileSource, ResolvedProfile } from "./source.ts";

export interface TrustEntry {
  readonly display: string;
  readonly url: string;
  readonly subdir?: string;
  readonly commit: string;
  readonly trustedAt: string;
  readonly risk: readonly string[];
}

interface TrustStore {
  readonly version: 1;
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
      readonly removed: readonly string[];
    };

const TRUST_FILE = "trust.json";

function trustFile(ctx: Context): string {
  return path.join(ctx.stateDir, TRUST_FILE);
}

export function trustKey(source: ProfileSource): string {
  return `${source.url ?? source.canonical}//${source.subdir ?? ""}`;
}

async function readStore(ctx: Context): Promise<TrustStore> {
  try {
    return JSON.parse(await fs.readFile(trustFile(ctx), "utf8")) as TrustStore;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return { version: 1, sources: {} };
    }
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
  await atomicWrite(trustFile(ctx), `${JSON.stringify({ version: 1, sources }, null, 2)}\n`, 0o600);
}

export function riskOf(resolved: ResolvedProfile): RiskItem[] {
  return riskSummary(resolved.loaded.profile);
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
  const now = riskLines(riskOf(resolved));
  const before = new Set(entry.risk);
  const after = new Set(now);
  const added = now.filter((line) => !before.has(line));
  const removed = entry.risk.filter((line) => !after.has(line));
  if (added.length === 0 && removed.length === 0) {
    return { state: "trusted", entry, sameCommit: false };
  }
  return { state: "changed", entry, added, removed };
}

export async function recordTrust(ctx: Context, resolved: ResolvedProfile): Promise<TrustEntry> {
  const { source } = resolved;
  if (source.kind === "local" || source.url === undefined || source.commit === undefined) {
    throw new AdeError("usage", "A local profile needs no trust.");
  }
  const store = await readStore(ctx);
  const entry: TrustEntry = {
    display: source.display,
    url: source.url,
    ...(source.subdir === undefined ? {} : { subdir: source.subdir }),
    commit: source.commit,
    trustedAt: ctx.now().toISOString(),
    risk: riskLines(riskOf(resolved)),
  };
  await writeStore(ctx, { version: 1, sources: { ...store.sources, [trustKey(source)]: entry } });
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
  await writeStore(ctx, { version: 1, sources });
  return true;
}
