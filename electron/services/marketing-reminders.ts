import { logger } from '../main/log';
import type { CallbackNotice, Incoming } from './notifications';
import { nextContactRoute } from './marketing-shortcut';

const log = logger('marketing-reminders');

/**
 * Callback reminders to the minute (WS-MKT-SRS-001 MKT-CAL-12, MKT-DSK-01; the D01 design's "Callback due · Iresha
 * Dias" banner with Call now and Snooze 15 min).
 *
 * An agent who promised "call me after 2 pm" gets a native notification at 2 pm, from this computer's own clock: the
 * callbacks still to make (`GET /api/marketing/calls/callbacks`, mine) are read every two minutes while somebody with
 * Marketing is signed in, and each is given a timer for its time. A timer is never set further ahead than ten minutes
 * (it is set again then: a computer that slept, or a clock that drifted, does not make a reminder late), the timers are
 * set again when the computer wakes, and a sweep every thirty seconds catches anything a timer missed.
 *
 * Each promise — a queue row and its time — rings once. A callback moved to another time is a new promise and rings
 * at its new time; one made or handed to somebody else leaves the list and its timer goes. One missed by more than an
 * hour (the computer was off) is not announced late: it waits first in the queue, and in Callbacks, as "Due now".
 *
 * The banner goes through the notification service like every other, so notifications off, Marketing muted, paused,
 * Do not disturb, what banners may show and the lock all apply. "Call now" opens My call queue's workspace on that
 * campaign, where the due callback comes first; "Snooze 15 min" rings it again a quarter of an hour later, on this
 * computer only — the callback's time and its task stay as they were.
 */

/** A callback as the server lists it (`Calls::callbacks`). `at` is a UTC stamp, "2026-10-06 08:30:00". */
export interface CallbackItem {
  queue_id: number;
  at: string;
  contact_id: number;
  name: string;
  phone: string | null;
  campaign_id: number;
  campaign: string;
  assignee: { id: number; name: string | null } | null;
  notes: string | null;
}

export const POLL_MS = 2 * 60_000;
export const SWEEP_MS = 30_000;
/** The longest a timer is set for: it is set again after it. */
export const MAX_DELAY_MS = 10 * 60_000;
/** A callback missed by more than this is not announced. */
export const LATE_MS = 60 * 60_000;
export const SNOOZE_MS = 15 * 60_000;

/** A server stamp as milliseconds: naive stamps are UTC (the server's clock); NaN when it is not a time. */
export function utcMs(stamp: string): number {
  if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(stamp)) return Number.NaN;
  const iso = stamp.replace(' ', 'T');
  return Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
}

const oneLine = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The banner for a callback that is due: "Callback due · Iresha Dias", "Vendor follow-up calls · “Call after 2 pm”". */
export function callbackNotice(c: CallbackItem, o: { nonce: number; snooze?: number }): Incoming {
  const notes = c.notes ? oneLine(c.notes, 120) : '';
  return {
    id: `callback:${c.queue_id}:${c.at}${o.snooze ? `:s${o.snooze}` : ''}`,
    module: 'marketing',
    category: 'marketing',
    title: `Callback due · ${c.name}`,
    body: [c.campaign, notes ? `“${notes}”` : null].filter(Boolean).join(' · ') || 'A call you promised is due now.',
    sender: c.name,
    link: nextContactRoute({ nonce: o.nonce, campaign: c.campaign_id }),
    critical: false,
    callback: { queueId: c.queue_id, at: c.at },
  };
}

interface Entry {
  item: CallbackItem;
  due: number;
  /** 0 for the promise itself, then 1, 2… for each snooze. */
  snooze: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface CallbackRemindersDeps {
  get: <T>(path: string, query?: Record<string, string>) => Promise<T>;
  notify: (n: Incoming) => void;
  /** Signed in, and Marketing among the apps this person may open. */
  allowed: () => boolean;
  now?: () => number;
  every?: number;
  sweepEvery?: number;
}

const promiseKey = (c: Pick<CallbackItem, 'queue_id' | 'at'>): string => `${c.queue_id}|${c.at}`;
const entryKey = (c: Pick<CallbackItem, 'queue_id' | 'at'>, snooze: number): string => `${promiseKey(c)}|${snooze}`;

export class CallbackReminders {
  private entries = new Map<string, Entry>();
  /** Entries that have rung (or were too late to): never again, until signed out. */
  private done = new Set<string>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<void> | null = null;
  /** The entries that rang lately, kept so a banner's Snooze still finds its callback. */
  private rung = new Map<string, Entry>();
  /** How many times each promise was snoozed: each snooze is an entry, and a banner, of its own. */
  private snoozes = new Map<string, number>();

