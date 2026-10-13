interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #windows = new Map<string, Window>();

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  hit(key: string): boolean {
    const now = this.#now();
    if (this.#windows.size > 10_000) {
      for (const [entry, window] of this.#windows) {
        if (window.resetAt <= now) {
          this.#windows.delete(entry);
        }
      }
    }
    const window = this.#windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      this.#windows.set(key, { count: 1, resetAt: now + this.#windowMs });
      return true;
    }
    window.count += 1;
    return window.count <= this.#limit;
  }
}
