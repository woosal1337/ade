"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, type SetupItem, setVisibility } from "../account";

export interface VisibilityState {
  readonly items: readonly SetupItem[];
  readonly busy: ReadonlySet<string>;
  readonly error: string | undefined;
  readonly onChange: (keys: readonly string[], visible: boolean) => void;
}

export function useVisibility(initial: readonly SetupItem[]): VisibilityState {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  const latest = useRef(initial);
  latest.current = items;

  const onChange = useCallback((keys: readonly string[], visible: boolean) => {
    const before = latest.current;
    const changing = new Set(keys);
    setBusy((current) => new Set([...current, ...keys]));
    setItems(
      before.map((item) =>
        changing.has(item.key) ? { ...item, state: visible ? "public" : "hidden" } : item,
      ),
    );
    setVisibility(Object.fromEntries(keys.map((key) => [key, visible])))
      .then((result) => {
        setItems(result.items);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        setItems(before);
        setError(
          reason instanceof ApiError ? reason.message : "ade could not save the change. Try again.",
        );
      })
      .finally(() => {
        setBusy((current) => {
          const next = new Set(current);
          for (const key of keys) {
            next.delete(key);
          }
          return next;
        });
      });
  }, []);

  return { items, busy, error, onChange };
}
