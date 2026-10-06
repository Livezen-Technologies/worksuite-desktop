import { globalShortcut } from 'electron';
import { CALLBACK_SNOOZE_MINUTES, callbackNotice, callbackRoute, callbacksToday, dueCallbacks, NEXT_CONTACT_ROUTE, NEXT_CONTACT_SHORTCUT, stampMs, type CallbackDue, type MarketingOutputs, type MarketingTray } from '@shared/marketing';
import { logger } from '../main/log';
import type { IpcRouter } from '../ipc/router';
import type { Incoming } from './notifications';

const log = logger('marketing');

/**
 * Marketing on the desktop (src/modules/marketing; WS-MKT-SRS-001 D01, MKT-DSK-01, MKT-CAL-12): what the web cannot
 * do for a call agent.
 *
 *  - **Callback reminders to the minute** (G-01, desktop half): the person's callbacks are read every few minutes
 *    (`GET /api/marketing/queue/callbacks`) and a timer is kept for each one due in the next hours, so the native
 *    notification — "Callback due · Iresha Dias", with Call now and Snooze 15 min — comes at the minute whether or not
 *    a Marketing tab is open. The callback itself stays the Task the server made; a snooze is this computer's alone.
 *  - **Next contact from anywhere**: a global shortcut, held while the person may work a call queue
 *    (marketing.call.make), that opens My call queue and claims the next contact.
 *  - **Tray counts**: waiting in the queue, callbacks today, campaigns sending now.
 *
 * Everything goes through WorkSuite's own answers; a server without an endpoint (an older Marketing module) leaves
 * that part quiet rather than failing the rest.
 */
export interface MarketingDeps {
  http: { get<T>(path: string, opts?: { query?: Record<string, string | number | boolean | null | undefined> }): Promise<T> };
  /** Signed in and Marketing is one of the person's apps. */
  allowed: () => boolean;
  /** The person holds marketing.call.make (or is a super-admin). */
  canCall: () => boolean;
  notify: (n: Incoming) => void;
  /** Opens a route in the main window through the app's navigation (it waits for an unlock, refuses what is not allowed). */
  openRoute: (route: string) => void;
  onTray: (t: MarketingTray | null) => void;
  /** Shortcut registration, replaceable in tests. */
  shortcuts?: { register(acc: string, fn: () => void): boolean; unregister(acc: string): void };
  /** Time, replaceable in tests. */
  clock?: { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void };
}

/** How often the main process looks again on its own. */
export const POLL_MS = 5 * 60_000;
/** Reminders are timed for callbacks due within this window; later ones are timed at a later look. */
export const HORIZON_MS = 6 * 3_600_000;
const MAX_TIMER_MS = 2_147_000_000;

type Path = 'callbacks' | 'queue' | 'sending';

export class MarketingService {
  private readonly keys: NonNullable<MarketingDeps['shortcuts']>;
  private readonly clock: NonNullable<MarketingDeps['clock']>;
  private poller: unknown = null;
  private shortcutHeld = false;
  private wantShortcut = false;
  /** One timer per callback, keyed by id and due time (a moved callback is a new reminder). */
  private timers = new Map<string, unknown>();
  /** Reminders already shown, so a later look does not show them again. */
  private shown = new Set<string>();
  /** Snoozed until (ms), per reminder key. */
  private snoozed = new Map<string, number>();
  private fired = 0;
  /** Endpoints the server answered 404/405/501 for: not asked again this session. */
  private missing = new Set<Path>();
  private polling: Promise<void> | null = null;
  /** Bumped on every reset: a look started before it (another person's, before a sign-out) keeps nothing it found. */
  private generation = 0;
  private last: MarketingTray | null = null;

  constructor(private readonly d: MarketingDeps) {
    this.keys = d.shortcuts ?? { register: (acc, fn) => globalShortcut.register(acc, fn), unregister: (acc) => globalShortcut.unregister(acc) };
    this.clock = d.clock ?? {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
    };
  }

