import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { AdeError } from "../src/core/errors.ts";
import { apply } from "../src/engine/apply.ts";
import { plan } from "../src/engine/plan.ts";
import { updateSkills } from "../src/engine/update.ts";
import { loadProfile, saveProfile } from "../src/profile/load.ts";
import { contextFor, POSIX, tempDir, writeText } from "./helpers.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "ade test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "ade test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: path.join(cwd, ".no-global-config"),
    },
  }).trim();
}

async function skillRepo(): Promise<{ url: string; repo: string }> {
  const repo = await tempDir("ade-repo-");
  git(repo, "init", "--quiet", "-b", "main");
  await writeText(
    path.join(repo, "skills", "deploy", "SKILL.md"),
    "---\nname: deploy\ndescription: Deploy.\n---\n",
  );
  await writeText(path.join(repo, "README.md"), "Skills\n");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "Add the deploy skill");
  return { url: pathToFileURL(repo).href, repo };
}

describe("git skills", () => {
  test("update locks a commit, and apply installs that content", async () => {
    const { url, repo } = await skillRepo();
    const home = await tempDir();
    const ctx = contextFor(home, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.autocrlf",
      GIT_CONFIG_VALUE_0: "true",
    });
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      skills: { deploy: { git: url, ref: "main", subdir: "skills/deploy" } },
    });
    await assert.rejects(
      plan(await loadProfile(dir), ctx),
      (error: unknown) => error instanceof AdeError && error.code === "not-found",
    );
    const first = await updateSkills(await loadProfile(dir), ctx);
    const commit = git(repo, "rev-parse", "HEAD");
    assert.deepEqual(
      first.updates.map((update) => [update.name, update.to, update.changed]),
      [["deploy", commit, true]],
    );
    const loaded = await loadProfile(dir);
    assert.equal(loaded.lock.skills.deploy?.commit, commit);
    await apply(loaded, ctx);
    assert.equal(
      await fs.readFile(path.join(home, ".agents", "skills", "deploy", "SKILL.md"), "utf8"),
      "---\nname: deploy\ndescription: Deploy.\n---\n",
    );
    await writeText(
      path.join(repo, "skills", "deploy", "SKILL.md"),
      "---\nname: deploy\ndescription: Deploy v2.\n---\n",
    );
    git(repo, "commit", "--quiet", "-am", "Change the description");
    assert.equal((await plan(await loadProfile(dir), ctx, { offline: true })).summary.update, 0);
    const second = await updateSkills(await loadProfile(dir), ctx, ["deploy"]);
    assert.equal(second.updates[0]?.changed, true);
    const result = await plan(await loadProfile(dir), ctx);
    assert.deepEqual(
      result.changes.filter((change) => change.action === "update").map((change) => change.key),
      ["skill:shared:deploy"],
    );
  });

  test("offline mode needs the cache", async () => {
    const { url } = await skillRepo();
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["pi"],
      skills: { deploy: { git: url, subdir: "skills/deploy" } },
    });
    await updateSkills(await loadProfile(dir), contextFor(await tempDir()));
    const fresh = contextFor(await tempDir());
    await assert.rejects(
      plan(await loadProfile(dir), fresh, { offline: true }),
      (error: unknown) => error instanceof AdeError && error.code === "not-found",
    );
    assert.equal((await plan(await loadProfile(dir), fresh)).summary.create, 1);
  });
});

describe("link skills", () => {
  test("a link skill points the shared entry at its source", { skip: !POSIX }, async () => {
    const home = await tempDir();
    const ctx = contextFor(home);
    await writeText(
      path.join(home, "code", "tool", "SKILL.md"),
      "---\nname: tool\ndescription: Tool.\n---\n",
    );
    const dir = await tempDir("ade-profile-");
    await saveProfile(dir, {
      version: 1,
      harnesses: ["claude"],
      skills: { tool: { link: "${home}/code/tool" }, gone: { link: "${home}/missing/gone" } },
    });
    const loaded = await loadProfile(dir);
    const preview = await plan(loaded, ctx);
    assert.equal(
      preview.warnings.some((warning) => warning.includes("gone")),
      true,
    );
    await apply(loaded, ctx);
    assert.equal(
      await fs.readlink(path.join(home, ".agents", "skills", "tool")),
      path.join(home, "code", "tool"),
    );
    assert.equal(
      await fs.readlink(path.join(home, ".claude", "skills", "tool")),
      path.join(home, ".agents", "skills", "tool"),
    );
    assert.equal((await plan(loaded, ctx)).summary.create, 0);
  });
});
