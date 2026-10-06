import { SUPPORT_API, slaShort, supportHint, type Badges, type Ticket, type TicketPage } from '@shared/support';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import type { RealtimeEvent } from './realtime';

const log = logger('support-desk');

/**
 * The desk in the tray / menu bar (WS-SUPPORT-SRS-001 D-05, FR-DSK-04, FR-WSP-02, FR-SLA-07): my numbers and the
 * next SLAs due, read with the main window closed, for the tray menu.
 *
 *  - My numbers: open, due today and at risk from `GET dashboard/mine` (the agent home strip); unassigned (my
 *    queues), overdue and unread from `GET badges`, which the banners' service already asks every minute
 *    (support-notices.ts) and hands over here. A server without `dashboard/mine` yet answers 404: then open and at
 *    risk are the badges' (`assigned_open`, `at_risk`) and "due today" is not shown; it is asked again ten minutes
 *    later.
 *  - Next SLA due: my four live tickets whose SLA comes due soonest (`GET tickets?view=mine&sort=sla`); a click opens
 *    the ticket's quick-reply window (D-04). Any of them breached puts the red dot on the icon.
 *  - Availability: Online or Away — Chat's presence, the one routing reads (as the inbox's switch).
 *
 * Asked when the session starts, every minute, after the desk's hints (once for a burst) and when the badges change.
 * Hints are hints: everything is read again through the API.
 */

export const PULSE_POLL_MS = 60_000;
export const PULSE_DEBOUNCE_MS = 2_500;
const NO_DASHBOARD_RECHECK_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 10_000;
/** How many of the soonest SLAs the tray lists (D-05: "four soonest deadlines"). */
export const NEXT_DUE = 4;

export interface SupportDue {
  id: number;
  reference: string;
  subject: string;
  requester: string;
  /** "Next 18m", "Res overdue 5m", "Paused": the SLA chip's words. */
  sla: string | null;
  breached: boolean;
}

export interface SupportPulseFigures {
  open: number;
  /** Null on a server without `dashboard/mine`: not shown rather than guessed. */
  dueToday: number | null;
  atRisk: number;
  unassigned: number | null;
  overdue: number | null;
  unread: number;
  /** One of my tickets has missed its SLA: the icon's red dot (D-05 badge rule). */
  breached: boolean;
  next: SupportDue[];
  /** Chat's presence for the Online / Away switch; null for somebody without it. */
  presence: 'available' | 'away' | 'busy' | 'dnd' | 'offline' | null;
  /** When these were read (ISO): "Synced 09:42". */
  syncedAt: string;
}

export interface Dashboard {
  open: number;
  due_today: number;
  at_risk: number;
}

const num = (v: unknown): number => Math.max(0, Math.floor(Number(v)) || 0);

/** The tray's figures from what the server answered: the dashboard where it has one, else the badges. */
export function pulseFrom(dash: Partial<Dashboard> | null, badges: Partial<Badges> | null, mine: Ticket[], presence: SupportPulseFigures['presence'], now: number): SupportPulseFigures {
  const next: SupportDue[] = mine.slice(0, NEXT_DUE).map((t) => ({
    id: t.id,
    reference: t.reference,
    subject: t.subject,
    requester: t.requester?.name || t.requester?.email || '',
    sla: slaShort(t.sla, now),
    breached: t.sla?.state === 'breached',
  }));
  return {
    open: dash ? num(dash.open) : num(badges?.assigned_open),
    dueToday: dash && dash.due_today !== undefined ? num(dash.due_today) : null,
    atRisk: dash ? num(dash.at_risk) : num(badges?.at_risk),
    unassigned: badges ? num(badges.unassigned) : null,
    overdue: badges ? num(badges.overdue) : null,
    unread: num(badges?.unread),
    breached: next.some((n) => n.breached),
    next,
    presence,
    syncedAt: new Date(now).toISOString(),
  };
}

/** The ticket "Quick reply to latest" opens: my newest with something unread, else the next SLA due, else my newest. */
export function latestTicket(recent: Ticket[], next: SupportDue[]): number | null {
  return recent.find((t) => t.unread > 0)?.id ?? next[0]?.id ?? recent[0]?.id ?? null;
}

export interface SupportDeskDeps {
  http: HttpClient;
  /** Whether the person has the Support app. */
  enabled: () => boolean;
  /** The badges the banners' service read last (support-notices.ts), or null. */
  badges: () => Badges | null;
  onChanged: () => void;
}

