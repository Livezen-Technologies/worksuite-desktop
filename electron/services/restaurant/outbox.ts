import { createHash } from 'node:crypto';
import type { RestaurantOutboxItem } from '@shared/restaurant';

/**
 * The till's outbox, as rules with no database in them (Restaurant SRS
 * §4.3, RM-ARC-020..023).
 *
 * What the till did while WorkSuite was out of reach — an order, lines added
 * to one, a send to the kitchen — waits here in the order it was done and is
 * played back through `POST sync` when the line is back. The server takes each
 * once: every item carries the device's reference (`client_ref`), an order its
 * uuid and every line its `client_line_id`, so a queue sent twice, or cut off
 * halfway and sent again, makes each order, line and ticket once (`replayed`).
 *
 * What the server cannot take as it was is never lost and never silently
 * changed: it answers `conflict` — the sale kept, off a table somebody else
 * seated, or an item sold while it was unavailable — and a manager settles it
 * (`sync/conflicts`). Such an item stays here, marked, until the till has
 * seen it; it is never sent again.
 */

/** At most this many ops go in one request (the server takes 200). */
export const BATCH = 50;

export interface SyncResult {
  index?: number;
  client_ref: string;
  op?: string;
  status: 'applied' | 'replayed' | 'conflict' | 'refused' | 'elsewhere' | string;
  message?: string | null;
  conflict_id?: number;
  conflict_ids?: number[];
  order?: { id?: number; uuid?: string; number?: string; status?: string } | [] | null;
}

/** The order uuid an item names, when an earlier queued item makes that order. */
export function needsOf(items: RestaurantOutboxItem[], data: Record<string, unknown>): string | null {
  const uuid = typeof data.order_uuid === 'string' ? data.order_uuid : null;
  if (!uuid) return null;
  return items.some((i) => i.op === 'create_order' && i.data.uuid === uuid) ? uuid : null;
}

/**
 * Items held back: they add to, or send, an order the queue made that the
 * server did not take — directly or through a chain.
 */
export function held(items: RestaurantOutboxItem[]): Set<string> {
  const lost = new Set(
    items
      .filter((i) => i.op === 'create_order' && i.state !== 'waiting' && !i.order)
      .map((i) => String(i.data.uuid)),
  );
  return new Set(items.filter((i) => i.state === 'waiting' && i.needs && lost.has(i.needs)).map((i) => i.id));
}

/** What to send now: waiting items, in order, not held, at most one batch. */
export function batch(items: RestaurantOutboxItem[]): RestaurantOutboxItem[] {
  const h = held(items);
  return [...items]
    .sort((a, b) => a.seq - b.seq)
    .filter((i) => i.state === 'waiting' && !h.has(i.id))
    .slice(0, BATCH);
}

/**
 * The request's idempotency key: the same ops sent again (an answer lost on
 * the way back) are the same request, answered from the server's record.
 */
export function batchKey(terminalId: number, sent: RestaurantOutboxItem[]): string {
  const h = createHash('sha256').update(sent.map((i) => i.ref).join('\n')).digest('hex').slice(0, 40);
  return `rt${terminalId}-sync-${h}`;
}

export interface Applied {
  items: RestaurantOutboxItem[];
  applied: number;
  conflicts: RestaurantOutboxItem[];
  refused: RestaurantOutboxItem[];
}

function orderOf(r: SyncResult): RestaurantOutboxItem['order'] {
  const o = r.order;
  if (!o || Array.isArray(o) || typeof o.id !== 'number') return null;
  return { id: o.id, uuid: String(o.uuid ?? ''), number: String(o.number ?? ''), status: String(o.status ?? '') };
}

/**
 * Fold the server's answer into the outbox. Taken (or taken before) leaves;
 * a conflict stays, marked, with the server's sentence and conflict ids, and
 * is not sent again; a refusal stays for a person to retry or drop; anything
 * the server did not answer stays waiting.
 */
export function apply(items: RestaurantOutboxItem[], sent: RestaurantOutboxItem[], results: SyncResult[], now: string): Applied {
  const byRef = new Map(results.map((r) => [r.client_ref, r]));
  const next = new Map(items.map((i) => [i.id, { ...i }]));
  const conflicts: RestaurantOutboxItem[] = [];
  const refused: RestaurantOutboxItem[] = [];
  let applied = 0;

  for (const s of sent) {
    const item = next.get(s.id);
    if (!item) continue;
    const r = byRef.get(s.ref);
    if (!r) {
      item.attempts += 1;
      continue;
    }
    if (r.status === 'applied' || r.status === 'replayed') {
      applied++;
      next.delete(s.id);
      continue;
    }
    item.updated_at = now;
    item.message = r.message ?? null;
    item.order = orderOf(r) ?? item.order;
    if (r.status === 'conflict') {
      item.state = 'conflict';
      item.conflict_ids = [...new Set([...(r.conflict_ids ?? []), ...(typeof r.conflict_id === 'number' ? [r.conflict_id] : [])])];
      conflicts.push(item);
    } else {
      item.state = 'refused';
      item.message = r.message ?? 'WorkSuite would not take this.';
      refused.push(item);
    }
  }

  return { items: [...next.values()], applied, conflicts, refused };
}

/** Drop an item, and everything queued after it that needs the order it made. */
export function dropWithDependents(items: RestaurantOutboxItem[], id: string): { items: RestaurantOutboxItem[]; dropped: RestaurantOutboxItem[] } {
  const target = items.find((i) => i.id === id);
  if (!target) return { items, dropped: [] };
  const gone = new Set([target.id]);
  if (target.op === 'create_order' && !target.order) {
    for (const i of items) if (i.needs === target.data.uuid) gone.add(i.id);
  }
  return { items: items.filter((i) => !gone.has(i.id)), dropped: items.filter((i) => gone.has(i.id)) };
}

/** A refused item sent again, as a new attempt under a new reference (the server lists each reference's conflict once). */
export function retried(item: RestaurantOutboxItem, ref: string, now: string): RestaurantOutboxItem {
  return { ...item, ref, state: 'waiting', message: null, conflict_ids: [], updated_at: now };
}
