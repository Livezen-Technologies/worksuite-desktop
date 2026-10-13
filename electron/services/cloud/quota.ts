import { quotaLevel, type QuotaLevel, type StorageUsage } from '@shared/cloud';

/**
 * Storage quota for a Personal account (Connection & Startup §3 `quota.ts`, screens 12 and 13). [WP3]
 *
 * Polls `GET /api/v1/storage/usage` every 10 minutes and after uploads. Levels (shared/cloud.ts `quotaLevel`):
 * 70 % notice, 85 % a warning toast once, 95 % the banner, 100 % full. `QUOTA_EXCEEDED` at `/api/uploads/init` or
 * `POST /files/{id}/versions` puts transfers on `held:'quota'` (resumed when usage drops) and an OfficeExternal copy
 * in its `quota` state (screen 13). Nothing is ever deleted.
 */

export const QUOTA_POLL_MS = 10 * 60_000;

export interface QuotaDeps {
  usage: () => Promise<StorageUsage>;
  onChange: (storage: { used: number; limit: number; level: QuotaLevel }) => void;
  /** The 85 % toast, once per crossing. */
  warn: (level: QuotaLevel) => void;
}

export class QuotaWatcher {
  private last: { used: number; limit: number; level: QuotaLevel } | null = null;

  constructor(private readonly deps: QuotaDeps) {}

  start(): void {
    void this.deps;
  }

  stop(): void {}

  /** Polls now (after an upload). Stub: the last known value. */
  async refresh(): Promise<{ used: number; limit: number; level: QuotaLevel } | null> {
    return this.last;
  }

  /** What a usage answer means, without polling. */
  static levelOf(u: Pick<StorageUsage, 'used' | 'limit'>): { used: number; limit: number; level: QuotaLevel } {
    return { used: u.used, limit: u.limit, level: quotaLevel(u.used, u.limit) };
  }
}
