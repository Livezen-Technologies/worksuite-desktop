import { Notification } from 'electron';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import { WEBSITE } from './webchat-ring';

const log = logger('live-desk');

/**
 * The Live dashboard on this computer, outside the main window (worksuite-desktop L-04, L-05; WS-WCHAT MAP-UI-04/05):
 *
 * - the figures the menu-bar and tray icon carry — "18 · 2 waiting", red while somebody is at risk (MAP-22) — read here
 *   every twenty seconds, so they are right with the main window closed;
 * - an at-risk chat as a system notification with Join and Show on map, raised on the device that rings, as Focus
 *   allows, and withdrawn when somebody joins (MAP-23);
 * - which screen "Wall mode on Display 2" opens on (MAP-24).
 */

/** What the icon needs from GET /dashboard (WidgetAdminController::dashboard `now`). */
export interface LivePulseFigures {
  /** On the sites now. */
  online: number;
  /** Waiting on us (the visitor spoke last), on every site I cover. */
  waiting: number;
  /** At risk now. */
  atRisk: number;
}

export const PULSE_MS = 20_000;

/**
 * Asks the dashboard how many are on the sites now, every twenty seconds while somebody who staffs website chat is
 * signed in. A refusal (not website staff, an older server) stops it until the next sign-in: the icon then says only
 * what it said before L-05.
 */
export class LivePulse {
  private timer: NodeJS.Timeout | null = null;
  private figures: LivePulseFigures | null = null;
  private refused = false;
  private running = false;

  constructor(
    private readonly deps: {
      http: HttpClient;
      /** Signed in, with Chat (website chats are Chat's). */
      allowed: () => boolean;
      onChanged: (figures: LivePulseFigures | null) => void;
    },
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.refused = false;
    void this.read();
    this.timer = setInterval(() => void this.read(), PULSE_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.set(null);
  }

  get(): LivePulseFigures | null {
    return this.figures;
  }

  /** Asked again now (the tray opening, say). */
  async read(): Promise<void> {
    if (!this.running || this.refused) return;
    if (!this.deps.allowed()) return this.set(null);
    try {
      const d = await this.deps.http.get<{ now?: { visitors_online?: unknown; waiting_on_us?: unknown; at_risk?: unknown } }>(`${WEBSITE}/dashboard`);
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
      this.set({ online: n(d.now?.visitors_online), waiting: n(d.now?.waiting_on_us), atRisk: n(d.now?.at_risk) });
    } catch (e) {
      if (isDesktopError(e) && (e.status === 403 || e.status === 404)) {
        this.refused = true;
        this.set(null);
        return;
      }
      // Offline for a moment: the last figures stay until the next answer.
      log.debug('dashboard not read', { error: String(e) });
    }
  }

  private set(f: LivePulseFigures | null): void {
    const same = (a: LivePulseFigures | null, b: LivePulseFigures | null) => a === b || (!!a && !!b && a.online === b.online && a.waiting === b.waiting && a.atRisk === b.atRisk);
    if (same(this.figures, f)) return;
    this.figures = f;
    this.deps.onChanged(f);
  }
}

/** The menu-bar title (MAP-UI-04, MAP-22): "18 · 2 waiting" — on the sites, and waiting on me as the badge counts them. */
export function liveTitle(online: number, waiting: number): string {
  return `${online} · ${waiting} waiting`;
}

/** "3:12": minutes and seconds since a server stamp (true UTC without a zone). */
export function waitedClock(since: string, now = Date.now()): string {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(since) ? since : `${since.replace(' ', 'T')}Z`);
  const s = Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The at-risk notification in the design's words (MAP-UI-04): "Anne · Acme Ltd is at risk — 3:12 in Kandy", and what
 * they last wrote, quoted.
 */
export function atRiskNotice(c: Pick<WebchatRingChat, 'visitor' | 'place' | 'since' | 'preview'>, now = Date.now()): { title: string; body: string } {
  const town = c.place?.split(',')[0]?.trim() || null;
  const title = `${c.visitor} is at risk — ${waitedClock(c.since, now)}${town ? ` in ${town}` : ''}`;
  const said = c.preview?.trim() ?? '';
  const body = said ? `“${said.length > 80 ? `${said.slice(0, 79).trimEnd()}…` : said}”` : 'Website chats';
  return { title, body };
}

/** The notification's buttons, in the design's words (MAP-23). */
export const AT_RISK_ACTIONS = ['Join', 'Show on map'] as const;

export interface AtRiskDeps {
  /** Notifications are on, WorkSuite is not locked, and the person has Chat. */
  allowed: () => boolean;
  /** Do not disturb or Focus is on now. */
  quiet: () => boolean;
  /** What happens during Do not disturb (RING-47): the card only (default), the tone at risk, or as usual. */
  duringDnd: () => 'card' | 'at_risk' | 'ring';
  /** Sound on for notifications. */
  sound: () => boolean;
  join: (conversationId: number) => void;
  showOnMap: (conversationId: number) => void;
}

/**
 * An at-risk chat as a system notification (MAP-23): once per chat, on the device the server has ring (RING-10), with
 * Join and Show on map; silent during Focus when the person keeps Focus to the card alone (RING-47); withdrawn as soon
 * as it no longer rings for me — somebody joined, or the visitor left.
 */
export class AtRiskAlerts {
  private shown = new Map<number, Notification>();
  /** Raised once each: one closed by hand is not raised again while the chat is still at risk. */
  private raised = new Set<number>();

