import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { type FakeWorkos, startFakeWorkos } from "../dev/fake-workos.ts";
import { createApp } from "../src/app.ts";
import { workosAuth } from "../src/auth.ts";
import { API, memoryDb, SITE } from "./helpers.ts";

type Json = Record<string, unknown>;

let workos: FakeWorkos;
let github: Server;
let githubUrl = "";

before(async () => {
  github = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/user/4242") {
      response.end(JSON.stringify({ login: "Octo-Cat", id: 4242 }));
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise<void>((resolve) => github.listen(0, "127.0.0.1", resolve));
  githubUrl = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;
  workos = await startFakeWorkos();
  workos.users.set("user_new", {
    id: "user_new",
    email: "new@example.org",
    firstName: "New",
    githubId: "4242",
    emailVerified: false,
  });
  workos.users.set("user_plain", {
    id: "user_plain",
    email: "plain@example.org",
    firstName: "Plain",
    githubId: "not-numeric",
  });
  workos.users.set("user_org", {
    id: "user_org",
    email: "org@example.org",
    firstName: "Org",
    githubId: "not-numeric",
    organizations: [
      { id: "org_first", name: "First" },
      { id: "org_second", name: "Second" },
    ],
  });
  workos.users.set("user_ege", {
    id: "user_ege",
    email: "ege@example.com",
    firstName: "Ege",
    githubId: "not-numeric",
  });
});

after(async () => {
  await workos.close();
  await new Promise<void>((resolve) => github.close(() => resolve()));
});

async function realApp() {
  const db = await memoryDb();
  const auth = workosAuth({
    apiKey: "sk_test_fake",
    clientId: workos.clientId,
    cookiePassword: "c".repeat(40),
    apiUrl: workos.url,
    githubApi: githubUrl,
  });
  return createApp({ db, auth, siteUrl: SITE, publicApiUrl: API });
}

async function form(url: string, values: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
}

function cookieOf(response: Response, name: string): string | undefined {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return header?.split(";")[0]?.slice(name.length + 1);
}

