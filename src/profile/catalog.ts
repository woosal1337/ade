import { encodePointer, formatPointer, setAt } from "../core/doc.ts";
import { AdeError, errorMessage } from "../core/errors.ts";
import { compareText, hashValue, sha256 } from "../core/hash.ts";
import { listLeaves } from "../core/merge.ts";
import { hasControlCharacter } from "../core/text.ts";
import { findSecretRefs } from "../secrets/refs.ts";
import { type Bundle, type BundleFile, parseBundle } from "./bundle.ts";
import { LOCK_FILE, PROFILE_FILE, profileText } from "./load.ts";
import {
  emptyLock,
  type FileEntry,
  isGitSkill,
  isLinkSkill,
  type Lock,
  type McpServer,
  type Profile,
} from "./schema.ts";
import { validateLock, validateProfile } from "./validate.ts";

export interface MemoryProfile {
  readonly bundle: Bundle;
  readonly profile: Profile;
  readonly lock: Lock;
  readonly files: ReadonlyMap<string, BundleFile>;
}

export type ItemKind =
  | "harnesses"
  | "instructions"
  | "skill"
  | "mcp"
  | "setting"
  | "plugin"
  | "marketplace"
  | "file"
  | "patch"
  | "secret";

export interface ItemFile {
  readonly path: string;
  readonly size: number;
  readonly executable: boolean;
  readonly text?: string;
  readonly truncated?: boolean;
}

