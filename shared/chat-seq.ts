/**
 * Website chat delivery by seq (WS-WCHAT DLV-01, DLV-04…06; plan 1.9; the server's docs/CHAT_DELIVERY.md).
 *
 * Every message in a conversation has a `seq`: 1, 2, 3… with no gaps and no repeats, all messages sharing one
 * sequence (internal notes too, so a reader may not see every number). `last_seq` is a conversation's highest,
 * counting what this reader cannot see. Used by the main process (realtime: one copy of each announced message) and
 * the renderer (the thread: order, merge, gaps).
 *
 *  - ORDER: by seq, then by id for a row from an older server without one.
 *  - ONE COPY: a message is kept by its server id; the device's own copy goes the moment the server copy with the same
 *    client id arrives (merged over it, not beside it).
 *  - THE CURSOR: the highest seq known. An announcement at or below it is a repeat; one just past it is the next
 *    message; one further on means something was missed, and sync fills the gap.
 */

export interface SeqMessage {
  id: number;
  seq?: number | null;
  client_id?: string | null;
  deleted?: boolean;
}

/** An id the device makes before the first attempt and sends on every retry (DLV-01): a UUID. */
export function newClientId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** seq first; id breaks a tie, and orders a row that has no seq. */
export function bySeq(a: SeqMessage, b: SeqMessage): number {
  const as = a.seq ?? null;
  const bs = b.seq ?? null;
  if (as !== null && bs !== null && as !== bs) return as - bs;
  return a.id - b.id;
}

/** The highest seq a conversation is known to have reached. */
export function cursorOf(messages: ReadonlyArray<SeqMessage>, lastSeq?: number | null): number {
  let n = typeof lastSeq === 'number' && lastSeq > 0 ? lastSeq : 0;
  for (const m of messages) if (typeof m.seq === 'number' && m.seq > n) n = m.seq;
  return n;
}

export type SeqVerdict = 'seen' | 'next' | 'gap';

/** What an announced seq means against the cursor: already had, the next one, or past a gap. */
export function judgeSeq(cursor: number, seq: number): SeqVerdict {
  if (seq <= cursor) return 'seen';
  return seq === cursor + 1 ? 'next' : 'gap';
}

/**
 * The conversation with what came in merged over it, in seq order. Incoming rows replace rows with the same id; a row
 * whose client id an incoming row carries under another id goes; `deleted` ids stay in place, drawn as deleted.
 */
export function mergeBySeq<T extends SeqMessage>(current: ReadonlyArray<T>, incoming: ReadonlyArray<T>, deleted: ReadonlyArray<number> = []): T[] {
  const byId = new Map<number, T>();
  const arrived = new Map<string, number>();
  for (const m of incoming) if (m.client_id) arrived.set(m.client_id, m.id);
  for (const m of current) {
    if (m.client_id && arrived.has(m.client_id) && arrived.get(m.client_id) !== m.id) continue;
    byId.set(m.id, m);
  }
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  if (deleted.length) {
    const gone = new Set(deleted);
    for (const [id, m] of byId) if (gone.has(id)) byId.set(id, { ...m, deleted: true, body: null, file: null } as T);
  }
  return [...byId.values()].sort(bySeq);
}

/**
 * Messages in seq order, with other lines (a visitor's page visits) woven in by time: each goes before the first
 * message later than it, so the server's order of messages holds however their clocks read.
 */
export function weave<M extends { time: number }, E extends { time: number }>(messages: ReadonlyArray<M>, events: ReadonlyArray<E>): Array<M | E> {
  const out: Array<M | E> = [];
  let e = 0;
  for (const m of messages) {
    while (e < events.length && events[e]!.time <= m.time) out.push(events[e++]!);
    out.push(m);
  }
  while (e < events.length) out.push(events[e++]!);
  return out;
}

/**
 * The announcements already seen, as `conversation:seq`, for dropping a repeat (a re-sent realtime event, or one
 * replayed after a reconnect). Bounded: the oldest are let go.
 */
export class SeqSeen {
  private readonly keys = new Set<string>();
  constructor(private readonly limit = 1000) {}

  /** True the first time this conversation's seq is seen; false for a repeat. */
  first(conversationId: number, seq: number): boolean {
    const key = `${conversationId}:${seq}`;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    if (this.keys.size > this.limit) this.keys.delete(this.keys.values().next().value as string);
    return true;
  }

  clear(): void {
    this.keys.clear();
  }
}

/** Conversations an open screen keeps current by seq, as `target:id`, counted per screen. */
const watched = new Map<string, number>();

/** Say a screen keeps this conversation current by seq. @returns the undo */
export function watchBySeq(lane: string): () => void {
  watched.set(lane, (watched.get(lane) ?? 0) + 1);
  return () => {
    const n = (watched.get(lane) ?? 1) - 1;
    if (n > 0) watched.set(lane, n);
    else watched.delete(lane);
  };
}

/** Whether an open screen keeps this conversation current by seq, so an announced message needs no full refetch. */
export function watchedBySeq(lane: string): boolean {
  return (watched.get(lane) ?? 0) > 0;
}
