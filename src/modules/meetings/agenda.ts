import { parseTs } from '../../core/time';
import type { AgendaItem } from './api';

/**
 * The shared agenda timer (W07, D08): the server keeps each item's status, when its running stretch started and the
 * seconds banked before it (`POST /api/meetings/{id}/agenda/{item}/timer`), so every screen that shows the agenda —
 * the meeting's Agenda tab, the always-on-top agenda window, Meet — reads the same clock off the same rows.
 */

/** Seconds spent on an item: what was banked, plus the stretch running now. */
export function elapsedOf(item: AgendaItem, now: number): number {
  const banked = item.elapsed_seconds ?? 0;
  if (item.status !== 'running' || !item.started_at) return banked;
  return banked + Math.max(0, (now - parseTs(item.started_at).getTime()) / 1000);
}

/** "4:05", "12:30"; a negative span is said as nothing spent. */
export function mmss(s: number): string {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

export interface AgendaClock {
  /** The live item: the one running, else the one paused part-way, else the next not started. Null when all are done. */
  item: AgendaItem | null;
  /** Its place in the agenda, from 1. */
  number: number;
  running: boolean;
  /** Seconds spent on it, and planned for it. */
  elapsed: number;
  planned: number;
  /** Seconds left; negative once it overruns. */
  remaining: number;
  overrun: boolean;
  /** How far through its time it is, 0–1 (1 once overrun). */
  progress: number;
  /** What Next item moves on to. */
  next: AgendaItem | null;
  done: number;
  total: number;
}

const ordered = (items: AgendaItem[]) => [...items].sort((a, b) => a.position - b.position || a.id - b.id);
const settled = (a: AgendaItem) => a.status === 'done' || a.status === 'skipped';

/** Where the agenda stands at `now`. */
export function agendaClock(items: AgendaItem[], now: number): AgendaClock {
  const list = ordered(items);
  const item = list.find((a) => a.status === 'running') ?? list.find((a) => !settled(a) && (a.elapsed_seconds ?? 0) > 0) ?? list.find((a) => !settled(a)) ?? null;
  const index = item ? list.indexOf(item) : -1;
  const elapsed = item ? elapsedOf(item, now) : 0;
  const planned = item ? Math.max(0, (item.minutes || 0) * 60) : 0;
  const remaining = planned - elapsed;
  const overrun = !!item && planned > 0 && remaining < 0;
  return {
    item,
    number: index + 1,
    running: item?.status === 'running',
    elapsed,
    planned,
    remaining,
    overrun,
    progress: !item ? 1 : planned > 0 ? Math.min(1, elapsed / planned) : 0,
    next: index >= 0 ? (list.slice(index + 1).find((a) => !settled(a)) ?? null) : null,
    done: list.filter((a) => a.status === 'done').length,
    total: list.length,
  };
}

/** The time a clock face shows: what is left, or "+2:05" over. */
export function clockFace(c: Pick<AgendaClock, 'remaining' | 'overrun' | 'planned' | 'elapsed'>): string {
  if (c.overrun) return `+${mmss(-c.remaining)}`;
  return c.planned > 0 ? mmss(c.remaining) : mmss(c.elapsed);
}

export type TimerAction = 'start' | 'pause' | 'done' | 'skip' | 'reset';

/**
 * The timer calls one button makes, in order. Pause or resume the live item; Next item finishes it (when it was
 * started) and starts the one after.
 */
export function timerSteps(c: AgendaClock, button: 'toggle' | 'next'): Array<{ itemId: number; action: TimerAction }> {
  if (!c.item) return [];
  if (button === 'toggle') return [{ itemId: c.item.id, action: c.running ? 'pause' : 'start' }];
  const steps: Array<{ itemId: number; action: TimerAction }> = [{ itemId: c.item.id, action: c.running || c.elapsed > 0 ? 'done' : 'skip' }];
  if (c.next) steps.push({ itemId: c.next.id, action: 'start' });
  return steps;
}
