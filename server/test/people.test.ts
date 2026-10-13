import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Profile } from "../../src/profile/schema.ts";
import { parsePeopleQuery } from "../src/directory.ts";
import { bearer, jsonBody, SITE, sampleBundle, testApp } from "./helpers.ts";

type Json = Record<string, unknown>;
type App = Awaited<ReturnType<typeof testApp>>["app"];

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

async function share(
  app: App,
  login: string,
  keys: readonly string[],
  change: (profile: Profile) => void = () => undefined,
) {
  await app.request(
    "/v1/me/snapshots",
    bearer(login, jsonBody("POST", { bundle: await sampleBundle(change) })),
  );
  if (keys.length > 0) {
    const items = Object.fromEntries(keys.map((key) => [key, true]));
    const response = await app.request(
      "/v1/me/visibility",
      bearer(login, jsonBody("PUT", { items })),
    );
    assert.equal(response.status, 200);
  }
}

async function people(app: App, query = "", init: RequestInit = {}) {
  const response = await app.request(`/v1/people${query}`, init);
  assert.equal(response.status, 200);
  return json(response);
}

function handles(page: Json): string[] {
  return (page.people as Json[]).map((person) => String(person.handle));
}

async function vote(app: App, login: string, handle: string, value: unknown) {
  return app.request(`/v1/people/${handle}/vote`, bearer(login, jsonBody("PUT", { value })));
}

async function threePeople() {
  const context = await testApp();
  const { app, auth } = context;
  auth.addUser("user_ada", "ada", "Ada Lovelace");
  auth.addUser("user_bob", "bob", "Bob Builder");
  auth.addUser("user_cy", "cy", "Cy Young");
  await share(app, "ada", ["harnesses", "skill:review", "mcp:docs"]);
  await share(app, "bob", ["mcp:local"], (profile) => {
    profile.harnesses = ["claude", "codex"];
  });
  await share(app, "cy", []);
  return context;
}

describe("people directory", () => {
  test("only people with a public item are listed, with their public items only", async () => {
    const { app } = await threePeople();
    const page = await people(app);
    assert.deepEqual(handles(page).sort(), ["ada", "bob"]);
    assert.equal(page.total, 2);
    const ada = (page.people as Json[]).find((person) => person.handle === "ada") as Json;
    assert.deepEqual(ada.skills, ["review"]);
    assert.deepEqual(ada.mcp, ["docs"]);
    assert.deepEqual(ada.harnesses, ["pi"]);
    assert.equal(ada.itemCount, 3);
    assert.equal(ada.settingCount, 0);
    assert.equal(typeof ada.updatedAt, "string");
    const bob = (page.people as Json[]).find((person) => person.handle === "bob") as Json;
    assert.deepEqual(bob.harnesses, []);
    assert.deepEqual(bob.mcp, ["local"]);
    assert.equal(JSON.stringify(page).includes("DOCS_TOKEN"), false);
    assert.deepEqual((page.facets as Json).harnesses, [{ id: "pi", count: 1 }]);
    assert.equal((page.facets as Json).listed, 2);
  });

  test("search matches the handle, the name, the GitHub login, and the skill names", async () => {
    const { app } = await threePeople();
    assert.deepEqual(handles(await people(app, "?q=ADA")), ["ada"]);
    assert.deepEqual(handles(await people(app, "?q=builder")), ["bob"]);
    assert.deepEqual(handles(await people(app, "?q=review")), ["ada"]);
    assert.deepEqual(handles(await people(app, "?q=local")), ["bob"]);
    assert.deepEqual(handles(await people(app, "?q=ada%20review")), ["ada"]);
    assert.deepEqual(handles(await people(app, "?q=ada%20local")), []);
    assert.deepEqual(handles(await people(app, "?q=%25")), []);
    assert.deepEqual(handles(await people(app, "?q=_")), []);
  });

  test("filters and sorts narrow and order the list", async () => {
    const { app } = await threePeople();
    assert.deepEqual(handles(await people(app, "?harness=pi")), ["ada"]);
    assert.deepEqual(handles(await people(app, "?has=skills")), ["ada"]);
    assert.deepEqual(handles(await people(app, "?has=skills,mcp")), ["ada"]);
    assert.deepEqual(handles(await people(app, "?sort=name")), ["ada", "bob"]);
    assert.deepEqual(handles(await people(app, "?sort=skills")), ["ada", "bob"]);
    const unknown = await people(app, "?harness=nope&sort=nope&has=nope&page=-3");
    assert.deepEqual((unknown.query as Json).sort, "top");
    assert.equal((unknown.query as Json).page, 1);
    assert.equal(handles(unknown).length, 2);
    assert.deepEqual(handles(await people(app, "?page=2")), []);
  });

  test("hiding every item removes the person, and the update date follows real changes only", async () => {
    const { app } = await threePeople();
    const before = (await people(app, "?q=ada")).people as Json[];
    const toggle = (value: boolean) =>
      app.request(
        "/v1/me/visibility",
        bearer("ada", jsonBody("PUT", { items: { "skill:review": value } })),
      );
    await new Promise((resolve) => setTimeout(resolve, 15));
    await app.request(
      "/v1/me/visibility",
      bearer("ada", jsonBody("PUT", { items: { "skill:review": true } })),
    );
    const same = (await people(app, "?q=ada")).people as Json[];
    assert.equal(same[0]?.updatedAt, before[0]?.updatedAt);
    await toggle(false);
    const changed = (await people(app, "?q=ada")).people as Json[];
    assert.notEqual(changed[0]?.updatedAt, before[0]?.updatedAt);
    await app.request(
      "/v1/me/visibility",
      bearer("ada", jsonBody("PUT", { items: { harnesses: false, "mcp:docs": false } })),
    );
    assert.deepEqual(handles(await people(app)), ["bob"]);
  });
});

