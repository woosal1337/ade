import path from "node:path";
import { handleProblem, normalizeHandle } from "../account/handles.ts";
import { AdeError } from "../core/errors.ts";
import { isSafeRelative } from "../core/fsx.ts";

export type ProfileSpec =
  | {
      readonly kind: "local";
      readonly dir: string;
      readonly display: string;
      readonly canonical: string;
    }
  | {
      readonly kind: "git";
      readonly url: string;
      readonly ref: string | undefined;
      readonly subdir: string | undefined;
      readonly display: string;
      readonly canonical: string;
    }
  | {
      readonly kind: "web";
      readonly handle: string;
      readonly display: string;
      readonly canonical: string;
    };

export interface SpecContext {
  readonly cwd: string;
  readonly home: string;
  readonly exists: (target: string) => boolean;
  readonly siteUrl?: string;
}

const DEFAULT_SITE_URL = "https://ade.chele.bi";

function webHandle(value: string, site: string): string | undefined {
  let name: string | undefined;
  if (value.startsWith("@")) {
    name = value.slice(1);
  } else {
    const host = new URL(site).host;
    const match = /^(?:https?:\/\/)?([^/\s]+)\/([^/\s?#]+)\/?$/.exec(value);
    if (match?.[1]?.toLowerCase() === host.toLowerCase()) {
      name = match[2];
    }
  }
  if (name === undefined) {
    return undefined;
  }
  const handle = normalizeHandle(name);
  const problem = handleProblem(handle);
  if (problem !== undefined) {
    throw new AdeError("usage", `The ade name in ${value} is not valid.`, { hint: problem });
  }
  return handle;
}

const GITHUB_SHORTHAND =
  /^(?<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/(?<repo>[A-Za-z0-9._-]+)(?:\/(?<subdir>[^@]+))?(?:@(?<ref>[^@\s]+))?$/;
const URL_SCHEME = /^(?:git\+)?(?:https?|ssh|git|file):\/\//;
const SCP_FORM = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/;
const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function cleanSubdir(subdir: string | undefined, input: string): string | undefined {
  if (subdir === undefined || subdir === "") {
    return undefined;
  }
  const trimmed = subdir.replace(/^\/+|\/+$/g, "");
  if (trimmed === "" || !isSafeRelative(trimmed)) {
    throw new AdeError("usage", `The profile subdirectory is not valid: ${input}.`);
  }
  return trimmed;
}

function githubSpec(
  owner: string,
  repo: string,
  subdir: string | undefined,
  ref: string | undefined,
  input: string,
): ProfileSpec {
  const name = repo.endsWith(".git") ? repo.slice(0, -4) : repo;
  const cleaned = cleanSubdir(subdir, input);
  const display = `${owner}/${name}${cleaned === undefined ? "" : `/${cleaned}`}${ref === undefined ? "" : `@${ref}`}`;
  return {
    kind: "git",
    url: `https://github.com/${owner}/${name}.git`,
    ref,
    subdir: cleaned,
    display,
    canonical: `github:${display}`,
  };
}

function urlSpec(input: string): ProfileSpec {
  let rest = input.startsWith("git+") ? input.slice(4) : input;
  let ref: string | undefined;
  const hash = rest.lastIndexOf("#");
  if (hash !== -1) {
    ref = rest.slice(hash + 1) || undefined;
    rest = rest.slice(0, hash);
  }
  const schemeEnd = rest.indexOf("://");
  const searchFrom = schemeEnd === -1 ? 0 : schemeEnd + 3;
  const split = rest.indexOf("//", searchFrom);
  const url = split === -1 ? rest : rest.slice(0, split);
  const subdir = cleanSubdir(split === -1 ? undefined : rest.slice(split + 2), input);
  if (url === "") {
    throw new AdeError("usage", `The profile URL is empty: ${input}.`);
  }
  const display = `${url}${subdir === undefined ? "" : `//${subdir}`}${ref === undefined ? "" : `#${ref}`}`;
  return { kind: "git", url, ref, subdir, display, canonical: display };
}

export function parseProfileSpec(input: string, context: SpecContext): ProfileSpec {
  const value = input.trim();
  if (value === "") {
    throw new AdeError("usage", "The profile source is empty.");
  }
  const site = (context.siteUrl ?? DEFAULT_SITE_URL).replace(/\/+$/, "");
  const handle = webHandle(value, site);
  if (handle !== undefined) {
    if (value.startsWith("@") && context.exists(path.resolve(context.cwd, value))) {
      throw new AdeError("usage", `The source ${value} names a local path and an ade page.`, {
        hint: `Use ./${value} for the local path, or ${site}/${handle} for the ade page.`,
      });
    }
    return { kind: "web", handle, display: `@${handle}`, canonical: `${site}/${handle}` };
  }
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    const dir = path.join(context.home, value.slice(2));
    return { kind: "local", dir, display: dir, canonical: dir };
  }
  if (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    path.isAbsolute(value) ||
    WINDOWS_PATH.test(value)
  ) {
    const dir = path.resolve(context.cwd, value);
    return { kind: "local", dir, display: dir, canonical: dir };
  }
  if (value.startsWith("github:")) {
    const match = GITHUB_SHORTHAND.exec(value.slice("github:".length));
    if (match?.groups?.owner === undefined || match.groups.repo === undefined) {
      throw new AdeError("usage", `The GitHub source is not valid: ${value}.`, {
        hint: "Use github:<owner>/<repo>, with an optional /<subdir> and @<ref>.",
      });
    }
    return githubSpec(
      match.groups.owner,
      match.groups.repo,
      match.groups.subdir,
      match.groups.ref,
      value,
    );
  }
  if (URL_SCHEME.test(value) || SCP_FORM.test(value)) {
    return urlSpec(value);
  }
  const local = path.resolve(context.cwd, value);
  const match = GITHUB_SHORTHAND.exec(value);
  const shorthand = match?.groups?.owner !== undefined && match.groups.repo !== undefined;
  if (context.exists(local)) {
    if (shorthand) {
      throw new AdeError(
        "usage",
        `The source ${value} names a local path and a GitHub repository.`,
        { hint: `Use ./${value} for the local path, or github:${value} for the repository.` },
      );
    }
    return { kind: "local", dir: local, display: local, canonical: local };
  }
  if (match?.groups?.owner !== undefined && match.groups.repo !== undefined) {
    return githubSpec(
      match.groups.owner,
      match.groups.repo,
      match.groups.subdir,
      match.groups.ref,
      value,
    );
  }
  return { kind: "local", dir: local, display: local, canonical: local };
}

export function specKey(spec: ProfileSpec): string {
  if (spec.kind === "local") {
    return spec.dir;
  }
  if (spec.kind === "web") {
    return spec.canonical;
  }
  return `${spec.url}#${spec.ref ?? "HEAD"}#${spec.subdir ?? ""}`;
}
