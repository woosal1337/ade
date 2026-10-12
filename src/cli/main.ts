import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { type ParseArgsConfig, parseArgs } from "node:util";
import { type Context, createContext, defaultProfileDir } from "../core/context.ts";
import { docFormatFor, parseKeyPath } from "../core/doc.ts";
import { AdeError, errorMessage, isAdeError } from "../core/errors.ts";
import {
  atomicWrite,
  copyTree,
  isEmptyDir,
  isInside,
  removePath,
  safeJoin,
  statOrUndefined,
} from "../core/fsx.ts";
import { escapeJsonControls, printable } from "../core/text.ts";
import { apply } from "../engine/apply.ts";
import { type CaptureInclude, capture, writeCapture } from "../engine/capture.ts";
import { doctor } from "../engine/doctor.ts";
import { listApplies, revert } from "../engine/history.ts";
import { inventory } from "../engine/inventory.ts";
import { readRecord } from "../engine/journal.ts";
import { computePlan } from "../engine/plan.ts";
import { status } from "../engine/status.ts";
import { updateSkills } from "../engine/update.ts";
import {
  describeHarnesses,
  getAdapter,
  isHarnessId,
  isRootId,
  parseHarnessList,
  parseSettingsKey,
  rootDir,
} from "../harness/registry.ts";
import { exportBundle, importBundle } from "../profile/bundle.ts";
import {
  addFile,
  addMarketplace,
  addMcpServer,
  addPlugin,
  addSecret,
  addSkill,
  type EntryKind,
  removeEntry,
  setSetting,
  unsetSetting,
} from "../profile/edit.ts";
import {
  initProfile,
  type LoadedProfile,
  loadProfile,
  PROFILE_FILE,
  saveLock,
  saveProfile,
  writeSchemaFile,
} from "../profile/load.ts";
import { ADE_MD_FILE, parseMarkdown } from "../profile/markdown.ts";
import { packProfile, scanBundle, shareProfile } from "../profile/pack.ts";
import { type RiskItem, riskSummary } from "../profile/risk.ts";
import {
  type HarnessId,
  isGitSkill,
  isLinkSkill,
  type McpServer,
  profileJsonSchema,
  ROOT_IDS,
  type SecretSource,
} from "../profile/schema.ts";
import {
  type ProfileSource,
  type ResolvedProfile,
  readDefaultProfile,
  resolveProfile,
  sharedProblems,
  sourceLabel,
  specFor,
  withoutLocalPaths,
  writeDefaultProfile,
} from "../profile/source.ts";
import {
  checkTrust,
  listTrust,
  recordTrust,
  removeTrust,
  riskOf,
  type TrustStatus,
} from "../profile/trust.ts";
import {
  type RemoteTarget,
  remoteApply,
  remoteCapture,
  remoteDoctor,
  remoteHarnesses,
  remoteHistory,
  remotePlan,
  remoteRevert,
  remoteStatus,
} from "../remote/client.ts";
import { REMOTE_OPS, type RemoteInfo } from "../remote/protocol.ts";
import {
  createPreviewResolver,
  createSecretResolver,
  type SecretResolver,
} from "../secrets/resolve.ts";
import type { TokenFinding } from "../secrets/scan.ts";
import { lockGitSkill } from "../skills/source.ts";
import { VERSION } from "../version.ts";
import { type CliIO, createOutput, type Output, padEnd } from "./output.ts";
import {
  renderDoctor,
  renderHarnesses,
  renderHistory,
  renderInventory,
  renderPlan,
  renderStatus,
  renderWarnings,
} from "./render.ts";

export const EXIT = { ok: 0, failure: 1, usage: 2, pending: 3 } as const;

type OptionSpec = NonNullable<ParseArgsConfig["options"]>;
type Flags = Record<string, string | boolean | (string | boolean)[] | undefined>;

const GLOBAL_OPTIONS: OptionSpec = {
  profile: { type: "string", short: "p" },
  home: { type: "string" },
  "state-dir": { type: "string" },
  "cache-dir": { type: "string" },
  harness: { type: "string" },
  json: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  force: { type: "boolean" },
  offline: { type: "boolean" },
  trust: { type: "boolean" },
  verbose: { type: "boolean" },
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

interface CommandContext {
  readonly io: CliIO;
  readonly out: Output;
  readonly flags: Flags;
  readonly args: readonly string[];
  readonly rest: readonly string[];
  readonly json: boolean;
  readonly verbose: boolean;
  context(): Context;
  profileDir(): string;
  profileInput(positional?: string): Promise<string>;
  load(): Promise<LoadedProfile>;
  resolve(positional?: string): Promise<ResolvedProfile>;
  harnessFilter(): HarnessId[] | undefined;
  emit(result: unknown): void;
  confirm(question: string): Promise<boolean>;
  resolvePath(value: string): string;
}

interface Command {
  readonly name: string;
  readonly summary: string;
  readonly usage: readonly string[];
  readonly options?: OptionSpec;
  readonly group: "Profile" | "Machine" | "Remote" | "Share";
  run(c: CommandContext): Promise<number>;
}

function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function listFlag(flags: Flags, name: string): string[] {
  const value = flags[name];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function boolFlag(flags: Flags, name: string): boolean {
  return flags[name] === true;
}

function usageError(message: string, hint?: string): AdeError {
  return new AdeError("usage", message, hint === undefined ? {} : { hint });
}

function parsePairs(values: readonly string[], label: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    const index = value.indexOf("=");
    if (index <= 0) {
      throw usageError(`The ${label} value needs the form KEY=VALUE: ${value}.`);
    }
    result[value.slice(0, index)] = value.slice(index + 1);
  }
  return result;
}

function parseTarget(flags: Flags): HarnessId[] | undefined {
  const value = stringFlag(flags, "target");
  return value === undefined ? undefined : parseHarnessList(value);
}

function parseRootTarget(value: string | undefined): CaptureInclude {
  if (value === undefined) {
    throw usageError("Give the file as <root>:<path>, for example pi:claude-bridge.json.");
  }
  const index = value.indexOf(":");
  const root = value.slice(0, index);
  const target = value.slice(index + 1);
  if (index <= 0 || target === "" || !isRootId(root)) {
    throw usageError(
      `The file reference is not valid: ${value}.`,
      `Use one of ${ROOT_IDS.join(", ")} as the root.`,
    );
  }
  return { root, target: target.replaceAll("\\", "/") };
}

async function copyIntoProfile(
  loaded: LoadedProfile,
  source: string,
  relative: string,
  replace: boolean,
): Promise<string> {
  if (isInside(source, loaded.dir)) {
    return path.relative(loaded.dir, source).split(path.sep).join("/");
  }
  const target = safeJoin(loaded.dir, relative, "the profile directory");
  if ((await statOrUndefined(target)) !== undefined) {
    if (!replace) {
      throw new AdeError("conflict", `The profile already has the path ${relative}.`, {
        hint: "Add --replace to overwrite it.",
      });
    }
    await removePath(target);
  }
  const stat = await statOrUndefined(source);
  if (stat?.isDirectory()) {
    await copyTree(source, target);
  } else if (stat?.isFile()) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  } else {
    throw new AdeError("not-found", `The source does not exist: ${source}.`);
  }
  return relative;
}

interface SourceGate {
  readonly resolved: ResolvedProfile;
  readonly status: TrustStatus;
  readonly trusted: boolean;
}

async function inspectSource(c: CommandContext, positional?: string): Promise<SourceGate> {
  const resolved = await c.resolve(positional);
  const status = await checkTrust(c.context(), resolved);
  return { resolved, status, trusted: status.state === "local" || status.state === "trusted" };
}

function profileLabel(gate: SourceGate): string | undefined {
  const { source, loaded } = gate.resolved;
  if (source.kind !== "local") {
    return sourceLabel(source);
  }
  return source.display === loaded.dir ? undefined : source.display;
}

function planResolver(c: CommandContext, gate: SourceGate): SecretResolver {
  const profile = gate.resolved.loaded.profile;
  return gate.trusted
    ? createSecretResolver(profile, c.context(), undefined, {}, { lenient: true })
    : createPreviewResolver(profile, c.context());
}

function previewResolver(c: CommandContext, gate: SourceGate): SecretResolver | undefined {
  return gate.trusted
    ? undefined
    : createPreviewResolver(gate.resolved.loaded.profile, c.context());
}

const TRUST_LABEL: Record<TrustStatus["state"], string> = {
  local: "local",
  trusted: "trusted",
  untrusted: "not trusted",
  changed: "changed since you trusted it",
};

function sourceHeader(c: CommandContext, gate: SourceGate): void {
  const { source } = gate.resolved;
  if (source.kind === "local") {
    return;
  }
  const state = TRUST_LABEL[gate.status.state];
  c.out.line(
    `${c.out.style("dim", "Source ")}  ${sourceLabel(source)} (${gate.trusted ? state : c.out.style("yellow", state)})`,
  );
  if (!gate.trusted && Object.keys(gate.resolved.loaded.profile.secrets ?? {}).length > 0) {
    c.out.line(
      c.out.style(
        "dim",
        "         ade did not resolve the secrets of this source. Entries with secrets show as changes.",
      ),
    );
  }
}

function renderRisk(out: Output, gate: SourceGate): void {
  const { source } = gate.resolved;
  const status = gate.status;
  out.line();
  if (status.state === "changed") {
    out.line(
      `${printable(source.display)} changed since you trusted it at ${status.entry.commit.slice(0, 12)}. These entries are new, changed, or removed:`,
    );
    for (const key of status.added) {
      out.line(`  ${out.style("yellow", "+")} ${printable(key)}`);
    }
    for (const key of status.changed) {
      out.line(`  ${out.style("yellow", "~")} ${printable(key)}`);
    }
    for (const key of status.removed) {
      out.line(`  ${out.style("dim", "-")} ${out.style("dim", printable(key))}`);
    }
    out.line();
  }
  renderRiskItems(
    out,
    `${sourceLabel(source)} does these things on this machine:`,
    riskOf(gate.resolved),
  );
}

