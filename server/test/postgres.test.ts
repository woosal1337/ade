import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import postgres from "postgres";
import { postgresDb } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import {
  approvals,
  ensureUser,
  insertSnapshot,
  latestSnapshot,
  setApprovals,
} from "../src/store.ts";
import { sampleBundle } from "./helpers.ts";

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
      assert.equal(await migrate(db), 2);
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
    } finally {
      await db.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    }
  });
});
