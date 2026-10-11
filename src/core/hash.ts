import { createHash } from "node:crypto";

export const ABSENT = Symbol("ade.absent");
export type Absent = typeof ABSENT;

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === ABSENT || value === undefined) {
    return "\u0000absent";
  }
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) {
        result[key] = normalize(item);
      }
    }
    return result;
  }
  return value;
}

export function hashValue(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
