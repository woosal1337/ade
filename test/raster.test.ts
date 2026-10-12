import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HARNESS_BRANDS, MODEL_BRANDS } from "../site/app/brands.ts";
import { matrixRuns } from "../site/app/glyphs.ts";
import { coverage, dotRuns, flattenPath, LOGO_LAYOUT } from "../site/app/raster.ts";

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe("path reader", () => {
  test("reads compressed numbers and arc flags without separators", () => {
    assert.deepEqual(
      flattenPath("M1.5.5l1-1.5.5.5z").map((points) => points.length),
      [3],
    );
    assert.deepEqual(flattenPath("M0 0a1 1 0 011 1")[0]?.at(-1), [1, 1]);
  });

  test("starts a drawing command after Z at the subpath start", () => {
    const subpaths = flattenPath("M2 2h4v4zl1 1");
    assert.deepEqual(subpaths[1]?.[0], [2, 2]);
  });

  test("rejects a number without a command", () => {
    assert.throws(() => flattenPath("1 2"));
    assert.throws(() => flattenPath("M0 0z 1 2"));
  });
});

describe("coverage", () => {
  test("fills squares, halves, and holes", () => {
    assert.deepEqual(
      coverage([{ d: "M0 0H24V24H0Z", rule: "nonzero" }], 24, 2).values,
      [1, 1, 1, 1],
    );
    assert.deepEqual(
      coverage([{ d: "M0 0h12v24H0z", rule: "nonzero" }], 24, 2).values,
      [1, 0, 1, 0],
    );
    const ring = coverage([{ d: "M0 0h24v24H0zM6 6v12h12V6z", rule: "evenodd" }], 24, 4).values;
    assert.deepEqual(ring, [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1]);
  });

  test("measures a circle within one percent", () => {
    const circle = coverage(
      [{ d: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z", rule: "nonzero" }],
      24,
      8,
      8,
    );
    const area = sum(circle.values) * 9;
    assert.ok(Math.abs(area - Math.PI * 100) / (Math.PI * 100) < 0.01, String(area));
  });
});

describe("dot runs", () => {
  test("merges lit cells in a row into one run", () => {
    const grid = dotRuns([{ d: "M0 0h24v12H0z", rule: "nonzero" }], {
      size: 4,
      pitch: 2,
      dot: 1.5,
      threshold: 0.5,
    });
    assert.equal(grid.runs, "M0 0h8v2h-8zM0 2h8v2h-8z");
  });

  test("draws the ade. word with the same runs as its glyphs", () => {
    const grid = matrixRuns("a.", 1, 1);
    assert.equal(grid.width, 7);
    assert.equal(grid.height, 7);
    assert.match(grid.runs, /^M1 2h3v1h-3z/);
  });

  test("every brand logo renders with a reasonable share of lit dots", () => {
    for (const brand of [...HARNESS_BRANDS, ...MODEL_BRANDS]) {
      const values = coverage(brand.paths, 24, LOGO_LAYOUT.size).values;
      const lit = values.filter((value) => value >= LOGO_LAYOUT.threshold).length / values.length;
      assert.ok(lit > 0.08 && lit < 0.8, `${brand.id}: ${lit.toFixed(2)}`);
    }
  });
});
