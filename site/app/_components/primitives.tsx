import type { ReactNode } from "react";
import { SiteLink } from "./SiteLink";

export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 12"
      className={`inline-block h-2.5 w-2 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M1.5 1.5 6 6l-4.5 4.5" />
    </svg>
  );
}

export function ArrowUpRight({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 10"
      className={`inline-block h-2 w-2 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M2 8 8 2M3 2h5v5" />
    </svg>
  );
}

interface ButtonProps {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: "solid" | "ghost";
  readonly external?: boolean;
}

export function Button({ href, children, variant = "solid", external = false }: ButtonProps) {
  const look =
    variant === "solid"
      ? "border-fg bg-fg text-ink hover:bg-white"
      : "border-line-strong bg-raised text-fg hover:border-muted";
  return (
    <SiteLink
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={`inline-flex h-8 items-center gap-2 border px-2.5 font-mono text-[12px] transition-colors ${look}`}
    >
      {children}
      {external ? <ArrowUpRight /> : <Chevron />}
    </SiteLink>
  );
}

export function Fig({ n, children }: { n: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between font-mono text-[10px] text-faint">
      <span>Fig. {n}</span>
      {children}
    </div>
  );
}

interface TitleProps {
  readonly lead: string;
  readonly children: ReactNode;
  readonly as?: "h1" | "h2";
}

export function SectionTitle({ lead, children, as = "h2" }: TitleProps) {
  const Tag = as;
  return (
    <Tag className="max-w-3xl text-[26px] leading-[1.2] tracking-[-0.01em] text-muted sm:text-[32px]">
      <span className="text-fg">{lead}</span> {children}
    </Tag>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[12px] text-muted">{children}</p>;
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 bg-tab px-1.5 py-0.5 font-mono text-[10px] text-muted">
      {children}
    </span>
  );
}
