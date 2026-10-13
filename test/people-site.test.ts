import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { peopleSearch } from "../site/app/people-query.ts";
import { nextVote, timeAgo } from "../site/app/time.ts";

describe("people page helpers", () => {
  test("the update label uses short relative words, then a date", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    const at = (ms: number) => new Date(now - ms).toISOString();
    assert.equal(timeAgo(at(10_000), now), "just now");
    assert.equal(timeAgo(at(60_000), now), "1 minute ago");
    assert.equal(timeAgo(at(5 * 60_000), now), "5 minutes ago");
    assert.equal(timeAgo(at(3 * 3_600_000), now), "3 hours ago");
    assert.equal(timeAgo(at(30 * 3_600_000), now), "yesterday");
    assert.equal(timeAgo(at(4 * 86_400_000), now), "4 days ago");
    assert.equal(timeAgo("2026-01-02T00:00:00Z", now), "Jan 2, 2026");
    assert.equal(timeAgo(at(-60_000), now), "just now");
    assert.equal(timeAgo("not a date", now), "");
  });

  test("a vote press sets, moves, and clears the vote of the viewer", () => {
    const empty = { score: 0, up: 0, down: 0, mine: 0 as const };
    const up = nextVote(empty, 1);
    assert.deepEqual(up, { score: 1, up: 1, down: 0, mine: 1 });
    assert.deepEqual(nextVote(up, 1), empty);
    assert.deepEqual(nextVote(up, -1), { score: -1, up: 0, down: 1, mine: -1 });
    assert.deepEqual(nextVote({ score: 3, up: 5, down: 2, mine: 0 }, -1), {
      score: 2,
      up: 5,
      down: 3,
      mine: -1,
    });
  });

  test("the address holds only the values that differ from the defaults", () => {
    assert.equal(peopleSearch({ q: "", harness: undefined, has: [], sort: "top", page: 1 }), "");
    assert.equal(
      peopleSearch({
        q: "ada review",
        harness: "pi",
        has: ["skills", "mcp"],
        sort: "recent",
        page: 2,
      }),
      "?q=ada+review&harness=pi&has=skills%2Cmcp&sort=recent&page=2",
    );
  });
});
