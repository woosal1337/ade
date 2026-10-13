import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ACCOUNT_CACHE_KEY,
  ACCOUNT_CACHE_MAX_AGE_MS,
  type CacheStorage,
  clearCached,
  readCached,
  writeCached,
} from "../site/app/account-cache.ts";

function memoryStorage(): CacheStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const isAccount = (value: unknown): value is { handle: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { handle?: unknown }).handle === "string";

describe("account cache", () => {
  test("a written account reads back until it is 30 days old", () => {
    const storage = memoryStorage();
    writeCached(storage, { handle: "ege" }, 1000);
    assert.deepEqual(readCached(storage, 1000 + 60_000, isAccount), { handle: "ege" });
    assert.deepEqual(readCached(storage, 1000 + ACCOUNT_CACHE_MAX_AGE_MS, isAccount), {
      handle: "ege",
    });
    assert.equal(readCached(storage, 1001 + ACCOUNT_CACHE_MAX_AGE_MS, isAccount), undefined);
    assert.equal(storage.values.has(ACCOUNT_CACHE_KEY), false);
  });

  test("damaged, foreign, or future data is removed", () => {
    const storage = memoryStorage();
    for (const text of [
      "{",
      '{"version":2,"savedAt":0,"value":{"handle":"x"}}',
      '{"version":1,"savedAt":0,"value":{"name":"x"}}',
    ]) {
      storage.values.set(ACCOUNT_CACHE_KEY, text);
      assert.equal(readCached(storage, 10, isAccount), undefined, text);
      assert.equal(storage.values.has(ACCOUNT_CACHE_KEY), false, text);
    }
    writeCached(storage, { handle: "ege" }, 5000);
    assert.equal(readCached(storage, 4000, isAccount), undefined);
  });

  test("clear removes the account, and a storage that throws reads as empty", () => {
    const storage = memoryStorage();
    writeCached(storage, { handle: "ege" }, 0);
    clearCached(storage);
    assert.equal(readCached(storage, 0, isAccount), undefined);
    const broken: CacheStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    assert.doesNotThrow(() => writeCached(broken, { handle: "ege" }, 0));
    assert.equal(readCached(broken, 0, isAccount), undefined);
    assert.doesNotThrow(() => clearCached(broken));
    assert.equal(readCached(undefined, 0, isAccount), undefined);
  });
});
