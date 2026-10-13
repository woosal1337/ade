const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

export function timeAgo(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return "";
  }
  const age = Math.max(0, now - at);
  if (age < MINUTE) {
    return "just now";
  }
  if (age < HOUR) {
    return plural(Math.floor(age / MINUTE), "minute");
  }
  if (age < DAY) {
    return plural(Math.floor(age / HOUR), "hour");
  }
  if (age < 2 * DAY) {
    return "yesterday";
  }
  if (age < 30 * DAY) {
    return plural(Math.floor(age / DAY), "day");
  }
  return new Date(at).toLocaleDateString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function nextVote(
  tally: {
    readonly score: number;
    readonly up: number;
    readonly down: number;
    readonly mine: -1 | 0 | 1;
  },
  pressed: -1 | 1,
): {
  readonly score: number;
  readonly up: number;
  readonly down: number;
  readonly mine: -1 | 0 | 1;
} {
  const mine = tally.mine === pressed ? 0 : pressed;
  const up = tally.up - (tally.mine === 1 ? 1 : 0) + (mine === 1 ? 1 : 0);
  const down = tally.down - (tally.mine === -1 ? 1 : 0) + (mine === -1 ? 1 : 0);
  return { score: up - down, up, down, mine };
}
