import path from "node:path";
import { type Context, displayPath } from "../core/context.ts";
import { type DocFormat, docFormatFor, getAt, type LoadedDoc, loadDoc } from "../core/doc.ts";
import { inspectPath, type PathState, pathStateHash } from "../core/fsx.ts";
import { ABSENT, type Absent, compareText, hashValue, sha256 } from "../core/hash.ts";
import { getAdapter } from "../harness/registry.ts";
import type { LoadedProfile } from "../profile/load.ts";
import type { HarnessId } from "../profile/schema.ts";
import {
  type CommandRunner,
  createSecretResolver,
  runCommand,
  type SecretResolver,
} from "../secrets/resolve.ts";
import { createSkillResolver } from "../skills/source.ts";
import { buildDesired } from "./desired.ts";
import { ExternalProbe, type PatchState, type PluginOp, undoOf } from "./external.ts";
import type { DesiredItem, ItemKind, PatchItem, PathWant, PluginItem, Scope } from "./items.ts";
import { readState, type State, type StateItem } from "./state.ts";

export type Action = "create" | "update" | "delete" | "noop" | "adopt" | "forget";

export interface Change {
  readonly key: string;
  readonly kind: ItemKind;
  readonly scope: Scope;
  readonly label: string;
  readonly action: Action;
  readonly path: string;
  readonly writesThrough?: string;
  readonly before?: string;
  readonly after?: string;
  readonly drift: boolean;
  readonly notes: readonly string[];
}

export interface PlanSummary {
  readonly create: number;
  readonly update: number;
  readonly delete: number;
  readonly noop: number;
  readonly adopt: number;
  readonly forget: number;
  readonly drift: number;
}

export interface Plan {
  readonly schemaVersion: 1;
  readonly profileDir: string;
  readonly home: string;
  readonly stateDir: string;
  readonly harnesses: readonly HarnessId[];
  readonly install: "link" | "copy";
  readonly changes: readonly Change[];
  readonly warnings: readonly string[];
  readonly summary: PlanSummary;
  readonly fingerprint: string;
}

export interface PlanOptions {
  readonly harnesses?: readonly HarnessId[] | undefined;
  readonly force?: boolean | undefined;
  readonly offline?: boolean | undefined;
  readonly resolver?: SecretResolver | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly copyFiles?: boolean | undefined;
  readonly fetchSkills?: boolean | undefined;
}

export interface DocEdit {
  readonly key: string;
  readonly pointer: readonly string[];
  readonly value: unknown | Absent;
  readonly currentHash: string;
}

export interface DocStep {
  readonly path: string;
  readonly realPath: string;
  readonly format: DocFormat;
  readonly edits: DocEdit[];
  secret: boolean;
}

export interface PathStep {
  readonly key: string;
  readonly path: string;
  readonly action: "create" | "update" | "delete";
  readonly want: PathWant | undefined;
  readonly currentHash: string;
  readonly phase: number;
}

export interface PluginStep {
  readonly key: string;
  readonly target: "marketplace" | "plugin";
  readonly action: "create" | "update" | "delete";
  readonly ops: readonly PluginOp[];
  readonly undo: readonly PluginOp[];
}

export interface PatchStep {
  readonly key: string;
  readonly action: "create" | "delete";
  readonly dir: string;
  readonly file: string;
  readonly files: readonly string[];
}

export interface StateUpdate {
  readonly key: string;
  readonly item: StateItem | undefined;
}

export interface ComputedPlan {
  readonly plan: Plan;
  readonly docSteps: DocStep[];
  readonly pathSteps: PathStep[];
  readonly pluginSteps: PluginStep[];
  readonly patchSteps: PatchStep[];
  readonly stateUpdates: StateUpdate[];
  readonly state: State;
  readonly resolver: SecretResolver;
  readonly runner: CommandRunner;
}

export function isWriteAction(action: Action): action is "create" | "update" | "delete" {
  return action === "create" || action === "update" || action === "delete";
}

export function wantHash(want: PathWant): string {
  switch (want.type) {
    case "symlink":
      return `link:${path.resolve(want.target)}`;
    case "file":
      return `file:${want.hash}`;
    case "dir":
      return `dir:${want.hash}`;
  }
}

interface Decision {
  readonly action: Action;
  readonly drift: boolean;
}

function decide(
  currentHash: string,
  desiredHash: string,
  priorHash: string | undefined,
  currentAbsent: boolean,
  desiredAbsent: boolean,
): Decision {
  if (currentHash === desiredHash) {
    return { action: priorHash === desiredHash ? "noop" : "adopt", drift: false };
  }
  const drift = priorHash !== undefined && priorHash !== currentHash;
  if (desiredAbsent) {
    return { action: "delete", drift };
  }
  return { action: currentAbsent ? "create" : "update", drift };
}

