import { REJECT_REASONS } from './buying';

/**
 * Receiving by scan (SRS-PUR-001 G-21, S-06; the "Desktop receiving" design), kept out of the screen so it can be
 * tested:
 *
 *   scan the order's number → scan each item (or each unit's serial) → mark one damaged (F2) or the line on quality
 *   hold (F3) → post to stock (⌘/Ctrl+Enter).
 *
 * Built for a barcode scanner (it types the code and presses Enter). One box takes every scan:
 *  - the order's own number again is nothing new; another order's number is refused while this one is open, so goods
 *    are never counted against the wrong order (finish or save this one first);
 *  - an item's code or barcode counts one more of it; on a serialised line it picks the line, and each unit's serial is
 *    scanned next — a serial twice is refused;
 *  - a code that is on no line of this order is refused and changes nothing; so is one more than is still to come.
 *
 * What is posted: per line, the quantity kept (quality hold included — it goes into stock under QC until released),
 * the quantity turned away with its reason, how much of what was kept is on hold, and the batch or serials.
 */

export interface RcvLine {
  /** The order line. */
  lineId: number;
  code: string | null;
  barcode: string | null;
  name: string;
  unit: string | null;
  tracking: 'none' | 'batch' | 'serial';
  bin: string | null;
  /** Still to come on the order. */
  expected: number;
  accepted: number;
  rejected: number;
  reason: string;
  /** On quality hold (F3): everything kept on this line goes into QC until released. */
  hold: boolean;
  batch: string;
  serials: string[];
}

export interface RcvOrder {
  id: number;
  number: string;
  vendor: string | null;
  warehouse: string | null;
}

export interface ScanEntry {
  at: string;
  code: string;
  name: string | null;
  outcome: 'accepted' | 'rejected' | 'held' | 'refused';
  text: string;
}

export interface RcvState {
  order: RcvOrder | null;
  lines: RcvLine[];
  /** The line the last scan was about: F2 and F3 act on it. */
  active: number | null;
  delivery: string;
  message: { ok: boolean; text: string } | null;
  log: ScanEntry[];
}

export const EMPTY: RcvState = { order: null, lines: [], active: null, delivery: '', message: null, log: [] };

/** An order's number, as printed on its barcode: `PO-2026-0402`, `PO0402`. */
export const isOrderCode = (code: string) => /^PO[-\s]?[A-Z0-9-]*\d$/i.test(code.trim());

const clean = (s: string) => s.trim().toLowerCase();
const counted = (l: RcvLine) => l.accepted + l.rejected;
export const left = (l: RcvLine) => Math.max(0, l.expected - counted(l));
export const lineDone = (l: RcvLine) => counted(l) >= l.expected;

const LOG_MAX = 50;
function logged(s: RcvState, e: ScanEntry): ScanEntry[] {
  return [e, ...s.log].slice(0, LOG_MAX);
}

export type RcvEvent =
  | { type: 'order'; order: RcvOrder; lines: Array<Omit<RcvLine, 'accepted' | 'rejected' | 'reason' | 'hold' | 'batch' | 'serials'> & Partial<Pick<RcvLine, 'accepted' | 'rejected' | 'reason' | 'hold' | 'batch' | 'serials'>>> }
  | { type: 'scan'; code: string; at: string }
  | { type: 'damaged'; at: string }
  | { type: 'hold'; at: string }
  | { type: 'set'; lineId: number; patch: Partial<Pick<RcvLine, 'accepted' | 'rejected' | 'reason' | 'hold' | 'batch'>> }
  | { type: 'focus'; lineId: number }
  | { type: 'delivery'; text: string }
  | { type: 'message'; ok: boolean; text: string }
  | { type: 'reset' };

function refuse(s: RcvState, code: string, at: string, text: string, name: string | null = null): RcvState {
  return { ...s, message: { ok: false, text }, log: logged(s, { at, code, name, outcome: 'refused', text }) };
}

function patchLine(s: RcvState, lineId: number, f: (l: RcvLine) => RcvLine): RcvLine[] {
  return s.lines.map((l) => (l.lineId === lineId ? f(l) : l));
}

