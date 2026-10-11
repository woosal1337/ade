import path from "node:path";
import type { z } from "zod";
import { createContext } from "../core/context.ts";
import { docFormatFor } from "../core/doc.ts";
import { AdeError, errorMessage } from "../core/errors.ts";
import { isSafeRelative } from "../core/fsx.ts";
import { getAdapter, listAdapters, parseSettingsKey, rootDir } from "../harness/registry.ts";
import { findSecretRefs } from "../secrets/refs.ts";
import { type HarnessId, type Lock, LockSchema, type Profile, ProfileSchema } from "./schema.ts";

function formatIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length === 0 ? "(root)" : issue.path.map(String).join(".");
  return `${where}: ${issue.message}`;
}

export function validateProfile(input: unknown, label: string): Profile {
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdeError("profile-invalid", `The profile is not valid: ${label}.`, {
      details: parsed.error.issues.map(formatIssue),
      hint: "Correct the listed fields. Run `ade schema` to show the full format.",
    });
  }
  const problems = semanticProblems(parsed.data);
  if (problems.length > 0) {
    throw new AdeError("profile-invalid", `The profile is not valid: ${label}.`, {
      details: problems,
      hint: "Correct the listed fields, then run the command again.",
    });
  }
  return parsed.data;
}

export function validateLock(input: unknown, label: string): Lock {
  const parsed = LockSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdeError("profile-invalid", `The lock file is not valid: ${label}.`, {
      details: parsed.error.issues.map(formatIssue),
      hint: "Run `ade update` to write the lock file again.",
    });
  }
  return parsed.data;
}

const sampleContext = createContext({ home: path.resolve("/ade-sample-home"), env: {} });

export function semanticProblems(profile: Profile): string[] {
  const problems: string[] = [];
  for (const [key, patch] of Object.entries(profile.settings ?? {})) {
    let parsed: ReturnType<typeof parseSettingsKey>;
    try {
      parsed = parseSettingsKey(key);
    } catch (error) {
      problems.push(`settings.${key}: ${errorMessage(error)}`);
      continue;
    }
    const { root, harness, file } = parsed;
    const adapter = harness === undefined ? undefined : getAdapter(harness);
    if (file === undefined) {
      for (const reserved of adapter?.reservedSettingsKeys ?? []) {
        if (Object.hasOwn(patch, reserved)) {
          problems.push(
            `settings.${key}.${reserved}: ade manages this key through its mcp or plugins section.`,
          );
        }
      }
      continue;
    }
    if (!isSafeRelative(file)) {
      problems.push(`settings.${key}: Use a relative file path inside the ${root} root.`);
      continue;
    }
    if (docFormatFor(file) === undefined) {
      problems.push(`settings.${key}: Use a file that ends with .json or .toml.`);
    }
    const target = path.resolve(rootDir(sampleContext, root), file);
    for (const other of listAdapters()) {
      const mcp = other.mcpLocation(sampleContext);
      if (target === path.resolve(mcp.path)) {
        const reserved = mcp.pointer[0] ?? "";
        if (Object.hasOwn(patch, reserved)) {
          problems.push(`settings.${key}.${reserved}: Use the mcp section for MCP servers.`);
        }
      }
      if (target === path.resolve(other.settingsLocation(sampleContext).path)) {
        problems.push(`settings.${key}: Use the key "${other.id}" for the main settings file.`);
      }
    }
  }
  for (const [harness, set] of Object.entries(profile.plugins ?? {})) {
    const support = getAdapter(harness as HarnessId).plugins;
    if (support === undefined) {
      problems.push(`plugins.${harness}: ade has no plugin support for this harness.`);
      continue;
    }
    if (!support.marketplaces && Object.keys(set?.marketplaces ?? {}).length > 0) {
      problems.push(`plugins.${harness}.marketplaces: This harness has no marketplace command.`);
    }
  }
  for (const [index, entry] of (profile.files ?? []).entries()) {
    if (entry.source === undefined && entry.symlink === undefined) {
      problems.push(`files.${index}: Give a source, a symlink, or both.`);
    }
    if (
      entry.symlink !== undefined &&
      (entry.template === true || entry.once === true || entry.mode !== undefined)
    ) {
      problems.push(`files.${index}: A symlink entry has no template, once, or mode.`);
    }
  }
  const patchTargets = new Set<string>();
  for (const [index, entry] of (profile.patches ?? []).entries()) {
    const id = `${entry.root}:${path.normalize(entry.target)}`;
    if (patchTargets.has(id)) {
      problems.push(`patches.${index}: Another patch has the same target: ${id}.`);
    }
    patchTargets.add(id);
  }
  const declared = new Set(Object.keys(profile.secrets ?? {}));
  for (const name of findSecretRefs([profile.mcp, profile.settings])) {
    if (!declared.has(name)) {
      problems.push(`secrets.${name}: Declare this secret. The profile refers to it.`);
    }
  }
  for (const name of Object.keys(profile.skills ?? {})) {
    if (name.toLowerCase() === "synced") {
      problems.push(`skills.${name}: Claude Code reserves this name. Use another name.`);
    }
  }
  const targets = new Set<string>();
  for (const [index, entry] of (profile.files ?? []).entries()) {
    const id = `${entry.root}:${path.normalize(entry.target)}`;
    if (targets.has(id)) {
      problems.push(`files.${index}: Another entry writes the same target: ${id}.`);
    }
    targets.add(id);
  }
  for (const [name, server] of Object.entries(profile.mcp ?? {})) {
    const allowed = server.harnesses;
    for (const harness of Object.keys(server.overrides ?? {})) {
      if (allowed !== undefined && !(allowed as readonly string[]).includes(harness)) {
        problems.push(`mcp.${name}.overrides.${harness}: The server does not target this harness.`);
      }
    }
  }
  return problems;
}
