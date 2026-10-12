import { hasControlCharacter } from "./text.ts";

export const FULL_COMMIT = /^[0-9a-f]{40}$/;

const GIT_REF = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\/$)(?!.*\.lock$)(?!.*@\{)[A-Za-z0-9._/+-]+$/;
const REMOTE_HELPER = /^[A-Za-z][A-Za-z0-9+.-]*::/;
const SHARED_URL = /^(?:(?:https|ssh):\/\/[^/]|[A-Za-z0-9._~-]+@[A-Za-z0-9.-]+:(?!\/\/))/i;

export function isGitUrl(url: string): boolean {
  return (
    url.length > 0 && !url.startsWith("-") && !hasControlCharacter(url) && !REMOTE_HELPER.test(url)
  );
}

export function isSharedGitUrl(url: string): boolean {
  return isGitUrl(url) && SHARED_URL.test(url);
}

export function isGitRef(ref: string): boolean {
  return ref === "HEAD" || FULL_COMMIT.test(ref) || GIT_REF.test(ref);
}
