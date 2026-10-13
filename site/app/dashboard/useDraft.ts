"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, type Me, type SetupItem, setVisibility } from "../account";
import { forgetAccount, saveAccount, withItems } from "../account-store";
import {
  applyDraft,
  draftStorageKey,
  normalizeOverrides,
  type Overrides,
  parseStoredDraft,
  setOverrides,
} from "../draft";

export interface DraftEditor {
  readonly items: readonly SetupItem[];
  readonly busy: ReadonlySet<string>;
  readonly pending: ReadonlySet<string>;
  readonly error: string | undefined;
  readonly count: number;
  readonly saving: boolean;
  readonly onChange: (keys: readonly string[], visible: boolean) => void;
  readonly save: () => Promise<boolean>;
  readonly discard: () => void;
}

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

const NONE: ReadonlySet<string> = new Set();

export function useDraft(me: Me): DraftEditor {
  const base = me.items;
  const key = draftStorageKey(me.account.handle, me.snapshot?.digest ?? "none");
  const [overrides, setOverridesState] = useState<Overrides>({});
  const [restoredKey, setRestoredKey] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stored: Overrides = {};
    try {
      stored = parseStoredDraft(storage()?.getItem(key) ?? null);
    } catch {
      stored = {};
    }
    setOverridesState(stored);
    setRestoredKey(key);
  }, [key]);

  const effective = useMemo(() => normalizeOverrides(base, overrides), [base, overrides]);
  const count = Object.keys(effective).length;

  useEffect(() => {
    if (restoredKey !== key) {
      return;
    }
    try {
      if (count === 0) {
        storage()?.removeItem(key);
      } else {
        storage()?.setItem(key, JSON.stringify(effective));
      }
    } catch {
      return;
    }
  }, [effective, count, key, restoredKey]);

  useEffect(() => {
    if (count === 0) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);

  const items = useMemo(() => applyDraft(base, effective), [base, effective]);
  const pending = useMemo(() => new Set(Object.keys(effective)), [effective]);
  const busy = useMemo(
    () => (saving ? new Set(base.map((item) => item.key)) : NONE),
    [saving, base],
  );

  const onChange = useCallback(
    (keys: readonly string[], visible: boolean) => {
      setOverridesState((current) => setOverrides(base, current, keys, visible));
    },
    [base],
  );

  const save = useCallback(async () => {
    if (count === 0) {
      return true;
    }
    setSaving(true);
    try {
      const result = await setVisibility(effective);
      setOverridesState({});
      setError(undefined);
      saveAccount(withItems(me, result.items));
      return true;
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        forgetAccount();
        return false;
      }
      setError(
        reason instanceof ApiError ? reason.message : "ade could not save the changes. Try again.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [count, effective, me]);

  const discard = useCallback(() => {
    setOverridesState({});
    setError(undefined);
  }, []);

  return { items, busy, pending, error, count, saving, onChange, save, discard };
}
