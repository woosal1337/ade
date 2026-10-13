import type { Db } from "./db.ts";

const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `create table users (
      id text primary key,
      workos_user_id text not null unique,
      handle text not null unique,
      display_name text not null default '',
      avatar_url text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create table snapshots (
      id text primary key,
      user_id text not null references users (id) on delete cascade,
      digest text not null,
      bundle jsonb not null,
      item_count integer not null,
      size_bytes integer not null,
      client_version text,
      created_at timestamptz not null default now()
    )`,
    `create index snapshots_user_created on snapshots (user_id, created_at desc)`,
    `create table visibility (
      user_id text not null references users (id) on delete cascade,
      item_key text not null,
      approved_hash text not null,
      updated_at timestamptz not null default now(),
      primary key (user_id, item_key)
    )`,
  ],
  [`alter table users add column github_login text`],
  [`alter table users add column github_id text`],
  [
    `create table directory (
      user_id text primary key references users (id) on delete cascade,
      version integer not null,
      summary_hash text not null,
      harnesses text[] not null default '{}',
      skills text[] not null default '{}',
      mcp text[] not null default '{}',
      plugins text[] not null default '{}',
      skill_count integer not null default 0,
      mcp_count integer not null default 0,
      plugin_count integer not null default 0,
      setting_count integer not null default 0,
      item_count integer not null default 0,
      search_text text not null default '',
      updated_at timestamptz not null
    )`,
    `create index directory_updated on directory (updated_at desc)`,
    `create table votes (
      voter_id text not null references users (id) on delete cascade,
      target_id text not null references users (id) on delete cascade,
      value smallint not null check (value in (-1, 1)),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (voter_id, target_id),
      check (voter_id <> target_id)
    )`,
    `create index votes_target on votes (target_id)`,
  ],
];

const LOCK_ID = 424_700_1;

export async function migrate(db: Db): Promise<number> {
  await db.query(
    `create table if not exists schema_migrations (
      version integer primary key,
      applied_at timestamptz not null default now()
    )`,
  );
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [LOCK_ID]);
    const rows = await tx.query<{ version: number }>("select version from schema_migrations");
    const done = new Set(rows.map((row) => Number(row.version)));
    let applied = 0;
    for (const [index, statements] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (done.has(version)) {
        continue;
      }
      for (const statement of statements) {
        await tx.query(statement);
      }
      await tx.query("insert into schema_migrations (version) values ($1)", [version]);
      applied += 1;
    }
    return applied;
  });
}
