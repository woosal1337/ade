import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "../core/context.ts";
import { AdeError, errnoCode, errorMessage } from "../core/errors.ts";
import { atomicWrite, ensureDir } from "../core/fsx.ts";
import { printable } from "../core/text.ts";
import { VERSION } from "../version.ts";
import { isHandle, normalizeHandle } from "./handles.ts";

export const DEFAULT_API_URL = "https://api.ade.chele.bi";
export const DEFAULT_SITE_URL = "https://ade.chele.bi";

const CREDENTIALS_FILE = "account.json";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MARKDOWN_BYTES = 16 * 1024 * 1024;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface AuthConfig {
  readonly clientId: string;
  readonly deviceAuthorizationUrl: string;
  readonly tokenUrl: string;
}

export interface Credentials {
  readonly version: 1;
  readonly apiUrl: string;
  readonly clientId: string;
  readonly tokenUrl: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface AccountInfo {
  readonly handle: string;
  readonly displayName: string;
  readonly page: string;
}

export interface DeviceCode {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly expiresIn: number;
}

export interface PushResult {
  readonly digest: string;
  readonly unchanged: boolean;
  readonly items: number;
  readonly public: number;
  readonly changed: number;
  readonly hidden: number;
  readonly page: string;
  readonly dashboard: string;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function webUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AdeError("usage", `${name} is not a valid URL: ${value}.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AdeError("usage", `${name} must use https: ${value}.`);
  }
  return trimSlash(url.toString());
}

export function apiUrl(ctx: Context): string {
  return webUrl(ctx.env.ADE_API_URL ?? DEFAULT_API_URL, "ADE_API_URL");
}

export function siteUrl(ctx: Context): string {
  return webUrl(ctx.env.ADE_SITE_URL ?? DEFAULT_SITE_URL, "ADE_SITE_URL");
}

function credentialsFile(ctx: Context): string {
  return path.join(ctx.stateDir, CREDENTIALS_FILE);
}

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    ["apiUrl", "clientId", "tokenUrl", "accessToken", "refreshToken"].every(
      (key) => typeof record[key] === "string",
    )
  );
}

export async function readCredentials(ctx: Context): Promise<Credentials | undefined> {
  let text: string;
  try {
    text = await fs.readFile(credentialsFile(ctx), "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isCredentials(parsed) && parsed.apiUrl === apiUrl(ctx) ? parsed : undefined;
}

async function writeCredentials(ctx: Context, credentials: Credentials): Promise<void> {
  await ensureDir(ctx.stateDir, 0o700);
  await atomicWrite(credentialsFile(ctx), `${JSON.stringify(credentials, null, 2)}\n`, 0o600);
}

export async function removeCredentials(ctx: Context): Promise<boolean> {
  try {
    await fs.rm(credentialsFile(ctx));
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function send(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { "user-agent": `ade/${VERSION}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    throw new AdeError("api-failed", `ade could not reach ${what}.`, {
      details: [errorMessage(error)],
      hint: "Check the network connection, then run the command again.",
      cause: error,
    });
  }
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function apiError(response: Response, what: string): Promise<AdeError> {
  const body = await bodyOf(response);
  const error = (body.error ?? {}) as Record<string, unknown>;
  const message =
    typeof error.message === "string"
      ? printable(error.message)
      : `${what} failed with HTTP ${response.status}.`;
  const details = Array.isArray(error.details)
    ? error.details
        .filter((item): item is string => typeof item === "string")
        .map((item) => printable(item))
    : [];
  if (response.status === 401) {
    return new AdeError("auth-required", message, { hint: "Run `ade login`." });
  }
  if (response.status === 404) {
    return new AdeError("not-found", message, { details });
  }
  return new AdeError("api-failed", message, { details });
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(values),
  };
}

export async function authConfig(ctx: Context): Promise<AuthConfig> {
  const base = apiUrl(ctx);
  const response = await send(
    `${base}/v1/auth/config`,
    { headers: { accept: "application/json" } },
    base,
  );
  if (!response.ok) {
    throw await apiError(response, "The login setup request");
  }
  const body = await bodyOf(response);
  if (
    typeof body.clientId !== "string" ||
    typeof body.deviceAuthorizationUrl !== "string" ||
    typeof body.tokenUrl !== "string"
  ) {
    throw new AdeError("api-failed", `${base} sent a login setup that ade cannot read.`);
  }
  return {
    clientId: body.clientId,
    deviceAuthorizationUrl: webUrl(body.deviceAuthorizationUrl, "The device URL"),
    tokenUrl: webUrl(body.tokenUrl, "The token URL"),
  };
}

export interface LoginOptions {
  readonly onCode: (code: DeviceCode) => void;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function tokensOf(body: Record<string, unknown>): { access: string; refresh: string } {
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") {
    throw new AdeError(
      "api-failed",
      "The login service sent a token response that ade cannot read.",
    );
  }
  return { access: body.access_token, refresh: body.refresh_token };
}

export async function login(ctx: Context, options: LoginOptions): Promise<AccountInfo> {
  const config = await authConfig(ctx);
  const sleep = options.sleep ?? defaultSleep;
  const started = await send(
    config.deviceAuthorizationUrl,
    form({ client_id: config.clientId }),
    "the login service",
  );
  const device = await bodyOf(started);
  if (
    !started.ok ||
    typeof device.device_code !== "string" ||
    typeof device.user_code !== "string" ||
    typeof device.verification_uri !== "string"
  ) {
    throw new AdeError("api-failed", "The login service did not start the device login.");
  }
  const expiresIn = typeof device.expires_in === "number" ? device.expires_in : 300;
  let interval = typeof device.interval === "number" ? device.interval : 5;
  options.onCode({
    userCode: printable(device.user_code),
    verificationUri: printable(device.verification_uri),
    verificationUriComplete: printable(
      typeof device.verification_uri_complete === "string"
        ? device.verification_uri_complete
        : device.verification_uri,
    ),
    expiresIn,
  });
  const deadline = Date.now() + expiresIn * 1000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new AdeError("auth-required", "The login code expired before the confirmation.", {
        hint: "Run `ade login` again.",
      });
    }
    const response = await send(
      config.tokenUrl,
      form({
        grant_type: DEVICE_GRANT,
        device_code: device.device_code,
        client_id: config.clientId,
      }),
      "the login service",
    );
    const body = await bodyOf(response);
    if (response.ok) {
      const tokens = tokensOf(body);
      await writeCredentials(ctx, {
        version: 1,
        apiUrl: apiUrl(ctx),
        clientId: config.clientId,
        tokenUrl: config.tokenUrl,
        accessToken: tokens.access,
        refreshToken: tokens.refresh,
      });
      return whoami(ctx);
    }
    if (body.error === "authorization_pending") {
      await sleep(interval * 1000);
      continue;
    }
    if (body.error === "slow_down") {
      interval += 1;
      await sleep(interval * 1000);
      continue;
    }
    throw new AdeError(
      "auth-required",
      body.error === "access_denied" ? "The login was denied." : "The login did not finish.",
      { hint: "Run `ade login` again." },
    );
  }
}

