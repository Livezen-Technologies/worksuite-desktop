import type { ReactNode } from 'react';
import { dayKey, parseTs } from '../../../core/time';
import type { KitMessage } from './model';

/**
 * Day dividers and runs of messages (C-02; worksuite-desktop#229). A run is one author, in one role, on one side of
 * the staff-only line, each message within `gapMs` of the one before, with no notice or page visit between. The first
 * bubble of a run carries the avatar and name, the last its time; the corners between them tighten so a run reads as
 * one block.
 */

/** Something drawn in the list that is not a message (an upload on its way): it keeps its place and breaks a run. */
export interface KitSlot {
  slot: true;
  key: string;
  time: number;
  node: ReactNode;
}

export type KitItem = KitMessage | KitSlot;

export const isSlot = (x: KitItem): x is KitSlot => 'slot' in x;

export type Position = 'single' | 'first' | 'middle' | 'last';

export type KitRow =
  | { type: 'day'; key: string; day: string }
  | { type: 'line'; key: string; message: KitMessage }
  | { type: 'group'; key: string; messages: KitMessage[] }
  | { type: 'slot'; key: string; slot: KitSlot };

export const GROUP_GAP_MS = 5 * 60_000;

const dayOf = (m: KitMessage) => {
  const d = parseTs(m.at);
  return Number.isNaN(d.getTime()) ? '' : dayKey(d);
};

/** Whether `m` continues the run `prev` is in. */
export function continues(prev: KitMessage, m: KitMessage, gapMs = GROUP_GAP_MS): boolean {
  return (
    prev.kind === 'text' &&
    m.kind === 'text' &&
    prev.own === m.own &&
    prev.author.role === m.author.role &&
    String(prev.author.id ?? prev.author.name) === String(m.author.id ?? m.author.name) &&
    !!prev.internal === !!m.internal &&
    m.time - prev.time <= gapMs
  );
}

export function groupMessages(items: KitItem[], { gapMs = GROUP_GAP_MS }: { gapMs?: number } = {}): KitRow[] {
  const rows: KitRow[] = [];
  let day: string | null = null;
  let run: Extract<KitRow, { type: 'group' }> | null = null;
  for (const item of items) {
    if (isSlot(item)) {
      rows.push({ type: 'slot', key: item.key, slot: item });
      run = null;
      continue;
    }
    const d = dayOf(item);
    if (d && d !== day) {
      rows.push({ type: 'day', key: `day-${d}`, day: d });
      day = d;
      run = null;
    }
    if (item.kind !== 'text') {
      rows.push({ type: 'line', key: item.key, message: item });
      run = null;
      continue;
    }
    const last = run?.messages[run.messages.length - 1];
    if (run && last && continues(last, item, gapMs)) run.messages.push(item);
    else {
      run = { type: 'group', key: `g-${item.key}`, messages: [item] };
      rows.push(run);
    }
  }
  return rows;
}

/** Where a message sits in its run. */
export function positionIn(count: number, index: number): Position {
  if (count <= 1) return 'single';
  if (index === 0) return 'first';
  return index === count - 1 ? 'last' : 'middle';
}

export const isFirst = (p: Position) => p === 'single' || p === 'first';
export const isLast = (p: Position) => p === 'single' || p === 'last';
