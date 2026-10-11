import path from "node:path";
import { type Context, displayPath } from "../core/context.ts";
import { AdeError } from "../core/errors.ts";
import { statOrUndefined } from "../core/fsx.ts";
import { HARNESS_IDS, type HarnessId, ROOT_IDS, type RootId } from "../profile/schema.ts";
import {
  antigravity,
  claude,
  claudeDesktop,
  codex,
  cursor,
  gemini,
  grok,
  opencode,
  pi,
  zed,
} from "./adapters.ts";
import { cursorUserDir } from "./paths.ts";
import type { HarnessAdapter } from "./types.ts";

const adapters: Readonly<Record<HarnessId, HarnessAdapter>> = {
  claude,
  codex,
  cursor,
  grok,
  pi,
  gemini,
  opencode,
  zed,
  "claude-desktop": claudeDesktop,
  antigravity,
};

export function isHarnessId(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value);
}

export function isRootId(value: string): value is RootId {
  return (ROOT_IDS as readonly string[]).includes(value);
}

export function rootDir(ctx: Context, root: RootId): string {
  if (root === "home") {
    return ctx.home;
  }
  if (root === "cursor-user") {
    return cursorUserDir(ctx);
  }
  return getAdapter(root).home(ctx);
}

export function rootOwner(root: RootId): HarnessId | undefined {
  if (root === "home") {
    return undefined;
  }
  return root === "cursor-user" ? "cursor" : root;
}

export function listAdapters(): HarnessAdapter[] {
  return HARNESS_IDS.map((id) => adapters[id]);
}

export function getAdapter(id: HarnessId): HarnessAdapter {
  return adapters[id];
}

export function parseHarnessList(text: string): HarnessId[] {
  const ids = text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  const unknown = ids.filter((id) => !(HARNESS_IDS as readonly string[]).includes(id));
  if (unknown.length > 0 || ids.length === 0) {
    throw new AdeError("usage", `The harness name is not known: ${unknown.join(", ") || text}.`, {
      hint: `Use one or more of: ${HARNESS_IDS.join(", ")}.`,
    });
  }
  return [...new Set(ids)] as HarnessId[];
}

export interface Detection {
  readonly id: HarnessId;
  readonly label: string;
  readonly installed: boolean;
  readonly home: string;
}

export async function detectHarness(ctx: Context, id: HarnessId): Promise<Detection> {
  const adapter = getAdapter(id);
  const home = adapter.home(ctx);
  const stat = await statOrUndefined(home);
  return { id, label: adapter.label, installed: stat?.isDirectory() === true, home };
}

export async function detectHarnesses(ctx: Context): Promise<Detection[]> {
  return Promise.all(HARNESS_IDS.map((id) => detectHarness(ctx, id)));
}

export function sharedRoot(ctx: Context): string {
  return path.join(ctx.home, ".agents");
}

export function sharedSkillsDir(ctx: Context): string {
  return path.join(sharedRoot(ctx), "skills");
}

export function sharedInstructionsPath(ctx: Context): string {
  return path.join(sharedRoot(ctx), "AGENTS.md");
}

export interface SettingsKey {
  readonly root: RootId;
  readonly harness: HarnessId | undefined;
  readonly file: string | undefined;
}

export function parseSettingsKey(key: string): SettingsKey {
  const index = key.indexOf(":");
  const root = index === -1 ? key : key.slice(0, index);
  if (!isRootId(root)) {
    throw new AdeError(
      "usage",
      `The settings key does not start with a harness or root name: ${key}.`,
      {
        hint: `Use one of: ${ROOT_IDS.join(", ")}.`,
      },
    );
  }
  const file = index === -1 ? undefined : key.slice(index + 1);
  if (file === undefined && !isHarnessId(root)) {
    throw new AdeError(
      "usage",
      `The settings key ${key} needs a file, for example ${root}:settings.json.`,
    );
  }
  return { root, harness: rootOwner(root), file };
}

export function settingsKeyFor(ctx: Context, file: string): string | undefined {
  const candidates: { root: RootId; dir: string }[] = [];
  for (const root of ROOT_IDS) {
    candidates.push({ root, dir: rootDir(ctx, root) });
  }
  candidates.sort((left, right) => right.dir.length - left.dir.length);
  for (const { root, dir } of candidates) {
    const relative = path.relative(dir, file);
    if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return `${root}:${relative.split(path.sep).join("/")}`;
    }
  }
  return undefined;
}

export interface HarnessRow extends Detection {
  readonly instructions: string | undefined;
  readonly mcp: string;
  readonly settings: string;
  readonly skills: string;
}

export async function describeHarnesses(ctx: Context): Promise<HarnessRow[]> {
  return (await detectHarnesses(ctx)).map((detection) => {
    const adapter = getAdapter(detection.id);
    const skillsDir = adapter.skillsDir(ctx);
    return {
      ...detection,
      instructions: adapter.instructionsPath(ctx),
      mcp: adapter.mcpLocation(ctx).path,
      settings: adapter.settingsLocation(ctx).path,
      skills: adapter.readsSharedSkills
        ? `reads ${displayPath(ctx, sharedSkillsDir(ctx))}`
        : `links in ${displayPath(ctx, skillsDir ?? "")}`,
    };
  });
}