function renderRiskItems(out: Output, title: string, items: readonly RiskItem[]): void {
  out.line(title);
  for (const item of items) {
    const mark = item.level === "high" ? out.style("red", "!") : " ";
    out.line(`  ${mark} ${padEnd(item.area, 12)} ${item.text}`);
  }
  out.line();
  out.line(
    out.style(
      "dim",
      "Items with ! run programs, write files, read secrets, or change permissions.",
    ),
  );
}

async function requireTrust(
  c: CommandContext,
  gate: SourceGate,
  explicit = false,
): Promise<boolean> {
  const { status, resolved } = gate;
  const { source } = resolved;
  const ctx = c.context();
  if (status.state === "local") {
    return true;
  }
  if (status.state === "trusted" && !explicit) {
    if (!status.sameCommit) {
      await recordTrust(ctx, resolved);
    }
    return true;
  }
  if (!c.json) {
    renderRisk(c.out, gate);
  }
  if (status.state === "trusted" && status.sameCommit) {
    if (!c.json) {
      c.out.line(`${sourceLabel(source)} is already trusted.`);
    }
    return true;
  }
  if (boolFlag(c.flags, "trust") || (explicit && boolFlag(c.flags, "yes"))) {
    await recordTrust(ctx, resolved);
    if (!c.json) {
      c.out.line(`Trusted ${sourceLabel(source)}.`);
    }
    return true;
  }
  if (c.json || !c.io.stdinIsTTY) {
    throw new AdeError(
      "untrusted",
      status.state === "changed"
        ? `The source ${sourceLabel(source)} changed since you trusted it.`
        : `The source ${sourceLabel(source)} is not trusted.`,
      {
        hint: `Read the summary with \`ade trust ${source.display}\`. Then add --trust to trust it.`,
      },
    );
  }
  if (!(await c.confirm(`Trust ${sourceLabel(source)}?`))) {
    return false;
  }
  await recordTrust(ctx, resolved);
  c.out.line(`Trusted ${sourceLabel(source)}.`);
  c.out.line();
  return true;
}

async function trustedGate(c: CommandContext, gate: SourceGate): Promise<SourceGate> {
  if (gate.resolved.source.kind === "local") {
    return gate;
  }
  return { ...gate, status: await checkTrust(c.context(), gate.resolved), trusted: true };
}

interface VerifyReport {
  readonly ok: boolean;
  readonly kind: "ade-md" | "profile";
  readonly files: number;
  readonly digest?: string;
  readonly findings: readonly TokenFinding[];
  readonly problems: readonly string[];
  readonly risk: readonly RiskItem[];
}

