"use client";

import { useAccount } from "../account-store";
import { SiteLink } from "./SiteLink";

export function AccountButton() {
  const account = useAccount();
  return (
    <SiteLink
      href="/dashboard"
      className="inline-flex h-8 items-center border border-line-strong bg-raised px-2.5 font-mono text-[12px] text-fg transition-colors hover:border-muted"
    >
      <span
        className={account.status === "unknown" ? "opacity-0" : "opacity-100 transition-opacity"}
      >
        {account.status === "in" ? `@${account.me.account.handle}` : "Log in"}
      </span>
    </SiteLink>
  );
}
