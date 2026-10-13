import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { handleProblem, normalizeHandle } from "../../src/account/handles.ts";
import { isAdeError } from "../../src/core/errors.ts";
import { printable } from "../../src/core/text.ts";
import { bundleDigest, isItemKey, profileItems, readBundle } from "../../src/profile/catalog.ts";
import { scanBundle } from "../../src/profile/pack.ts";
import { sharedProblems } from "../../src/profile/source.ts";
import { VERSION } from "../../src/version.ts";
import {
  AuthNotConfiguredError,
  type AuthProvider,
  AuthUnavailableError,
  type Identity,
  LoginCodeError,
  type LoginResult,
  LoginStepError,
} from "./auth.ts";
import type { Db } from "./db.ts";
import {
  harnessFacets,
  listedCount,
  listPeople,
  parsePeopleQuery,
  personByUser,
  refreshDirectory,
  setVote,
  type VoteValue,
} from "./directory.ts";
import { RateLimiter } from "./limits.ts";
import {
  approvals,
  deleteUser,
  ensureUser,
  HandleTakenError,
  insertSnapshot,
  latestSnapshotMeta,
  moveUser,
  renameUser,
  setApprovals,
  snapshotBundle,
  type UserRow,
  updateProfile,
  userByHandle,
  userByWorkos,
  usersByGithubLogin,
} from "./store.ts";
import {
  countStates,
  ownerItems,
  publicItems,
  publicMarkdown,
  type SnapshotView,
  snapshotView,
} from "./views.ts";

export interface AppOptions {
  readonly db: Db;
  readonly auth: AuthProvider;
  readonly siteUrl: string;
  readonly publicApiUrl: string;
  readonly log?: ((line: string) => void) | undefined;
  readonly ip?: ((c: Context) => string | undefined) | undefined;
}

type Variables = {
  readonly account: UserRow;
  readonly mode: "bearer" | "cookie";
};

const SESSION_COOKIE = "ade_session";
const HINT_COOKIE = "ade_hint";
const STATE_COOKIE = "ade_login";
const PENDING_COOKIE = "ade_pending";
const PENDING_MAX_AGE = 600;
const LOGIN_CODE = /^\d{6}$/;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_VISIBILITY_KEYS = 5000;
const DISPLAY_NAME_LIMIT = 80;

function errorBody(code: string, message: string, details: readonly string[] = []) {
  return { error: { code, message, ...(details.length === 0 ? {} : { details }) } };
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeReturnPath(value: string | undefined): string {
  if (
    value === undefined ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/dashboard";
  }
  return /^[A-Za-z0-9/_\-.?=&%]*$/.test(value) ? value : "/dashboard";
}

interface PendingLogin {
  readonly token: string;
  readonly email: string;
  readonly returnTo: string;
}

function encodePending(pending: PendingLogin): string {
  return Buffer.from(JSON.stringify(pending)).toString("base64url");
}

function decodePending(value: string | undefined): PendingLogin | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as PendingLogin).token === "string" &&
      typeof (parsed as PendingLogin).email === "string" &&
      typeof (parsed as PendingLogin).returnTo === "string"
    ) {
      const pending = parsed as PendingLogin;
      return { ...pending, returnTo: safeReturnPath(pending.returnTo) };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) {
    return "your email address";
  }
  const name = email.slice(0, at);
  const visible = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return `${visible}***${email.slice(at)}`;
}

