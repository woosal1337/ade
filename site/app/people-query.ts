export type VoteValue = -1 | 0 | 1;

export interface VoteTally {
  readonly score: number;
  readonly up: number;
  readonly down: number;
  readonly mine: VoteValue;
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

export const PEOPLE_SORTS = ["top", "recent", "skills", "name"] as const;
export const PEOPLE_HAS = ["skills", "mcp", "plugins"] as const;
export type PeopleSort = (typeof PEOPLE_SORTS)[number];
export type PeopleHas = (typeof PEOPLE_HAS)[number];

export interface PeopleQuery {
  readonly q: string;
  readonly harness: string | undefined;
  readonly has: readonly PeopleHas[];
  readonly sort: PeopleSort;
  readonly page: number;
}

export interface PeoplePage {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly people: readonly Person[];
  readonly query: PeopleQuery;
  readonly facets: {
    readonly harnesses: readonly { readonly id: string; readonly count: number }[];
    readonly listed: number;
  };
  readonly viewer: string | null;
}

export function peopleSearch(query: PeopleQuery): string {
  const params = new URLSearchParams();
  if (query.q !== "") {
    params.set("q", query.q);
  }
  if (query.harness !== undefined) {
    params.set("harness", query.harness);
  }
  if (query.has.length > 0) {
    params.set("has", query.has.join(","));
  }
  if (query.sort !== "top") {
    params.set("sort", query.sort);
  }
  if (query.page > 1) {
    params.set("page", String(query.page));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
