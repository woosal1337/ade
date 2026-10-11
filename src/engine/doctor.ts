import fs from "node:fs/promises";
import path from "node:path";
import { type Context, displayPath } from "../core/context.ts";
import { loadDoc } from "../core/doc.ts";
import { AdeError, errorMessage, isAdeError } from "../core/errors.ts";
import { lstatOrUndefined, safeJoin, statOrUndefined } from "../core/fsx.ts";
import { getAdapter, parseSettingsKey, sharedSkillsDir } from "../harness/registry.ts";
import type { LoadedProfile } from "../profile/load.ts";
import { isGitSkill, isLinkSkill } from "../profile/schema.ts";
import { findSecretRefs } from "../secrets/refs.ts";
import { type CommandRunner, createSecretResolver, expandUserPath } from "../secrets/resolve.ts";
import { treeCacheDir } from "../skills/git.ts";
import { activeHarnesses } from "./desired.ts";
import { computePlan } from "./plan.ts";

export type CheckLevel = "ok" | "warn" | "error";

export interface Check {
  readonly level: CheckLevel;
  readonly area: string;
  readonly message: string;
  readonly hint?: string;
}

export interface DoctorReport {
  readonly checks: readonly Check[];
  readonly ok: boolean;
}

export interface DoctorOptions {
  readonly runner?: CommandRunner | undefined;
}

function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (field?.[1] !== undefined) {
      fields[field[1]] = (field[2] ?? "").trim();
    }
  }
  return fields;
}

async function danglingLinks(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const dangling: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    const link = await lstatOrUndefined(full);
    if (link?.isSymbolicLink() && (await statOrUndefined(full)) === undefined) {
      dangling.push(full);
    }
  }
  return dangling;
}

