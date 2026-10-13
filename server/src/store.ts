import { randomUUID } from "node:crypto";
import { handleCandidates, isHandle } from "../../src/account/handles.ts";
import type { Db } from "./db.ts";

export interface UserRow {
  readonly id: string;
  readonly workos_user_id: string;
  readonly handle: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly github_login: string | null;
  readonly github_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface SnapshotMeta {
  readonly id: string;
  readonly digest: string;
  readonly size_bytes: number;
  readonly created_at: Date;
}

export interface SnapshotRow {
  readonly id: string;
  readonly user_id: string;
  readonly digest: string;
  readonly bundle: unknown;
  readonly item_count: number;
  readonly size_bytes: number;
  readonly client_version: string | null;
  readonly created_at: Date;
}

export interface NewUser {
  readonly workosUserId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly githubLogin?: string | undefined;
  readonly githubId?: string | undefined;
  readonly handleHints: readonly (string | undefined)[];
}

const KEEP_SNAPSHOTS = 5;

export class HandleTakenError extends Error {}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  const code = record.code;
  const name = record.constraint_name ?? record.constraint;
  return code === "23505" && (typeof name !== "string" || name.includes(constraint));
}

export async function userByWorkos(db: Db, workosUserId: string): Promise<UserRow | undefined> {
  const [row] = await db.query<UserRow>("select * from users where workos_user_id = $1", [
    workosUserId,
  ]);
  return row;
}

export async function userByHandle(db: Db, handle: string): Promise<UserRow | undefined> {
  const [row] = await db.query<UserRow>("select * from users where handle = $1", [handle]);
  return row;
}

async function handleFree(db: Db, handle: string): Promise<boolean> {
  return (await userByHandle(db, handle)) === undefined;
}

