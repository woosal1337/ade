"use client";

import { useEffect, useState } from "react";
import { AvatarHeading } from "../_components/AvatarHeading";
import { CopyCommand } from "../_components/CopyCommand";
import { ArrowUpRight } from "../_components/primitives";
import { SetupView } from "../_components/SetupView";
import { SiteLink } from "../_components/SiteLink";
import { VoteButtons } from "../_components/VoteButtons";
import { getPerson, type PublicPage } from "../account";
import { useAccount } from "../account-store";
import type { VoteTally } from "../people-query";

const FRAME = "mx-auto max-w-[1100px] px-5";

export function ProfilePage({
  page,
  votes,
}: {
  readonly page: PublicPage;
  readonly votes: VoteTally | undefined;
}) {
  const account = useAccount();
  const owner = account.status === "in" && account.me.account.handle === page.handle;
  const [tally, setTally] = useState(votes);
  const signedIn = account.status === "in";

  useEffect(() => {
    if (!signedIn || votes === undefined) {
      return;
    }
    getPerson(page.handle)
      .then((result) => {
        if (result !== undefined) {
          setTally(result.person.votes);
        }
      })
      .catch(() => undefined);
  }, [signedIn, page.handle, votes]);

  return (
    <div className={`${FRAME} space-y-10 py-12`}>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <AvatarHeading src={page.avatarUrl}>
          <div className="space-y-1">
            <h1 className="text-[28px] leading-[1.15] tracking-[-0.01em] text-fg">
              {page.displayName || `@${page.handle}`}
            </h1>
            <p className="font-mono text-[12px] text-muted">
              @{page.handle}
              {page.github === null ? null : (
                <>
                  {" · "}
                  <SiteLink
                    href={`https://github.com/${page.github}`}
                    className="underline decoration-line-strong underline-offset-4 hover:text-fg"
                  >
                    GitHub {page.github}
                  </SiteLink>
                </>
              )}
              {page.updatedAt === null
                ? ""
                : ` · updated ${new Date(page.updatedAt).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" })}`}
            </p>
          </div>
        </AvatarHeading>
        <div className="flex items-center gap-4">
          {tally === undefined ? null : (
            <VoteButtons handle={page.handle} votes={tally} layout="row" />
          )}
          {owner ? (
            <SiteLink
              href="/dashboard"
              className="inline-flex h-8 items-center gap-2 border border-line-strong bg-raised px-2.5 font-mono text-[12px] text-fg hover:border-muted"
            >
              Edit on the dashboard
            </SiteLink>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <CopyCommand command={page.apply} />
        <SiteLink
          href={`/api/v1/users/${page.handle}/ADE.md`}
          className="font-mono text-[12px] text-muted hover:text-fg"
        >
          Download ADE.md <ArrowUpRight />
        </SiteLink>
      </div>
      {page.items.length === 0 ? (
        <p className="border border-line bg-panel p-5 text-[14px] text-muted">
          @{page.handle} shares no items yet.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-[14px] leading-[1.6] text-muted">
            The command plans the setup on your machine and asks before it writes. ade asks you to
            trust the source first, because a setup can run programs.
          </p>
          <SetupView items={page.items} />
        </div>
      )}
    </div>
  );
}
