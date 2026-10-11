import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { createContext } from "../src/core/context.ts";
import { AdeError } from "../src/core/errors.ts";
import type { Profile } from "../src/profile/schema.ts";
import { type CommandRunner, createSecretResolver } from "../src/secrets/resolve.ts";
import { tempDir, writeText } from "./helpers.ts";

const profile: Profile = {
  version: 1,
  secrets: {
    TOKEN: { from: "env", name: "API_TOKEN" },
    FILE: { from: "file", path: "${home}/.token" },
    COMMAND: { from: "command", argv: ["fake-secret-tool", "read"] },
    KEYCHAIN: { from: "keychain", service: "ade", account: "linear" },
  },
};

const runner: CommandRunner = async (argv) => {
  if (argv[0] === "fake-secret-tool") {
    return { code: 0, stdout: "command-value\n", stderr: "" };
  }
  if (argv[0] === "security" && argv.includes("linear")) {
    return { code: 0, stdout: "keychain-value\n", stderr: "" };
  }
  return { code: 44, stdout: "", stderr: "not found" };
};

describe("secret resolver", () => {
  test("reads env, file, command, and Keychain sources", async () => {
    const home = await tempDir();
    await writeText(path.join(home, ".token"), "file-value\n");
    const ctx = createContext({ home, env: { API_TOKEN: "env-value" }, platform: "darwin" });
    const resolver = createSecretResolver(profile, ctx, runner);
    assert.equal(await resolver.resolve("TOKEN"), "env-value");
    assert.equal(await resolver.resolve("FILE"), "file-value");
    assert.equal(await resolver.resolve("COMMAND"), "command-value");
    assert.equal(await resolver.resolve("KEYCHAIN"), "keychain-value");
  });

  test("expands references and records the secrets that it used", async () => {
    const home = await tempDir();
    const ctx = createContext({ home, env: { API_TOKEN: "env-value" } });
    const resolver = createSecretResolver(profile, ctx, runner);
    const expanded = await resolver.expandDeep({
      headers: { Authorization: "Bearer ${secret:TOKEN}" },
      path: "${home}/bin",
      literal: "$${secret:TOKEN}",
      other: "${GITHUB_TOKEN}",
    });
    assert.deepEqual(expanded.value, {
      headers: { Authorization: "Bearer env-value" },
      path: `${home}/bin`,
      literal: "${secret:TOKEN}",
      other: "${GITHUB_TOKEN}",
    });
    assert.deepEqual([...expanded.secrets], ["TOKEN"]);
    assert.equal(
      resolver.mask('{"Authorization":"Bearer env-value"}'),
      '{"Authorization":"Bearer ${secret:TOKEN}"}',
    );
  });

  test("fails with clear errors", async () => {
    const home = await tempDir();
    const ctx = createContext({ home, env: {}, platform: "linux" });
    const resolver = createSecretResolver(profile, ctx, runner);
    await assert.rejects(
      resolver.resolve("MISSING"),
      (error: unknown) => error instanceof AdeError && error.code === "secret-undeclared",
    );
    await assert.rejects(
      resolver.resolve("TOKEN"),
      (error: unknown) => error instanceof AdeError && error.code === "secret-unresolved",
    );
    await assert.rejects(
      resolver.resolve("FILE"),
      (error: unknown) => error instanceof AdeError && error.code === "secret-unresolved",
    );
    await assert.rejects(
      resolver.resolve("KEYCHAIN"),
      (error: unknown) => error instanceof AdeError && error.code === "unsupported",
    );
  });
});
