"use client";

import { useId, useState } from "react";
import { INSTALL_COMMAND, INSTALL_PS1, NPM_INSTALL_COMMAND } from "../content";
import { CopyCommand } from "./CopyCommand";

const TABS = [
  {
    id: "unix",
    label: "macOS / Linux",
    prompt: "$",
    command: INSTALL_COMMAND,
    note: "Needs Node.js 22 or later and Git. Add -s -- <owner>/<repo> to plan and apply a setup in the same step.",
  },
  {
    id: "windows",
    label: "Windows",
    prompt: ">",
    command: `irm ${INSTALL_PS1} | iex`,
    note: "PowerShell. Needs Node.js 22 or later and Git. Set $env:ADE_SOURCE first to plan and apply a setup.",
  },
  {
    id: "npm",
    label: "npm",
    prompt: "$",
    command: NPM_INSTALL_COMMAND,
    note: "Builds a package file from GitHub, then installs it. Needs Node.js 22 or later and Git.",
  },
] as const;

export function InstallTabs() {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("unix");
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
              className={`border-r border-line px-3 py-2 font-mono text-[11px] transition-colors ${
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
