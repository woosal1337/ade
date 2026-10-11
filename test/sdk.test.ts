import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, test } from "node:test";
import * as sdk from "../src/index.ts";
import { VERSION } from "../src/version.ts";

describe("sdk", () => {
  test("the version matches package.json", async () => {
    const pkg = JSON.parse(
      await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
    };
    assert.equal(VERSION, pkg.version);
  });

  test("exports the local and remote operations", () => {
    for (const name of [
      "capture",
      "inventory",
      "shareProfile",
      "parseMarkdown",
      "loadMarkdownProfile",
      "addPlugin",
      "addMarketplace",
      "plan",
      "apply",
      "status",
      "revert",
      "doctor",
      "loadProfile",
      "saveProfile",
      "exportBundle",
      "importBundle",
      "remotePlan",
      "remoteApply",
      "remoteCapture",
      "remoteRevert",
      "describeHarnesses",
    ]) {
      assert.equal(typeof (sdk as Record<string, unknown>)[name], "function", name);
    }
  });
});