function expiresSoon(token: string): boolean {
  const payload = token.split(".")[1];
  if (payload === undefined) {
    return true;
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof claims.exp !== "number" || claims.exp * 1000 - Date.now() < 60_000;
  } catch {
    return true;
  }
}

async function refresh(ctx: Context, credentials: Credentials): Promise<Credentials> {
  const response = await send(
    credentials.tokenUrl,
    form({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
    }),
    "the login service",
  );
  if (!response.ok) {
    throw new AdeError("auth-required", "The login ended.", { hint: "Run `ade login` again." });
  }
  const tokens = tokensOf(await bodyOf(response));
  const next: Credentials = {
    ...credentials,
    accessToken: tokens.access,
    refreshToken: tokens.refresh,
  };
  await writeCredentials(ctx, next);
  return next;
}

async function signedRequest(
  ctx: Context,
  method: string,
  route: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  let credentials = await readCredentials(ctx);
  if (credentials === undefined) {
    throw new AdeError("auth-required", "You are not logged in.", { hint: "Run `ade login`." });
  }
  if (expiresSoon(credentials.accessToken)) {
    credentials = await refresh(ctx, credentials);
  }
  const call = (current: Credentials) =>
    send(
      `${current.apiUrl}${route}`,
      {
        method,
        headers: {
          authorization: `Bearer ${current.accessToken}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      current.apiUrl,
    );
  let response = await call(credentials);
  if (response.status === 401) {
    credentials = await refresh(ctx, credentials);
    response = await call(credentials);
  }
  if (!response.ok) {
    throw await apiError(response, `${method} ${route}`);
  }
  return bodyOf(response);
}

function accountOf(body: Record<string, unknown>): AccountInfo {
  const account = (body.account ?? {}) as Record<string, unknown>;
  if (typeof account.handle !== "string" || typeof account.page !== "string") {
    throw new AdeError("api-failed", "The ade API sent an account that ade cannot read.");
  }
  return {
    handle: printable(account.handle),
    displayName: typeof account.displayName === "string" ? printable(account.displayName) : "",
    page: printable(account.page),
  };
}

export async function whoami(ctx: Context): Promise<AccountInfo> {
  return accountOf(await signedRequest(ctx, "GET", "/v1/me"));
}

export async function pushBundle(ctx: Context, bundle: unknown): Promise<PushResult> {
  const body = await signedRequest(ctx, "POST", "/v1/me/snapshots", {
    bundle,
    client: { version: VERSION },
  });
  const count = (key: string): number =>
    typeof body[key] === "number" ? (body[key] as number) : 0;
  return {
    digest: typeof body.digest === "string" ? body.digest : "",
    unchanged: body.unchanged === true,
    items: count("items"),
    public: count("public"),
    changed: count("changed"),
    hidden: count("hidden"),
    page: typeof body.page === "string" ? printable(body.page) : "",
    dashboard: typeof body.dashboard === "string" ? printable(body.dashboard) : "",
  };
}

export function publicMarkdownUrl(ctx: Context, handle: string): string {
  return `${apiUrl(ctx)}/v1/users/${encodeURIComponent(handle)}/ADE.md`;
}

export async function fetchPublicMarkdown(ctx: Context, handle: string): Promise<string> {
  const name = normalizeHandle(handle);
  if (!isHandle(name)) {
    throw new AdeError("usage", `@${handle} is not a valid ade name.`);
  }
  const url = publicMarkdownUrl(ctx, name);
  const response = await send(url, { headers: { accept: "text/markdown" } }, apiUrl(ctx));
  if (response.status === 404) {
    throw new AdeError("not-found", `@${name} has no ade page, or the page shares no items yet.`, {
      hint: `Open ${siteUrl(ctx)}/${name} to check the name.`,
    });
  }
  if (!response.ok) {
    throw await apiError(response, `The download of @${name}`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_MARKDOWN_BYTES) {
    throw new AdeError("api-failed", `The setup of @${name} is larger than 16 MB.`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_MARKDOWN_BYTES) {
    throw new AdeError("api-failed", `The setup of @${name} is larger than 16 MB.`);
  }
  return text;
}
