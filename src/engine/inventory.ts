import fs from "node:fs/promises";
import path from "node:path";
import { type Context, displayPath } from "../core/context.ts";
import { isInside, listFiles, lstatOrUndefined, statOrUndefined } from "../core/fsx.ts";
import { compareText } from "../core/hash.ts";
import { PI_KNOWN_ENTRIES } from "../harness/adapters.ts";
import { CREDENTIAL_NAMES, matchesAny, RUNTIME_NAMES } from "../harness/inventory-rules.ts";
import { detectHarnesses, getAdapter, rootDir } from "../harness/registry.ts";
import type { AssetRule, InventoryDir } from "../harness/types.ts";
import { HARNESS_IDS, type HarnessId, type RootId } from "../profile/schema.ts";

export const INVENTORY_STATUSES = [
  "synced",
  "extra",
  "other",
  "unknown",
  "private",
  "runtime",
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export interface InventoryRow {
  readonly harness: HarnessId;
  readonly root: RootId | undefined;
  readonly name: string;
  readonly path: string;
  readonly display: string;
  readonly kind: "file" | "dir" | "link";
  readonly status: InventoryStatus;
  readonly detail?: string;
}

export interface InventoryReport {
  readonly home: string;
  readonly harnesses: readonly HarnessId[];
  readonly rows: readonly InventoryRow[];
  readonly summary: Readonly<Record<InventoryStatus, number>>;
}

export interface InventoryOptions {
  readonly harnesses?: readonly HarnessId[] | undefined;
}

export const MAX_EXTRA_BYTES = 1024 * 1024;

export async function capturableFiles(dir: string): Promise<string[]> {
  try {
    return (await listFiles(dir)).filter(
      (relative) => !relative.split("/").some((part) => matchesAny(part, RUNTIME_NAMES)),
    );
  } catch {
    return [];
  }
}

async function onlyStateFiles(dir: string): Promise<boolean> {
  try {
    return (await listFiles(dir)).length > 0 && (await capturableFiles(dir)).length === 0;
  } catch {
    return false;
  }
}

export async function isSmallTextFile(file: string): Promise<boolean> {
  const stat = await statOrUndefined(file);
  if (!stat?.isFile() || stat.size > MAX_EXTRA_BYTES) {
    return false;
  }
  return !(await fs.readFile(file)).includes(0);
}

export async function piPackageAssets(ctx: Context): Promise<AssetRule[]> {
  const home = rootDir(ctx, "pi");
  const rules = getAdapter("pi").inventoryDirs(ctx)[0];
  let names: string[];
  try {
    names = await fs.readdir(home);
  } catch {
    return [];
  }
  const assets: AssetRule[] = [];
  for (const name of names.sort(compareText)) {
    if (
      PI_KNOWN_ENTRIES.has(name) ||
      matchesAny(name, rules?.runtime ?? []) ||
      matchesAny(name, rules?.private ?? []) ||
      matchesAny(name, RUNTIME_NAMES)
    ) {
      continue;
    }
    if ((await statOrUndefined(path.join(home, name)))?.isDirectory()) {
      assets.push({ path: name, kind: "dir" });
    }
  }
  return assets;
}

export async function syncedPaths(ctx: Context, harness: HarnessId): Promise<Map<string, string>> {
  const adapter = getAdapter(harness);
  const synced = new Map<string, string>();
  const add = (target: string | undefined, label: string): void => {
    if (target !== undefined && !synced.has(path.resolve(target))) {
      synced.set(path.resolve(target), label);
    }
  };
  add(adapter.instructionsPath(ctx), "instructions");
  add(adapter.mcpLocation(ctx).path, "MCP servers");
  add(adapter.settingsLocation(ctx).path, "settings");
  add(adapter.skillsDir(ctx), "skills");
  for (const dir of adapter.captureSkillDirs(ctx)) {
    add(dir, "skills");
  }
  const assets = [...adapter.assets, ...(harness === "pi" ? await piPackageAssets(ctx) : [])];
  for (const rule of assets) {
    add(path.join(rootDir(ctx, rule.root ?? harness), ...rule.path.split("/")), rule.path);
  }
  for (const file of adapter.plugins?.registryFiles ?? []) {
    add(path.join(adapter.home(ctx), ...file.split("/")), `${adapter.plugins?.noun ?? "plugin"}s`);
  }
  return synced;
}

async function entryKind(full: string): Promise<"file" | "dir" | "link" | undefined> {
  const link = await lstatOrUndefined(full);
  if (link === undefined) {
    return undefined;
  }
  if (link.isSymbolicLink()) {
    return "link";
  }
  return link.isDirectory() ? "dir" : "file";
}

async function classifyDir(
  ctx: Context,
  harness: HarnessId,
  inv: InventoryDir,
  synced: ReadonlyMap<string, string>,
): Promise<InventoryRow[]> {
  let names: string[];
  try {
    names = await fs.readdir(inv.dir);
  } catch {
    return [];
  }
  const rows: InventoryRow[] = [];
  for (const name of names.sort(compareText)) {
    if (name === ".DS_Store") {
      continue;
    }
    const full = path.resolve(inv.dir, name);
    const kind = await entryKind(full);
    if (kind === undefined) {
      continue;
    }
    const row = (status: InventoryStatus, detail?: string): InventoryRow => ({
      harness,
      root: inv.root,
      name,
      path: full,
      display: displayPath(ctx, full),
      kind,
      status,
      ...(detail === undefined ? {} : { detail }),
    });
    if (matchesAny(name, inv.private) || matchesAny(name, CREDENTIAL_NAMES)) {
      rows.push(row("private"));
      continue;
    }
    const exact = synced.get(full);
    if (exact !== undefined) {
      if (kind === "dir" && exact !== "skills" && (await onlyStateFiles(full))) {
        rows.push(row("runtime", "holds only state files"));
      } else {
        rows.push(row("synced", exact));
      }
      continue;
    }
    const inside = [...synced.entries()].filter(
      ([target]) => target !== full && isInside(target, full),
    );
    if (inside.length > 0) {
      rows.push(
        row(
          "synced",
          `contains ${inside.map(([target]) => path.relative(full, target).split(path.sep).join("/")).join(", ")}`,
        ),
      );
      continue;
    }
    if (matchesAny(name, inv.runtime) || matchesAny(name, RUNTIME_NAMES)) {
      rows.push(row("runtime"));
      continue;
    }
    const other = inv.other?.[name];
    if (other !== undefined) {
      rows.push(row("other", `belongs to ${other}`));
      continue;
    }
    if (kind === "dir" && (await onlyStateFiles(full))) {
      rows.push(row("runtime", "holds only state files"));
      continue;
    }
    if (inv.root !== undefined && kind !== "dir" && (await isSmallTextFile(full))) {
      rows.push(row("extra", "ade captures it as an extra file"));
      continue;
    }
    rows.push(
      row("unknown", kind === "dir" ? "ade has no rule for this folder" : "binary or large file"),
    );
  }
  return rows;
}

function emptySummary(): Record<InventoryStatus, number> {
  return { synced: 0, extra: 0, other: 0, unknown: 0, private: 0, runtime: 0 };
}

export async function inventory(
  ctx: Context,
  options: InventoryOptions = {},
): Promise<InventoryReport> {
  const detections = await detectHarnesses(ctx);
  const harnesses = HARNESS_IDS.filter(
    (id) =>
      detections.find((item) => item.id === id)?.installed === true &&
      (options.harnesses === undefined || options.harnesses.includes(id)),
  );
  const rows: InventoryRow[] = [];
  const seen = new Set<string>();
  for (const harness of harnesses) {
    const synced = await syncedPaths(ctx, harness);
    for (const inv of getAdapter(harness).inventoryDirs(ctx)) {
      for (const row of await classifyDir(ctx, harness, inv, synced)) {
        if (!seen.has(row.path)) {
          seen.add(row.path);
          rows.push(row);
        }
      }
    }
  }
  const summary = emptySummary();
  for (const row of rows) {
    summary[row.status] += 1;
  }
  return { home: ctx.home, harnesses, rows, summary };
}
