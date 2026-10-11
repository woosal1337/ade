import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { EXIT, runCli } from "../src/cli/main.ts";
import { AdeError } from "../src/core/errors.ts";
import { loadProfile, saveProfile } from "../src/profile/load.ts";
import { packProfile } from "../src/profile/pack.ts";
import { riskSummary } from "../src/profile/risk.ts";
import { resolveProfile } from "../src/profile/source.ts";
import { parseProfileSpec } from "../src/profile/spec.ts";
import { checkTrust, recordTrust } from "../src/profile/trust.ts";
import { contextFor, exists, fakeIO, readJson, tempDir, testGitEnv, writeText } from "./helpers.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: testGitEnv(),
  }).trim();
}

async function run(
  cwd: string,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const io = fakeIO(cwd);
  const code = await runCli(args, io);
  return { code, out: io.output(), err: io.errors() };
}

async function publicRepo(): Promise<{ repo: string; url: string }> {
  const repo = await tempDir("ade-public-");
  await writeText(path.join(repo, "AGENTS.md"), "# Team rules\n");
  await writeText(
    path.join(repo, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review.\n---\n",
  );
  await saveProfile(repo, {
    version: 1,
    name: "team",
    harnesses: ["pi"],
    instructions: { file: "AGENTS.md" },
    skills: { review: { path: "skills/review" } },
    mcp: { docs: { transport: "http", url: "https://docs.example.com/mcp" } },
    settings: { pi: { defaultModel: "claude-opus-5-5" } },
  });
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "Publish the team profile");
  return { repo, url: pathToFileURL(repo).href };
}

async function commitProfile(
  repo: string,
  change: (profile: Record<string, unknown>) => void,
  message: string,
): Promise<string> {
  const file = path.join(repo, "ade.json");
  const profile = await readJson(file);
  change(profile);
  await fs.writeFile(file, `${JSON.stringify(profile, null, 2)}\n`);
  git(repo, "commit", "--quiet", "-am", message);
  return git(repo, "rev-parse", "HEAD");
}

describe("profile specs", () => {
  const context = (existing: string[] = []) => ({
    cwd: path.resolve("/work"),
    home: path.resolve("/home/me"),
    exists: (target: string) => existing.includes(target),
  });

  test("GitHub shorthand, subdirectories, and refs", () => {
    assert.deepEqual(parseProfileSpec("cobanov/agents", context()), {
      kind: "git",
      url: "https://github.com/cobanov/agents.git",
      ref: undefined,
      subdir: undefined,
      display: "cobanov/agents",
      canonical: "github:cobanov/agents",
    });
    const nested = parseProfileSpec("cobanov/agents/profiles/work@v1.2", context());
    assert.equal(nested.kind === "git" && nested.subdir, "profiles/work");
    assert.equal(nested.kind === "git" && nested.ref, "v1.2");
    assert.equal(parseProfileSpec("github:a/b@main", context()).canonical, "github:a/b@main");
    assert.throws(() => parseProfileSpec("a/b/../c", context()), AdeError);
  });

  test("URLs with a subdirectory and a ref", () => {
    const https = parseProfileSpec("https://github.com/a/b.git//team#dev", context());
    assert.equal(https.kind === "git" && https.url, "https://github.com/a/b.git");
    assert.equal(https.kind === "git" && https.subdir, "team");
    assert.equal(https.kind === "git" && https.ref, "dev");
    const scp = parseProfileSpec("git@github.com:a/b.git#dev", context());
    assert.equal(scp.kind === "git" && scp.url, "git@github.com:a/b.git");
  });

  test("local folders win over the shorthand", () => {
    const local = path.resolve("/work/a/b");
    assert.equal(parseProfileSpec("a/b", context([local])).kind, "local");
    assert.equal(parseProfileSpec("./a/b", context()).kind, "local");
    assert.equal(
      parseProfileSpec("~/agents", context()).canonical,
      path.join(path.resolve("/home/me"), "agents"),
    );
    assert.equal(parseProfileSpec("C:\\Users\\me\\agents", context()).kind, "local");
  });
});

