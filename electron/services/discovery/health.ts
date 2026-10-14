import type { ConnectionHealth, HealthState, ServiceHealthState } from '@shared/accounts';
import { backoffDelay } from '@shared/backoff';

/**
 * The service banner's health monitor (Connection & Startup §2 "Health monitor", screens 15 and 16). [WP2; WP1
 * wires it in place of the fixed 15 s `/api/auth/config` probe in index.ts.]
 *
 * Probes `endpoints.health ?? <apiOrigin>/api/health` (10 s timeout) with `shared/backoff.ts` `backoffDelay`: base
 * 5 s, ×2, jitter, capped at 300 s. Tells apart `offline` (no internet), `unreachable` (DNS / TCP failure while the
 * internet works) and `unavailable` (5xx / 503 from the gateway, honouring Retry-After). `retryNow()` is
 * `connection:reconnect`.
 */

export interface HealthMonitorDeps {
  /** The URL to probe for the active account, or null when there is none. */
  healthUrl: () => string | null;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Whether the computer has internet at all. */
  internetOnline: () => boolean;
  onChange: (state: ServiceHealthState) => void;
  now?: () => number;
  /** For `components()`: the other endpoints of the active account (absent ones are not checked). */
  componentUrls?: () => Partial<Record<'auth' | 'realtime' | 'files' | 'office', string | null>>;
  /** For `components()`: Drive sync's own state. */
  syncHealth?: () => { state: HealthState; detail: string } | null;
  /** Jitter source (tests). */
  random?: () => number;
  /** How often a healthy service is probed (default 60 s). */
  okIntervalMs?: number;
}

/** All is well until something says otherwise. */
export const HEALTHY: ServiceHealthState = Object.freeze({ state: 'ok', label: '', since: null, nextRetryAt: null, workOffline: false }) as ServiceHealthState;

export const HEALTH_BACKOFF = { baseMs: 5_000, maxMs: 300_000, jitter: 0.5 } as const;
const PROBE_TIMEOUT_MS = 10_000;

const LABELS: Record<'offline' | 'unreachable' | 'unavailable', string> = {
  offline: 'You are offline. Changes are saved on this computer and sent when you are back online.',
  unreachable: 'WorkSuite cannot be reached. Check your network or company VPN.',
  unavailable: 'WorkSuite is temporarily unavailable. Your work is safe; WorkSuite will retry automatically.',
};

/** Retry-After as milliseconds (seconds or an HTTP date), or null. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** The delay before retry `attempt` (0-based): backoff, at least Retry-After, never above 300 s. */
export function retryDelay(attempt: number, retryAfterMs: number | null, random: () => number = Math.random): number {
  const backoff = backoffDelay(attempt, HEALTH_BACKOFF, random);
  return Math.min(HEALTH_BACKOFF.maxMs, Math.max(backoff, retryAfterMs ?? 0));
}

type Probe = { state: 'ok' } | { state: 'unavailable'; retryAfterMs: number | null } | { state: 'unreachable' } | { state: 'offline' };

export class HealthMonitor {
  private current: ServiceHealthState = { ...HEALTHY };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private running = false;
  private probing: Promise<ServiceHealthState> | null = null;
  private epoch = 0;

  constructor(private readonly deps: HealthMonitorDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Starts probing (at once). */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Probes now and resets the backoff. */
  async retryNow(): Promise<ServiceHealthState> {
    this.attempt = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.tick();
  }

  /** "Work Offline" on the banner. */
  setWorkOffline(on: boolean): void {
    this.set({ ...this.current, workOffline: on });
  }

  state(): ServiceHealthState {
    return this.current;
  }

  private set(next: ServiceHealthState): void {
    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;
    if (changed) this.deps.onChange(next);
  }

  /** One probe of `url`. */
  private async probe(url: string): Promise<Probe> {
    if (!this.deps.internetOnline()) return { state: 'offline' };
    let res: Response;
    try {
      res = await this.deps.fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    } catch {
      // The request never got an answer; the computer may have lost its internet meanwhile.
      return this.deps.internetOnline() ? { state: 'unreachable' } : { state: 'offline' };
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 500 || res.status === 429) {
      return { state: 'unavailable', retryAfterMs: parseRetryAfter(res.headers.get('retry-after'), this.now()) };
    }
    return { state: 'ok' };
  }

  private tick(): Promise<ServiceHealthState> {
    if (this.probing) return this.probing;
    const epoch = this.epoch;
    this.probing = (async () => {
      const url = this.deps.healthUrl();
      const p: Probe = url ? await this.probe(url) : { state: 'ok' };
      if (epoch !== this.epoch) return this.current;
      const now = this.now();
      if (p.state === 'ok') {
        this.attempt = 0;
        this.set({ ...HEALTHY, workOffline: this.current.workOffline });
        this.schedule(this.deps.okIntervalMs ?? 60_000);
      } else {
        const delay = retryDelay(this.attempt, p.state === 'unavailable' ? p.retryAfterMs : null, this.deps.random);
        this.attempt++;
        const since = this.current.state === 'ok' ? new Date(now).toISOString() : (this.current.since ?? new Date(now).toISOString());
        this.set({ state: p.state, label: LABELS[p.state], since, nextRetryAt: new Date(now + delay).toISOString(), workOffline: this.current.workOffline });
        this.schedule(delay);
      }
      return this.current;
    })().finally(() => {
      this.probing = null;
    });
    return this.probing;
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, ms);
    this.timer.unref?.();
  }

  /** Settings › Accounts & Servers › Connection health. */
  async components(accountId: string): Promise<ConnectionHealth> {
    const unknown = { state: 'unknown' as const, detail: '' };
    const asHealth = async (url: string | null | undefined): Promise<{ state: HealthState; detail: string }> => {
      if (!url) return { ...unknown, detail: 'Not used by this server' };
      if (/^wss?:/i.test(url)) return { ...unknown, detail: 'Checked when connected' };
      const t0 = this.now();
      const p = await this.probe(url);
      const ms = this.now() - t0;
      switch (p.state) {
        case 'ok':
          return { state: 'healthy', detail: `${ms} ms` };
        case 'unavailable':
          return { state: 'down', detail: 'Temporarily unavailable' };
        case 'unreachable':
          return { state: 'down', detail: 'Cannot be reached' };
        default:
          return { state: 'down', detail: 'Offline' };
      }
    };
    const urls = this.deps.componentUrls?.() ?? {};
    const [api, auth, realtime, files, office] = await Promise.all([
      asHealth(this.deps.healthUrl()),
      asHealth(urls.auth),
      asHealth(urls.realtime),
      asHealth(urls.files),
      asHealth(urls.office),
    ]);
    return {
      accountId,
      checkedAt: new Date(this.now()).toISOString(),
      components: { api, auth, realtime, files, office, sync: this.deps.syncHealth?.() ?? unknown },
    };
  }
}
