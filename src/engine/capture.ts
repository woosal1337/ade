import fs from "node:fs/promises";
import path from "node:path";
import { type Context, displayPath } from "../core/context.ts";
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
import { isSecretFileName } from "../harness/inventory-rules.ts";
import {
  detectHarnesses,
  getAdapter,
  rootDir,
  sharedInstructionsPath,
  sharedRoot,
  sharedSkillsDir,
} from "../harness/registry.ts";
import type { AssetRule, ResolvedMcpServer } from "../harness/types.ts";
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
  type PatchEntry,
  type PluginSet,
  type Profile,
  ROOT_IDS,
  type RootId,
  type SecretSource,
  type Skill,
} from "../profile/schema.ts";
import { templateHome, templateHomeDeep } from "../secrets/refs.ts";
import { type CommandRunner, runCommand } from "../secrets/resolve.ts";
import { SCHEME_PREFIX, SENSITIVE_KEY, TOKEN_PATTERN } from "../secrets/scan.ts";
import { isolatedGitEnv } from "../skills/git.ts";
import { capturableFiles, inventory, piPackageAssets } from "./inventory.ts";

const MAX_SCANNED_BYTES = 1024 * 1024;

async function secretFileReason(file: string): Promise<string | undefined> {
  const name = path.basename(file);
  if (isSecretFileName(name)) {
    return "has the name of a credential file";
  }
  if (/\.(md|markdown)$/i.test(name)) {
    return undefined;
  }
  const stat = await statOrUndefined(file);
  if (!stat?.isFile() || stat.size > MAX_SCANNED_BYTES) {
    return undefined;
  }
  const content = await fs.readFile(file);
  if (content.includes(0)) {
    return undefined;
  }
  return holdsSecret(content.toString("utf8"))
    ? "holds a value that looks like a secret"
    : undefined;
}

export interface CaptureInclude {
  readonly root: RootId;
  readonly target: string;
}

export interface CaptureOptions {
  readonly harnesses?: readonly HarnessId[] | undefined;
  readonly include?: readonly CaptureInclude[] | undefined;
  readonly name?: string | undefined;
  readonly runner?: CommandRunner | undefined;
}

