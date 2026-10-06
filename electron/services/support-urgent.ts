import { SUPPORT_API, supportHint, type Ticket, type TicketPage } from '@shared/support';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';
import type { RealtimeEvent } from './realtime';

const log = logger('support-urgent');

/**
 * The incoming urgent ticket pop-up (WS-SUPPORT-SRS-001 D-07, FR-DSK-03, FR-NTF-03): a new urgent ticket nobody has
 * yet, in my queues, rings as a centred card that takes the focus — Take it, Assign…, Dismiss. Normal tickets keep to
 * the banners and the badge.
 *
 * The server raises no notification for an unassigned urgent ticket (the SRS's `support.urgent_unassigned`), and the
 * desk's hint carries no ticket id, so the desk is asked: on a desk hint (once for a burst) and every minute, for the
 * unassigned urgent tickets I can see, newest first (`GET tickets?view=unassigned&priority=urgent&sort=created`). One
 * raised in the last fifteen minutes that has not rung here rings — one card at a time, the next when it closes.
 *
 *  - Taken or assigned by anybody (here or elsewhere): its card closes at the next look, as the others' do when I
 *    take it (FR-ASN-03).
 *  - Dismiss stops it ringing for me; the ticket stays unassigned and keeps escalating (FR-SLA-06).
 *  - Each ticket rings once on this computer. Not while locked, signed out, without the desk, or with the pop-up
 *    turned off (Notification settings › Support). Quiet hours and Pause do not silence it: urgent rings (FR-NTF-06).
 */

export const URGENT_POLL_MS = 60_000;
export const URGENT_DEBOUNCE_MS = 1_500;
/** How new an unassigned urgent ticket must be to ring: older ones are the desk's, not news. */
export const RING_WINDOW_MS = 15 * 60_000;
const READ_TIMEOUT_MS = 10_000;

export interface SupportUrgentDeps {
  http: HttpClient;
  /** Signed in with the desk, unlocked, and the pop-up on. */
  allowed: () => boolean;
  /** Shows the card for a ticket. */
  ring: (ticketId: number) => void;
  /** Takes the card down (its ticket was taken, or ringing is no longer allowed). */
  close: () => void;
  now?: () => number;
}

/** The tickets that should ring now, oldest of them first, from the desk's unassigned urgent tickets. */
export function toRing(items: Ticket[], rung: ReadonlySet<number>, now: number): number[] {
  return items
    .filter((t) => !t.assignee && t.priority === 'urgent' && !rung.has(t.id) && !t.deleted_at)
    .filter((t) => {
      const at = Date.parse(t.created_at ?? t.opened_at ?? '');
      return Number.isFinite(at) && now - at <= RING_WINDOW_MS;
    })
    .map((t) => t.id)
    .reverse();
}

export class SupportUrgent {
  private rung = new Set<number>();
  private queue: number[] = [];
  private showing: number | null = null;
  private running = false;
  private poll: NodeJS.Timeout | null = null;
  private nudge: NodeJS.Timeout | null = null;
  private generation = 0;

  constructor(private readonly d: SupportUrgentDeps) {}

  start(): void {
    this.stop();
    this.running = true;
    void this.check();
    this.poll = setInterval(() => void this.check(), URGENT_POLL_MS);
    this.poll.unref?.();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.poll) clearInterval(this.poll);
    if (this.nudge) clearTimeout(this.nudge);
    this.poll = this.nudge = null;
    this.queue = [];
    this.rung.clear();
    if (this.showing !== null) {
      this.showing = null;
      this.d.close();
    }
  }

  /** The ticket whose card is up, or null. */
  current(): number | null {
    return this.showing;
  }

  /** The desk's and a ticket's hints: look again, once for a burst. */
  handle(e: RealtimeEvent): void {
    if (!this.running) return;
    const h = supportHint(e);
    if (!h || h.type === 'support.presence' || this.nudge) return;
    this.nudge = setTimeout(() => {
      this.nudge = null;
      void this.check();
    }, URGENT_DEBOUNCE_MS);
    this.nudge.unref?.();
  }

  /** The card closed — taken, assigned, dismissed, or replaced: the next one, if any still waits. */
  closed(ticketId: number): void {
    if (this.showing !== ticketId) return;
    this.showing = null;
    if (this.queue.length) void this.check();
  }

  async check(): Promise<void> {
    if (!this.running) return;
    if (!this.d.allowed()) {
      if (this.showing !== null) {
        this.showing = null;
        this.d.close();
      }
      return;
    }
    const gen = this.generation;
    let items: Ticket[];
    try {
      const page = await this.d.http.get<TicketPage>(`${SUPPORT_API}/tickets`, { timeoutMs: READ_TIMEOUT_MS, query: { view: 'unassigned', priority: 'urgent', sort: 'created', limit: 10 } });
      items = page?.items ?? [];
    } catch (e) {
      log.debug('urgent tickets unavailable', { code: isDesktopError(e) ? e.code : String(e) });
      return;
    }
    if (gen !== this.generation || !this.running) return;
    const waiting = new Set(items.filter((t) => !t.assignee).map((t) => t.id));
    // Somebody took the one ringing: its card goes, as everybody else's does.
    if (this.showing !== null && !waiting.has(this.showing)) {
      this.showing = null;
      this.d.close();
    }
    this.queue = this.queue.filter((id) => waiting.has(id));
    for (const id of toRing(items, this.rung, (this.d.now ?? Date.now)())) if (!this.queue.includes(id)) this.queue.push(id);
    if (this.showing === null && this.queue.length) {
      const next = this.queue.shift()!;
      this.rung.add(next);
      if (this.rung.size > 500) this.rung.delete(this.rung.values().next().value!);
      this.showing = next;
      this.d.ring(next);
    }
  }
}
