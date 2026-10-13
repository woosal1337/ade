import fs from "node:fs/promises";
import path from "node:path";
import { isPlainObject } from "../core/doc.ts";
import { AdeError } from "../core/errors.ts";
import { ensureDir, isEmptyDir, isSafeRelative, safeJoin, statOrUndefined } from "../core/fsx.ts";
import { compareText } from "../core/hash.ts";
import { LOCK_FILE, type LoadedProfile, loadProfile, PROFILE_FILE, SCHEMA_FILE } from "./load.ts";
import { isGitSkill, isLinkSkill } from "./schema.ts";

export interface BundleFile {
  readonly path: string;
  readonly encoding: "utf8" | "base64";
  readonly content: string;
  readonly executable?: boolean;
  readonly private?: boolean;
}

export function modeFlags(mode: number): Pick<BundleFile, "executable" | "private"> {
  return {
    ...((mode & 0o111) !== 0 ? { executable: true } : {}),
    ...(process.platform !== "win32" && (mode & 0o004) === 0 ? { private: true } : {}),
  };
}

function fileMode(file: BundleFile): number {
  if (file.private === true) {
    return file.executable === true ? 0o700 : 0o600;
  }
  return file.executable === true ? 0o755 : 0o644;
}

export interface Bundle {
  readonly format: "ade-bundle";
  readonly version: 1;
  readonly createdAt: string;
  readonly name?: string;
  readonly files: readonly BundleFile[];
}

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const IGNORED = new Set([".DS_Store", ".git"]);

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function encode(content: Buffer): Pick<BundleFile, "encoding" | "content"> {
  const text = content.toString("utf8");
  if (!content.includes(0) && Buffer.from(text, "utf8").equals(content)) {
    return { encoding: "utf8", content: text };
  }
  return { encoding: "base64", content: content.toString("base64") };
}

export async function dirToBundleFiles(dir: string, prefix: string): Promise<BundleFile[]> {
  const sources = new Map<string, string>();
  await collectDir(dir, dir, sources);
  const files: BundleFile[] = [];
  for (const [relative, full] of [...sources].sort(([a], [b]) => compareText(a, b))) {
    const content = await fs.readFile(full);
    const stat = await fs.stat(full);
    files.push({
      path: `${prefix}/${relative}`,
      ...encode(content),
      ...modeFlags(stat.mode),
    });
  }
  return files;
}

async function collectDir(root: string, dir: string, into: Map<string, string>): Promise<void> {
  for (const name of (await fs.readdir(dir)).sort()) {
    if (IGNORED.has(name)) {
      continue;
    }
    const full = path.join(dir, name);
    const stat = await statOrUndefined(full);
    if (stat?.isDirectory()) {
      await collectDir(root, full, into);
    } else if (stat?.isFile()) {
      into.set(toPosix(path.relative(root, full)), full);
    }
  }
}

