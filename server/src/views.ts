import {
  type MemoryProfile,
  type ProfileItem,
  profileItems,
  publicProfile,
  readBundle,
} from "../../src/profile/catalog.ts";
import { writeMarkdown } from "../../src/profile/markdown.ts";

export type ItemState = "public" | "hidden" | "changed";

export interface OwnerItem {
  readonly key: string;
  readonly kind: ProfileItem["kind"];
  readonly group: string;
  readonly label: string;
  readonly detail: ProfileItem["detail"];
  readonly state: ItemState;
}

export interface PublicItem {
  readonly key: string;
  readonly kind: ProfileItem["kind"];
  readonly group: string;
  readonly label: string;
  readonly detail: ProfileItem["detail"];
}

export interface SnapshotView {
  readonly memory: MemoryProfile;
  readonly items: readonly ProfileItem[];
}

const CACHE_ENTRIES = 32;
const CACHE_ENTRY_BYTES = 2 * 1024 * 1024;
const cache = new Map<string, SnapshotView>();

export async function snapshotView(
  id: string,
  sizeBytes: number,
  load: () => Promise<unknown>,
): Promise<SnapshotView> {
  const cached = cache.get(id);
  if (cached !== undefined) {
    cache.delete(id);
    cache.set(id, cached);
    return cached;
  }
  const memory = readBundle(await load());
  const view = { memory, items: profileItems(memory) };
  if (sizeBytes <= CACHE_ENTRY_BYTES) {
    cache.set(id, view);
    if (cache.size > CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
  }
  return view;
}

export function stateOf(item: ProfileItem, approvals: ReadonlyMap<string, string>): ItemState {
  const approved = approvals.get(item.key);
  if (approved === undefined) {
    return "hidden";
  }
  return approved === item.hash ? "public" : "changed";
}

export function ownerItems(
  items: readonly ProfileItem[],
  approvals: ReadonlyMap<string, string>,
): OwnerItem[] {
  return items.map((item) => ({
    key: item.key,
    kind: item.kind,
    group: item.group,
    label: item.label,
    detail: item.detail,
    state: stateOf(item, approvals),
  }));
}

export function publicItems(
  items: readonly ProfileItem[],
  approvals: ReadonlyMap<string, string>,
): PublicItem[] {
  return items
    .filter((item) => stateOf(item, approvals) === "public")
    .map((item) => ({
      key: item.key,
      kind: item.kind,
      group: item.group,
      label: item.label,
      detail: item.kind === "secret" ? { name: item.detail.name } : item.detail,
    }));
}

export interface StateCounts {
  readonly public: number;
  readonly changed: number;
  readonly hidden: number;
}

export function countStates(
  items: readonly ProfileItem[],
  approvals: ReadonlyMap<string, string>,
): StateCounts {
  const counts = { public: 0, changed: 0, hidden: 0 };
  for (const item of items) {
    counts[stateOf(item, approvals)] += 1;
  }
  return counts;
}

export function publicMarkdown(
  view: SnapshotView,
  approvals: ReadonlyMap<string, string>,
  handle: string,
  createdAt: Date,
): string | undefined {
  const approved = new Set(
    view.items.filter((item) => stateOf(item, approvals) === "public").map((item) => item.key),
  );
  const shared = publicProfile(view.memory, approved, createdAt);
  if (shared === undefined) {
    return undefined;
  }
  return writeMarkdown(shared.bundle, shared.profile, { source: `@${handle}`, createdAt });
}
