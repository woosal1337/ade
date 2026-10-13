"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ApiError, getMe, hasLoginHint, type Me, type SetupItem } from "./account";
import { type CacheStorage, clearCached, readCached, writeCached } from "./account-cache";

export type AccountState =
  | { readonly status: "unknown" }
  | { readonly status: "out" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "in"; readonly me: Me; readonly checked: boolean };

const UNKNOWN: AccountState = { status: "unknown" };
const RECHECK_MS = 60_000;

let state: AccountState | undefined;
let inflight: Promise<Me | undefined> | undefined;
let checkedAt = 0;
let watching = false;
const listeners = new Set<() => void>();

function storage(): CacheStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isMe(value: unknown): value is Me {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const me = value as Record<string, unknown>;
  const account = me.account as Record<string, unknown> | null | undefined;
  return (
    typeof account === "object" &&
    account !== null &&
    typeof account.handle === "string" &&
    Array.isArray(me.items) &&
    (me.snapshot === null || typeof me.snapshot === "object")
  );
}

function emit(next: AccountState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function accountState(): AccountState {
  if (state === undefined) {
    const cached = readCached(storage(), Date.now(), isMe);
    if (cached !== undefined) {
      state = { status: "in", me: cached, checked: false };
    } else {
      state = hasLoginHint() ? UNKNOWN : { status: "out" };
    }
  }
  return state;
}

function serverState(): AccountState {
  return UNKNOWN;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function refreshAccount(): Promise<Me | undefined> {
  if (inflight !== undefined) {
    return inflight;
  }
  checkedAt = Date.now();
  inflight = getMe()
    .then((me) => {
      if (me === undefined) {
        clearCached(storage());
        emit({ status: "out" });
      } else {
        writeCached(storage(), me, Date.now());
        emit({ status: "in", me, checked: true });
      }
      return me;
    })
    .catch((reason: unknown) => {
      const current = accountState();
      if (current.status !== "in") {
        emit({
          status: "error",
          message:
            reason instanceof ApiError
              ? reason.message
              : "ade could not reach its server. Try again in a minute.",
        });
      }
      throw reason;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

export function saveAccount(me: Me): void {
  writeCached(storage(), me, Date.now());
  emit({ status: "in", me, checked: true });
}

export function forgetAccount(): void {
  clearCached(storage());
  emit({ status: "out" });
}

function recheck(): void {
  if (accountState().status === "out" && !hasLoginHint()) {
    return;
  }
  if (document.visibilityState === "visible" && Date.now() - checkedAt > RECHECK_MS) {
    refreshAccount().catch(() => undefined);
  }
}

export function useAccount(): AccountState {
  const current = useSyncExternalStore(subscribe, accountState, serverState);
  useEffect(() => {
    if (watching) {
      return;
    }
    watching = true;
    if (accountState().status !== "out") {
      refreshAccount().catch(() => undefined);
    }
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
  }, []);
  return current;
}

export function withItems(me: Me, items: readonly SetupItem[]): Me {
  const counts = { public: 0, changed: 0, hidden: 0 };
  for (const item of items) {
    counts[item.state ?? "hidden"] += 1;
  }
  return {
    ...me,
    items,
    snapshot: me.snapshot === null ? null : { ...me.snapshot, ...counts },
  };
}
