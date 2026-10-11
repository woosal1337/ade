import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { docFormatFor, encodePointer, formatPointer } from "../core/doc.ts";
import { AdeError, errnoCode } from "../core/errors.ts";
import { safeJoin } from "../core/fsx.ts";
import { ABSENT, sha256 } from "../core/hash.ts";
import { applyMergePatch, listLeaves } from "../core/merge.ts";
import {
  detectHarnesses,
  getAdapter,
  parseSettingsKey,
  sharedInstructionsPath,
  sharedSkillsDir,
} from "../harness/registry.ts";
import type { ResolvedMcpServer } from "../harness/types.ts";
import type { LoadedProfile } from "../profile/load.ts";
import {
  HARNESS_IDS,
  type HarnessId,
  type InstallMode,
  type McpServer,
} from "../profile/schema.ts";
import type { SecretResolver } from "../secrets/resolve.ts";
import type { SkillResolver } from "../skills/source.ts";
import type { DesiredItem, PathWant, Scope } from "./items.ts";

export interface DesiredOptions {
  readonly harnesses?: readonly HarnessId[] | undefined;
  readonly resolver: SecretResolver;
  readonly skills: SkillResolver;
}

export interface DesiredState {
  readonly items: DesiredItem[];
  readonly skipped: ReadonlySet<string>;
  readonly harnesses: HarnessId[];
  readonly warnings: string[];
  readonly install: "link" | "copy";
}

export function resolveInstallMode(
  mode: InstallMode | undefined,
  platform: NodeJS.Platform,
): "link" | "copy" {
  if (mode === "link" || mode === "copy") {
    return mode;
  }
  return platform === "win32" ? "copy" : "link";
}

export async function activeHarnesses(
  loaded: LoadedProfile,
  ctx: Context,
  filter?: readonly HarnessId[],
): Promise<{ harnesses: HarnessId[]; warnings: string[] }> {
  const warnings: string[] = [];
  const detections = await detectHarnesses(ctx);
  let base: HarnessId[];
  if (loaded.profile.harnesses !== undefined) {
    base = [...loaded.profile.harnesses];
    for (const id of base) {
      if (detections.find((item) => item.id === id)?.installed !== true) {
        warnings.push(
          `${getAdapter(id).label} is not installed in this home. ade writes its files.`,
        );
      }
    }
  } else {
    base = detections.filter((item) => item.installed).map((item) => item.id);
  }
  if (filter !== undefined) {
    for (const id of filter) {
      if (!base.includes(id)) {
        warnings.push(`The profile does not target ${id}. ade skips it.`);
      }
    }
  }
  const selected = filter === undefined ? base : base.filter((id) => filter.includes(id));
  return { harnesses: HARNESS_IDS.filter((id) => selected.includes(id)), warnings };
}

function fileWant(content: Buffer, mode: number | undefined): PathWant {
  return { type: "file", content, mode, hash: sha256(content) };
}

async function readRequired(file: string, label: string): Promise<Buffer> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      throw new AdeError("not-found", `The ${label} does not exist: ${file}.`, {
        hint: "Create the file or correct its path in the profile.",
      });
    }
    throw error;
  }
}

async function sameLocation(source: string, target: string): Promise<boolean> {
  try {
    const sourceReal = await fs.realpath(source);
    const targetParent = await fs.realpath(path.dirname(target));
    return sourceReal === path.join(targetParent, path.basename(target));
  } catch {
    return false;
  }
}

function baseServer(server: McpServer): ResolvedMcpServer {
  const copy: Record<string, unknown> = { ...server };
  delete copy.harnesses;
  delete copy.overrides;
  return copy as ResolvedMcpServer;
}

