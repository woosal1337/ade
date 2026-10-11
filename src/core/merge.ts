import { cloneValue, isPlainObject } from "./doc.ts";
import { valuesEqual } from "./hash.ts";

export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) {
    return cloneValue(patch);
  }
  const result: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    Object.defineProperty(result, key, {
      value: applyMergePatch(result[key], value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

export function mergeDiff(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(to)) {
    if (!Object.hasOwn(from, key)) {
      patch[key] = cloneValue(value);
      continue;
    }
    const previous = from[key];
    if (isPlainObject(previous) && isPlainObject(value)) {
      const nested = mergeDiff(previous, value);
      if (nested !== undefined) {
        patch[key] = nested;
      }
      continue;
    }
    if (!valuesEqual(previous, value)) {
      patch[key] = cloneValue(value);
    }
  }
  for (const key of Object.keys(from)) {
    if (!Object.hasOwn(to, key)) {
      patch[key] = null;
    }
  }
  return Object.keys(patch).length === 0 ? undefined : patch;
}

export type Leaf = readonly [pointer: readonly string[], value: unknown];

export function listLeaves(patch: Record<string, unknown>, prefix: readonly string[] = []): Leaf[] {
  const leaves: Leaf[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const pointer = [...prefix, key];
    if (isPlainObject(value)) {
      if (Object.keys(value).length > 0) {
        leaves.push(...listLeaves(value, pointer));
      }
      continue;
    }
    leaves.push([pointer, value]);
  }
  return leaves;
}
