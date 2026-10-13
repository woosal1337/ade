"use client";

import { type ReactNode, useId, useState } from "react";

const DEFAULT_LIMIT = 5;

interface CollapsibleListProps<T> {
  readonly items: readonly T[];
  readonly render: (item: T, index: number, revealed: boolean) => ReactNode;
  readonly noun: string;
  readonly limit?: number;
  readonly className?: string;
  readonly fade?: string;
}

function Arrow({ up, moving }: { readonly up: boolean; readonly moving: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`size-3 ${up ? "rotate-180" : ""} ${moving ? "ade-nudge" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

export function CollapsibleList<T>({
  items,
  render,
  noun,
  limit = DEFAULT_LIMIT,
  className = "",
  fade = "h-16",
}: CollapsibleListProps<T>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const hidden = items.length - limit;
  if (hidden <= 1) {
    return <ul className={className}>{items.map((item, index) => render(item, index, false))}</ul>;
  }
  const visible = open ? items : items.slice(0, limit);
  return (
    <div className="relative">
      <ul id={id} className={className}>
        {visible.map((item, index) => render(item, index, open && index >= limit))}
      </ul>
      {open ? null : (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-8 bg-linear-to-b from-transparent to-panel ${fade}`}
        />
      )}
      <div className={`relative flex justify-center pb-3 ${open ? "pt-2" : "-mt-1"}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-7 items-center gap-1.5 border border-line-strong bg-raised px-2.5 font-mono text-[11px] text-muted transition-colors hover:border-muted hover:text-fg"
        >
          {open ? "Show less" : `Show ${hidden} more ${noun}`}
          <Arrow up={open} moving={!open} />
        </button>
      </div>
    </div>
  );
}
