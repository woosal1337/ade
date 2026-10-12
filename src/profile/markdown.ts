import { AdeError } from "../core/errors.ts";
import { isSafeRelative } from "../core/fsx.ts";
import { compareText, sha256 } from "../core/hash.ts";
import { VERSION } from "../version.ts";
import type { Bundle, BundleFile } from "./bundle.ts";
import { PROFILE_FILE } from "./load.ts";
import { riskSummary } from "./risk.ts";
import { isGitSkill, isLinkSkill, type Profile } from "./schema.ts";

export const ADE_MD_FILE = "ADE.md";
export const ADE_MD_VERSION = 1;
export const INSTALL_SH =
  "https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.sh";
export const INSTALL_PS1 =
  "https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.ps1";

const FILES_HEADING = "## Files";
const MAX_BYTES = 64 * 1024 * 1024;

export interface WriteMarkdownOptions {
  readonly source?: string | undefined;
  readonly createdAt: Date;
}

export interface ParsedMarkdown {
  readonly meta: Readonly<Record<string, unknown>>;
  readonly digest: string;
  readonly bundle: Bundle;
}

interface Block {
  readonly path: string;
  readonly bytes: Buffer;
  readonly hash: string;
  readonly executable: boolean;
  readonly private: boolean;
}

const MODE_ATTRIBUTE: Record<string, { executable: boolean; private: boolean }> = {
  "755": { executable: true, private: false },
  "700": { executable: true, private: true },
  "600": { executable: false, private: true },
  "644": { executable: false, private: false },
};

function bundleBytes(file: BundleFile): Buffer {
  return file.encoding === "base64"
    ? Buffer.from(file.content, "base64")
    : Buffer.from(file.content, "utf8");
}

function needsBase64(bytes: Buffer): boolean {
  if (bytes.includes(0) || bytes.includes(13)) {
    return true;
  }
  return !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes);
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

const LANGUAGES: Readonly<Record<string, string>> = {
  ".json": "json",
  ".md": "markdown",
  ".toml": "toml",
  ".ts": "ts",
  ".mts": "ts",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".sh": "sh",
  ".py": "python",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".patch": "diff",
};

function languageFor(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot === -1 ? undefined : LANGUAGES[path.slice(dot).toLowerCase()]) ?? "text";
}

export interface DigestEntry {
  readonly path: string;
  readonly hash: string;
  readonly executable?: boolean;
  readonly private?: boolean;
}

export function modeText(entry: { executable?: boolean; private?: boolean }): string {
  if (entry.private === true) {
    return entry.executable === true ? "700" : "600";
  }
  return entry.executable === true ? "755" : "644";
}

export function digestOf(blocks: readonly DigestEntry[]): string {
  const lines = [...blocks]
    .sort((left, right) => compareText(left.path, right.path))
    .map((block) => {
      const mode = modeText(block);
      return mode === "644"
        ? `${block.path} ${block.hash}\n`
        : `${block.path} ${block.hash} ${mode}\n`;
    })
    .join("");
  return `sha256:${sha256(lines)}`;
}

