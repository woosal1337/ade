import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.ts";
import { workosAuth } from "../src/auth.ts";
import { type FakeWorkos, startFakeWorkos } from "./fake-workos.ts";
import { API, memoryDb, SITE } from "./helpers.ts";

type Json = Record<string, unknown>;

let workos: FakeWorkos;

before(async () => {
  workos = await startFakeWorkos();
  workos.users.set("user_ege", {
    id: "user_ege",
    email: "ege@example.com",
    firstName: "Ege",
    githubId: "not-numeric",
  });
});

after(async () => {
  await workos.close();
});

async function realApp() {
  const db = await memoryDb();
  const auth = workosAuth({
    apiKey: "sk_test_fake",
    clientId: workos.clientId,
    cookiePassword: "c".repeat(40),
    apiUrl: workos.url,
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

describe("WorkOS flows with the real SDK", () => {
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
    const redirect = String(((await logout.json()) as Json).redirect);
    const ended = await fetch(redirect, { redirect: "manual" });
    assert.equal(ended.headers.get("location"), `${SITE}/`);
    assert.equal(workos.revokedSessions().length, 1);
  });
});
