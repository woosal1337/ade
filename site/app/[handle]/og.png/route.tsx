import { HANDLE_PATTERN, type PublicPage } from "../../account";
import { previewPerson } from "../../draft";
import { API_ORIGIN } from "../../site";
import { userSocialImage } from "../../social-image";
import { cardVersion, loadAvatar } from "../../user-card";

interface Context {
  readonly params: Promise<{ readonly handle: string }>;
}

const FRESH = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
const SHORT = "public, max-age=300, s-maxage=600";

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { handle } = await params;
  if (!HANDLE_PATTERN.test(handle)) {
    return new Response("Not found", { status: 404 });
  }
  let page: PublicPage;
  try {
    const response = await fetch(`${API_ORIGIN}/v1/users/${handle}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) {
      return new Response("Not found", { status: 404, headers: { "cache-control": SHORT } });
    }
    if (!response.ok) {
      return new Response("The ade API is not available.", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
    page = (await response.json()) as PublicPage;
  } catch {
    return new Response("The ade API is not available.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const person = previewPerson(
    {
      handle: page.handle,
      displayName: page.displayName,
      avatarUrl: page.avatarUrl,
      github: page.github,
    },
    page.items.map((item) => ({ ...item, state: "public" as const })),
    page.updatedAt ?? new Date(0).toISOString(),
  );
  const asked = new URL(request.url).searchParams.get("v");
  const current = asked !== null && asked === cardVersion(page);
  return userSocialImage(
    {
      handle: page.handle,
      displayName: page.displayName,
      github: page.github,
      avatar: await loadAvatar(page.avatarUrl),
      person,
    },
    { "cache-control": current ? FRESH : SHORT },
  );
}