export function pathKey(file: string): string {
  return file.normalize("NFC").toLowerCase();
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function code(text: string): string {
  return text.includes("`") ? cell(text) : `\`${cell(text)}\``;
}

function useSection(source: string): string[] {
  return [
    "## Use this setup",
    "",
    "1. Install ade. It needs Node.js 22 or later and Git:",
    "",
    "   ```bash",
    `   curl -fsSL ${INSTALL_SH} | sh`,
    "   ```",
    "",
    `   On Windows, run \`irm ${INSTALL_PS1} | iex\` in PowerShell.`,
    "",
    "2. Show the changes for your machine. The plan writes nothing:",
    "",
    "   ```bash",
    `   ade plan ${source}`,
    "   ```",
    "",
    "3. Apply the setup. ade asks you to trust the source first:",
    "",
    "   ```bash",
    `   ade apply ${source}`,
    "   ```",
    "",
    "Without ade, one command installs it and runs the plan and the apply:",
    "",
    "| Platform | Command |",
    "|---|---|",
    `| macOS and Linux | ${code(`curl -fsSL ${INSTALL_SH} | sh -s -- ${source}`)} |`,
    `| Windows | ${code(`$env:ADE_SOURCE = "${source}"; irm ${INSTALL_PS1} | iex`)} |`,
    "",
  ];
}

function riskSection(profile: Profile): string[] {
  const lines = ["## What this setup does", "", "| | Area | Item |", "|---|---|---|"];
  for (const item of riskSummary(profile)) {
    lines.push(`| ${item.level === "high" ? "!" : ""} | ${item.area} | ${cell(item.text)} |`);
  }
  lines.push(
    "",
    "Items with ! run programs, write files, read secrets, or change permissions.",
    "",
  );
  return lines;
}

function secretSection(profile: Profile): string[] {
  const secrets = Object.entries(profile.secrets ?? {});
  if (secrets.length === 0) {
    return ["## Secrets", "", "This setup needs no secrets.", ""];
  }
  const lines = [
    "## Secrets",
    "",
    "Set these values on your machine before you apply the setup:",
    "",
    "| Secret | Source |",
    "|---|---|",
  ];
  for (const [name, source] of secrets) {
    const where =
      source.from === "env"
        ? `the environment variable ${code(source.name)}`
        : source.from === "file"
          ? `the file ${code(source.path)}`
          : source.from === "command"
            ? `the output of ${code(source.argv.join(" "))}`
            : `the Keychain item ${code(`${source.service} / ${source.account}`)}`;
    lines.push(`| ${code(name)} | ${where} |`);
  }
  lines.push("");
  return lines;
}

function contentsSection(profile: Profile): string[] {
  const join = (items: readonly string[]): string =>
    items.length === 0 ? "none" : items.map((item) => code(item)).join(", ");
  const mcp = Object.entries(profile.mcp ?? {}).map(
    ([name, server]) => `${name} (${server.transport})`,
  );
  const skills = Object.entries(profile.skills ?? {}).map(([name, skill]) =>
    isGitSkill(skill) ? `${name} (Git)` : isLinkSkill(skill) ? `${name} (link)` : name,
  );
  const plugins: string[] = [];
  for (const [harness, set] of Object.entries(profile.plugins ?? {})) {
    for (const name of Object.keys(set?.marketplaces ?? {})) {
      plugins.push(`${harness}: marketplace ${name}`);
    }
    for (const id of set?.install ?? []) {
      plugins.push(`${harness}: ${id}`);
    }
  }
  return [
    "## Contents",
    "",
    "| Kind | Entries |",
    "|---|---|",
    `| Harnesses | ${profile.harnesses === undefined ? "the harnesses on each machine" : join(profile.harnesses)} |`,
    `| Instructions | ${profile.instructions === undefined ? "none" : code(profile.instructions.file)} |`,
    `| MCP servers | ${join(mcp)} |`,
    `| Skills | ${join(skills)} |`,
    `| Settings | ${join(Object.keys(profile.settings ?? {}))} |`,
    `| Plugins | ${join(plugins)} |`,
    `| Files | ${join((profile.files ?? []).map((entry) => `${entry.root}:${entry.target}`))} |`,
    `| Patches | ${join((profile.patches ?? []).map((entry) => `${entry.root}:${entry.target}`))} |`,
    "",
  ];
}

function fileBlock(block: Block): string[] {
  if (block.path.includes("`") || block.path.includes('"')) {
    throw new AdeError("bundle-invalid", `ADE.md cannot hold the path ${block.path}.`, {
      hint: "Rename the file so that its path has no backtick and no quote.",
    });
  }
  const attributes = [`path="${block.path}"`, `sha256="${block.hash}"`];
  let body: string;
  if (needsBase64(block.bytes)) {
    attributes.push('encoding="base64"');
    body = `${(block.bytes.toString("base64").match(/.{1,76}/g) ?? [""]).join("\n")}\n`;
  } else {
    const text = block.bytes.toString("utf8");
    if (text.endsWith("\n")) {
      body = text;
    } else {
      attributes.push('eol="none"');
      body = `${text}\n`;
    }
  }
  if (modeText(block) !== "644") {
    attributes.push(`mode="${modeText(block)}"`);
  }
  const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
  return [
    `### \`${block.path}\``,
    "",
    `${fence}${languageFor(block.path)} ade-file ${attributes.join(" ")}`,
    `${body}${fence}`,
    "",
  ];
}

export function writeMarkdown(
  bundle: Bundle,
  profile: Profile,
  options: WriteMarkdownOptions,
): string {
  const blocks: Block[] = bundle.files
    .map((file) => {
      const bytes = bundleBytes(file);
      return {
        path: file.path,
        bytes,
        hash: sha256(bytes),
        executable: file.executable === true,
        private: file.private === true,
      };
    })
    .sort((left, right) => compareText(left.path, right.path));
  if (!blocks.some((block) => block.path === PROFILE_FILE)) {
    throw new AdeError("bundle-invalid", `The profile has no ${PROFILE_FILE} file.`);
  }
  const name = profile.name ?? "agents";
  const source = options.source ?? `./${ADE_MD_FILE}`;
  const meta: [string, unknown][] = [
    ["ade", ADE_MD_VERSION],
    ["name", name],
    ...(profile.description === undefined
      ? []
      : [["description", profile.description] as [string, unknown]]),
    ["generator", `ade ${VERSION}`],
    ["created", options.createdAt.toISOString()],
    ...(options.source === undefined ? [] : [["source", options.source] as [string, unknown]]),
    ["harnesses", profile.harnesses ?? []],
    ["secrets", Object.keys(profile.secrets ?? {})],
    ["files", blocks.length],
    ["digest", digestOf(blocks)],
  ];
  const lines = [
    "---",
    ...meta.map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "---",
    "",
    `# ${name}`,
    "",
    profile.description ?? "An agent development environment for ade.",
    "",
    ...useSection(source),
    ...riskSection(profile),
    ...secretSection(profile),
    ...contentsSection(profile),
    FILES_HEADING,
    "",
    "ade writes this section. Do not edit it by hand. Run `ade share` again after a change to the profile.",
    "",
    ...blocks.flatMap(fileBlock),
  ];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function isMarkdownProfile(text: string): boolean {
  const start = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return /^---\r?\n/.test(start) && /\r?\nade:\s*\d+\s*\r?\n/.test(start.slice(0, 4096));
}

function parseFrontMatter(
  lines: readonly string[],
  label: string,
): { meta: Record<string, unknown>; end: number } {
  if (lines[0] !== "---") {
    throw new AdeError("bundle-invalid", `The file has no front matter: ${label}.`, {
      hint: "An ADE.md starts with a line that holds only ---.",
    });
  }
  const meta: Record<string, unknown> = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line === "---") {
      return { meta, end: index };
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (match?.[1] === undefined) {
      continue;
    }
    const raw = (match[2] ?? "").trim();
    try {
      meta[match[1]] = JSON.parse(raw);
    } catch {
      meta[match[1]] = raw;
    }
  }
  throw new AdeError("bundle-invalid", `The front matter has no end line: ${label}.`);
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(/([A-Za-z0-9_-]+)=("(?:[^"\\]|\\.)*")/g)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      attributes[match[1]] = JSON.parse(match[2]) as string;
    }
  }
  return attributes;
}

