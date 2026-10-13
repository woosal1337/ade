import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { workosAuth } from "../src/auth.ts";

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

describe("WorkOS adapter", () => {
  test("a bearer token needs the WorkOS key, a user subject, and time left", async () => {
    const keys = await generateKeyPair("RS256");
    const stranger = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const auth = workosAuth({
        apiKey: "sk_test_dummy",
        clientId: "client_dummy",
        cookiePassword: "p".repeat(32),
        jwksUrl: `http://127.0.0.1:${port}/jwks`,
      });
      const now = Math.floor(Date.now() / 1000);
      const sign = (key: SigningKey, subject: string, expires = now + 300) =>
        new SignJWT({ sid: "session_1" })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setSubject(subject)
          .setIssuedAt(now - 10)
          .setExpirationTime(expires)
          .sign(key);
      assert.equal(
        await auth.verifyBearer(await sign(keys.privateKey, "user_01ABC")),
        "user_01ABC",
      );
      assert.equal(
        await auth.verifyBearer(await sign(stranger.privateKey, "user_01ABC")),
        undefined,
      );
      assert.equal(await auth.verifyBearer(await sign(keys.privateKey, "org_01ABC")), undefined);
      assert.equal(
        await auth.verifyBearer(await sign(keys.privateKey, "user_01ABC", now - 60)),
        undefined,
      );
      assert.equal(await auth.verifyBearer("not-a-token"), undefined);
    } finally {
      server.close();
    }
  });

  test("login goes to GitHub through WorkOS, and the CLI gets the device endpoints", () => {
    const auth = workosAuth({
      apiKey: "sk_test_dummy",
      clientId: "client_dummy",
      cookiePassword: "p".repeat(32),
    });
    const url = new URL(auth.loginUrl("state-1", "https://ade.chele.bi/api/auth/callback"));
    assert.equal(url.origin, "https://api.workos.com");
    assert.equal(url.searchParams.get("provider"), "GitHubOAuth");
    assert.equal(url.searchParams.get("client_id"), "client_dummy");
    assert.equal(url.searchParams.get("state"), "state-1");
    assert.equal(url.searchParams.get("redirect_uri"), "https://ade.chele.bi/api/auth/callback");
    assert.deepEqual(auth.clientConfig(), {
      clientId: "client_dummy",
      deviceAuthorizationUrl: "https://api.workos.com/user_management/authorize/device",
      tokenUrl: "https://api.workos.com/user_management/authenticate",
    });
  });
});
