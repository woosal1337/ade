import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseMarkdown } from "../../src/profile/markdown.ts";
import { RateLimiter } from "../src/limits.ts";
import { API, bearer, jsonBody, SITE, sampleBundle, testApp } from "./helpers.ts";

type Json = Record<string, unknown>;

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

async function upload(
  app: Awaited<ReturnType<typeof testApp>>["app"],
  login: string,
  bundle: unknown,
) {
  return app.request(
    "/v1/me/snapshots",
    bearer(login, jsonBody("POST", { bundle, client: { version: "0.1.0" } })),
  );
}

describe("service basics", () => {
  test("health and auth config", async () => {
    const { app } = await testApp();
    const health = await json(await app.request("/health"));
    assert.equal(health.ok, true);
    assert.equal(health.auth, true);
    const config = await json(await app.request("/v1/auth/config"));
    assert.equal(config.clientId, "client_test");
    const off = await testApp({ configured: false });
    const missing = await off.app.request("/v1/auth/config");
    assert.equal(missing.status, 503);
    assert.equal((await off.app.request("/auth/login")).status, 503);
  });

  test("a request without a valid token gets 401", async () => {
    const { app } = await testApp();
    assert.equal((await app.request("/v1/me")).status, 401);
    const bad = await app.request("/v1/me", { headers: { authorization: "Bearer nope" } });
    assert.equal(bad.status, 401);
  });

  test("the rate limiter counts each key in its window", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    assert.equal(limiter.hit("a"), true);
    assert.equal(limiter.hit("a"), true);
    assert.equal(limiter.hit("a"), false);
    assert.equal(limiter.hit("b"), true);
    now = 1000;
    assert.equal(limiter.hit("a"), true);
  });
});

describe("accounts", () => {
  test("the first request makes the account with a handle from the GitHub login", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "Octo-Cat", "Octo Cat");
    const me = await json(await app.request("/v1/me", bearer("Octo-Cat")));
    const account = me.account as Json;
    assert.equal(account.handle, "octo-cat");
    assert.equal(account.page, `${SITE}/octo-cat`);
    assert.equal(me.snapshot, null);
    const again = await json(await app.request("/v1/me", bearer("Octo-Cat")));
    assert.equal((again.account as Json).handle, "octo-cat");
  });

  test("a second account with the same login gets another handle", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    auth.addUser("user_2", "ege");
    auth.tokens.set("token-first", "user_1");
    auth.tokens.set("token-second", "user_2");
    const first = await json(
      await app.request("/v1/me", { headers: { authorization: "Bearer token-first" } }),
    );
    const second = await json(
      await app.request("/v1/me", { headers: { authorization: "Bearer token-second" } }),
    );
    assert.equal((first.account as Json).handle, "ege");
    assert.equal((second.account as Json).handle, "ege-2");
  });

  test("a handle change checks the format, the reserved names, and the owner", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "first");
    auth.addUser("user_2", "second");
    await app.request("/v1/me", bearer("first"));
    await app.request("/v1/me", bearer("second"));
    const renamed = await app.request(
      "/v1/me",
      bearer("first", jsonBody("PATCH", { handle: "Ege" })),
    );
    assert.equal(renamed.status, 200);
    assert.equal(((await json(renamed)).account as Json).handle, "ege");
    for (const handle of ["dashboard", "bad_name", "-x", "a".repeat(40)]) {
      const response = await app.request("/v1/me", bearer("first", jsonBody("PATCH", { handle })));
      assert.equal(response.status, 400, handle);
    }
    const taken = await app.request(
      "/v1/me",
      bearer("second", jsonBody("PATCH", { handle: "ege" })),
    );
    assert.equal(taken.status, 409);
  });

  test("account deletion removes the public page", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "gone");
    await upload(app, "gone", await sampleBundle());
    assert.equal((await app.request("/v1/users/gone")).status, 200);
    const deleted = await app.request("/v1/me", bearer("gone", { method: "DELETE" }));
    assert.equal(deleted.status, 200);
    assert.equal((await app.request("/v1/users/gone")).status, 404);
  });
});