export function parseMarkdown(text: string, label: string): ParsedMarkdown {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = source.split(/\r?\n/);
  const { meta, end } = parseFrontMatter(lines, label);
  const version = meta.ade;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new AdeError("bundle-invalid", `The front matter has no ade version: ${label}.`);
  }
  if (version > ADE_MD_VERSION) {
    throw new AdeError("unsupported", `${label} uses ADE.md version ${version}.`, {
      hint: `This ade reads version ${ADE_MD_VERSION}. Update ade.`,
    });
  }
  const heading = lines.indexOf(FILES_HEADING, end + 1);
  if (heading === -1) {
    throw new AdeError("bundle-invalid", `The file has no ${FILES_HEADING} section: ${label}.`);
  }
  const blocks: Block[] = [];
  const seen = new Set<string>();
  const problems: string[] = [];
  let total = 0;
  for (let index = heading + 1; index < lines.length; index += 1) {
    const open = /^(`{3,})([^`\s]*)\s+ade-file(?:\s+(.*))?$/.exec(lines[index] as string);
    if (open?.[1] === undefined) {
      continue;
    }
    const fence = open[1];
    const attributes = parseAttributes(open[3] ?? "");
    const body: string[] = [];
    let close = index + 1;
    while (close < lines.length && lines[close] !== fence) {
      body.push(lines[close] as string);
      close += 1;
    }
    if (close >= lines.length) {
      throw new AdeError(
        "bundle-invalid",
        `A file block has no closing fence: ${attributes.path ?? `line ${index + 1}`}.`,
      );
    }
    index = close;
    const path = attributes.path;
    if (
      path === undefined ||
      !isSafeRelative(path) ||
      path.includes("\\") ||
      path.split("/").includes(".")
    ) {
      throw new AdeError(
        "bundle-invalid",
        `A file block has a path that is not safe: ${path ?? `line ${index + 1}`}.`,
      );
    }
    if (seen.has(pathKey(path))) {
      throw new AdeError(
        "bundle-invalid",
        `Two file blocks have the path ${path}, or paths that differ only in case.`,
      );
    }
    seen.add(pathKey(path));
    const joined = body.join("\n");
    const bytes =
      attributes.encoding === "base64"
        ? Buffer.from(joined.replace(/\s+/g, ""), "base64")
        : Buffer.from(attributes.eol === "none" ? joined : `${joined}\n`, "utf8");
    total += bytes.length;
    if (total > MAX_BYTES) {
      throw new AdeError("bundle-invalid", "The files of the ADE.md are larger than 64 MB.");
    }
    const hash = sha256(bytes);
    if (hash !== attributes.sha256) {
      problems.push(`${path}: the content does not match its sha256 attribute.`);
    }
    const mode = MODE_ATTRIBUTE[attributes.mode ?? "644"];
    if (mode === undefined) {
      problems.push(`${path}: the mode attribute is not 600, 644, 700, or 755.`);
    }
    blocks.push({
      path,
      bytes,
      hash,
      executable: mode?.executable === true,
      private: mode?.private === true,
    });
  }
  if (!blocks.some((block) => block.path === PROFILE_FILE)) {
    throw new AdeError("bundle-invalid", `The file has no ${PROFILE_FILE} block: ${label}.`);
  }
  const digest = digestOf(blocks);
  if (meta.files !== blocks.length) {
    problems.push(
      `The front matter names ${String(meta.files)} files, and the file has ${blocks.length} file blocks.`,
    );
  }
  if (meta.digest !== digest) {
    problems.push(`The digest in the front matter does not match the file blocks.`);
  }
  if (problems.length > 0) {
    throw new AdeError("bundle-invalid", `${label} changed after ade wrote it.`, {
      details: problems,
      hint: "Run `ade share` again to write the file from the profile.",
    });
  }
  const files: BundleFile[] = blocks.map((block) => ({
    path: block.path,
    ...(needsBase64(block.bytes)
      ? { encoding: "base64" as const, content: block.bytes.toString("base64") }
      : { encoding: "utf8" as const, content: block.bytes.toString("utf8") }),
    ...(block.executable ? { executable: true } : {}),
    ...(block.private ? { private: true } : {}),
  }));
  return {
    meta,
    digest,
    bundle: {
      format: "ade-bundle",
      version: 1,
      createdAt: typeof meta.created === "string" ? meta.created : new Date(0).toISOString(),
      ...(typeof meta.name === "string" ? { name: meta.name } : {}),
      files,
    },
  };
}
