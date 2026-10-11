import { isPlainObject } from "../core/doc.ts";

export const REFERENCE_PATTERN = /\$\$\{|\$\{(secret:([A-Za-z_][A-Za-z0-9_]*)|home)\}/g;

export function findSecretRefs(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(REFERENCE_PATTERN)) {
      if (match[2] !== undefined) {
        found.add(match[2]);
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      findSecretRefs(item, found);
    }
  } else if (isPlainObject(value)) {
    for (const item of Object.values(value)) {
      findSecretRefs(item, found);
    }
  }
  return found;
}

export function escapeTemplate(text: string): string {
  return text.replace(REFERENCE_PATTERN, (match) => `$${match}`);
}

export function templateHome(text: string, home: string): string {
  const escaped = escapeTemplate(text);
  if (home === "" || home === "/") {
    return escaped;
  }
  const variants = new Set([home, home.replaceAll("\\", "/")]);
  let result = escaped;
  for (const variant of variants) {
    const pattern = new RegExp(`${escapeRegExp(variant)}(?=$|[\\\\/"'\\s:;,)])`, "g");
    result = result.replace(pattern, "${home}");
  }
  return result;
}

export function templateHomeDeep(value: unknown, home: string): unknown {
  if (typeof value === "string") {
    return templateHome(value, home);
  }
  if (Array.isArray(value)) {
    return value.map((item) => templateHomeDeep(item, home));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        value: templateHomeDeep(item, home),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  }
  return value;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
