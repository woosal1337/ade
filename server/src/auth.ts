import {
  AuthenticationException,
  type AuthenticationResponse,
  GenericServerException,
  NotFoundException,
  RateLimitExceededException,
  WorkOS,
} from "@workos-inc/node";
import { createRemoteJWKSet, decodeJwt, type JWTVerifyGetKey, jwtVerify } from "jose";

export interface Identity {
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly githubLogin?: string | undefined;
  readonly githubId?: string | undefined;
  readonly handleHints: readonly (string | undefined)[];
}

export interface ClientConfig {
  readonly clientId: string;
  readonly deviceAuthorizationUrl: string;
  readonly tokenUrl: string;
}

export interface WebSession {
  readonly userId: string;
  readonly sealed?: string;
}

export type LoginResult =
  | { readonly kind: "done"; readonly userId: string; readonly sealed: string }
  | { readonly kind: "verify"; readonly token: string; readonly email: string };

export type LoginCodeReason = "invalid-code" | "expired" | "too-many";

export class LoginCodeError extends Error {
  readonly reason: LoginCodeReason;

  constructor(reason: LoginCodeReason) {
    super(`The email code failed: ${reason}.`);
    this.reason = reason;
  }
}

export class LoginStepError extends Error {
  readonly step: string;

  constructor(step: string) {
    super(`WorkOS asked for the login step ${step}.`);
    this.step = step;
  }
}

export interface AuthProvider {
  readonly configured: boolean;
  clientConfig(): ClientConfig | undefined;
  loginUrl(state: string, redirectUri: string): string;
  completeLogin(code: string): Promise<LoginResult>;
  verifyEmail(token: string, code: string): Promise<LoginResult>;
  readSession(sealed: string): Promise<WebSession | undefined>;
  logout(sealed: string): Promise<void>;
  verifyBearer(token: string): Promise<string | undefined>;
  identity(userId: string): Promise<Identity>;
  userExists(userId: string): Promise<boolean>;
}

export class AuthNotConfiguredError extends Error {}

export const notConfiguredAuth: AuthProvider = {
  configured: false,
  clientConfig: () => undefined,
  loginUrl() {
    throw new AuthNotConfiguredError("WorkOS is not configured.");
  },
  async completeLogin() {
    throw new AuthNotConfiguredError("WorkOS is not configured.");
  },
  async verifyEmail() {
    throw new AuthNotConfiguredError("WorkOS is not configured.");
  },
  readSession: async () => undefined,
  logout: async () => undefined,
  verifyBearer: async () => undefined,
  async identity() {
    throw new AuthNotConfiguredError("WorkOS is not configured.");
  },
  async userExists() {
    throw new AuthNotConfiguredError("WorkOS is not configured.");
  },
};

export interface WorkosOptions {
  readonly apiKey: string;
  readonly clientId: string;
  readonly cookiePassword: string;
  readonly apiUrl?: string | undefined;
  readonly jwksUrl?: string | undefined;
  readonly githubApi?: string | undefined;
}

export class AuthUnavailableError extends Error {}

function hostOptions(apiUrl: string | undefined) {
  if (apiUrl === undefined) {
    return {};
  }
  const url = new URL(apiUrl);
  return {
    apiHostname: url.hostname,
    https: url.protocol === "https:",
    ...(url.port === "" ? {} : { port: Number(url.port) }),
  };
}

interface WorkosUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly profilePictureUrl: string | null;
}

