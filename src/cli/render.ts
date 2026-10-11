import { shortenHome } from "../core/context.ts";
import type { Check, DoctorReport } from "../engine/doctor.ts";
import type { RecordSummary } from "../engine/history.ts";
import type { InventoryReport, InventoryStatus } from "../engine/inventory.ts";
import type { Action, Change, Plan } from "../engine/plan.ts";
import type { StatusReport } from "../engine/status.ts";
import type { HarnessRow } from "../harness/registry.ts";
import { HARNESS_IDS } from "../profile/schema.ts";
import { type Output, padEnd, type Style } from "./output.ts";

const SYMBOLS: Record<Action, { symbol: string; style: Style }> = {
  create: { symbol: "+", style: "green" },
  update: { symbol: "~", style: "yellow" },
  delete: { symbol: "-", style: "red" },
  adopt: { symbol: "=", style: "cyan" },
  forget: { symbol: "?", style: "gray" },
  noop: { symbol: " ", style: "gray" },
};

const SCOPE_ORDER: string[] = ["shared", "home", ...HARNESS_IDS];

function detail(change: Change, home: string): string {
  if (change.action === "update" && change.before !== undefined && change.after !== undefined) {
    return `${change.before} -> ${change.after}`;
  }
  if (change.action === "create" && change.after !== undefined) {
    return change.after;
  }
  if (change.action === "delete" && change.before !== undefined) {
    return change.before;
  }
  return shortenHome(home, change.path);
}

export function renderChanges(
  out: Output,
  home: string,
  changes: readonly Change[],
  verbose: boolean,
): number {
  const visible = changes.filter(
    (change) => verbose || (change.action !== "noop" && change.action !== "adopt"),
  );
  const groups = new Map<string, Change[]>();
  for (const change of visible) {
    const list = groups.get(change.scope) ?? [];
    list.push(change);
    groups.set(change.scope, list);
  }
  const labelWidth = Math.min(32, Math.max(8, ...visible.map((change) => change.label.length)));
  for (const scope of SCOPE_ORDER) {
    const list = groups.get(scope);
    if (list === undefined) {
      continue;
    }
    out.line(out.style("bold", scope));
    for (const change of list) {
      const { symbol, style } = SYMBOLS[change.action];
      const mark = change.drift ? out.style("red", "!") : out.style(style, symbol);
      const kind = padEnd(change.kind, 12);
      const label = padEnd(change.label, labelWidth);
      out.line(`  ${mark} ${kind} ${label}  ${out.style("dim", detail(change, home))}`);
      if (change.drift) {
        out.line(`      ${out.style("red", "changed outside ade since the last apply")}`);
      }
      if (change.writesThrough !== undefined && change.action !== "noop") {
        out.line(
          `      ${out.style("dim", `writes through the link to ${shortenHome(home, change.writesThrough)}`)}`,
        );
      }
      for (const note of change.notes) {
        out.line(`      ${out.style("dim", note)}`);
      }
    }
  }
  return visible.length;
}

export function summaryLine(plan: Plan): string {
  const { summary } = plan;
  const parts = [
    `${summary.create} to create`,
    `${summary.update} to update`,
    `${summary.delete} to delete`,
  ];
  const matched = summary.noop + summary.adopt;
  let text = `Plan: ${parts.join(", ")}. ${matched} already match.`;
  if (summary.adopt > 0) {
    text += ` ${summary.adopt} of them start to be managed.`;
  }
  if (summary.forget > 0) {
    text += ` ${summary.forget} leave management.`;
  }
  if (summary.drift > 0) {
    text += ` ${summary.drift} changed outside ade.`;
  }
  return text;
}

export function renderHeader(out: Output, plan: Plan, profileLabel?: string): void {
  out.line(`${out.style("dim", "Profile")}  ${profileLabel ?? plan.profileDir}`);
  out.line(`${out.style("dim", "Home   ")}  ${plan.home}`);
  out.line(
    `${out.style("dim", "Targets")}  ${plan.harnesses.length > 0 ? plan.harnesses.join(", ") : "none"} (${plan.install} mode)`,
  );
  out.line();
}

export function renderWarnings(out: Output, warnings: readonly string[]): void {
  if (warnings.length === 0) {
    return;
  }
  out.line();
  for (const warning of warnings) {
    out.line(`${out.style("yellow", "warning:")} ${warning}`);
  }
}

export function renderPlan(out: Output, plan: Plan, verbose: boolean, profileLabel?: string): void {
  renderHeader(out, plan, profileLabel);
  const shown = renderChanges(out, plan.home, plan.changes, verbose);
  if (shown === 0) {
    out.line(out.style("green", "No changes. The machine matches the profile."));
  }
  renderWarnings(out, plan.warnings);
  out.line();
  out.line(summaryLine(plan));
}