async function pickHandle(db: Db, hints: readonly (string | undefined)[]): Promise<string> {
  const candidates = handleCandidates(hints);
  for (const candidate of candidates) {
    if (await handleFree(db, candidate)) {
      return candidate;
    }
  }
  const base = candidates[0] ?? "user";
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base.slice(0, 35)}-${index}`;
    if (isHandle(candidate) && (await handleFree(db, candidate))) {
      return candidate;
    }
  }
  return `user-${randomUUID().slice(0, 8)}`;
}

export async function ensureUser(db: Db, user: NewUser): Promise<UserRow> {
  const existing = await userByWorkos(db, user.workosUserId);
  if (existing !== undefined) {
    return existing;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const handle = await pickHandle(db, user.handleHints);
    try {
      const [row] = await db.query<UserRow>(
        `insert into users (id, workos_user_id, handle, display_name, avatar_url, github_login, github_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (workos_user_id) do update set updated_at = users.updated_at
         returning *`,
        [
          randomUUID(),
          user.workosUserId,
          handle,
          user.displayName,
          user.avatarUrl,
          user.githubLogin ?? null,
          user.githubId ?? null,
        ],
      );
      if (row !== undefined) {
        return row;
      }
    } catch (error) {
      if (!isUniqueViolation(error, "handle")) {
        throw error;
      }
    }
  }
  throw new Error("No free handle was found for the new account.");
}

export async function usersByGithubLogin(db: Db, login: string): Promise<UserRow[]> {
  return db.query<UserRow>("select * from users where lower(github_login) = lower($1)", [login]);
}

export async function moveUser(
  db: Db,
  userId: string,
  workosUserId: string,
  githubId: string | undefined,
): Promise<UserRow | undefined> {
  const [row] = await db.query<UserRow>(
    `update users set workos_user_id = $2, github_id = coalesce($3, github_id), updated_at = now()
     where id = $1 returning *`,
    [userId, workosUserId, githubId ?? null],
  );
  return row;
}

export async function renameUser(db: Db, userId: string, handle: string): Promise<UserRow> {
  try {
    const [row] = await db.query<UserRow>(
      "update users set handle = $2, updated_at = now() where id = $1 returning *",
      [userId, handle],
    );
    if (row === undefined) {
      throw new Error("The account does not exist.");
    }
    return row;
  } catch (error) {
    if (isUniqueViolation(error, "handle")) {
      throw new HandleTakenError(handle);
    }
    throw error;
  }
}

export async function updateProfile(
  db: Db,
  userId: string,
  displayName: string,
): Promise<UserRow | undefined> {
  const [row] = await db.query<UserRow>(
    "update users set display_name = $2, updated_at = now() where id = $1 returning *",
    [userId, displayName],
  );
  return row;
}

export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.query("delete from users where id = $1", [userId]);
}

function withBundle(row: SnapshotRow): SnapshotRow {
  return typeof row.bundle === "string" ? { ...row, bundle: JSON.parse(row.bundle) } : row;
}

export async function latestSnapshotMeta(
  db: Db,
  userId: string,
): Promise<SnapshotMeta | undefined> {
  const [row] = await db.query<SnapshotMeta>(
    `select id, digest, size_bytes, created_at from snapshots
     where user_id = $1 order by created_at desc, id desc limit 1`,
    [userId],
  );
  return row;
}

export async function snapshotBundle(db: Db, id: string): Promise<unknown> {
  const [row] = await db.query<{ bundle: unknown }>("select bundle from snapshots where id = $1", [
    id,
  ]);
  if (row === undefined) {
    throw new Error("The snapshot does not exist.");
  }
  return typeof row.bundle === "string" ? JSON.parse(row.bundle) : row.bundle;
}

export async function latestSnapshot(db: Db, userId: string): Promise<SnapshotRow | undefined> {
  const [row] = await db.query<SnapshotRow>(
    "select * from snapshots where user_id = $1 order by created_at desc, id desc limit 1",
    [userId],
  );
  return row === undefined ? undefined : withBundle(row);
}

export interface NewSnapshot {
  readonly userId: string;
  readonly digest: string;
  readonly bundle: unknown;
  readonly itemCount: number;
  readonly sizeBytes: number;
  readonly clientVersion: string | null;
  readonly keys: readonly string[];
}

export async function insertSnapshot(db: Db, snapshot: NewSnapshot): Promise<SnapshotRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx.query<SnapshotRow>(
      `insert into snapshots (id, user_id, digest, bundle, item_count, size_bytes, client_version)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7)
       returning *`,
      [
        randomUUID(),
        snapshot.userId,
        snapshot.digest,
        snapshot.bundle,
        snapshot.itemCount,
        snapshot.sizeBytes,
        snapshot.clientVersion,
      ],
    );
    await tx.query(
      `delete from snapshots where user_id = $1 and id not in (
         select id from snapshots where user_id = $1 order by created_at desc, id desc limit $2
       )`,
      [snapshot.userId, KEEP_SNAPSHOTS],
    );
    await tx.query(
      "delete from visibility where user_id = $1 and not (item_key = any($2::text[]))",
      [snapshot.userId, [...snapshot.keys]],
    );
    if (row === undefined) {
      throw new Error("The snapshot was not saved.");
    }
    return withBundle(row);
  });
}

export interface Approval {
  readonly key: string;
  readonly hash: string | null;
}

export async function approvals(db: Db, userId: string): Promise<Map<string, string>> {
  const rows = await db.query<{ item_key: string; approved_hash: string }>(
    "select item_key, approved_hash from visibility where user_id = $1",
    [userId],
  );
  return new Map(rows.map((row) => [row.item_key, row.approved_hash]));
}

export async function setApprovals(
  db: Db,
  userId: string,
  changes: readonly Approval[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const change of changes) {
      if (change.hash === null) {
        await tx.query("delete from visibility where user_id = $1 and item_key = $2", [
          userId,
          change.key,
        ]);
      } else {
        await tx.query(
          `insert into visibility (user_id, item_key, approved_hash) values ($1, $2, $3)
           on conflict (user_id, item_key)
           do update set approved_hash = excluded.approved_hash, updated_at = now()`,
          [userId, change.key, change.hash],
        );
      }
    }
  });
}
