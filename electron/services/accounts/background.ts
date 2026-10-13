import type { AccountRecord } from '@shared/accounts';

/**
 * The accounts not open now (Connection & Startup §1.4). They stay signed in — their refresh token is on disk — but
 * realtime, Drive sync, mail bodies and outboxes are paused ("Sync paused while another account is open"); queued
 * changes go when the account is opened again.
 *
 * A light poller per signed-in background account, every 5 minutes ±20 %, with its own AuthService, SecureStore and
 * HttpClient (no reachability hooks): the unread counts for the switcher's "3 new", and a refresh at least every
 * three days so the 14-day refresh token never lapses. One refresher per account (risk 3): `release` waits for a
 * poll under way before the account is handed to the active scope.
 */

export interface BackgroundClient {
  refresh: () => Promise<'ok' | 'offline' | 'lost'>;
  get: <T = unknown>(path: string) => Promise<T>;
  dispose: () => void;
}

export interface BackgroundDeps {
  account: (id: string) => AccountRecord | null;
  /** A client bound to the account's own profile (its secrets, its server). */
  client: (account: AccountRecord) => BackgroundClient;
  /** When the account's token was last refreshed (ms), and that it was now. */
  lastRefresh: (id: string) => number | null;
  setLastRefresh: (id: string, at: number) => void;
  onUnread: (id: string, unread: number, previous: number) => void;
  /** The account's session ended while in the background (refresh refused). */
  onSignedOut: (id: string) => void;
  intervalMs?: number;
  jitter?: number;
  refreshEveryMs?: number;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export const POLL_MS = 5 * 60_000;
export const REFRESH_EVERY_MS = 3 * 24 * 3600_000;

interface Entry {
  client: BackgroundClient;
  timer: unknown;
  inflight: Promise<void> | null;
  unread: number;
  stopped: boolean;
}

/** A count out of the shapes the two endpoints answer with: a number, `{count}`, `{unread}`, `{total}`. */
export function countOf(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['count', 'unread', 'total', 'unread_count']) if (typeof o[k] === 'number') return countOf(o[k]);
  }
  return 0;
}

export class BackgroundAccounts {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly d: BackgroundDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private delay(): number {
    const base = this.d.intervalMs ?? POLL_MS;
    const j = this.d.jitter ?? 0.2;
    return Math.round(base * (1 - j + 2 * j * (this.d.random ?? Math.random)()));
  }

  /** The account is in the background now: polled, if it is signed in. */
  adopt(id: string): void {
    if (this.entries.has(id)) return;
    const account = this.d.account(id);
    if (!account || account.signInState !== 'signed-in') return;
    const entry: Entry = { client: this.d.client(account), timer: null, inflight: null, unread: 0, stopped: false };
    this.entries.set(id, entry);
    this.schedule(id, entry);
  }

  private schedule(id: string, entry: Entry): void {
    if (entry.stopped) return;
    const set = this.d.setTimer ?? ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    });
    entry.timer = set(() => {
      void this.poll(id).finally(() => this.schedule(id, entry));
    }, this.delay());
  }

  /** One poll now (the timer's, or a test's). */
  poll(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.stopped) return Promise.resolve();
    if (entry.inflight) return entry.inflight;
    entry.inflight = (async () => {
      const last = this.d.lastRefresh(id);
      if (last === null || this.now() - last >= (this.d.refreshEveryMs ?? REFRESH_EVERY_MS)) {
        const r = await entry.client.refresh().catch(() => 'offline' as const);
        if (entry.stopped) return;
        if (r === 'lost') {
          this.stop(id);
          this.d.onSignedOut(id);
          return;
        }
        if (r === 'ok') this.d.setLastRefresh(id, this.now());
      }
      const [notes, chat] = await Promise.all([
        entry.client.get('/api/notifications/unread-count').then(countOf, () => null),
        entry.client.get('/api/chat/unread').then(countOf, () => null),
      ]);
      if (entry.stopped || (notes === null && chat === null)) return;
      const previous = entry.unread;
      entry.unread = (notes ?? 0) + (chat ?? 0);
      if (entry.unread !== previous) this.d.onUnread(id, entry.unread, previous);
    })().finally(() => {
      entry.inflight = null;
    });
    return entry.inflight;
  }

  private stop(id: string): Entry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    entry.stopped = true;
    if (entry.timer !== null) (this.d.clearTimer ?? ((t: unknown) => clearTimeout(t as NodeJS.Timeout)))(entry.timer);
    entry.timer = null;
    this.entries.delete(id);
    return entry;
  }

  /**
   * The account is about to be opened: its poller stops, and a refresh it has under way finishes first, so the
   * active scope never refreshes alongside it (refresh tokens rotate).
   */
  async release(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    const inflight = entry.inflight;
    this.stop(id);
    if (inflight) await inflight.catch(() => undefined);
    entry.client.dispose();
  }

  isPolled(id: string): boolean {
    return this.entries.has(id);
  }

  unread(id: string): number {
    return this.entries.get(id)?.unread ?? 0;
  }

  totalUnread(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e.unread;
    return n;
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stop(id)?.client.dispose();
  }
}
