/**
 * Exponential backoff with full jitter. Used by realtime reconnects
 * (1 s → 60 s, FR-RT-02), the service supervisor (1 s → 5 min, §3.2) and
 * transfer retries.
 */
export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** 0 disables jitter; 1 is full jitter. */
  jitter?: number;
}

export function backoffDelay(attempt: number, opts: BackoffOptions, random: () => number = Math.random): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, attempt));
  const j = opts.jitter ?? 1;
  if (j <= 0) return exp;
  const floor = exp * (1 - j);
  return Math.round(floor + random() * (exp - floor));
}

/**
 * Sliding-window restart limiter: at most `max` events inside `windowMs`.
 * The supervisor marks a helper FAILED once this trips (5 restarts / 10 min).
 */
export class WindowLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records an event; returns false when the limit is exceeded. */
  hit(now = Date.now()): boolean {
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    this.stamps.push(now);
    return this.stamps.length <= this.max;
  }

  count(now = Date.now()): number {
    return this.stamps.filter((t) => now - t < this.windowMs).length;
  }

  reset(): void {
    this.stamps = [];
  }
}