async function webLogin(app: Awaited<ReturnType<typeof realApp>>, userId: string) {
  workos.loginAs(userId);
  const start = await app.request("/auth/login?returnTo=/dashboard");
  const authorize = await fetch(start.headers.get("location") ?? "", { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location") ?? "");
  return app.request(`/auth/callback${callback.search}`, {
    headers: { cookie: `ade_login=${cookieOf(start, "ade_login")}` },
  });
}

describe("WorkOS flows with the real SDK", () => {
  test("a new GitHub user enters the email code, and gets the GitHub name as the handle", async () => {
    const app = await realApp();
    const callback = await webLogin(app, "user_new");
    assert.equal(callback.headers.get("location"), `${SITE}/dashboard?login=verify`);
    const pending = cookieOf(callback, "ade_pending");
    assert.ok(pending);
    const shown = (await (
      await app.request("/auth/pending", { headers: { cookie: `ade_pending=${pending}` } })
    ).json()) as Json;
    assert.equal(shown.email, "ne***@example.org");
    const verify = (code: string) =>
      app.request("/auth/verify", {
        method: "POST",
        headers: {
          cookie: `ade_pending=${pending}`,
          origin: SITE,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
    const wrong = await verify(
      workos.emailCode("new@example.org") === "000000" ? "111111" : "000000",
    );
    assert.equal(wrong.status, 400);
    const right = await verify(workos.emailCode("new@example.org") ?? "");
    assert.equal(right.status, 200);
    const session = cookieOf(right, "ade_session");
    assert.ok(session !== undefined && session.length > 100);
    const me = (await (
      await app.request("/v1/me", { headers: { cookie: `ade_session=${session}` } })
    ).json()) as Json;
    const account = me.account as Json;
    assert.equal(account.handle, "octo-cat");
    assert.equal(account.github, "Octo-Cat");
    const reused = await verify(workos.emailCode("new@example.org") ?? "");
    assert.equal(reused.status, 400);
  });

  test("a session from another WorkOS environment ends with a new login", async () => {
    const other = await startFakeWorkos({ clientId: "client_other" });
    try {
      other.users.set("user_old", {
        id: "user_old",
        email: "old@example.org",
        firstName: "Old",
        githubId: "not-numeric",
      });
      const oldApp = createApp({
        db: await memoryDb(),
        auth: workosAuth({
          apiKey: "sk_test_fake",
          clientId: other.clientId,
          cookiePassword: "c".repeat(40),
          apiUrl: other.url,
          githubApi: githubUrl,
        }),
        siteUrl: SITE,
        publicApiUrl: API,
      });
      other.loginAs("user_old");
      const start = await oldApp.request("/auth/login?returnTo=/dashboard");
      const authorize = await fetch(start.headers.get("location") ?? "", { redirect: "manual" });
      const callback = new URL(authorize.headers.get("location") ?? "");
      const done = await oldApp.request(`/auth/callback${callback.search}`, {
        headers: { cookie: `ade_login=${cookieOf(start, "ade_login")}` },
      });
      const sealed = cookieOf(done, "ade_session");
      assert.ok(sealed);
      const app = await realApp();
      const me = await app.request("/v1/me", { headers: { cookie: `ade_session=${sealed}` } });
      assert.equal(me.status, 401);
      assert.match(me.headers.getSetCookie().join("\n"), /ade_session=;/);
    } finally {
      await other.close();
    }
  });

  test("parallel requests with one expired session share one WorkOS refresh", async () => {
    const app = await realApp();
    workos.accessTtl = -10;
    const callback = await webLogin(app, "user_plain");
    workos.accessTtl = 300;
    const expired = cookieOf(callback, "ade_session");
    assert.ok(expired);
    const before = workos.refreshCount();
    const responses = await Promise.all(
      [1, 2, 3].map(() => app.request("/v1/me", { headers: { cookie: `ade_session=${expired}` } })),
    );
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200, 200],
    );
    const renewed = new Set(responses.map((response) => cookieOf(response, "ade_session")));
    assert.equal(renewed.size, 1);
    assert.notEqual([...renewed][0], expired);
    assert.equal(workos.refreshCount() - before, 1);
    const later = await app.request("/v1/me", { headers: { cookie: `ade_session=${expired}` } });
    assert.equal(later.status, 200);
    assert.equal(workos.refreshCount() - before, 1);
  });

  test("a member of two organizations logs in without a choice", async () => {
    const app = await realApp();
    const callback = await webLogin(app, "user_org");
    assert.equal(callback.headers.get("location"), `${SITE}/dashboard`);
    assert.ok(cookieOf(callback, "ade_session"));
    assert.deepEqual(workos.selectedOrganizations(), ["org_first"]);
  });

  test("the device flow gives a token that the API accepts", async () => {
    const app = await realApp();
    const config = (await (await app.request("/v1/auth/config")).json()) as Json;
    assert.equal(config.clientId, workos.clientId);
    assert.equal(config.deviceAuthorizationUrl, `${workos.url}/user_management/authorize/device`);
    const device = (await (
      await form(String(config.deviceAuthorizationUrl), { client_id: workos.clientId })
    ).json()) as Json;
    const poll = () =>
      form(String(config.tokenUrl), {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: String(device.device_code),
        client_id: workos.clientId,
      });
    const pending = await poll();
    assert.equal(pending.status, 400);
    assert.equal(((await pending.json()) as Json).error, "authorization_pending");
    workos.approve(String(device.user_code), "user_ege");
    const tokens = (await (await poll()).json()) as Json;
    const me = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(me.status, 200);
    assert.equal((((await me.json()) as Json).account as Json).handle, "ege");
    const refreshed = (await (
      await form(String(config.tokenUrl), {
        grant_type: "refresh_token",
        refresh_token: String(tokens.refresh_token),
        client_id: workos.clientId,
      })
    ).json()) as Json;
    const again = await app.request("/v1/me", {
      headers: { authorization: `Bearer ${refreshed.access_token}` },
    });
    assert.equal(again.status, 200);
  });

  test("the web login seals a session cookie, refreshes it, and logs out", async () => {
    const app = await realApp();
    workos.loginAs("user_ege");
    const start = await app.request("/auth/login?returnTo=/dashboard");
    const stateCookie = cookieOf(start, "ade_login");
    const authorize = await fetch(start.headers.get("location") ?? "", { redirect: "manual" });
    assert.equal(authorize.status, 302);
    const callback = new URL(authorize.headers.get("location") ?? "");
    assert.equal(callback.origin + callback.pathname, `${API}/auth/callback`);
    const done = await app.request(`/auth/callback${callback.search}`, {
      headers: { cookie: `ade_login=${stateCookie}` },
    });
    assert.equal(done.headers.get("location"), `${SITE}/dashboard`);
    const session = cookieOf(done, "ade_session");
    assert.ok(session !== undefined && session.length > 100);
    const me = await app.request("/v1/me", { headers: { cookie: `ade_session=${session}` } });
    assert.equal(me.status, 200);
    assert.equal(me.headers.getSetCookie().length, 0);

    workos.accessTtl = -10;
    workos.loginAs("user_ege");
    const start2 = await app.request("/auth/login");
    const authorize2 = await fetch(start2.headers.get("location") ?? "", { redirect: "manual" });
    const callback2 = new URL(authorize2.headers.get("location") ?? "");
    const done2 = await app.request(`/auth/callback${callback2.search}`, {
      headers: { cookie: `ade_login=${cookieOf(start2, "ade_login")}` },
    });
    const expired = cookieOf(done2, "ade_session");
    workos.accessTtl = 300;
    const refreshed = await app.request("/v1/me", {
      headers: { cookie: `ade_session=${expired}` },
    });
    assert.equal(refreshed.status, 200);
    const renewed = cookieOf(refreshed, "ade_session");
    assert.ok(renewed !== undefined && renewed !== expired);

    const logout = await app.request("/auth/logout", {
      method: "POST",
      headers: { cookie: `ade_session=${renewed}`, origin: SITE },
    });
    assert.equal(((await logout.json()) as Json).redirect, `${SITE}/`);
    assert.equal(workos.revokedSessions().length, 1);
    assert.match(workos.revokedSessions()[0] ?? "", /^session_/);
  });
});
