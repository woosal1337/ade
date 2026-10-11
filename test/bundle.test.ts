import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { AdeError } from "../src/core/errors.ts";
import { exportBundle, importBundle } from "../src/profile/bundle.ts";
import { loadProfile, saveProfile } from "../src/profile/load.ts";
import { tempDir, writeText } from "./helpers.ts";

describe("bundles", () => {
  test("export and import keep the profile and its files", async () => {
    const dir = await tempDir("ade-profile-");
    await writeText(path.join(dir, "AGENTS.md"), "# Rules\n");
    await writeText(
      path.join(dir, "skills", "one", "SKILL.md"),
      "---\nname: one\ndescription: One.\n---\n",
    );
    await fs.writeFile(path.join(dir, "skills", "one", "icon.bin"), Buffer.from([0, 1, 2, 255]));
    await writeText(path.join(dir, "files", "npmrc"), "registry=https://registry.npmjs.org\n");
    await writeText(path.join(dir, "notes.txt"), "Not part of the profile.\n");
    await saveProfile(dir, {
      version: 1,
      name: "team",
      instructions: { file: "AGENTS.md" },
      skills: { one: { path: "skills/one" }, linked: { link: "${home}/code/x" } },
      files: [{ root: "home", target: ".npmrc", source: "files/npmrc" }],
    });
    const bundle = await exportBundle(await loadProfile(dir));
    assert.deepEqual(
      bundle.files.map((file) => [file.path, file.encoding]),
      [
        ["AGENTS.md", "utf8"],
        ["ade.json", "utf8"],
        ["files/npmrc", "utf8"],
        ["skills/one/SKILL.md", "utf8"],
        ["skills/one/icon.bin", "base64"],
      ],
    );
    const target = path.join(await tempDir("ade-import-"), "profile");
    const imported = await importBundle(JSON.parse(JSON.stringify(bundle)), target);
    assert.equal(imported.profile.name, "team");
    assert.deepEqual(
      await fs.readFile(path.join(target, "skills", "one", "icon.bin")),
      Buffer.from([0, 1, 2, 255]),
    );
    await assert.rejects(
      importBundle(bundle, target),
      (error: unknown) => error instanceof AdeError && error.code === "profile-exists",
    );
  });

  test("import rejects unsafe paths and foreign files", async () => {
    const target = path.join(await tempDir("ade-import-"), "profile");
    const base = { format: "ade-bundle", version: 1, createdAt: "2026-10-11T00:00:00Z" };
    const file = (filePath: string) => ({ path: filePath, encoding: "utf8", content: "{}" });
    for (const files of [
      [file("ade.json"), file("../escape")],
      [file("ade.json"), file("/etc/passwd")],
      [file("ade.json"), file("a/./b")],
      [file("ade.json"), file("ade.json")],
      [file("other.json")],
    ]) {
      await assert.rejects(
        importBundle({ ...base, files }, target),
        (error: unknown) => error instanceof AdeError && error.code === "bundle-invalid",
      );
    }
    await assert.rejects(importBundle({ format: "zip" }, target), AdeError);
  });
});
