import { call } from '../../../core/bridge';

/**
 * How long Website chats take, for Help › Diagnostics (worksuite-desktop#252: "about 20 s to load lists and respond").
 *
 * Each list, thread and reply request is timed here from start to end; the server's own numbers come with the answer
 * (`timing`: its time, its database time, its queries and rows), and the screen's time to draw the rows is added when
 * it has. So a slow open splits into server, network and screen. The entries go to the main process a few at a time
 * (`diagnostics:timings`), which keeps the last of them for the diagnostic report's `timings.json`.
 */
export interface ServerTiming {
  ms: number;
  db_ms: number;
  queries: number;
  rows: number;
}

export interface TimingEntry {
  /** What was asked: `conversations`, `conversations:closed`, `conversation`, `reply`, `missed`, `offline`. */
  what: string;
  at: string;
  /** Request start to answer, as this computer saw it. */
  ms: number;
  rows: number | null;
  server: ServerTiming | null;
  /** From the answer arriving to the rows drawn. */
  render_ms?: number | null;
  ok: boolean;
}

const KEEP = 50;
const pending: TimingEntry[] = [];
const recent: TimingEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** When each kind of answer last arrived, for its render time. */
const arrived = new Map<string, number>();

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function flush(): void {
  flushTimer = null;
  if (!pending.length) return;
  const entries = pending.splice(0, pending.length);
  void call('diagnostics:timings', { entries }).catch(() => undefined);
}

export function recordTiming(e: TimingEntry): void {
  recent.push(e);
  if (recent.length > KEEP) recent.splice(0, recent.length - KEEP);
  pending.push(e);
  if (pending.length > KEEP) pending.splice(0, pending.length - KEEP);
  flushTimer ??= setTimeout(flush, 5_000);
}

/** The last few entries recorded in this window (tests, and the page's own summary). */
export function recentTimings(): TimingEntry[] {
  return [...recent];
}

export function resetTimings(): void {
  recent.length = 0;
  pending.length = 0;
  arrived.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

const serverOf = (data: unknown): ServerTiming | null => {
  const t = (data as { timing?: Partial<ServerTiming> } | null)?.timing;
  return t && typeof t.ms === 'number' ? { ms: t.ms, db_ms: t.db_ms ?? 0, queries: t.queries ?? 0, rows: t.rows ?? 0 } : null;
};

/** Time one request: `rows` says how many rows its answer holds. */
export async function timed<T>(what: string, run: () => Promise<T>, rows: (data: T) => number | null = () => null): Promise<T> {
  const start = now();
  try {
    const data = await run();
    const end = now();
    arrived.set(what, end);
    recordTiming({ what, at: new Date().toISOString(), ms: Math.round(end - start), rows: rows(data), server: serverOf(data), ok: true });
    return data;
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') recordTiming({ what, at: new Date().toISOString(), ms: Math.round(now() - start), rows: null, server: null, ok: false });
    throw e;
  }
}

/** After the rows of `what` are drawn: how long since its answer arrived, on the latest entry for it. */
export function renderedAfter(what: string): void {
  const t = arrived.get(what);
  if (t === undefined) return;
  arrived.delete(what);
  const entry = [...recent].reverse().find((e) => e.what === what && e.render_ms === undefined);
  if (entry) entry.render_ms = Math.round(now() - t);
}
