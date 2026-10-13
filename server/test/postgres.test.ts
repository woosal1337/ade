import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import postgres from "postgres";
import { createApp } from "../src/app.ts";
import { postgresDb } from "../src/db.ts";
import { rebuildDirectory } from "../src/directory.ts";
import { migrate } from "../src/migrate.ts";
import {
  approvals,
  ensureUser,
  insertSnapshot,
  latestSnapshot,
  setApprovals,
} from "../src/store.ts";
import { API, bearer, FakeAuth, jsonBody, SITE, sampleBundle } from "./helpers.ts";

const url = process.env.ADE_TEST_DATABASE_URL;

describe("store on a real Postgres server", {
  skip: url === undefined ? "Set ADE_TEST_DATABASE_URL to run this suite." : false,
}, () => {
  test("a snapshot bundle is a JSON object, and approvals follow the item keys", async () => {
    const name = `ade_test_${randomBytes(6).toString("hex")}`;
    const admin = postgres(url ?? "", { max: 1, onnotice: () => undefined });
    await admin.unsafe(`create database ${name}`);
    const target = new URL(url ?? "");
    target.pathname = `/${name}`;
    const db = postgresDb(target.toString());
    try {
      assert.equal(await migrate(db), 4);
      assert.equal(await migrate(db), 0);
      const user = await ensureUser(db, {
        workosUserId: "user_pg",
        displayName: "Postgres",
        avatarUrl: null,
        handleHints: ["pg-user"],
      });
      const bundle = await sampleBundle();
      await insertSnapshot(db, {
        userId: user.id,
        digest: "d1",
        bundle,
        itemCount: 8,
        sizeBytes: 100,
        clientVersion: "0.1.0",
        keys: ["mcp:docs", "skill:review"],
      });
      const [stored] = await db.query<{ type: string }>(
        "select jsonb_typeof(bundle) as type from snapshots where user_id = $1",
        [user.id],
      );
      assert.equal(stored?.type, "object");
      const latest = await latestSnapshot(db, user.id);
      assert.deepEqual(latest?.bundle, bundle);
      await setApprovals(db, user.id, [
        { key: "mcp:docs", hash: "h1" },
        { key: "skill:review", hash: "h2" },
      ]);
      await insertSnapshot(db, {
        userId: user.id,
        digest: "d2",
        bundle,
        itemCount: 1,
        sizeBytes: 100,
        clientVersion: null,
        keys: ["mcp:docs"],
      });
      assert.deepEqual([...(await approvals(db, user.id)).keys()], ["mcp:docs"]);

      const auth = new FakeAuth();
      auth.addUser("user_ada", "ada");
      auth.addUser("user_bob", "bob");
      const app = createApp({ db, auth, siteUrl: SITE, publicApiUrl: API });
      for (const login of ["ada", "bob"]) {
        await app.request(
          "/v1/me/snapshots",
          bearer(login, jsonBody("POST", { bundle: await sampleBundle() })),
        );
      }
      await app.request(
        "/v1/me/visibility",
        bearer("ada", jsonBody("PUT", { items: { harnesses: true, "skill:review": true } })),
      );
      const listed = async (query: string) => {
        const response = await app.request(`/v1/people${query}`);
        assert.equal(response.status, 200);
        const body = (await response.json()) as { people: { handle: string }[] };
        return body.people.map((person) => person.handle);
      };
      assert.deepEqual(await listed("?harness=pi&has=skills&q=review"), ["ada"]);
      const voted = await app.request(
        "/v1/people/ada/vote",
        bearer("bob", jsonBody("PUT", { value: 1 })),
      );
      assert.equal(voted.status, 200);
      await db.query("delete from directory");
      assert.deepEqual(await listed(""), []);
      assert.equal(await rebuildDirectory(db), 3);
      assert.deepEqual(await listed(""), ["ada"]);
      assert.equal(await rebuildDirectory(db), 0);
    } finally {
      await db.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    }
  });
});