  /** Signed in with Marketing: start looking (idempotent). */
  start(): void {
    if (!this.d.allowed()) return this.reset();
    if (this.poller === null) this.poller = this.clock.setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
    this.syncShortcut();
  }

  /** Signed out, locked out of Marketing, or the app went away: nothing held, nothing timed, nothing in the tray. */
  reset(): void {
    this.generation++;
    this.polling = null;
    if (this.poller !== null) this.clock.clearInterval(this.poller);
    this.poller = null;
    for (const t of this.timers.values()) this.clock.clearTimeout(t);
    this.timers.clear();
    this.shown.clear();
    this.snoozed.clear();
    this.missing.clear();
    this.wantShortcut = false;
    this.syncShortcut();
    this.last = null;
    this.d.onTray(null);
  }

  /** The page says whether the person works a call queue; the shortcut is held only then. */
  configure(input: { shortcut: boolean }): MarketingOutputs['marketing:configure'] {
    this.wantShortcut = input.shortcut;
    this.syncShortcut();
    if (this.last) this.publish({ ...this.last, shortcut: this.shortcutHeld ? NEXT_CONTACT_SHORTCUT : null });
    return { shortcut: this.shortcutHeld };
  }

  /**
   * Look again now (a callback booked, an outcome saved). A look already running started before that change, so its
   * answer may not show it: this one waits for it, then looks again.
   */
  refresh(): Promise<void> {
    const running = this.polling;
    return running ? running.then(() => this.poll()) : this.poll();
  }

  /** The tray's Next contact, the shortcut, and a reminder's Call now. */
  nextContact(): void {
    if (!this.d.allowed()) return;
    this.d.openRoute(NEXT_CONTACT_ROUTE);
  }

  register(router: IpcRouter): void {
    router.handle('marketing:configure', (input) => this.configure(input));
    router.handle('marketing:refresh', () => this.refresh());
  }

  private syncShortcut(): void {
    const want = this.wantShortcut && this.d.allowed() && this.d.canCall();
    if (want && !this.shortcutHeld) {
      try {
        this.shortcutHeld = this.keys.register(NEXT_CONTACT_SHORTCUT, () => this.nextContact());
        if (!this.shortcutHeld) log.info('next-contact shortcut taken by another app', { acc: NEXT_CONTACT_SHORTCUT });
      } catch {
        this.shortcutHeld = false;
      }
    } else if (!want && this.shortcutHeld) {
      this.keys.unregister(NEXT_CONTACT_SHORTCUT);
      this.shortcutHeld = false;
    }
  }

  private poll(): Promise<void> {
    if (this.polling) return this.polling;
    const gen = this.generation;
    const p = this.look(gen).finally(() => {
      if (this.polling === p) this.polling = null;
    });
    this.polling = p;
    return p;
  }

  private async look(gen: number): Promise<void> {
    if (!this.d.allowed()) return this.reset();
    const now = this.clock.now();
    const canCall = this.d.canCall();
    const [callbacks, queue, sending] = await Promise.all([
      this.ask<unknown>('callbacks', '/api/marketing/queue/callbacks'),
      canCall ? this.ask<{ waiting?: unknown }>('queue', '/api/marketing/queue') : Promise.resolve(null),
      this.ask<unknown>('sending', '/api/marketing/campaigns', { status: 'sending', per_page: 5 }),
    ]);
    // Signed out (or reset) while asking: nothing of the answers is kept, even if somebody else is signed in by now.
    if (gen !== this.generation || !this.d.allowed()) return;
    if (callbacks !== null) this.schedule(dueCallbacks(callbacks, now, HORIZON_MS), now);
    const rows = sendingRows(sending);
    const first = rows.find((r) => typeof r.progress === 'number');
    this.publish({
      queue: canCall && queue && typeof queue.waiting === 'number' ? queue.waiting : canCall && queue ? 0 : null,
      callbacksToday: callbacks !== null ? callbacksToday(callbacks, now) : 0,
      sending: { count: rows.length, progress: first && typeof first.progress === 'number' ? first.progress : null },
      shortcut: this.shortcutHeld ? NEXT_CONTACT_SHORTCUT : null,
    });
  }

