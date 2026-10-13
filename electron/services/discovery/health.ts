import type { ConnectionHealth, ServiceHealthState } from '@shared/accounts';

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
}

/** All is well until something says otherwise. */
export const HEALTHY: ServiceHealthState = Object.freeze({ state: 'ok', label: '', since: null, nextRetryAt: null, workOffline: false }) as ServiceHealthState;

export class HealthMonitor {
  private current: ServiceHealthState = { ...HEALTHY };

  constructor(private readonly deps: HealthMonitorDeps) {}

  /** Starts probing. Stub: does nothing. */
  start(): void {
    void this.deps;
  }

  stop(): void {}

  /** Probes now and resets the backoff. Stub: the current state. */
  async retryNow(): Promise<ServiceHealthState> {
    return this.current;
  }

  /** "Work Offline" on the banner. */
  setWorkOffline(on: boolean): void {
    this.current = { ...this.current, workOffline: on };
  }

  state(): ServiceHealthState {
    return this.current;
  }

  /** Settings › Accounts & Servers › Connection health. Stub: every component unknown. */
  async components(accountId: string): Promise<ConnectionHealth> {
    const unknown = { state: 'unknown' as const, detail: '' };
    return {
      accountId,
      checkedAt: new Date((this.deps.now ?? Date.now)()).toISOString(),
      components: { api: unknown, auth: unknown, realtime: unknown, files: unknown, office: unknown, sync: unknown },
    };
  }
}
