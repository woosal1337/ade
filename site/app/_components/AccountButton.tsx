"use client";

import { useEffect, useState } from "react";
import { getMe, hasLoginHint } from "../account";

export function AccountButton() {
  const [handle, setHandle] = useState<string>();

  useEffect(() => {
    if (!hasLoginHint()) {
      return;
    }
    getMe()
      .then((me) => setHandle(me?.account.handle))
      .catch(() => setHandle(undefined));
  }, []);

  return (
    <a
      href="/dashboard"
      className="inline-flex h-8 items-center border border-line-strong bg-raised px-2.5 font-mono text-[12px] text-fg transition-colors hover:border-muted"
    >
      {handle === undefined ? "Log in" : `@${handle}`}
    </a>
  );
}
