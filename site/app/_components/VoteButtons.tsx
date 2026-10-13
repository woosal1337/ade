"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, castVote, loginUrl } from "../account";
import { forgetAccount, useAccount } from "../account-store";
import type { VoteTally } from "../people-query";
import { nextVote } from "../time";

interface VoteButtonsProps {
  readonly handle: string;
  readonly votes: VoteTally;
  readonly layout?: "column" | "row";
}

function Arrow({ down = false }: { readonly down?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`size-3 ${down ? "rotate-180" : ""}`}
      fill="currentColor"
    >
      <path d="M6 2 11 9H1z" />
    </svg>
  );
}

export function VoteButtons({ handle, votes, layout = "column" }: VoteButtonsProps) {
  const account = useAccount();
  const [tally, setTally] = useState(votes);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"login" | "error" | "busy">();
  const pending = useRef(false);

  useEffect(() => {
    if (!pending.current) {
      setTally(votes);
    }
  }, [votes]);

  useEffect(() => {
    if (note === undefined) {
      return;
    }
    const timer = window.setTimeout(() => setNote(undefined), 5000);
    return () => window.clearTimeout(timer);
  }, [note]);

  const own = account.status === "in" && account.me.account.handle === handle;
  const press = (value: -1 | 1) => {
    if (own || busy) {
      return;
    }
    if (account.status !== "in") {
      setNote("login");
      return;
    }
    const before = tally;
    const after = nextVote(tally, value);
    setTally(after);
    setBusy(true);
    pending.current = true;
    castVote(handle, after.mine)
      .then((result) => setTally(result.votes))
      .catch((reason: unknown) => {
        setTally(before);
        if (reason instanceof ApiError && reason.status === 401) {
          forgetAccount();
          setNote("login");
        } else {
          setNote(reason instanceof ApiError && reason.status === 429 ? "busy" : "error");
        }
      })
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  };

  const button = (value: -1 | 1) => {
    const active = tally.mine === value;
    const color = active
      ? value === 1
        ? "text-accent"
        : "text-danger"
      : "text-faint hover:text-fg disabled:hover:text-faint";
    const label = `${value === 1 ? "Upvote" : "Downvote"} @${handle}`;
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        title={own ? "You cannot vote for your own page" : label}
        disabled={own || busy}
        onClick={() => press(value)}
        className={`flex size-7 items-center justify-center border border-transparent transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:hover:border-transparent ${color}`}
      >
        <Arrow down={value === -1} />
      </button>
    );
  };

  const message =
    note === "login" ? (
      <a
        href={loginUrl(typeof window === "undefined" ? "/people" : window.location.pathname)}
        className="text-fg underline decoration-line-strong underline-offset-4"
      >
        Log in to vote
      </a>
    ) : note === "busy" ? (
      "Too many votes. Wait a minute."
    ) : note === "error" ? (
      "The vote did not save."
    ) : null;

  return (
    <div className="relative">
      <div
        className={`flex items-center gap-0.5 ${layout === "column" ? "flex-col" : "flex-row"}`}
        title={`${tally.up} up, ${tally.down} down`}
      >
        {button(1)}
        <span
          aria-live="polite"
          className={`min-w-6 text-center font-mono text-[13px] tabular-nums ${
            tally.score > 0 ? "text-fg" : tally.score < 0 ? "text-danger" : "text-muted"
          }`}
        >
          <span className="sr-only">Score </span>
          {tally.score}
        </span>
        {button(-1)}
      </div>
      {message === null ? null : (
        <p
          role="status"
          className={`absolute z-10 w-40 border border-line-strong bg-raised px-2 py-1.5 font-mono text-[11px] text-muted ${
            layout === "column" ? "left-0 top-full mt-1" : "right-0 top-full mt-1"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
