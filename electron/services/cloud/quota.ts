import { quotaLevel, type QuotaLevel, type StorageUsage } from '@shared/cloud';

/**
 * Storage quota for a Personal account (Connection & Startup §3 `quota.ts`, screens 12 and 13). [WP3]
 *
 * Polls `GET /api/v1/storage/usage` every 10 minutes and after uploads. Levels (shared/cloud.ts `quotaLevel`):
 * 70 % notice, 85 % a warning toast once, 95 % the banner, 100 % full. `QUOTA_EXCEEDED` at `/api/uploads/init` or
 * `POST /files/{id}/versions` puts transfers on `held:'quota'` (resumed when usage drops) and an OfficeExternal copy
 * in its `quota` state (screen 13). Nothing is ever deleted.
 *
 * While something waits for room (`exceeded()`), usage is asked for every 2 minutes instead of 10. `onRoom` is told
 * of every answer below full.
 */

export const QUOTA_POLL_MS = 10 * 60_000;
/** While uploads wait for room. */
export const QUOTA_HELD_POLL_MS = 2 * 60_000;

const RANK: Record<QuotaLevel, number> = { ok: 0, notice: 1, warning: 2, critical: 3, full: 4 };

export interface QuotaDeps {
  usage: () => Promise<StorageUsage>;
  onChange: (storage: { used: number; limit: number; level: QuotaLevel }) => void;
  /** The 85 % toast, once per crossing. */
  warn: (level: QuotaLevel) => void;
  /** There is room again after a QUOTA_EXCEEDED: held uploads and Office copies go on. */
  onRoom?: () => void;
}

export class QuotaWatcher {
  private last: { used: number; limit: number; level: QuotaLevel } | null = null;
  private latest: StorageUsage | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private warned = false;
  private waiting = false;
  private inflight: Promise<{ used: number; limit: number; level: QuotaLevel } | null> | null = null;

  constructor(private readonly deps: QuotaDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refresh();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.last = null;
    this.latest = null;
    this.warned = false;
    this.waiting = false;
  }

  /** The last known storage, or null before the first answer. */
  current(): { used: number; limit: number; level: QuotaLevel } | null {
    return this.last;
  }

  /** The last full usage document (screen 12's categories). */
  usage(): StorageUsage | null {
    return this.latest;
  }

  /** Something was refused with QUOTA_EXCEEDED: full until Cloud says otherwise, and asked more often. */
  exceeded(): void {
    this.waiting = true;
    if (!this.last || this.last.level !== 'full') this.apply({ used: Math.max(this.last?.limit ?? 0, this.last?.used ?? 0), limit: this.last?.limit ?? 0, level: 'full' });
    this.schedule();
  }

  /** Whether uploads are waiting for room. */
  holding(): boolean {
    return this.waiting;
  }

  /** Polls now (after an upload). Answers the last known value when Cloud cannot be asked. */
  refresh(): Promise<{ used: number; limit: number; level: QuotaLevel } | null> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        return this.take(await this.deps.usage());
      } catch {
        return this.last;
      } finally {
        this.inflight = null;
        this.schedule();
      }
    })();
    return this.inflight;
  }

  /** A usage answer from elsewhere (`cloud:storage`). */
  take(u: StorageUsage): { used: number; limit: number; level: QuotaLevel } {
    this.latest = u;
    const next = QuotaWatcher.levelOf(u);
    this.apply(next);
    // Below full: whatever waits for room goes on — also uploads held before a restart, which nobody told this
    // watcher about (`releaseQuota()` does nothing when nothing waits).
    if (next.level !== 'full') {
      this.waiting = false;
      this.deps.onRoom?.();
    }
    return next;
  }

  private apply(next: { used: number; limit: number; level: QuotaLevel }): void {
    const was = this.last;
    this.last = next;
    if (RANK[next.level] >= RANK.warning && !this.warned) {
      this.warned = true;
      this.deps.warn(next.level);
    } else if (RANK[next.level] < RANK.warning) {
      this.warned = false;
    }
    if (!was || was.used !== next.used || was.limit !== next.limit || was.level !== next.level) this.deps.onChange(next);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) return;
    this.timer = setTimeout(() => void this.refresh(), this.waiting ? QUOTA_HELD_POLL_MS : QUOTA_POLL_MS);
    this.timer.unref?.();
  }

  /** What a usage answer means, without polling. */
  static levelOf(u: Pick<StorageUsage, 'used' | 'limit'>): { used: number; limit: number; level: QuotaLevel } {
    return { used: u.used, limit: u.limit, level: quotaLevel(u.used, u.limit) };
  }
}
