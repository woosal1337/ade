import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SITE_URL, SOCIAL_IMAGE } from "./site";

const DESCRIPTION =
  "ade captures the MCP servers, skills, instructions, settings, and plugins of 10 coding agents. Share the whole setup as one ADE.md file, and import any shared setup 1:1. ade plans each change and applies it with a backup.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "ade: own your agent setup",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
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
    url: "/",
    siteName: "ade",
    locale: "en_US",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "ade: own your agent setup",
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  colorScheme: "dark",
};

const ANALYTICS_COLLECTOR = "https://oa-c.chele.bi";
const ANALYTICS_KEY = "oa_pk_vpO6O7KTxdHEYsWq8BIr9wXQhNl6la3I";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          async
          src={`${ANALYTICS_COLLECTOR}/oa.js`}
          data-key={ANALYTICS_KEY}
          data-collector={ANALYTICS_COLLECTOR}
        />
      </head>
      <body className="min-h-screen bg-ink text-fg">{children}</body>
    </html>
  );
}
