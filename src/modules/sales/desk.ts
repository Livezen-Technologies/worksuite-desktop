import type { LabelFormat, SalesPrintOutcome } from '@shared/sales';
import type { DeliveryHit, DeliveryLine, Parcel, Rate, Shipment } from './ship';

/**
 * The Shipping desk's flow (WS-OMS-SRS-001 D-13, FR-DSK-08, FR-LBL-06), kept out of the screen so it can be tested:
 *
 *   scan the delivery note → check every item by scanning it → weigh → choose a courier from the rates → book →
 *   the label prints by itself, silently, on this computer's label printer.
 *
 * Built for a barcode scanner (it types the code and presses Enter) and a scale that types its reading the same way.
 * A service line (no stock) is checked already: there is nothing to scan. A code that is not on the note says so and
 * changes nothing; scanning more of an item than the note sends is refused.
 */
export type Stage = 'scan' | 'check' | 'weigh' | 'rates' | 'booked';

export interface DeskLine {
  key: string;
  code: string | null;
  name: string;
  need: number;
  got: number;
  /** Nothing to scan: a service. */
  service: boolean;
}

export interface DeskState {
  stage: Stage;
  note: DeliveryHit | null;
  lines: DeskLine[];
  weight: string;
  box: string;
  shipment: Shipment | null;
  rates: Rate[];
  chosen: Rate | null;
  /** The booking's idempotency key: one per note, so pressing Book again is the same booking (AC-17). */
  key: string | null;
  message: { ok: boolean; text: string } | null;
  printed: SalesPrintOutcome | null;
}

export const BOXES = ['S (30×20×10)', 'M (40×30×20)', 'L (60×40×40)', 'Envelope'] as const;
const BOX_CM: Record<string, Pick<Parcel, 'length_cm' | 'width_cm' | 'height_cm'>> = {
  'S (30×20×10)': { length_cm: 30, width_cm: 20, height_cm: 10 },
  'M (40×30×20)': { length_cm: 40, width_cm: 30, height_cm: 20 },
  'L (60×40×40)': { length_cm: 60, width_cm: 40, height_cm: 40 },
  Envelope: { length_cm: 35, width_cm: 25, height_cm: 2 },
};

export const EMPTY: DeskState = { stage: 'scan', note: null, lines: [], weight: '', box: BOXES[0], shipment: null, rates: [], chosen: null, key: null, message: null, printed: null };

/** A delivery note's number, as printed on its barcode: `DN-00321`. */
export const isNoteCode = (code: string) => /^DN[-\s]?\d+$/i.test(code.trim());

const num = (v: number | string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The note's lines as things to check: a service needs no scan. */
export function linesOf(lines: DeliveryLine[]): DeskLine[] {
  return lines.map((l, i) => {
    const service = l.tracking === 'service' || (!l.code && !l.product_id);
    const need = Math.max(0, Math.round(num(l.quantity)));
    return { key: String(l.id ?? i), code: l.code, name: l.product_name ?? l.description ?? 'Item', need, got: service ? need : 0, service };
  });
}

export function allChecked(s: Pick<DeskState, 'lines'>): boolean {
  return s.lines.length > 0 && s.lines.every((l) => l.got >= l.need);
}

/**
 * A scale's reading as kilograms: "0.80", "0.80 kg", "ST,GS,+  0.800kg", "800 g", "1,25". Null when it is not one
 * (or not more than nothing).
 */
export function parseWeight(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,(\d{1,3})(?!\d)/g, '.$1');
  const m = /([+-]?\d+(?:\.\d+)?)\s*(kg|g|lb)?\s*$/.exec(t);
  if (!m) return null;
  let v = Number(m[1]);
  if (m[2] === 'g') v /= 1000;
  if (m[2] === 'lb') v *= 0.45359237;
  return Number.isFinite(v) && v > 0 && v < 1000 ? Math.round(v * 1000) / 1000 : null;
}

export function weightKg(s: Pick<DeskState, 'weight'>): number | null {
  return parseWeight(s.weight);
}

/** The parcel to book: the weight read, the box's size. */
export function parcelOf(s: Pick<DeskState, 'weight' | 'box'>): Parcel | null {
  const w = parseWeight(s.weight);
  return w ? { weight_kg: w, ...(BOX_CM[s.box] ?? {}) } : null;
}

/** The courier to offer first: the cheapest that answered, then the quickest. */
export function bestRate(rates: Rate[]): Rate | null {
  const ok = rates.filter((r) => !r.error);
  return ok.sort((a, b) => a.price - b.price || (a.transit_days ?? 99) - (b.transit_days ?? 99))[0] ?? null;
}

export type DeskEvent =
  | { type: 'note'; note: DeliveryHit; lines: DeliveryLine[]; shipment?: Shipment | null }
  | { type: 'item'; code: string; matches?: (line: DeskLine) => boolean }
  | { type: 'weight'; text: string }
  | { type: 'box'; box: string }
  | { type: 'shipment'; shipment: Shipment }
  | { type: 'rates'; rates: Rate[] }
  | { type: 'choose'; rate: Rate }
  | { type: 'booked'; shipment: Shipment }
  | { type: 'printed'; outcome: SalesPrintOutcome }
  | { type: 'message'; ok: boolean; text: string }
  | { type: 'reset' };

