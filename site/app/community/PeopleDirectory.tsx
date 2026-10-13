"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AvatarHeading } from "../_components/AvatarHeading";
import { BrandIcon } from "../_components/BrandIcon";
import { SiteLink } from "../_components/SiteLink";
import { VoteButtons } from "../_components/VoteButtons";
import { getPeople } from "../account";
import { useAccount } from "../account-store";
import { brandById } from "../brands";
import { HARNESSES } from "../content";
import {
  PEOPLE_HAS,
  type PeopleHas,
  type PeoplePage,
  type PeopleQuery,
  type PeopleSort,
  type Person,
  peopleSearch,
} from "../people-query";
import { timeAgo } from "../time";

const FRAME = "mx-auto max-w-[1100px] px-5";
const SEARCH_DELAY_MS = 250;
const HARNESS_NAMES = new Map(HARNESSES.map((harness) => [harness.id, harness.name]));

const SORT_LABELS: Record<PeopleSort, string> = {
  top: "Top voted",
  recent: "Recently updated",
  skills: "Most skills",
  name: "Name",
};

const HAS_LABELS: Record<PeopleHas, string> = {
  skills: "Skills",
  mcp: "MCP servers",
  plugins: "Plugins",
};

function harnessName(id: string): string {
  return HARNESS_NAMES.get(id) ?? id;
}

function Chip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 border px-2.5 font-mono text-[12px] transition-colors ${
        active
          ? "border-fg bg-fg text-ink"
          : "border-line-strong bg-raised text-muted hover:border-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Tags({
  values,
  total,
  label,
}: {
  readonly values: readonly string[];
  readonly total: number;
  readonly label: string;
}) {
  if (total === 0) {
    return null;
  }
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] text-faint">
        {label} <span className="text-muted">{total}</span>
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <li
            key={value}
            className="max-w-full truncate bg-tab px-1.5 py-0.5 font-mono text-[11px] text-fg"
          >
            {value}
          </li>
        ))}
        {total > values.length ? (
          <li className="px-1 py-0.5 font-mono text-[11px] text-faint">
            +{total - values.length} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Updated({ iso }: { readonly iso: string }) {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time dateTime={iso} title={new Date(iso).toUTCString()} className="text-faint">
      {now === undefined ? "" : `updated ${timeAgo(iso, now)}`}
    </time>
  );
}

export function PersonCard({
  person,
  eager = false,
}: {
  readonly person: Person;
  readonly eager?: boolean;
}) {
  return (
    <li className="flex gap-3 border border-line bg-panel p-4 transition-colors hover:border-line-strong">
      <VoteButtons handle={person.handle} votes={person.votes} />
      <div className="min-w-0 flex-1 space-y-3">
        <AvatarHeading src={person.avatarUrl} gap="gap-3" eager={eager}>
          <div className="min-w-0">
            <SiteLink
              prefetch={false}
              href={`/${person.handle}`}
              className="block truncate text-[16px] leading-[1.3] text-fg hover:underline hover:decoration-line-strong hover:underline-offset-4"
            >
              {person.displayName || `@${person.handle}`}
            </SiteLink>
            <p className="truncate font-mono text-[11px] text-muted">
              @{person.handle}
              {person.github === null ? null : (
                <span className="text-faint"> · GitHub {person.github}</span>
              )}
            </p>
            <p className="min-h-[1.5em] font-mono text-[11px] leading-[1.5]">
              <Updated iso={person.updatedAt} />
            </p>
          </div>
        </AvatarHeading>
        {person.harnesses.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2" aria-label="Harnesses">
            {person.harnesses.map((id) => {
              const brand = brandById(id);
              return (
                <li
                  key={id}
                  title={harnessName(id)}
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-muted"
                >
                  {brand === undefined ? null : (
                    <BrandIcon paths={brand.paths} className="size-3.5 text-fg" />
                  )}
                  {harnessName(id)}
                </li>
              );
            })}
          </ul>
        )}
        <Tags values={person.skills} total={person.skillCount} label="Skills" />
        <Tags values={person.mcp} total={person.mcpCount} label="MCP servers" />
        <Tags values={person.plugins} total={person.pluginCount} label="Plugins" />
        <SiteLink
          prefetch={false}
          href={`/${person.handle}`}
          className="inline-block font-mono text-[11px] text-muted hover:text-fg"
        >
          {person.itemCount} shared items. Open the setup
        </SiteLink>
      </div>
    </li>
  );
}

