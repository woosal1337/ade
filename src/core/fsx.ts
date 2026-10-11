import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { AdeError, errnoCode } from "./errors.ts";
import { sha256 } from "./hash.ts";

export type PathState =
  | { readonly type: "absent" }
  | { readonly type: "file"; readonly hash: string; readonly mode: number; readonly size: number }
  | { readonly type: "symlink"; readonly target: string }
  | { readonly type: "dir"; readonly hash: string }
  | { readonly type: "other" };

const IGNORED_NAMES = new Set([".DS_Store", ".git"]);

export async function lstatOrUndefined(target: string): Promise<Stats | undefined> {
  try {
    return await fs.lstat(target);
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
}

export async function statOrUndefined(target: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(target);
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      return undefined;
    }
    throw error;
  }
}

export function normalizeLinkTarget(target: string): string {
  return target.startsWith("\\\\?\\") ? target.slice(4) : target;
}

export async function readLinkAbsolute(link: string): Promise<string> {
  const target = normalizeLinkTarget(await fs.readlink(link));
  return path.resolve(path.dirname(link), target);
}

export async function inspectPath(target: string): Promise<PathState> {
  const stat = await lstatOrUndefined(target);
  if (stat === undefined) {
    return { type: "absent" };
  }
  if (stat.isSymbolicLink()) {
    return { type: "symlink", target: await readLinkAbsolute(target) };
  }
  if (stat.isFile()) {
    const content = await fs.readFile(target);
    return { type: "file", hash: sha256(content), mode: stat.mode & 0o777, size: stat.size };
  }
  if (stat.isDirectory()) {
    if (await isJunction(target)) {
      return { type: "symlink", target: await readLinkAbsolute(target) };
    }
    return { type: "dir", hash: await treeHash(target) };
  }
  return { type: "other" };
}

async function isJunction(target: string): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    await fs.readlink(target);
    return true;
  } catch {
    return false;
  }
}

export function pathStateHash(state: PathState): string {
  switch (state.type) {
    case "absent":
      return "absent";
    case "file":
      return `file:${state.hash}`;
    case "symlink":
      return `link:${path.resolve(state.target)}`;
    case "dir":
      return `dir:${state.hash}`;
    case "other":
      return "other";
  }
}

export async function treeHash(root: string): Promise<string> {
  const lines: string[] = [];
  const active = new Set<string>();
  const walk = async (dir: string, relative: string): Promise<void> => {
    const real = await fs.realpath(dir);
    if (active.has(real)) {
      lines.push(`L ${relative}`);
      return;
    }
    active.add(real);
    const names = (await fs.readdir(dir)).filter((name) => !IGNORED_NAMES.has(name)).sort();
    for (const name of names) {
      const full = path.join(dir, name);
      const child = relative === "" ? name : `${relative}/${name}`;
      const stat = await statOrUndefined(full);
      if (stat === undefined) {
        lines.push(`X ${child}`);
      } else if (stat.isDirectory()) {
        lines.push(`D ${child}`);
        await walk(full, child);
      } else if (stat.isFile()) {
        lines.push(`F ${child} ${sha256(await fs.readFile(full))}`);
      }
    }
    active.delete(real);
  };
  await walk(root, "");
  return sha256(lines.join("\n"));
}

export async function countFiles(root: string): Promise<number> {
  let count = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const name of await fs.readdir(dir)) {
      if (IGNORED_NAMES.has(name)) {
        continue;
      }
      const stat = await statOrUndefined(path.join(dir, name));
      if (stat?.isDirectory()) {
        await walk(path.join(dir, name));
      } else if (stat?.isFile()) {
        count += 1;
      }
    }
  };
  await walk(root);
  return count;
}

export function tempSibling(target: string): string {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.ade-${randomBytes(4).toString("hex")}.tmp`,
  );
}

export async function ensureDir(dir: string, mode?: number): Promise<void> {
  await fs.mkdir(dir, mode === undefined ? { recursive: true } : { recursive: true, mode });
}

export async function atomicWrite(
  file: string,
  data: string | Uint8Array,
  mode?: number,
): Promise<void> {
  await ensureDir(path.dirname(file));
  const temp = tempSibling(file);
  const fileMode = mode ?? 0o644;
  try {
    await fs.writeFile(temp, data, { mode: fileMode, flag: "wx" });
    await fs.chmod(temp, fileMode);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

export async function copyTree(source: string, destination: string): Promise<void> {
  await fs.cp(source, destination, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false,
    filter: (item) => !IGNORED_NAMES.has(path.basename(item)),
  });
}

export async function copyExact(source: string, destination: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  await fs.cp(source, destination, { recursive: true, verbatimSymlinks: true });
}

export async function installTree(source: string, target: string): Promise<void> {
  await ensureDir(path.dirname(target));
  const temp = tempSibling(target);
  try {
    await copyTree(source, temp);
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { recursive: true, force: true });
    throw error;
  }
}

export async function createLink(
  target: string,
  link: string,
  kind: "file" | "dir",
  platform: NodeJS.Platform,
): Promise<void> {
  await ensureDir(path.dirname(link));
  const type = kind === "dir" ? (platform === "win32" ? "junction" : "dir") : "file";
  await fs.symlink(target, link, type);
}

export async function removePath(target: string): Promise<void> {
  const stat = await lstatOrUndefined(target);
  if (stat === undefined) {
    return;
  }
  if (stat.isSymbolicLink() || stat.isFile()) {
    await fs.unlink(target);
    return;
  }
  await fs.rm(target, { recursive: true, force: true });
}

export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isSafeRelative(relative: string): boolean {
  if (relative === "" || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) {
    return false;
  }
  return !relative.split(/[\\/]+/).some((part) => part === "..");
}

export function safeJoin(root: string, relative: string, label: string): string {
  if (!isSafeRelative(relative)) {
    throw new AdeError("path-outside-root", `The path must stay inside ${label}: ${relative}.`);
  }
  const full = path.resolve(root, relative);
  if (!isInside(full, root)) {
    throw new AdeError("path-outside-root", `The path must stay inside ${label}: ${relative}.`);
  }
  return full;
}

export async function samePath(left: string, right: string): Promise<boolean> {
  try {
    return (await fs.realpath(left)) === (await fs.realpath(right));
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

export async function readFileIfExists(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return true;
    }
    throw error;
  }
}