export async function exportBundle(loaded: LoadedProfile, now: Date = new Date()): Promise<Bundle> {
  const root = loaded.dir;
  const sources = new Map<string, string>();
  const addFile = async (relative: string, required: boolean): Promise<void> => {
    const full = safeJoin(root, relative, "the profile directory");
    const stat = await statOrUndefined(full);
    if (stat?.isFile()) {
      sources.set(toPosix(relative), full);
    } else if (required) {
      throw new AdeError("not-found", `The profile file does not exist: ${full}.`);
    }
  };
  await addFile(PROFILE_FILE, true);
  await addFile(LOCK_FILE, false);
  await addFile(SCHEMA_FILE, false);
  const { profile } = loaded;
  if (profile.instructions !== undefined) {
    await addFile(profile.instructions.file, true);
  }
  for (const [name, skill] of Object.entries(profile.skills ?? {})) {
    if (isGitSkill(skill) || isLinkSkill(skill)) {
      continue;
    }
    const dir = safeJoin(root, skill.path, "the profile directory");
    if (!(await statOrUndefined(dir))?.isDirectory()) {
      throw new AdeError("not-found", `The skill ${name} has no directory: ${dir}.`);
    }
    await collectDir(root, dir, sources);
  }
  for (const entry of profile.files ?? []) {
    if (entry.source === undefined) {
      continue;
    }
    const full = safeJoin(root, entry.source, "the profile directory");
    if ((await statOrUndefined(full))?.isDirectory()) {
      await collectDir(root, full, sources);
    } else {
      await addFile(entry.source, true);
    }
  }
  for (const entry of profile.patches ?? []) {
    await addFile(entry.source, true);
  }
  const files: BundleFile[] = [];
  let total = 0;
  for (const [relative, full] of [...sources].sort(([a], [b]) => compareText(a, b))) {
    const content = await fs.readFile(full);
    total += content.length;
    if (total > MAX_BUNDLE_BYTES) {
      throw new AdeError("bundle-invalid", "The profile is larger than the 64 MB bundle limit.");
    }
    const stat = await fs.stat(full);
    files.push({
      path: relative,
      ...encode(content),
      ...modeFlags(stat.mode),
    });
  }
  return {
    format: "ade-bundle",
    version: 1,
    createdAt: now.toISOString(),
    ...(profile.name === undefined ? {} : { name: profile.name }),
    files,
  };
}

export function parseBundle(input: unknown): Bundle {
  if (!isPlainObject(input) || input.format !== "ade-bundle" || input.version !== 1) {
    throw new AdeError("bundle-invalid", "The file is not an ade bundle of version 1.");
  }
  if (!Array.isArray(input.files)) {
    throw new AdeError("bundle-invalid", "The bundle has no file list.");
  }
  const seen = new Set<string>();
  let total = 0;
  for (const file of input.files) {
    if (
      !isPlainObject(file) ||
      typeof file.path !== "string" ||
      typeof file.content !== "string" ||
      (file.encoding !== "utf8" && file.encoding !== "base64")
    ) {
      throw new AdeError("bundle-invalid", "The bundle has a file entry that is not valid.");
    }
    const normalized = path.posix.normalize(file.path);
    if (!isSafeRelative(file.path) || normalized !== file.path || file.path.includes("\\")) {
      throw new AdeError("bundle-invalid", `The bundle path is not safe: ${file.path}.`);
    }
    const key = file.path.normalize("NFC").toLowerCase();
    if (seen.has(key)) {
      throw new AdeError(
        "bundle-invalid",
        `The bundle has the path ${file.path} two times, or paths that differ only in case.`,
      );
    }
    seen.add(key);
    total += file.content.length;
    if (total > MAX_BUNDLE_BYTES * 2) {
      throw new AdeError("bundle-invalid", "The bundle is larger than the 64 MB limit.");
    }
  }
  if (!input.files.some((file) => isPlainObject(file) && file.path === PROFILE_FILE)) {
    throw new AdeError("bundle-invalid", `The bundle has no ${PROFILE_FILE} file.`);
  }
  return input as unknown as Bundle;
}

export interface ImportOptions {
  readonly force?: boolean | undefined;
}

export async function importBundle(
  input: unknown,
  dir: string,
  options: ImportOptions = {},
): Promise<LoadedProfile> {
  const bundle = parseBundle(input);
  const root = path.resolve(dir);
  if (!(await isEmptyDir(root)) && options.force !== true) {
    throw new AdeError("profile-exists", `The directory is not empty: ${root}.`, {
      hint: "Use an empty directory, or add --force to write into it.",
    });
  }
  await ensureDir(root);
  for (const file of bundle.files) {
    const target = safeJoin(root, file.path, "the profile directory");
    await ensureDir(path.dirname(target));
    const content =
      file.encoding === "utf8"
        ? Buffer.from(file.content, "utf8")
        : Buffer.from(file.content, "base64");
    await fs.writeFile(target, content, { mode: fileMode(file) });
    await fs.chmod(target, fileMode(file));
  }
  return loadProfile(root);
}