function sameQuery(left: PeopleQuery, right: PeopleQuery): boolean {
  return peopleSearch(left) === peopleSearch(right);
}

export function PeopleDirectory({ initial }: { readonly initial: PeoplePage | null }) {
  const router = useRouter();
  const account = useAccount();
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState<PeopleQuery>(
    initial?.query ?? { q: "", harness: undefined, has: [], sort: "top", page: 1 },
  );
  const [text, setText] = useState(query.q);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string>();
  const loaded = useRef<{ query: PeopleQuery; viewer: string | null } | undefined>(
    initial === null ? undefined : { query: initial.query, viewer: initial.viewer },
  );
  const search = useRef<HTMLInputElement>(null);
  const viewer = account.status === "in" ? account.me.account.handle : null;

  const load = useCallback((next: PeopleQuery, signal: AbortSignal) => {
    setLoading(true);
    getPeople(next, signal)
      .then((page) => {
        setData(page);
        setError(undefined);
        loaded.current = { query: next, viewer: page.viewer };
      })
      .catch(() => {
        if (!signal.aborted) {
          setError("ade could not load the list. Try again in a minute.");
        }
      })
      .finally(() => {
        if (!signal.aborted) {
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    const done = loaded.current;
    if (done !== undefined && sameQuery(done.query, query) && done.viewer === viewer) {
      return;
    }
    if (account.status === "unknown" && done !== undefined && sameQuery(done.query, query)) {
      return;
    }
    const controller = new AbortController();
    load(query, controller.signal);
    return () => controller.abort();
  }, [query, viewer, account.status, load]);

  useEffect(() => {
    const target = `/community${peopleSearch(query)}`;
    if (`${window.location.pathname}${window.location.search}` !== target) {
      router.replace(target, { scroll: false });
    }
  }, [query, router]);

  useEffect(() => {
    if (text.trim() === query.q) {
      return;
    }
    const timer = window.setTimeout(() => {
      setQuery((current) => ({ ...current, q: text.trim(), page: 1 }));
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, query.q]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = (patch: Partial<PeopleQuery>) =>
    setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const toggleHas = (value: PeopleHas) =>
    update({
      has: query.has.includes(value)
        ? query.has.filter((item) => item !== value)
        : PEOPLE_HAS.filter((item) => item === value || query.has.includes(item)),
    });
  const filtered = query.q !== "" || query.harness !== undefined || query.has.length > 0;
  const clear = () => {
    setText("");
    setQuery({ q: "", harness: undefined, has: [], sort: query.sort, page: 1 });
  };

  const total = data?.total ?? 0;
  const pages = data === null ? 1 : Math.max(1, Math.ceil(total / data.pageSize));
  const listed = data?.facets.listed ?? 0;

  return (
    <div className={`${FRAME} space-y-8 py-12`}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-[640px] space-y-3">
          <p className="font-mono text-[12px] text-muted">Community</p>
          <h1 className="text-[36px] leading-[1.1] tracking-[-0.02em] text-fg">
            Agent setups that people share
          </h1>
          <p className="text-[16px] leading-[1.6] text-muted">
            Each person here switched on parts of their setup. Search by name, skill, or MCP server.
            Vote for the setups that help you, then apply one with{" "}
            <code className="font-mono text-[14px] text-fg">ade apply @name</code>.
          </p>
        </div>
        <SiteLink
          href="/dashboard"
          className="inline-flex h-8 items-center border border-fg bg-fg px-2.5 font-mono text-[12px] text-ink transition-colors hover:bg-white"
        >
          Share your setup
        </SiteLink>
      </div>

      <div className="space-y-4 border border-line bg-panel p-4">
        <div className="relative">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3.5 3.5" />
          </svg>
          <label htmlFor="people-search" className="sr-only">
            Search people
          </label>
          <input
            id="people-search"
            ref={search}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search by name, GitHub login, skill, or MCP server"
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full border border-line-strong bg-ink pr-10 pl-9 font-mono text-[13px] text-fg outline-none placeholder:text-faint focus:border-muted"
          />
          <kbd className="absolute top-1/2 right-3 -translate-y-1/2 border border-line-strong px-1.5 font-mono text-[11px] text-faint">
            /
          </kbd>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-mono text-[11px] text-faint">Harness</span>
          <Chip active={query.harness === undefined} onClick={() => update({ harness: undefined })}>
            All
          </Chip>
          {(data?.facets.harnesses ?? []).map((facet) => {
            const brand = brandById(facet.id);
            return (
              <Chip
                key={facet.id}
                active={query.harness === facet.id}
                onClick={() =>
                  update({ harness: query.harness === facet.id ? undefined : facet.id })
                }
              >
                {brand === undefined ? null : <BrandIcon paths={brand.paths} className="size-3" />}
                {harnessName(facet.id)}
                <span className="opacity-60">{facet.count}</span>
              </Chip>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 font-mono text-[11px] text-faint">Shares</span>
            {PEOPLE_HAS.map((value) => (
              <Chip key={value} active={query.has.includes(value)} onClick={() => toggleHas(value)}>
                {HAS_LABELS[value]}
              </Chip>
            ))}
          </div>
          <label className="flex items-center gap-2 font-mono text-[11px] text-faint">
            Sort
            <select
              value={query.sort}
              onChange={(event) => update({ sort: event.target.value as PeopleSort })}
              className="h-7 border border-line-strong bg-raised px-2 font-mono text-[12px] text-fg outline-none focus:border-muted"
            >
              {(Object.keys(SORT_LABELS) as PeopleSort[]).map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[12px] text-muted">
        <p aria-live="polite">
          {data === null
            ? "Loading people..."
            : filtered
              ? `${total} of ${listed} people match`
              : `${listed} ${listed === 1 ? "person shares" : "people share"} a setup`}
          {loading && data !== null ? <span className="text-faint"> · updating</span> : null}
        </p>
        {filtered ? (
          <button type="button" onClick={clear} className="text-muted hover:text-fg">
            Clear the search and filters
          </button>
        ) : null}
      </div>

      {error === undefined ? null : (
        <p className="border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
          {error}
        </p>
      )}

      {data !== null && data.people.length === 0 ? (
        <div className="space-y-3 border border-line bg-panel p-8 text-center">
          <p className="text-[16px] text-fg">
            {listed === 0 ? "Nobody shares a setup yet." : "No person matches."}
          </p>
          <p className="font-mono text-[12px] text-muted">
            {listed === 0 ? (
              <SiteLink
                href="/dashboard"
                className="text-fg underline decoration-line-strong underline-offset-4"
              >
                Share yours first
              </SiteLink>
            ) : (
              "Use fewer words, or clear the filters."
            )}
          </p>
        </div>
      ) : (
        <ul
          className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${loading && data !== null ? "opacity-60" : ""}`}
        >
          {(data?.people ?? []).map((person) => (
            <PersonCard key={person.handle} person={person} />
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav
          aria-label="Pages"
          className="flex items-center justify-center gap-3 font-mono text-[12px]"
        >
          <button
            type="button"
            disabled={query.page <= 1}
            onClick={() => update({ page: query.page - 1 })}
            className="h-8 border border-line-strong bg-raised px-3 text-fg hover:border-muted disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted">
            Page {query.page} of {pages}
          </span>
          <button
            type="button"
            disabled={query.page >= pages}
            onClick={() => update({ page: query.page + 1 })}
            className="h-8 border border-line-strong bg-raised px-3 text-fg hover:border-muted disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
