/**
 * A bandwidth cap shared by every transfer going one way (worksuite-desktop#95):
 * a token bucket that fills at the cap, holding up to one second of it. Each
 * transfer takes what it is about to send or has just received; when the bucket
 * runs short the taker waits for the deficit to fill, so however many files
 * move at once, together they keep to the cap. A part bigger than the bucket
 * is allowed through and paid for by waiting afterwards — the average holds.
 */
export interface ThrottleClock {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const realClock: ThrottleClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', stop);
        resolve();
      }, ms);
      const stop = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new Error('aborted'));
      };
      signal?.addEventListener('abort', stop, { once: true });
    }),
};

export class TokenBucket {
  private tokens = 0;
  private at: number;

  /** `rate` in bytes a second; null is no cap. */
  constructor(
    private rate: number | null = null,
    private readonly clock: ThrottleClock = realClock,
  ) {
    this.at = clock.now();
    this.tokens = rate ?? 0;
  }

  get limit(): number | null {
    return this.rate;
  }

  /** A new cap takes effect at once, for the transfers already moving too. */
  setRate(rate: number | null): void {
    if (rate === this.rate) return;
    this.refill();
    this.rate = rate && rate > 0 ? rate : null;
    // Whatever was owed under the old cap is forgiven; a full second of the new one is there to start.
    this.tokens = this.rate ?? 0;
  }

  /** How long, in milliseconds, taking `n` bytes now would have to wait (without taking them). */
  wouldWait(n: number): number {
    if (!this.rate) return 0;
    this.refill();
    const left = this.tokens - n;
    return left >= 0 ? 0 : Math.ceil((-left / this.rate) * 1000);
  }

  /** Take `n` bytes from the bucket, waiting as long as the cap needs. */
  async take(n: number, signal?: AbortSignal): Promise<void> {
    if (!this.rate || n <= 0) return;
    this.refill();
    this.tokens -= n;
    if (this.tokens >= 0) return;
    await this.clock.sleep(Math.ceil((-this.tokens / this.rate) * 1000), signal);
  }

  private refill(): void {
    const now = this.clock.now();
    if (this.rate) this.tokens = Math.min(this.rate, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
  }
}
