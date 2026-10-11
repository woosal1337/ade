import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import {
  cloneValue,
  type DocFormat,
  deleteAt,
  getAt,
  isPlainObject,
  loadDoc,
  serializeDoc,
  setAt,
} from "../core/doc.ts";
import { AdeError, errorMessage } from "../core/errors.ts";
import {
  atomicWrite,
  copyExact,
  copyTree,
  createLink,
  ensureDir,
  inspectPath,
  lstatOrUndefined,
  pathStateHash,
  removePath,
  statOrUndefined,
  tempSibling,
  treeHash,
} from "../core/fsx.ts";
import { ABSENT, hashValue } from "../core/hash.ts";
import type { DocStep, PathStep } from "./plan.ts";
import type { State } from "./state.ts";

export type Snapshot =
  | { readonly type: "absent" }
  | { readonly type: "file"; readonly backup: string; readonly mode: number }
  | { readonly type: "symlink"; readonly target: string; readonly dir: boolean }
  | { readonly type: "dir"; readonly backup: string };

export type AfterRef =
  | { readonly type: "absent" }
  | { readonly type: "file"; readonly hash: string }
  | { readonly type: "symlink"; readonly target: string }
  | { readonly type: "dir"; readonly hash: string };

export interface PathOp {
  readonly type: "path";
  readonly key: string;
  readonly path: string;
  readonly before: Snapshot;
  readonly after: AfterRef;
}

export type PriorValue =
  | { readonly present: true; readonly value: unknown }
  | { readonly present: false };

export interface DocEditRecord {
  readonly key: string;
  readonly pointer: readonly string[];
  readonly before: PriorValue;
  readonly afterHash: string;
  readonly createdParents?: readonly (readonly string[])[];
}

export interface DocOp {
  readonly type: "doc";
  readonly path: string;
  readonly format: DocFormat;
  readonly existed: boolean;
  readonly backup?: string;
  readonly mode?: number;
  readonly edits: readonly DocEditRecord[];
}

export type OpRecord = PathOp | DocOp;

export interface ApplyRecord {
  readonly version: 1;
  readonly id: string;
  readonly kind: "apply" | "revert";
  readonly createdAt: string;
  readonly home: string;
  readonly profile?: string;
  readonly reverts?: string;
  revertedBy?: string;
  readonly ops: readonly OpRecord[];
  readonly createdDirs?: readonly string[];
  readonly stateBefore: State;
}

export const RECORDS_DIR = "applies";
export const RECORD_FILE = "record.json";

export function recordsRoot(ctx: Context): string {
  return path.join(ctx.stateDir, RECORDS_DIR);
}

export const RECORD_ID_PATTERN = /^[0-9]{8}-[0-9]{6}-[0-9]{3}-[0-9a-f]{4}$/;

