import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { cloneValue, deleteAt, docFormatFor, getAt, isPlainObject, loadDoc } from "../core/doc.ts";
import { AdeError, errnoCode } from "../core/errors.ts";
import {
  copyTree,
  ensureDir,
  isEmptyDir,
  isInside,
  lstatOrUndefined,
  readLinkAbsolute,
  removePath,
  safeJoin,
  statOrUndefined,
  treeHash,
} from "../core/fsx.ts";
import { compareText, hashValue, sha256 } from "../core/hash.ts";
import { mergeDiff } from "../core/merge.ts";
import {
  detectHarnesses,
  getAdapter,
  sharedInstructionsPath,
  sharedRoot,
  sharedSkillsDir,
} from "../harness/registry.ts";
import type { ResolvedMcpServer } from "../harness/types.ts";
import {
  type LoadedProfile,
  loadProfile,
  SCHEMA_FILE,
  saveProfile,
  writeSchemaFile,
} from "../profile/load.ts";
import {
  ENTRY_NAME_PATTERN,
  type FileEntry,
  HARNESS_IDS,
  type HarnessId,
  type McpServer,
  type Profile,
  type SecretSource,
  type Skill,
} from "../profile/schema.ts";
import { templateHome, templateHomeDeep } from "../secrets/refs.ts";
import { SCHEME_PREFIX, SENSITIVE_KEY, TOKEN_PATTERN } from "../secrets/scan.ts";

export interface CaptureInclude {
  readonly root: HarnessId | "home";
  readonly target: string;
}

export interface CaptureOptions {
  readonly harnesses?: readonly HarnessId[] | undefined;
  readonly include?: readonly CaptureInclude[] | undefined;
  readonly name?: string | undefined;
}

export interface CapturedFile {
  readonly path: string;
  readonly kind: "file" | "dir";
  readonly source?: string;
  readonly content?: Buffer;
}

export interface CapturedSecret {
  readonly name: string;
  readonly where: string;
}

export interface CaptureResult {
  readonly profile: Profile;
  readonly files: readonly CapturedFile[];
  readonly warnings: readonly string[];
  readonly secrets: readonly CapturedSecret[];
}

const CONTAINER_KEYS = new Set([
  "headers",
  "http_headers",
  "env",
  "overrides",
  "claude",
  "codex",
  "cursor",
  "grok",
  "pi",
]);

class SecretCollector {
  readonly sources: Record<string, SecretSource> = {};
  readonly found: CapturedSecret[] = [];
  readonly #byValue = new Map<string, string>();

  #nameFor(base: string, value: string): string {
    const known = this.#byValue.get(value);
    if (known !== undefined) {
      return known;
    }
    const clean =
      base
        .toUpperCase()
        .replace(/[^A-Z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/^([0-9])/, "_$1") || "SECRET";
    let name = clean;
    for (let index = 2; Object.hasOwn(this.sources, name); index += 1) {
      name = `${clean}_${index}`;
    }
    this.sources[name] = { from: "env", name };
    this.#byValue.set(value, name);
    return name;
  }

  #looksSecret(key: string | undefined, value: string): boolean {
    if (value.length < 8 || value.includes("${") || value.startsWith("!")) {
      return false;
    }
    if (TOKEN_PATTERN.test(value)) {
      return true;
    }
    if (key === undefined || !SENSITIVE_KEY.test(key)) {
      return false;
    }
    if (/^(true|false|null|[0-9.]+)$/i.test(value) || /^https?:\/\/[^@]*$/i.test(value)) {
      return false;
    }
    return !/^[A-Z][A-Z0-9_]*$/.test(value);
  }

  scrubString(value: string, key: string | undefined, base: string, where: string): string {
    if (!this.#looksSecret(key, value)) {
      const token = TOKEN_PATTERN.exec(value);
      if (token?.[0] !== undefined && value.includes(token[0])) {
        const name = this.#nameFor(base, token[0]);
        this.found.push({ name, where });
        return value.replace(token[0], `\${secret:${name}}`);
      }
      return value;
    }
    const scheme = SCHEME_PREFIX.exec(value);
    const secret = scheme?.[2] ?? value;
    const name = this.#nameFor(base, secret);
    this.found.push({ name, where });
    return scheme === null ? `\${secret:${name}}` : `${scheme[1]} \${secret:${name}}`;
  }

  scrub(value: unknown, key: string | undefined, base: string, where: string): unknown {
    if (typeof value === "string") {
      return this.scrubString(value, key, base, where);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.scrub(item, key, base, where));
    }
    if (isPlainObject(value)) {
      const result: Record<string, unknown> = {};
      for (const [childKey, item] of Object.entries(value)) {
        const childBase = /^[A-Z][A-Z0-9_]*$/.test(childKey)
          ? childKey
          : CONTAINER_KEYS.has(childKey)
            ? base
            : `${base}_${childKey}`;
        Object.defineProperty(result, childKey, {
          value: this.scrub(item, childKey, childBase, `${where}.${childKey}`),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    }
    return value;
  }
}

function withoutNulls(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null) {
      continue;
    }
    Object.defineProperty(result, key, {
      value: withoutNulls(item),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

async function readIfFile(file: string): Promise<Buffer | undefined> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? await fs.readFile(file) : undefined;
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
}

interface SkillCandidate {
  readonly name: string;
  readonly real: string;
  readonly hash: string;
  readonly location: string;
  readonly linkTarget: string | undefined;
}

async function listSkillCandidates(dir: string): Promise<SkillCandidate[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const candidates: SkillCandidate[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".") || name.toLowerCase() === "synced" || !ENTRY_NAME_PATTERN.test(name)) {
      continue;
    }
    const full = path.join(dir, name);
    const stat = await statOrUndefined(full);
    if (!stat?.isDirectory() || !(await statOrUndefined(path.join(full, "SKILL.md")))?.isFile()) {
      continue;
    }
    const real = await fs.realpath(full);
    const link = await lstatOrUndefined(full);
    const linkTarget = link?.isSymbolicLink() === true ? await readLinkAbsolute(full) : undefined;
    candidates.push({ name, real, hash: await treeHash(real), location: full, linkTarget });
  }
  return candidates;
}

