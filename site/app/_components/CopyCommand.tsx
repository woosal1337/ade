"use client";

import { useState } from "react";

interface CopyCommandProps {
  readonly command: string;
  readonly prompt?: string;
  readonly size?: "sm" | "md";
}

export function CopyCommand({ command, prompt = "$", size = "md" }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  const text = size === "sm" ? "text-[12px]" : "text-[13px]";
  return (
    <div
      className={`group flex min-w-0 items-center gap-3 border border-line bg-panel px-3 py-2 font-mono ${text}`}
    >
      <span aria-hidden="true" className="select-none text-accent">
        {prompt}
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-fg [scrollbar-width:none]">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint transition-colors hover:text-fg"
        aria-label={`Copy the command: ${command}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "The command is on the clipboard." : ""}
      </span>
    </div>
  );
}