describe("votes", () => {
  test("a signed-in user votes up, down, and clears the vote, once for each person", async () => {
    const { app } = await threePeople();
    assert.equal(
      (
        await app.request(
          "/v1/people/ada/vote",
          jsonBody("PUT", { value: 1 }, { headers: { origin: SITE } }),
        )
      ).status,
      401,
    );
    const up = await vote(app, "bob", "ada", 1);
    assert.equal(up.status, 200);
    assert.deepEqual((await json(up)).votes, { score: 1, up: 1, down: 0, mine: 1 });
    assert.deepEqual((await json(await vote(app, "bob", "ada", 1))).votes, {
      score: 1,
      up: 1,
      down: 0,
      mine: 1,
    });
    assert.deepEqual((await json(await vote(app, "cy", "ada", -1))).votes, {
      score: 0,
      up: 1,
      down: 1,
      mine: -1,
    });
    assert.deepEqual((await json(await vote(app, "bob", "ada", -1))).votes, {
      score: -2,
      up: 0,
      down: 2,
      mine: -1,
    });
    assert.deepEqual((await json(await vote(app, "bob", "ada", 0))).votes, {
      score: -1,
      up: 0,
      down: 1,
      mine: 0,
    });
  });

  test("own votes, unlisted people, and bad values fail", async () => {
    const { app } = await threePeople();
    const own = await vote(app, "ada", "ada", 1);
    assert.equal(own.status, 400);
    assert.equal(((await json(own)).error as Json).code, "own-page");
    assert.equal((await vote(app, "ada", "cy", 1)).status, 404);
    assert.equal((await vote(app, "ada", "nobody", 1)).status, 404);
    assert.equal((await vote(app, "ada", "bob", 2)).status, 400);
    assert.equal((await vote(app, "ada", "bob", "1")).status, 400);
  });

  test("the list shows the votes of the viewer, and top sorts by score", async () => {
    const { app, auth } = await threePeople();
    await vote(app, "ada", "bob", 1);
    await vote(app, "cy", "bob", 1);
    await vote(app, "cy", "ada", -1);
    const anonymous = await people(app);
    assert.deepEqual(handles(anonymous), ["bob", "ada"]);
    assert.equal(anonymous.viewer, null);
    const bob = (anonymous.people as Json[])[0] as Json;
    assert.deepEqual(bob.votes, { score: 2, up: 2, down: 0, mine: 0 });
    auth.sessions.set("sealed-cy", "user_cy");
    const signed = await people(app, "", { headers: { cookie: "ade_session=sealed-cy" } });
    assert.equal(signed.viewer, "cy");
    const mine = Object.fromEntries(
      (signed.people as Json[]).map((person) => [person.handle, (person.votes as Json).mine]),
    );
    assert.deepEqual(mine, { bob: 1, ada: -1 });
    const single = await json(
      await app.request("/v1/people/bob", { headers: { cookie: "ade_session=sealed-cy" } }),
    );
    assert.equal(((single.person as Json).votes as Json).mine, 1);
    assert.equal((await app.request("/v1/people/cy")).status, 404);
  });

  test("an account deletion removes its listing and its votes", async () => {
    const { app } = await threePeople();
    await vote(app, "ada", "bob", 1);
    await app.request("/v1/me", bearer("ada", { method: "DELETE" }));
    const page = await people(app);
    assert.deepEqual(handles(page), ["bob"]);
    assert.deepEqual(((page.people as Json[])[0] as Json).votes, {
      score: 0,
      up: 0,
      down: 0,
      mine: 0,
    });
  });

  test("the query parser keeps only known values", () => {
    assert.deepEqual(
      parsePeopleQuery({ q: "  a b ", harness: "CLAUDE", has: "mcp,x", sort: "recent", page: "3" }),
      {
        q: "a b",
        harness: "claude",
        has: ["mcp"],
        sort: "recent",
        page: 3,
      },
    );
  });
});
