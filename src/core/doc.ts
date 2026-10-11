import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { AdeError, errnoCode, errorMessage } from "./errors.ts";
import { sha256 } from "./hash.ts";

export type DocFormat = "json" | "toml";
export type DocData = Record<string, unknown>;
export type Pointer = readonly string[];

export interface LoadedDoc {
  readonly path: string;
  readonly realPath: string;
  readonly exists: boolean;
  readonly format: DocFormat;
  readonly text: string;
  readonly hash: string;
  readonly data: DocData;
  readonly mode: number | undefined;
  readonly indent: string;
  readonly commentLines: number;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

export function docFormatFor(file: string): DocFormat | undefined {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".toml") {
    return "toml";
  }
  return undefined;
}

export async function resolveRealPath(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") {
      throw error;
    }
  }
  try {
    const target = await fs.readlink(file);
    return path.resolve(path.dirname(file), target);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT" && errnoCode(error) !== "EINVAL") {
      throw error;
    }
  }
  try {
    return path.join(await fs.realpath(path.dirname(file)), path.basename(file));
  } catch {
    return file;
  }
}

export async function loadDoc(file: string, format: DocFormat): Promise<LoadedDoc> {
  const realPath = await resolveRealPath(file);
  let text: string | undefined;
  let mode: number | undefined;
  try {
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      throw new AdeError("parse-failed", `The path is not a file: ${file}.`);
    }
    mode = stat.mode & 0o777;
    text = await fs.readFile(realPath, "utf8");
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") {
      throw error;
    }
  }
  if (text === undefined) {
    return {
      path: file,
      realPath,
      exists: false,
      format,
      text: "",
      hash: "",
      data: {},
      mode: undefined,
      indent: "  ",
      commentLines: 0,
    };
  }
  return {
    path: file,
    realPath,
    exists: true,
    format,
    text,
    hash: sha256(text),
    data: parseDocText(text, format, file),
    mode,
    indent: detectIndent(text),
    commentLines: format === "toml" ? countCommentLines(text) : 0,
  };
}

export function parseDocText(text: string, format: DocFormat, label: string): DocData {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (source.trim() === "") {
    return {};
  }
  let value: unknown;
  try {
    value = format === "json" ? JSON.parse(source) : parseToml(source);
  } catch (error) {
    throw new AdeError("parse-failed", `The file is not valid ${format.toUpperCase()}: ${label}.`, {
      hint: "Correct the file, then run the command again.",
      details: [errorMessage(error)],
      cause: error,
    });
  }
  if (!isPlainObject(value)) {
    throw new AdeError("parse-failed", `The file has no object at the top level: ${label}.`);
  }
  return value;
}

export function serializeDoc(data: DocData, format: DocFormat, indent = "  "): string {
  if (format === "json") {
    return `${JSON.stringify(data, null, indent)}\n`;
  }
  let text: string;
  try {
    text = stringifyToml(data);
  } catch (error) {
    throw new AdeError("unsupported", "TOML cannot store this value.", {
      hint: "TOML has no null value. Remove the null value from the profile.",
      details: [errorMessage(error)],
      cause: error,
    });
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}

function detectIndent(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text);
  return match?.[1] ?? "  ";
}

function countCommentLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trimStart().startsWith("#")).length;
}

export function getAt(data: unknown, pointer: Pointer): unknown {
  let current: unknown = data;
  for (const key of pointer) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function defineKey(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function setAt(data: DocData, pointer: Pointer, value: unknown): void {
  const last = pointer[pointer.length - 1];
  if (last === undefined) {
    throw new AdeError("usage", "A document key path needs at least one key.");
  }
  let current: Record<string, unknown> = data;
  for (let index = 0; index < pointer.length - 1; index += 1) {
    const key = pointer[index] as string;
    const next = Object.hasOwn(current, key) ? current[key] : undefined;
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      defineKey(current, key, created);
      current = created;
      continue;
    }
    if (!isPlainObject(next)) {
      throw new AdeError(
        "conflict",
        `The key ${formatPointer(pointer.slice(0, index + 1))} holds a value that is not an object.`,
        { hint: "Change the profile or the target file so that the key holds an object." },
      );
    }
    current = next;
  }
  defineKey(current, last, cloneValue(value));
}

export function deleteAt(data: DocData, pointer: Pointer): boolean {
  const last = pointer[pointer.length - 1];
  if (last === undefined) {
    return false;
  }
  const parent = getAt(data, pointer.slice(0, -1));
  if (!isPlainObject(parent) || !Object.hasOwn(parent, last)) {
    return false;
  }
  delete parent[last];
  return true;
}

export function cloneValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  return structuredClone(value);
}

export function formatPointer(pointer: Pointer): string {
  return pointer
    .map((segment) => (/^[A-Za-z0-9_-]+$/.test(segment) ? segment : JSON.stringify(segment)))
    .join(".");
}

export function encodePointer(pointer: Pointer): string {
  return `/${pointer.map((segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

export function parseKeyPath(text: string): string[] {
  const segments: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      let end = index + 1;
      let segment = "";
      while (end < text.length && text[end] !== '"') {
        if (text[end] === "\\" && end + 1 < text.length) {
          segment += text[end + 1];
          end += 2;
          continue;
        }
        segment += text[end];
        end += 1;
      }
      if (end >= text.length) {
        throw new AdeError("usage", `The key path has an open quote: ${text}.`);
      }
      segments.push(segment);
      index = end + 1;
    } else {
      let end = index;
      while (end < text.length && text[end] !== ".") {
        end += 1;
      }
      const segment = text.slice(index, end);
      if (segment === "") {
        throw new AdeError("usage", `The key path has an empty key: ${text}.`);
      }
      segments.push(segment);
      index = end;
    }
    if (index < text.length) {
      if (text[index] !== ".") {
        throw new AdeError("usage", `The key path is not valid: ${text}.`);
      }
      index += 1;
      if (index === text.length) {
        throw new AdeError("usage", `The key path ends with a dot: ${text}.`);
      }
    }
  }
  if (segments.length === 0) {
    throw new AdeError("usage", "The key path is empty.");
  }
  return segments;
}