export async function buildDesired(
  loaded: LoadedProfile,
  ctx: Context,
  options: DesiredOptions,
): Promise<DesiredState> {
  const { profile } = loaded;
  const { harnesses, warnings } = await activeHarnesses(loaded, ctx, options.harnesses);
  const install = resolveInstallMode(profile.install, ctx.platform);
  const items: DesiredItem[] = [];
  const skipped = new Set<string>();
  const targetsOf = (list: readonly HarnessId[] | undefined): HarnessId[] =>
    list === undefined ? harnesses : harnesses.filter((id) => list.includes(id));

  if (profile.instructions !== undefined) {
    const source = safeJoin(loaded.dir, profile.instructions.file, "the profile directory");
    const content = await readRequired(source, "instructions file");
    const shared = sharedInstructionsPath(ctx);
    items.push({
      type: "path",
      key: "instructions:shared",
      kind: "instructions",
      scope: "shared",
      label: path.basename(shared),
      path: shared,
      want: fileWant(content, undefined),
      phase: 0,
      notes: [],
      secrets: [],
    });
    for (const id of targetsOf(profile.instructions.harnesses)) {
      const adapter = getAdapter(id);
      const target = adapter.instructionsPath(ctx);
      if (target === undefined) {
        if (profile.instructions.harnesses?.includes(id) === true) {
          warnings.push(
            `${adapter.label} keeps user rules in its account. ade does not write them.`,
          );
        }
        continue;
      }
      items.push({
        type: "path",
        key: `instructions:${id}`,
        kind: "instructions",
        scope: id,
        label: path.basename(target),
        path: target,
        want:
          install === "link"
            ? { type: "symlink", target: shared, dir: false }
            : fileWant(content, undefined),
        phase: 1,
        notes: [],
        secrets: [],
      });
    }
  }

  for (const [name, skill] of Object.entries(profile.skills ?? {})) {
    const source = await options.skills.resolve(name, skill);
    const sharedPath = path.join(sharedSkillsDir(ctx), name);
    if (source.missing) {
      warnings.push(
        `The skill ${name} links to a path that does not exist: ${source.dir}. ade skips it.`,
      );
      skipped.add(`skill:shared:${name}`);
      for (const id of harnesses) {
        skipped.add(`skill:${id}:${name}`);
      }
      continue;
    }
    items.push({
      type: "path",
      key: `skill:shared:${name}`,
      kind: "skill",
      scope: "shared",
      label: name,
      path: sharedPath,
      want: source.linked
        ? { type: "symlink", target: source.dir, dir: true }
        : { type: "dir", source: source.dir, hash: source.hash },
      phase: 0,
      notes: [],
      secrets: [],
    });
    for (const id of targetsOf(skill.harnesses)) {
      const adapter = getAdapter(id);
      const dir = adapter.skillsDir(ctx);
      if (adapter.readsSharedSkills || dir === undefined) {
        continue;
      }
      items.push({
        type: "path",
        key: `skill:${id}:${name}`,
        kind: "skill",
        scope: id,
        label: name,
        path: path.join(dir, name),
        want:
          install === "link"
            ? { type: "symlink", target: sharedPath, dir: true }
            : { type: "dir", source: source.dir, hash: source.hash },
        phase: 1,
        notes: [],
        secrets: [],
      });
    }
  }

  for (const [name, server] of Object.entries(profile.mcp ?? {})) {
    for (const id of targetsOf(server.harnesses)) {
      const adapter = getAdapter(id);
      const location = adapter.mcpLocation(ctx);
      const notes: string[] = [];
      const secrets = new Set<string>();
      let value: unknown = ABSENT;
      if (server.enabled === false && !adapter.supportsMcpEnabled) {
        notes.push(
          `${adapter.label} has no enabled flag. ade removes the disabled server from it.`,
        );
      } else {
        const expanded = await options.resolver.expandDeep(baseServer(server));
        for (const secret of expanded.secrets) {
          secrets.add(secret);
        }
        const native = adapter.toNativeMcp(expanded.value);
        if (native.dropped.length > 0) {
          notes.push(`${adapter.label} does not use: ${native.dropped.join(", ")}.`);
        }
        value = native.value;
        const override = server.overrides?.[id];
        if (override !== undefined) {
          const expandedOverride = await options.resolver.expandDeep(override);
          for (const secret of expandedOverride.secrets) {
            secrets.add(secret);
          }
          value = applyMergePatch(value, expandedOverride.value);
        }
      }
      items.push({
        type: "doc",
        key: `mcp:${id}:${name}`,
        kind: "mcp",
        scope: id,
        label: name,
        doc: { path: location.path, format: location.format },
        pointer: [...location.pointer, name],
        value,
        notes,
        secrets: [...secrets],
      });
    }
  }

  for (const [docKey, patch] of Object.entries(profile.settings ?? {})) {
    const { harness, file } = parseSettingsKey(docKey);
    if (!harnesses.includes(harness)) {
      continue;
    }
    const adapter = getAdapter(harness);
    const location =
      file === undefined
        ? adapter.settingsLocation(ctx)
        : {
            path: safeJoin(adapter.home(ctx), file, `the ${adapter.label} home`),
            format: docFormatFor(file) ?? "json",
          };
    for (const [pointer, value] of listLeaves(patch)) {
      let desired: unknown = ABSENT;
      const secrets: string[] = [];
      if (value !== null) {
        const expanded = await options.resolver.expandDeep(value);
        desired = expanded.value;
        secrets.push(...expanded.secrets);
      }
      items.push({
        type: "doc",
        key: `setting:${docKey}:${encodePointer(pointer)}`,
        kind: "setting",
        scope: harness,
        label: file === undefined ? formatPointer(pointer) : `${file}: ${formatPointer(pointer)}`,
        doc: location,
        pointer,
        value: desired,
        notes: [],
        secrets,
      });
    }
  }

  for (const entry of profile.files ?? []) {
    let root: string;
    let scope: Scope;
    if (entry.root === "home") {
      root = ctx.home;
      scope = "home";
    } else {
      if (!harnesses.includes(entry.root)) {
        continue;
      }
      root = getAdapter(entry.root).home(ctx);
      scope = entry.root;
    }
    const target = safeJoin(root, entry.target, "its target root");
    const source = safeJoin(loaded.dir, entry.source, "the profile directory");
    const raw = await readRequired(source, "file source");
    const mode = entry.mode === undefined ? undefined : Number.parseInt(entry.mode, 8);
    const secrets: string[] = [];
    let want: PathWant;
    if (entry.template === true) {
      const expanded = await options.resolver.expandString(raw.toString("utf8"));
      secrets.push(...expanded.secrets);
      want = fileWant(
        Buffer.from(expanded.value, "utf8"),
        mode ?? (expanded.secrets.size > 0 ? 0o600 : undefined),
      );
    } else if (install === "link" && mode === undefined && !(await sameLocation(source, target))) {
      want = { type: "symlink", target: source, dir: false };
    } else {
      want = fileWant(raw, mode);
    }
    items.push({
      type: "path",
      key: `file:${entry.root}:${entry.target.replaceAll("\\", "/")}`,
      kind: "file",
      scope,
      label: entry.target,
      path: target,
      want,
      phase: 1,
      notes: [],
      secrets,
    });
  }

  return { items, skipped, harnesses, warnings: [...new Set(warnings)], install };
}
