import type { Metadata } from "next";
import { Header } from "../_components/Header";
import { Footer } from "../_components/sections";
import type { PeoplePage } from "../people-query";
import { API_ORIGIN, SOCIAL_IMAGE } from "../site";
import { PeopleDirectory } from "./PeopleDirectory";

const TITLE = "People | ade";
const DESCRIPTION =
  "Agent setups that people share on ade: skills, MCP servers, and plugins. Search, filter, vote, and apply one with ade apply @name.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/people" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "/people",
    siteName: "ade",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

interface Props {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadPeople(
  params: Record<string, string | string[] | undefined>,
): Promise<PeoplePage | null> {
  const search = new URLSearchParams();
  for (const key of ["q", "harness", "has", "sort", "page"]) {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (text !== undefined && text !== "") {
      search.set(key, text.slice(0, 400));
    }
  }
  try {
    const response = await fetch(`${API_ORIGIN}/v1/people?${search.toString()}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as PeoplePage) : null;
  } catch {
    return null;
  }
}

export default async function People({ searchParams }: Props) {
  const initial = await loadPeople(await searchParams);
  return (
    <>
      <Header />
      <main>
        <PeopleDirectory initial={initial} />
      </main>
      <Footer />
    </>
  );
}