  private publish(t: MarketingTray): void {
    this.last = t;
    this.d.onTray(t);
  }

  /** An answer, or null when the server has no such endpoint, refuses it, or cannot be reached. */
  private async ask<T>(what: Path, path: string, query?: Record<string, string | number>): Promise<T | null> {
    if (this.missing.has(what)) return null;
    try {
      return await this.d.http.get<T>(path, query ? { query } : undefined);
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 404 || status === 405 || status === 501) {
        this.missing.add(what);
        log.debug('not offered by this server', { what });
      } else log.debug('marketing look failed', { what, error: String(e) });
      return null;
    }
  }

  /** Times a reminder for each callback not yet shown; drops timers for callbacks that went away or moved. */
  private schedule(due: CallbackDue[], now: number): void {
    const keep = new Set<string>();
    for (const c of due) {
      const key = `${c.id}@${c.dueAt}`;
      keep.add(key);
      if (this.shown.has(key) || this.timers.has(key)) continue;
      const at = this.snoozed.get(key) ?? stampMs(c.dueAt) ?? now;
      this.time(key, c, at - now);
    }
    // A callback no longer listed (done, moved, or given to someone else) rings no more, snoozed or not.
    for (const [key, t] of this.timers) {
      if (keep.has(key)) continue;
      this.clock.clearTimeout(t);
      this.timers.delete(key);
      this.snoozed.delete(key);
    }
    for (const key of this.snoozed.keys()) if (!keep.has(key)) this.snoozed.delete(key);
  }

  private time(key: string, c: CallbackDue, ms: number): void {
    const h = this.clock.setTimeout(() => {
      this.timers.delete(key);
      this.fire(key, c);
    }, Math.min(MAX_TIMER_MS, Math.max(0, ms)));
    this.timers.set(key, h);
  }

  private fire(key: string, c: CallbackDue): void {
    if (!this.d.allowed()) return;
    this.shown.add(key);
    this.snoozed.delete(key);
    const { title, body } = callbackNotice(c);
    this.d.notify({
      // A new id for each showing, so a snoozed reminder comes back.
      id: `marketing-callback:${c.id}:${++this.fired}`,
      module: 'marketing',
      category: 'marketing',
      title,
      body,
      sender: null,
      // A click on the banner opens the queue; only Call now claims, and it claims this callback.
      link: '/marketing/queue',
      critical: false,
      buttons: {
        labels: ['Call now', `Snooze ${CALLBACK_SNOOZE_MINUTES} min`],
        onAction: (index) => (index === 0 ? this.callNow(c) : this.snooze(key, c)),
      },
    });
  }

  /** Call now: My call queue, claiming the reminded callback. */
  private callNow(c: CallbackDue): void {
    if (!this.d.allowed()) return;
    this.d.openRoute(callbackRoute(c));
  }

  /** Snooze 15 min: the same reminder again then, on this computer. */
  snooze(key: string, c: CallbackDue): void {
    if (!this.d.allowed()) return;
    const at = this.clock.now() + CALLBACK_SNOOZE_MINUTES * 60_000;
    this.snoozed.set(key, at);
    this.shown.delete(key);
    const old = this.timers.get(key);
    if (old !== undefined) this.clock.clearTimeout(old);
    this.time(key, c, at - this.clock.now());
  }
}

/** The campaigns sending now, from a page of `GET /api/marketing/campaigns?status=sending`. */
function sendingRows(raw: unknown): Array<{ progress?: unknown }> {
  if (Array.isArray(raw)) return raw as Array<{ progress?: unknown }>;
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const rows = o ? (Array.isArray(o.data) ? o.data : Array.isArray(o.items) ? o.items : Array.isArray(o.rows) ? o.rows : []) : [];
  return rows.filter((r): r is { progress?: unknown } => !!r && typeof r === 'object');
}
