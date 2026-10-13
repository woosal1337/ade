import { createHash } from "node:crypto";
import { HARNESS_IDS } from "../../src/profile/schema.ts";
import type { Db } from "./db.ts";
import { approvals, latestSnapshotMeta, snapshotBundle } from "./store.ts";
import { type PublicItem, publicItems, snapshotView } from "./views.ts";

export const DIRECTORY_VERSION = 1;
export const PEOPLE_PAGE_SIZE = 24;
export const PEOPLE_SORTS = ["top", "recent", "skills", "name"] as const;
export const PEOPLE_HAS = ["skills", "mcp", "plugins"] as const;

export type PeopleSort = (typeof PEOPLE_SORTS)[number];
export type PeopleHas = (typeof PEOPLE_HAS)[number];
export type VoteValue = -1 | 0 | 1;

const SEARCH_TERMS = 5;
const TERM_LENGTH = 60;
const SHOWN_SKILLS = 8;
const SHOWN_MCP = 6;
const SHOWN_PLUGINS = 4;

export interface DirectorySummary {
  readonly harnesses: readonly string[];
  readonly skills: readonly string[];
  readonly mcp: readonly string[];
  readonly plugins: readonly string[];
  readonly settingCount: number;
  readonly itemCount: number;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function summarize(items: readonly PublicItem[]): DirectorySummary {
  const labels = (kind: PublicItem["kind"]) =>
    sortedUnique(items.filter((item) => item.kind === kind).map((item) => item.label));
  const harnessItem = items.find((item) => item.kind === "harnesses");
  const listed = harnessItem?.detail.harnesses;
  return {
    harnesses: sortedUnique(
      Array.isArray(listed) ? listed.filter((id): id is string => typeof id === "string") : [],
    ),
    skills: labels("skill"),
    mcp: labels("mcp"),
    plugins: labels("plugin"),
    settingCount: items.filter((item) => item.kind === "setting").length,
    itemCount: items.length,
  };
}

export async function refreshDirectory(db: Db, userId: string, at: Date): Promise<void> {
  const snapshot = await latestSnapshotMeta(db, userId);
  if (snapshot === undefined) {
    await db.query("delete from directory where user_id = $1", [userId]);
    return;
  }
  const view = await snapshotView(snapshot.id, Number(snapshot.size_bytes), () =>
    snapshotBundle(db, snapshot.id),
  );
  const items = publicItems(view.items, await approvals(db, userId));
  const summary = summarize(items);
  const hash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
  const search = [...summary.skills, ...summary.mcp, ...summary.plugins, ...summary.harnesses]
    .join(" ")
    .toLowerCase();
  await db.query(
    `insert into directory (user_id, version, summary_hash, harnesses, skills, mcp, plugins,
       skill_count, mcp_count, plugin_count, setting_count, item_count, search_text, updated_at)
     values ($1, $2, $3, $4::text[], $5::text[], $6::text[], $7::text[], $8, $9, $10, $11, $12, $13, $14)
     on conflict (user_id) do update set
       version = excluded.version,
       harnesses = excluded.harnesses,
       skills = excluded.skills,
       mcp = excluded.mcp,
       plugins = excluded.plugins,
       skill_count = excluded.skill_count,
       mcp_count = excluded.mcp_count,
       plugin_count = excluded.plugin_count,
       setting_count = excluded.setting_count,
       item_count = excluded.item_count,
       search_text = excluded.search_text,
       updated_at = case when directory.summary_hash = excluded.summary_hash
         then directory.updated_at else excluded.updated_at end,
       summary_hash = excluded.summary_hash`,
    [
      userId,
      DIRECTORY_VERSION,
      hash,
      [...summary.harnesses],
      [...summary.skills],
      [...summary.mcp],
      [...summary.plugins],
      summary.skills.length,
      summary.mcp.length,
      summary.plugins.length,
      summary.settingCount,
      summary.itemCount,
      search,
      at.toISOString(),
    ],
  );
}

export async function rebuildDirectory(db: Db): Promise<number> {
  const rows = await db.query<{ id: string; at: Date | string }>(
    `select u.id,
       greatest(
         (select max(s.created_at) from snapshots s where s.user_id = u.id),
         coalesce((select max(v.updated_at) from visibility v where v.user_id = u.id), 'epoch')
       ) as at
     from users u
     where exists (select 1 from snapshots s where s.user_id = u.id)
       and not exists (
         select 1 from directory d where d.user_id = u.id and d.version >= $1
       )`,
    [DIRECTORY_VERSION],
  );
  for (const row of rows) {
    await refreshDirectory(db, row.id, new Date(row.at));
  }
  return rows.length;
}

export interface PeopleQuery {
  readonly q: string;
  readonly harness: string | undefined;
  readonly has: readonly PeopleHas[];
  readonly sort: PeopleSort;
  readonly page: number;
}

function first(value: string | undefined): string {
  return (value ?? "").trim();
}

export function parsePeopleQuery(
  params: Readonly<Record<string, string | undefined>>,
): PeopleQuery {
  const harness = first(params.harness).toLowerCase();
  const sort = first(params.sort).toLowerCase();
  const page = Number.parseInt(first(params.page), 10);
  return {
    q: first(params.q).slice(0, SEARCH_TERMS * (TERM_LENGTH + 1)),
    harness: (HARNESS_IDS as readonly string[]).includes(harness) ? harness : undefined,
    has: PEOPLE_HAS.filter((value) =>
      first(params.has)
        .toLowerCase()
        .split(",")
        .map((part) => part.trim())
        .includes(value),
    ),
    sort: (PEOPLE_SORTS as readonly string[]).includes(sort) ? (sort as PeopleSort) : "top",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
  };
}

function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

const ORDER: Record<PeopleSort, string> = {
  top: "score desc, d.updated_at desc, u.handle",
  recent: "d.updated_at desc, u.handle",
  skills: "d.skill_count desc, d.updated_at desc, u.handle",
  name: "u.handle",
};

interface PersonRow {
  readonly handle: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly github_login: string | null;
  readonly harnesses: string[];
  readonly skills: string[];
  readonly mcp: string[];
  readonly plugins: string[];
  readonly skill_count: number;
  readonly mcp_count: number;
  readonly plugin_count: number;
  readonly setting_count: number;
  readonly item_count: number;
  readonly updated_at: Date | string;
  readonly score: number;
  readonly up: number;
  readonly down: number;
  readonly my_vote: number | null;
  readonly total: number;
}

export interface Person {
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly github: string | null;
  readonly updatedAt: string;
  readonly harnesses: readonly string[];
  readonly skills: readonly string[];
  readonly skillCount: number;
  readonly mcp: readonly string[];
  readonly mcpCount: number;
  readonly plugins: readonly string[];
  readonly pluginCount: number;
  readonly settingCount: number;
  readonly itemCount: number;
  readonly votes: VoteTally;
}

export interface VoteTally {
  readonly score: number;
  readonly up: number;
  readonly down: number;
  readonly mine: VoteValue;
}

function voteValue(value: number | null | undefined): VoteValue {
  return value === 1 ? 1 : value === -1 ? -1 : 0;
}

function toPerson(row: PersonRow): Person {
  return {
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    github: row.github_login,
    updatedAt: new Date(row.updated_at).toISOString(),
    harnesses: row.harnesses,
    skills: row.skills.slice(0, SHOWN_SKILLS),
    skillCount: Number(row.skill_count),
    mcp: row.mcp.slice(0, SHOWN_MCP),
    mcpCount: Number(row.mcp_count),
    plugins: row.plugins.slice(0, SHOWN_PLUGINS),
    pluginCount: Number(row.plugin_count),
    settingCount: Number(row.setting_count),
    itemCount: Number(row.item_count),
    votes: {
      score: Number(row.score),
      up: Number(row.up),
      down: Number(row.down),
      mine: voteValue(row.my_vote === null ? null : Number(row.my_vote)),
    },
  };
}

const PERSON_COLUMNS = `u.handle, u.display_name, u.avatar_url, u.github_login,
  d.harnesses, d.skills, d.mcp, d.plugins, d.skill_count, d.mcp_count, d.plugin_count,
  d.setting_count, d.item_count, d.updated_at,
  coalesce(t.score, 0) as score, coalesce(t.up, 0) as up, coalesce(t.down, 0) as down,
  mine.value as my_vote`;

const PERSON_JOINS = `from directory d
  join users u on u.id = d.user_id
  left join (
    select target_id, sum(value)::int as score,
      count(*) filter (where value = 1)::int as up,
      count(*) filter (where value = -1)::int as down
    from votes group by target_id
  ) t on t.target_id = d.user_id
  left join votes mine on mine.target_id = d.user_id and mine.voter_id = $1`;

export interface PeoplePage {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly people: readonly Person[];
}

export async function listPeople(
  db: Db,
  query: PeopleQuery,
  viewerId: string | undefined,
): Promise<PeoplePage> {
  const params: unknown[] = [viewerId ?? ""];
  const where: string[] = ["d.item_count > 0"];
  const terms = query.q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SEARCH_TERMS)
    .map((term) => term.slice(0, TERM_LENGTH));
  for (const term of terms) {
    params.push(likeTerm(term));
    const n = params.length;
    where.push(
      `(u.handle ilike $${n} escape '\\' or u.display_name ilike $${n} escape '\\'
        or coalesce(u.github_login, '') ilike $${n} escape '\\' or d.search_text ilike $${n} escape '\\')`,
    );
  }
  if (query.harness !== undefined) {
    params.push([query.harness]);
    where.push(`d.harnesses @> $${params.length}::text[]`);
  }
  const counts: Record<PeopleHas, string> = {
    skills: "d.skill_count > 0",
    mcp: "d.mcp_count > 0",
    plugins: "d.plugin_count > 0",
  };
  for (const value of query.has) {
    where.push(counts[value]);
  }
  params.push(PEOPLE_PAGE_SIZE, (query.page - 1) * PEOPLE_PAGE_SIZE);
  const rows = await db.query<PersonRow>(
    `select ${PERSON_COLUMNS}, count(*) over () as total
     ${PERSON_JOINS}
     where ${where.join(" and ")}
     order by ${ORDER[query.sort]}
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return {
    total: rows.length === 0 ? 0 : Number(rows[0]?.total ?? 0),
    page: query.page,
    pageSize: PEOPLE_PAGE_SIZE,
    people: rows.map(toPerson),
  };
}

export async function harnessFacets(db: Db): Promise<{ id: string; count: number }[]> {
  const rows = await db.query<{ id: string; count: number }>(
    `select h as id, count(*)::int as count
     from directory, unnest(harnesses) as h
     where item_count > 0
     group by h order by count desc, h`,
  );
  return rows.map((row) => ({ id: row.id, count: Number(row.count) }));
}

export async function listedCount(db: Db): Promise<number> {
  const [row] = await db.query<{ count: number }>(
    "select count(*)::int as count from directory where item_count > 0",
  );
  return Number(row?.count ?? 0);
}

export async function personByUser(
  db: Db,
  userId: string,
  viewerId: string | undefined,
): Promise<Person | undefined> {
  const [row] = await db.query<PersonRow>(
    `select ${PERSON_COLUMNS}, 1 as total ${PERSON_JOINS} where d.user_id = $2 and d.item_count > 0`,
    [viewerId ?? "", userId],
  );
  return row === undefined ? undefined : toPerson(row);
}

export async function setVote(
  db: Db,
  voterId: string,
  targetId: string,
  value: VoteValue,
): Promise<void> {
  if (value === 0) {
    await db.query("delete from votes where voter_id = $1 and target_id = $2", [voterId, targetId]);
    return;
  }
  await db.query(
    `insert into votes (voter_id, target_id, value) values ($1, $2, $3)
     on conflict (voter_id, target_id) do update set value = excluded.value, updated_at = now()`,
    [voterId, targetId, value],
  );
}