/** One step of receiving. */
export function rcvReducer(s: RcvState, e: RcvEvent): RcvState {
  switch (e.type) {
    case 'reset':
      return EMPTY;
    case 'order': {
      const lines: RcvLine[] = e.lines
        .filter((l) => l.expected > 0)
        .map((l) => ({ accepted: 0, rejected: 0, reason: '', hold: false, batch: '', serials: [], ...l }));
      if (!lines.length) return { ...EMPTY, order: e.order, message: { ok: false, text: `Everything on ${e.order.number} has been received already.` } };
      return { ...EMPTY, order: e.order, lines, delivery: s.order?.id === e.order.id ? s.delivery : '', message: { ok: true, text: `${e.order.number} · scan each item as it comes off the delivery.` } };
    }
    case 'scan': {
      const code = e.code.trim();
      if (!code) return s;
      if (!s.order) return refuse(s, code, e.at, 'Scan the purchase order first — its number is on the delivery note or the order.');
      if (clean(code) === clean(s.order.number)) return { ...s, message: { ok: true, text: `Already receiving ${s.order.number}.` } };
      // Exact item codes win over the order-number shape: an item may well be called PO-something.
      const byCode = s.lines.filter((l) => (l.code && clean(l.code) === clean(code)) || (l.barcode && clean(l.barcode) === clean(code)));
      if (!byCode.length && isOrderCode(code)) return refuse(s, code, e.at, `${code} is a different order. Post or save ${s.order.number} before receiving another.`);
      if (byCode.length) {
        const line = byCode.find((l) => !lineDone(l)) ?? byCode[0]!;
        if (lineDone(line)) return refuse(s, code, e.at, `All ${line.expected} of ${line.name} are counted already. More than was ordered is refused here; correct the count on the line if you must.`, line.name);
        if (line.tracking === 'serial') return { ...s, active: line.lineId, message: { ok: true, text: `${line.name} · scan each unit's serial (${line.accepted} of ${line.expected}).` } };
        const lines = patchLine(s, line.lineId, (l) => ({ ...l, accepted: l.accepted + 1 }));
        const now = lines.find((l) => l.lineId === line.lineId)!;
        return { ...s, lines, active: line.lineId, message: { ok: true, text: `${line.name} · ${counted(now)} of ${now.expected}` }, log: logged(s, { at: e.at, code, name: line.name, outcome: line.hold ? 'held' : 'accepted', text: line.hold ? 'into quality hold' : 'accepted' }) };
      }
      // A serial for the serialised line being scanned.
      const active = s.lines.find((l) => l.lineId === s.active);
      if (active && active.tracking === 'serial') {
        const dup = active.serials.find((x) => clean(x) === clean(code));
        if (dup) return refuse(s, code, e.at, `Serial ${dup} is scanned already.`, active.name);
        if (lineDone(active)) return refuse(s, code, e.at, `All ${active.expected} of ${active.name} are counted already.`, active.name);
        const lines = patchLine(s, active.lineId, (l) => ({ ...l, accepted: l.accepted + 1, serials: [...l.serials, code] }));
        const now = lines.find((l) => l.lineId === active.lineId)!;
        return { ...s, lines, message: { ok: true, text: `Serial accepted · ${now.accepted} of ${now.expected} on this line` }, log: logged(s, { at: e.at, code, name: active.name, outcome: active.hold ? 'held' : 'accepted', text: active.hold ? 'into quality hold' : 'accepted' }) };
      }
      return refuse(s, code, e.at, `${code} is not on ${s.order.number}. Nothing was counted.`);
    }
    case 'damaged': {
      // F2: the last unit counted on the line is turned away as damaged (its serial is not received).
      const line = s.lines.find((l) => l.lineId === s.active);
      if (!line || line.accepted <= 0) return { ...s, message: { ok: false, text: 'Scan the damaged item first, then press F2.' } };
      const serial = line.tracking === 'serial' ? line.serials[line.serials.length - 1] : undefined;
      const lines = patchLine(s, line.lineId, (l) => ({ ...l, accepted: l.accepted - 1, rejected: l.rejected + 1, reason: l.reason || 'damaged', serials: serial ? l.serials.slice(0, -1) : l.serials }));
      return { ...s, lines, message: { ok: true, text: `One ${line.name} turned away · damaged` }, log: logged(s, { at: e.at, code: serial ?? line.code ?? '', name: line.name, outcome: 'rejected', text: 'rejected · damaged' }) };
    }
    case 'hold': {
      // F3: the line goes to quality hold, or comes off it.
      const line = s.lines.find((l) => l.lineId === s.active);
      if (!line) return { ...s, message: { ok: false, text: 'Scan an item of the line first, then press F3.' } };
      const lines = patchLine(s, line.lineId, (l) => ({ ...l, hold: !l.hold }));
      return { ...s, lines, message: { ok: true, text: line.hold ? `${line.name} is off quality hold.` : `${line.name} goes into quality hold until tested.` }, log: logged(s, { at: e.at, code: line.code ?? '', name: line.name, outcome: 'held', text: line.hold ? 'off quality hold' : 'quality hold' }) };
    }
    case 'set': {
      const lines = patchLine(s, e.lineId, (l) => {
        const next = { ...l, ...e.patch };
        next.accepted = Math.max(0, Math.floor(Number(next.accepted) || 0));
        next.rejected = Math.max(0, Math.floor(Number(next.rejected) || 0));
        if (next.rejected > 0 && !next.reason) next.reason = 'other';
        if (next.tracking === 'serial' && next.serials.length > next.accepted) next.serials = next.serials.slice(0, next.accepted);
        return next;
      });
      return { ...s, lines, active: e.lineId };
    }
    case 'focus':
      return s.lines.some((l) => l.lineId === e.lineId) ? { ...s, active: e.lineId } : s;
    case 'delivery':
      return { ...s, delivery: e.text };
    case 'message':
      return { ...s, message: { ok: e.ok, text: e.text } };
  }
}

