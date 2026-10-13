"use client";

import { useEffect, useRef, useState } from "react";
import { ProfilePage } from "../[handle]/ProfilePage";
import { getPerson, type Me, type SetupItem } from "../account";
import { PersonCard } from "../community/PeopleDirectory";
import { previewPerson, publicView } from "../draft";
import type { VoteTally } from "../people-query";

type Tab = "card" | "page";

interface PreviewProps {
  readonly open: boolean;
  readonly me: Me;
  readonly items: readonly SetupItem[];
  readonly unsaved: number;
  readonly saving: boolean;
  readonly onSave: () => void;
  readonly onClose: () => void;
}

const BUTTON =
  "inline-flex h-8 items-center gap-2 border px-2.5 font-mono text-[12px] transition-colors disabled:opacity-50";

export function Preview({ open, me, items, unsaved, saving, onSave, onClose }: PreviewProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("card");
  const [votes, setVotes] = useState<VoteTally>();
  const [now, setNow] = useState(() => new Date().toISOString());
  const { account } = me;

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
      setNow(new Date().toISOString());
      document.documentElement.style.overflow = "hidden";
    }
    if (!open && element.open) {
      element.close();
    }
    if (!open) {
      document.documentElement.style.overflow = "";
    }
  }, [open]);

  useEffect(
    () => () => {
      document.documentElement.style.overflow = "";
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    getPerson(account.handle)
      .then((result) => setVotes(result?.person.votes))
      .catch(() => setVotes(undefined));
  }, [open, account.handle]);

  const shown = publicView(items);
  const updatedAt = unsaved > 0 ? now : (me.snapshot?.createdAt ?? now);
  const person = previewPerson(
    {
      handle: account.handle,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      github: account.github,
    },
    items,
    updatedAt,
    votes,
  );
  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`h-8 border px-3 font-mono text-[12px] transition-colors ${
        tab === value
          ? "border-fg bg-fg text-ink"
          : "border-line-strong bg-raised text-muted hover:border-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby="preview-title"
      onClose={onClose}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-ink p-0 text-fg backdrop:bg-black/70"
    >
      {open ? (
        <>
          <div className="sticky top-0 z-10 border-b border-line bg-ink/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="space-y-0.5">
                <h2 id="preview-title" className="text-[18px] text-fg">
                  Preview
                </h2>
                <p className="font-mono text-[11px] text-muted">
                  {unsaved === 0
                    ? "What everyone sees now."
                    : `What everyone sees after you save ${unsaved} ${unsaved === 1 ? "change" : "changes"}.`}
                </p>
              </div>
              <div role="tablist" aria-label="Preview" className="flex gap-2">
                {tabButton("card", "Community card")}
                {tabButton("page", "Public page")}
              </div>
              <div className="flex items-center gap-2">
                {unsaved === 0 ? null : (
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    className={`${BUTTON} border-fg bg-fg text-ink hover:bg-white`}
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dialog.current?.close()}
                  className={`${BUTTON} border-line-strong bg-raised text-fg hover:border-muted`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
          {tab === "card" ? (
            <div className="mx-auto max-w-[1100px] space-y-4 px-5 py-12">
              <p className="font-mono text-[12px] text-muted">
                Your card on <span className="text-fg">ade.chele.bi/community</span>
              </p>
              {person === undefined ? (
                <p className="max-w-[540px] border border-line bg-panel p-5 text-[14px] leading-[1.6] text-muted">
                  With no item switched on, you are not on the Community page.
                </p>
              ) : (
                <ul inert className="grid max-w-[540px] grid-cols-1">
                  <PersonCard person={person} eager />
                </ul>
              )}
            </div>
          ) : (
            <ProfilePage
              preview
              votes={person?.votes}
              page={{
                handle: account.handle,
                displayName: account.displayName,
                avatarUrl: account.avatarUrl,
                github: account.github,
                updatedAt: me.snapshot?.createdAt ?? null,
                apply: `ade apply @${account.handle}`,
                items: shown,
              }}
            />
          )}
        </>
      ) : null}
    </dialog>
  );
}
