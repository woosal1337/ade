import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const DESCRIPTION =
  "ade captures the MCP servers, skills, instructions, settings, and plugins of 10 coding agents. Share the whole setup as one ADE.md file, and import any shared setup 1:1. ade plans each change and applies it with a backup.";

export const metadata: Metadata = {
  title: "ade: own your agent setup",
  description: DESCRIPTION,
  applicationName: "ade",
  keywords: [
    "agent development environment",
    "MCP",
    "Claude Code",
    "Codex",
    "Cursor",
    "Grok",
    "Pi",
    "Gemini CLI",
    "dotfiles",
    "ADE.md",
  ],
  openGraph: {
    title: "ade: own your agent setup",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ade: own your agent setup",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-fg">{children}</body>
    </html>
  );
}
