import { canOpenRoute, canOpenWebPath, type VisibleApps } from '@shared/access';
import { DesktopError } from './errors';
import { logger } from './log';

const log = logger('access');

/** What a refusal says (the renderer says the same, core/access). */
export const NO_ACCESS = "You don't have access to this.";

/** A web path the browser is asked to open: refused when it belongs to an app the person may not open. */
export function assertWebPath(path: string, visible: VisibleApps): void {
  if (!canOpenWebPath(path, visible)) throw new DesktopError('APP_ACCESS_DENIED', NO_ACCESS);
}

/** A desktop route a window is asked to show: refused when it belongs to an app the person may not open. */
export function assertRoute(route: string, visible: VisibleApps): void {
  if (!canOpenRoute(route, visible)) throw new DesktopError('APP_ACCESS_DENIED', NO_ACCESS);
}

/** Realtime events after which the person's apps may have changed. */
export const ACCESS_EVENTS: ReadonlySet<string> = new Set(['access.changed', 'profile.updated']);

/** How often the bootstrap is asked again while signed in and online, in case an event was missed. */
export const ACCESS_REFRESH_MS = 10 * 60_000;

export interface AccessWatchDeps {
  /** Fetches the bootstrap again (SessionController.refreshBootstrap). */
  refresh: () => Promise<unknown>;
  /** Signed in (not expired, not locked out). */
  ready: () => boolean;
  /** The server answers. */
  online: () => boolean;
  intervalMs?: number;
}

/**
 * Keeps what the person may open current. The server publishes
 * `access.changed` to a person whose apps changed (and `profile.updated`
 * when their profile did); either fetches the bootstrap again, and so does a
 * check every ten minutes while signed in and online. A new bootstrap reaches
 * every window (`session:changed`), whose Shell closes the tabs of any app
 * that left, and the tray, menu, notifications and offline cache follow it.
 */
export class AccessWatch {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: AccessWatchDeps) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => {
      if (this.deps.ready() && this.deps.online()) void this.refresh('interval');
    }, this.deps.intervalMs ?? ACCESS_REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A realtime event: refreshes when it is one that can change access. Returns whether it did. */
  onEvent(e: { type?: unknown }): boolean {
    if (typeof e.type !== 'string' || !ACCESS_EVENTS.has(e.type) || !this.deps.ready()) return false;
    void this.refresh(e.type);
    return true;
  }

  /**
   * One refresh at a time. An ask while one runs is not dropped: that one may
   * have been answered before the change, so it runs once more after it.
   */
  refresh(why: string): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const run = async (): Promise<void> => {
      do {
        this.again = false;
        try {
          await this.deps.refresh();
        } catch (e) {
          log.debug('bootstrap refresh failed', { why, error: String(e) });
        }
      } while (this.again && this.deps.ready());
    };
    this.inFlight = run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
}
