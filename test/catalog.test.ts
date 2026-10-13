import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { AdeError } from "../src/core/errors.ts";
import { exportBundle } from "../src/profile/bundle.ts";
import { profileItems, publicProfile, readBundle } from "../src/profile/catalog.ts";
import { loadProfile, saveLock, saveProfile } from "../src/profile/load.ts";
import { parseMarkdown, writeMarkdown } from "../src/profile/markdown.ts";
import { tempDir, writeText } from "./helpers.ts";

async function sampleBundle() {
  const dir = await tempDir("ade-catalog-");
  await writeText(path.join(dir, "AGENTS.md"), "# Rules\n\nUse short sentences.\n");
  await writeText(
    path.join(dir, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review a change before a merge.\n---\n\n# Review\n",
  );
  await writeText(path.join(dir, "files", "gitconfig"), "[user]\n  name = ${secret:GIT_NAME}\n");
  await saveProfile(dir, {
    version: 1,
    name: "team",
    harnesses: ["claude", "pi"],
    instructions: { file: "AGENTS.md" },
    skills: {
      review: { path: "skills/review" },
      deploy: { git: "https://github.com/acme/skills.git", ref: "main", subdir: "deploy" },
    },
    mcp: {
      docs: {
        transport: "http",
        url: "https://docs.example.com/mcp",
        headers: { Authorization: "Bearer ${secret:DOCS_TOKEN}" },
      },
      local: { transport: "stdio", command: "npx", args: ["-y", "local-mcp"] },
    },
    settings: {
      claude: { theme: "dark", permissions: { allow: ["Bash(git status)"] } },
      "pi:extra.json": {},
    },
    files: [{ root: "home", target: ".gitconfig", source: "files/gitconfig", template: true }],
    plugins: { claude: { marketplaces: { acme: "acme/plugins" }, install: ["tool@acme"] } },
    secrets: {
      DOCS_TOKEN: { from: "command", argv: ["op", "read", "op://vault/docs/token"] },
      GIT_NAME: { from: "env", name: "GIT_NAME" },
    },
  });
  await saveLock(dir, {
    version: 1,
    skills: {
      deploy: {
        git: "https://github.com/acme/skills.git",
        ref: "main",
        subdir: "deploy",
        commit: "a".repeat(40),
        hash: "b".repeat(64),
      },
    },
  });
  return exportBundle(await loadProfile(dir), new Date(0));
}

describe("profile catalog", () => {
  test("lists each item with a stable key, a group, and a content hash", async () => {
    const memory = readBundle(await sampleBundle());
    const items = profileItems(memory);
    const keys = items.map((item) => item.key);
    assert.deepEqual(keys, [
      "harnesses",
      "instructions",
      "skill:deploy",
      "skill:review",
      "mcp:docs",
      "mcp:local",
      "setting:claude:/theme",
      "setting:claude:/permissions/allow",
      "setting:pi:extra.json",
      "plugin:claude:marketplace:acme",
      "plugin:claude:install:tool@acme",
      "file:home:.gitconfig",
      "secret:DOCS_TOKEN",
      "secret:GIT_NAME",
    ]);
    const review = items.find((item) => item.key === "skill:review");
    assert.equal(review?.detail.description, "Review a change before a merge.");
    const secret = items.find((item) => item.key === "secret:DOCS_TOKEN");
    assert.deepEqual(secret?.detail, { name: "DOCS_TOKEN", from: "command" });
    assert.equal(JSON.stringify(items).includes("op://vault"), false);
    const again = profileItems(readBundle(await sampleBundle()));
    assert.deepEqual(
      again.map((item) => item.hash),
      items.map((item) => item.hash),
    );
  });

  test("a content change changes only the hash of that item", async () => {
    const bundle = await sampleBundle();
    const before = profileItems(readBundle(bundle));
    const changed = {
      ...bundle,
      files: bundle.files.map((file) =>
        file.path === "AGENTS.md" ? { ...file, content: "# Rules\n\nChanged.\n" } : file,
      ),
    };
    const after = profileItems(readBundle(changed));
    const differs = after
      .filter((item, index) => item.hash !== before[index]?.hash)
      .map((item) => item.key);
    assert.deepEqual(differs, ["instructions"]);
  });

  test("the public profile holds approved items only, with env secrets", async () => {
    const memory = readBundle(await sampleBundle());
    assert.equal(publicProfile(memory, new Set(), new Date(0)), undefined);
    const shared = publicProfile(
      memory,
      new Set(["mcp:docs", "setting:claude:/theme", "file:home:.gitconfig", "skill:deploy"]),
      new Date(0),
    );
    assert.ok(shared);
    const { profile, bundle } = shared;
    assert.deepEqual(Object.keys(profile.mcp ?? {}), ["docs"]);
    assert.deepEqual(profile.settings, { claude: { theme: "dark" } });
    assert.equal(profile.instructions, undefined);
    assert.equal(profile.harnesses, undefined);
    assert.deepEqual(profile.secrets, {
      DOCS_TOKEN: { from: "env", name: "DOCS_TOKEN" },
      GIT_NAME: { from: "env", name: "GIT_NAME" },
    });
    const paths = bundle.files.map((file) => file.path);
    assert.deepEqual(paths, ["ade.json", "ade.lock.json", "files/gitconfig"]);
    assert.equal(JSON.stringify(bundle).includes("op://vault"), false);
    assert.equal(JSON.stringify(bundle).includes("Use short sentences"), false);
    const markdown = writeMarkdown(bundle, profile, { source: "@team", createdAt: new Date(0) });
    const parsed = parseMarkdown(markdown, "ADE.md");
    assert.equal(parsed.bundle.files.length, 3);
  });

  test("a bundle with a broken profile fails", async () => {
    const bundle = await sampleBundle();
    const broken = {
      ...bundle,
      files: bundle.files.map((file) =>
        file.path === "ade.json" ? { ...file, content: '{"version": 2}' } : file,
      ),
    };
    assert.throws(
      () => readBundle(broken),
      (error: unknown) => error instanceof AdeError && error.code === "profile-invalid",
    );
    assert.throws(
      () => readBundle({ format: "other" }),
      (error: unknown) => error instanceof AdeError && error.code === "bundle-invalid",
    );
  });
});