  constructor(private readonly deps: CallbackRemindersDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  start(): void {
    this.stop();
    void this.refresh();
    this.poll = setInterval(() => void this.refresh(), this.deps.every ?? POLL_MS);
    this.poll.unref?.();
    this.sweeper = setInterval(() => this.sweep(), this.deps.sweepEvery ?? SWEEP_MS);
    this.sweeper.unref?.();
  }

  /** Signed out or quitting: every timer goes, and what rang is forgotten with the person. */
  stop(): void {
    if (this.poll) clearInterval(this.poll);
    if (this.sweeper) clearInterval(this.sweeper);
    this.poll = null;
    this.sweeper = null;
    this.clear();
    this.done.clear();
    this.snoozes.clear();
  }

  /** Ask the list again now (the person's apps changed). Nothing while stopped. */
  poke(): void {
    if (this.poll) void this.refresh();
  }

  /** Back from sleep: timers set again from the clock as it is now, and the list asked again. */
  resume(): void {
    if (!this.poll) return;
    for (const [k, e] of this.entries) this.arm(k, e);
    void this.refresh();
  }

  /** What is waiting to ring, soonest first (for diagnostics and tests). */
  pending(): Array<{ queueId: number; at: string; due: number; snooze: number }> {
    return [...this.entries.values()].sort((a, b) => a.due - b.due).map((e) => ({ queueId: e.item.queue_id, at: e.item.at, due: e.due, snooze: e.snooze }));
  }

  refresh(): Promise<void> {
    this.busy ??= this.load().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  /** "Snooze 15 min" on a banner: the same callback rings again in a quarter of an hour, on this computer. */
  snooze(c: CallbackNotice): void {
    const base = [...this.entries.values(), ...this.rung.values()].find((e) => e.item.queue_id === c.queueId && e.item.at === c.at);
    if (!base || !this.poll) return;
    const pk = promiseKey(base.item);
    const n = (this.snoozes.get(pk) ?? 0) + 1;
    this.snoozes.set(pk, n);
    const k = entryKey(base.item, n);
    const e: Entry = { item: base.item, due: this.now() + SNOOZE_MS, snooze: n, timer: null };
    this.entries.set(k, e);
    this.arm(k, e);
  }

  private async load(): Promise<void> {
    if (!this.deps.allowed()) {
      this.clear();
      return;
    }
    let items: CallbackItem[];
    try {
      const r = await this.deps.get<{ items?: CallbackItem[] }>('/api/marketing/calls/callbacks');
      items = Array.isArray(r?.items) ? r.items.filter((c) => c && Number.isSafeInteger(c.queue_id) && typeof c.at === 'string') : [];
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      // No call queue for this person (403), or no Marketing on this server (404): nothing to remind of.
      if (status === 403 || status === 404) this.clear();
      // Offline: what is set stays set, and rings on time.
      else log.debug('callbacks unavailable', { status: typeof status === 'number' ? status : null });
      return;
    }
    if (!this.deps.allowed()) return this.clear();
    const now = this.now();
    const promised = new Set(items.map(promiseKey));
    // Made, moved or handed on: its timers (and its snoozes) go.
    for (const [k, e] of this.entries) {
      if (!promised.has(promiseKey(e.item))) this.drop(k);
    }
    for (const [k, e] of this.rung) if (!promised.has(promiseKey(e.item))) this.rung.delete(k);
    for (const pk of this.snoozes.keys()) if (!promised.has(pk)) this.snoozes.delete(pk);
    for (const item of items) {
      const k = entryKey(item, 0);
      if (this.done.has(k)) continue;
      const due = utcMs(item.at);
      if (Number.isNaN(due)) continue;
      if (due < now - LATE_MS) {
        // Long past (the computer was off): not news now; it waits first in the queue.
        this.done.add(k);
        continue;
      }
      const was = this.entries.get(k);
      const e: Entry = { item, due, snooze: 0, timer: was?.timer ?? null };
      this.entries.set(k, e);
      this.arm(k, e);
    }
  }

  /** A timer for the entry: at its time, or in ten minutes to be set again — whichever comes first. */
  private arm(k: string, e: Entry): void {
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    const wait = e.due - this.now();
    if (wait <= 0) {
      this.ring(k);
      return;
    }
    e.timer = setTimeout(() => {
      e.timer = null;
      if (e.due <= this.now()) this.ring(k);
      else this.arm(k, e);
    }, Math.min(wait, MAX_DELAY_MS));
    e.timer.unref?.();
  }

  /** The backstop: anything due that a timer has not rung yet. */
  sweep(): void {
    const now = this.now();
    for (const [k, e] of [...this.entries]) if (e.due <= now) this.ring(k);
  }

  private ring(k: string): void {
    const e = this.entries.get(k);
    if (!e) return;
    this.drop(k);
    if (this.done.has(k)) return;
    this.done.add(k);
    if (this.done.size > 2000) this.done = new Set([...this.done].slice(-1000));
    this.rung.set(k, e);
    if (this.rung.size > 50) this.rung.delete(this.rung.keys().next().value as string);
    if (!this.deps.allowed()) return;
    try {
      this.deps.notify(callbackNotice(e.item, { nonce: this.now(), snooze: e.snooze }));
    } catch (error) {
      log.debug('callback reminder not shown', { error: String(error) });
    }
  }

  private drop(k: string): void {
    const e = this.entries.get(k);
    if (e?.timer) clearTimeout(e.timer);
    this.entries.delete(k);
  }

  private clear(): void {
    for (const k of [...this.entries.keys()]) this.drop(k);
    this.rung.clear();
  }
}
