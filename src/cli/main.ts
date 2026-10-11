import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { type ParseArgsConfig, parseArgs } from "node:util";
import { type Context, createContext, defaultProfileDir } from "../core/context.ts";
import { docFormatFor, parseKeyPath } from "../core/doc.ts";
import { AdeError, errorMessage, isAdeError } from "../core/errors.ts";
import { copyTree, isInside, removePath, safeJoin, statOrUndefined } from "../core/fsx.ts";
import { apply } from "../engine/apply.ts";
import { type CaptureInclude, capture, writeCapture } from "../engine/capture.ts";
import { doctor } from "../engine/doctor.ts";
import { listApplies, revert } from "../engine/history.ts";
import { readRecord } from "../engine/journal.ts";
import { computePlan } from "../engine/plan.ts";
import { status } from "../engine/status.ts";
import { updateSkills } from "../engine/update.ts";
import {
  describeHarnesses,
  getAdapter,
  parseHarnessList,
  parseSettingsKey,
} from "../harness/registry.ts";
import { exportBundle, importBundle } from "../profile/bundle.ts";
import {
  addFile,
  addMcpServer,
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
  saveLock,
  saveProfile,
} from "../profile/load.ts";
import {
  HARNESS_IDS,
  type HarnessId,
  isGitSkill,
  isLinkSkill,
  type McpServer,
  profileJsonSchema,
  type SecretSource,
} from "../profile/schema.ts";
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
import { lockGitSkill } from "../skills/source.ts";
import { VERSION } from "../version.ts";
import { type CliIO, createOutput, type Output, padEnd } from "./output.ts";
import {
  renderDoctor,
  renderHarnesses,
  renderHistory,
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
  load(): Promise<LoadedProfile>;
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
  if (
    index <= 0 ||
    target === "" ||
    !(root === "home" || (HARNESS_IDS as readonly string[]).includes(root))
  ) {
    throw usageError(
      `The file reference is not valid: ${value}.`,
      `Use home or one of ${HARNESS_IDS.join(", ")} as the root.`,
    );
  }
  return { root: root as HarnessId | "home", target: target.replaceAll("\\", "/") };
}

