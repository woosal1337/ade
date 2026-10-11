import { cloneValue, deleteAt, getAt, isPlainObject, setAt } from "../core/doc.ts";
import { AdeError } from "../core/errors.ts";
import {
  type FileEntry,
  HARNESS_IDS,
  type HarnessId,
  type McpServer,
  type Profile,
  type SecretSource,
  type Skill,
} from "./schema.ts";

export type EntryKind =
  | "mcp"
  | "skill"
  | "secret"
  | "file"
  | "instructions"
  | "plugin"
  | "marketplace"
  | "patch";

function splitHarness(name: string): { harness: HarnessId; id: string } {
  const index = name.indexOf(":");
  const harness = name.slice(0, index);
  if (index <= 0 || !(HARNESS_IDS as readonly string[]).includes(harness)) {
    throw new AdeError("usage", `Give the entry as <harness>:<name>: ${name}.`);
  }
  return { harness: harness as HarnessId, id: name.slice(index + 1) };
}

export function addPlugin(profile: Profile, harness: HarnessId, id: string): Profile {
  const next = copy(profile);
  const plugins = { ...(next.plugins ?? {}) };
  const set = { ...(plugins[harness] ?? {}) };
  const install = [...(set.install ?? [])];
  if (install.includes(id)) {
    throw new AdeError("conflict", `The profile already installs ${id} for ${harness}.`);
  }
  install.push(id);
  set.install = install.sort();
  plugins[harness] = set;
  next.plugins = plugins;
  return next;
}

export function addMarketplace(
  profile: Profile,
  harness: HarnessId,
  name: string,
  source: string,
  replace = false,
): Profile {
  const next = copy(profile);
  const plugins = { ...(next.plugins ?? {}) };
  const set = { ...(plugins[harness] ?? {}) };
  set.marketplaces = withEntry(set.marketplaces, name, source, "marketplace", replace);
  plugins[harness] = set;
  next.plugins = plugins;
  return next;
}

function copy(profile: Profile): Profile {
  return cloneValue(profile);
}