const USER_ID = /^user_[A-Za-z0-9]+$/;
const FOREIGN_KEY_CODES = new Set(["ERR_JWKS_NO_MATCHING_KEY", "ERR_JWKS_MULTIPLE_MATCHING_KEYS"]);
const KEY_FETCH_CODES = new Set(["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID"]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function httpsUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

async function githubLogin(api: string, githubId: string): Promise<string | undefined> {
  if (!/^\d+$/.test(githubId)) {
    return undefined;
  }
  try {
    const response = await fetch(`${api}/user/${githubId}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "ade-api" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { login?: unknown };
    return typeof body.login === "string" ? body.login : undefined;
  } catch {
    return undefined;
  }
}

export function workosAuth(options: WorkosOptions): AuthProvider {
  const workos = new WorkOS(options.apiKey, {
    clientId: options.clientId,
    ...hostOptions(options.apiUrl),
  });
  const users = workos.userManagement;
  const apiBase = workos.baseURL.replace(/\/+$/, "");
  const jwks: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(options.jwksUrl ?? users.getJwksUrl(options.clientId)),
  );
  const githubApi = options.githubApi ?? "https://api.github.com";
  const sealing = { sealSession: true, cookiePassword: options.cookiePassword };

  const finish = async (
    attempt: () => Promise<AuthenticationResponse>,
    selected = false,
  ): Promise<LoginResult> => {
    try {
      const response = await attempt();
      if (response.sealedSession === undefined) {
        throw new Error("WorkOS returned no session.");
      }
      return { kind: "done", userId: response.user.id, sealed: response.sealedSession };
    } catch (error) {
      if (
        !(error instanceof AuthenticationException) ||
        error.pendingAuthenticationToken === undefined
      ) {
        throw error;
      }
      const token = error.pendingAuthenticationToken;
      if (error.code === "email_verification_required") {
        const email = error.rawData.email;
        return { kind: "verify", token, email: typeof email === "string" ? email : "" };
      }
      const organization = error.rawData.organizations?.[0];
      if (
        error.code === "organization_selection_required" &&
        organization !== undefined &&
        !selected
      ) {
        return finish(
          () =>
            users.authenticateWithOrganizationSelection({
              clientId: options.clientId,
              organizationId: organization.id,
              pendingAuthenticationToken: token,
              session: sealing,
            }),
          true,
        );
      }
      throw new LoginStepError(error.code);
    }
  };

  const toIdentity = async (user: WorkosUser): Promise<Identity> => {
    let login: string | undefined;
    let githubId: string | undefined;
    try {
      const identities = await users.getUserIdentities(user.id);
      const github = identities.find((item) => item.provider === "GitHubOAuth");
      if (github !== undefined) {
        githubId = /^\d+$/.test(github.idpId) ? github.idpId : undefined;
        login = await githubLogin(githubApi, github.idpId);
      }
    } catch {
      login = undefined;
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    const local = user.email.split("@")[0];
    return {
      id: user.id,
      displayName: name || login || local || "",
      avatarUrl: httpsUrl(user.profilePictureUrl),
      githubLogin: login,
      githubId,
      handleHints: [login, user.firstName ?? undefined, local],
    };
  };

  return {
    configured: true,
    clientConfig: () => ({
      clientId: options.clientId,
      deviceAuthorizationUrl: `${apiBase}/user_management/authorize/device`,
      tokenUrl: `${apiBase}/user_management/authenticate`,
    }),
    loginUrl(state, redirectUri) {
      return users.getAuthorizationUrl({
        provider: "GitHubOAuth",
        clientId: options.clientId,
        redirectUri,
        state,
      });
    },
    completeLogin(code) {
      return finish(() =>
        users.authenticateWithCode({ clientId: options.clientId, code, session: sealing }),
      );
    },
    async verifyEmail(token, code) {
      try {
        return await finish(() =>
          users.authenticateWithEmailVerification({
            clientId: options.clientId,
            code,
            pendingAuthenticationToken: token,
            session: sealing,
          }),
        );
      } catch (error) {
        if (error instanceof RateLimitExceededException) {
          throw new LoginCodeError("too-many");
        }
        if (
          error instanceof GenericServerException &&
          !(error instanceof AuthenticationException) &&
          error.status === 400
        ) {
          throw new LoginCodeError(
            error.code === "invalid_one_time_code" ? "invalid-code" : "expired",
          );
        }
        throw error;
      }
    },
    async readSession(sealed) {
      const session = users.loadSealedSession({
        sessionData: sealed,
        cookiePassword: options.cookiePassword,
      });
      let result: Awaited<ReturnType<typeof session.authenticate>>;
      try {
        result = await session.authenticate();
      } catch (error) {
        const code = errorCode(error);
        if (code !== undefined && FOREIGN_KEY_CODES.has(code)) {
          return undefined;
        }
        if (code !== undefined && KEY_FETCH_CODES.has(code)) {
          throw new AuthUnavailableError("WorkOS did not give its signing keys.");
        }
        throw error;
      }
      if (result.authenticated) {
        return { userId: result.user.id };
      }
      if (result.reason !== "invalid_jwt") {
        return undefined;
      }
      const refreshed = await session.refresh({ cookiePassword: options.cookiePassword });
      if (!refreshed.authenticated) {
        if (refreshed.retryable) {
          throw new AuthUnavailableError("WorkOS could not refresh the session.");
        }
        return undefined;
      }
      if (refreshed.sealedSession === undefined) {
        return undefined;
      }
      return { userId: refreshed.user.id, sealed: refreshed.sealedSession };
    },
    async logout(sealed) {
      let sessionId: unknown;
      try {
        const session = await users.getSessionFromCookie({
          sessionData: sealed,
          cookiePassword: options.cookiePassword,
        });
        sessionId = session === undefined ? undefined : decodeJwt(session.accessToken).sid;
      } catch {
        return;
      }
      if (typeof sessionId === "string") {
        await users.revokeSession({ sessionId }).catch(() => undefined);
      }
    },
    async verifyBearer(token) {
      try {
        const { payload } = await jwtVerify(token, jwks);
        return typeof payload.sub === "string" && USER_ID.test(payload.sub)
          ? payload.sub
          : undefined;
      } catch {
        return undefined;
      }
    },
    async identity(userId) {
      return toIdentity(await users.getUser(userId));
    },
    async userExists(userId) {
      try {
        await users.getUser(userId);
        return true;
      } catch (error) {
        if (error instanceof NotFoundException) {
          return false;
        }
        throw error;
      }
    },
  };
}
