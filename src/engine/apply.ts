import type { Context } from "../core/context.ts";
import { AdeError, errorMessage } from "../core/errors.ts";
import type { LoadedProfile } from "../profile/load.ts";
import { Journal, pruneRecords } from "./journal.ts";
import { computePlan, isWriteAction, type Plan, type PlanOptions } from "./plan.ts";
import { acquireLock, ensureStateDir, type State, type StateItem, writeState } from "./state.ts";

export interface ApplyOptions extends PlanOptions {
  readonly expectedFingerprint?: string | undefined;
  readonly keepRecords?: number | undefined;
}

export interface ApplyResult {
  readonly plan: Plan;
  readonly applyId: string | undefined;
  readonly written: number;
  readonly recorded: number;
}

export const DEFAULT_KEEP_RECORDS = 20;

export async function apply(
  loaded: LoadedProfile,
  ctx: Context,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  await ensureStateDir(ctx.stateDir);
  const release = await acquireLock(ctx.stateDir);
  try {
    const computed = await computePlan(loaded, ctx, options);
    const { plan } = computed;
    if (
      options.expectedFingerprint !== undefined &&
      plan.fingerprint !== options.expectedFingerprint
    ) {
      throw new AdeError("target-changed", "The machine or the profile changed after the plan.", {
        hint: "Run `ade plan` again, then apply the new plan.",
      });
    }
    const blocked = plan.changes.filter((change) => change.drift && isWriteAction(change.action));
    if (blocked.length > 0 && options.force !== true) {
      throw new AdeError(
        "conflict",
        `${blocked.length} managed entries changed outside ade since the last apply.`,
        {
          details: blocked.map((change) => `${change.scope} ${change.kind} ${change.label}`),
          hint: "Add --force to make the machine match the profile, or change the profile to match the machine.",
        },
      );
    }
    const pathSteps = [...computed.pathSteps].sort((left, right) => {
      const rank = (step: (typeof computed.pathSteps)[number]): number =>
        step.action === "delete" ? 1 - step.phase : 2 + step.phase;
      return rank(left) - rank(right);
    });
    const written = pathSteps.length + computed.docSteps.length;
    const items: Record<string, StateItem> = { ...computed.state.items };
    for (const update of computed.stateUpdates) {
      if (update.item === undefined) {
        delete items[update.key];
      } else {
        items[update.key] = update.item;
      }
    }
    if (written === 0) {
      if (computed.stateUpdates.length > 0) {
        await writeState(ctx.stateDir, {
          ...computed.state,
          items,
          profile: loaded.dir,
        });
      }
      return { plan, applyId: undefined, written: 0, recorded: computed.stateUpdates.length };
    }
    const journal = await Journal.begin(ctx);
    try {
      for (const step of pathSteps) {
        await journal.applyPath(step);
      }
      for (const step of computed.docSteps) {
        await journal.applyDoc(step);
      }
    } catch (error) {
      const failures = await journal.rollback();
      await journal.discard();
      if (failures.length > 0) {
        throw new AdeError("conflict", "The apply failed, and the rollback did not finish.", {
          details: [errorMessage(error), ...failures],
          hint: "Restore the listed paths by hand. The other paths are back to their old state.",
          cause: error,
        });
      }
      throw error;
    }
    await journal.commit({
      kind: "apply",
      createdAt: ctx.now().toISOString(),
      home: ctx.home,
      profile: loaded.dir,
      stateBefore: computed.state,
    });
    const nextState: State = {
      ...computed.state,
      items,
      lastApply: journal.id,
      profile: loaded.dir,
    };
    await writeState(ctx.stateDir, nextState);
    await pruneRecords(ctx, options.keepRecords ?? DEFAULT_KEEP_RECORDS);
    return {
      plan,
      applyId: journal.id,
      written,
      recorded: computed.stateUpdates.length,
    };
  } finally {
    await release();
  }
}