export class SupportDesk {
  private figures: SupportPulseFigures | null = null;
  private running = false;
  private poll: NodeJS.Timeout | null = null;
  private nudge: NodeJS.Timeout | null = null;
  private noDashboardUntil = 0;
  private generation = 0;
  private reading: Promise<void> | null = null;

  constructor(private readonly d: SupportDeskDeps) {}

  start(): void {
    this.stop();
    this.running = true;
    void this.refresh();
    this.poll = setInterval(() => void this.refresh(), PULSE_POLL_MS);
    this.poll.unref?.();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.poll) clearInterval(this.poll);
    if (this.nudge) clearTimeout(this.nudge);
    this.poll = this.nudge = null;
    this.reading = null;
    this.noDashboardUntil = 0;
    if (this.figures) {
      this.figures = null;
      this.d.onChanged();
    }
  }

  /** The figures for the tray, or null (signed out, no Support, not read yet). */
  get(): SupportPulseFigures | null {
    return this.running && this.d.enabled() ? this.figures : null;
  }

  /** The desk's and a ticket's hints: read again, once for a burst. Presence says nothing about the numbers. */
  handle(e: RealtimeEvent): void {
    if (!this.running) return;
    const h = supportHint(e);
    if (h && h.type !== 'support.presence') this.soon();
  }

  /** The badges changed (the banners' service read them): the rest is read again soon. */
  soon(): void {
    if (!this.running || this.nudge) return;
    this.nudge = setTimeout(() => {
      this.nudge = null;
      void this.refresh();
    }, PULSE_DEBOUNCE_MS);
    this.nudge.unref?.();
  }

  refresh(): Promise<void> {
    if (!this.running || !this.d.enabled()) return Promise.resolve();
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async read(): Promise<void> {
    const gen = this.generation;
    const http = this.d.http;
    const opts = { timeoutMs: READ_TIMEOUT_MS };
    const dashboard = async (): Promise<Dashboard | null> => {
      if (Date.now() < this.noDashboardUntil) return null;
      try {
        return await http.get<Dashboard>(`${SUPPORT_API}/dashboard/mine`, opts);
      } catch (e) {
        // Not on this server yet: the badges stand in, and it is asked again later.
        if (isDesktopError(e) && (e.status === 404 || e.status === 405)) this.noDashboardUntil = Date.now() + NO_DASHBOARD_RECHECK_MS;
        else throw e;
        return null;
      }
    };
    try {
      const [dash, page, me] = await Promise.all([
        dashboard(),
        http.get<TicketPage>(`${SUPPORT_API}/tickets`, { ...opts, query: { view: 'mine', sort: 'sla', limit: NEXT_DUE } }),
        http.get<{ status?: string; choice?: string }>('/api/chat/presence/me', opts).catch(() => null),
      ]);
      if (gen !== this.generation || !this.running) return;
      const choice = me?.choice ?? me?.status ?? null;
      const presence = choice === 'available' || choice === 'away' || choice === 'busy' || choice === 'dnd' || choice === 'offline' ? choice : me ? 'available' : null;
      this.figures = pulseFrom(dash, this.d.badges(), page?.items ?? [], presence, Date.now());
      this.d.onChanged();
    } catch (e) {
      // Out of reach or refused: the last figures stay until the next answer.
      log.debug('support figures unavailable', { code: isDesktopError(e) ? e.code : String(e) });
    }
  }

  /** "Quick reply to latest" (⌃⌥R): which ticket. Null when there is none, or it could not be read. */
  async latest(): Promise<number | null> {
    if (!this.running || !this.d.enabled()) return null;
    try {
      const page = await this.d.http.get<TicketPage>(`${SUPPORT_API}/tickets`, { timeoutMs: READ_TIMEOUT_MS, query: { view: 'mine', sort: 'updated', limit: 20 } });
      return latestTicket(page?.items ?? [], this.figures?.next ?? []);
    } catch (e) {
      log.debug('latest support ticket unavailable', { code: isDesktopError(e) ? e.code : String(e) });
      return this.figures?.next[0]?.id ?? null;
    }
  }

  /** Online or Away from the tray: Chat's presence, as the inbox's switch sets it. */
  async setPresence(status: 'available' | 'away'): Promise<void> {
    try {
      await this.d.http.post('/api/chat/presence', { status, active: true });
      if (this.figures) {
        this.figures = { ...this.figures, presence: status };
        this.d.onChanged();
      }
    } catch (e) {
      log.info('availability not set from the tray', { code: isDesktopError(e) ? e.code : String(e) });
    }
  }
}