function withEntry<T>(
  record: Record<string, T> | undefined,
  name: string,
  value: T,
  kind: string,
  replace: boolean,
): Record<string, T> {
  const next: Record<string, T> = { ...(record ?? {}) };
  if (!replace && Object.hasOwn(next, name)) {
    throw new AdeError("conflict", `The profile already has the ${kind} ${name}.`, {
      hint: "Add --replace to change the entry, or remove it first.",
    });
  }
  Object.defineProperty(next, name, {
    value: cloneValue(value),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return next;
}

export function addMcpServer(
  profile: Profile,
  name: string,
  server: McpServer,
  replace = false,
): Profile {
  const next = copy(profile);
  next.mcp = withEntry(next.mcp, name, server, "MCP server", replace);
  return next;
}

export function addSkill(profile: Profile, name: string, skill: Skill, replace = false): Profile {
  const next = copy(profile);
  next.skills = withEntry(next.skills, name, skill, "skill", replace);
  return next;
}

export function addSecret(
  profile: Profile,
  name: string,
  source: SecretSource,
  replace = false,
): Profile {
  const next = copy(profile);
  next.secrets = withEntry(next.secrets, name, source, "secret", replace);
  return next;
}

export function addFile(profile: Profile, entry: FileEntry, replace = false): Profile {
  const next = copy(profile);
  const files = [...(next.files ?? [])];
  const index = files.findIndex((item) => item.root === entry.root && item.target === entry.target);
  if (index !== -1 && !replace) {
    throw new AdeError(
      "conflict",
      `The profile already has the file ${entry.root}:${entry.target}.`,
      {
        hint: "Add --replace to change the entry, or remove it first.",
      },
    );
  }
  if (index === -1) {
    files.push(cloneValue(entry));
  } else {
    files[index] = cloneValue(entry);
  }
  next.files = files;
  return next;
}

export function removeEntry(profile: Profile, kind: EntryKind, name: string): Profile {
  const next = copy(profile);
  const missing = (): never => {
    throw new AdeError("not-found", `The profile has no ${kind} ${name}.`, {
      hint: "Run `ade list` to show the profile entries.",
    });
  };
  switch (kind) {
    case "mcp":
      if (!next.mcp || !Object.hasOwn(next.mcp, name)) {
        missing();
      }
      next.mcp = Object.fromEntries(Object.entries(next.mcp ?? {}).filter(([key]) => key !== name));
      break;
    case "skill":
      if (!next.skills || !Object.hasOwn(next.skills, name)) {
        missing();
      }
      next.skills = Object.fromEntries(
        Object.entries(next.skills ?? {}).filter(([key]) => key !== name),
      );
      break;
    case "secret":
      if (!next.secrets || !Object.hasOwn(next.secrets, name)) {
        missing();
      }
      next.secrets = Object.fromEntries(
        Object.entries(next.secrets ?? {}).filter(([key]) => key !== name),
      );
      break;
    case "file": {
      const files = next.files ?? [];
      const remaining = files.filter((item) => `${item.root}:${item.target}` !== name);
      if (remaining.length === files.length) {
        missing();
      }
      next.files = remaining;
      break;
    }
    case "instructions":
      if (next.instructions === undefined) {
        missing();
      }
      delete next.instructions;
      break;
    case "plugin":
    case "marketplace": {
      const { harness, id } = splitHarness(name);
      const set = { ...(next.plugins?.[harness] ?? {}) };
      if (kind === "plugin") {
        if (!(set.install ?? []).includes(id)) {
          missing();
        }
        set.install = (set.install ?? []).filter((item) => item !== id);
        if (set.install.length === 0) {
          delete set.install;
        }
      } else {
        if (set.marketplaces === undefined || !Object.hasOwn(set.marketplaces, id)) {
          missing();
        }
        set.marketplaces = Object.fromEntries(
          Object.entries(set.marketplaces ?? {}).filter(([key]) => key !== id),
        );
        if (Object.keys(set.marketplaces).length === 0) {
          delete set.marketplaces;
        }
      }
      const plugins = { ...(next.plugins ?? {}) };
      if (Object.keys(set).length === 0) {
        delete plugins[harness];
      } else {
        plugins[harness] = set;
      }
      next.plugins = plugins;
      break;
    }
    case "patch": {
      const patches = next.patches ?? [];
      const remaining = patches.filter((item) => `${item.root}:${item.target}` !== name);
      if (remaining.length === patches.length) {
        missing();
      }
      next.patches = remaining;
      break;
    }
  }
  return prune(next);
}

export function setSetting(
  profile: Profile,
  docKey: string,
  pointer: readonly string[],
  value: unknown,
): Profile {
  const next = copy(profile);
  const settings: Record<string, Record<string, unknown>> = { ...(next.settings ?? {}) };
  const patch: Record<string, unknown> = cloneValue(settings[docKey] ?? {});
  setAt(patch, pointer, value);
  settings[docKey] = patch;
  next.settings = settings as Profile["settings"];
  return next;
}

export function unsetSetting(
  profile: Profile,
  docKey: string,
  pointer: readonly string[],
): Profile {
  const next = copy(profile);
  const current = next.settings?.[docKey];
  if (current === undefined || getAt(current, pointer) === undefined) {
    throw new AdeError("not-found", `The profile has no setting ${docKey} ${pointer.join(".")}.`);
  }
  const patch: Record<string, unknown> = cloneValue(current);
  deleteAt(patch, pointer);
  pruneEmptyObjects(patch);
  const settings: Record<string, Record<string, unknown>> = { ...(next.settings ?? {}) };
  if (Object.keys(patch).length === 0) {
    delete settings[docKey];
  } else {
    settings[docKey] = patch;
  }
  next.settings = settings as Profile["settings"];
  return prune(next);
}

function pruneEmptyObjects(value: Record<string, unknown>): void {
  for (const [key, item] of Object.entries(value)) {
    if (isPlainObject(item)) {
      pruneEmptyObjects(item);
      if (Object.keys(item).length === 0) {
        delete value[key];
      }
    }
  }
}

function prune(profile: Profile): Profile {
  const next = { ...profile };
  for (const key of ["mcp", "skills", "secrets", "settings", "plugins"] as const) {
    const value = next[key];
    if (value !== undefined && Object.keys(value).length === 0) {
      delete next[key];
    }
  }
  if (next.files !== undefined && next.files.length === 0) {
    delete next.files;
  }
  if (next.patches !== undefined && next.patches.length === 0) {
    delete next.patches;
  }
  return next;
}