export interface ProfileItem {
  readonly key: string;
  readonly kind: ItemKind;
  readonly group: string;
  readonly label: string;
  readonly hash: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

type SettingsPatch = NonNullable<Profile["settings"]>[string];

const TEXT_LIMIT = 16_000;
const FILE_LIMIT = 200;

function bytesOf(file: BundleFile): Buffer {
  return file.encoding === "utf8"
    ? Buffer.from(file.content, "utf8")
    : Buffer.from(file.content, "base64");
}

function parseJson(file: BundleFile, label: string): unknown {
  try {
    return JSON.parse(bytesOf(file).toString("utf8"));
  } catch (error) {
    throw new AdeError("bundle-invalid", `The bundle file ${label} is not valid JSON.`, {
      details: [errorMessage(error)],
      cause: error,
    });
  }
}

export function readBundle(input: unknown): MemoryProfile {
  const bundle = parseBundle(input);
  const files = new Map(bundle.files.map((file) => [file.path, file] as const));
  const profileFile = files.get(PROFILE_FILE);
  if (profileFile === undefined) {
    throw new AdeError("bundle-invalid", `The bundle has no ${PROFILE_FILE} file.`);
  }
  const profile = validateProfile(parseJson(profileFile, PROFILE_FILE), PROFILE_FILE);
  const lockFile = files.get(LOCK_FILE);
  const lock =
    lockFile === undefined ? emptyLock() : validateLock(parseJson(lockFile, LOCK_FILE), LOCK_FILE);
  return { bundle, profile, lock, files };
}

function filesAt(memory: MemoryProfile, relative: string): BundleFile[] {
  const exact = memory.files.get(relative);
  if (exact !== undefined) {
    return [exact];
  }
  const prefix = `${relative.replace(/\/+$/, "")}/`;
  return [...memory.files.values()]
    .filter((file) => file.path.startsWith(prefix))
    .sort((left, right) => compareText(left.path, right.path));
}

function fileHash(files: readonly BundleFile[]): string {
  return sha256(
    files
      .map(
        (file) => `${file.path} ${sha256(bytesOf(file))} ${file.executable === true ? "x" : "-"}`,
      )
      .join("\n"),
  );
}

function itemFiles(files: readonly BundleFile[], base: string): ItemFile[] {
  return files.slice(0, FILE_LIMIT).map((file) => {
    const bytes = bytesOf(file);
    const relative =
      file.path === base
        ? (file.path.split("/").pop() ?? file.path)
        : file.path.slice(base.length + 1);
    const binary = file.encoding === "base64";
    const text = binary ? undefined : bytes.toString("utf8");
    return {
      path: relative,
      size: bytes.length,
      executable: file.executable === true,
      ...(text === undefined
        ? {}
        : text.length > TEXT_LIMIT
          ? { text: text.slice(0, TEXT_LIMIT), truncated: true }
          : { text }),
    };
  });
}

function frontMatterValue(text: string | undefined, key: string): string | undefined {
  if (text === undefined || !text.startsWith("---")) {
    return undefined;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return undefined;
  }
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (match?.[1] === key && match[2] !== undefined) {
      return match[2].replace(/^["']|["']$/g, "").trim() || undefined;
    }
  }
  return undefined;
}

function fileEntryDetail(entry: FileEntry): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

export function profileItems(memory: MemoryProfile): ProfileItem[] {
  const { profile, lock } = memory;
  const items: ProfileItem[] = [];
  const add = (
    key: string,
    kind: ItemKind,
    group: string,
    label: string,
    identity: unknown,
    detail: Record<string, unknown>,
  ): void => {
    items.push({ key, kind, group, label, hash: hashValue({ kind, identity }), detail });
  };

  if (profile.harnesses !== undefined || profile.install !== undefined) {
    const detail = { harnesses: profile.harnesses ?? null, install: profile.install ?? null };
    add("harnesses", "harnesses", "harnesses", "Harnesses", detail, detail);
  }

  if (profile.instructions !== undefined) {
    const files = filesAt(memory, profile.instructions.file);
    const [first] = itemFiles(files, profile.instructions.file);
    add(
      "instructions",
      "instructions",
      "instructions",
      "Global instructions",
      { entry: profile.instructions, content: fileHash(files) },
      {
        file: profile.instructions.file,
        harnesses: profile.instructions.harnesses ?? null,
        text: first?.text ?? "",
        truncated: first?.truncated === true,
      },
    );
  }

  for (const [name, skill] of Object.entries(profile.skills ?? {}).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    if (isLinkSkill(skill)) {
      continue;
    }
    if (isGitSkill(skill)) {
      const locked = lock.skills[name];
      add(
        `skill:${name}`,
        "skill",
        "skills",
        name,
        { skill, lock: locked ?? null },
        {
          name,
          source: "git",
          git: skill.git,
          ref: skill.ref ?? "HEAD",
          subdir: skill.subdir ?? null,
          commit: locked?.commit ?? null,
          harnesses: skill.harnesses ?? null,
          files: [],
        },
      );
      continue;
    }
    const files = filesAt(memory, skill.path);
    const shown = itemFiles(files, skill.path);
    const skillMd = shown.find((file) => file.path === "SKILL.md");
    add(
      `skill:${name}`,
      "skill",
      "skills",
      name,
      { skill, content: fileHash(files) },
      {
        name,
        source: "path",
        description: frontMatterValue(skillMd?.text, "description") ?? null,
        harnesses: skill.harnesses ?? null,
        files: shown,
      },
    );
  }

  for (const [name, server] of Object.entries(profile.mcp ?? {}).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    add(`mcp:${name}`, "mcp", "mcp", name, server, { name, ...server });
  }

  for (const [docKey, patch] of Object.entries(profile.settings ?? {}).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    const leaves = listLeaves(patch);
    if (leaves.length === 0) {
      add(`setting:${docKey}`, "setting", `setting:${docKey}`, docKey, patch, {
        document: docKey,
        path: "",
        pointer: [],
        value: patch,
      });
    }
    for (const [pointer, value] of leaves) {
      add(
        `setting:${docKey}:${encodePointer(pointer)}`,
        "setting",
        `setting:${docKey}`,
        formatPointer(pointer),
        value,
        { document: docKey, path: formatPointer(pointer), pointer: [...pointer], value },
      );
    }
  }

  for (const [harness, set] of Object.entries(profile.plugins ?? {}).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    for (const [name, source] of Object.entries(set?.marketplaces ?? {})) {
      add(`plugin:${harness}:marketplace:${name}`, "marketplace", "plugins", name, source, {
        harness,
        name,
        source,
      });
    }
    for (const id of set?.install ?? []) {
      add(`plugin:${harness}:install:${id}`, "plugin", "plugins", id, id, { harness, id });
    }
  }

  for (const entry of profile.files ?? []) {
    const files = entry.source === undefined ? [] : filesAt(memory, entry.source);
    add(
      `file:${entry.root}:${entry.target}`,
      "file",
      "files",
      entry.root === "home" ? `~/${entry.target}` : `${entry.root}:${entry.target}`,
      { entry, content: fileHash(files) },
      {
        ...fileEntryDetail(entry),
        files: entry.source === undefined ? [] : itemFiles(files, entry.source),
      },
    );
  }

  for (const entry of profile.patches ?? []) {
    const files = filesAt(memory, entry.source);
    const [first] = itemFiles(files, entry.source);
    add(
      `patch:${entry.root}:${entry.target}`,
      "patch",
      "patches",
      `${entry.root}:${entry.target}`,
      { entry, content: fileHash(files) },
      {
        root: entry.root,
        target: entry.target,
        text: first?.text ?? "",
        truncated: first?.truncated === true,
      },
    );
  }

  for (const [name, source] of Object.entries(profile.secrets ?? {}).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    add(
      `secret:${name}`,
      "secret",
      "secrets",
      name,
      { name, from: source.from },
      {
        name,
        from: source.from,
      },
    );
  }

  return items;
}

export interface PublicProfile {
  readonly bundle: Bundle;
  readonly profile: Profile;
  readonly keys: readonly string[];
}

function addFiles(target: Map<string, BundleFile>, files: readonly BundleFile[]): void {
  for (const file of files) {
    target.set(file.path, file);
  }
}

function collectRefs(value: unknown, found: Set<string>): void {
  findSecretRefs(value, found);
}

export function publicProfile(
  memory: MemoryProfile,
  approved: ReadonlySet<string>,
  createdAt: Date,
): PublicProfile | undefined {
  const source = memory.profile;
  const profile: Profile = { version: 1 };
  if (source.name !== undefined) {
    profile.name = source.name;
  }
  if (source.description !== undefined) {
    profile.description = source.description;
  }
  const files = new Map<string, BundleFile>();
  const refs = new Set<string>();
  const keys: string[] = [];
  const take = (key: string): boolean => {
    if (!approved.has(key)) {
      return false;
    }
    keys.push(key);
    return true;
  };

  if (take("harnesses")) {
    if (source.harnesses !== undefined) {
      profile.harnesses = source.harnesses;
    }
    if (source.install !== undefined) {
      profile.install = source.install;
    }
  }
  if (source.instructions !== undefined && take("instructions")) {
    profile.instructions = source.instructions;
    addFiles(files, filesAt(memory, source.instructions.file));
  }

  const lockSkills: Lock["skills"] = {};
  for (const [name, skill] of Object.entries(source.skills ?? {})) {
    if (isLinkSkill(skill) || !take(`skill:${name}`)) {
      continue;
    }
    profile.skills = { ...(profile.skills ?? {}), [name]: skill };
    if (isGitSkill(skill)) {
      const locked = memory.lock.skills[name];
      if (locked !== undefined) {
        lockSkills[name] = locked;
      }
    } else {
      addFiles(files, filesAt(memory, skill.path));
    }
  }

  for (const [name, server] of Object.entries(source.mcp ?? {})) {
    if (take(`mcp:${name}`)) {
      profile.mcp = { ...(profile.mcp ?? {}), [name]: server as McpServer };
      collectRefs(server, refs);
    }
  }

  for (const [docKey, patch] of Object.entries(source.settings ?? {})) {
    const leaves = listLeaves(patch);
    const kept: Record<string, unknown> = {};
    let any = false;
    if (leaves.length === 0 && take(`setting:${docKey}`)) {
      any = true;
    }
    for (const [pointer, value] of leaves) {
      if (take(`setting:${docKey}:${encodePointer(pointer)}`)) {
        setAt(kept, pointer, value);
        collectRefs(value, refs);
        any = true;
      }
    }
    if (any) {
      profile.settings = { ...(profile.settings ?? {}), [docKey]: kept as SettingsPatch };
    }
  }

  for (const [harness, set] of Object.entries(source.plugins ?? {})) {
    const marketplaces = Object.entries(set?.marketplaces ?? {}).filter(([name]) =>
      take(`plugin:${harness}:marketplace:${name}`),
    );
    const install = (set?.install ?? []).filter((id) => take(`plugin:${harness}:install:${id}`));
    if (marketplaces.length > 0 || install.length > 0) {
      profile.plugins = {
        ...(profile.plugins ?? {}),
        [harness]: {
          ...(marketplaces.length > 0 ? { marketplaces: Object.fromEntries(marketplaces) } : {}),
          ...(install.length > 0 ? { install } : {}),
        },
      };
    }
  }

  for (const entry of source.files ?? []) {
    if (!take(`file:${entry.root}:${entry.target}`)) {
      continue;
    }
    profile.files = [...(profile.files ?? []), entry];
    if (entry.source !== undefined) {
      const entryFiles = filesAt(memory, entry.source);
      addFiles(files, entryFiles);
      if (entry.template === true) {
        for (const file of entryFiles) {
          collectRefs(bytesOf(file).toString("utf8"), refs);
        }
      }
    }
  }

  for (const entry of source.patches ?? []) {
    if (take(`patch:${entry.root}:${entry.target}`)) {
      profile.patches = [...(profile.patches ?? []), entry];
      addFiles(files, filesAt(memory, entry.source));
    }
  }

  for (const name of Object.keys(source.secrets ?? {})) {
    if (take(`secret:${name}`)) {
      refs.add(name);
    }
  }
  if (keys.length === 0) {
    return undefined;
  }
  if (refs.size > 0) {
    profile.secrets = Object.fromEntries(
      [...refs].sort(compareText).map((name) => [name, { from: "env" as const, name }]),
    );
  }

  const validated = validateProfile(profile, "the public profile");
  const bundleFiles: BundleFile[] = [
    { path: PROFILE_FILE, encoding: "utf8", content: profileText(validated) },
  ];
  if (Object.keys(lockSkills).length > 0) {
    bundleFiles.push({
      path: LOCK_FILE,
      encoding: "utf8",
      content: `${JSON.stringify({ version: 1, skills: lockSkills }, null, 2)}\n`,
    });
  }
  for (const file of [...files.values()].sort((left, right) =>
    compareText(left.path, right.path),
  )) {
    if (file.path !== PROFILE_FILE && file.path !== LOCK_FILE) {
      bundleFiles.push(file);
    }
  }
  return {
    bundle: {
      format: "ade-bundle",
      version: 1,
      createdAt: createdAt.toISOString(),
      ...(validated.name === undefined ? {} : { name: validated.name }),
      files: bundleFiles,
    },
    profile: validated,
    keys,
  };
}

export function isItemKey(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && !hasControlCharacter(value);
}

export function bundleDigest(memory: MemoryProfile): string {
  return sha256(
    [...memory.files.values()]
      .sort((left, right) => compareText(left.path, right.path))
      .map(
        (file) => `${file.path} ${sha256(bytesOf(file))} ${file.executable === true ? "x" : "-"}`,
      )
      .join("\n"),
  );
}
