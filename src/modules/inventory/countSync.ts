import { countedOf, type CountLine } from './control';
import { num } from './api';

/**
 * Counting offline (the "Desktop offline count" design). A count sheet that is open for counting works from this
 * computer's copy whatever the connection does:
 *
 *  - every scan adds one to its line, and a typed number sets the line — kept here at once (the app's encrypted
 *    draft store), so a crash or a restart loses nothing;
 *  - what was counted goes to WorkSuite as one "save these lines" write through the app's offline queue: sent at once
 *    when it can be, queued (encrypted, in order) when it cannot, and replayed when the connection is back;
 *  - each line says where its count is: on this computer, waiting to send, sent at a time, or needing a decision
 *    (someone else changed the same count online — the queue never overwrites it silently);
 *  - posting the differences to stock needs the connection, and every line sent first.
 *
 * Kept apart from the screen so it can be tested. The server stays the only place a count is posted.
 */
export type SaveState = 'local' | 'queued' | 'sent' | 'conflict' | 'failed';

export interface LocalCount {
  /** What was counted; null is "not counted", never zero. */
  value: number | null;
  state: SaveState;
  /** When it was sent (ISO), for "sent 08:52". */
  at: string | null;
}

export interface CountSession {
  countId: number;
  /** The lines counted on this computer; the rest show what the server has. */
  lines: Record<string, LocalCount>;
  /** The line the last scan was about. */
  last: number | null;
  /** Barcodes learnt from WorkSuite while online, so the same code scans offline too: code → product id. */
  barcodes: Record<string, number>;
  message: { ok: boolean; text: string } | null;
}

export const newSession = (countId: number): CountSession => ({ countId, lines: {}, last: null, barcodes: {}, message: null });

type Line = Pick<CountLine, 'id' | 'product_id' | 'code' | 'name' | 'variant_label' | 'counted_qty'> & { barcode?: string | null };

const clean = (s: string) => s.trim().toLowerCase();
const label = (l: Line) => `${l.name}${l.variant_label ? ` — ${l.variant_label}` : ''}`;

/** What a line shows as counted: this computer's count when it has one, else the server's. */
export function countedNow(s: CountSession, l: Pick<Line, 'id' | 'counted_qty'>): number | null {
  const mine = s.lines[String(l.id)];
  return mine ? mine.value : num(l.counted_qty);
}

/** The lines a scanned code is: by the product's code, its barcode, or a barcode learnt online. */
export function linesFor(s: CountSession, lines: readonly Line[], code: string): Line[] {
  const c = clean(code);
  if (!c) return [];
  const learnt = Object.entries(s.barcodes).find(([k]) => clean(k) === c)?.[1];
  return lines.filter((l) => (l.code && clean(l.code) === c) || (l.barcode && clean(l.barcode) === c) || (learnt !== undefined && Number(l.product_id) === learnt));
}

export type CountEvent =
  | { type: 'scan'; code: string; lines: readonly Line[]; reference: string }
  | { type: 'set'; lineId: number; text: string; lines: readonly Line[] }
  | { type: 'learn'; code: string; productId: number }
  | { type: 'submitted'; sent: Record<string, number | null>; outcome: 'sent' | 'queued' | 'failed'; at: string }
  | { type: 'synced'; at: string }
  | { type: 'conflict' }
  | { type: 'message'; ok: boolean; text: string }
  | { type: 'restore'; session: CountSession };

