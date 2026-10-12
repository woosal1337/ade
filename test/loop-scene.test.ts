import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GLYPHS } from "../site/app/glyphs.ts";
import {
  buildLoopScene,
  drawLoop,
  LOOP_CYCLE_MS,
  LOOP_DWELL_MS,
  LOOP_STAGE_MS,
  LOOP_STILL_MS,
  LOOP_TRAVEL_MS,
  loopTiming,
  type Painter,
} from "../site/app/loop-scene.ts";

const DIGITS = ["0", "1", "2", "3", "4"].map((digit) => GLYPHS[digit] ?? []);

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly style: string;
}

function recorder(): Painter & { readonly rects: Rect[] } {
  const rects: Rect[] = [];
  let style = "";
  return {
    rects,
    get fillStyle(): unknown {
      return style;
    },
    set fillStyle(value: unknown) {
      style = String(value);
    },
    clearRect() {
      rects.length = 0;
    },
    fillRect(x: number, y: number, width: number) {
      rects.push({ x, y, size: width, style });
    },
  };
}

function green(rect: Rect): boolean {
  return rect.style.startsWith("rgba(124,240,176,");
}

describe("loop timing", () => {
  test("dwells at a station, then travels a quarter turn with easing", () => {
    const start = loopTiming(0);
    assert.equal(start.stage, 0);
    assert.equal(start.travelling, false);
    assert.equal(start.angle, -Math.PI / 2);
    const middle = loopTiming(LOOP_DWELL_MS + LOOP_TRAVEL_MS / 2);
    assert.equal(middle.travelling, true);
    assert.ok(Math.abs(middle.progress - 0.5) < 1e-9);
    assert.ok(Math.abs(middle.angle + Math.PI / 4) < 1e-9);
    assert.equal(middle.speed, 1);
    assert.equal(loopTiming(LOOP_STAGE_MS).stage, 1);
    assert.ok(Math.abs(loopTiming(LOOP_STAGE_MS).angle) < 1e-9);
  });

  test("repeats every cycle, also for negative times", () => {
    assert.deepEqual(loopTiming(LOOP_CYCLE_MS + 123), loopTiming(123));
    assert.deepEqual(loopTiming(-LOOP_STAGE_MS), loopTiming(LOOP_CYCLE_MS - LOOP_STAGE_MS));
  });
});

describe("loop scene", () => {
  for (const size of [300, 460]) {
    test(`fits four chips and the number inside a ${size} px square`, () => {
      const scene = buildLoopScene({ size, digits: DIGITS });
      for (const station of scene.stations) {
        assert.ok(station.x - 5 >= 0 && station.x + 5 < scene.cells, `x ${station.x}`);
        assert.ok(station.y - 6 >= 0 && station.y + 6 < scene.cells, `y ${station.y}`);
      }
      const chipCells = [...scene.chip].filter((value) => value >= 0).length;
      assert.equal(chipCells, 4 * (11 * 13 - 4));
      scene.panel.forEach((value, index) => {
        if (value === 1) {
          assert.ok((scene.distance[index] ?? 0) < scene.radius - 5, `panel cell ${index}`);
        }
      });
    });
  }

  test("draws only inside the canvas and returns the stage", () => {
    const scene = buildLoopScene({ size: 302, digits: DIGITS });
    const painter = recorder();
    for (const time of [0, 700, 1500, 2300, 4100, 8000]) {
      const stage = drawLoop(painter, scene, time);
      assert.equal(stage, loopTiming(time).stage);
      assert.ok(painter.rects.length > 1000);
      for (const rect of painter.rects) {
        assert.ok(rect.x >= 0 && rect.y >= 0, `${rect.x},${rect.y}`);
        assert.ok(rect.x + rect.size <= 302 && rect.y + rect.size <= 302, `${rect.x},${rect.y}`);
      }
    }
  });

  test("lights the number of the active step after the dissolve", () => {
    const scene = buildLoopScene({ size: 460, digits: DIGITS });
    const painter = recorder();
    drawLoop(painter, scene, LOOP_STAGE_MS * 2 + 600);
    const lit = painter.rects.filter((rect) => rect.style.startsWith("rgba(237,237,237,0.950)"));
    const expected = [...(scene.numbers[2] ?? [])].filter((value) => value === 1).length;
    assert.equal(lit.length, expected);
  });

  test("the still frame has no arrival wave", () => {
    const scene = buildLoopScene({ size: 460, digits: DIGITS });
    const moving = recorder();
    const still = recorder();
    drawLoop(moving, scene, LOOP_STILL_MS);
    drawLoop(still, scene, LOOP_STILL_MS, true);
    assert.ok(moving.rects.filter(green).length > still.rects.filter(green).length);
  });
});
