"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "../clipboard";

const RESET_MS = 1000;

type CopyState = "idle" | "copied" | "failed";

const LABELS: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied!",
  failed: "Failed",
};

const ANNOUNCEMENTS: Record<CopyState, string> = {
  idle: "",
  copied: "Copied the command.",
  failed: "The browser blocked the copy. The command is selected, so copy it by hand.",
};

interface CopyCommandProps {
  readonly command: string;
  readonly prompt?: string;
  readonly size?: "sm" | "md";
}

function CheckMark({ reduce }: { readonly reduce: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-[10px] shrink-0">
      <motion.path
        d="M2 6.5 4.75 9 10 3"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="square"
        initial={{ pathLength: reduce ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.06, ease: "easeOut" }}
      />
    </svg>
  );
}

function selectContents(element: HTMLElement | null): void {
  const selection = window.getSelection();
  if (element === null || selection === null) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function CopyCommand({ command, prompt = "$", size = "md" }: CopyCommandProps) {
  const [state, setState] = useState<CopyState>("idle");
  const [clicks, setClicks] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const code = useRef<HTMLElement>(null);
  const reduce = useReducedMotion() === true;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async (): Promise<void> => {
    const copied = await copyText(command);
    if (!copied) {
      selectContents(code.current);
    }
    setState(copied ? "copied" : "failed");
    setClicks((value) => value + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), RESET_MS);
  };

  const offset = reduce ? 0 : 8;
  const text = size === "sm" ? "text-[12px]" : "text-[13px]";
  const tone = state === "copied" ? "text-accent" : state === "failed" ? "text-warn" : "";
  return (
    <div
      className={`group flex min-w-0 items-center gap-3 border bg-panel px-3 py-2 font-mono transition-colors duration-300 ${
        state === "copied" ? "border-accent/40" : "border-line"
      } ${text}`}
    >
      <span aria-hidden="true" className="select-none text-accent">
        {prompt}
      </span>
      <code
        ref={code}
        className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-fg [scrollbar-width:none]"
      >
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="relative -my-2 -mr-3 shrink-0 self-stretch overflow-hidden px-3 py-2 font-mono text-[10px] text-faint transition-colors hover:text-fg"
        aria-label={`Copy the command: ${command}`}
      >
        <span aria-hidden="true" className="invisible flex h-full items-center gap-1">
          <span className="size-[10px]" />
          {LABELS.copied}
        </span>
        <AnimatePresence initial={false}>
          <motion.span
            key={state === "idle" ? "idle" : `${state}-${clicks}`}
            aria-hidden="true"
            className={`absolute inset-0 flex items-center justify-end gap-1 px-3 ${tone}`}
            initial={{ opacity: 0, y: offset }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -offset }}
            transition={{ duration: reduce ? 0 : 0.2, ease: "easeOut" }}
          >
            {state === "copied" ? <CheckMark reduce={reduce} /> : null}
            {LABELS[state]}
          </motion.span>
        </AnimatePresence>
      </button>
      <span className="sr-only" aria-live="polite">
        {ANNOUNCEMENTS[state]}
      </span>
    </div>
  );
}