function clientIp(c: Context, fallback: ((c: Context) => string | undefined) | undefined): string {
  const forwarded = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || fallback?.(c) || "unknown";
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createApp(options: AppOptions): Hono<{ Variables: Variables }> {
  const { db, auth } = options;
  const app = new Hono<{ Variables: Variables }>();
  const siteOrigin = new URL(options.siteUrl).origin;
  const secure = new URL(options.publicApiUrl).protocol === "https:";
  const cookiePath = new URL(options.publicApiUrl).pathname.replace(/\/+$/, "") || "/";
  const callbackUrl = `${options.publicApiUrl}/auth/callback`;
  const requests = new RateLimiter(3000, 60_000);
  const logins = new RateLimiter(120, 60_000);
  const owners = new RateLimiter(300, 60_000);
  const uploads = new RateLimiter(30, 60 * 60_000);
  const codeTries = new RateLimiter(5, PENDING_MAX_AGE * 1000);
  const voteLimiter = new RateLimiter(60, 60_000);
  const log = options.log ?? (() => undefined);

  const sessionCookie = (c: Context, value: string): void => {
    setCookie(c, SESSION_COOKIE, value, {
      path: cookiePath,
      httpOnly: true,
      secure,
      sameSite: "Lax",
      maxAge: SESSION_MAX_AGE,
    });
    setCookie(c, HINT_COOKIE, "1", { path: "/", secure, sameSite: "Lax", maxAge: SESSION_MAX_AGE });
  };
  const clearSession = (c: Context): void => {
    deleteCookie(c, SESSION_COOKIE, { path: cookiePath, secure });
    deleteCookie(c, HINT_COOKIE, { path: "/", secure });
  };

  const newAccount = async (identity: Identity): Promise<UserRow> =>
    ensureUser(db, {
      workosUserId: identity.id,
      displayName: identity.displayName.slice(0, DISPLAY_NAME_LIMIT),
      avatarUrl: identity.avatarUrl,
      githubLogin: identity.githubLogin,
      githubId: identity.githubId,
      handleHints: identity.handleHints,
    });
  const movedAccount = async (identity: Identity): Promise<UserRow | undefined> => {
    if (identity.githubLogin === undefined) {
      return undefined;
    }
    for (const row of await usersByGithubLogin(db, identity.githubLogin)) {
      const sameGithub =
        row.github_id === null
          ? identity.githubId !== undefined
          : row.github_id === identity.githubId;
      if (sameGithub && !(await auth.userExists(row.workos_user_id))) {
        log(`moved the account @${row.handle} to a new WorkOS user`);
        return moveUser(db, row.id, identity.id, identity.githubId);
      }
    }
    return undefined;
  };
  const accountFor = async (userId: string): Promise<UserRow> => {
    const existing = await userByWorkos(db, userId);
    if (existing !== undefined) {
      return existing;
    }
    const identity = await auth.identity(userId);
    return (await movedAccount(identity)) ?? (await newAccount(identity));
  };

  app.use("*", async (c, next) => {
    const started = Date.now();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("cache-control", "no-store");
    if (!requests.hit(clientIp(c, options.ip))) {
      return c.json(errorBody("rate-limited", "Too many requests. Try again in a minute."), 429);
    }
    await next();
    log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms`);
    return undefined;
  });

  const requireAccount: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
    const header = c.req.header("authorization");
    if (header !== undefined) {
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      const userId = match?.[1] === undefined ? undefined : await auth.verifyBearer(match[1]);
      if (userId === undefined) {
        return c.json(errorBody("unauthorized", "The access token is not valid."), 401);
      }
      const account = await accountFor(userId);
      if (!owners.hit(account.id)) {
        return c.json(errorBody("rate-limited", "Too many requests. Try again in a minute."), 429);
      }
      c.set("account", account);
      c.set("mode", "bearer");
      await next();
      return undefined;
    }
    const sealed = getCookie(c, SESSION_COOKIE);
    if (sealed === undefined) {
      return c.json(errorBody("unauthorized", "Log in first."), 401);
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      if (origin === undefined || origin !== siteOrigin) {
        return c.json(errorBody("forbidden", "The request did not come from the ade site."), 403);
      }
    }
    const session = await auth.readSession(sealed);
    if (session === undefined) {
      clearSession(c);
      return c.json(errorBody("unauthorized", "The session ended. Log in again."), 401);
    }
    if (session.sealed !== undefined) {
      sessionCookie(c, session.sealed);
    }
    const account = await accountFor(session.userId);
    if (!owners.hit(account.id)) {
      return c.json(errorBody("rate-limited", "Too many requests. Try again in a minute."), 429);
    }
    c.set("account", account);
    c.set("mode", "cookie");
    await next();
    return undefined;
  };

  const viewerOf = async (c: Context): Promise<UserRow | undefined> => {
    try {
      const header = c.req.header("authorization");
      if (header !== undefined) {
        const match = /^Bearer\s+(\S+)$/i.exec(header);
        const userId = match?.[1] === undefined ? undefined : await auth.verifyBearer(match[1]);
        return userId === undefined ? undefined : await userByWorkos(db, userId);
      }
      const sealed = getCookie(c, SESSION_COOKIE);
      if (sealed === undefined) {
        return undefined;
      }
      const session = await auth.readSession(sealed);
      if (session === undefined) {
        clearSession(c);
        return undefined;
      }
      if (session.sealed !== undefined) {
        sessionCookie(c, session.sealed);
      }
      return await userByWorkos(db, session.userId);
    } catch {
      return undefined;
    }
  };

  const refreshListing = async (userId: string): Promise<void> => {
    try {
      await refreshDirectory(db, userId, new Date());
    } catch (error) {
      log(`directory refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const accountBody = (account: UserRow) => ({
    handle: account.handle,
    displayName: account.display_name,
    avatarUrl: account.avatar_url,
    github: account.github_login,
    createdAt: account.created_at,
    page: `${options.siteUrl}/${account.handle}`,
  });

  const currentView = async (
    account: UserRow,
  ): Promise<{ view: SnapshotView; createdAt: Date; digest: string } | undefined> => {
    const snapshot = await latestSnapshotMeta(db, account.id);
    if (snapshot === undefined) {
      return undefined;
    }
    return {
      view: await snapshotView(snapshot.id, Number(snapshot.size_bytes), () =>
        snapshotBundle(db, snapshot.id),
      ),
      createdAt: new Date(snapshot.created_at),
      digest: snapshot.digest,
    };
  };

  app.get("/health", async (c) => {
    await db.query("select 1");
    return c.json({ ok: true, version: VERSION, auth: auth.configured });
  });

  app.get("/v1/auth/config", (c) => {
    const config = auth.clientConfig();
    if (config === undefined) {
      return c.json(
        errorBody("auth-not-configured", "Login is not available on this server yet."),
        503,
      );
    }
    return c.json(config);
  });

  app.get("/auth/login", (c) => {
    if (!logins.hit(clientIp(c, options.ip))) {
      return c.text("Too many login attempts. Try again in a minute.", 429);
    }
    if (!auth.configured) {
      return c.text("Login is not available on this server yet.", 503);
    }
    const state = randomToken();
    const returnTo = safeReturnPath(c.req.query("returnTo"));
    setCookie(c, STATE_COOKIE, `${state}|${returnTo}`, {
      path: cookiePath,
      httpOnly: true,
      secure,
      sameSite: "Lax",
      maxAge: 600,
    });
    return c.redirect(auth.loginUrl(state, callbackUrl), 302);
  });

  const pendingCookie = (c: Context, pending: PendingLogin): void => {
    setCookie(c, PENDING_COOKIE, encodePending(pending), {
      path: cookiePath,
      httpOnly: true,
      secure,
      sameSite: "Lax",
      maxAge: PENDING_MAX_AGE,
    });
  };
  const clearPending = (c: Context): void => {
    deleteCookie(c, PENDING_COOKIE, { path: cookiePath, secure });
  };
  const finishLogin = async (c: Context, result: LoginResult, returnTo: string) => {
    if (result.kind === "verify") {
      pendingCookie(c, { token: result.token, email: result.email, returnTo });
      return `${options.siteUrl}/dashboard?login=verify`;
    }
    await accountFor(result.userId);
    sessionCookie(c, result.sealed);
    clearPending(c);
    return `${options.siteUrl}${returnTo}`;
  };
  const failedLogin = `${options.siteUrl}/dashboard?login=failed`;

  app.get("/auth/callback", async (c) => {
    const stored = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: cookiePath, secure });
    const [expected, returnTo] = stored?.split("|") ?? [];
    const state = c.req.query("state");
    const code = c.req.query("code");
    const providerError = c.req.query("error");
    if (providerError !== undefined) {
      log(`login failed: WorkOS sent the error ${printable(providerError).slice(0, 80)}`);
      return c.redirect(failedLogin, 302);
    }
    if (
      expected === undefined ||
      state === undefined ||
      code === undefined ||
      !sameText(expected, state)
    ) {
      if (decodePending(getCookie(c, PENDING_COOKIE)) !== undefined) {
        return c.redirect(`${options.siteUrl}/dashboard?login=verify`, 302);
      }
      const sealed = getCookie(c, SESSION_COOKIE);
      if (sealed !== undefined && (await auth.readSession(sealed).catch(() => undefined))) {
        return c.redirect(`${options.siteUrl}/dashboard`, 302);
      }
      log("login failed: the callback has no matching state");
      return c.redirect(failedLogin, 302);
    }
    try {
      const result = await auth.completeLogin(code);
      return c.redirect(await finishLogin(c, result, safeReturnPath(returnTo)), 302);
    } catch (error) {
      log(`login failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.redirect(failedLogin, 302);
    }
  });

  app.get("/auth/pending", (c) => {
    const pending = decodePending(getCookie(c, PENDING_COOKIE));
    if (pending === undefined) {
      return c.json(errorBody("not-found", "No login waits for an email code."), 404);
    }
    return c.json({ email: maskEmail(pending.email) });
  });

  app.post("/auth/verify", bodyLimit({ maxSize: 4096 }), async (c) => {
    const origin = c.req.header("origin");
    if (origin === undefined || origin !== siteOrigin) {
      return c.json(errorBody("forbidden", "The request did not come from the ade site."), 403);
    }
    const pending = decodePending(getCookie(c, PENDING_COOKIE));
    if (pending === undefined) {
      return c.json(errorBody("login-expired", "The login expired. Start the login again."), 400);
    }
    const body = await readJson(c);
    const code = isRecord(body) && typeof body.code === "string" ? body.code.trim() : "";
    if (!LOGIN_CODE.test(code)) {
      return c.json(errorBody("code-invalid", "Enter the 6-digit code from the email."), 400);
    }
    if (!codeTries.hit(createHash("sha256").update(pending.token).digest("hex"))) {
      clearPending(c);
      return c.json(
        errorBody("login-expired", "Too many codes for this login. Start the login again."),
        429,
      );
    }
    try {
      const result = await auth.verifyEmail(pending.token, code);
      if (result.kind === "verify") {
        pendingCookie(c, { token: result.token, email: result.email, returnTo: pending.returnTo });
        return c.json(
          errorBody("code-invalid", "WorkOS asked for a new code. Check the email."),
          400,
        );
      }
      const target = await finishLogin(c, result, pending.returnTo);
      return c.json({ redirect: target.slice(options.siteUrl.length) || "/" });
    } catch (error) {
      if (error instanceof LoginCodeError && error.reason === "invalid-code") {
        return c.json(
          errorBody("code-invalid", "The code is not valid. Check the email, then try again."),
          400,
        );
      }
      if (error instanceof LoginCodeError || error instanceof LoginStepError) {
        log(`login failed: ${error.message}`);
        clearPending(c);
        return c.json(errorBody("login-expired", "The login expired. Start the login again."), 400);
      }
      throw error;
    }
  });

  app.post("/auth/logout", async (c) => {
    const origin = c.req.header("origin");
    if (origin === undefined || origin !== siteOrigin) {
      return c.json(errorBody("forbidden", "The request did not come from the ade site."), 403);
    }
    const sealed = getCookie(c, SESSION_COOKIE);
    if (sealed !== undefined) {
      await auth.logout(sealed);
    }
    clearSession(c);
    clearPending(c);
    return c.json({ redirect: `${options.siteUrl}/` });
  });

  app.get("/v1/me", requireAccount, async (c) => {
    const account = c.get("account");
    const current = await currentView(account);
    const approved = await approvals(db, account.id);
    return c.json({
      account: accountBody(account),
      snapshot:
        current === undefined
          ? null
          : {
              digest: current.digest,
              createdAt: current.createdAt,
              items: current.view.items.length,
              ...countStates(current.view.items, approved),
            },
      items: current === undefined ? [] : ownerItems(current.view.items, approved),
    });
  });

  app.patch("/v1/me", requireAccount, bodyLimit({ maxSize: MAX_JSON_BYTES }), async (c) => {
    let account = c.get("account");
    const body = await readJson(c);
    if (!isRecord(body)) {
      return c.json(errorBody("usage", "Send a JSON object."), 400);
    }
    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string" || body.displayName.length > DISPLAY_NAME_LIMIT) {
        return c.json(
          errorBody("usage", `Use a display name of at most ${DISPLAY_NAME_LIMIT} characters.`),
          400,
        );
      }
      account = (await updateProfile(db, account.id, body.displayName.trim())) ?? account;
    }
    if (body.handle !== undefined) {
      if (typeof body.handle !== "string") {
        return c.json(errorBody("usage", "Send the handle as text."), 400);
      }
      const handle = normalizeHandle(body.handle);
      const problem = handleProblem(handle);
      if (problem !== undefined) {
        return c.json(errorBody("handle-invalid", problem), 400);
      }
      if (handle !== account.handle) {
        try {
          account = await renameUser(db, account.id, handle);
        } catch (error) {
          if (error instanceof HandleTakenError) {
            return c.json(errorBody("handle-taken", `The handle ${handle} is taken.`), 409);
          }
          throw error;
        }
      }
    }
    return c.json({ account: accountBody(account) });
  });

  app.delete("/v1/me", requireAccount, async (c) => {
    const account = c.get("account");
    await deleteUser(db, account.id);
    if (c.get("mode") === "cookie") {
      clearSession(c);
    }
    return c.json({ deleted: true });
  });

  app.post(
    "/v1/me/snapshots",
    requireAccount,
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) =>
        c.json(errorBody("too-large", "The profile is larger than the 8 MB upload limit."), 413),
    }),
    async (c) => {
      const account = c.get("account");
      if (!uploads.hit(account.id)) {
        return c.json(errorBody("rate-limited", "Too many uploads. Try again in an hour."), 429);
      }
      const raw = await c.req.text();
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return c.json(errorBody("usage", "Send a JSON object."), 400);
      }
      if (!isRecord(body)) {
        return c.json(errorBody("usage", "Send a JSON object with a bundle."), 400);
      }
      let memory: ReturnType<typeof readBundle>;
      try {
        memory = readBundle(body.bundle);
      } catch (error) {
        if (isAdeError(error)) {
          return c.json(errorBody(error.code, error.message, error.details), 400);
        }
        throw error;
      }
      const problems = sharedProblems({ dir: "", profile: memory.profile, lock: memory.lock });
      if (problems.length > 0) {
        return c.json(
          errorBody(
            "not-self-contained",
            "The profile names local paths. Upload it with `ade push`.",
            problems,
          ),
          400,
        );
      }
      const findings = scanBundle(memory.bundle);
      if (findings.length > 0) {
        return c.json(
          errorBody(
            "secret-values",
            "The profile holds values that look like secrets. ade did not store it.",
            findings.map((finding) => `${finding.file}:${finding.line}: ${finding.kind}`),
          ),
          422,
        );
      }
      const items = profileItems(memory);
      const digest = bundleDigest(memory);
      const previous = await latestSnapshotMeta(db, account.id);
      const client =
        isRecord(body.client) && typeof body.client.version === "string"
          ? body.client.version.slice(0, 32)
          : null;
      const unchanged = previous?.digest === digest;
      if (!unchanged) {
        await insertSnapshot(db, {
          userId: account.id,
          digest,
          bundle: memory.bundle,
          itemCount: items.length,
          sizeBytes: Buffer.byteLength(raw),
          clientVersion: client,
          keys: items.map((item) => item.key),
        });
        await refreshListing(account.id);
      }
      const counts = countStates(items, await approvals(db, account.id));
      return c.json({
        digest,
        unchanged,
        items: items.length,
        ...counts,
        page: `${options.siteUrl}/${account.handle}`,
        dashboard: `${options.siteUrl}/dashboard`,
      });
    },
  );

  app.put(
    "/v1/me/visibility",
    requireAccount,
    bodyLimit({ maxSize: MAX_JSON_BYTES }),
    async (c) => {
      const account = c.get("account");
      const body = await readJson(c);
      if (!isRecord(body) || !isRecord(body.items)) {
        return c.json(errorBody("usage", "Send { items: { <key>: true | false } }."), 400);
      }
      const entries = Object.entries(body.items);
      if (entries.length > MAX_VISIBILITY_KEYS) {
        return c.json(
          errorBody("usage", `Send at most ${MAX_VISIBILITY_KEYS} items at one time.`),
          400,
        );
      }
      const current = await currentView(account);
      const hashes = new Map((current?.view.items ?? []).map((item) => [item.key, item.hash]));
      const changes: { key: string; hash: string | null }[] = [];
      const unknown: string[] = [];
      for (const [key, visible] of entries) {
        const hash = hashes.get(key);
        if (!isItemKey(key) || typeof visible !== "boolean" || hash === undefined) {
          unknown.push(key);
          continue;
        }
        changes.push({ key, hash: visible ? hash : null });
      }
      if (unknown.length > 0) {
        return c.json(
          errorBody(
            "unknown-items",
            "Some items are not in your latest upload.",
            unknown.slice(0, 20),
          ),
          400,
        );
      }
      await setApprovals(db, account.id, changes);
      await refreshListing(account.id);
      const approved = await approvals(db, account.id);
      return c.json({
        ...countStates(current?.view.items ?? [], approved),
        items: current === undefined ? [] : ownerItems(current.view.items, approved),
      });
    },
  );

  const publicAccount = async (c: Context) => {
    const handle = normalizeHandle(c.req.param("handle") ?? "");
    if (handleProblem(handle) !== undefined) {
      return undefined;
    }
    return userByHandle(db, handle);
  };

  app.get("/v1/people", async (c) => {
    const query = parsePeopleQuery(c.req.query());
    const viewer = await viewerOf(c);
    const [page, harnesses, listed] = await Promise.all([
      listPeople(db, query, viewer?.id),
      harnessFacets(db),
      listedCount(db),
    ]);
    return c.json({
      ...page,
      query: { ...query, has: [...query.has] },
      facets: { harnesses, listed },
      viewer: viewer === undefined ? null : viewer.handle,
    });
  });

  app.get("/v1/people/:handle", async (c) => {
    const account = await publicAccount(c);
    const viewer = await viewerOf(c);
    const person =
      account === undefined ? undefined : await personByUser(db, account.id, viewer?.id);
    if (person === undefined) {
      return c.json(errorBody("not-found", "This person shares no items yet."), 404);
    }
    return c.json({ person, viewer: viewer === undefined ? null : viewer.handle });
  });

  app.put("/v1/people/:handle/vote", requireAccount, bodyLimit({ maxSize: 1024 }), async (c) => {
    const voter = c.get("account");
    if (!voteLimiter.hit(voter.id)) {
      return c.json(errorBody("rate-limited", "Too many votes. Try again in a minute."), 429);
    }
    const body = await readJson(c);
    const value = isRecord(body) ? body.value : undefined;
    if (value !== 1 && value !== -1 && value !== 0) {
      return c.json(errorBody("usage", "Send { value: 1 }, { value: -1 }, or { value: 0 }."), 400);
    }
    const target = await publicAccount(c);
    const listed = target === undefined ? undefined : await personByUser(db, target.id, voter.id);
    if (target === undefined || listed === undefined) {
      return c.json(errorBody("not-found", "This person shares no items yet."), 404);
    }
    if (target.id === voter.id) {
      return c.json(errorBody("own-page", "You cannot vote for your own page."), 400);
    }
    await setVote(db, voter.id, target.id, value as VoteValue);
    const person = await personByUser(db, target.id, voter.id);
    return c.json({ votes: person?.votes ?? listed.votes });
  });

  app.get("/v1/users/:handle", async (c) => {
    const account = await publicAccount(c);
    if (account === undefined) {
      return c.json(errorBody("not-found", "No ade page has this name."), 404);
    }
    const current = await currentView(account);
    const approved = await approvals(db, account.id);
    const items = current === undefined ? [] : publicItems(current.view.items, approved);
    return c.json({
      handle: account.handle,
      displayName: account.display_name,
      avatarUrl: account.avatar_url,
      github: account.github_login,
      updatedAt: current?.createdAt ?? null,
      apply: `ade apply @${account.handle}`,
      items,
    });
  });

  app.get("/v1/users/:handle/ADE.md", async (c) => {
    const account = await publicAccount(c);
    const current = account === undefined ? undefined : await currentView(account);
    if (account === undefined || current === undefined) {
      return c.json(errorBody("not-found", "No ade page has this name."), 404);
    }
    const markdown = publicMarkdown(
      current.view,
      await approvals(db, account.id),
      account.handle,
      current.createdAt,
    );
    if (markdown === undefined) {
      return c.json(errorBody("not-found", `@${account.handle} shares no items yet.`), 404);
    }
    c.header("content-type", "text/markdown; charset=utf-8");
    return c.body(markdown);
  });

  app.notFound((c) => c.json(errorBody("not-found", "The path does not exist."), 404));
  app.onError((error, c) => {
    if (error instanceof AuthUnavailableError || error instanceof AuthNotConfiguredError) {
      return c.json(
        errorBody("auth-unavailable", "Login is not available right now. Try again in a minute."),
        503,
      );
    }
    log(
      `error ${c.req.method} ${c.req.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return c.json(errorBody("internal", "The server could not complete the request."), 500);
  });

  return app;
}
