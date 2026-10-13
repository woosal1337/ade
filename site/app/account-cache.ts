export const ACCOUNT_CACHE_KEY = "ade.account.v1";
export const ACCOUNT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CacheEntry {
  readonly version: 1;
  readonly savedAt: number;
  readonly value: unknown;
}

function isEntry(value: unknown): value is CacheEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return entry.version === 1 && typeof entry.savedAt === "number" && "value" in entry;
}

export function clearCached(storage: CacheStorage | undefined): void {
  try {
    storage?.removeItem(ACCOUNT_CACHE_KEY);
  } catch {
    return;
  }
}

export function readCached<T>(
  storage: CacheStorage | undefined,
  now: number,
  valid: (value: unknown) => value is T,
): T | undefined {
  if (storage === undefined) {
    return undefined;
  }
  let text: string | null;
  try {
    text = storage.getItem(ACCOUNT_CACHE_KEY);
  } catch {
    return undefined;
  }
  if (text === null) {
    return undefined;
  }
  let entry: unknown;
  try {
    entry = JSON.parse(text);
  } catch {
    clearCached(storage);
    return undefined;
  }
  const age = isEntry(entry) ? now - entry.savedAt : -1;
  if (!isEntry(entry) || age < 0 || age > ACCOUNT_CACHE_MAX_AGE_MS || !valid(entry.value)) {
    clearCached(storage);
    return undefined;
  }
  return entry.value;
}

export function writeCached(storage: CacheStorage | undefined, value: unknown, now: number): void {
  try {
    storage?.setItem(ACCOUNT_CACHE_KEY, JSON.stringify({ version: 1, savedAt: now, value }));
  } catch {
    return;
  }
}