export interface CapturedFile {
  readonly path: string;
  readonly kind: "file" | "dir";
  readonly source?: string;
  readonly content?: Buffer;
  readonly mode?: number;
  readonly filtered?: boolean;
  readonly include?: readonly string[];
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

const MAX_REFERENCED_BYTES = 1024 * 1024;
const REFERENCE_PATH = /\$\{home\}([\\/][^\s'"`;,)\]]+)/g;

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
  "gemini",
  "opencode",
  "zed",
  "claude-desktop",
  "antigravity",
]);

function isSecretFlag(flag: string): boolean {
  return SENSITIVE_KEY.test(flag) && !/(file|path|dir|url|uri|name|id|env)$/i.test(flag);
}

function looksLikePath(value: string): boolean {
  return /^(?:[~.]?\/|[A-Za-z]:[\\/]|https?:\/\/)/.test(value);
}

function holdsSecret(text: string): boolean {
  if (new RegExp(TOKEN_PATTERN.source).test(text)) {
    return true;
  }
  for (const line of text.split(/\r?\n/)) {
    for (const assignment of line.matchAll(
      /["']?([A-Za-z0-9_.-]+)["']?\s*[=:]\s*["']?([^"'\s#,}\]]+)/g,
    )) {
      const [, key, value] = assignment;
      if (
        key !== undefined &&
        value !== undefined &&
        SENSITIVE_KEY.test(key) &&
        value.length >= 8 &&
        !value.includes("${")
      ) {
        return true;
      }
    }
  }
  return false;
}

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

  #reference(base: string, value: string, where: string): string {
    const name = this.#nameFor(base, value);
    this.found.push({ name, where });
    return `\${secret:${name}}`;
  }

  #scrubUrl(value: string, base: string, where: string): string {
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
      return value;
    }
    let result = value.replace(
      /^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^:/@?#]+:)([^@/?#]+)@/,
      (match, prefix: string, password: string) =>
        password.includes("${")
          ? match
          : `${prefix}${this.#reference(`${base}_password`, password, where)}@`,
    );
    result = result.replace(
      /([?&])([^=&#]+)=([^&#]*)/g,
      (match, separator: string, name: string, item: string) =>
        SENSITIVE_KEY.test(name) && item.length >= 8 && !item.includes("${")
          ? `${separator}${name}=${this.#reference(`${base}_${name}`, item, where)}`
          : match,
    );
    return result;
  }

  scrubString(value: string, key: string | undefined, base: string, where: string): string {
    if (!this.#looksSecret(key, value)) {
      const tokens = new RegExp(TOKEN_PATTERN.source, "g");
      const replaced = value.replace(tokens, (token) => this.#reference(base, token, where));
      return this.#scrubUrl(replaced, base, where);
    }
    const scheme = SCHEME_PREFIX.exec(value);
    const secret = scheme?.[2] ?? value;
    const name = this.#nameFor(base, secret);
    this.found.push({ name, where });
    return scheme === null ? `\${secret:${name}}` : `${scheme[1]} \${secret:${name}}`;
  }

  #scrubFlags(items: unknown[], base: string, where: string): unknown[] {
    const result = [...items];
    for (let index = 0; index < result.length; index += 1) {
      const item = result[index];
      if (typeof item !== "string") {
        continue;
      }
      const inline = /^(--?[A-Za-z][A-Za-z0-9_-]*)=(.+)$/.exec(item);
      if (inline?.[1] !== undefined && inline[2] !== undefined) {
        if (
          isSecretFlag(inline[1]) &&
          !inline[2].includes("${") &&
          !looksLikePath(inline[2]) &&
          inline[2].length >= 8
        ) {
          result[index] =
            `${inline[1]}=${this.#reference(`${base}_${inline[1]}`, inline[2], where)}`;
        }
        continue;
      }
      const next = result[index + 1];
      if (
        /^--?[A-Za-z][A-Za-z0-9_-]*$/.test(item) &&
        isSecretFlag(item) &&
        typeof next === "string" &&
        !next.startsWith("-") &&
        !next.includes("${") &&
        !looksLikePath(next) &&
        next.length >= 8
      ) {
        result[index + 1] = this.#reference(`${base}_${item}`, next, where);
        index += 1;
      }
    }
    return result;
  }

  scrub(value: unknown, key: string | undefined, base: string, where: string): unknown {
    if (typeof value === "string") {
      return this.scrubString(value, key, base, where);
    }
    if (Array.isArray(value)) {
      return this.#scrubFlags(
        value.map((item) => this.scrub(item, key, base, where)),
        base,
        where,
      );
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

async function hasCapturableFiles(dir: string): Promise<boolean> {
  return (await capturableFiles(dir)).length > 0;
}

function rootFor(ctx: Context, file: string): { root: RootId; target: string } | undefined {
  const candidates = ROOT_IDS.map((root) => ({ root, dir: rootDir(ctx, root) })).sort(
    (left, right) => right.dir.length - left.dir.length,
  );
  for (const { root, dir } of candidates) {
    const relative = path.relative(dir, file);
    if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return { root, target: relative.split(path.sep).join("/") };
    }
  }
  return undefined;
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, into);
    }
  } else if (isPlainObject(value)) {
    for (const item of Object.values(value)) {
      collectStrings(item, into);
    }
  }
}

