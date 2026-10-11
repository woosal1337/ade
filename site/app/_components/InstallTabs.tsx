"use client";

import { useId, useState } from "react";
import { INSTALL_PS1, INSTALL_SH, PACKAGE } from "../content";
import { CopyCommand } from "./CopyCommand";

const TABS = [
  {
    id: "npm",
    label: "npm",
    prompt: "$",
    command: `npm install -g ${PACKAGE}`,
    note: "Needs Node.js 22 or later and Git.",
  },
  {
    id: "unix",
    label: "macOS / Linux",
    prompt: "$",
    command: `curl -fsSL ${INSTALL_SH} | sh -s -- you/agents`,
    note: "Installs ade, shows the plan for the source, then asks before the apply.",
  },
  {
    id: "windows",
    label: "Windows",
    prompt: ">",
    command: `$env:ADE_SOURCE = "you/agents"; irm ${INSTALL_PS1} | iex`,
    note: "PowerShell. Installs ade, shows the plan, then asks before the apply.",
  },
] as const;

export function InstallTabs() {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("npm");
  const base = useId();
  const tab = TABS.find((item) => item.id === active) ?? TABS[0];
  return (
    <div className="border border-line bg-panel">
      <div role="tablist" aria-label="Install method" className="flex border-b border-line">
        {TABS.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${base}-${item.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              onClick={() => setActive(item.id)}
              className={`border-r border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                selected ? "bg-raised text-fg" : "text-faint hover:text-muted"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-${tab.id}`}
        className="space-y-3 p-3"
      >
        <CopyCommand command={tab.command} prompt={tab.prompt} />
        <p className="font-mono text-[11px] text-faint">{tab.note}</p>
      </div>
    </div>
  );
}
