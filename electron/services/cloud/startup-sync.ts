import { CLOUD_API } from '@shared/cloud';
import { DEFAULT_STARTUP, mergeStartup, readStartupConfig, startupConfigV1, type LocalStartupPolicy, type StartupConfig } from '@shared/startup-config';
import { logger } from '../../main/log';

const log = logger('startup-sync');

/**
 * Keeping the startup screen's configuration current (ENH-AUTH-01 §3).
 *
 * The screen itself is drawn before anybody is signed in, from the discovery document, which is already cached.
 * This is the other half: once a Personal account is signed in, the organization's own policy is asked for at
 * `/api/v1/desktop/auth-config` and again every few hours, so a change made in the Admin Center reaches a running
 * app without a restart.
 *
 * Three rules hold whatever the network does:
 *  - the last good configuration is kept, so an unreachable server changes nothing;
 *  - `config_version` only ever rises, so a stale answer cannot undo a newer publish;
 *  - local policy is applied over the answer, exactly as it is over the discovery document.
 */

export const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;

export interface Cached {
  config: StartupConfig;
  version: number;
  /** When it was fetched (epoch ms), so a caller can say how old it is. */
  at: number;
  organizationId: string | null;
}

export interface SyncDeps {
  /** A GET against the signed-in account's Cloud API; null when nobody is signed in. */
  get: <T>(path: string) => Promise<T> | null;
  /** This computer's local policy — managed.json, policy.json, the registry, a setup link. */
  policy: () => LocalStartupPolicy | null;
  /** What was read from the discovery document: the floor this starts from. */
  fromDiscovery: () => StartupConfig;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (t: unknown) => void;
}

interface Answer {
  startup?: unknown;
  organization_id?: string | null;
}

export class StartupSync {
  private cached: Cached | null = null;
  private timer: unknown = null;
  private readonly now: () => number;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** The configuration to draw with: the newest of what was synced and what discovery said, under local policy. */
  current(): StartupConfig {
    const discovery = this.deps.fromDiscovery();
    const synced = this.cached;
    const base = synced && synced.version >= (discovery.config_version ?? 0) ? synced.config : discovery;
    return mergeStartup(base, this.deps.policy());
  }

  /** What is known about the last sync, for the settings screen and for tests. */
  state(): Cached | null {
    return this.cached;
  }

  /**
   * Asks the server once. Returns the configuration in force afterwards. A failure, an unreadable answer or an
   * older `config_version` leaves what was already there — this never makes the screen worse than it was.
   */
  async refresh(): Promise<StartupConfig> {
    const pending = this.deps.get<Answer>(CLOUD_API.desktopAuthConfig);
    if (!pending) return this.current();
    try {
      const answer = await pending;
      const parsed = startupConfigV1.safeParse((answer as Answer)?.startup ?? null);
      if (!parsed.success) {
        log.warn('the server answered something unreadable; keeping the configuration in force');
        return this.current();
      }
      const next = parsed.data;
      if (this.cached && next.config_version < this.cached.version) return this.current();
      this.cached = { config: next, version: next.config_version, at: this.now(), organizationId: (answer as Answer)?.organization_id ?? null };
    } catch (e) {
      log.warn('could not reach the server; keeping the configuration in force', e);
    }
    return this.current();
  }

  /** Refresh now and every SYNC_EVERY_MS after it. Safe to call again: the old timer is dropped. */
  start(): void {
    this.stop();
    void this.refresh();
    const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    const t = set(() => void this.refresh(), SYNC_EVERY_MS);
    (t as { unref?: () => void }).unref?.();
    this.timer = t;
  }

  stop(): void {
    if (!this.timer) return;
    const clear = this.deps.clearTimer ?? ((t: unknown) => clearInterval(t as NodeJS.Timeout));
    clear(this.timer);
    this.timer = null;
  }

  /** Signing out, or switching to an account somewhere else: the synced copy no longer applies. */
  forget(): void {
    this.cached = null;
  }
}

/** The startup configuration a discovery document carries, under this computer's local policy. */
export function startupFromDiscovery(doc: unknown, policy: LocalStartupPolicy | null): StartupConfig {
  return mergeStartup(readStartupConfig(doc) ?? DEFAULT_STARTUP, policy);
}
