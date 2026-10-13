"use client";

import { useAccount } from "../account-store";

export function AccountButton() {
  const account = useAccount();
  return (
    <a
      href="/dashboard"
      className="inline-flex h-8 items-center border border-line-strong bg-raised px-2.5 font-mono text-[12px] text-fg transition-colors hover:border-muted"
    >
      {account.status === "in" ? `@${account.me.account.handle}` : "Log in"}
    </a>
  );
}
