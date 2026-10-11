import type { Context } from "../core/context.ts";
import type { LoadedProfile } from "../profile/load.ts";
import { computePlan, type Plan, type PlanOptions } from "./plan.ts";

export interface StatusReport {
  readonly plan: Plan;
  readonly inSync: boolean;
  readonly managed: number;
  readonly pending: number;
  readonly drift: number;
  readonly unrecorded: number;
}

export async function status(
  loaded: LoadedProfile,
  ctx: Context,
  options: PlanOptions = {},
): Promise<StatusReport> {
  const computed = await computePlan(loaded, ctx, options);
  const { plan } = computed;
  const drift = plan.summary.drift;
  const pending = plan.changes.filter(
    (change) =>
      !change.drift &&
      (change.action === "create" || change.action === "update" || change.action === "delete"),
  ).length;
  return {
    plan,
    inSync: pending === 0 && drift === 0,
    managed: Object.keys(computed.state.items).length,
    pending,
    drift,
    unrecorded: plan.summary.adopt,
  };
}