describe("uploads and approval", () => {
  test("an upload starts with every item hidden", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    const response = await upload(app, "ege", await sampleBundle());
    assert.equal(response.status, 200);
    const result = await json(response);
    assert.equal(result.items, 8);
    assert.equal(result.public, 0);
    assert.equal(result.hidden, 8);
    const page = await json(await app.request("/v1/users/ege"));
    assert.deepEqual(page.items, []);
    assert.equal((await app.request("/v1/users/ege/ADE.md")).status, 404);
    const again = await json(await upload(app, "ege", await sampleBundle()));
    assert.equal(again.unchanged, true);
  });

  test("only approved items reach the public page and the public ADE.md", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    await upload(app, "ege", await sampleBundle());
    const approve = await app.request(
      "/v1/me/visibility",
      bearer(
        "ege",
        jsonBody("PUT", {
          items: { "mcp:docs": true, "skill:review": true, "secret:DOCS_TOKEN": true },
        }),
      ),
    );
    assert.equal(approve.status, 200);
    assert.equal((await json(approve)).public, 3);
    const pageResponse = await app.request("/v1/users/EGE");
    assert.equal(pageResponse.headers.get("cache-control"), "no-store");
    const page = await json(pageResponse);
    const items = page.items as Json[];
    assert.deepEqual(
      items.map((item) => item.key),
      ["skill:review", "mcp:docs", "secret:DOCS_TOKEN"],
    );
    assert.deepEqual(items.find((item) => item.kind === "secret")?.detail, { name: "DOCS_TOKEN" });
    assert.equal(page.apply, "ade apply @ege");
    assert.equal(page.github, "ege");
    const markdown = await (await app.request("/v1/users/ege/ADE.md")).text();
    const parsed = parseMarkdown(markdown, "ADE.md");
    const profile = JSON.parse(
      parsed.bundle.files.find((file) => file.path === "ade.json")?.content ?? "{}",
    );
    assert.deepEqual(Object.keys(profile.mcp), ["docs"]);
    assert.deepEqual(profile.secrets, { DOCS_TOKEN: { from: "env", name: "DOCS_TOKEN" } });
    assert.equal(markdown.includes("Use short sentences"), false);
    assert.equal(markdown.includes("op://vault"), false);
    assert.equal(markdown.includes("local-mcp"), false);
  });

  test("a changed item leaves the public page until the owner approves it again", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    await upload(app, "ege", await sampleBundle());
    await app.request(
      "/v1/me/visibility",
      bearer("ege", jsonBody("PUT", { items: { "mcp:local": true, "mcp:docs": true } })),
    );
    const changed = await sampleBundle((profile) => {
      profile.mcp = {
        ...profile.mcp,
        local: { transport: "stdio", command: "npx", args: ["-y", "local-mcp@2"] },
      };
    });
    const result = await json(await upload(app, "ege", changed));
    assert.equal(result.changed, 1);
    assert.equal(result.public, 1);
    const page = await json(await app.request("/v1/users/ege"));
    assert.deepEqual(
      (page.items as Json[]).map((item) => item.key),
      ["mcp:docs"],
    );
    const me = await json(await app.request("/v1/me", bearer("ege")));
    const local = (me.items as Json[]).find((item) => item.key === "mcp:local");
    assert.equal(local?.state, "changed");
    await app.request(
      "/v1/me/visibility",
      bearer("ege", jsonBody("PUT", { items: { "mcp:local": true } })),
    );
    const after = await json(await app.request("/v1/users/ege"));
    assert.equal((after.items as Json[]).length, 2);
  });

  test("a removed item loses its approval, so it starts hidden when it comes back", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    await upload(app, "ege", await sampleBundle());
    await app.request(
      "/v1/me/visibility",
      bearer("ege", jsonBody("PUT", { items: { "mcp:local": true } })),
    );
    await upload(
      app,
      "ege",
      await sampleBundle((profile) => {
        const { local: _local, ...rest } = profile.mcp ?? {};
        profile.mcp = rest;
      }),
    );
    const back = await json(await upload(app, "ege", await sampleBundle()));
    assert.equal(back.public, 0);
  });

  test("an upload with a secret value, a local path, or a bad shape fails", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    const secret = await sampleBundle((profile) => {
      profile.settings = { pi: { apiKey: `ghp_${"a".repeat(36)}` } };
    });
    const refused = await upload(app, "ege", secret);
    assert.equal(refused.status, 422);
    assert.equal(((await json(refused)).error as Json).code, "secret-values");
    const local = await sampleBundle((profile) => {
      profile.skills = { mine: { link: "~/skills/mine" } };
    });
    const linked = await upload(app, "ege", local);
    assert.equal(linked.status, 400);
    assert.equal(((await json(linked)).error as Json).code, "not-self-contained");
    assert.equal((await upload(app, "ege", { format: "nope" })).status, 400);
    const big = await app.request(
      "/v1/me/snapshots",
      bearer("ege", jsonBody("POST", { bundle: "x".repeat(9 * 1024 * 1024) })),
    );
    assert.equal(big.status, 413);
    const me = await json(await app.request("/v1/me", bearer("ege")));
    assert.equal(me.snapshot, null);
  });

  test("a visibility change for an unknown item fails", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    await upload(app, "ege", await sampleBundle());
    const response = await app.request(
      "/v1/me/visibility",
      bearer("ege", jsonBody("PUT", { items: { "mcp:nope": true } })),
    );
    assert.equal(response.status, 400);
    const wrongType = await app.request(
      "/v1/me/visibility",
      bearer("ege", jsonBody("PUT", { items: { "mcp:docs": "yes" } })),
    );
    assert.equal(wrongType.status, 400);
  });
});