describe("git sources", () => {
  test("resolves a commit, records it, and works offline", async () => {
    const { repo, url } = await publicRepo();
    const ctx = contextFor(await tempDir());
    await assert.rejects(
      resolveProfile(url, ctx, { offline: true }),
      (error: unknown) => error instanceof AdeError && error.code === "not-found",
    );
    const resolved = await resolveProfile(url, ctx);
    assert.equal(resolved.source.kind, "git");
    assert.equal(resolved.source.commit, git(repo, "rev-parse", "HEAD"));
    assert.equal(resolved.loaded.profile.name, "team");
    const offline = await resolveProfile(url, ctx, { offline: true });
    assert.equal(offline.source.commit, resolved.source.commit);
  });

  test("reports a repository without a profile", async () => {
    const repo = await tempDir("ade-public-");
    await writeText(path.join(repo, "README.md"), "Not a profile\n");
    git(repo, "init", "--quiet", "-b", "main");
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Add a readme");
    await assert.rejects(
      resolveProfile(pathToFileURL(repo).href, contextFor(await tempDir())),
      (error: unknown) => error instanceof AdeError && error.code === "profile-not-found",
    );
  });

  test("trust follows the risk summary, not each commit", async () => {
    const { repo, url } = await publicRepo();
    const ctx = contextFor(await tempDir());
    const first = await resolveProfile(url, ctx);
    assert.equal((await checkTrust(ctx, first)).state, "untrusted");
    await recordTrust(ctx, first);
    assert.equal((await checkTrust(ctx, first)).state, "trusted");

    await fs.writeFile(path.join(repo, "AGENTS.md"), "# Team rules, version 2\n");
    git(repo, "commit", "--quiet", "-am", "Change the rules");
    const second = await resolveProfile(url, ctx);
    const quiet = await checkTrust(ctx, second);
    assert.equal(quiet.state === "trusted" && quiet.sameCommit, false);

    await commitProfile(
      repo,
      (profile) => {
        (profile.mcp as Record<string, unknown>).tools = {
          transport: "stdio",
          command: "npx",
          args: ["-y", "tools-mcp"],
        };
      },
      "Add a stdio server",
    );
    const third = await resolveProfile(url, ctx);
    const changed = await checkTrust(ctx, third);
    assert.equal(changed.state, "changed");
    assert.deepEqual(changed.state === "changed" && changed.added, [
      "mcp: tools runs: npx -y tools-mcp",
    ]);
  });
});

describe("cli sources", () => {
  test("apply needs trust, then syncs the home 1:1", async () => {
    const { url } = await publicRepo();
    const root = await tempDir("ade-cli-");
    const home = path.join(root, "home");
    await fs.mkdir(home, { recursive: true });

    const planned = await run(root, ["plan", url, "--home", home, "--json"]);
    assert.equal(planned.code, EXIT.ok, planned.err);
    const plan = JSON.parse(planned.out) as {
      result: { trust: string; summary: { create: number } };
    };
    assert.equal(plan.result.trust, "untrusted");
    assert.equal(plan.result.summary.create > 3, true);

    const refused = await run(root, ["apply", url, "--home", home, "--yes"]);
    assert.equal(refused.code, EXIT.failure);
    assert.match(refused.err, /not trusted/);
    assert.equal(await exists(path.join(home, ".pi")), false);

    const applied = await run(root, ["apply", url, "--home", home, "--yes", "--trust"]);
    assert.equal(applied.code, EXIT.ok, applied.err);
    assert.match(applied.out, /does these things on this machine/);
    assert.match(applied.out, /@ [0-9a-f]{12} \(trusted\)/);
    assert.doesNotMatch(applied.out, /not trusted/);
    assert.deepEqual(await readJson(path.join(home, ".pi", "agent", "settings.json")), {
      defaultModel: "claude-opus-5-5",
    });
    assert.equal(
      await fs.readFile(path.join(home, ".agents", "skills", "review", "SKILL.md"), "utf8"),
      "---\nname: review\ndescription: Review.\n---\n",
    );
    const again = await run(root, ["status", url, "--home", home, "--exit-code"]);
    assert.equal(again.code, EXIT.ok, again.out);
    const history = JSON.parse((await run(root, ["history", "--home", home, "--json"])).out) as {
      result: { profile: string }[];
    };
    assert.match(history.result[0]?.profile ?? "", / @ [0-9a-f]{12}$/);
  });

  test("an untrusted plan never runs a secret command", async () => {
    const { repo, url } = await publicRepo();
    const marker = path.join(await tempDir("ade-marker-"), "ran");
    await commitProfile(
      repo,
      (profile) => {
        profile.secrets = {
          TOKEN: {
            from: "command",
            argv: [
              process.execPath,
              "-e",
              "require('node:fs').writeFileSync(process.argv[1], 'x'); process.stdout.write('value-123')",
              marker,
            ],
          },
        };
        (profile.mcp as Record<string, unknown>).docs = {
          transport: "http",
          url: "https://docs.example.com/mcp",
          headers: { Authorization: "Bearer ${secret:TOKEN}" },
        };
      },
      "Add a secret",
    );
    const root = await tempDir("ade-cli-");
    const home = path.join(root, "home");
    await fs.mkdir(home, { recursive: true });
    for (const command of ["plan", "status", "doctor"]) {
      await run(root, [command, url, "--home", home]);
    }
    assert.equal(await exists(marker), false);
    const applied = await run(root, ["apply", url, "--home", home, "--yes", "--trust"]);
    assert.equal(applied.code, EXIT.ok, applied.err);
    assert.equal(await exists(marker), true);
    const mcp = await readJson(path.join(home, ".pi", "agent", "mcp.json"));
    assert.deepEqual((mcp.mcpServers as Record<string, unknown>).docs, {
      url: "https://docs.example.com/mcp",
      headers: { Authorization: "Bearer value-123" },
    });
  });

  test("use sets the default source, and edits refuse a Git source", async () => {
    const { url } = await publicRepo();
    const root = await tempDir("ade-cli-");
    const home = path.join(root, "home");
    await fs.mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    assert.equal((await run(root, ["use", url, "--home", home])).code, EXIT.ok);
    const current = JSON.parse((await run(root, ["use", "--home", home, "--json"])).out) as {
      result: { profile: string };
    };
    assert.equal(current.result.profile, url);
    const planned = JSON.parse((await run(root, ["plan", "--home", home, "--json"])).out) as {
      result: { source: { kind: string } };
    };
    assert.equal(planned.result.source.kind, "git");
    const edit = await run(root, ["set", "pi", "defaultModel", "x", "--home", home]);
    assert.equal(edit.code, EXIT.usage);
    assert.match(edit.err, /comes from Git/);
    assert.equal((await run(root, ["use", "--clear", "--home", home])).code, EXIT.ok);
  });
});