export function renderStatus(
  out: Output,
  report: StatusReport,
  verbose: boolean,
  profileLabel?: string,
): void {
  renderHeader(out, report.plan, profileLabel);
  if (report.inSync) {
    out.line(out.style("green", `In sync. ade manages ${report.managed} entries in this home.`));
    if (report.unrecorded > 0) {
      out.line(`${report.unrecorded} entries match the profile. The next apply records them.`);
    }
  } else {
    renderChanges(out, report.plan.home, report.plan.changes, verbose);
    out.line();
    if (report.pending > 0) {
      out.line(`${report.pending} changes wait for apply.`);
    }
    if (report.drift > 0) {
      out.line(out.style("red", `${report.drift} managed entries changed outside ade.`));
    }
  }
  renderWarnings(out, report.plan.warnings);
}

const LEVEL_STYLE: Record<Check["level"], { label: string; style: Style }> = {
  ok: { label: "ok   ", style: "green" },
  warn: { label: "warn ", style: "yellow" },
  error: { label: "error", style: "red" },
};

export function renderDoctor(out: Output, report: DoctorReport): void {
  for (const check of report.checks) {
    const { label, style } = LEVEL_STYLE[check.level];
    out.line(`${out.style(style, label)} ${padEnd(check.area, 8)} ${check.message}`);
    if (check.hint !== undefined && check.level !== "ok") {
      out.line(`               ${out.style("dim", check.hint)}`);
    }
  }
  const errors = report.checks.filter((check) => check.level === "error").length;
  const warnings = report.checks.filter((check) => check.level === "warn").length;
  out.line();
  out.line(`${errors} errors, ${warnings} warnings.`);
}

export function renderHistory(out: Output, records: readonly RecordSummary[]): void {
  if (records.length === 0) {
    out.line("No apply records exist yet.");
    return;
  }
  for (const record of records) {
    const state =
      record.revertedBy !== undefined
        ? out.style("dim", `reverted by ${record.revertedBy}`)
        : record.reverts !== undefined
          ? out.style("dim", `reverts ${record.reverts}`)
          : "";
    out.line(
      `${record.id}  ${padEnd(record.kind, 6)}  ${padEnd(`${record.changes} writes`, 10)}  ${record.createdAt}  ${state}`,
    );
  }
}

export function renderHarnesses(out: Output, home: string, rows: readonly HarnessRow[]): void {
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  for (const row of rows) {
    const state = row.installed ? out.style("green", "installed") : out.style("dim", "not found");
    out.line(
      `${out.style("bold", padEnd(row.id, idWidth))}  ${padEnd(row.label, labelWidth)}  ${state}`,
    );
    out.line(`        home          ${shortenHome(home, row.home)}`);
    out.line(
      `        instructions  ${row.instructions === undefined ? "account rules, no file" : shortenHome(home, row.instructions)}`,
    );
    out.line(`        mcp           ${shortenHome(home, row.mcp)}`);
    out.line(`        settings      ${shortenHome(home, row.settings)}`);
    out.line(`        skills        ${row.skills}`);
  }
}

const INVENTORY_STYLE: Record<InventoryStatus, { label: string; style: Style }> = {
  synced: { label: "synced ", style: "green" },
  extra: { label: "extra  ", style: "cyan" },
  other: { label: "other  ", style: "dim" },
  unknown: { label: "unknown", style: "yellow" },
  private: { label: "private", style: "red" },
  runtime: { label: "runtime", style: "gray" },
};

export function renderInventory(out: Output, report: InventoryReport, all: boolean): void {
  const hidden = new Set<InventoryStatus>(all ? [] : ["private", "runtime"]);
  for (const harness of report.harnesses) {
    const rows = report.rows.filter((row) => row.harness === harness && !hidden.has(row.status));
    out.line(out.style("bold", harness));
    for (const row of rows) {
      const { label, style } = INVENTORY_STYLE[row.status];
      const name = row.kind === "dir" ? `${row.display}/` : row.display;
      out.line(
        `  ${out.style(style, label)} ${padEnd(name, 46)} ${out.style("dim", row.detail ?? "")}`,
      );
    }
  }
  const { summary } = report;
  out.line();
  out.line(
    `${summary.synced} synced, ${summary.extra} extra, ${summary.other} other, ${summary.unknown} unknown, ${summary.private} private, ${summary.runtime} runtime.`,
  );
  if (!all && summary.private + summary.runtime > 0) {
    out.line(
      out.style("dim", "Add --all to show the private and runtime files. ade never syncs them."),
    );
  }
  if (summary.unknown > 0) {
    out.line("To sync an unknown entry, run `ade add file <root>:<path>`.");
  }
}
