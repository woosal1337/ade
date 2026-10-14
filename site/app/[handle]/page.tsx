import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Header } from "../_components/Header";
import { Footer } from "../_components/sections";
import { HANDLE_PATTERN, type PublicPage } from "../account";
import type { VoteTally } from "../people-query";
import { API_ORIGIN } from "../site";
import { cardPath } from "../user-card";
import { ProfilePage } from "./ProfilePage";

interface Params {
  readonly params: Promise<{ readonly handle: string }>;
}

const loadPage = cache(async (handle: string): Promise<PublicPage | undefined> => {
  if (!HANDLE_PATTERN.test(handle)) {
    return undefined;
  }
  const response = await fetch(`${API_ORIGIN}/v1/users/${handle}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`The ade API answered ${response.status}.`);
  }
  return (await response.json()) as PublicPage;
});

function summary(page: PublicPage): string {
  const count = (kind: string) => page.items.filter((item) => item.kind === kind).length;
  const parts = (
    [
      [count("skill"), "skill"],
      [count("mcp"), "MCP server"],
      [count("setting"), "setting"],
      [count("plugin"), "plugin"],
    ] as const
  )
    .filter(([value]) => value > 0)
    .map(([value, label]) => `${value} ${label}${value === 1 ? "" : "s"}`);
  const shared = parts.length === 0 ? "an agent setup" : parts.join(", ");
  return `@${page.handle} shares ${shared} on ade. Apply it with: ${page.apply}`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const page = await loadPage(handle).catch(() => undefined);
  if (page === undefined) {
    return { title: "Not found | ade" };
  }
  const title = `@${page.handle} on ade`;
  const description = summary(page);
  const image = {
    url: cardPath(page),
    width: 1200,
    height: 630,
    alt: `${page.displayName || `@${page.handle}`} on ade: ${description}`,
    type: "image/png",
  };
  return {
    title,
    description,
    alternates: { canonical: `/${page.handle}` },
    openGraph: {
      title,
      description,
      type: "profile",
      url: `/${page.handle}`,
      siteName: "ade",
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

async function loadVotes(handle: string): Promise<VoteTally | undefined> {
  try {
    const response = await fetch(`${API_ORIGIN}/v1/people/${handle}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { readonly person?: { readonly votes?: VoteTally } };
    return body.person?.votes;
  } catch {
    return undefined;
  }
}

export default async function HandlePage({ params }: Params) {
  const { handle } = await params;
  const page = await loadPage(handle);
  if (page === undefined) {
    notFound();
  }
  const votes = await loadVotes(page.handle);
  return (
    <>
      <Header />
      <main>
        <ProfilePage page={page} votes={votes} />
      </main>
      <Footer />
    </>
  );
}
