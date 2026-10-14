import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cardPath,
  cardVersion,
  fitTags,
  imageType,
  isAvatarHost,
  loadAvatar,
} from "../site/app/user-card.ts";

const source = {
  handle: "ege",
  displayName: "Ege",
  avatarUrl: "https://workoscdn.com/images/a.png",
  github: "woosal1337",
  updatedAt: "2026-10-13T00:00:00.000Z",
  items: [{ key: "skill:b" }, { key: "skill:a" }],
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function reply(status: number, body: Uint8Array | string, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : Buffer.from(body), { status, headers });
}

describe("user card", () => {
  test("the version changes with the public data, not with the item order", () => {
    const version = cardVersion(source);
    assert.match(version, /^[0-9a-f]{12}$/);
    assert.equal(cardVersion({ ...source, items: [...source.items].reverse() }), version);
    assert.notEqual(cardVersion({ ...source, displayName: "Ege C" }), version);
    assert.notEqual(cardVersion({ ...source, items: [{ key: "skill:a" }] }), version);
    assert.notEqual(cardVersion({ ...source, avatarUrl: null }), version);
    assert.equal(cardPath(source), `/ege/og.png?v=${version}`);
  });

  test("tags fill the row and leave room for the more label", () => {
    const names = ["alpha", "beta", "gamma", "delta"];
    assert.deepEqual(fitTags(names, 4, 10_000, 20, 12, 10), { shown: names, hidden: 0 });
    const tight = fitTags(names, 9, 300, 20, 12, 10);
    assert.deepEqual(tight, { shown: ["alpha", "beta"], hidden: 7 });
    assert.deepEqual(fitTags(["x".repeat(80)], 1, 300, 20, 12, 10), { shown: [], hidden: 1 });
  });

  test("only HTTPS avatar hosts on the list pass", () => {
    assert.equal(isAvatarHost("https://workoscdn.com/images/a.png"), true);
    assert.equal(isAvatarHost("https://avatars.githubusercontent.com/u/1?v=4"), true);
    assert.equal(isAvatarHost("http://workoscdn.com/a.png"), false);
    assert.equal(isAvatarHost("https://workoscdn.com:8443/a.png"), false);
    assert.equal(isAvatarHost("https://evil.example/a.png"), false);
    assert.equal(isAvatarHost("https://workoscdn.com.evil.example/a.png"), false);
    assert.equal(isAvatarHost("not a url"), false);
  });

  test("the image type comes from the first bytes", () => {
    assert.equal(imageType(PNG), "image/png");
    assert.equal(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
    assert.equal(imageType(new TextEncoder().encode("<svg></svg>")), undefined);
  });

  test("the avatar loader follows allowed redirects and refuses the rest", async () => {
    const calls: string[] = [];
    const fake = (routes: Record<string, () => Response>) =>
      (async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        return routes[url]?.() ?? reply(404, "");
      }) as typeof fetch;
    const ok = await loadAvatar(
      "https://github.com/ege.png",
      fake({
        "https://github.com/ege.png": () =>
          reply(302, "", { location: "https://avatars.githubusercontent.com/u/1?v=4" }),
        "https://avatars.githubusercontent.com/u/1?v=4": () => reply(200, PNG),
      }),
    );
    assert.match(ok ?? "", /^data:image\/png;base64,/);
    calls.length = 0;
    const away = await loadAvatar(
      "https://github.com/ege.png",
      fake({
        "https://github.com/ege.png": () =>
          reply(302, "", { location: "http://169.254.169.254/latest" }),
      }),
    );
    assert.equal(away, undefined);
    assert.deepEqual(calls, ["https://github.com/ege.png"]);
    assert.equal(await loadAvatar("https://evil.example/a.png", fake({})), undefined);
    assert.equal(await loadAvatar(null, fake({})), undefined);
    const svg = await loadAvatar(
      "https://workoscdn.com/a.png",
      fake({ "https://workoscdn.com/a.png": () => reply(200, "<svg></svg>") }),
    );
    assert.equal(svg, undefined);
    const big = await loadAvatar(
      "https://workoscdn.com/a.png",
      fake({
        "https://workoscdn.com/a.png": () =>
          reply(200, PNG, { "content-length": String(3 * 1024 * 1024) }),
      }),
    );
    assert.equal(big, undefined);
  });
});
