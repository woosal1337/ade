export type DraftState = "public" | "hidden" | "changed";

export interface DraftVotes {
  readonly score: number;
  readonly up: number;
  readonly down: number;
  readonly mine: -1 | 0 | 1;
}

export interface DraftPerson {
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
  readonly votes: DraftVotes;
}

export interface DraftItem {
  readonly key: string;
  readonly kind: string;
  readonly group: string;
  readonly label: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly state?: DraftState;
}

export type Overrides = Readonly<Record<string, boolean>>;

const SHOWN_SKILLS = 8;
const SHOWN_MCP = 6;
const SHOWN_PLUGINS = 4;

function savedPublic(item: DraftItem): boolean {
  return item.state === "public";
}

export function normalizeOverrides(items: readonly DraftItem[], overrides: Overrides): Overrides {
  const result: Record<string, boolean> = {};
  for (const item of items) {
    const wanted = overrides[item.key];
    if (wanted !== undefined && wanted !== savedPublic(item)) {
      result[item.key] = wanted;
    }
  }
  return result;
}

export function setOverrides(
  items: readonly DraftItem[],
  overrides: Overrides,
  keys: readonly string[],
  visible: boolean,
): Overrides {
  const next: Record<string, boolean> = { ...overrides };
  for (const key of keys) {
    next[key] = visible;
  }
  return normalizeOverrides(items, next);
}

export function applyDraft<T extends DraftItem>(items: readonly T[], overrides: Overrides): T[] {
  return items.map((item) => {
    const wanted = overrides[item.key];
    if (wanted === undefined) {
      return item;
    }
    return { ...item, state: wanted ? "public" : "hidden" };
  });
}

export function publicView<T extends DraftItem>(items: readonly T[]): T[] {
  return items
    .filter((item) => item.state === "public")
    .map((item) => {
      const { state: _state, ...rest } = item;
      const detail = item.kind === "secret" ? { name: item.detail.name } : item.detail;
      return { ...rest, detail } as T;
    });
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export interface PersonBase {
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly github: string | null;
}

const NO_VOTES: DraftVotes = { score: 0, up: 0, down: 0, mine: 0 };

export function previewPerson(
  base: PersonBase,
  items: readonly DraftItem[],
  updatedAt: string,
  votes: DraftVotes = NO_VOTES,
): DraftPerson | undefined {
  const shown = publicView(items);
  if (shown.length === 0) {
    return undefined;
  }
  const labels = (kind: string) =>
    sortedUnique(shown.filter((item) => item.kind === kind).map((item) => item.label));
  const listed = shown.find((item) => item.kind === "harnesses")?.detail.harnesses;
  const harnesses = sortedUnique(
    Array.isArray(listed) ? listed.filter((id): id is string => typeof id === "string") : [],
  );
  const skills = labels("skill");
  const mcp = labels("mcp");
  const plugins = labels("plugin");
  return {
    ...base,
    updatedAt,
    harnesses,
    skills: skills.slice(0, SHOWN_SKILLS),
    skillCount: skills.length,
    mcp: mcp.slice(0, SHOWN_MCP),
    mcpCount: mcp.length,
    plugins: plugins.slice(0, SHOWN_PLUGINS),
    pluginCount: plugins.length,
    settingCount: shown.filter((item) => item.kind === "setting").length,
    itemCount: shown.length,
    votes,
  };
}

export const DRAFT_PREFIX = "ade.draft.v1:";

export function draftStorageKey(handle: string, digest: string): string {
  return `${DRAFT_PREFIX}${handle}:${digest}`;
}

export function parseStoredDraft(text: string | null): Overrides {
  if (text === null) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}
