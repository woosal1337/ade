import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export interface FakeUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly githubId: string;
}

interface DeviceGrant {
  readonly userCode: string;
  userId?: string;
  denied?: boolean;
  polls: number;
}

interface Refresh {
  readonly userId: string;
  readonly sessionId: string;
}

export interface FakeWorkos {
  readonly url: string;
  readonly clientId: string;
  readonly users: Map<string, FakeUser>;
  accessTtl: number;
  autoUser: string | undefined;
  approve(userCode: string, userId: string): void;
  deny(userCode: string): void;
  loginAs(userId: string): void;
  revokedSessions(): readonly string[];
  close(): Promise<void>;
}

function token(): string {
  return randomBytes(24).toString("base64url");
}

async function body(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if ((request.headers["content-type"] ?? "").includes("json")) {
    return text === "" ? {} : (JSON.parse(text) as Record<string, string>);
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

function userJson(user: FakeUser) {
  return {
    object: "user",
    id: user.id,
    email: user.email,
    email_verified: true,
    first_name: user.firstName,
    last_name: null,
    profile_picture_url: "https://avatars.example.com/u.png",
    last_sign_in_at: null,
    locale: null,
    external_id: null,
    metadata: {},
    created_at: "2026-10-13T00:00:00.000Z",
    updated_at: "2026-10-13T00:00:00.000Z",
  };
}

export interface FakeWorkosOptions {
  readonly clientId?: string;
  readonly host?: string;
  readonly port?: number;
  readonly publicUrl?: string;
}

export async function startFakeWorkos(options: FakeWorkosOptions = {}): Promise<FakeWorkos> {
  const clientId = options.clientId ?? "client_fake";
  const keys = await generateKeyPair("RS256");
  const kid = `fake-${randomBytes(4).toString("hex")}`;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid, alg: "RS256", use: "sig" };
  const users = new Map<string, FakeUser>();
  const devices = new Map<string, DeviceGrant>();
  const codes = new Map<string, string>();
  const refreshes = new Map<string, Refresh>();
  const revoked: string[] = [];
  let pendingLogin: string | undefined;

  const issue = async (userId: string, sessionId = `session_${token()}`) => {
    const user = users.get(userId);
    if (user === undefined) {
      throw new Error(`unknown user ${userId}`);
    }
    const now = Math.floor(Date.now() / 1000);
    const access = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "RS256", kid })
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(now + fake.accessTtl)
      .sign(keys.privateKey);
    const refresh = token();
    refreshes.set(refresh, { userId, sessionId });
    return {
      user: userJson(user),
      access_token: access,
      refresh_token: refresh,
      authentication_method: "GitHubOAuth",
    };
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://fake");
    const path = url.pathname;
    if (request.method === "GET" && path === `/sso/jwks/${clientId}`) {
      return send(response, 200, { keys: [jwk] });
    }
    if (request.method === "POST" && path === "/user_management/authorize/device") {
      const form = await body(request);
      if (form.client_id !== clientId) {
        return send(response, 400, { error: "invalid_client" });
      }
      const deviceCode = token();
      const userCode = `${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
      devices.set(deviceCode, { userCode, polls: 0 });
      return send(response, 200, {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `${fake.url}/device`,
        verification_uri_complete: `${fake.url}/device?user_code=${userCode}`,
        expires_in: 300,
        interval: 0,
      });
    }
    if (request.method === "POST" && path === "/user_management/authenticate") {
      const form = await body(request);
      if (form.client_id !== clientId) {
        return send(response, 400, { error: "invalid_client" });
      }
      if (form.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
        const grant = devices.get(form.device_code ?? "");
        if (grant === undefined) {
          return send(response, 400, { error: "expired_token" });
        }
        grant.polls += 1;
        if (grant.denied === true) {
          devices.delete(form.device_code ?? "");
          return send(response, 400, { error: "access_denied" });
        }
        if (grant.userId === undefined && fake.autoUser !== undefined && grant.polls > 1) {
          grant.userId = fake.autoUser;
        }
        if (grant.userId === undefined) {
          return send(response, 400, { error: "authorization_pending" });
        }
        devices.delete(form.device_code ?? "");
        return send(response, 200, await issue(grant.userId));
      }
      if (form.grant_type === "refresh_token") {
        const entry = refreshes.get(form.refresh_token ?? "");
        if (entry === undefined || revoked.includes(entry.sessionId)) {
          return send(response, 400, {
            error: "invalid_grant",
            error_description: "Session has already ended.",
          });
        }
        refreshes.delete(form.refresh_token ?? "");
        return send(response, 200, await issue(entry.userId, entry.sessionId));
      }
      if (form.grant_type === "authorization_code") {
        const userId = codes.get(form.code ?? "");
        if (userId === undefined || typeof form.client_secret !== "string") {
          return send(response, 400, { error: "invalid_grant" });
        }
        codes.delete(form.code ?? "");
        return send(response, 200, await issue(userId));
      }
      return send(response, 400, { error: "unsupported_grant_type" });
    }
    if (request.method === "GET" && path === "/user_management/authorize") {
      const redirect = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const login = pendingLogin ?? fake.autoUser;
      if (url.searchParams.get("provider") !== "GitHubOAuth" || login === undefined) {
        return send(response, 400, { error: "invalid_request" });
      }
      const code = token();
      codes.set(code, login);
      const target = new URL(redirect);
      target.searchParams.set("code", code);
      target.searchParams.set("state", state);
      response.statusCode = 302;
      response.setHeader("location", target.toString());
      return response.end();
    }
    if (request.method === "POST" && path === "/user_management/sessions/revoke") {
      const form = await body(request);
      revoked.push(form.session_id ?? "");
      return send(response, 200, {});
    }
    if (request.method === "GET" && path === "/user_management/sessions/logout") {
      revoked.push(url.searchParams.get("session_id") ?? "");
      response.statusCode = 302;
      response.setHeader("location", url.searchParams.get("return_to") ?? "/");
      return response.end();
    }
    const identities = /^\/user_management\/users\/([^/]+)\/identities$/.exec(path);
    if (request.method === "GET" && identities !== null) {
      const user = users.get(identities[1] ?? "");
      return user === undefined
        ? send(response, 404, { message: "Not found" })
        : send(response, 200, [{ idp_id: user.githubId, type: "OAuth", provider: "GitHubOAuth" }]);
    }
    const single = /^\/user_management\/users\/([^/]+)$/.exec(path);
    if (request.method === "GET" && single !== null) {
      const user = users.get(single[1] ?? "");
      return user === undefined
        ? send(response, 404, { message: "Not found" })
        : send(response, 200, userJson(user));
    }
    return send(response, 404, { message: "Not found" });
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      send(response, 500, { message: String(error) });
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;
  const fake: FakeWorkos = {
    url: options.publicUrl?.replace(/\/+$/, "") ?? `http://127.0.0.1:${port}`,
    clientId,
    users,
    accessTtl: 300,
    autoUser: undefined,
    approve(userCode, userId) {
      for (const grant of devices.values()) {
        if (grant.userCode === userCode) {
          grant.userId = userId;
        }
      }
    },
    deny(userCode) {
      for (const grant of devices.values()) {
        if (grant.userCode === userCode) {
          grant.denied = true;
        }
      }
    },
    loginAs(userId) {
      pendingLogin = userId;
    },
    revokedSessions: () => revoked,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return fake;
}
