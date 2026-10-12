import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { MODEL_BRANDS } from "../site/app/brands.ts";
import { listFiles } from "../src/core/fsx.ts";

const ALL_CAPS = /(?<![A-Za-z-])uppercase(?![A-Za-z-])/;

describe("site text", () => {
  test("the site sets no text in all capitals", async () => {
    const root = path.resolve("site", "app");
    const found: string[] = [];
    for (const relative of await listFiles(root)) {
      if (!/\.(tsx?|css)$/.test(relative)) {
        continue;
      }
      const lines = (await fs.readFile(path.join(root, relative), "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (ALL_CAPS.test(line)) {
          found.push(`site/app/${relative}:${index + 1}`);
        }
      });
    }
    assert.deepEqual(found, []);
  });

  test("the README logo strips show the provider names as written", async () => {
    for (const theme of ["dark", "light"]) {
      const svg = await fs.readFile(path.resolve("docs", "assets", `models-${theme}.svg`), "utf8");
      for (const brand of MODEL_BRANDS) {
        assert.ok(svg.includes(`>${brand.provider ?? ""}</text>`), `${theme}: ${brand.provider}`);
      }
    }
  });
});
