import fs from "node:fs/promises";
import path from "node:path";
import { statOrUndefined } from "../core/fsx.ts";

export const TOKEN_PATTERN =
  /(sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,}|crsr_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|cos_pat_[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;

export const SENSITIVE_KEY =
  /(api[-_]?key|token|secret|password|passwd|credential|cookie|authorization|bearer|private[-_]?key|access[-_]?key)/i;

export const SCHEME_PREFIX = /^(Bearer|Basic|Token)\s+(\S.*)$/i;

export interface TokenFinding {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
}

const KINDS: readonly (readonly [RegExp, string])[] = [
  [/^sk-ant-/, "Anthropic key"],
  [/^sk-/, "API key"],
  [/^crsr_/, "Cursor key"],
  [/^(gh[pousr]_|github_pat_)/, "GitHub token"],
  [/^xox/, "Slack token"],
  [/^cos_pat_/, "Elliptic token"],
  [/^AKIA/, "AWS access key"],
  [/^-----BEGIN/, "private key"],
  [/^eyJ/, "JSON web token"],
];

function kindOf(match: string): string {
  return KINDS.find(([pattern]) => pattern.test(match))?.[1] ?? "token";
}

export function findTokens(text: string, file: string): TokenFinding[] {
  const findings: TokenFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const match = TOKEN_PATTERN.exec(line);
    if (match?.[0] !== undefined) {
      findings.push({ file, line: index + 1, kind: kindOf(match[0]) });
    }
  }
  return findings;
}

export async function scanTree(root: string): Promise<TokenFinding[]> {
  const findings: TokenFinding[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const name of (await fs.readdir(dir)).sort()) {
      if (name === ".git") {
        continue;
      }
      const full = path.join(dir, name);
      const stat = await statOrUndefined(full);
      if (stat?.isDirectory()) {
        await walk(full);
      } else if (stat?.isFile() && stat.size <= 4 * 1024 * 1024) {
        const content = await fs.readFile(full);
        if (!content.includes(0)) {
          findings.push(
            ...findTokens(
              content.toString("utf8"),
              path.relative(root, full).split(path.sep).join("/"),
            ),
          );
        }
      }
    }
  };
  await walk(root);
  return findings;
}
