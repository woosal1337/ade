import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { docFormatFor, encodePointer, formatPointer } from "../core/doc.ts";
import { AdeError, errnoCode } from "../core/errors.ts";
import { listFiles, safeJoin, statOrUndefined } from "../core/fsx.ts";
import { ABSENT, sha256 } from "../core/hash.ts";
import { applyMergePatch, listLeaves } from "../core/merge.ts";
import {
  detectHarnesses,
  getAdapter,
  parseSettingsKey,
  rootDir,
  rootOwner,
  sharedInstructionsPath,
  sharedSkillsDir,
} from "../harness/registry.ts";
import type { ResolvedMcpServer } from "../harness/types.ts";
import type { LoadedProfile } from "../profile/load.ts";
import {
  type FileEntry,
  HARNESS_IDS,
  type HarnessId,
  type InstallMode,
  type McpServer,
  type RootId,
} from "../profile/schema.ts";
import { expandUserPath, runCommand, type SecretResolver } from "../secrets/resolve.ts";
import type { SkillResolver } from "../skills/source.ts";
import { type DesiredItem, type PathWant, patchFiles, type Scope } from "./items.ts";

export interface DesiredOptions {
  readonly harnesses?: readonly HarnessId[] | undefined;
  readonly resolver: SecretResolver;
  readonly skills: SkillResolver;
  readonly copyFiles?: boolean | undefined;
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

function scopeOf(root: RootId): Scope {
  return rootOwner(root) ?? "home";
}

function rootActive(root: RootId, harnesses: readonly HarnessId[]): boolean {
  const owner = rootOwner(root);
  return owner === undefined || harnesses.includes(owner);
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
    const written = new Set<string>();
    for (const id of targetsOf(profile.instructions.harnesses)) {
      const adapter = getAdapter(id);
      const target = adapter.instructionsPath(ctx);
      if (target === undefined) {
        if (profile.instructions.harnesses?.includes(id) === true) {
          warnings.push(
            `${adapter.label} keeps user rules outside files. ade does not write them.`,
          );
        }
        continue;
      }
      if (written.has(target)) {
        skipped.add(`instructions:${id}`);
        continue;
      }
      written.add(target);
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
        if (native.value === undefined) {
          warnings.push(
            `${native.unsupported ?? `${adapter.label} cannot use this server.`} ade skips ${name}.`,
          );
          skipped.add(`mcp:${id}:${name}`);
          continue;
        }
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
    const { root, harness, file } = parseSettingsKey(docKey);
    if (!rootActive(root, harnesses)) {
      continue;
    }
    const location =
      file === undefined && harness !== undefined
        ? getAdapter(harness).settingsLocation(ctx)
        : {
            path: safeJoin(rootDir(ctx, root), file ?? "", `the ${root} root`),
            format: docFormatFor(file ?? "") ?? "json",
          };
    for (const [rawPointer, value] of listLeaves(patch)) {
      const pointer = rawPointer.map((segment) => segment.replaceAll("${home}", ctx.home));
      let desired: unknown = ABSENT;
      const secrets: string[] = [];
      if (value !== null) {
        const expanded = await options.resolver.expandDeep(value);
        desired = expanded.value;
        secrets.push(...expanded.secrets);
      }
      items.push({
        type: "doc",
        key: `setting:${docKey}:${encodePointer(rawPointer)}`,
        kind: "setting",
        scope: scopeOf(root),
        label:
          file === undefined ? formatPointer(rawPointer) : `${file}: ${formatPointer(rawPointer)}`,
        doc: location,
        pointer,
        value: desired,
        notes: [],
        secrets,
      });
    }
  }

  for (const entry of profile.files ?? []) {
    if (!rootActive(entry.root, harnesses)) {
      continue;
    }
    items.push(...(await fileItems(loaded, ctx, entry, install, options, skipped, warnings)));
  }

  for (const [id, set] of Object.entries(profile.plugins ?? {})) {
    const harness = id as HarnessId;
    const support = getAdapter(harness).plugins;
    if (!harnesses.includes(harness) || support === undefined || set === undefined) {
      continue;
    }
    if (support.settingsKey !== undefined) {
      const installed = (await support.list(ctx, runCommand)).installed;
      const location = getAdapter(harness).settingsLocation(ctx);
      for (const plugin of set.install ?? []) {
        const key = `plugin:${harness}:${plugin}`;
        if (installed[plugin] !== undefined) {
          skipped.add(key);
          continue;
        }
        items.push({
          type: "doc",
          key,
          kind: "plugin",
          scope: harness,
          label: plugin,
          doc: location,
          pointer: [support.settingsKey, plugin],
          value: true,
          notes: [`${getAdapter(harness).label} installs the ${support.noun} on its next start.`],
          secrets: [],
        });
      }
      continue;
    }
    const label = getAdapter(harness).label;
    const registry = path.join(getAdapter(harness).home(ctx), support.registryFiles[0] ?? "");
    for (const [name, source] of Object.entries(set.marketplaces ?? {})) {
      items.push({
        type: "plugin",
        key: `plugin:${harness}:marketplace:${name}`,
        kind: "plugin",
        scope: harness,
        label: `marketplace ${name}`,
        harness,
        target: "marketplace",
        id: name,
        source,
        path: registry,
        notes: [`${label} adds the marketplace from ${source}.`],
        secrets: [],
      });
    }
    for (const plugin of set.install ?? []) {
      items.push({
        type: "plugin",
        key: `plugin:${harness}:${plugin}`,
        kind: "plugin",
        scope: harness,
        label: plugin,
        harness,
        target: "plugin",
        id: plugin,
        path: registry,
        notes: [],
        secrets: [],
      });
    }
  }

  for (const entry of profile.patches ?? []) {
    if (!rootActive(entry.root, harnesses)) {
      continue;
    }
    const source = safeJoin(loaded.dir, entry.source, "the profile directory");
    const patch = await readRequired(source, "patch file");
    items.push({
      type: "patch",
      key: `patch:${entry.root}:${entry.target}`,
      kind: "patch",
      scope: scopeOf(entry.root),
      label: path.posix.basename(entry.target),
      path: safeJoin(rootDir(ctx, entry.root), entry.target, `the ${entry.root} root`),
      patch,
      hash: sha256(patch),
      files: patchFiles(patch.toString("utf8")),
      notes: [],
      secrets: [],
    });
  }

  return { items, skipped, harnesses, warnings: [...new Set(warnings)], install };
}

async function fileItems(
  loaded: LoadedProfile,
  ctx: Context,
  entry: FileEntry,
  install: "link" | "copy",
  options: DesiredOptions,
  skipped: Set<string>,
  warnings: string[],
): Promise<DesiredItem[]> {
  const root = rootDir(ctx, entry.root);
  const base = safeJoin(root, entry.target, "its target root");
  const targetKey = entry.target.replaceAll("\\", "/");
  let linkSource: string | undefined;
  if (entry.symlink !== undefined) {
    const linkTarget = expandUserPath(entry.symlink, ctx);
    const linkStat = await statOrUndefined(linkTarget);
    if (linkStat !== undefined && install === "link" && options.copyFiles !== true) {
      return [
        {
          type: "path",
          key: `file:${entry.root}:${targetKey}`,
          kind: "file",
          scope: scopeOf(entry.root),
          label: targetKey,
          path: base,
          want: { type: "symlink", target: linkTarget, dir: linkStat.isDirectory() },
          phase: 1,
          notes: [],
          secrets: [],
        },
      ];
    }
    if (entry.source === undefined) {
      if (linkStat === undefined) {
        skipped.add(`file:${entry.root}:${targetKey}`);
        warnings.push(
          `The link ${entry.root}:${targetKey} points to a path that does not exist: ${linkTarget}. ade skips it.`,
        );
        return [];
      }
      linkSource = linkTarget;
    }
  }
  const sourceBase =
    linkSource ?? safeJoin(loaded.dir, entry.source ?? "", "the profile directory");
  const stat = await statOrUndefined(sourceBase);
  if (stat === undefined) {
    throw new AdeError("not-found", `The file source does not exist: ${sourceBase}.`, {
      hint: "Create the file or correct its path in the profile.",
    });
  }
  const pairs: { source: string; target: string; key: string; label: string }[] = [];
  if (stat.isDirectory()) {
    for (const relative of await listFiles(sourceBase)) {
      pairs.push({
        source: path.join(sourceBase, ...relative.split("/")),
        target: path.join(base, ...relative.split("/")),
        key: `file:${entry.root}:${targetKey}/${relative}`,
        label: `${targetKey}/${relative}`,
      });
    }
  } else {
    pairs.push({
      source: sourceBase,
      target: base,
      key: `file:${entry.root}:${targetKey}`,
      label: targetKey,
    });
  }
  const fixedMode = entry.mode === undefined ? undefined : Number.parseInt(entry.mode, 8);
  const items: DesiredItem[] = [];
  for (const pair of pairs) {
    const raw = await readRequired(pair.source, "file source");
    const sourceMode = (await fs.stat(pair.source)).mode & 0o777;
    const secrets: string[] = [];
    let want: PathWant;
    if (entry.template === true) {
      const expanded = await options.resolver.expandString(raw.toString("utf8"));
      secrets.push(...expanded.secrets);
      want = fileWant(
        Buffer.from(expanded.value, "utf8"),
        fixedMode ?? (expanded.secrets.size > 0 ? 0o600 : sourceMode),
      );
    } else if (
      entry.link === true &&
      install === "link" &&
      options.copyFiles !== true &&
      entry.once !== true &&
      fixedMode === undefined &&
      !(await sameLocation(pair.source, pair.target))
    ) {
      want = { type: "symlink", target: pair.source, dir: false };
    } else {
      want = fileWant(raw, fixedMode ?? sourceMode);
    }
    items.push({
      type: "path",
      key: pair.key,
      kind: "file",
      scope: scopeOf(entry.root),
      label: pair.label,
      path: pair.target,
      want,
      phase: 1,
      ...(entry.once === true ? { once: true } : {}),
      notes: entry.once === true ? ["ade writes this file only when it does not exist."] : [],
      secrets,
    });
  }
  return items;
}