export function totals(s: Pick<RcvState, 'lines'>) {
  return s.lines.reduce((t, l) => ({ expected: t.expected + l.expected, accepted: t.accepted + l.accepted, rejected: t.rejected + l.rejected, held: t.held + (l.hold ? l.accepted : 0) }), { expected: 0, accepted: 0, rejected: 0, held: 0 });
}

export interface RcvBodyLine {
  po_line_id: number;
  quantity: number;
  rejected_qty: number;
  reject_reason?: string;
  quarantine_qty: number;
  batch_no?: string;
  serials?: string[];
}

const REASONS = new Set(REJECT_REASONS.map((r) => r.value));

/**
 * The receipt this posts: the lines something was counted on, each with what was kept, turned away (and why), held
 * for QC, and its batch or serials. Null lines and an error when it cannot go yet.
 */
export function receiveBody(s: RcvState): { lines: RcvBodyLine[]; delivery_note_no: string | null; error: string | null } {
  const out: RcvBodyLine[] = [];
  for (const l of s.lines) {
    if (l.accepted <= 0 && l.rejected <= 0) continue;
    if (counted(l) > l.expected) return { lines: [], delivery_note_no: null, error: `${l.name}: ${counted(l)} counted, but only ${l.expected} are still to come.` };
    const row: RcvBodyLine = { po_line_id: l.lineId, quantity: l.accepted, rejected_qty: l.rejected, quarantine_qty: l.hold ? l.accepted : 0 };
    if (l.rejected > 0) row.reject_reason = REASONS.has(l.reason) ? l.reason : 'other';
    if (l.tracking === 'batch' && l.accepted > 0) {
      if (!l.batch.trim()) return { lines: [], delivery_note_no: null, error: `${l.name} is batch tracked — name the batch.` };
      row.batch_no = l.batch.trim();
    }
    if (l.tracking === 'serial' && l.accepted > 0) {
      if (l.serials.length !== l.accepted) return { lines: [], delivery_note_no: null, error: `${l.name} is serialised: scan ${l.accepted} serial ${l.accepted === 1 ? 'number' : 'numbers'} (${l.serials.length} scanned).` };
      row.serials = [...l.serials];
    }
    out.push(row);
  }
  if (!out.length) return { lines: [], delivery_note_no: null, error: 'Nothing has been counted yet. Scan the items as they come off the delivery.' };
  return { lines: out, delivery_note_no: s.delivery.trim() || null, error: null };
}

/**
 * The draft receipt's lines matched to what was counted (the receipt's own line ids, by order line), for posting it:
 * `POST /api/inventory/receipts/{id}/post`.
 */
export function postLines(counted: RcvBodyLine[], receiptLines: Array<{ id: number | string; po_line_id: number | string | null }>): Array<Record<string, unknown>> {
  const byPo = new Map(counted.map((c) => [c.po_line_id, c]));
  return receiptLines.flatMap((rl): Array<Record<string, unknown>> => {
    const c = rl.po_line_id === null ? undefined : byPo.get(Number(rl.po_line_id));
    if (!c) return [];
    return [{ id: Number(rl.id), quantity: c.quantity, rejected_qty: c.rejected_qty, quarantine_qty: c.quarantine_qty, ...(c.reject_reason ? { reject_reason: c.reject_reason } : {}), ...(c.batch_no ? { batch_no: c.batch_no } : {}), ...(c.serials ? { serials: c.serials } : {}) }];
  });
}
