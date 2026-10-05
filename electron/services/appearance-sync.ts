import type { AppearancePrefs } from '@shared/theme-profiles';
import { logger } from '../main/log';

const log = logger('appearance');

/**
 * Colour profiles between a person's devices (worksuite-desktop#234), in the per-user preferences every WorkSuite
 * screen uses (`GET|PUT /api/prefs/desktop.appearance`, a row of `user_prefs`) — no server change needed. This
 * computer's copy is the one in force (it is read before the first paint); the newer of the two (`updatedAt`) wins
 * when they meet, and a change made here is sent a moment later. Offline, what is here stands.
 */
export const APPEARANCE_SCOPE = 'desktop.appearance';
const PATH = `/api/prefs/${APPEARANCE_SCOPE}`;
/** How long a change waits before it is sent, so a few clicks make one request. */
export const APPEARANCE_SEND_DELAY_MS = 800;

export interface AppearanceSyncDeps {
  http: { get<T = unknown>(path: string): Promise<T>; request<T = unknown>(method: string, path: string, opts?: { body?: unknown }): Promise<T> };
  settings: { appearance(): AppearancePrefs; applyRemoteAppearance(remote: unknown): boolean; onChange(fn: () => void): () => void };
  /** Signed in to a server (guest mode has none). */
  online: () => boolean;
}

export class AppearanceSync {
  /** The `updatedAt` the server is known to have. */
  private synced = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pulling: Promise<void> | null = null;
  /** The server's copy has been read since signing in: until then nothing is sent, so an older copy here cannot
   *  overwrite a newer one from another device. */
  private pulled = false;

  constructor(private readonly deps: AppearanceSyncDeps) {
    deps.settings.onChange(() => this.changed());
  }

  /** At sign-in and with each bootstrap: the server's copy, when newer; else this one goes up. */
  pull(): Promise<void> {
    if (!this.deps.online()) return Promise.resolve();
    if (this.pulling) return this.pulling;
    this.pulling = (async () => {
      try {
        const res = await this.deps.http.get<{ prefs?: unknown } | null>(PATH);
        const remote = res?.prefs as Partial<AppearancePrefs> | null | undefined;
        const remoteAt = typeof remote?.updatedAt === 'number' ? remote.updatedAt : 0;
        this.pulled = true;
        if (remote && this.deps.settings.applyRemoteAppearance(remote)) {
          this.synced = remoteAt;
          return;
        }
        this.synced = Math.max(this.synced, remoteAt);
        if ((this.deps.settings.appearance().updatedAt ?? 0) > remoteAt) await this.push();
      } catch (e) {
        log.debug('appearance not synced', { error: String((e as Error)?.message ?? e) });
      } finally {
        this.pulling = null;
      }
    })();
    return this.pulling;
  }

  private changed(): void {
    if (!this.deps.online()) {
      this.pulled = false;
      this.synced = 0;
      return;
    }
    const at = this.deps.settings.appearance().updatedAt ?? 0;
    if (!this.pulled || at <= this.synced) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.push().catch(() => undefined);
    }, APPEARANCE_SEND_DELAY_MS);
  }

  /** Sends this computer's copy now. */
  async push(): Promise<void> {
    if (!this.deps.online() || !this.pulled) return;
    const prefs = this.deps.settings.appearance();
    if (!prefs.updatedAt || prefs.updatedAt <= this.synced) return;
    await this.deps.http.request('PUT', PATH, { body: { prefs } });
    this.synced = Math.max(this.synced, prefs.updatedAt);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