async function verifyInput(c: CommandContext, input: string): Promise<VerifyReport> {
  const local = c.resolvePath(input);
  if ((await statOrUndefined(local))?.isFile()) {
    const parsed = parseMarkdown(await fs.readFile(local, "utf8"), local);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ade-verify-"));
    try {
      const loaded = await importBundle(parsed.bundle, path.join(temp, "profile"));
      const findings = scanBundle(parsed.bundle);
      const problems = sharedProblems(loaded);
      return {
        ok: findings.length === 0 && problems.length === 0,
        kind: "ade-md",
        files: parsed.bundle.files.length,
        digest: parsed.digest,
        findings,
        problems,
        risk: riskSummary(loaded.profile, loaded.lock),
      };
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
  const { loaded } = await c.resolve(input);
  const bundle = await exportBundle(loaded);
  const findings = scanBundle(bundle);
  return {
    ok: findings.length === 0,
    kind: "profile",
    files: bundle.files.length,
    findings,
    problems: [],
    risk: riskSummary(loaded.profile, loaded.lock),
  };
}

const commands: Command[] = [
  {
    name: "init",
    group: "Profile",
    summary: "Create an empty profile.",
    usage: ["ade init [dir] [--name <name>] [--force]"],
    options: { name: { type: "string" } },
    async run(c) {
      const dir = c.args[0] === undefined ? c.profileDir() : c.resolvePath(c.args[0]);
      const loaded = await initProfile(dir, {
        ...(stringFlag(c.flags, "name") === undefined
          ? {}
          : { name: stringFlag(c.flags, "name") as string }),
        force: boolFlag(c.flags, "force"),
      });
      if (c.json) {
        c.emit({ dir: loaded.dir, profile: loaded.profile });
        return EXIT.ok;
      }
      c.out.line(`Created the profile ${loaded.dir}.`);
      c.out.line("Next: add entries with `ade add`, then run `ade plan`.");
      return EXIT.ok;
    },
  },
  {
    name: "capture",
    group: "Profile",
    summary: "Write the current machine setup into a new profile.",
    usage: ["ade capture [--out <dir>] [--include <root>:<path>]... [--name <name>] [--force]"],
    options: {
      out: { type: "string", short: "o" },
      include: { type: "string", multiple: true },
      name: { type: "string" },
    },
    async run(c) {
      const ctx = c.context();
      const out = stringFlag(c.flags, "out");
      const dir = out === undefined ? c.profileDir() : c.resolvePath(out);
      const include = listFlag(c.flags, "include").map((item) => parseRootTarget(item));
      const result = await capture(ctx, {
        harnesses: c.harnessFilter(),
        include,
        name: stringFlag(c.flags, "name"),
      });
      const loaded = await writeCapture(dir, result, { force: boolFlag(c.flags, "force") });
      if (c.json) {
        c.emit({
          dir: loaded.dir,
          profile: loaded.profile,
          warnings: result.warnings,
          secrets: result.secrets,
        });
        return EXIT.ok;
      }
      const profile = loaded.profile;
      c.out.line(`Captured the setup of ${ctx.home} into ${loaded.dir}.`);
      c.out.line(`  harnesses     ${(profile.harnesses ?? []).join(", ") || "none"}`);
      c.out.line(
        `  instructions  ${profile.instructions === undefined ? "none" : profile.instructions.file}`,
      );
      c.out.line(`  mcp servers   ${Object.keys(profile.mcp ?? {}).length}`);
      c.out.line(`  skills        ${Object.keys(profile.skills ?? {}).length}`);
      c.out.line(`  settings      ${Object.keys(profile.settings ?? {}).join(", ") || "none"}`);
      c.out.line(`  files         ${(profile.files ?? []).length}`);
      if (result.secrets.length > 0) {
        c.out.line();
        c.out.line("The profile refers to these secrets. ade did not copy their values:");
        for (const secret of result.secrets) {
          c.out.line(`  ${padEnd(secret.name, 24)} ${c.out.style("dim", secret.where)}`);
        }
        c.out.line(
          "Set each secret as an environment variable, or change its source with `ade add secret --replace`.",
        );
      }
      renderWarnings(c.out, result.warnings);
      c.out.line();
      c.out.line(
        `Next: run \`ade plan --profile ${loaded.dir}\` to compare the profile with this machine.`,
      );
      return EXIT.ok;
    },
  },
  {
    name: "list",
    group: "Profile",
    summary: "List the profile entries.",
    usage: ["ade list [mcp|skills|settings|secrets|files|instructions] [--profile <source>]"],
    async run(c) {
      const { loaded } = await c.resolve();
      const { profile } = loaded;
      const kind = c.args[0];
      const kinds = [
        "mcp",
        "skills",
        "settings",
        "secrets",
        "files",
        "plugins",
        "patches",
        "instructions",
      ];
      if (kind !== undefined && !kinds.includes(kind)) {
        throw usageError(`The kind is not known: ${kind}.`, `Use one of: ${kinds.join(", ")}.`);
      }
      const show = (name: string): boolean => kind === undefined || kind === name;
      if (c.json) {
        c.emit(
          Object.fromEntries(
            kinds.filter(show).map((name) => [name, profile[name as keyof typeof profile] ?? null]),
          ),
        );
        return EXIT.ok;
      }
      const out = c.out;
      if (show("instructions")) {
        out.line(out.style("bold", "instructions"));
        out.line(
          profile.instructions === undefined
            ? "  none"
            : `  ${profile.instructions.file}  ${out.style("dim", (profile.instructions.harnesses ?? ["all targets"]).join(", "))}`,
        );
      }
      if (show("mcp")) {
        out.line(out.style("bold", "mcp"));
        const entries = Object.entries(profile.mcp ?? {});
        if (entries.length === 0) {
          out.line("  none");
        }
        for (const [name, server] of entries) {
          const where =
            server.transport === "http"
              ? server.url
              : [server.command, ...(server.args ?? [])].join(" ");
          const targets = (server.harnesses ?? ["all targets"]).join(", ");
          const disabled = server.enabled === false ? " disabled" : "";
          out.line(
            `  ${padEnd(name, 20)} ${padEnd(server.transport, 6)} ${where}  ${out.style("dim", `${targets}${disabled}`)}`,
          );
        }
      }
      if (show("skills")) {
        out.line(out.style("bold", "skills"));
        const entries = Object.entries(profile.skills ?? {});
        if (entries.length === 0) {
          out.line("  none");
        }
        for (const [name, skill] of entries) {
          const source = isGitSkill(skill)
            ? `${skill.git}${skill.subdir === undefined ? "" : `//${skill.subdir}`}@${skill.ref ?? "HEAD"}`
            : isLinkSkill(skill)
              ? `link ${skill.link}`
              : skill.path;
          const locked = isGitSkill(skill)
            ? loaded.lock.skills[name]?.commit.slice(0, 12)
            : undefined;
          out.line(
            `  ${padEnd(name, 28)} ${source}${locked === undefined ? "" : out.style("dim", `  locked ${locked}`)}`,
          );
        }
      }
      if (show("settings")) {
        out.line(out.style("bold", "settings"));
        const entries = Object.entries(profile.settings ?? {});
        if (entries.length === 0) {
          out.line("  none");
        }
        for (const [key, patch] of entries) {
          out.line(`  ${padEnd(key, 28)} ${Object.keys(patch).join(", ")}`);
        }
      }
      if (show("secrets")) {
        out.line(out.style("bold", "secrets"));
        const entries = Object.entries(profile.secrets ?? {});
        if (entries.length === 0) {
          out.line("  none");
        }
        for (const [name, source] of entries) {
          out.line(`  ${padEnd(name, 28)} ${describeSecret(source)}`);
        }
      }
      if (show("files")) {
        out.line(out.style("bold", "files"));
        const entries = profile.files ?? [];
        if (entries.length === 0) {
          out.line("  none");
        }
        for (const entry of entries) {
          const flags = [
            entry.template ? "template" : "",
            entry.mode ? `mode ${entry.mode}` : "",
            entry.once ? "only when absent" : "",
            entry.symlink ? `link to ${entry.symlink}` : "",
          ]
            .filter(Boolean)
            .join(", ");
          out.line(
            `  ${padEnd(`${entry.root}:${entry.target}`, 40)} ${entry.source ?? ""}${flags ? out.style("dim", `  ${flags}`) : ""}`,
          );
        }
      }
      if (show("plugins")) {
        out.line(out.style("bold", "plugins"));
        const entries = Object.entries(profile.plugins ?? {});
        if (entries.length === 0) {
          out.line("  none");
        }
        for (const [harness, set] of entries) {
          for (const [marketplace, source] of Object.entries(set?.marketplaces ?? {})) {
            out.line(
              `  ${padEnd(harness, 16)} marketplace ${marketplace}  ${out.style("dim", source)}`,
            );
          }
          for (const id of set?.install ?? []) {
            out.line(`  ${padEnd(harness, 16)} ${id}`);
          }
        }
      }
      if (show("patches")) {
        out.line(out.style("bold", "patches"));
        const entries = profile.patches ?? [];
        if (entries.length === 0) {
          out.line("  none");
        }
        for (const entry of entries) {
          out.line(`  ${padEnd(`${entry.root}:${entry.target}`, 40)} ${entry.source}`);
        }
      }
      return EXIT.ok;
    },
  },
  {
    name: "add",
    group: "Profile",
    summary: "Add an MCP server, a skill, a secret, a file, or the instructions to the profile.",
    usage: [
      "ade add mcp <name> --url <url> [--header KEY=VALUE]... [--target <harnesses>]",
      "ade add mcp <name> [--env KEY=VALUE]... [--target <harnesses>] -- <command> [args...]",
      "ade add skill <name> --path <dir> [--target <harnesses>]",
      "ade add skill <name> --link <dir> [--target <harnesses>]",
      "ade add skill <name> --git <url> [--ref <ref>] [--subdir <dir>] [--target <harnesses>]",
      "ade add secret <name> --from env --name <VARIABLE>",
      "ade add secret <name> --from file --path <file>",
      "ade add secret <name> --from keychain --service <service> --account <account>",
      "ade add secret <name> --from command -- <command> [args...]",
      "ade add file <root>:<path> [--source <file>] [--template] [--mode 600]",
      "ade add instructions <file> [--target <harnesses>]",
      "ade add plugin <harness> <plugin>",
      "ade add marketplace <harness> <name> <source>",
    ],
    options: {
      url: { type: "string" },
      header: { type: "string", multiple: true },
      env: { type: "string", multiple: true },
      description: { type: "string" },
      disabled: { type: "boolean" },
      target: { type: "string" },
      replace: { type: "boolean" },
      path: { type: "string" },
      link: { type: "string" },
      git: { type: "string" },
      ref: { type: "string" },
      subdir: { type: "string" },
      from: { type: "string" },
      name: { type: "string" },
      service: { type: "string" },
      account: { type: "string" },
      source: { type: "string" },
      template: { type: "boolean" },
      mode: { type: "string" },
    },
    async run(c) {
      const [kind, name] = c.args;
      const loaded = await c.load();
      const replace = boolFlag(c.flags, "replace");
      const targets = parseTarget(c.flags);
      let profile = loaded.profile;
      let message: string;
      switch (kind) {
        case "mcp": {
          if (name === undefined) {
            throw usageError("Give the MCP server name.");
          }
          const url = stringFlag(c.flags, "url");
          if ((url === undefined) === (c.rest.length === 0)) {
            throw usageError("Give either --url, or a command after --.");
          }
          const common = {
            ...(stringFlag(c.flags, "description") === undefined
              ? {}
              : { description: stringFlag(c.flags, "description") as string }),
            ...(boolFlag(c.flags, "disabled") ? { enabled: false } : {}),
            ...(targets === undefined ? {} : { harnesses: targets }),
          };
          let server: McpServer;
          if (url !== undefined) {
            const headers = parsePairs(listFlag(c.flags, "header"), "header");
            server = {
              transport: "http",
              url,
              ...(Object.keys(headers).length > 0 ? { headers } : {}),
              ...common,
            };
          } else {
            const [command, ...args] = c.rest;
            const env = parsePairs(listFlag(c.flags, "env"), "env");
            server = {
              transport: "stdio",
              command: command as string,
              ...(args.length > 0 ? { args } : {}),
              ...(Object.keys(env).length > 0 ? { env } : {}),
              ...common,
            };
          }
          profile = addMcpServer(profile, name, server, replace);
          message = `Added the MCP server ${name}.`;
          break;
        }
        case "skill": {
          if (name === undefined) {
            throw usageError("Give the skill name.");
          }
          const source = stringFlag(c.flags, "path");
          const git = stringFlag(c.flags, "git");
          const link = stringFlag(c.flags, "link");
          if ([source, git, link].filter((item) => item !== undefined).length !== 1) {
            throw usageError("Give one of --path, --link, or --git.");
          }
          if (link !== undefined) {
            const absolute = c.resolvePath(link);
            if (!(await statOrUndefined(path.join(absolute, "SKILL.md")))?.isFile()) {
              throw new AdeError("not-found", `The directory has no SKILL.md file: ${absolute}.`);
            }
            const home = c.context().home;
            const stored = isInside(absolute, home)
              ? `\${home}${absolute.slice(home.length)}`
              : absolute;
            profile = addSkill(
              profile,
              name,
              { link: stored, ...(targets === undefined ? {} : { harnesses: targets }) },
              replace,
            );
            message = `Added the skill ${name} as a link to ${absolute}.`;
          } else if (source !== undefined) {
            const absolute = c.resolvePath(source);
            if (!(await statOrUndefined(path.join(absolute, "SKILL.md")))?.isFile()) {
              throw new AdeError("not-found", `The directory has no SKILL.md file: ${absolute}.`);
            }
            const relative = await copyIntoProfile(loaded, absolute, `skills/${name}`, replace);
            profile = addSkill(
              profile,
              name,
              { path: relative, ...(targets === undefined ? {} : { harnesses: targets }) },
              replace,
            );
            message = `Added the skill ${name} from ${relative}.`;
          } else {
            const skill = {
              git: git as string,
              ...(stringFlag(c.flags, "ref") === undefined
                ? {}
                : { ref: stringFlag(c.flags, "ref") as string }),
              ...(stringFlag(c.flags, "subdir") === undefined
                ? {}
                : { subdir: stringFlag(c.flags, "subdir") as string }),
              ...(targets === undefined ? {} : { harnesses: targets }),
            };
            profile = addSkill(profile, name, skill, replace);
            const locked = await lockGitSkill(c.context(), skill);
            await saveProfile(loaded.dir, profile);
            await saveLock(loaded.dir, {
              version: 1,
              skills: { ...loaded.lock.skills, [name]: locked },
            });
            if (c.json) {
              c.emit({ added: { kind, name }, lock: locked });
              return EXIT.ok;
            }
            c.out.line(`Added the skill ${name}, locked at ${locked.commit.slice(0, 12)}.`);
            c.out.line("Next: run `ade plan`.");
            return EXIT.ok;
          }
          break;
        }
        case "secret": {
          if (name === undefined) {
            throw usageError("Give the secret name.");
          }
          const from = stringFlag(c.flags, "from");
          let source: SecretSource;
          if (from === "env") {
            source = { from: "env", name: stringFlag(c.flags, "name") ?? name };
          } else if (from === "file") {
            const file = stringFlag(c.flags, "path");
            if (file === undefined) {
              throw usageError("Give the file with --path.");
            }
            source = { from: "file", path: file };
          } else if (from === "keychain") {
            const service = stringFlag(c.flags, "service");
            const account = stringFlag(c.flags, "account");
            if (service === undefined || account === undefined) {
              throw usageError("Give --service and --account.");
            }
            source = { from: "keychain", service, account };
          } else if (from === "command") {
            if (c.rest.length === 0) {
              throw usageError("Give the command after --.");
            }
            source = { from: "command", argv: [...c.rest] };
          } else {
            throw usageError("Give --from env, file, keychain, or command.");
          }
          profile = addSecret(profile, name, source, replace);
          message = `Added the secret ${name}. The profile holds its source, not its value.`;
          break;
        }
        case "file": {
          const reference = parseRootTarget(name);
          const ctx = c.context();
          const sourceFlag = stringFlag(c.flags, "source");
          const sourcePath =
            sourceFlag === undefined
              ? safeJoin(rootDir(ctx, reference.root), reference.target, "its target root")
              : c.resolvePath(sourceFlag);
          if (
            sourceFlag === undefined &&
            reference.root !== "home" &&
            docFormatFor(reference.target) !== undefined
          ) {
            c.out.error(
              c.out.style("yellow", "warning: ") +
                "ade can merge this JSON or TOML file key by key. Use `ade set` for that.",
            );
          }
          const relative = await copyIntoProfile(
            loaded,
            sourcePath,
            `files/${reference.root}/${reference.target}`,
            replace,
          );
          const mode = stringFlag(c.flags, "mode");
          profile = addFile(
            profile,
            {
              root: reference.root,
              target: reference.target,
              source: relative,
              ...(boolFlag(c.flags, "template") ? { template: true } : {}),
              ...(mode === undefined ? {} : { mode }),
            },
            replace,
          );
          message = `Added the file ${reference.root}:${reference.target}.`;
          break;
        }
        case "instructions": {
          if (name === undefined) {
            throw usageError("Give the instructions file.");
          }
          const relative = await copyIntoProfile(loaded, c.resolvePath(name), "AGENTS.md", true);
          profile = {
            ...profile,
            instructions: {
              file: relative,
              ...(targets === undefined ? {} : { harnesses: targets }),
            },
          };
          message = `Set the instructions to ${relative}.`;
          break;
        }
        case "plugin": {
          const [, harness, id] = c.args;
          if (harness === undefined || id === undefined || !isHarnessId(harness)) {
            throw usageError(
              "Give the harness and the plugin, for example: ade add plugin claude code-review@claude-plugins-official.",
            );
          }
          const support = getAdapter(harness).plugins;
          if (support === undefined) {
            throw usageError(`ade has no plugin support for ${getAdapter(harness).label}.`);
          }
          profile = addPlugin(profile, harness, id);
          message = `Added the ${support.noun} ${id} for ${getAdapter(harness).label}.`;
          break;
        }
        case "marketplace": {
          const [, harness, marketplace, source] = c.args;
          if (
            harness === undefined ||
            marketplace === undefined ||
            source === undefined ||
            !isHarnessId(harness)
          ) {
            throw usageError("Give the harness, the marketplace name, and its source.");
          }
          if (getAdapter(harness).plugins?.marketplaces !== true) {
            throw usageError(`${getAdapter(harness).label} has no marketplace command.`);
          }
          profile = addMarketplace(profile, harness, marketplace, source, replace);
          message = `Added the marketplace ${marketplace} for ${getAdapter(harness).label}.`;
          break;
        }
        default:
          throw usageError(
            "Give the kind: mcp, skill, secret, file, instructions, plugin, or marketplace.",
          );
      }
      await saveProfile(loaded.dir, profile);
      if (c.json) {
        c.emit({ added: { kind, name }, profile });
        return EXIT.ok;
      }
      c.out.line(message);
      c.out.line("Next: run `ade plan`.");
      return EXIT.ok;
    },
  },
  {
    name: "remove",
    group: "Profile",
    summary: "Remove an entry from the profile. The next apply removes it from the machine.",
    usage: [
      "ade remove <mcp|skill|secret|file|instructions> <name> [--purge]",
      "ade remove plugin <harness>:<plugin>",
      "ade remove marketplace <harness>:<name>",
      "ade remove patch <root>:<target> [--purge]",
    ],
    options: { purge: { type: "boolean" } },
    async run(c) {
      const [kind, name] = c.args;
      const kinds: EntryKind[] = [
        "mcp",
        "skill",
        "secret",
        "file",
        "instructions",
        "plugin",
        "marketplace",
        "patch",
      ];
      if (kind === undefined || !(kinds as string[]).includes(kind)) {
        throw usageError(`Give the kind: ${kinds.join(", ")}.`);
      }
      const entryName = kind === "instructions" ? (name ?? "instructions") : name;
      if (entryName === undefined) {
        throw usageError("Give the entry name.");
      }
      const loaded = await c.load();
      const before = loaded.profile;
      const profile = removeEntry(before, kind as EntryKind, entryName);
      await saveProfile(loaded.dir, profile);
      const purged: string[] = [];
      if (kind === "skill") {
        const skill = before.skills?.[entryName];
        if (skill !== undefined && isGitSkill(skill)) {
          const skills = { ...loaded.lock.skills };
          delete skills[entryName];
          await saveLock(loaded.dir, { version: 1, skills });
        } else if (skill !== undefined && "path" in skill && boolFlag(c.flags, "purge")) {
          const dir = safeJoin(loaded.dir, skill.path, "the profile directory");
          await removePath(dir);
          purged.push(dir);
        }
      }
      if ((kind === "file" || kind === "patch") && boolFlag(c.flags, "purge")) {
        const list = kind === "file" ? (before.files ?? []) : (before.patches ?? []);
        const entry = list.find((item) => `${item.root}:${item.target}` === entryName);
        if (entry?.source !== undefined) {
          const file = safeJoin(loaded.dir, entry.source, "the profile directory");
          await removePath(file);
          purged.push(file);
        }
      }
      if (c.json) {
        c.emit({ removed: { kind, name: entryName }, purged });
        return EXIT.ok;
      }
      c.out.line(`Removed the ${kind} ${entryName} from the profile.`);
      for (const item of purged) {
        c.out.line(`Deleted ${item}.`);
      }
      c.out.line("Next: run `ade plan`, then `ade apply` to remove it from the machine.");
      return EXIT.ok;
    },
  },
  {
    name: "set",
    group: "Profile",
    summary: "Set a harness setting in the profile.",
    usage: [
      "ade set <harness>[:<file>] <key.path> <value> [--string]",
      "Example: ade set pi defaultModel claude-opus-5-5",
      "Example: ade set claude permissions.defaultMode '\"auto\"'",
    ],
    options: { string: { type: "boolean" } },
    async run(c) {
      const [docKey, keyPath, raw] = c.args;
      if (docKey === undefined || keyPath === undefined || raw === undefined) {
        throw usageError("Give the harness, the key path, and the value.");
      }
      parseSettingsKey(docKey);
      let value: unknown = raw;
      if (!boolFlag(c.flags, "string")) {
        try {
          value = JSON.parse(raw);
        } catch {
          value = raw;
        }
      }
      const loaded = await c.load();
      const profile = setSetting(loaded.profile, docKey, parseKeyPath(keyPath), value);
      await saveProfile(loaded.dir, profile);
      if (c.json) {
        c.emit({ set: { docKey, keyPath, value } });
        return EXIT.ok;
      }
      c.out.line(`Set ${docKey} ${keyPath} to ${JSON.stringify(value)}.`);
      c.out.line("Next: run `ade plan`.");
      return EXIT.ok;
    },
  },
  {
    name: "unset",
    group: "Profile",
    summary: "Remove a harness setting from the profile.",
    usage: ["ade unset <harness>[:<file>] <key.path>"],
    async run(c) {
      const [docKey, keyPath] = c.args;
      if (docKey === undefined || keyPath === undefined) {
        throw usageError("Give the harness and the key path.");
      }
      const loaded = await c.load();
      const profile = unsetSetting(loaded.profile, docKey, parseKeyPath(keyPath));
      await saveProfile(loaded.dir, profile);
      if (c.json) {
        c.emit({ unset: { docKey, keyPath } });
        return EXIT.ok;
      }
      c.out.line(`Removed ${docKey} ${keyPath} from the profile.`);
      c.out.line("Next: run `ade plan`. The next apply removes the value that ade set.");
      return EXIT.ok;
    },
  },
  {
    name: "update",
    group: "Profile",
    summary: "Fetch the Git skills again and lock their current commits.",
    usage: ["ade update [skill...]"],
    async run(c) {
      const loaded = await c.load();
      const result = await updateSkills(loaded, c.context(), c.args);
      if (c.json) {
        c.emit(result);
        return EXIT.ok;
      }
      if (result.updates.length === 0) {
        c.out.line("The profile has no Git skills.");
        return EXIT.ok;
      }
      for (const update of result.updates) {
        const from = update.from === undefined ? "new" : update.from.slice(0, 12);
        const state = update.changed
          ? `${from} -> ${update.to.slice(0, 12)}`
          : `unchanged at ${update.to.slice(0, 12)}`;
        c.out.line(`  ${padEnd(update.name, 28)} ${state}`);
      }
      c.out.line("Next: run `ade plan`.");
      return EXIT.ok;
    },
  },
  {
    name: "plan",
    group: "Machine",
    summary: "Show the changes that apply makes. Plan writes nothing.",
    usage: [
      "ade plan [source] [--harness <harnesses>] [--verbose] [--offline]",
      "The source is a folder, owner/repo[/subdir][@ref] on GitHub, or a Git URL.",
    ],
    async run(c) {
      const gate = await inspectSource(c, c.args[0]);
      const ctx = c.context();
      const computed = await computePlan(gate.resolved.loaded, ctx, {
        harnesses: c.harnessFilter(),
        force: boolFlag(c.flags, "force"),
        offline: boolFlag(c.flags, "offline"),
        resolver: planResolver(c, gate),
      });
      if (c.json) {
        c.emit({ ...computed.plan, source: gate.resolved.source, trust: gate.status.state });
        return EXIT.ok;
      }
      sourceHeader(c, gate);
      renderPlan(c.out, computed.plan, c.verbose, profileLabel(gate));
      const writes =
        computed.plan.summary.create + computed.plan.summary.update + computed.plan.summary.delete;
      if (writes > 0) {
        c.out.line(
          computed.plan.summary.drift > 0 && !boolFlag(c.flags, "force")
            ? "Next: resolve the changes outside ade, or run `ade apply --force`."
            : "Next: run `ade apply` with the same source to make these changes.",
        );
      }
      return EXIT.ok;
    },
  },
  {
    name: "apply",
    group: "Machine",
    summary: "Make the machine match the profile. Each apply keeps a backup.",
    usage: [
      "ade apply [source] [--harness <harnesses>] [--yes] [--trust] [--force] [--offline]",
      "A Git source needs trust before its first apply. ade shows what the source runs and writes.",
    ],
    async run(c) {
      const checked = await inspectSource(c, c.args[0]);
      const ctx = c.context();
      if (!(await requireTrust(c, checked))) {
        c.out.line("Nothing changed.");
        return EXIT.ok;
      }
      const gate = await trustedGate(c, checked);
      const loaded = gate.resolved.loaded;
      const options = {
        harnesses: c.harnessFilter(),
        force: boolFlag(c.flags, "force"),
        offline: boolFlag(c.flags, "offline"),
      };
      const computed = await computePlan(loaded, ctx, options);
      const plan = computed.plan;
      const writes = plan.summary.create + plan.summary.update + plan.summary.delete;
      if (!c.json) {
        sourceHeader(c, gate);
        renderPlan(c.out, plan, c.verbose, profileLabel(gate));
      }
      if (writes > 0 && !boolFlag(c.flags, "yes")) {
        if (c.json || !c.io.stdinIsTTY) {
          throw usageError("Add --yes to apply without a prompt.");
        }
        c.out.line();
        if (!(await c.confirm(`Apply ${writes} changes to ${ctx.home}?`))) {
          c.out.line("Nothing changed.");
          return EXIT.ok;
        }
      }
      const result = await apply(loaded, ctx, {
        ...options,
        expectedFingerprint: plan.fingerprint,
        profileLabel: profileLabel(gate),
      });
      if (c.json) {
        c.emit({
          applyId: result.applyId,
          written: result.written,
          recorded: result.recorded,
          source: gate.resolved.source,
          plan: result.plan,
        });
        return EXIT.ok;
      }
      c.out.line();
      if (result.applyId === undefined) {
        c.out.line(
          result.recorded > 0
            ? `Recorded ${result.recorded} entries in the state. No file changed.`
            : "Nothing to apply.",
        );
        return EXIT.ok;
      }
      const changed =
        result.plan.summary.create + result.plan.summary.update + result.plan.summary.delete;
      c.out.line(
        c.out.style(
          "green",
          `Applied ${changed} changes with ${result.written} writes. Record: ${result.applyId}.`,
        ),
      );
      c.out.line(`To undo, run \`ade revert ${result.applyId}\`.`);
      return EXIT.ok;
    },
  },
  {
    name: "status",
    group: "Machine",
    summary: "Show whether the machine matches the profile, and show drift.",
    usage: ["ade status [source] [--harness <harnesses>] [--exit-code]"],
    options: { "exit-code": { type: "boolean" } },
    async run(c) {
      const gate = await inspectSource(c, c.args[0]);
      const ctx = c.context();
      const report = await status(gate.resolved.loaded, ctx, {
        harnesses: c.harnessFilter(),
        offline: boolFlag(c.flags, "offline"),
        resolver: planResolver(c, gate),
      });
      if (c.json) {
        c.emit({ ...report, source: gate.resolved.source, trust: gate.status.state });
      } else {
        sourceHeader(c, gate);
        renderStatus(c.out, report, c.verbose, profileLabel(gate));
      }
      return boolFlag(c.flags, "exit-code") && !report.inSync ? EXIT.pending : EXIT.ok;
    },
  },
  {
    name: "revert",
    group: "Machine",
    summary: "Restore the entries that one apply changed. The default is the last apply.",
    usage: ["ade revert [apply-id] [--yes] [--force]"],
    async run(c) {
      const ctx = c.context();
      const id = c.args[0];
      if (!boolFlag(c.flags, "yes")) {
        if (c.json || !c.io.stdinIsTTY) {
          throw usageError("Add --yes to revert without a prompt.");
        }
        const label = id === undefined ? "the last apply" : `the apply ${id}`;
        if (id !== undefined) {
          const record = await readRecord(ctx, id);
          c.out.line(
            `The apply ${record.id} changed ${record.ops.length} paths on ${record.createdAt}.`,
          );
        }
        if (!(await c.confirm(`Revert ${label} in ${ctx.home}?`))) {
          c.out.line("Nothing changed.");
          return EXIT.ok;
        }
      }
      const result = await revert(ctx, { id, force: boolFlag(c.flags, "force") });
      if (c.json) {
        c.emit(result);
        return EXIT.ok;
      }
      c.out.line(
        c.out.style(
          "green",
          `Reverted the record ${result.reverted}. New record: ${result.revertId}.`,
        ),
      );
      c.out.line(`To restore the changes again, run \`ade revert ${result.revertId}\`.`);
      return EXIT.ok;
    },
  },
  {
    name: "history",
    group: "Machine",
    summary: "List the apply and revert records.",
    usage: ["ade history"],
    async run(c) {
      const records = await listApplies(c.context());
      if (c.json) {
        c.emit(records);
      } else {
        renderHistory(c.out, records);
      }
      return EXIT.ok;
    },
  },
  {
    name: "doctor",
    group: "Machine",
    summary: "Check the profile, the secrets, the skills, and the target files.",
    usage: ["ade doctor [source]"],
    async run(c) {
      const gate = await inspectSource(c, c.args[0]);
      const report = await doctor(gate.resolved.loaded, c.context(), {
        resolver: previewResolver(c, gate),
        skipSecrets: !gate.trusted,
      });
      if (c.json) {
        c.emit({ ...report, source: gate.resolved.source, trust: gate.status.state });
      } else {
        sourceHeader(c, gate);
        renderDoctor(c.out, report);
      }
      return report.ok ? EXIT.ok : EXIT.failure;
    },
  },
  {
    name: "inventory",
    group: "Machine",
    summary: "List every file of each harness, and show which files ade syncs.",
    usage: [
      "ade inventory [--harness <harnesses>] [--all]",
      "Without --all, the list hides private and runtime files and shows their counts.",
    ],
    options: { all: { type: "boolean" } },
    async run(c) {
      const report = await inventory(c.context(), { harnesses: c.harnessFilter() });
      if (c.json) {
        c.emit(report);
      } else {
        renderInventory(c.out, report, boolFlag(c.flags, "all"));
      }
      return EXIT.ok;
    },
  },
  {
    name: "harnesses",
    group: "Machine",
    summary: "List the supported harnesses and their paths in this home.",
    usage: ["ade harnesses"],
    async run(c) {
      const ctx = c.context();
      const rows = await describeHarnesses(ctx);
      if (c.json) {
        c.emit(rows);
      } else {
        renderHarnesses(c.out, ctx.home, rows);
      }
      return EXIT.ok;
    },
  },
  {
    name: "remote",
    group: "Remote",
    summary: "Run a command on another machine over SSH. The remote needs only Node.js 22.",
    usage: [
      "ade remote <host> plan|apply|status|doctor [source] [--remote-home <dir>] [--send-secrets] [--keep-links] [--trust]",
      "ade remote <host> revert [apply-id] [--yes] [--force]",
      "ade remote <host> history|harnesses",
      "ade remote <host> capture [--out <dir>] [--include <root>:<path>]... [--name <name>]",
      "SSH options: --node <path> --ssh <program> --ssh-option <option>...",
      "Example: ade remote devbox plan --profile ~/agent-profile",
    ],
    options: {
      "remote-home": { type: "string" },
      node: { type: "string" },
      ssh: { type: "string" },
      "ssh-option": { type: "string", multiple: true },
      "send-secrets": { type: "boolean" },
      "keep-links": { type: "boolean" },
      "exit-code": { type: "boolean" },
      out: { type: "string", short: "o" },
      include: { type: "string", multiple: true },
      name: { type: "string" },
    },
    async run(c) {
      const [host, op, extra] = c.args;
      const ops = REMOTE_OPS.filter((item) => item !== "info");
      if (host === undefined || op === undefined || !(ops as readonly string[]).includes(op)) {
        throw usageError("Give the host and the command.", `Use one of: ${ops.join(", ")}.`);
      }
      if (host.startsWith("-")) {
        throw usageError(`The host must not start with '-': ${host}.`);
      }
      const remoteHome = stringFlag(c.flags, "remote-home");
      const target: RemoteTarget = {
        host,
        ssh: stringFlag(c.flags, "ssh"),
        sshOptions: listFlag(c.flags, "ssh-option"),
        node: stringFlag(c.flags, "node"),
      };
      const base = { target, ...(remoteHome === undefined ? {} : { home: remoteHome }) };
      const describe = (remote: RemoteInfo): string =>
        `${host} (${remote.hostname}, ${remote.platform}, Node.js ${remote.node})`;
      const header = (remote: RemoteInfo): void => {
        c.out.line(`${c.out.style("dim", "Remote ")}  ${describe(remote)}`);
      };
      const ship = {
        harnesses: c.harnessFilter(),
        force: boolFlag(c.flags, "force"),
        keepLinks: boolFlag(c.flags, "keep-links"),
        sendSecrets: boolFlag(c.flags, "send-secrets"),
      };
      switch (op) {
        case "plan": {
          const gate = await inspectSource(c, extra);
          const loaded = gate.resolved.loaded;
          const response = await remotePlan(loaded, c.context(), {
            ...base,
            ...ship,
            previewSecrets: !gate.trusted,
            profileLabel: profileLabel(gate),
          });
          if (c.json) {
            c.emit({ remote: response.remote, plan: response.result, notes: response.notes });
            return EXIT.ok;
          }
          header(response.remote);
          sourceHeader(c, gate);
          renderPlan(
            c.out,
            response.result,
            c.verbose,
            `${profileLabel(gate) ?? loaded.dir} -> ${host}`,
          );
          renderWarnings(c.out, response.notes);
          return EXIT.ok;
        }
        case "apply": {
          const checked = await inspectSource(c, extra);
          const ctx = c.context();
          if (!(await requireTrust(c, checked))) {
            c.out.line("Nothing changed.");
            return EXIT.ok;
          }
          const gate = await trustedGate(c, checked);
          const loaded = gate.resolved.loaded;
          if (c.json && !boolFlag(c.flags, "yes")) {
            throw usageError("Add --yes to apply without a prompt.");
          }
          const shipped = { ...base, ...ship, profileLabel: profileLabel(gate) };
          const preview = await remotePlan(loaded, ctx, shipped);
          const plan = preview.result;
          const writes = plan.summary.create + plan.summary.update + plan.summary.delete;
          if (!c.json) {
            header(preview.remote);
            sourceHeader(c, gate);
            renderPlan(c.out, plan, c.verbose, `${profileLabel(gate) ?? loaded.dir} -> ${host}`);
            renderWarnings(c.out, preview.notes);
          }
          if (writes > 0 && !boolFlag(c.flags, "yes")) {
            if (!c.io.stdinIsTTY) {
              throw usageError("Add --yes to apply without a prompt.");
            }
            c.out.line();
            if (!(await c.confirm(`Apply ${writes} changes to ${plan.home} on ${host}?`))) {
              c.out.line("Nothing changed.");
              return EXIT.ok;
            }
          }
          const response = await remoteApply(loaded, ctx, {
            ...shipped,
            expectedFingerprint: plan.fingerprint,
          });
          if (c.json) {
            c.emit({ remote: response.remote, ...response.result });
            return EXIT.ok;
          }
          c.out.line();
          if (response.result.applyId === undefined) {
            c.out.line(
              response.result.recorded > 0
                ? `Recorded ${response.result.recorded} entries in the state on ${host}. No file changed.`
                : "Nothing to apply.",
            );
            return EXIT.ok;
          }
          c.out.line(
            c.out.style(
              "green",
              `Applied ${writes} changes on ${host}. Record: ${response.result.applyId}.`,
            ),
          );
          c.out.line(`To undo, run \`ade remote ${host} revert ${response.result.applyId}\`.`);
          return EXIT.ok;
        }
        case "status": {
          const gate = await inspectSource(c, extra);
          const loaded = gate.resolved.loaded;
          const response = await remoteStatus(loaded, c.context(), {
            ...base,
            ...ship,
            previewSecrets: !gate.trusted,
            profileLabel: profileLabel(gate),
          });
          if (c.json) {
            c.emit({ remote: response.remote, ...response.result });
          } else {
            header(response.remote);
            sourceHeader(c, gate);
            renderStatus(
              c.out,
              response.result,
              c.verbose,
              `${profileLabel(gate) ?? loaded.dir} -> ${host}`,
            );
          }
          return boolFlag(c.flags, "exit-code") && !response.result.inSync ? EXIT.pending : EXIT.ok;
        }
        case "doctor": {
          const gate = await inspectSource(c, extra);
          const response = await remoteDoctor(gate.resolved.loaded, c.context(), {
            ...base,
            ...ship,
            previewSecrets: !gate.trusted,
            profileLabel: profileLabel(gate),
          });
          if (c.json) {
            c.emit({ remote: response.remote, ...response.result });
          } else {
            header(response.remote);
            sourceHeader(c, gate);
            c.out.line();
            renderDoctor(c.out, response.result);
          }
          return response.result.ok ? EXIT.ok : EXIT.failure;
        }
        case "revert": {
          if (!boolFlag(c.flags, "yes")) {
            if (c.json || !c.io.stdinIsTTY) {
              throw usageError("Add --yes to revert without a prompt.");
            }
            const label = extra === undefined ? "the last apply" : `the apply ${extra}`;
            if (!(await c.confirm(`Revert ${label} on ${host}?`))) {
              c.out.line("Nothing changed.");
              return EXIT.ok;
            }
          }
          const response = await remoteRevert({
            ...base,
            id: extra,
            force: boolFlag(c.flags, "force"),
          });
          if (c.json) {
            c.emit({ remote: response.remote, ...response.result });
            return EXIT.ok;
          }
          c.out.line(
            c.out.style(
              "green",
              `Reverted the record ${response.result.reverted} on ${host}. New record: ${response.result.revertId}.`,
            ),
          );
          return EXIT.ok;
        }
        case "history": {
          const response = await remoteHistory(base);
          if (c.json) {
            c.emit({ remote: response.remote, records: response.result });
          } else {
            header(response.remote);
            c.out.line();
            renderHistory(c.out, response.result);
          }
          return EXIT.ok;
        }
        case "harnesses": {
          const response = await remoteHarnesses(base);
          if (c.json) {
            c.emit({ remote: response.remote, harnesses: response.result });
          } else {
            header(response.remote);
            c.out.line();
            renderHarnesses(c.out, response.remote.home, response.result);
          }
          return EXIT.ok;
        }
        default: {
          const out = stringFlag(c.flags, "out");
          const dir = out === undefined ? c.profileDir() : c.resolvePath(out);
          if (!boolFlag(c.flags, "force") && !(await isEmptyDir(dir))) {
            throw new AdeError("profile-exists", `The directory is not empty: ${dir}.`, {
              hint: "Use an empty directory, or add --force to write into it.",
            });
          }
          const response = await remoteCapture({
            ...base,
            harnesses: c.harnessFilter(),
            include: listFlag(c.flags, "include").map((item) => parseRootTarget(item)),
            name: stringFlag(c.flags, "name") ?? host,
          });
          const staging = await fs.mkdtemp(path.join(os.tmpdir(), "ade-capture-"));
          let loaded: LoadedProfile;
          try {
            const staged = await importBundle(
              response.result.bundle,
              path.join(staging, "profile"),
            );
            const localized = withoutLocalPaths(staged);
            await saveProfile(staged.dir, localized.profile);
            await saveLock(staged.dir, localized.lock);
            const review = await loadProfile(staged.dir);
            if (!c.json) {
              header(response.remote);
              c.out.line();
              renderRiskItems(
                c.out,
                `The setup from ${response.remote.home} on ${host} does these things on this machine:`,
                riskSummary(review.profile, review.lock),
              );
              renderWarnings(c.out, localized.removed);
            }
            if (!boolFlag(c.flags, "trust")) {
              if (c.json || !c.io.stdinIsTTY) {
                throw new AdeError("untrusted", `The setup from ${host} needs your trust.`, {
                  hint: "Run the command in a terminal to read the summary, or add --trust.",
                });
              }
              if (!(await c.confirm(`Write the setup from ${host} into ${dir}?`))) {
                c.out.line("Nothing changed.");
                return EXIT.ok;
              }
            }
            loaded = await importBundle(await exportBundle(review), dir, {
              force: boolFlag(c.flags, "force"),
            });
          } finally {
            await fs.rm(staging, { recursive: true, force: true });
          }
          if (c.json) {
            c.emit({
              remote: response.remote,
              dir: loaded.dir,
              profile: loaded.profile,
              warnings: response.result.warnings,
              secrets: response.result.secrets,
            });
            return EXIT.ok;
          }
          c.out.line(
            `Captured the setup of ${response.remote.home} on ${host} into ${loaded.dir}.`,
          );
          c.out.line(`  harnesses     ${(loaded.profile.harnesses ?? []).join(", ") || "none"}`);
          c.out.line(`  mcp servers   ${Object.keys(loaded.profile.mcp ?? {}).length}`);
          c.out.line(`  skills        ${Object.keys(loaded.profile.skills ?? {}).length}`);
          c.out.line(
            `  settings      ${Object.keys(loaded.profile.settings ?? {}).join(", ") || "none"}`,
          );
          if (response.result.secrets.length > 0) {
            c.out.line();
            c.out.line("The profile refers to these secrets. ade did not copy their values:");
            for (const secret of response.result.secrets) {
              c.out.line(`  ${padEnd(secret.name, 24)} ${c.out.style("dim", secret.where)}`);
            }
          }
          renderWarnings(c.out, response.result.warnings);
          return EXIT.ok;
        }
      }
    },
  },
  {
    name: "use",
    group: "Share",
    summary: "Set the default profile source for this home.",
    usage: [
      "ade use <source>",
      "ade use --clear",
      "ade use",
      "Example: ade use woosal1337/ade/examples/starter",
    ],
    options: { clear: { type: "boolean" } },
    async run(c) {
      const ctx = c.context();
      if (boolFlag(c.flags, "clear")) {
        await writeDefaultProfile(ctx, undefined);
        if (c.json) {
          c.emit({ profile: null });
        } else {
          c.out.line("Removed the default profile source. ade uses $ADE_PROFILE or ~/.config/ade.");
        }
        return EXIT.ok;
      }
      const input = c.args[0];
      if (input === undefined) {
        const current = (await readDefaultProfile(ctx)) ?? null;
        if (c.json) {
          c.emit({ profile: current });
        } else {
          c.out.line(
            current ?? "No default profile source is set. ade uses $ADE_PROFILE or ~/.config/ade.",
          );
        }
        return EXIT.ok;
      }
      const gate = await inspectSource(c, input);
      await writeDefaultProfile(ctx, gate.resolved.source.canonical);
      if (c.json) {
        c.emit({
          profile: gate.resolved.source.canonical,
          source: gate.resolved.source,
          trust: gate.status.state,
        });
        return EXIT.ok;
      }
      sourceHeader(c, gate);
      c.out.line(`The default profile source is now ${gate.resolved.source.canonical}.`);
      c.out.line("Next: run `ade plan` to compare it with this machine.");
      return EXIT.ok;
    },
  },
  {
    name: "trust",
    group: "Share",
    summary: "Show, trust, or remove the trust of a Git source or a shared file.",
    usage: ["ade trust", "ade trust <source> [--yes]", "ade trust <source> --remove"],
    options: { remove: { type: "boolean" } },
    async run(c) {
      const ctx = c.context();
      const input = c.args[0];
      if (input === undefined) {
        const entries = await listTrust(ctx);
        if (c.json) {
          c.emit(entries);
          return EXIT.ok;
        }
        if (entries.length === 0) {
          c.out.line("No trusted sources exist in this home.");
        }
        for (const entry of entries) {
          c.out.line(
            `${padEnd(entry.display, 40)} ${entry.commit.slice(0, 12)}  ${entry.trustedAt}`,
          );
        }
        return EXIT.ok;
      }
      if (boolFlag(c.flags, "remove")) {
        const spec = specFor(input, ctx, c.io.cwd);
        let source: ProfileSource;
        if (spec.kind === "git") {
          source = {
            kind: "git",
            display: spec.display,
            canonical: spec.canonical,
            url: spec.url,
            ...(spec.subdir === undefined ? {} : { subdir: spec.subdir }),
          };
        } else {
          const stat = await statOrUndefined(spec.dir);
          const file = stat?.isDirectory() ? path.join(spec.dir, ADE_MD_FILE) : spec.dir;
          source = { kind: "file", display: file, canonical: file };
        }
        const removed = await removeTrust(ctx, source);
        if (c.json) {
          c.emit({ removed });
        } else {
          c.out.line(
            removed
              ? `Removed the trust of ${source.display}.`
              : `${source.display} has no trust entry.`,
          );
        }
        return EXIT.ok;
      }
      const gate = await inspectSource(c, input);
      if (gate.resolved.source.kind === "local") {
        throw usageError("A local profile needs no trust.");
      }
      const trusted = await requireTrust(c, gate, true);
      if (c.json) {
        c.emit({ trusted, source: gate.resolved.source });
      } else if (!trusted) {
        c.out.line("Nothing changed.");
      }
      return EXIT.ok;
    },
  },
  {
    name: "pack",
    group: "Share",
    summary:
      "Write a self-contained profile for a public repository. Pack refuses values that look like secrets.",
    usage: [
      "ade pack [source] --out <dir> [--repo <owner>/<repo>] [--vendor-git] [--force]",
      "Then: cd <dir>, git init, commit, and push to a public repository.",
    ],
    options: {
      out: { type: "string", short: "o" },
      repo: { type: "string" },
      "vendor-git": { type: "boolean" },
    },
    async run(c) {
      const out = stringFlag(c.flags, "out");
      if (out === undefined) {
        throw usageError("Give the output directory with --out.");
      }
      const gate = await inspectSource(c, c.args[0]);
      if (!(await requireTrust(c, gate))) {
        c.out.line("Nothing changed.");
        return EXIT.ok;
      }
      const { loaded } = gate.resolved;
      const result = await packProfile(loaded, c.context(), c.resolvePath(out), {
        vendorGit: boolFlag(c.flags, "vendor-git"),
        force: boolFlag(c.flags, "force"),
        repo: stringFlag(c.flags, "repo"),
      });
      if (c.json) {
        c.emit(result);
        return EXIT.ok;
      }
      c.out.line(`Wrote a self-contained profile with ${result.files} files to ${result.dir}.`);
      renderWarnings(c.out, [...result.warnings, ...result.notes]);
      const repo = stringFlag(c.flags, "repo") ?? "<owner>/<repo>";
      c.out.line();
      c.out.line("Next: publish the folder, then others can run:");
      c.out.line(`  ade plan ${repo}`);
      c.out.line(`  ade apply ${repo}`);
      return EXIT.ok;
    },
  },
  {
    name: "share",
    group: "Share",
    summary: "Write ADE.md: one Markdown file that others import 1:1. Share refuses token values.",
    usage: [
      "ade share [source] [--out ADE.md] [--repo <owner>/<repo>] [--vendor-git] [--force]",
      "Then commit ADE.md. Others run: ade apply <owner>/<repo>",
    ],
    options: {
      out: { type: "string", short: "o" },
      repo: { type: "string" },
      "vendor-git": { type: "boolean" },
    },
    async run(c) {
      const out = c.resolvePath(stringFlag(c.flags, "out") ?? ADE_MD_FILE);
      const existing = await statOrUndefined(out);
      if (existing !== undefined && !boolFlag(c.flags, "force")) {
        throw new AdeError("profile-exists", `The file already exists: ${out}.`, {
          hint: "Add --force to write it again.",
        });
      }
      const { loaded } = await c.resolve(c.args[0]);
      const repo = stringFlag(c.flags, "repo");
      const result = await shareProfile(loaded, c.context(), {
        source: repo,
        vendorGit: boolFlag(c.flags, "vendor-git"),
        previous: existing?.isFile() === true ? await fs.readFile(out, "utf8") : undefined,
      });
      await atomicWrite(out, result.markdown);
      if (c.json) {
        c.emit({
          file: out,
          files: result.files,
          digest: result.digest,
          warnings: result.warnings,
          notes: result.notes,
        });
        return EXIT.ok;
      }
      c.out.line(`Wrote ${out} with ${result.files} files.`);
      c.out.line(c.out.style("dim", `Digest: ${result.digest}`));
      renderWarnings(c.out, [...result.warnings, ...result.notes]);
      c.out.line();
      c.out.line("Next: commit the file. Others can then run:");
      c.out.line(`  ade plan ${repo ?? out}`);
      c.out.line(`  ade apply ${repo ?? out}`);
      return EXIT.ok;
    },
  },
  {
    name: "verify",
    group: "Share",
    summary: "Check an ADE.md or a profile: hashes, digest, schema, and the token scan.",
    usage: [
      "ade verify [ADE.md|source]",
      "Without an argument, ade checks ADE.md in the current folder.",
    ],
    async run(c) {
      const given = c.args[0];
      const defaultFile = path.join(c.io.cwd, ADE_MD_FILE);
      const input =
        given ??
        ((await statOrUndefined(defaultFile))?.isFile() ? defaultFile : await c.profileInput());
      const report = await verifyInput(c, input);
      if (c.json) {
        c.emit(report);
      } else {
        const label = report.kind === "ade-md" ? "ADE.md" : "profile";
        if (report.ok) {
          c.out.line(c.out.style("green", `The ${label} is valid: ${report.files} files.`));
        } else {
          if (report.findings.length > 0) {
            c.out.line(
              c.out.style(
                "red",
                `The ${label} holds ${report.findings.length} values that look like secrets.`,
              ),
            );
          }
          for (const finding of report.findings) {
            c.out.line(`  ${finding.file}:${finding.line}: ${finding.kind}`);
          }
          if (report.problems.length > 0) {
            c.out.line(
              c.out.style("red", `The ${label} names local paths that ade refuses to share:`),
            );
          }
          for (const problem of report.problems) {
            c.out.line(`  ${printable(problem)}`);
          }
        }
        if (report.digest !== undefined) {
          c.out.line(c.out.style("dim", `Digest: ${report.digest}`));
        }
        c.out.line();
        c.out.line("This setup does these things on a machine:");
        for (const item of report.risk) {
          c.out.line(
            `  ${item.level === "high" ? c.out.style("red", "!") : " "} ${padEnd(item.area, 12)} ${item.text}`,
          );
        }
      }
      return report.ok ? EXIT.ok : EXIT.failure;
    },
  },
  {
    name: "export",
    group: "Share",
    summary: "Write the profile into one bundle file. The bundle holds no secret values.",
    usage: ["ade export [source] [--out <file>]"],
    options: { out: { type: "string", short: "o" } },
    async run(c) {
      const { loaded } = await c.resolve(c.args[0]);
      const bundle = await exportBundle(loaded);
      const findings = scanBundle(bundle);
      if (findings.length > 0) {
        throw new AdeError(
          "conflict",
          `The profile holds ${findings.length} values that look like secrets.`,
          {
            details: findings.map((finding) => `${finding.file}:${finding.line}: ${finding.kind}`),
            hint: "Replace each value with a ${secret:NAME} reference, then export again.",
          },
        );
      }
      const text = `${escapeJsonControls(JSON.stringify(bundle, null, 2))}\n`;
      const out = stringFlag(c.flags, "out");
      if (out === undefined) {
        c.io.stdout(text);
        return EXIT.ok;
      }
      const file = c.resolvePath(out);
      await atomicWrite(file, text, 0o600);
      if (c.json) {
        c.emit({ file, files: bundle.files.length });
        return EXIT.ok;
      }
      c.out.line(`Wrote ${bundle.files.length} files to the bundle ${file}.`);
      return EXIT.ok;
    },
  },
  {
    name: "import",
    group: "Share",
    summary: "Copy a shared setup into an editable profile folder. A Git source needs trust.",
    usage: [
      "ade import <ADE.md|bundle.json|source> [--out <dir>] [--force] [--trust]",
      "Without --out, ade writes the default profile folder, so ade plan and ade apply use it.",
      "Example: ade import acme/agents",
    ],
    options: { out: { type: "string", short: "o" } },
    async run(c) {
      const file = c.args[0];
      if (file === undefined) {
        throw usageError("Give an ADE.md, a bundle file, or a source.");
      }
      const out = stringFlag(c.flags, "out");
      const dir = out === undefined ? c.profileDir() : c.resolvePath(out);
      const ctx = c.context();
      const resolved = await resolveProfile(file, ctx, {
        cwd: c.io.cwd,
        offline: boolFlag(c.flags, "offline"),
      });
      const status = await checkTrust(ctx, resolved);
      const gate: SourceGate = {
        resolved,
        status,
        trusted: status.state === "local" || status.state === "trusted",
      };
      if (!(await requireTrust(c, gate))) {
        c.out.line("Nothing changed.");
        return EXIT.ok;
      }
      const input = await exportBundle(resolved.loaded);
      const loaded = await importBundle(input, dir, { force: boolFlag(c.flags, "force") });
      await writeSchemaFile(loaded.dir);
      if (c.json) {
        c.emit({ dir: loaded.dir, profile: loaded.profile });
        return EXIT.ok;
      }
      const bare =
        c.io.env.ADE_PROFILE ?? (await readDefaultProfile(c.context())) ?? defaultProfileDir();
      const bareSpec = specFor(bare, c.context(), c.io.cwd);
      const usesDefault =
        bareSpec.kind === "local" && path.resolve(bareSpec.dir) === path.resolve(loaded.dir);
      const flag = usesDefault ? "" : ` --profile ${loaded.dir}`;
      c.out.line(`Imported the profile into ${loaded.dir}.`);
      c.out.line(`Next: run \`ade plan${flag}\` to see the changes, then \`ade apply${flag}\`.`);
      return EXIT.ok;
    },
  },
  {
    name: "schema",
    group: "Share",
    summary: "Print the JSON Schema of the profile file.",
    usage: ["ade schema"],
    async run(c) {
      c.io.stdout(`${JSON.stringify(profileJsonSchema(), null, 2)}\n`);
      return EXIT.ok;
    },
  },
];

function describeSecret(source: SecretSource): string {
  switch (source.from) {
    case "env":
      return `environment variable ${source.name}`;
    case "file":
      return `file ${source.path}`;
    case "command":
      return `command ${source.argv.join(" ")}`;
    case "keychain":
      return `Keychain ${source.service} / ${source.account}`;
  }
}

const commandMap = new Map(commands.map((command) => [command.name, command]));

function globalHelp(out: Output): void {
  out.line(`ade ${VERSION}: manage one agent development environment from one profile.`);
  out.line();
  out.line("Usage: ade <command> [options]");
  for (const group of ["Profile", "Machine", "Remote", "Share"] as const) {
    out.line();
    out.line(out.style("bold", group));
    for (const command of commands.filter((item) => item.group === group)) {
      out.line(`  ${padEnd(command.name, 11)} ${command.summary}`);
    }
  }
  out.line();
  out.line(out.style("bold", "Options"));
  out.line("  -p, --profile <dir>   Profile directory. Default: $ADE_PROFILE or ~/.config/ade");
  out.line("  --home <dir>          Target home directory. Default: the current user home");
  out.line("  --harness <list>      Limit the command to these harnesses, for example claude,pi");
  out.line("  --state-dir <dir>     State directory with the apply records");
  out.line("  --cache-dir <dir>     Cache directory for Git skill sources");
  out.line("  --json                Print JSON");
  out.line("  -y, --yes             Apply or revert without a prompt");
  out.line("  --force               Overwrite entries that changed outside ade");
  out.line("  --offline             Use only cached Git skill sources");
  out.line("  --verbose             Show the entries that already match");
  out.line("  --no-color            Print without colors");
  out.line("  -h, --help            Show help. Use `ade help <command>` for one command");
  out.line("  -v, --version         Show the version");
}

function commandHelp(out: Output, command: Command): void {
  out.line(command.summary);
  out.line();
  for (const line of command.usage) {
    out.line(`  ${line}`);
  }
  out.line();
  out.line("Run `ade --help` to show the global options.");
}

function findCommandName(tokens: readonly string[]): { name: string | undefined; index: number } {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token.startsWith("--")) {
      const option = token.slice(2);
      if (!option.includes("=") && GLOBAL_OPTIONS[option]?.type === "string") {
        index += 1;
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      const short = token.slice(1);
      const entry = Object.values(GLOBAL_OPTIONS).find((item) => item.short === short);
      if (entry?.type === "string") {
        index += 1;
      }
      continue;
    }
    return { name: token, index };
  }
  return { name: undefined, index: -1 };
}

export function processIO(): CliIO {
  return {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    env: process.env,
    cwd: process.cwd(),
    prompt: async (question) => {
      const reader = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await reader.question(question);
      } finally {
        reader.close();
      }
    },
  };
}

