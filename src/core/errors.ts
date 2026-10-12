export const ERROR_CODES = [
  "usage",
  "profile-not-found",
  "profile-invalid",
  "profile-exists",
  "secret-undeclared",
  "secret-unresolved",
  "parse-failed",
  "conflict",
  "target-changed",
  "locked",
  "path-outside-root",
  "git-failed",
  "not-found",
  "unsupported",
  "revert-blocked",
  "bundle-invalid",
  "remote-failed",
  "untrusted",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

export interface AdeErrorOptions {
  hint?: string;
  details?: readonly string[];
  cause?: unknown;
}

export class AdeError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly details: readonly string[];

  constructor(code: ErrorCode, message: string, options: AdeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AdeError";
    this.code = code;
    this.hint = options.hint;
    this.details = options.details ?? [];
  }
}

export function isAdeError(value: unknown): value is AdeError {
  return value instanceof AdeError;
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

export function errnoCode(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "code" in value) {
    const code = (value as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
