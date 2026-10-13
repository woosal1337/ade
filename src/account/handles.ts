export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "about",
  "account",
  "accounts",
  "ade",
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "blog",
  "callback",
  "dashboard",
  "device",
  "directory",
  "doc",
  "docs",
  "download",
  "explore",
  "favicon",
  "help",
  "home",
  "images",
  "img",
  "index",
  "install",
  "legal",
  "login",
  "logout",
  "mail",
  "me",
  "new",
  "null",
  "org",
  "orgs",
  "people",
  "person",
  "pricing",
  "privacy",
  "private",
  "public",
  "robots",
  "root",
  "search",
  "security",
  "settings",
  "signin",
  "signout",
  "signup",
  "sitemap",
  "static",
  "status",
  "support",
  "system",
  "team",
  "teams",
  "terms",
  "u",
  "undefined",
  "user",
  "users",
  "vote",
  "votes",
  "www",
]);

export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

export function handleProblem(value: string): string | undefined {
  if (!HANDLE_PATTERN.test(value)) {
    return "Use 1 to 39 lowercase letters, digits, and hyphens. Start and end with a letter or a digit.";
  }
  if (RESERVED_HANDLES.has(value)) {
    return `The name ${value} is reserved for the site.`;
  }
  return undefined;
}

export function isHandle(value: string): boolean {
  return handleProblem(value) === undefined;
}

export function handleCandidates(hints: readonly (string | undefined)[]): string[] {
  const candidates: string[] = [];
  for (const hint of hints) {
    if (hint === undefined) {
      continue;
    }
    const cleaned = hint
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 39)
      .replace(/-+$/g, "");
    if (cleaned !== "" && isHandle(cleaned) && !candidates.includes(cleaned)) {
      candidates.push(cleaned);
    }
  }
  return candidates;
}