function packageCheckout(source: string): string | undefined {
  if (!source.startsWith("git:")) {
    return undefined;
  }
  let rest = source.slice(4).replace(/^[a-z+]+:\/\//, "");
  const at = rest.lastIndexOf("@");
  if (at > rest.indexOf("/")) {
    rest = rest.slice(0, at);
  }
  rest = rest.replace(/\.git$/, "");
  return rest.split("/").every((part) => part !== "" && part !== "..") ? rest : undefined;
}

export async function capture(ctx: Context, options: CaptureOptions = {}): Promise<CaptureResult> {
  const warnings: string[] = [];
  const files: CapturedFile[] = [];
  const secrets = new SecretCollector();
  const runner = options.runner ?? runCommand;
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
  const capturedPaths: string[] = [];
  const fileEntries: FileEntry[] = [];
  const addFileEntry = async (
    root: RootId,
    target: string,
    source: string,
    once: boolean,
  ): Promise<void> => {
    const stat = await statOrUndefined(source);
    const link = await lstatOrUndefined(source);
    const linkTarget = link?.isSymbolicLink() === true ? await readLinkAbsolute(source) : undefined;
    const symlink =
      linkTarget === undefined || once ? {} : { symlink: templateHome(linkTarget, ctx.home) };
    const relative = path.posix.join("files", root, target);
    if (stat?.isFile()) {
      const reason = await secretFileReason(source);
      if (reason !== undefined) {
        warnings.push(`${displayPath(ctx, source)} ${reason}. ade does not capture it.`);
        return;
      }
    }
    if (stat?.isDirectory()) {
      const inner = await capturableFiles(source);
      const innerLinks: string[] = [];
      if (linkTarget === undefined) {
        for (const item of inner) {
          if ((await lstatOrUndefined(path.join(source, ...item.split("/"))))?.isSymbolicLink()) {
            innerLinks.push(item);
          }
        }
      }
      if (innerLinks.length > 0) {
        for (const item of inner) {
          await addFileEntry(
            root,
            `${target}/${item}`,
            path.join(source, ...item.split("/")),
            false,
          );
        }
        return;
      }
      const include: string[] = [];
      for (const item of inner) {
        const full = path.join(source, ...item.split("/"));
        const reason = await secretFileReason(full);
        if (reason === undefined) {
          include.push(item);
        } else {
          warnings.push(`${displayPath(ctx, full)} ${reason}. ade does not capture it.`);
        }
      }
      if (include.length === 0) {
        return;
      }
      files.push({ path: relative, kind: "dir", source, filtered: true, include });
    } else if (stat?.isFile()) {
      files.push({
        path: relative,
        kind: "file",
        content: await fs.readFile(source),
        mode: stat.mode & 0o777,
      });
    } else {
      return;
    }
    capturedPaths.push(source);
    fileEntries.push({
      root,
      target,
      source: relative,
      ...symlink,
      ...(once ? { once: true } : {}),
    });
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
      const core = { ...parsed.server } as Record<string, unknown>;
      delete core.description;
      delete core.enabled;
      const coreServer = core as unknown as ResolvedMcpServer;
      const reproduced = adapter.toNativeMcp(coreServer).value ?? {};
      const override = isPlainObject(native) ? mergeDiff(reproduced, native) : undefined;
      const list = servers.get(name) ?? [];
      list.push({
        harness: id,
        key: hashValue(coreServer),
        value: coreServer,
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
  ): Promise<boolean> => {
    const doc = await loadDoc(file, format);
    if (!doc.exists) {
      return false;
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
      return true;
    }
    return false;
  };
  const capturedDocs = new Set<string>();
  for (const id of harnesses) {
    const adapter = getAdapter(id);
    const location = adapter.settingsLocation(ctx);
    if (capturedDocs.has(location.path)) {
      continue;
    }
    capturedDocs.add(location.path);
    const reserved = adapter.reservedSettingsKeys.map((key) => [key]);
    const mcpLocation = adapter.mcpLocation(ctx);
    const mcpPointer = mcpLocation.path === location.path ? [mcpLocation.pointer] : [];
    await captureSettings(id, location.path, location.format, [
      ...adapter.captureExclude,
      ...reserved,
      ...mcpPointer,
    ]);
  }

  if (harnesses.includes("claude")) {
    const location = getAdapter("claude").mcpLocation(ctx);
    const doc = await loadDoc(location.path, location.format);
    const projects = isPlainObject(doc.data.projects) ? doc.data.projects : {};
    const local: Record<string, unknown> = {};
    for (const [project, entry] of Object.entries(projects)) {
      if (
        isPlainObject(entry) &&
        isPlainObject(entry.mcpServers) &&
        Object.keys(entry.mcpServers).length > 0
      ) {
        local[templateHome(project, ctx.home)] = { mcpServers: entry.mcpServers };
      }
    }
    const key = rootFor(ctx, location.path);
    if (Object.keys(local).length > 0 && key !== undefined) {
      const docKey = `${key.root}:${key.target}`;
      settings[docKey] = secrets.scrub(
        templateHomeDeep({ projects: local }, ctx.home),
        undefined,
        "claude_project",
        `settings.${docKey}`,
      ) as Record<string, unknown>;
    }
  }

  const assetRules: { harness: HarnessId; rule: AssetRule }[] = [];
  for (const id of harnesses) {
    for (const rule of getAdapter(id).assets) {
      assetRules.push({ harness: id, rule });
    }
    if (id === "pi") {
      assetRules.push(...(await piPackageAssets(ctx)).map((rule) => ({ harness: id, rule })));
    }
  }
  for (const { harness, rule } of assetRules) {
    const root = rule.root ?? harness;
    const source = path.join(rootDir(ctx, root), ...rule.path.split("/"));
    const stat = await statOrUndefined(source);
    if (stat === undefined) {
      continue;
    }
    if (rule.kind === "doc" && stat.isFile()) {
      const format = docFormatFor(rule.path) ?? "json";
      try {
        if (await captureSettings(`${root}:${rule.path}`, source, format, [])) {
          capturedPaths.push(source);
        }
      } catch (error) {
        warnings.push(
          `${rule.path}: ${error instanceof Error ? error.message : String(error)} ade skips it.`,
        );
      }
      continue;
    }
    if (rule.kind === "dir" && stat.isDirectory() && (await hasCapturableFiles(source))) {
      await addFileEntry(root, rule.path, source, false);
      continue;
    }
    if (rule.kind === "file" && stat.isFile()) {
      await addFileEntry(root, rule.path, source, rule.once === true);
    }
  }

  const extras = await inventory(ctx, { harnesses });
  for (const row of extras.rows) {
    if (row.status !== "extra" || row.root === undefined) {
      continue;
    }
    const format = docFormatFor(row.name);
    if (format !== undefined) {
      try {
        if (await captureSettings(`${row.root}:${row.name}`, row.path, format, [])) {
          capturedPaths.push(row.path);
        }
        continue;
      } catch {
        warnings.push(
          `${row.display} is not valid ${format.toUpperCase()}. ade captures it as a file.`,
        );
      }
    }
    if (holdsSecret(await fs.readFile(row.path, "utf8"))) {
      warnings.push(
        `${row.display} holds a value that looks like a secret. ade does not capture it.`,
      );
      continue;
    }
    await addFileEntry(row.root, row.name, row.path, false);
  }

  for (const include of options.include ?? []) {
    const root = include.root;
    const owner = root === "home" ? undefined : root === "cursor-user" ? "cursor" : root;
    if (owner !== undefined && !harnesses.includes(owner)) {
      warnings.push(
        `The include ${include.root}:${include.target} names a harness that ade does not capture.`,
      );
      continue;
    }
    const target = include.target.replaceAll("\\", "/");
    const source = safeJoin(rootDir(ctx, root), target, "its target root");
    const format = docFormatFor(target);
    if (format !== undefined && root !== "home") {
      const key = `${root}:${target}`;
      if (!(await captureSettings(key, source, format, []))) {
        warnings.push(`The include ${key} does not exist or is empty.`);
      }
      capturedPaths.push(source);
      continue;
    }
    if ((await statOrUndefined(source)) === undefined) {
      warnings.push(`The include ${include.root}:${include.target} does not exist.`);
      continue;
    }
    await addFileEntry(root, target, source, false);
  }

  const skillDirs = [sharedSkillsDir(ctx)];
  for (const id of harnesses) {
    skillDirs.push(...getAdapter(id).captureSkillDirs(ctx));
    const dir = getAdapter(id).skillsDir(ctx);
    if (dir !== undefined) {
      skillDirs.push(dir);
    }
  }

  const referenced = new Set<string>();
  const strings: string[] = [];
  collectStrings(settings, strings);
  for (const text of strings) {
    for (const match of text.matchAll(REFERENCE_PATH)) {
      referenced.add(path.join(ctx.home, ...(match[1] ?? "").split(/[\\/]/).filter(Boolean)));
    }
  }
  for (const file of [...referenced].sort()) {
    if (
      capturedPaths.some((captured) => isInside(file, captured)) ||
      skillDirs.some((dir) => isInside(file, dir)) ||
      isInside(file, sharedRoot(ctx))
    ) {
      continue;
    }
    const stat = await statOrUndefined(file);
    if (!stat?.isFile() || stat.size > MAX_REFERENCED_BYTES) {
      continue;
    }
    const content = await fs.readFile(file);
    const location = rootFor(ctx, file);
    if (content.includes(0) || location === undefined) {
      continue;
    }
    await addFileEntry(location.root, location.target, file, false);
  }

  const origins = await readSkillOrigins(ctx);
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
  const linkHarnesses = harnesses.filter((id) => {
    const adapter = getAdapter(id);
    return !adapter.readsSharedSkills && adapter.skillsDir(ctx) !== undefined;
  });
  const readers = harnesses.filter((id) => getAdapter(id).readsSharedSkills);
  const skillTargets = async (name: string): Promise<{ harnesses?: HarnessId[] }> => {
    const have: HarnessId[] = [];
    for (const id of linkHarnesses) {
      const dir = getAdapter(id).skillsDir(ctx) as string;
      if ((await statOrUndefined(path.join(dir, name, "SKILL.md")))?.isFile()) {
        have.push(id);
      }
    }
    if (have.length === linkHarnesses.length) {
      return {};
    }
    const targets = [...have, ...readers];
    return targets.length === 0
      ? {}
      : { harnesses: HARNESS_IDS.filter((id) => targets.includes(id)) };
  };
  for (const candidate of [...chosenSkills.values()].sort((a, b) => compareText(a.name, b.name))) {
    if (
      path.dirname(candidate.location) === sharedDir &&
      candidate.linkTarget !== undefined &&
      !isInside(candidate.linkTarget, sharedDir)
    ) {
      skills[candidate.name] = {
        link: templateHome(candidate.linkTarget, ctx.home),
        ...(await skillTargets(candidate.name)),
      };
      continue;
    }
    const relative = `skills/${candidate.name}`;
    files.push({ path: relative, kind: "dir", source: candidate.real });
    const origin = origins[candidate.name];
    skills[candidate.name] = {
      path: relative,
      ...(origin === undefined ? {} : { origin }),
      ...(await skillTargets(candidate.name)),
    };
  }
  if (Object.keys(skills).length > 0) {
    profile.skills = skills;
  }

  const plugins: Partial<Record<HarnessId, PluginSet>> = {};
  for (const id of harnesses) {
    const support = getAdapter(id).plugins;
    if (support === undefined) {
      continue;
    }
    try {
      const list = await support.list(ctx, runner);
      const marketplaces = support.marketplaces ? { ...list.marketplaces } : {};
      const install = Object.keys(list.installed).sort(compareText);
      if (Object.keys(marketplaces).length > 0 || install.length > 0) {
        plugins[id] = {
          ...(Object.keys(marketplaces).length > 0 ? { marketplaces } : {}),
          ...(install.length > 0 ? { install } : {}),
        };
      }
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") {
        warnings.push(`ade could not list the ${getAdapter(id).label} ${support.noun}s.`);
      }
    }
  }
  if (Object.keys(plugins).length > 0) {
    profile.plugins = plugins;
  }

  const patches: PatchEntry[] = [];
  if (harnesses.includes("pi")) {
    const piSettings = await loadDoc(getAdapter("pi").settingsLocation(ctx).path, "json");
    const packages = Array.isArray(piSettings.data.packages) ? piSettings.data.packages : [];
    for (const item of packages) {
      const source =
        typeof item === "string"
          ? item
          : isPlainObject(item) && typeof item.source === "string"
            ? item.source
            : undefined;
      const checkout = source === undefined ? undefined : packageCheckout(source);
      if (checkout === undefined) {
        continue;
      }
      const target = `git/${checkout}`;
      const dir = path.join(rootDir(ctx, "pi"), ...target.split("/"));
      if (!(await statOrUndefined(path.join(dir, ".git")))) {
        continue;
      }
      const diff = await runner(
        [
          "git",
          "-C",
          dir,
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--binary",
          "HEAD",
          "--",
          ".",
          ":(exclude)package-lock.json",
          ":(exclude)**/package-lock.json",
          ":(exclude)node_modules",
        ],
        { env: isolatedGitEnv(ctx.env), timeoutMs: 60_000 },
      );
      if (diff.code !== 0 || diff.stdout.trim() === "") {
        continue;
      }
      const relative = `patches/pi/${checkout}.patch`;
      files.push({ path: relative, kind: "file", content: Buffer.from(diff.stdout, "utf8") });
      patches.push({ root: "pi", target, source: relative });
    }
  }
  if (patches.length > 0) {
    profile.patches = patches;
  }

  if (Object.keys(settings).length > 0) {
    profile.settings = settings as Profile["settings"];
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

async function copyCapturable(
  source: string,
  target: string,
  include: readonly string[] | undefined,
): Promise<void> {
  for (const relative of include ?? (await capturableFiles(source))) {
    const from = path.join(source, ...relative.split("/"));
    const to = path.join(target, ...relative.split("/"));
    await ensureDir(path.dirname(to));
    await fs.copyFile(from, to);
    await fs.chmod(to, (await fs.stat(from)).mode & 0o777);
  }
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
      if (file.filtered === true) {
        await ensureDir(target);
        await copyCapturable(file.source, target, file.include);
      } else {
        await ensureDir(path.dirname(target));
        await copyTree(file.source, target);
      }
    } else if (file.content !== undefined) {
      await ensureDir(path.dirname(target));
      await fs.writeFile(target, file.content, { mode: file.mode ?? 0o644 });
      if (file.mode !== undefined) {
        await fs.chmod(target, file.mode);
      }
    }
  }
  await saveProfile(root, result.profile);
  await writeSchemaFile(root);
  return loadProfile(root);
}