  constructor(private readonly deps: AtRiskDeps) {}

  update(s: Pick<WebchatRingState, 'chats' | 'hidden' | 'ringHere'>): void {
    const atRisk = s.hidden ? [] : s.chats.filter((c) => c.atRisk);
    const still = new Set(atRisk.map((c) => c.id));
    for (const [id, note] of this.shown) {
      if (still.has(id)) continue;
      note.close();
      this.shown.delete(id);
    }
    for (const id of this.raised) if (!still.has(id)) this.raised.delete(id);
    // Another of my devices rings (RING-10): it raises the notification, not this one.
    if (s.ringHere === false || !this.deps.allowed() || !Notification.isSupported()) return;
    for (const c of atRisk) if (!this.raised.has(c.id)) this.raise(c);
  }

  /** Everything withdrawn: signed out, or locked. */
  clear(): void {
    for (const note of this.shown.values()) note.close();
    this.shown.clear();
    this.raised.clear();
  }

  private raise(c: WebchatRingChat): void {
    this.raised.add(c.id);
    const { title, body } = atRiskNotice(c);
    const silent = !this.deps.sound() || (this.deps.quiet() && this.deps.duringDnd() === 'card');
    const note = new Notification({ title, body, silent, urgency: 'critical', timeoutType: 'never', actions: AT_RISK_ACTIONS.map((text) => ({ type: 'button' as const, text })) });
    note.on('action', (_e, index) => {
      if (index === 0) this.deps.join(c.id);
      else this.deps.showOnMap(c.id);
    });
    // The banner itself shows where they are; joining takes a button (accepting is not undone by a stray click).
    note.on('click', () => this.deps.showOnMap(c.id));
    note.on('close', () => {
      if (this.shown.get(c.id) === note) this.shown.delete(c.id);
    });
    this.shown.set(c.id, note);
    note.show();
  }
}

/**
 * Which screen "Wall mode on Display 2" opens on (MAP-UI-05, MAP-24): the first that is not the main one — named by
 * its place in the system's list and by the screen's own name when the system says it ("LG 27″") — or the main one
 * when there is only one.
 */
export function wallTarget(displays: Array<{ id: number; label?: string }>, primaryId: number): { id: number; display: string; name: string | null } | null {
  if (!displays.length) return null;
  const i = Math.max(0, displays.findIndex((d) => d.id !== primaryId));
  const d = displays.length > 1 ? displays[i]! : displays[0]!;
  const at = displays.indexOf(d);
  return { id: d.id, display: `Display ${at + 1}`, name: d.label?.trim() || null };
}