describe("web sessions", () => {
  function cookieOf(response: Response, name: string): string | undefined {
    const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
    return header?.split(";")[0]?.slice(name.length + 1);
  }

  test("login sets a session cookie for the API path, and the state must match", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    const start = await app.request("/auth/login?returnTo=/ege");
    assert.equal(start.status, 302);
    const location = start.headers.get("location") ?? "";
    const state = new URL(location).searchParams.get("state") ?? "";
    assert.equal(new URL(location).searchParams.get("redirect_uri"), `${API}/auth/callback`);
    const stateCookie = cookieOf(start, "ade_login");
    assert.ok(stateCookie);
    assert.match(
      start.headers.getSetCookie().join("\n"),
      /Path=\/api; HttpOnly; Secure; SameSite=Lax/,
    );
    const forged = await app.request(`/auth/callback?code=code-ege&state=other`, {
      headers: { cookie: `ade_login=${stateCookie}` },
    });
    assert.equal(forged.headers.get("location"), `${SITE}/dashboard?login=failed`);
    assert.equal(cookieOf(forged, "ade_session") ?? "", "");
    const done = await app.request(
      `/auth/callback?code=code-ege&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie: `ade_login=${stateCookie}` },
      },
    );
    assert.equal(done.status, 302);
    assert.equal(done.headers.get("location"), `${SITE}/ege`);
    const session = cookieOf(done, "ade_session");
    assert.ok(session);
    assert.equal(cookieOf(done, "ade_hint"), "1");
    assert.match(
      done.headers.getSetCookie().join("\n"),
      /ade_hint=1; Max-Age=\d+; Path=\/; Secure; SameSite=Lax/,
    );
    const me = await app.request("/v1/me", { headers: { cookie: `ade_session=${session}` } });
    assert.equal(me.status, 200);
  });

  test("a cookie request that changes data needs the site origin", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    auth.sessions.set("sealed-1", "user_1");
    const cookie = { cookie: "ade_session=sealed-1" };
    const foreign = await app.request(
      "/v1/me",
      jsonBody(
        "PATCH",
        { handle: "other" },
        { headers: { ...cookie, origin: "https://evil.test" } },
      ),
    );
    assert.equal(foreign.status, 403);
    const missing = await app.request(
      "/v1/me",
      jsonBody("PATCH", { handle: "other" }, { headers: cookie }),
    );
    assert.equal(missing.status, 403);
    const ok = await app.request(
      "/v1/me",
      jsonBody("PATCH", { handle: "other" }, { headers: { ...cookie, origin: SITE } }),
    );
    assert.equal(ok.status, 200);
  });

  test("a refreshed session gets a new cookie, and logout clears it", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    auth.sessions.set("sealed-old", "user_1");
    auth.refreshes.set("sealed-old", "sealed-new");
    const me = await app.request("/v1/me", { headers: { cookie: "ade_session=sealed-old" } });
    assert.equal(me.status, 200);
    assert.match(me.headers.getSetCookie().join("\n"), /ade_session=sealed-new/);
    const logout = await app.request("/auth/logout", {
      method: "POST",
      headers: { cookie: "ade_session=sealed-old", origin: SITE },
    });
    const body = await json(logout);
    assert.equal(body.redirect, `${SITE}/`);
    assert.deepEqual(auth.loggedOut, ["sealed-old"]);
    assert.match(logout.headers.getSetCookie().join("\n"), /ade_session=;/);
    assert.match(logout.headers.getSetCookie().join("\n"), /ade_hint=;/);
  });

  test("an unknown session gets 401 and a cleared cookie", async () => {
    const { app } = await testApp();
    const response = await app.request("/v1/me", { headers: { cookie: "ade_session=nope" } });
    assert.equal(response.status, 401);
    assert.match(response.headers.getSetCookie().join("\n"), /ade_session=;/);
  });
});
