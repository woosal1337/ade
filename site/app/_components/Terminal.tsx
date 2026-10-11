"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import type { TermLine } from "../content";

const TONES: Record<string, string> = {
  muted: "text-faint",
  add: "text-accent",
  warn: "text-warn",
  ok: "text-accent",
  head: "text-fg",
};

function numbered(lines: readonly TermLine[]) {
  return lines.map((line, index) => ({ id: `line-${String(index)}`, line, index }));
}

interface TerminalProps {
  readonly title: string;
  readonly lines: readonly TermLine[];
}

export function Terminal({ title, lines }: TerminalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  const show = reduce === true || inView;
  return (
    <div ref={ref} className="flex h-full flex-col border border-line bg-[#0d0d0d]">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="ml-2 font-mono text-[11px] text-faint">{title}</span>
      </div>
      <pre className="flex-1 overflow-x-auto p-4 font-mono text-[12px] leading-[1.7]">
        {numbered(lines).map(({ id, line, index }) => (
          <motion.div
            key={id}
            initial={reduce === true ? false : { opacity: 0, y: 4 }}
            animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
            transition={{ duration: 0.18, delay: reduce === true ? 0 : index * 0.07 }}
            className={line.kind === "cmd" ? "text-fg" : (TONES[line.tone ?? ""] ?? "text-muted")}
          >
            {line.kind === "cmd" ? (
              <>
                <span className="select-none text-accent">$ </span>
                {line.text}
              </>
            ) : (
              line.text || " "
            )}
          </motion.div>
        ))}
      </pre>
    </div>
  );
}
