import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { EXIT, runCli } from "../src/cli/main.ts";
import { exists, fakeIO, readJson, tempDir, writeText } from "./helpers.ts";

async function run(
  cwd: string,
  args: string[],
  answers: string[] = [],
): Promise<{ code: number; out: string; err: string }> {
  const io = fakeIO(cwd, answers);
  const code = await runCli(args, io);
  return { code, out: io.output(), err: io.errors() };
}

function json(text: string): { ok: boolean; command: string; result: Record<string, unknown> } {
  return JSON.parse(text) as { ok: boolean; command: string; result: Record<string, unknown> };
}

describe("cli", () => {
  test("a full profile lifecycle in a scratch home", async () => {
    const root = await tempDir("ade-cli-");
    const home = path.join(root, "home");
    const profile = path.join(root, "profile");
    await fs.mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    const common = ["--profile", profile, "--home", home];

    assert.equal((await run(root, ["init", profile, "--name", "demo"])).code, EXIT.ok);
    assert.equal((await run(root, ["init", profile])).code, EXIT.failure);

    const added = await run(root, [
      "add",
      "mcp",
      "docs",
      "--url",
      "https://docs.example.com/mcp",
      ...common,
    ]);
    assert.equal(added.code, EXIT.ok, added.err);
    assert.equal(
      (
        await run(root, [
          "add",
          "mcp",
          "tools",
          "--env",
          "LEVEL=debug",
          ...common,
          "--",
          "uvx",
          "tools-mcp",
          "--fast",
        ])
      ).code,
      EXIT.ok,
    );
    assert.equal(
      (await run(root, ["set", "pi", "defaultModel", "claude-opus-5-5", ...common])).code,
      EXIT.ok,
    );
    assert.equal((await run(root, ["set", "pi", "retry.max", "3", ...common])).code, EXIT.ok);

    const listed = json((await run(root, ["list", "mcp", "--json", ...common])).out);
    assert.deepEqual(Object.keys(listed.result.mcp as object), ["docs", "tools"]);

    const planned = json((await run(root, ["plan", "--json", ...common])).out);
    assert.equal(planned.ok, true);
    assert.equal((planned.result.summary as { create: number }).create, 4);

    const refused = await run(root, ["apply", ...common]);
    assert.equal(refused.code, EXIT.usage);
    assert.match(refused.err, /--yes/);

    const declined = await run(root, ["apply", ...common], ["no"]);
    assert.equal(declined.code, EXIT.ok);
    assert.equal(await exists(path.join(home, ".pi", "agent", "mcp.json")), false);

    const applied = await run(root, ["apply", ...common], ["yes"]);
    assert.equal(applied.code, EXIT.ok, applied.err);
    assert.match(applied.out, /Applied 4 changes/);
    assert.deepEqual(await readJson(path.join(home, ".pi", "agent", "mcp.json")), {
      mcpServers: {
        docs: { url: "https://docs.example.com/mcp" },
        tools: { command: "uvx", args: ["tools-mcp", "--fast"], env: { LEVEL: "debug" } },
      },
    });
    assert.deepEqual(await readJson(path.join(home, ".pi", "agent", "settings.json")), {
      defaultModel: "claude-opus-5-5",
      retry: { max: 3 },
    });

    assert.equal((await run(root, ["status", "--exit-code", ...common])).code, EXIT.ok);
    assert.equal((await run(root, ["remove", "mcp", "tools", ...common])).code, EXIT.ok);
    assert.equal((await run(root, ["status", "--exit-code", ...common])).code, EXIT.pending);
    assert.equal((await run(root, ["apply", "--yes", ...common])).code, EXIT.ok);
    assert.deepEqual(
      Object.keys(
        (await readJson(path.join(home, ".pi", "agent", "mcp.json"))).mcpServers as object,
      ),
      ["docs"],
    );

    const history = json((await run(root, ["history", "--json", ...common])).out);
    assert.equal((history.result as unknown as unknown[]).length, 2);
    assert.equal((await run(root, ["revert", "--yes", ...common])).code, EXIT.ok);
    assert.deepEqual(
      Object.keys(
        (await readJson(path.join(home, ".pi", "agent", "mcp.json"))).mcpServers as object,
      ),
      ["docs", "tools"],
    );

    const bundle = path.join(root, "bundle.json");
    assert.equal((await run(root, ["export", "--out", bundle, ...common])).code, EXIT.ok);
    const imported = path.join(root, "imported");
    const untrusted = await run(root, ["import", bundle, "--out", imported, "--home", home]);
    assert.equal(untrusted.code, EXIT.failure);
    assert.match(untrusted.err, /not trusted/);
    assert.equal(
      (await run(root, ["import", bundle, "--out", imported, "--home", home, "--trust"])).code,
      EXIT.ok,
    );
    assert.equal(await exists(path.join(imported, "ade.json")), true);

    const report = json((await run(root, ["doctor", "--json", ...common])).out);
    assert.equal((report.result as { ok: boolean }).ok, true);
  });

  test("errors use exit codes and JSON envelopes", async () => {
    const root = await tempDir("ade-cli-");
    const unknown = await run(root, ["deploy"]);
    assert.equal(unknown.code, EXIT.usage);
    assert.match(unknown.err, /not known/);

    const missing = await run(root, ["plan", "--json", "--profile", path.join(root, "none")]);
    assert.equal(missing.code, EXIT.failure);
    const envelope = JSON.parse(missing.out) as {
      ok: boolean;
      error: { code: string; hint: string };
    };
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "profile-not-found");
    assert.match(envelope.error.hint, /ade init/);

    assert.equal((await run(root, ["plan", "--bogus"])).code, EXIT.usage);
    assert.equal((await run(root, ["--version"])).out.trim(), "0.1.0");
    assert.match((await run(root, ["help", "add"])).out, /ade add mcp/);
  });

  test("capture writes a profile from a scratch home", async () => {
    const root = await tempDir("ade-cli-");
    const home = path.join(root, "home");
    await writeText(
      path.join(home, ".pi", "agent", "settings.json"),
      '{"defaultModel":"x","lastChangelogVersion":"1"}',
    );
    await writeText(
      path.join(home, ".pi", "agent", "claude-bridge.json"),
      '{"askClaude":{"enabled":true}}',
    );
    const out = path.join(root, "captured");
    const result = await run(root, [
      "capture",
      "--home",
      home,
      "--out",
      out,
      "--include",
      "pi:claude-bridge.json",
    ]);
    assert.equal(result.code, EXIT.ok, result.err);
    const profile = await readJson(path.join(out, "ade.json"));
    assert.deepEqual(profile.settings, {
      pi: { defaultModel: "x" },
      "pi:claude-bridge.json": { askClaude: { enabled: true } },
    });
    assert.equal((await run(root, ["capture", "--home", home, "--out", out])).code, EXIT.failure);
  });
});