function rootDir(ctx: Context, root: HarnessId | "home"): string {
  return root === "home" ? ctx.home : getAdapter(root).home(ctx);
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
    usage: ["ade list [mcp|skills|settings|secrets|files|instructions]"],
    async run(c) {
      const loaded = await c.load();
      const { profile } = loaded;
      const kind = c.args[0];
      const kinds = ["mcp", "skills", "settings", "secrets", "files", "instructions"];
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
          const flags = [entry.template ? "template" : "", entry.mode ? `mode ${entry.mode}` : ""]
            .filter(Boolean)
            .join(", ");
          out.line(
            `  ${padEnd(`${entry.root}:${entry.target}`, 40)} ${entry.source}${flags ? out.style("dim", `  ${flags}`) : ""}`,
          );
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
        default:
          throw usageError("Give the kind: mcp, skill, secret, file, or instructions.");
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
    usage: ["ade remove <mcp|skill|secret|file|instructions> <name> [--purge]"],
    options: { purge: { type: "boolean" } },
    async run(c) {
      const [kind, name] = c.args;
      const kinds: EntryKind[] = ["mcp", "skill", "secret", "file", "instructions"];
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
      if (kind === "file" && boolFlag(c.flags, "purge")) {
        const entry = before.files?.find((item) => `${item.root}:${item.target}` === entryName);
        if (entry !== undefined) {
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
    usage: ["ade plan [--harness <harnesses>] [--verbose] [--offline]"],
    async run(c) {
      const loaded = await c.load();
      const ctx = c.context();
      const computed = await computePlan(loaded, ctx, {
        harnesses: c.harnessFilter(),
        force: boolFlag(c.flags, "force"),
        offline: boolFlag(c.flags, "offline"),
      });
      if (c.json) {
        c.emit(computed.plan);
        return EXIT.ok;
      }
      renderPlan(c.out, computed.plan, c.verbose);
      const writes =
        computed.plan.summary.create + computed.plan.summary.update + computed.plan.summary.delete;
      if (writes > 0) {
        c.out.line(
          computed.plan.summary.drift > 0 && !boolFlag(c.flags, "force")
            ? "Next: resolve the changes outside ade, or run `ade apply --force`."
            : "Next: run `ade apply` to make these changes.",
        );
      }
      return EXIT.ok;
    },
  },
  {
    name: "apply",
    group: "Machine",
    summary: "Make the machine match the profile. Each apply keeps a backup.",
    usage: ["ade apply [--harness <harnesses>] [--yes] [--force] [--offline]"],
    async run(c) {
      const loaded = await c.load();
      const ctx = c.context();
      const options = {
        harnesses: c.harnessFilter(),
        force: boolFlag(c.flags, "force"),
        offline: boolFlag(c.flags, "offline"),
      };
      const computed = await computePlan(loaded, ctx, options);
      const plan = computed.plan;
      const writes = plan.summary.create + plan.summary.update + plan.summary.delete;
      if (!c.json) {
        renderPlan(c.out, plan, c.verbose);
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
      });
      if (c.json) {
        c.emit({
          applyId: result.applyId,
          written: result.written,
          recorded: result.recorded,
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
    usage: ["ade status [--harness <harnesses>] [--exit-code]"],
    options: { "exit-code": { type: "boolean" } },
    async run(c) {
      const loaded = await c.load();
      const ctx = c.context();
      const report = await status(loaded, ctx, {
        harnesses: c.harnessFilter(),
        offline: boolFlag(c.flags, "offline"),
      });
      if (c.json) {
        c.emit(report);
      } else {
        renderStatus(c.out, report, c.verbose);
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
    usage: ["ade doctor"],
    async run(c) {
      const loaded = await c.load();
      const report = await doctor(loaded, c.context());
      if (c.json) {
        c.emit(report);
      } else {
        renderDoctor(c.out, report);
      }
      return report.ok ? EXIT.ok : EXIT.failure;
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
      "ade remote <host> plan|apply|status|doctor [--remote-home <dir>] [--send-secrets] [--keep-links]",
      "ade remote <host> revert [apply-id] [--yes] [--force]",
      "ade remote <host> history|harnesses",
      "ade remote <host> capture [--out <dir>] [--include <root>:<path>]... [--name <name>]",
      "SSH options: --node <path> --ssh <program> --ssh-option <option>...",
      "Example: ade remote igris plan --profile ~/agent-profile",
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
          const loaded = await c.load();
          const response = await remotePlan(loaded, c.context(), { ...base, ...ship });
          if (c.json) {
            c.emit({ remote: response.remote, plan: response.result, notes: response.notes });
            return EXIT.ok;
          }
          header(response.remote);
          renderPlan(c.out, response.result, c.verbose, `${loaded.dir} -> ${host}`);
          renderWarnings(c.out, response.notes);
          return EXIT.ok;
        }
        case "apply": {
          const loaded = await c.load();
          const ctx = c.context();
          if (c.json && !boolFlag(c.flags, "yes")) {
            throw usageError("Add --yes to apply without a prompt.");
          }
          const preview = await remotePlan(loaded, ctx, { ...base, ...ship });
          const plan = preview.result;
          const writes = plan.summary.create + plan.summary.update + plan.summary.delete;
          if (!c.json) {
            header(preview.remote);
            renderPlan(c.out, plan, c.verbose, `${loaded.dir} -> ${host}`);
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
            ...base,
            ...ship,
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
          const loaded = await c.load();
          const response = await remoteStatus(loaded, c.context(), { ...base, ...ship });
          if (c.json) {
            c.emit({ remote: response.remote, ...response.result });
          } else {
            header(response.remote);
            renderStatus(c.out, response.result, c.verbose, `${loaded.dir} -> ${host}`);
          }
          return boolFlag(c.flags, "exit-code") && !response.result.inSync ? EXIT.pending : EXIT.ok;
        }
        case "doctor": {
          const loaded = await c.load();
          const response = await remoteDoctor(loaded, c.context(), { ...base, ...ship });
          if (c.json) {
            c.emit({ remote: response.remote, ...response.result });
          } else {
            header(response.remote);
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
          const response = await remoteCapture({
            ...base,
            harnesses: c.harnessFilter(),
            include: listFlag(c.flags, "include").map((item) => parseRootTarget(item)),
            name: stringFlag(c.flags, "name") ?? host,
          });
          const loaded = await importBundle(response.result.bundle, dir, {
            force: boolFlag(c.flags, "force"),
          });
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
          header(response.remote);
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
    name: "export",
    group: "Share",
    summary: "Write the profile into one bundle file. The bundle holds no secret values.",
    usage: ["ade export [--out <file>]"],
    options: { out: { type: "string", short: "o" } },
    async run(c) {
      const loaded = await c.load();
      const bundle = await exportBundle(loaded);
      const text = `${JSON.stringify(bundle, null, 2)}\n`;
      const out = stringFlag(c.flags, "out");
      if (out === undefined) {
        c.io.stdout(text);
        return EXIT.ok;
      }
      const file = c.resolvePath(out);
      await fs.writeFile(file, text);
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
    summary: "Create a profile from a bundle file.",
    usage: ["ade import <bundle> [--out <dir>] [--force]"],
    options: { out: { type: "string", short: "o" } },
    async run(c) {
      const file = c.args[0];
      if (file === undefined) {
        throw usageError("Give the bundle file.");
      }
      const text = await fs.readFile(c.resolvePath(file), "utf8");
      let input: unknown;
      try {
        input = JSON.parse(text);
      } catch (error) {
        throw new AdeError("bundle-invalid", `The bundle is not valid JSON: ${file}.`, {
          cause: error,
        });
      }
      const out = stringFlag(c.flags, "out");
      const dir = out === undefined ? c.profileDir() : c.resolvePath(out);
      const loaded = await importBundle(input, dir, { force: boolFlag(c.flags, "force") });
      if (c.json) {
        c.emit({ dir: loaded.dir, profile: loaded.profile });
        return EXIT.ok;
      }
      c.out.line(`Imported the profile into ${loaded.dir}.`);
      c.out.line(`Next: run \`ade doctor --profile ${loaded.dir}\` to check the secrets.`);
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
    load() {
      return loadProfile(commandContext.profileDir());
    },
    harnessFilter() {
      const value = stringFlag(flags, "harness");
      return value === undefined ? undefined : parseHarnessList(value);
    },
    emit(result) {
      io.stdout(
        `${JSON.stringify({ schemaVersion: 1, command: name, ok: true, result }, null, 2)}\n`,
      );
    },
    async confirm(question) {
      const answer = (await io.prompt(`${question} Type yes to continue: `)).trim().toLowerCase();
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