async function readSkillOrigins(
  ctx: Context,
): Promise<Record<string, { git: string; subdir?: string }>> {
  const text = await readIfFile(path.join(sharedRoot(ctx), ".skill-lock.json"));
  if (text === undefined) {
    return {};
  }
  try {
    const parsed = JSON.parse(text.toString("utf8")) as unknown;
    const skills = isPlainObject(parsed) && isPlainObject(parsed.skills) ? parsed.skills : {};
    const origins: Record<string, { git: string; subdir?: string }> = {};
    for (const [name, entry] of Object.entries(skills)) {
      if (!isPlainObject(entry) || typeof entry.sourceUrl !== "string") {
        continue;
      }
      const skillPath = typeof entry.skillPath === "string" ? entry.skillPath : undefined;
      const subdir = skillPath === undefined ? undefined : path.posix.dirname(skillPath);
      origins[name] = {
        git: entry.sourceUrl,
        ...(subdir === undefined || subdir === "." ? {} : { subdir }),
      };
    }
    return origins;
  } catch {
    return {};
  }
}

function pickMajority<T>(entries: readonly { harness: HarnessId; key: string; value: T }[]): {
  key: string;
  value: T;
  harnesses: HarnessId[];
} {
  const groups = new Map<string, { value: T; harnesses: HarnessId[] }>();
  for (const entry of entries) {
    const group = groups.get(entry.key);
    if (group === undefined) {
      groups.set(entry.key, { value: entry.value, harnesses: [entry.harness] });
    } else {
      group.harnesses.push(entry.harness);
    }
  }
  let best: { key: string; value: T; harnesses: HarnessId[] } | undefined;
  for (const [key, group] of groups) {
    if (best === undefined || group.harnesses.length > best.harnesses.length) {
      best = { key, ...group };
    }
  }
  if (best === undefined) {
    throw new AdeError("not-found", "No entries to choose from.");
  }
  return best;
}

