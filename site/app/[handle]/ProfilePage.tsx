"use client";

import Image from "next/image";
import { CopyCommand } from "../_components/CopyCommand";
import { ArrowUpRight } from "../_components/primitives";
import { SetupView } from "../_components/SetupView";
import { useVisibility } from "../_components/useVisibility";
import type { Me, PublicPage } from "../account";
import { saveAccount, useAccount, withItems } from "../account-store";

const FRAME = "mx-auto max-w-[1100px] px-5";

function OwnerView({ me }: { readonly me: Me }) {
  const visibility = useVisibility(me.items, (items) => saveAccount(withItems(me, items)));
  if (me.snapshot === null) {
    return (
      <p className="border border-line bg-panel p-5 text-[14px] text-muted">
        This is your page. Run ade push on your machine to upload your setup.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="border border-accent/30 bg-accent/5 px-4 py-3 text-[14px] leading-[1.6] text-muted">
        <span className="text-fg">This is your page.</span> Others see only the items that you
        switch on. An item that changes after your approval stays hidden until you switch it on
        again.
      </p>
      {visibility.error === undefined ? null : (
        <p className="border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
          {visibility.error}
        </p>
      )}
      <SetupView items={visibility.items} editor={visibility} />
    </div>
  );
}

export function ProfilePage({ page }: { readonly page: PublicPage }) {
  const account = useAccount();
  const owner =
    account.status === "in" && account.me.account.handle === page.handle ? account.me : undefined;

  return (
    <div className={`${FRAME} space-y-10 py-12`}>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {page.avatarUrl === null ? null : (
            <Image
              src={page.avatarUrl}
              alt=""
              width={56}
              height={56}
              unoptimized
              className="size-14 border border-line"
            />
          )}
          <div className="space-y-1">
            <h1 className="text-[28px] leading-[1.15] tracking-[-0.01em] text-fg">
              {page.displayName || `@${page.handle}`}
            </h1>
            <p className="font-mono text-[12px] text-muted">
              @{page.handle}
              {page.github === null ? null : (
                <>
                  {" · "}
                  <a
                    href={`https://github.com/${page.github}`}
                    className="underline decoration-line-strong underline-offset-4 hover:text-fg"
                  >
                    GitHub {page.github}
                  </a>
                </>
              )}
              {page.updatedAt === null
                ? ""
                : ` · updated ${new Date(page.updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`}
            </p>
          </div>
        </div>
        {owner === undefined ? null : (
          <a
            href="/dashboard"
            className="inline-flex h-8 items-center gap-2 border border-line-strong bg-raised px-2.5 font-mono text-[12px] text-fg hover:border-muted"
          >
            Dashboard
          </a>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <CopyCommand command={page.apply} />
        <a
          href={`/api/v1/users/${page.handle}/ADE.md`}
          className="font-mono text-[12px] text-muted hover:text-fg"
        >
          Download ADE.md <ArrowUpRight />
        </a>
      </div>
      {owner !== undefined ? (
        <OwnerView me={owner} />
      ) : page.items.length === 0 ? (
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
