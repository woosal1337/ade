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

  test("an account moves to a new WorkOS user only when the old user is gone and GitHub matches", async () => {
    const { app, auth, db } = await testApp();
    auth.addUser("user_old", "ege");
    await app.request("/v1/me", bearer("ege"));
    await app.request("/v1/me", bearer("ege", jsonBody("PATCH", { handle: "custom" })));
    auth.githubIds.set("user_new", "4242");
    auth.addUser("user_new", "ege");
    const kept = await json(await app.request("/v1/me", bearer("ege")));
    assert.equal((kept.account as Json).handle, "ege");
    await db.query("delete from users where workos_user_id = $1", ["user_new"]);
    auth.removedUsers.add("user_old");
    const moved = await json(await app.request("/v1/me", bearer("ege")));
    assert.equal((moved.account as Json).handle, "custom");
    const [row] = await db.query<{ workos_user_id: string; github_id: string }>(
      "select workos_user_id, github_id from users where handle = $1",
      ["custom"],
    );
    assert.deepEqual(row, { workos_user_id: "user_new", github_id: "4242" });
    auth.removedUsers.add("user_new");
    auth.githubIds.set("user_other", "9999");
    auth.addUser("user_other", "ege");
    const other = await json(await app.request("/v1/me", bearer("ege")));
    assert.notEqual((other.account as Json).handle, "custom");
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

  async function startLogin(
    app: Awaited<ReturnType<typeof testApp>>["app"],
    returnTo = "/dashboard",
  ) {
    const start = await app.request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    return { state, cookie: `ade_login=${cookieOf(start, "ade_login")}` };
  }

  test("a login that needs an email code waits for the code, and the code finishes it", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    auth.unverified.add("user_1");
    const { state, cookie } = await startLogin(app, "/ege");
    const callback = await app.request(
      `/auth/callback?code=code-ege&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie },
      },
    );
    assert.equal(callback.headers.get("location"), `${SITE}/dashboard?login=verify`);
    assert.equal(cookieOf(callback, "ade_session"), undefined);
    const pending = cookieOf(callback, "ade_pending");
    assert.ok(pending);
    assert.match(
      callback.headers.getSetCookie().join("\n"),
      /ade_pending=[^;]+; Max-Age=600; Path=\/api; HttpOnly; Secure; SameSite=Lax/,
    );
    const withPending = { cookie: `ade_pending=${pending}` };
    const shown = await json(await app.request("/auth/pending", { headers: withPending }));
    assert.equal(shown.email, "eg***@example.org");
    const post = (code: string, origin = SITE) =>
      app.request(
        "/auth/verify",
        jsonBody("POST", { code }, { headers: { ...withPending, origin } }),
      );
    assert.equal((await post("123456", "https://evil.test")).status, 403);
    assert.equal((await post("12")).status, 400);
    const wrong = await post("000000");
    assert.equal(wrong.status, 400);
    assert.equal(((await json(wrong)).error as Json).code, "code-invalid");
    const right = await post("123456");
    assert.equal(right.status, 200);
    assert.deepEqual(await json(right), { redirect: "/ege" });
    const session = cookieOf(right, "ade_session");
    assert.ok(session);
    assert.match(right.headers.getSetCookie().join("\n"), /ade_pending=;/);
    const me = await app.request("/v1/me", { headers: { cookie: `ade_session=${session}` } });
    assert.equal(((await json(me)).account as Json).handle, "ege");
    const again = await post("123456");
    assert.equal(((await json(again)).error as Json).code, "login-expired");
  });

  test("a code check without a pending login, and too many wrong codes, need a new login", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    auth.unverified.add("user_1");
    const none = await app.request(
      "/auth/verify",
      jsonBody("POST", { code: "123456" }, { headers: { origin: SITE } }),
    );
    assert.equal(((await json(none)).error as Json).code, "login-expired");
    assert.equal((await app.request("/auth/pending")).status, 404);
    const { state, cookie } = await startLogin(app);
    const callback = await app.request(
      `/auth/callback?code=code-ege&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie },
      },
    );
    const headers = { cookie: `ade_pending=${cookieOf(callback, "ade_pending")}`, origin: SITE };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await app.request(
        "/auth/verify",
        jsonBody("POST", { code: "000000" }, { headers }),
      );
      assert.equal(wrong.status, 400);
    }
    const blocked = await app.request(
      "/auth/verify",
      jsonBody("POST", { code: "123456" }, { headers }),
    );
    assert.equal(blocked.status, 429);
    assert.match(blocked.headers.getSetCookie().join("\n"), /ade_pending=;/);
  });

  test("a second callback request keeps the login state, and a WorkOS error goes to the log", async () => {
    const { app, auth } = await testApp();
    auth.addUser("user_1", "ege");
    auth.sessions.set("sealed-1", "user_1");
    const pendingOnly = await app.request("/auth/callback?code=x&state=y", {
      headers: {
        cookie: `ade_pending=${Buffer.from(JSON.stringify({ token: "t", email: "e@x.org", returnTo: "/dashboard" })).toString("base64url")}`,
      },
    });
    assert.equal(pendingOnly.headers.get("location"), `${SITE}/dashboard?login=verify`);
    const sessionOnly = await app.request("/auth/callback?code=x&state=y", {
      headers: { cookie: "ade_session=sealed-1" },
    });
    assert.equal(sessionOnly.headers.get("location"), `${SITE}/dashboard`);
    const nothing = await app.request("/auth/callback?code=x&state=y");
    assert.equal(nothing.headers.get("location"), `${SITE}/dashboard?login=failed`);
    const denied = await app.request("/auth/callback?error=access_denied&state=y");
    assert.equal(denied.headers.get("location"), `${SITE}/dashboard?login=failed`);
    assert.ok(auth.logLines.some((line) => line.includes("WorkOS sent the error access_denied")));
    assert.ok(auth.logLines.some((line) => line.includes("no matching state")));
  });
});