/** One step of counting. */
export function countReducer(s: CountSession, e: CountEvent): CountSession {
  switch (e.type) {
    case 'restore':
      return e.session.countId === s.countId ? { ...newSession(s.countId), ...e.session } : s;
    case 'message':
      return { ...s, message: { ok: e.ok, text: e.text } };
    case 'learn':
      return { ...s, barcodes: { ...s.barcodes, [e.code.trim()]: e.productId } };
    case 'scan': {
      const code = e.code.trim();
      if (!code) return s;
      const hits = linesFor(s, e.lines, code);
      if (!hits.length) return { ...s, message: { ok: false, text: `${code} is not on ${e.reference}. Nothing was counted.` } };
      // The same product on several bins: keep counting the one just scanned.
      const line = hits.find((l) => l.id === s.last) ?? hits[0]!;
      const now = (countedNow(s, line) ?? 0) + 1;
      return {
        ...s,
        last: line.id,
        lines: { ...s.lines, [String(line.id)]: { value: now, state: 'local', at: null } },
        message: { ok: true, text: `${label(line)} · ${now} counted` },
      };
    }
    case 'set': {
      const line = e.lines.find((l) => l.id === e.lineId);
      if (!line) return s;
      const r = countedOf(e.text);
      if (!r.ok) return { ...s, last: line.id, message: { ok: false, text: `${line.code ?? label(line)}: a count is a number, zero or more — or left empty.` } };
      const before = s.lines[String(line.id)];
      if (before && before.value === r.value) return { ...s, last: line.id };
      return { ...s, last: line.id, lines: { ...s.lines, [String(line.id)]: { value: r.value, state: 'local', at: null } }, message: null };
    }
    case 'submitted': {
      // Only the lines still holding what was sent: one counted again meanwhile waits for the next send.
      const lines = { ...s.lines };
      for (const [id, value] of Object.entries(e.sent)) {
        const l = lines[id];
        if (!l || l.value !== value || (l.state !== 'local' && l.state !== 'failed')) continue;
        lines[id] = { value, state: e.outcome === 'failed' ? 'failed' : e.outcome, at: e.outcome === 'sent' ? e.at : null };
      }
      return { ...s, lines };
    }
    case 'synced': {
      // The queue has delivered everything it held for this count.
      let changed = false;
      const lines = { ...s.lines };
      for (const [id, l] of Object.entries(lines)) {
        if (l.state === 'queued') {
          lines[id] = { ...l, state: 'sent', at: e.at };
          changed = true;
        }
      }
      return changed ? { ...s, lines } : s;
    }
    case 'conflict': {
      let changed = false;
      const lines = { ...s.lines };
      for (const [id, l] of Object.entries(lines)) {
        if (l.state === 'queued') {
          lines[id] = { ...l, state: 'conflict' };
          changed = true;
        }
      }
      return changed ? { ...s, lines } : s;
    }
  }
}

/**
 * The lines to send now: counted here, not yet handed to WorkSuite or the queue. A send the server refused is tried
 * again only when asked (Try to sync now), so a refusal is not repeated every second.
 */
export function unsent(s: CountSession, retryFailed = false): Array<{ id: number; counted_qty: number | null }> {
  return Object.entries(s.lines)
    .filter(([, l]) => l.state === 'local' || (retryFailed && l.state === 'failed'))
    .map(([id, l]) => ({ id: Number(id), counted_qty: l.value }));
}

/** Whether anything counted here has not reached WorkSuite yet (posting waits for it). */
export const waiting = (s: CountSession) => Object.values(s.lines).some((l) => l.state !== 'sent');

/** "on this computer", "waiting to send", "sent 08:52" — where a line's count is. */
export function savedWords(l: LocalCount | undefined, time: (iso: string) => string): string {
  if (!l) return '—';
  switch (l.state) {
    case 'local':
      return 'on this computer';
    case 'queued':
      return 'waiting to send';
    case 'sent':
      return l.at ? `sent ${time(l.at)}` : 'sent';
    case 'conflict':
      return 'changed online — choose which to keep';
    case 'failed':
      return 'not sent — will try again';
  }
}

/** The queued write's label, as the app's outbox lists it: "CNT-00005 · 12 line counts". */
export const queueLabel = (reference: string, n: number) => `${reference} · ${n} line ${n === 1 ? 'count' : 'counts'}`;

/** The variance on a line once counted: counted less expected, to four places; null when not counted. */
export function varianceOf(counted: number | null, expected: unknown): number | null {
  if (counted === null) return null;
  return Math.round((counted - (num(expected) ?? 0)) * 10000) / 10000;
}
