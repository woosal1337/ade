import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  deleteAt,
  encodePointer,
  formatPointer,
  getAt,
  parseDocText,
  parseKeyPath,
  serializeDoc,
  setAt,
} from "../src/core/doc.ts";
import { AdeError } from "../src/core/errors.ts";
import { isSafeRelative } from "../src/core/fsx.ts";
import { ABSENT, hashValue, valuesEqual } from "../src/core/hash.ts";
import { applyMergePatch, listLeaves, mergeDiff } from "../src/core/merge.ts";
import { escapeTemplate, findSecretRefs, templateHome } from "../src/secrets/refs.ts";

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("documents", () => {
  test("parseKeyPath reads dotted and quoted keys", () => {
    assert.deepEqual(parseKeyPath("permissions.defaultMode"), ["permissions", "defaultMode"]);
    assert.deepEqual(parseKeyPath('projects."/work/app".trust'), [
      "projects",
      "/work/app",
      "trust",
    ]);
    assert.throws(() => parseKeyPath("a..b"), AdeError);
    assert.throws(() => parseKeyPath('a."b'), AdeError);
    assert.throws(() => parseKeyPath("a."), AdeError);
  });

  test("setAt creates objects and refuses to replace a scalar", () => {
    const data: Record<string, unknown> = { a: 1 };
    setAt(data, ["b", "c"], [1, 2]);
    assert.deepEqual(data, { a: 1, b: { c: [1, 2] } });
    assert.throws(() => setAt(data, ["a", "x"], true), AdeError);
  });

  test("setAt stores a __proto__ key as data", () => {
    const data: Record<string, unknown> = {};
    setAt(data, ["__proto__", "polluted"], true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(getAt(data, ["__proto__", "polluted"]), true);
  });

  test("deleteAt removes only the leaf", () => {
    const data: Record<string, unknown> = { a: { b: 1, c: 2 } };
    assert.equal(deleteAt(data, ["a", "b"]), true);
    assert.equal(deleteAt(data, ["a", "missing"]), false);
    assert.deepEqual(data, { a: { c: 2 } });
  });

  test("JSON and TOML documents round-trip", () => {
    const json = parseDocText('{"a": {"b": [1, "x"]}}', "json", "a.json");
    assert.equal(
      serializeDoc(json, "json"),
      '{\n  "a": {\n    "b": [\n      1,\n      "x"\n    ]\n  }\n}\n',
    );
    const toml = parseDocText(
      'model = "x"\n\n[mcp_servers.docs]\nurl = "https://d"\n',
      "toml",
      "c.toml",
    );
    assert.deepEqual(plain(toml), { model: "x", mcp_servers: { docs: { url: "https://d" } } });
    assert.deepEqual(
      plain(parseDocText(serializeDoc(toml, "toml"), "toml", "c.toml")),
      plain(toml),
    );
  });

  test("parse errors name the file", () => {
    assert.throws(
      () => parseDocText("{bad", "json", "/x/settings.json"),
      (error: unknown) => error instanceof AdeError && error.message.includes("/x/settings.json"),
    );
    assert.throws(() => parseDocText("[1]", "json", "list.json"), AdeError);
  });

  test("TOML refuses null values", () => {
    assert.throws(() => serializeDoc({ a: [null] }, "toml"), AdeError);
  });

  test("pointers format and encode", () => {
    assert.equal(formatPointer(["a", "b.c"]), 'a."b.c"');
    assert.equal(encodePointer(["a/b", "c~d"]), "/a~1b/c~0d");
  });
});

describe("merge patches", () => {
  test("applyMergePatch follows RFC 7386", () => {
    assert.deepEqual(
      applyMergePatch({ a: 1, b: { c: 2, d: 3 } }, { a: null, b: { c: 9 }, e: [1] }),
      {
        b: { c: 9, d: 3 },
        e: [1],
      },
    );
  });

  test("mergeDiff gives the patch from one object to another", () => {
    const from = { type: "stdio", command: "npx", args: ["a"] };
    const to = { command: "npx", args: ["a"], timeout: 5 };
    const patch = mergeDiff(from, to);
    assert.deepEqual(patch, { timeout: 5, type: null });
    assert.deepEqual(applyMergePatch(from, patch), to);
    assert.equal(mergeDiff(to, { ...to }), undefined);
  });

  test("listLeaves returns scalar and array leaves", () => {
    assert.deepEqual(listLeaves({ a: 1, b: { c: [1], d: { e: null } }, f: {} }), [
      [["a"], 1],
      [["b", "c"], [1]],
      [["b", "d", "e"], null],
    ]);
  });
});

describe("hashes", () => {
  test("hashValue ignores key order and marks absence", () => {
    assert.equal(hashValue({ a: 1, b: 2 }), hashValue({ b: 2, a: 1 }));
    assert.notEqual(hashValue(undefined), hashValue(null));
    assert.equal(hashValue(undefined), hashValue(ABSENT));
    assert.equal(valuesEqual([1, { x: 1 }], [1, { x: 1 }]), true);
  });
});

describe("templates", () => {
  test("findSecretRefs finds references in nested values", () => {
    assert.deepEqual(
      [...findSecretRefs({ a: ["Bearer ${secret:TOKEN}"], b: "${home}/x", c: "$${secret:NOT}" })],
      ["TOKEN"],
    );
  });

  test("templateHome replaces whole path prefixes only", () => {
    assert.equal(templateHome("/Users/ege/.claude/x", "/Users/ege"), "${home}/.claude/x");
    assert.equal(templateHome("/Users/egeis/x", "/Users/ege"), "/Users/egeis/x");
    assert.equal(templateHome("${secret:A} /Users/ege", "/Users/ege"), "$${secret:A} ${home}");
  });

  test("escapeTemplate protects literal references", () => {
    assert.equal(
      escapeTemplate("$${x} ${home} ${secret:A} ${OTHER}"),
      "$$${x} $${home} $${secret:A} ${OTHER}",
    );
  });

  test("isSafeRelative rejects escapes", () => {
    assert.equal(isSafeRelative("skills/a"), true);
    assert.equal(isSafeRelative("../a"), false);
    assert.equal(isSafeRelative("a/../../b"), false);
    assert.equal(isSafeRelative("/etc/passwd"), false);
    assert.equal(isSafeRelative("C:\\x"), false);
    assert.equal(isSafeRelative(""), false);
    assert.equal(isSafeRelative("."), false);
    assert.equal(isSafeRelative("a/./b"), false);
  });
});