function formatStamp(time: Date): string {
  const iso = time.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}-${iso.slice(20, 23)}`;
}

function parseStamp(id: string): Date {
  const iso = `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}.${id.slice(16, 19)}Z`;
  return new Date(iso);
}

export function newRecordId(now: Date, previous?: string): string {
  let time = now;
  if (previous !== undefined && formatStamp(time) <= previous.slice(0, 19)) {
    time = new Date(parseStamp(previous).getTime() + 1);
  }
  return `${formatStamp(time)}-${randomBytes(2).toString("hex")}`;
}

export function afterRefHash(ref: AfterRef): string {
  switch (ref.type) {
    case "absent":
      return "absent";
    case "file":
      return `file:${ref.hash}`;
    case "symlink":
      return `link:${path.resolve(ref.target)}`;
    case "dir":
      return `dir:${ref.hash}`;
  }
}

export class Journal {
  readonly id: string;
  readonly dir: string;
  readonly ops: OpRecord[] = [];
  readonly createdDirs: string[] = [];
  readonly #ctx: Context;
  #counter = 0;

  private constructor(ctx: Context, id: string) {
    this.#ctx = ctx;
    this.id = id;
    this.dir = path.join(recordsRoot(ctx), id);
  }

  static async begin(ctx: Context): Promise<Journal> {
    const previous = (await listRecordIds(ctx)).at(-1);
    const journal = new Journal(ctx, newRecordId(ctx.now(), previous));
    await ensureDir(path.join(journal.dir, "files"), 0o700);
    return journal;
  }

  #nextBackup(): string {
    this.#counter += 1;
    return path.join("files", String(this.#counter));
  }

  async noteParents(target: string): Promise<void> {
    let dir = path.dirname(target);
    const missing: string[] = [];
    while ((await lstatOrUndefined(dir)) === undefined) {
      missing.push(dir);
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    for (const item of missing) {
      if (!this.createdDirs.includes(item)) {
        this.createdDirs.push(item);
      }
    }
  }

  async snapshot(target: string): Promise<Snapshot> {
    const stat = await lstatOrUndefined(target);
    if (stat === undefined) {
      return { type: "absent" };
    }
    const state = await inspectPath(target);
    if (state.type === "symlink") {
      const resolved = await statOrUndefined(target);
      return { type: "symlink", target: state.target, dir: resolved?.isDirectory() === true };
    }
    if (state.type === "file") {
      const backup = this.#nextBackup();
      await ensureDir(path.dirname(path.join(this.dir, backup)));
      await fs.copyFile(target, path.join(this.dir, backup));
      await fs.chmod(path.join(this.dir, backup), 0o600);
      return { type: "file", backup, mode: state.mode };
    }
    if (state.type === "dir") {
      const backup = this.#nextBackup();
      await copyExact(target, path.join(this.dir, backup));
      return { type: "dir", backup };
    }
    throw new AdeError("unsupported", `ade cannot manage this kind of path: ${target}.`);
  }

  async applyPath(step: PathStep): Promise<void> {
    const current = await inspectPath(step.path);
    if (pathStateHash(current) !== step.currentHash) {
      throw new AdeError("target-changed", `The path changed after the plan: ${step.path}.`, {
        hint: "Run `ade plan` again, then apply the new plan.",
      });
    }
    await this.noteParents(step.path);
    const before = await this.snapshot(step.path);
    if (step.action === "delete" || step.want === undefined) {
      await removePath(step.path);
      this.ops.push({
        type: "path",
        key: step.key,
        path: step.path,
        before,
        after: { type: "absent" },
      });
      return;
    }
    const want = step.want;
    let after: AfterRef;
    if (want.type === "file") {
      if (current.type !== "file" && current.type !== "absent") {
        await removePath(step.path);
      }
      await atomicWrite(
        step.path,
        want.content,
        want.mode ?? (current.type === "file" ? current.mode : undefined),
      );
      after = { type: "file", hash: want.hash };
    } else if (want.type === "symlink") {
      await removePath(step.path);
      await createLink(want.target, step.path, want.dir ? "dir" : "file", this.#ctx.platform);
      after = { type: "symlink", target: path.resolve(want.target) };
    } else {
      const staged = tempSibling(step.path);
      await ensureDir(path.dirname(step.path));
      try {
        await copyTree(want.source, staged);
        const hash = await treeHash(staged);
        if (hash !== want.hash) {
          throw new AdeError(
            "target-changed",
            `The source changed during the copy: ${want.source}.`,
            {
              hint: "Run `ade plan` again, then apply the new plan.",
            },
          );
        }
        await removePath(step.path);
        await fs.rename(staged, step.path);
      } catch (error) {
        await fs.rm(staged, { recursive: true, force: true });
        throw error;
      }
      after = { type: "dir", hash: want.hash };
    }
    this.ops.push({ type: "path", key: step.key, path: step.path, before, after });
  }

  async applyDoc(step: DocStep): Promise<void> {
    await this.noteParents(step.realPath);
    const doc = await loadDoc(step.realPath, step.format);
    for (const edit of step.edits) {
      if (hashValue(getAt(doc.data, edit.pointer)) !== edit.currentHash) {
        throw new AdeError("target-changed", `The file changed after the plan: ${step.realPath}.`, {
          hint: "Run `ade plan` again, then apply the new plan.",
        });
      }
    }
    let backup: string | undefined;
    if (doc.exists) {
      backup = this.#nextBackup();
      await atomicWrite(path.join(this.dir, backup), doc.text, 0o600);
    }
    const data = cloneValue(doc.data);
    const edits: DocEditRecord[] = [];
    for (const edit of step.edits) {
      const before = getAt(data, edit.pointer);
      const createdParents = edit.value === ABSENT ? [] : missingParents(data, edit.pointer);
      edits.push({
        key: edit.key,
        pointer: [...edit.pointer],
        before:
          before === undefined ? { present: false } : { present: true, value: cloneValue(before) },
        afterHash: hashValue(edit.value),
        ...(createdParents.length === 0 ? {} : { createdParents }),
      });
      if (edit.value === ABSENT) {
        deleteAt(data, edit.pointer);
      } else {
        setAt(data, edit.pointer, edit.value);
      }
    }
    await atomicWrite(
      step.realPath,
      serializeDoc(data, step.format, doc.indent),
      doc.mode ?? (step.secret ? 0o600 : 0o644),
    );
    this.ops.push({
      type: "doc",
      path: step.realPath,
      format: step.format,
      existed: doc.exists,
      ...(backup === undefined ? {} : { backup }),
      ...(doc.mode === undefined ? {} : { mode: doc.mode }),
      edits,
    });
  }

  async revertDoc(op: DocOp, options: { readonly force: boolean }): Promise<void> {
    const doc = await loadDoc(op.path, op.format);
    let backup: string | undefined;
    if (doc.exists) {
      backup = this.#nextBackup();
      await atomicWrite(path.join(this.dir, backup), doc.text, 0o600);
    }
    const data = cloneValue(doc.data);
    const edits: DocEditRecord[] = [];
    for (const edit of [...op.edits].reverse()) {
      const current = getAt(data, edit.pointer);
      if (hashValue(current) !== edit.afterHash && !options.force) {
        throw new AdeError("revert-blocked", `The entry changed after the apply: ${op.path}.`);
      }
      const createdParents = edit.before.present ? missingParents(data, edit.pointer) : [];
      edits.push({
        key: edit.key,
        pointer: [...edit.pointer],
        before:
          current === undefined
            ? { present: false }
            : { present: true, value: cloneValue(current) },
        afterHash: hashValue(edit.before.present ? edit.before.value : ABSENT),
        ...(createdParents.length === 0 ? {} : { createdParents }),
      });
      if (edit.before.present) {
        setAt(data, edit.pointer, edit.before.value);
      } else {
        deleteAt(data, edit.pointer);
      }
      const parents = [...(edit.createdParents ?? [])].sort(
        (left, right) => right.length - left.length,
      );
      for (const parent of parents) {
        const value = getAt(data, parent);
        if (isPlainObject(value) && Object.keys(value).length === 0) {
          deleteAt(data, parent);
        }
      }
    }
    if (!op.existed && isPlainObject(data) && isEmptyDoc(data)) {
      await removePath(op.path);
    } else {
      await atomicWrite(
        op.path,
        serializeDoc(data, op.format, doc.indent),
        doc.mode ?? op.mode ?? 0o644,
      );
    }
    this.ops.push({
      type: "doc",
      path: op.path,
      format: op.format,
      existed: doc.exists,
      ...(backup === undefined ? {} : { backup }),
      ...(doc.mode === undefined ? {} : { mode: doc.mode }),
      edits,
    });
  }

  async revertPath(op: PathOp, sourceRecordDir: string): Promise<void> {
    const before = await this.snapshot(op.path);
    await restoreSnapshot(op.path, op.before, sourceRecordDir, this.#ctx.platform);
    const restored = await inspectPath(op.path);
    let after: AfterRef;
    switch (restored.type) {
      case "absent":
        after = { type: "absent" };
        break;
      case "file":
        after = { type: "file", hash: restored.hash };
        break;
      case "symlink":
        after = { type: "symlink", target: restored.target };
        break;
      case "dir":
        after = { type: "dir", hash: restored.hash };
        break;
      default:
        throw new AdeError("unsupported", `ade cannot manage this kind of path: ${op.path}.`);
    }
    this.ops.push({ type: "path", key: op.key, path: op.path, before, after });
  }

  async rollback(): Promise<string[]> {
    const failures: string[] = [];
    for (const op of [...this.ops].reverse()) {
      try {
        if (op.type === "path") {
          await restoreSnapshot(op.path, op.before, this.dir, this.#ctx.platform);
        } else if (op.backup !== undefined) {
          const text = await fs.readFile(path.join(this.dir, op.backup));
          await atomicWrite(op.path, text, op.mode);
        } else {
          await removePath(op.path);
        }
      } catch (error) {
        failures.push(`${op.path}: ${errorMessage(error)}`);
      }
    }
    await removeEmptyDirs(this.createdDirs);
    return failures;
  }

  async commit(
    record: Omit<ApplyRecord, "version" | "id" | "ops" | "createdDirs">,
  ): Promise<ApplyRecord> {
    const full: ApplyRecord = {
      version: 1,
      id: this.id,
      ...record,
      ops: this.ops,
      ...(this.createdDirs.length === 0 ? {} : { createdDirs: this.createdDirs }),
    };
    await writeRecord(this.#ctx, full);
    return full;
  }

  async discard(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}

function missingParents(data: Record<string, unknown>, pointer: readonly string[]): string[][] {
  const missing: string[][] = [];
  for (let length = 1; length < pointer.length; length += 1) {
    const prefix = pointer.slice(0, length);
    if (getAt(data, prefix) === undefined) {
      missing.push(prefix);
    }
  }
  return missing;
}

export async function removeEmptyDirs(dirs: readonly string[]): Promise<void> {
  const ordered = [...dirs].sort((left, right) => right.length - left.length);
  for (const dir of ordered) {
    try {
      await fs.rmdir(dir);
    } catch {}
  }
}

function isEmptyDoc(data: Record<string, unknown>): boolean {
  return Object.values(data).every((value) => isPlainObject(value) && isEmptyDoc(value));
}

export async function restoreSnapshot(
  target: string,
  snapshot: Snapshot,
  recordDir: string,
  platform: NodeJS.Platform,
): Promise<void> {
  await removePath(target);
  switch (snapshot.type) {
    case "absent":
      return;
    case "file":
      await atomicWrite(
        target,
        await fs.readFile(path.join(recordDir, snapshot.backup)),
        snapshot.mode,
      );
      return;
    case "symlink":
      await createLink(snapshot.target, target, snapshot.dir ? "dir" : "file", platform);
      return;
    case "dir":
      await copyExact(path.join(recordDir, snapshot.backup), target);
      return;
  }
}

export async function writeRecord(ctx: Context, record: ApplyRecord): Promise<void> {
  await atomicWrite(
    path.join(recordsRoot(ctx), record.id, RECORD_FILE),
    `${JSON.stringify(record, null, 2)}\n`,
    0o600,
  );
}

export async function readRecord(ctx: Context, id: string): Promise<ApplyRecord> {
  if (!RECORD_ID_PATTERN.test(id)) {
    throw new AdeError("usage", `The apply record id is not valid: ${id}.`, {
      hint: "Run `ade history` to show the record ids.",
    });
  }
  const file = path.join(recordsRoot(ctx), id, RECORD_FILE);
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as ApplyRecord;
  } catch (error) {
    throw new AdeError("not-found", `The apply record does not exist: ${id}.`, {
      hint: "Run `ade history` to show the record ids.",
      cause: error,
    });
  }
}

export async function listRecordIds(ctx: Context): Promise<string[]> {
  try {
    const names = await fs.readdir(recordsRoot(ctx));
    return names.filter((name) => RECORD_ID_PATTERN.test(name)).sort();
  } catch {
    return [];
  }
}

export async function pruneRecords(ctx: Context, keep: number): Promise<void> {
  const ids = await listRecordIds(ctx);
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) {
    await fs.rm(path.join(recordsRoot(ctx), id), { recursive: true, force: true });
  }
}