function reportError(
  out: Output,
  json: boolean,
  command: string,
  error: unknown,
  verbose: boolean,
): number {
  const known = isAdeError(error);
  const code = known ? error.code : "unexpected";
  if (json) {
    out.line(
      JSON.stringify({
        schemaVersion: 1,
        command,
        ok: false,
        error: {
          code,
          message: errorMessage(error),
          ...(known && error.hint !== undefined ? { hint: error.hint } : {}),
          ...(known && error.details.length > 0 ? { details: error.details } : {}),
        },
      }),
    );
  } else {
    out.error(
      `${out.style("red", "error:")} ${known ? error.message : `An unexpected failure occurred: ${errorMessage(error)}`}`,
    );
    if (known) {
      for (const detail of error.details) {
        out.error(`  - ${detail}`);
      }
      if (error.hint !== undefined) {
        out.error(`${out.style("dim", "hint:")} ${error.hint}`);
      }
    }
    if (verbose && error instanceof Error && error.stack !== undefined) {
      out.error(out.style("dim", error.stack));
    }
  }
  return known && error.code === "usage" ? EXIT.usage : EXIT.failure;
}

export async function runCli(argv: readonly string[], io: CliIO = processIO()): Promise<number> {
  const dash = argv.indexOf("--");
  const head = dash === -1 ? [...argv] : argv.slice(0, dash);
  const rest = dash === -1 ? [] : argv.slice(dash + 1);
  const plainOut = createOutput(io, !head.includes("--no-color"));
  const found = findCommandName(head);
  let name = found.name;
  if (name === "help") {
    const target = head[found.index + 1];
    const command = target === undefined ? undefined : commandMap.get(target);
    if (command === undefined) {
      globalHelp(plainOut);
    } else {
      commandHelp(plainOut, command);
    }
    return EXIT.ok;
  }
  if (name === undefined) {
    if (head.includes("--version") || head.includes("-v")) {
      io.stdout(`${VERSION}\n`);
      return EXIT.ok;
    }
    globalHelp(plainOut);
    return head.length === 0 || head.includes("--help") || head.includes("-h")
      ? EXIT.ok
      : EXIT.usage;
  }
  const command = commandMap.get(name);
  if (command === undefined) {
    return reportError(
      plainOut,
      head.includes("--json"),
      name,
      usageError(`The command is not known: ${name}.`, "Run `ade --help` to list the commands."),
      false,
    );
  }
  name = command.name;
  let parsed: { values: Flags; positionals: string[] };
  try {
    parsed = parseArgs({
      args: head,
      options: { ...GLOBAL_OPTIONS, ...(command.options ?? {}) },
      allowPositionals: true,
      strict: true,
    }) as { values: Flags; positionals: string[] };
  } catch (error) {
    return reportError(
      plainOut,
      head.includes("--json"),
      name,
      usageError(errorMessage(error), `Run \`ade help ${name}\` to show the usage.`),
      false,
    );
  }
  const flags = parsed.values;
  const positionals = [...parsed.positionals];
  positionals.splice(positionals.indexOf(name), 1);
  const json = boolFlag(flags, "json");
  const verbose = boolFlag(flags, "verbose");
  const out = createOutput(io, !boolFlag(flags, "no-color") && !json);
  if (boolFlag(flags, "help")) {
    commandHelp(out, command);
    return EXIT.ok;
  }
  let ctx: Context | undefined;
  const resolvePath = (value: string): string => {
    if (value === "~" || value.startsWith("~/")) {
      return path.join(createContext().home, value.slice(2));
    }
    return path.resolve(io.cwd, value);
  };
  const commandContext: CommandContext = {
    io,
    out,
    flags,
    args: positionals,
    rest,
    json,
    verbose,
    context() {
      if (ctx === undefined) {
        const home = stringFlag(flags, "home");
        const stateDir = stringFlag(flags, "state-dir");
        const cacheDir = stringFlag(flags, "cache-dir");
        ctx = createContext({
          ...(home === undefined ? {} : { home: resolvePath(home) }),
          ...(stateDir === undefined ? {} : { stateDir: resolvePath(stateDir) }),
          ...(cacheDir === undefined ? {} : { cacheDir: resolvePath(cacheDir) }),
        });
      }
      return ctx;
    },
    profileDir() {
      const value = stringFlag(flags, "profile");
      return value === undefined ? defaultProfileDir() : resolvePath(value);
    },
    async profileInput(positional) {
      return (
        stringFlag(flags, "profile") ??
        positional ??
        io.env.ADE_PROFILE ??
        (await readDefaultProfile(commandContext.context())) ??
        defaultProfileDir()
      );
    },
    async load() {
      const input = await commandContext.profileInput();
      const spec = specFor(input, commandContext.context(), io.cwd);
      if (spec.kind === "git") {
        throw new AdeError(
          "usage",
          `The profile comes from Git: ${spec.display}. ade cannot edit it.`,
          {
            hint: "Copy it with `ade import <source> --out <dir>`, then edit the copy.",
          },
        );
      }
      const stat = await statOrUndefined(spec.dir);
      const markdown =
        stat?.isFile() === true ||
        (stat?.isDirectory() === true &&
          (await statOrUndefined(path.join(spec.dir, PROFILE_FILE))) === undefined &&
          (await statOrUndefined(path.join(spec.dir, ADE_MD_FILE)))?.isFile() === true);
      if (markdown) {
        throw new AdeError(
          "usage",
          `The profile is an ADE.md file: ${spec.dir}. ade cannot edit it.`,
          {
            hint: "Copy it with `ade import <file> --out <dir>`, edit the copy, then run `ade share` again.",
          },
        );
      }
      return loadProfile(spec.dir);
    },
    async resolve(positional) {
      return resolveProfile(
        await commandContext.profileInput(positional),
        commandContext.context(),
        {
          cwd: io.cwd,
          offline: boolFlag(flags, "offline"),
        },
      );
    },
    harnessFilter() {
      const value = stringFlag(flags, "harness");
      return value === undefined ? undefined : parseHarnessList(value);
    },
    emit(result) {
      io.stdout(
        `${escapeJsonControls(JSON.stringify({ schemaVersion: 1, command: name, ok: true, result }, null, 2))}\n`,
      );
    },
    async confirm(question) {
      const answer = (await io.prompt(out.plain(`${question} Type yes to continue: `)))
        .trim()
        .toLowerCase();
      return answer === "yes" || answer === "y";
    },
    resolvePath,
  };
  try {
    return await command.run(commandContext);
  } catch (error) {
    return reportError(out, json, name, error, verbose);
  }
}