/** One step of the desk. */
export function deskReducer(s: DeskState, e: DeskEvent): DeskState {
  switch (e.type) {
    case 'reset':
      return EMPTY;
    case 'note': {
      const lines = linesOf(e.lines);
      const booked = e.shipment && e.shipment.state !== 'draft' && e.shipment.state !== 'cancelled' ? e.shipment : null;
      if (booked) return { ...EMPTY, note: e.note, lines: lines.map((l) => ({ ...l, got: l.need })), shipment: booked, stage: 'booked', key: `ship-${e.note.id}`, message: { ok: true, text: `${e.note.dn_number} is booked already${booked.tracking_no ? ` · ${booked.tracking_no}` : ''}. Reprint its label if it needs one.` } };
      const next: DeskState = { ...EMPTY, note: e.note, lines, shipment: e.shipment ?? null, key: `ship-${e.note.id}-${Date.now().toString(36)}`, stage: 'check', message: { ok: true, text: `${e.note.dn_number} · scan each item.` } };
      return allChecked(next) ? { ...next, stage: 'weigh', message: { ok: true, text: 'Nothing to scan on this note. Weigh the parcel.' } } : next;
    }
    case 'item': {
      if (s.stage !== 'check' && s.stage !== 'weigh') return s;
      const code = e.code.trim().toLowerCase();
      const match = (l: DeskLine) => (e.matches ? e.matches(l) : !!l.code && l.code.toLowerCase() === code);
      const candidates = s.lines.filter((l) => !l.service && match(l));
      if (!candidates.length) return { ...s, message: { ok: false, text: `${e.code.trim()} is not on ${s.note?.dn_number ?? 'this note'}.` } };
      const line = candidates.find((l) => l.got < l.need);
      if (!line) return { ...s, message: { ok: false, text: `All ${candidates[0]!.need} of ${candidates[0]!.name} are checked already.` } };
      const lines = s.lines.map((l) => (l === line ? { ...l, got: l.got + 1 } : l));
      const done = allChecked({ lines });
      return { ...s, lines, stage: done ? 'weigh' : 'check', message: { ok: true, text: done ? 'Every item is checked. Weigh the parcel.' : `${line.name} · ${line.got + 1} / ${line.need}` } };
    }
    case 'weight':
      return { ...s, weight: e.text };
    case 'box':
      return { ...s, box: e.box };
    case 'shipment':
      return { ...s, shipment: e.shipment };
    case 'rates': {
      const best = bestRate(e.rates);
      return { ...s, rates: e.rates, chosen: best, stage: 'rates', message: best ? null : { ok: false, text: 'No courier answered with a rate. Try again, or choose another box.' } };
    }
    case 'choose':
      return e.rate.error ? s : { ...s, chosen: e.rate };
    case 'booked':
      return { ...s, shipment: e.shipment, stage: 'booked', message: { ok: true, text: `Booked with ${e.shipment.courier?.name ?? s.chosen?.courier ?? 'the courier'}${e.shipment.tracking_no ? ` · ${e.shipment.tracking_no}` : ''}.` } };
    case 'printed':
      return { ...s, printed: e.outcome, message: { ok: e.outcome.ok, text: e.outcome.message } };
    case 'message':
      return { ...s, message: { ok: e.ok, text: e.text } };
  }
}

export interface DeskDeps {
  createShipment: (body: { delivery_id: number; parcels: Parcel[]; cod_amount?: number | null }) => Promise<Shipment>;
  updateShipment: (id: number, body: { parcels: Parcel[] }) => Promise<Shipment>;
  rates: (shipmentId: number) => Promise<Rate[]>;
  book: (shipmentId: number, rate: Pick<Rate, 'account_id' | 'service_code'>, key: string) => Promise<Shipment>;
  printLabel: (shipmentId: number, o: { format?: LabelFormat; quiet?: boolean }) => Promise<SalesPrintOutcome>;
  /** Print by itself once booked (Settings › Printers). */
  autoPrint: boolean;
}

/** Ask the couriers: the shipment is made (or its parcel updated) with the weight and box, then rated. */
export async function askRates(s: DeskState, d: Pick<DeskDeps, 'createShipment' | 'updateShipment' | 'rates'>, dispatch: (e: DeskEvent) => void): Promise<void> {
  const parcel = parcelOf(s);
  if (!s.note || !parcel) {
    dispatch({ type: 'message', ok: false, text: 'Weigh the parcel first.' });
    return;
  }
  const shipment = s.shipment ? await d.updateShipment(s.shipment.id, { parcels: [parcel] }) : await d.createShipment({ delivery_id: s.note.id, parcels: [parcel] });
  dispatch({ type: 'shipment', shipment });
  dispatch({ type: 'rates', rates: await d.rates(shipment.id) });
}

/** Book with the courier chosen, then print the label by itself. */
export async function bookAndPrint(s: DeskState, d: Pick<DeskDeps, 'book' | 'printLabel' | 'autoPrint'>, dispatch: (e: DeskEvent) => void): Promise<Shipment | null> {
  if (!s.shipment || !s.chosen || !s.key || !allChecked(s)) {
    dispatch({ type: 'message', ok: false, text: !allChecked(s) ? 'Check every item first.' : 'Choose a courier first.' });
    return null;
  }
  const booked = await d.book(s.shipment.id, s.chosen, s.key);
  dispatch({ type: 'booked', shipment: booked });
  if (d.autoPrint) dispatch({ type: 'printed', outcome: await d.printLabel(booked.id, { quiet: true }) });
  return booked;
}
