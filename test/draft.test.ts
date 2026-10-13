import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyDraft,
  type DraftItem,
  draftStorageKey,
  normalizeOverrides,
  parseStoredDraft,
  previewPerson,
  publicView,
  setOverrides,
} from "../site/app/draft.ts";

const item = (
  key: string,
  kind: string,
  label: string,
  state: DraftItem["state"],
  detail = {},
): DraftItem => ({
  key,
  kind,
  group: kind,
  label,
  detail,
  state,
});

const items: DraftItem[] = [
  item("harnesses", "harnesses", "Harnesses", "public", { harnesses: ["pi", "claude", "pi"] }),
  item("skill:b", "skill", "b-skill", "hidden"),
  item("skill:a", "skill", "a-skill", "public"),
  item("mcp:docs", "mcp", "docs", "changed"),
  item("plugin:x", "plugin", "x@acme", "hidden"),
  item("setting:pi:/theme", "setting", "theme", "public"),
  item("secret:TOKEN", "secret", "TOKEN", "hidden", { name: "TOKEN", from: "command" }),
];

describe("dashboard draft", () => {
  test("only real changes stay in the draft, and a toggle back removes the change", () => {
    let draft = setOverrides(items, {}, ["skill:b"], true);
    assert.deepEqual(draft, { "skill:b": true });
    draft = setOverrides(items, draft, ["skill:a"], true);
    assert.deepEqual(draft, { "skill:b": true });
    draft = setOverrides(items, draft, ["skill:b"], false);
    assert.deepEqual(draft, {});
    assert.deepEqual(setOverrides(items, {}, ["mcp:docs"], false), {});
    assert.deepEqual(setOverrides(items, {}, ["mcp:docs"], true), { "mcp:docs": true });
    assert.deepEqual(normalizeOverrides(items, { "skill:gone": true, "skill:a": false }), {
      "skill:a": false,
    });
  });

  test("the draft view sets the state, and the public view hides secret details", () => {
    const view = applyDraft(items, { "mcp:docs": true, "skill:a": false, "secret:TOKEN": true });
    assert.equal(view.find((entry) => entry.key === "mcp:docs")?.state, "public");
    assert.equal(view.find((entry) => entry.key === "skill:a")?.state, "hidden");
    const shown = publicView(view);
    assert.deepEqual(
      shown.map((entry) => entry.key),
      ["harnesses", "mcp:docs", "setting:pi:/theme", "secret:TOKEN"],
    );
    assert.deepEqual(shown.find((entry) => entry.kind === "secret")?.detail, { name: "TOKEN" });
    assert.equal("state" in (shown[0] ?? {}), false);
  });

  test("the card preview summarizes the public items like the server", () => {
    const base = { handle: "ege", displayName: "Ege", avatarUrl: null, github: "woosal1337" };
    const person = previewPerson(
      base,
      applyDraft(items, { "skill:b": true, "plugin:x": true }),
      "2026-10-13T00:00:00.000Z",
    );
    assert.ok(person);
    assert.deepEqual(person.harnesses, ["claude", "pi"]);
    assert.deepEqual(person.skills, ["a-skill", "b-skill"]);
    assert.deepEqual(person.plugins, ["x@acme"]);
    assert.equal(person.mcpCount, 0);
    assert.equal(person.settingCount, 1);
    assert.equal(person.itemCount, 5);
    assert.deepEqual(person.votes, { score: 0, up: 0, down: 0, mine: 0 });
    const many = Array.from({ length: 11 }, (_, index) =>
      item(`skill:${index}`, "skill", `s${String(index).padStart(2, "0")}`, "public"),
    );
    const long = previewPerson(base, many, "2026-10-13T00:00:00.000Z");
    assert.equal(long?.skills.length, 8);
    assert.equal(long?.skillCount, 11);
    assert.equal(
      previewPerson(
        base,
        applyDraft(items, { harnesses: false, "skill:a": false, "setting:pi:/theme": false }),
        "x",
      ),
      undefined,
    );
  });

  test("a stored draft keeps only true and false values", () => {
    assert.equal(draftStorageKey("ege", "abc"), "ade.draft.v1:ege:abc");
    assert.deepEqual(parseStoredDraft('{"a":true,"b":false,"c":"x","d":1}'), { a: true, b: false });
    assert.deepEqual(parseStoredDraft("{"), {});
    assert.deepEqual(parseStoredDraft("[1]"), {});
    assert.deepEqual(parseStoredDraft(null), {});
  });
});