export async function capture(ctx: Context, options: CaptureOptions = {}): Promise<CaptureResult> {
  const warnings: string[] = [];
  const files: CapturedFile[] = [];
  const secrets = new SecretCollector();
  const detections = await detectHarnesses(ctx);
  const harnesses =
    options.harnesses === undefined
      ? detections.filter((item) => item.installed).map((item) => item.id)
      : HARNESS_IDS.filter((id) => options.harnesses?.includes(id));
  if (harnesses.length === 0) {
    warnings.push("No harness is installed in this home. The profile has no harness entries.");
  }
  const profile: Profile = {
    $schema: `./${SCHEMA_FILE}`,
    version: 1,
    name: options.name ?? "captured",
    description: `Captured on ${ctx.now().toISOString().slice(0, 10)}.`,
    ...(harnesses.length > 0 ? { harnesses: [...harnesses] } : {}),
    install: "auto",
  };

  const instructionVotes: { harness: HarnessId; key: string; value: Buffer }[] = [];
  const instructionHarnesses: HarnessId[] = [];
  for (const id of harnesses) {
    const target = getAdapter(id).instructionsPath(ctx);
    if (target === undefined) {
      continue;
    }
    instructionHarnesses.push(id);
    const content = await readIfFile(target);
    if (content !== undefined) {
      instructionVotes.push({ harness: id, key: sha256(content), value: content });
    }
  }
  const sharedInstructions = await readIfFile(sharedInstructionsPath(ctx));
  if (instructionVotes.length > 0 || sharedInstructions !== undefined) {
    const chosen =
      instructionVotes.length > 0
        ? pickMajority(instructionVotes)
        : { key: "", value: sharedInstructions as Buffer, harnesses: [] as HarnessId[] };
    for (const vote of instructionVotes) {
      if (vote.key !== chosen.key) {
        warnings.push(
          `The instructions of ${getAdapter(vote.harness).label} differ. ade captures the most common version.`,
        );
      }
    }
    files.push({ path: "AGENTS.md", kind: "file", content: chosen.value });
    const targets = chosen.harnesses.length > 0 ? chosen.harnesses : instructionHarnesses;
    profile.instructions = {
      file: "AGENTS.md",
      ...(targets.length === instructionHarnesses.length ? {} : { harnesses: targets }),
    };
  }

  const servers = new Map<
    string,
    {
      harness: HarnessId;
      key: string;
      value: ResolvedMcpServer;
      override?: Record<string, unknown>;
    }[]
  >();
  for (const id of harnesses) {
    const adapter = getAdapter(id);
    const location = adapter.mcpLocation(ctx);
    const doc = await loadDoc(location.path, location.format);
    const entries = getAt(doc.data, location.pointer);
    if (!isPlainObject(entries)) {
      continue;
    }
    for (const [name, native] of Object.entries(entries)) {
      if (!ENTRY_NAME_PATTERN.test(name)) {
        warnings.push(`${adapter.label} MCP server ${name}: the name is not valid. ade skips it.`);
        continue;
      }
      const parsed = adapter.fromNativeMcp(native);
      if (!parsed.ok) {
        warnings.push(`${adapter.label} MCP server ${name}: ${parsed.reason} ade skips it.`);
        continue;
      }
      const reproduced = adapter.toNativeMcp(parsed.server).value;
      const override = isPlainObject(native) ? mergeDiff(reproduced, native) : undefined;
      const list = servers.get(name) ?? [];
      list.push({
        harness: id,
        key: hashValue(parsed.server),
        value: parsed.server,
        ...(override === undefined ? {} : { override }),
      });
      servers.set(name, list);
    }
  }
  const mcp: Record<string, McpServer> = {};
  for (const [name, entries] of [...servers].sort(([a], [b]) => compareText(a, b))) {
    const chosen = pickMajority(entries);
    const skipped = entries.filter((entry) => entry.key !== chosen.key);
    for (const entry of skipped) {
      warnings.push(
        `${getAdapter(entry.harness).label} MCP server ${name} differs from the other harnesses. ade leaves it unmanaged.`,
      );
    }
    const overrides: Partial<Record<HarnessId, Record<string, unknown>>> = {};
    for (const entry of entries) {
      if (entry.key === chosen.key && entry.override !== undefined) {
        overrides[entry.harness] = entry.override;
      }
    }
    const base = secrets.scrub(chosen.value, undefined, name, `mcp.${name}`) as ResolvedMcpServer;
    const scrubbedOverrides = secrets.scrub(
      overrides,
      undefined,
      name,
      `mcp.${name}.overrides`,
    ) as Partial<Record<HarnessId, Record<string, unknown>>>;
    mcp[name] = {
      ...base,
      ...(chosen.harnesses.length === harnesses.length ? {} : { harnesses: chosen.harnesses }),
      ...(Object.keys(scrubbedOverrides).length === 0 ? {} : { overrides: scrubbedOverrides }),
    } as McpServer;
  }
  if (Object.keys(mcp).length > 0) {
    profile.mcp = mcp;
  }

  const settings: Record<string, Record<string, unknown>> = {};
  const captureSettings = async (
    key: string,
    file: string,
    format: "json" | "toml",
    exclude: readonly (readonly string[])[],
  ): Promise<void> => {
    const doc = await loadDoc(file, format);
    if (!doc.exists) {
      return;
    }
    const data = cloneValue(doc.data);
    for (const pointer of exclude) {
      deleteAt(data, pointer);
    }
    const cleaned = withoutNulls(templateHomeDeep(data, ctx.home)) as Record<string, unknown>;
    const scrubbed = secrets.scrub(
      cleaned,
      undefined,
      key.replace(/[^A-Za-z0-9]+/g, "_"),
      `settings.${key}`,
    ) as Record<string, unknown>;
    if (Object.keys(scrubbed).length > 0) {
      settings[key] = scrubbed;
    }
  };
  for (const id of harnesses) {
    const adapter = getAdapter(id);
    const location = adapter.settingsLocation(ctx);
    const reserved = adapter.reservedSettingsKeys.map((key) => [key]);
    await captureSettings(id, location.path, location.format, [
      ...adapter.captureExclude,
      ...reserved,
    ]);
  }

  const fileEntries: FileEntry[] = [];
  for (const include of options.include ?? []) {
    if (include.root !== "home" && !harnesses.includes(include.root)) {
      warnings.push(
        `The include ${include.root}:${include.target} names a harness that ade does not capture.`,
      );
      continue;
    }
    const root = include.root === "home" ? ctx.home : getAdapter(include.root).home(ctx);
    const source = safeJoin(root, include.target, "its target root");
    const format = docFormatFor(include.target);
    if (format !== undefined && include.root !== "home") {
      const key = `${include.root}:${include.target.replaceAll("\\", "/")}`;
      await captureSettings(key, source, format, []);
      if (settings[key] === undefined) {
        warnings.push(`The include ${key} does not exist or is empty.`);
      }
      continue;
    }
    const content = await readIfFile(source);
    if (content === undefined) {
      warnings.push(`The include ${include.root}:${include.target} is not a file.`);
      continue;
    }
    const relative = path.posix.join("files", include.root, include.target.replaceAll("\\", "/"));
    files.push({ path: relative, kind: "file", content });
    fileEntries.push({
      root: include.root,
      target: include.target.replaceAll("\\", "/"),
      source: relative,
    });
  }
  if (Object.keys(settings).length > 0) {
    profile.settings = settings as Profile["settings"];
  }

  const origins = await readSkillOrigins(ctx);
  const skillDirs = [sharedSkillsDir(ctx)];
  for (const id of harnesses) {
    skillDirs.push(...getAdapter(id).captureSkillDirs(ctx));
  }
  const chosenSkills = new Map<string, SkillCandidate>();
  for (const dir of skillDirs) {
    for (const candidate of await listSkillCandidates(dir)) {
      const existing = chosenSkills.get(candidate.name);
      if (existing === undefined) {
        chosenSkills.set(candidate.name, candidate);
      } else if (existing.real !== candidate.real && existing.hash !== candidate.hash) {
        warnings.push(
          `The skill ${candidate.name} in ${candidate.location} differs from ${existing.location}. ade captures the first copy.`,
        );
      }
    }
  }
  const skills: Record<string, Skill> = {};
  const sharedDir = sharedSkillsDir(ctx);
  for (const candidate of [...chosenSkills.values()].sort((a, b) => compareText(a.name, b.name))) {
    if (
      path.dirname(candidate.location) === sharedDir &&
      candidate.linkTarget !== undefined &&
      !isInside(candidate.linkTarget, sharedDir)
    ) {
      skills[candidate.name] = { link: templateHome(candidate.linkTarget, ctx.home) };
      continue;
    }
    const relative = `skills/${candidate.name}`;
    files.push({ path: relative, kind: "dir", source: candidate.real });
    const origin = origins[candidate.name];
    skills[candidate.name] = { path: relative, ...(origin === undefined ? {} : { origin }) };
  }
  if (Object.keys(skills).length > 0) {
    profile.skills = skills;
  }
  if (fileEntries.length > 0) {
    profile.files = fileEntries;
  }
  if (Object.keys(secrets.sources).length > 0) {
    profile.secrets = secrets.sources;
  }
  return { profile, files, warnings: [...new Set(warnings)], secrets: secrets.found };
}

export interface WriteCaptureOptions {
  readonly force?: boolean | undefined;
}

export async function writeCapture(
  dir: string,
  result: CaptureResult,
  options: WriteCaptureOptions = {},
): Promise<LoadedProfile> {
  const root = path.resolve(dir);
  if (!(await isEmptyDir(root)) && options.force !== true) {
    throw new AdeError("profile-exists", `The directory is not empty: ${root}.`, {
      hint: "Use an empty directory, or add --force to write into it.",
    });
  }
  await ensureDir(root);
  for (const file of result.files) {
    const target = safeJoin(root, file.path, "the profile directory");
    await removePath(target);
    if (file.kind === "dir" && file.source !== undefined) {
      await ensureDir(path.dirname(target));
      await copyTree(file.source, target);
    } else if (file.content !== undefined) {
      await ensureDir(path.dirname(target));
      await fs.writeFile(target, file.content);
    }
  }
  await saveProfile(root, result.profile);
  await writeSchemaFile(root);
  return loadProfile(root);
}
