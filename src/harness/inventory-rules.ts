export const RUNTIME_NAMES: readonly string[] = [
  ".DS_Store",
  ".git",
  "*.log",
  "*.bak",
  "*.bak-*",
  "*.bak.*",
  "*.backup",
  "*.orig",
  "*.tmp",
  "*~",
  "cache",
  "caches",
  "history",
  "history.jsonl",
  "log",
  "logs",
  "node_modules",
  "runs",
  "session",
  "sessions",
  "temp",
  "tmp",
  "*[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*",
];

export const CREDENTIAL_NAMES: readonly string[] = [
  ".env",
  ".env.*",
  "*.env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "id_rsa*",
  "id_ecdsa*",
  "id_ed25519*",
  "*credential*",
  "*secret*",
  "*token*",
  "*auth*.json",
  "oauth*",
  "Cookies*",
  "Local State",
];

function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] as string;
    if (char === "*") {
      source += "[^/]*";
    } else if (char === "[") {
      const end = glob.indexOf("]", index);
      if (end === -1) {
        source += "\\[";
      } else {
        source += glob.slice(index, end + 1);
        index = end;
      }
    } else {
      source += char.replace(/[.+?^${}()|\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "i");
}

const cache = new Map<string, RegExp>();

export function matchesGlob(relative: string, glob: string): boolean {
  let pattern = cache.get(glob);
  if (pattern === undefined) {
    pattern = globToRegExp(glob);
    cache.set(glob, pattern);
  }
  if (glob.includes("/")) {
    return pattern.test(relative);
  }
  const name = relative.split("/").pop() ?? relative;
  return pattern.test(name);
}

export function matchesAny(relative: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(relative, glob));
}

export const SECRET_FILE_NAMES: readonly string[] = [
  ".env",
  ".env.*",
  "*.env",
  ".netrc",
  ".pgpass",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "*.jks",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credentials",
  "credentials.json",
  "*-credentials.json",
  "*_credentials.json",
  "service-account*.json",
];

const NOT_SECRET_NAMES: readonly string[] = [
  "*.example",
  "*.sample",
  "*.template",
  "*.dist",
  "*.pub",
];

export function isSecretFileName(name: string): boolean {
  return matchesAny(name, SECRET_FILE_NAMES) && !matchesAny(name, NOT_SECRET_NAMES);
}
