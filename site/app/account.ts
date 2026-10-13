import {
  type PeoplePage,
  type PeopleQuery,
  type Person,
  peopleSearch,
  type VoteTally,
  type VoteValue,
} from "./people-query";
export type ItemKind =
  | "harnesses"
  | "instructions"
  | "skill"
  | "mcp"
  | "setting"
  | "plugin"
  | "marketplace"
  | "file"
  | "patch"
  | "secret";

export type ItemState = "public" | "hidden" | "changed";

export interface ItemFile {
  readonly path: string;
  readonly size: number;
  readonly executable: boolean;
  readonly text?: string;
  readonly truncated?: boolean;
}

export interface SetupItem {
  readonly key: string;
  readonly kind: ItemKind;
  readonly group: string;
  readonly label: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly state?: ItemState;
}

export interface Account {
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly github: string | null;
  readonly createdAt: string;
  readonly page: string;
}

export interface Snapshot {
  readonly digest: string;
  readonly createdAt: string;
  readonly items: number;
  readonly public: number;
  readonly changed: number;
  readonly hidden: number;
}

export interface Me {
  readonly account: Account;
  readonly snapshot: Snapshot | null;
  readonly items: readonly SetupItem[];
}

export interface PublicPage {
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly github: string | null;
  readonly updatedAt: string | null;
  readonly apply: string;
  readonly items: readonly SetupItem[];
}

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

export const HINT_COOKIE = "ade_hint";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly string[];

  constructor(status: number, code: string, message: string, details: readonly string[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function call<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${route}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = ((body as { error?: Record<string, unknown> }).error ?? {}) as Record<
      string,
      unknown
    >;
    throw new ApiError(
      response.status,
      typeof error.code === "string" ? error.code : "failed",
      typeof error.message === "string" ? error.message : `The request failed: ${response.status}.`,
      Array.isArray(error.details) ? error.details.map(String) : [],
    );
  }
  return body as T;
}

export function hasLoginHint(): boolean {
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${HINT_COOKIE}=`));
}

export async function getMe(): Promise<Me | undefined> {
  try {
    return await call<Me>("/v1/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return undefined;
    }
    throw error;
  }
}

export function setVisibility(
  items: Readonly<Record<string, boolean>>,
): Promise<
  { readonly items: readonly SetupItem[] } & Omit<Snapshot, "digest" | "createdAt" | "items">
> {
  return call("/v1/me/visibility", { method: "PUT", body: JSON.stringify({ items }) });
}

export function updateAccount(patch: {
  readonly handle?: string;
  readonly displayName?: string;
}): Promise<{ readonly account: Account }> {
  return call("/v1/me", { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteAccount(): Promise<{ readonly deleted: boolean }> {
  return call("/v1/me", { method: "DELETE" });
}

export function logout(): Promise<{ readonly redirect: string }> {
  return call("/auth/logout", { method: "POST" });
}

export async function pendingLogin(): Promise<{ readonly email: string } | undefined> {
  try {
    return await call<{ readonly email: string }>("/auth/pending");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

export function verifyLogin(code: string): Promise<{ readonly redirect: string }> {
  return call("/auth/verify", { method: "POST", body: JSON.stringify({ code }) });
}

export function getPeople(query: PeopleQuery, signal?: AbortSignal): Promise<PeoplePage> {
  return call<PeoplePage>(
    `/v1/people${peopleSearch(query)}`,
    signal === undefined ? {} : { signal },
  );
}

export async function getPerson(
  handle: string,
): Promise<{ readonly person: Person; readonly viewer: string | null } | undefined> {
  try {
    return await call(`/v1/people/${encodeURIComponent(handle)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

export function castVote(handle: string, value: VoteValue): Promise<{ readonly votes: VoteTally }> {
  return call(`/v1/people/${encodeURIComponent(handle)}/vote`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export function loginUrl(returnTo: string): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
