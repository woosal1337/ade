import { createHash } from "node:crypto";

export const USER_CARD_VERSION = "u1";

const AVATAR_HOSTS = new Set(["workoscdn.com", "avatars.githubusercontent.com", "github.com"]);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TIMEOUT_MS = 3000;
const AVATAR_REDIRECTS = 3;
const MONO_CHAR_WIDTH = 0.6;

export interface CardSource {
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly github: string | null;
  readonly updatedAt: string | null;
  readonly items: readonly { readonly key: string }[];
}

export function cardVersion(source: CardSource): string {
  const keys = source.items.map((item) => item.key).sort();
  return createHash("sha256")
    .update(
      JSON.stringify([
        USER_CARD_VERSION,
        source.handle,
        source.displayName,
        source.avatarUrl,
        source.github,
        source.updatedAt,
        keys,
      ]),
    )
    .digest("hex")
    .slice(0, 12);
}

export function cardPath(source: CardSource): string {
  return `/${source.handle}/og.png?v=${cardVersion(source)}`;
}

export interface FittedTags {
  readonly shown: readonly string[];
  readonly hidden: number;
}

export function fitTags(
  names: readonly string[],
  total: number,
  room: number,
  fontSize: number,
  padding: number,
  gap: number,
): FittedTags {
  const width = (text: string) => text.length * fontSize * MONO_CHAR_WIDTH + padding * 2;
  const shown: string[] = [];
  let used = 0;
  for (const name of names) {
    const rest = total - shown.length - 1;
    const more = rest > 0 ? width(`+${rest} more`) + gap : 0;
    const next = used + (shown.length === 0 ? 0 : gap) + width(name);
    if (next + more > room) {
      break;
    }
    shown.push(name);
    used = next;
  }
  return { shown, hidden: total - shown.length };
}

export function isAvatarHost(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.port === "" && AVATAR_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function imageType(bytes: Uint8Array): "image/png" | "image/jpeg" | undefined {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return undefined;
}

export async function loadAvatar(
  value: string | null,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  if (value === null || !isAvatarHost(value)) {
    return undefined;
  }
  let url = value;
  try {
    for (let hop = 0; hop <= AVATAR_REDIRECTS; hop += 1) {
      const response = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
        headers: { accept: "image/png,image/jpeg" },
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        const target = next === null ? undefined : new URL(next, url).toString();
        if (target === undefined || !isAvatarHost(target)) {
          return undefined;
        }
        url = target;
        continue;
      }
      if (!response.ok) {
        return undefined;
      }
      if (Number(response.headers.get("content-length") ?? "0") > AVATAR_MAX_BYTES) {
        return undefined;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const type = bytes.length > AVATAR_MAX_BYTES ? undefined : imageType(bytes);
      return type === undefined
        ? undefined
        : `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