describe("pack", () => {
  test("refuses tokens, copies link skills, and writes a readme", async () => {
    const root = await tempDir("ade-pack-");
    const linked = path.join(root, "checkout", "tool");
    await writeText(path.join(linked, "SKILL.md"), "---\nname: tool\ndescription: Tool.\n---\n");
    const dir = path.join(root, "profile");
    await writeText(path.join(dir, "AGENTS.md"), "# Rules\n");
    await saveProfile(dir, {
      version: 1,
      name: "mine",
      harnesses: ["claude", "pi"],
      instructions: { file: "AGENTS.md" },
      skills: { tool: { link: linked } },
      settings: { pi: { apiKey: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz" } },
      secrets: { LOCAL: { from: "keychain", service: "ade", account: "x" } },
    });
    const ctx = contextFor(await tempDir());
    const out = path.join(root, "public");
    await assert.rejects(packProfile(await loadProfile(dir), ctx, out), (error: unknown) => {
      return (
        error instanceof AdeError &&
        error.code === "conflict" &&
        error.details.some((line) => line.includes("ade.json") && line.includes("Anthropic key"))
      );
    });
    assert.equal(await exists(out), false);

    const loaded = await loadProfile(dir);
    await saveProfile(dir, {
      ...loaded.profile,
      settings: { pi: { defaultModel: "claude-opus-5-5" } },
    });
    const result = await packProfile(await loadProfile(dir), ctx, out, { repo: "me/agents" });
    assert.equal(
      result.warnings.some((warning) => warning.includes("LOCAL")),
      true,
    );
    const packed = await loadProfile(out);
    assert.deepEqual(packed.profile.skills?.tool, { path: "vendor/skills/tool" });
    assert.match(await fs.readFile(path.join(out, "README.md"), "utf8"), /ade apply me\/agents/);
    assert.equal(await exists(path.join(out, "ade.schema.json")), true);
  });

  test("the risk summary marks programs, files, and permissions", () => {
    const items = riskSummary({
      version: 1,
      mcp: { tools: { transport: "stdio", command: "uvx", args: ["tools"] } },
      settings: {
        claude: { permissions: { defaultMode: "auto" }, theme: "dark" },
        pi: { packages: ["npm:x"] },
      },
      files: [{ root: "home", target: ".zshrc", source: "files/zshrc" }],
      secrets: { A: { from: "command", argv: ["op", "read", "x"] } },
    });
    const high = items.filter((item) => item.level === "high").map((item) => item.text);
    assert.deepEqual(high, [
      "tools runs: uvx tools",
      'claude permissions.defaultMode = "auto"',
      'pi packages = ["npm:x"]',
      "writes ~/.zshrc",
      "A runs: op read x",
    ]);
    assert.equal(
      items.some((item) => item.text === "claude: 1 other values" && !item.fingerprint),
      true,
    );
  });
});