export async function doctor(
  loaded: LoadedProfile,
  ctx: Context,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: Check[] = [];
  const add = (level: CheckLevel, area: string, message: string, hint?: string): void => {
    checks.push({ level, area, message, ...(hint === undefined ? {} : { hint }) });
  };
  const { profile } = loaded;
  add("ok", "profile", `The profile is valid: ${loaded.dir}.`);

  const active = await activeHarnesses(loaded, ctx);
  for (const id of active.harnesses) {
    add("ok", "harness", `${getAdapter(id).label} is a target.`);
  }
  for (const warning of active.warnings) {
    add("warn", "harness", warning);
  }
  if (active.harnesses.length === 0) {
    add("warn", "harness", "The profile targets no installed harness.", "Set the harnesses field.");
  }

  const resolver = createSecretResolver(profile, ctx, options.runner);
  const referenced = findSecretRefs([profile.mcp, profile.settings]);
  for (const name of Object.keys(profile.secrets ?? {})) {
    try {
      await resolver.resolve(name);
      add("ok", "secret", `The secret ${name} resolves.`);
    } catch (error) {
      add(
        "error",
        "secret",
        isAdeError(error) ? error.message : errorMessage(error),
        isAdeError(error) ? error.hint : undefined,
      );
    }
    if (!referenced.has(name)) {
      const templated = (profile.files ?? []).some((entry) => entry.template === true);
      if (!templated) {
        add("warn", "secret", `The profile does not use the secret ${name}.`);
      }
    }
  }

  for (const [name, skill] of Object.entries(profile.skills ?? {})) {
    if (isGitSkill(skill)) {
      const locked = loaded.lock.skills[name];
      if (locked === undefined) {
        add(
          "error",
          "skill",
          `The skill ${name} has no lock entry.`,
          `Run \`ade update ${name}\`.`,
        );
      } else if (
        !(await statOrUndefined(path.join(treeCacheDir(ctx, locked.commit, locked.subdir), "tree")))
      ) {
        add("warn", "skill", `The skill ${name} is not in the cache. Apply fetches it.`);
      } else {
        add("ok", "skill", `The skill ${name} is locked at ${locked.commit.slice(0, 12)}.`);
      }
      continue;
    }
    if (isLinkSkill(skill)) {
      const target = expandUserPath(skill.link, ctx);
      if ((await statOrUndefined(path.join(target, "SKILL.md")))?.isFile()) {
        add("ok", "skill", `The skill ${name} links to ${displayPath(ctx, target)}.`);
      } else {
        add(
          "warn",
          "skill",
          `The skill ${name} links to a path without SKILL.md: ${displayPath(ctx, target)}.`,
          "Clone the source on this machine, or change the skill source.",
        );
      }
      continue;
    }
    try {
      const dir = safeJoin(loaded.dir, skill.path, "the profile directory");
      const text = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
      const fields = frontmatter(text);
      if (!fields.name || !fields.description) {
        add("warn", "skill", `The skill ${name} has no name or description in its frontmatter.`);
      } else if (fields.name !== name) {
        add("warn", "skill", `The skill ${name} declares the name ${fields.name}.`);
      } else {
        add("ok", "skill", `The skill ${name} is complete.`);
      }
    } catch (error) {
      add("error", "skill", `The skill ${name} has no SKILL.md file.`, errorMessage(error));
    }
  }

  for (const entry of profile.files ?? []) {
    try {
      const source = safeJoin(loaded.dir, entry.source, "the profile directory");
      if (!(await statOrUndefined(source))?.isFile()) {
        throw new AdeError("not-found", `The file source does not exist: ${entry.source}.`);
      }
      add("ok", "file", `The file ${entry.root}:${entry.target} has its source.`);
    } catch (error) {
      add("error", "file", errorMessage(error));
    }
  }

  const documents = new Map<string, "json" | "toml">();
  for (const id of active.harnesses) {
    const adapter = getAdapter(id);
    const mcpLocation = adapter.mcpLocation(ctx);
    documents.set(mcpLocation.path, mcpLocation.format);
    const settings = adapter.settingsLocation(ctx);
    documents.set(settings.path, settings.format);
  }
  for (const key of Object.keys(profile.settings ?? {})) {
    const { harness, file } = parseSettingsKey(key);
    if (file !== undefined && active.harnesses.includes(harness)) {
      const target = path.join(getAdapter(harness).home(ctx), file);
      documents.set(target, file.endsWith(".toml") ? "toml" : "json");
    }
  }
  for (const [file, format] of documents) {
    try {
      const doc = await loadDoc(file, format);
      if (doc.exists) {
        add("ok", "target", `${displayPath(ctx, file)} is valid ${format.toUpperCase()}.`);
      }
    } catch (error) {
      add("error", "target", errorMessage(error), isAdeError(error) ? error.hint : undefined);
    }
  }

  const linkDirs = [sharedSkillsDir(ctx)];
  for (const id of active.harnesses) {
    const dir = getAdapter(id).skillsDir(ctx);
    if (dir !== undefined) {
      linkDirs.push(dir);
    }
  }
  for (const dir of linkDirs) {
    for (const link of await danglingLinks(dir)) {
      add(
        "warn",
        "skill",
        `The link has no target: ${displayPath(ctx, link)}.`,
        "Remove the link.",
      );
    }
  }

  try {
    const computed = await computePlan(loaded, ctx, {
      offline: true,
      resolver,
      ...(options.runner === undefined ? {} : { runner: options.runner }),
    });
    const { summary } = computed.plan;
    const pending = summary.create + summary.update + summary.delete;
    if (summary.drift > 0) {
      add(
        "warn",
        "state",
        `${summary.drift} managed entries changed outside ade.`,
        "Run `ade status` to show them.",
      );
    }
    add(
      pending === 0 ? "ok" : "warn",
      "state",
      pending === 0 ? "The machine matches the profile." : `${pending} changes wait for apply.`,
      pending === 0 ? undefined : "Run `ade plan` to show them.",
    );
  } catch (error) {
    add("error", "state", errorMessage(error), isAdeError(error) ? error.hint : undefined);
  }

  return { checks, ok: !checks.some((check) => check.level === "error") };
}
