import path from "node:path";
import type { Context } from "../core/context.ts";
import { getAt, loadDoc } from "../core/doc.ts";
import { AdeError } from "../core/errors.ts";
import { inspectPath, pathStateHash } from "../core/fsx.ts";
import { hashValue } from "../core/hash.ts";
import { type CommandRunner, runCommand } from "../secrets/resolve.ts";
import {
  type ApplyRecord,
  afterRefHash,
  Journal,
  listRecordIds,
  readRecord,
  recordsRoot,
  removeEmptyDirs,
  writeRecord,
} from "./journal.ts";
import { acquireLock, ensureStateDir, readState, writeState } from "./state.ts";

export interface RecordSummary {
  readonly id: string;
  readonly kind: "apply" | "revert";
  readonly createdAt: string;
  readonly changes: number;
  readonly profile?: string;
  readonly reverts?: string;
  readonly revertedBy?: string;
}

export async function listApplies(ctx: Context): Promise<RecordSummary[]> {
  const summaries: RecordSummary[] = [];
  for (const id of await listRecordIds(ctx)) {
    try {
      const record = await readRecord(ctx, id);
      summaries.push({
        id: record.id,
        kind: record.kind,
        createdAt: record.createdAt,
        changes: record.ops.length,
        ...(record.profile === undefined ? {} : { profile: record.profile }),
        ...(record.reverts === undefined ? {} : { reverts: record.reverts }),
        ...(record.revertedBy === undefined ? {} : { revertedBy: record.revertedBy }),
      });
    } catch {}
  }
  return summaries.reverse();
}

export interface RevertResult {
  readonly reverted: string;
  readonly revertId: string;
  readonly restored: number;
}

async function latestRevertable(ctx: Context): Promise<ApplyRecord> {
  const ids = (await listRecordIds(ctx)).reverse();
  for (const id of ids) {
    const record = await readRecord(ctx, id);
    if (record.kind === "apply" && record.revertedBy === undefined) {
      return record;
    }
  }
  throw new AdeError("not-found", "No apply record is available to revert.", {
    hint: "Run `ade history` to show the records.",
  });
}

export async function findRevertBlockers(record: ApplyRecord): Promise<string[]> {
  const blockers: string[] = [];
  for (const op of record.ops) {
    if (op.type === "command") {
      continue;
    }
    if (op.type === "path") {
      const current = pathStateHash(await inspectPath(op.path));
      if (current !== afterRefHash(op.after)) {
        blockers.push(op.path);
      }
      continue;
    }
    const doc = await loadDoc(op.path, op.format);
    for (const edit of op.edits) {
      if (hashValue(getAt(doc.data, edit.pointer)) !== edit.afterHash) {
        blockers.push(`${op.path} ${edit.pointer.join(".")}`);
      }
    }
  }
  return blockers;
}

export interface RevertOptions {
  readonly id?: string | undefined;
  readonly force?: boolean | undefined;
  readonly runner?: CommandRunner | undefined;
}

export async function revert(ctx: Context, options: RevertOptions = {}): Promise<RevertResult> {
  await ensureStateDir(ctx.stateDir);
  const release = await acquireLock(ctx.stateDir);
  try {
    const record =
      options.id === undefined ? await latestRevertable(ctx) : await readRecord(ctx, options.id);
    if (record.revertedBy !== undefined) {
      throw new AdeError("revert-blocked", `The record ${record.id} is already reverted.`, {
        hint: `Revert the record ${record.revertedBy} to apply it again.`,
      });
    }
    const blockers = await findRevertBlockers(record);
    if (blockers.length > 0 && options.force !== true) {
      throw new AdeError(
        "revert-blocked",
        `${blockers.length} entries changed after the apply ${record.id}.`,
        {
          details: blockers,
          hint: "Add --force to restore the entries anyway.",
        },
      );
    }
    const stateBefore = await readState(ctx.stateDir);
    const sourceDir = path.join(recordsRoot(ctx), record.id);
    const journal = await Journal.begin(ctx, options.runner ?? runCommand);
    try {
      for (const op of [...record.ops].reverse()) {
        if (op.type === "command") {
          await journal.runCommands(op.key, op.undo, op.ops);
        } else if (op.type === "path") {
          await journal.revertPath(op, sourceDir);
        } else {
          await journal.revertDoc(op, { force: options.force === true });
        }
      }
    } catch (error) {
      await journal.rollback();
      await journal.discard();
      throw error;
    }
    await removeEmptyDirs(record.createdDirs ?? []);
    await journal.commit({
      kind: "revert",
      createdAt: ctx.now().toISOString(),
      home: ctx.home,
      ...(record.profile === undefined ? {} : { profile: record.profile }),
      reverts: record.id,
      stateBefore,
    });
    record.revertedBy = journal.id;
    await writeRecord(ctx, record);
    await writeState(ctx.stateDir, record.stateBefore);
    return { reverted: record.id, revertId: journal.id, restored: record.ops.length };
  } finally {
    await release();
  }
}