function compact(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function maskDeep(value: unknown, mask: (text: string) => string): unknown {
  if (typeof value === "string") {
    return mask(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskDeep(item, mask));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [mask(key), maskDeep(item, mask)]),
    );
  }
  return value;
}

function describePathState(ctx: Context, state: PathState): string | undefined {
  switch (state.type) {
    case "absent":
      return undefined;
    case "file":
      return `file, ${state.size} bytes`;
    case "symlink":
      return `link to ${displayPath(ctx, state.target)}`;
    case "dir":
      return "directory";
    case "other":
      return "special file";
  }
}

function describeWant(ctx: Context, want: PathWant): string {
  switch (want.type) {
    case "symlink":
      return `link to ${displayPath(ctx, want.target)}`;
    case "file":
      return `file, ${want.content.length} bytes`;
    case "dir":
      return `copy of ${displayPath(ctx, want.source)}`;
  }
}

function emptySummary(): Record<keyof PlanSummary, number> {
  return { create: 0, update: 0, delete: 0, noop: 0, adopt: 0, forget: 0, drift: 0 };
}

export async function computePlan(
  loaded: LoadedProfile,
  ctx: Context,
  options: PlanOptions = {},
): Promise<ComputedPlan> {
  const resolver = options.resolver ?? createSecretResolver(loaded.profile, ctx, options.runner);
  const skills = createSkillResolver(loaded, ctx, {
    allowFetch: options.offline !== true && options.fetchSkills !== false,
    ...(options.runner === undefined ? {} : { runner: options.runner }),
  });
  const desired = await buildDesired(loaded, ctx, {
    harnesses: options.harnesses,
    resolver,
    skills,
    copyFiles: options.copyFiles,
    skipUnfetchedSkills: options.fetchSkills === false,
  });
  const state = await readState(ctx.stateDir);
  const now = ctx.now().toISOString();
  const runner = options.runner ?? runCommand;
  const probe = new ExternalProbe(ctx, runner);
  const pluginSteps: PluginStep[] = [];
  const patchSteps: PatchStep[] = [];
  const extraWarnings: string[] = [];
  const unavailable = new Set<string>();
  const docs = new Map<string, LoadedDoc>();
  const loadCached = async (file: string, format: DocFormat): Promise<LoadedDoc> => {
    const cached = docs.get(file);
    if (cached !== undefined) {
      return cached;
    }
    const doc = await loadDoc(file, format);
    docs.set(file, doc);
    return doc;
  };
  const docSteps = new Map<string, DocStep>();
  const addEdit = (doc: LoadedDoc, edit: DocEdit, secret: boolean): void => {
    let step = docSteps.get(doc.realPath);
    if (step === undefined) {
      step = { path: doc.path, realPath: doc.realPath, format: doc.format, edits: [], secret };
      docSteps.set(doc.realPath, step);
    }
    step.edits.push(edit);
    step.secret = step.secret || secret;
  };
  const changes: Change[] = [];
  const fingerprintLines: string[] = [];
  const pathSteps: PathStep[] = [];
  const stateUpdates: StateUpdate[] = [];
  const summary = emptySummary();
  const record = (change: Change, desiredHash: string, currentHash: string): void => {
    changes.push(change);
    summary[change.action] += 1;
    if (change.drift) {
      summary.drift += 1;
    }
    if (change.action !== "noop") {
      fingerprintLines.push(`${change.key}\t${change.action}\t${desiredHash}\t${currentHash}`);
    }
  };
  const mask = (text: string | undefined): string | undefined =>
    text === undefined ? undefined : resolver.mask(text);
  const show = (value: unknown): string | undefined =>
    mask(compact(maskDeep(value, (text) => resolver.mask(text))));

  const desiredKeys = new Set(desired.items.map((item) => item.key));
  for (const item of desired.items) {
    await planDesiredItem(item);
  }

  async function planPluginItem(item: PluginItem): Promise<void> {
    const prior = state.items[item.key];
    const { available, list } = await probe.plugins(item.harness);
    const adapter = getAdapter(item.harness);
    if (!available) {
      const program = adapter.plugins?.program ?? item.harness;
      if (!unavailable.has(item.harness)) {
        unavailable.add(item.harness);
        extraWarnings.push(
          `${program} is not on the PATH. ade cannot install ${adapter.label} ${adapter.plugins?.noun ?? "plugin"}s here.`,
        );
      }
      return;
    }
    const current =
      item.target === "marketplace" ? list.marketplaces[item.id] : list.installed[item.id];
    const replaced =
      current === undefined && item.target !== "marketplace"
        ? Object.keys(list.installed)
            .sort(compareText)
            .find((key) => adapter.plugins?.replaces?.(item.id, key) === true)
        : undefined;
    const currentHash =
      current === undefined
        ? replaced === undefined
          ? "absent"
          : `replaces:${replaced}`
        : item.target === "marketplace"
          ? `marketplace:${current}`
          : "present";
    const desiredHash =
      item.target === "marketplace" ? `marketplace:${item.source ?? ""}` : "present";
    const decision = decide(
      currentHash,
      desiredHash,
      prior?.hash,
      current === undefined && replaced === undefined,
      false,
    );
    record(
      {
        key: item.key,
        kind: item.kind,
        scope: item.scope,
        label: item.label,
        action: decision.action,
        path: item.path,
        ...(current === undefined
          ? replaced === undefined
            ? {}
            : { before: replaced }
          : { before: item.target === "marketplace" ? current : "installed" }),
        after: item.target === "marketplace" ? (item.source ?? "") : "installed",
        drift: decision.drift,
        notes: item.notes,
      },
      desiredHash,
      currentHash,
    );
    if (isWriteAction(decision.action) && decision.action !== "delete") {
      const ops: PluginOp[] =
        item.target === "marketplace"
          ? [
              ...(current === undefined
                ? []
                : [{ harness: item.harness, op: "removeMarketplace" as const, id: item.id }]),
              {
                harness: item.harness,
                op: "addMarketplace",
                id: item.id,
                source: item.source ?? "",
              },
            ]
          : [{ harness: item.harness, op: "install", id: item.id }];
      const last = ops[ops.length - 1] as PluginOp;
      pluginSteps.push({
        key: item.key,
        target: item.target,
        action: decision.action,
        ops,
        undo:
          replaced === undefined
            ? undoOf(last, current)
            : [
                { harness: item.harness, op: "uninstall", id: item.id },
                { harness: item.harness, op: "install", id: replaced },
              ],
      });
    }
    if (decision.action !== "noop") {
      stateUpdates.push({
        key: item.key,
        item: {
          kind: item.kind,
          scope: item.scope,
          path: item.path,
          hash: desiredHash,
          appliedAt: now,
          meta: {
            harness: item.harness,
            target: item.target,
            id: item.id,
            ...(item.source === undefined ? {} : { source: item.source }),
          },
        },
      });
    }
  }

  async function planPatchItem(item: PatchItem): Promise<void> {
    const prior = state.items[item.key];
    const file = await probe.storePatch(item.hash, item.patch);
    const status = await probe.patchState(item.path, file);
    if (status === "missing") {
      extraWarnings.push(
        `${displayPath(ctx, item.path)} is not a Git checkout yet. Its harness installs it on the next start. Run ade apply again after that.`,
      );
      return;
    }
    if (status === "conflict") {
      extraWarnings.push(
        `The patch for ${displayPath(ctx, item.path)} does not apply. The package changed. Capture the patch again.`,
      );
      return;
    }
    const files = await probe.patchPaths(item.path, file);
    const desiredHash = `patch:${item.hash}`;
    const currentHash = status === "applied" ? desiredHash : "unpatched";
    const decision = decide(currentHash, desiredHash, prior?.hash, false, false);
    record(
      {
        key: item.key,
        kind: item.kind,
        scope: item.scope,
        label: item.label,
        action: decision.action,
        path: item.path,
        before: status === "applied" ? "patched" : "original",
        after: `patched, ${files.length} files`,
        drift: decision.drift,
        notes: item.notes,
      },
      desiredHash,
      currentHash,
    );
    if (isWriteAction(decision.action)) {
      patchSteps.push({ key: item.key, action: "create", dir: item.path, file, files });
    }
    if (decision.action !== "noop") {
      stateUpdates.push({
        key: item.key,
        item: {
          kind: item.kind,
          scope: item.scope,
          path: item.path,
          hash: desiredHash,
          appliedAt: now,
          meta: { patch: item.hash, files: files.join("\n") },
        },
      });
    }
  }

  async function planDesiredItem(item: DesiredItem): Promise<void> {
    const prior = state.items[item.key];
    if (item.type === "plugin") {
      await planPluginItem(item);
      return;
    }
    if (item.type === "patch") {
      await planPatchItem(item);
      return;
    }
    if (item.type === "doc") {
      const doc = await loadCached(item.doc.path, item.doc.format);
      const current = getAt(doc.data, item.pointer);
      const currentHash = hashValue(current);
      const desiredHash = hashValue(item.value);
      const decision = decide(
        currentHash,
        desiredHash,
        prior?.hash,
        current === undefined,
        item.value === ABSENT,
      );
      record(
        {
          key: item.key,
          kind: item.kind,
          scope: item.scope,
          label: item.label,
          action: decision.action,
          path: item.doc.path,
          ...(doc.realPath === path.resolve(item.doc.path) ? {} : { writesThrough: doc.realPath }),
          ...(current === undefined ? {} : { before: show(current) }),
          ...(item.value === ABSENT ? {} : { after: show(item.value) }),
          drift: decision.drift,
          notes: item.notes,
        },
        desiredHash,
        currentHash,
      );
      if (isWriteAction(decision.action)) {
        addEdit(
          doc,
          { key: item.key, pointer: item.pointer, value: item.value, currentHash },
          item.secrets.length > 0,
        );
      }
      if (decision.action !== "noop") {
        stateUpdates.push({
          key: item.key,
          item: {
            kind: item.kind,
            scope: item.scope,
            path: item.doc.path,
            pointer: [...item.pointer],
            hash: desiredHash,
            appliedAt: now,
          },
        });
      }
      return;
    }
    const current = await inspectPath(item.path);
    const currentHash = pathStateHash(current);
    const desiredHash = wantHash(item.want);
    if (item.once === true && current.type !== "absent") {
      changes.push({
        key: item.key,
        kind: item.kind,
        scope: item.scope,
        label: item.label,
        action: "noop",
        path: item.path,
        drift: false,
        notes: item.notes,
      });
      summary.noop += 1;
      return;
    }
    let decision = decide(currentHash, desiredHash, prior?.hash, current.type === "absent", false);
    const notes = [...item.notes];
    if (
      (decision.action === "noop" || decision.action === "adopt") &&
      item.want.type === "file" &&
      item.want.mode !== undefined &&
      current.type === "file" &&
      current.mode !== item.want.mode &&
      ctx.platform !== "win32"
    ) {
      decision = { action: "update", drift: false };
      notes.push(`Changes the file mode to ${item.want.mode.toString(8)}.`);
    }
    const before = describePathState(ctx, current);
    record(
      {
        key: item.key,
        kind: item.kind,
        scope: item.scope,
        label: item.label,
        action: decision.action,
        path: item.path,
        ...(before === undefined ? {} : { before }),
        after: describeWant(ctx, item.want),
        drift: decision.drift,
        notes,
      },
      desiredHash,
      currentHash,
    );
    if (isWriteAction(decision.action)) {
      pathSteps.push({
        key: item.key,
        path: item.path,
        action: decision.action,
        want: item.want,
        currentHash,
        phase: item.phase,
      });
    }
    if (decision.action !== "noop" && item.once !== true) {
      stateUpdates.push({
        key: item.key,
        item: {
          kind: item.kind,
          scope: item.scope,
          path: item.path,
          hash: desiredHash,
          appliedAt: now,
        },
      });
    }
  }

  const activeScopes = new Set<Scope>(["shared", "home", ...desired.harnesses]);
  for (const [key, prior] of Object.entries(state.items)) {
    if (desiredKeys.has(key) || desired.skipped.has(key) || !activeScopes.has(prior.scope)) {
      continue;
    }
    stateUpdates.push({ key, item: undefined });
    if (prior.kind === "plugin" && prior.meta !== undefined) {
      await forgetPlugin(key, prior);
      continue;
    }
    if (prior.kind === "patch" && prior.meta !== undefined) {
      await forgetPatch(key, prior);
      continue;
    }
    if (prior.pointer !== undefined) {
      const doc = await loadCached(prior.path, docFormatFor(prior.path) ?? "json");
      const current = getAt(doc.data, prior.pointer);
      const currentHash = hashValue(current);
      const changedOutside = currentHash !== prior.hash;
      let action: Action = "forget";
      const notes: string[] = [];
      if (current !== undefined && (!changedOutside || options.force === true)) {
        action = "delete";
        addEdit(doc, { key, pointer: prior.pointer, value: ABSENT, currentHash }, false);
      } else if (current !== undefined) {
        notes.push(
          "The entry changed outside ade. ade leaves it in place. Add --force to delete it.",
        );
      }
      record(
        {
          key,
          kind: prior.kind,
          scope: prior.scope,
          label: labelFromKey(key),
          action,
          path: prior.path,
          ...(current === undefined ? {} : { before: show(current) }),
          drift: current !== undefined && changedOutside,
          notes,
        },
        hashValue(ABSENT),
        currentHash,
      );
      continue;
    }
    const current = await inspectPath(prior.path);
    const currentHash = pathStateHash(current);
    const changedOutside = currentHash !== prior.hash;
    let action: Action = "forget";
    const notes: string[] = [];
    if (current.type !== "absent" && (!changedOutside || options.force === true)) {
      action = "delete";
      pathSteps.push({
        key,
        path: prior.path,
        action: "delete",
        want: undefined,
        currentHash,
        phase: prior.scope === "shared" ? 0 : 1,
      });
    } else if (current.type !== "absent") {
      notes.push("The path changed outside ade. ade leaves it in place. Add --force to delete it.");
    }
    const before = describePathState(ctx, current);
    record(
      {
        key,
        kind: prior.kind,
        scope: prior.scope,
        label: labelFromKey(key),
        action,
        path: prior.path,
        ...(before === undefined ? {} : { before }),
        drift: current.type !== "absent" && changedOutside,
        notes,
      },
      "absent",
      currentHash,
    );
  }

  async function forgetPlugin(key: string, prior: StateItem): Promise<void> {
    const meta = prior.meta ?? {};
    const harness = meta.harness as HarnessId;
    const target = meta.target === "marketplace" ? "marketplace" : "plugin";
    const id = meta.id ?? "";
    const { available, list } = await probe.plugins(harness);
    const current = target === "marketplace" ? list.marketplaces[id] : list.installed[id];
    const action: Action = available && current !== undefined ? "delete" : "forget";
    record(
      {
        key,
        kind: prior.kind,
        scope: prior.scope,
        label: target === "marketplace" ? `marketplace ${id}` : id,
        action,
        path: prior.path,
        ...(current === undefined
          ? {}
          : { before: target === "marketplace" ? current : "installed" }),
        drift: false,
        notes: available
          ? []
          : ["The CLI of this harness is not on the PATH. ade leaves the entry."],
      },
      "absent",
      current === undefined ? "absent" : "present",
    );
    if (action === "delete") {
      const op: PluginOp =
        target === "marketplace"
          ? { harness, op: "removeMarketplace", id }
          : { harness, op: "uninstall", id };
      pluginSteps.push({ key, target, action: "delete", ops: [op], undo: undoOf(op, current) });
    }
  }

  async function forgetPatch(key: string, prior: StateItem): Promise<void> {
    const hash = prior.meta?.patch ?? "";
    const file = probe.patchFile(hash);
    const files = (prior.meta?.files ?? "").split("\n").filter((item) => item !== "");
    let status: PatchState = "missing";
    try {
      status = await probe.patchState(prior.path, file);
    } catch {
      status = "missing";
    }
    const action: Action = status === "applied" ? "delete" : "forget";
    record(
      {
        key,
        kind: prior.kind,
        scope: prior.scope,
        label: path.basename(prior.path),
        action,
        path: prior.path,
        ...(status === "applied" ? { before: "patched" } : {}),
        drift: false,
        notes: [],
      },
      "absent",
      status,
    );
    if (action === "delete") {
      patchSteps.push({ key, action: "delete", dir: prior.path, file, files });
    }
  }

  const warnings = [...desired.warnings, ...extraWarnings];
  const unset = resolver.unresolved();
  if (unset.length > 0) {
    warnings.push(
      `These secrets are not set: ${unset.join(", ")}. The plan uses placeholders. Set the values before ade apply.`,
    );
  }
  for (const step of docSteps.values()) {
    const doc =
      docs.get(step.path) ?? [...docs.values()].find((item) => item.realPath === step.realPath);
    if (doc !== undefined && doc.commentLines > 0) {
      warnings.push(
        `Writing ${displayPath(ctx, step.realPath)} removes ${doc.commentLines} comment lines.`,
      );
    }
  }

  const plan: Plan = {
    schemaVersion: 1,
    profileDir: loaded.dir,
    home: ctx.home,
    stateDir: ctx.stateDir,
    harnesses: desired.harnesses,
    install: desired.install,
    changes,
    warnings,
    summary,
    fingerprint: sha256(fingerprintLines.sort().join("\n")),
  };
  return {
    plan,
    docSteps: [...docSteps.values()],
    pathSteps,
    pluginSteps,
    patchSteps,
    stateUpdates,
    state,
    resolver,
    runner,
  };
}

function labelFromKey(key: string): string {
  const parts = key.split(":");
  return parts.slice(2).join(":") || key;
}

export async function plan(
  loaded: LoadedProfile,
  ctx: Context,
  options: PlanOptions = {},
): Promise<Plan> {
  return (await computePlan(loaded, ctx, options)).plan;
}
