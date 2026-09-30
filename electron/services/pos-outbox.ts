import type { PosSale } from '@shared/pos';

/**
 * The till's outbox, as rules with no database in them.
 *
 * Every sale rung up here waits in `pos_sales` in the order it was made and goes to `POST /api/pos/device/sales`
 * (`{sales: [...]}`, at most `BATCH` at a time) with the till's credential. The sale's receipt number is its `ref`:
 * WorkSuite keys a till's sales by (channel, ref), so a sale sent twice — the answer lost, the app restarted mid-send
 * — is answered "already had" the second time and recorded once. The server answers each sale on its own: created,
 * already had, or refused with the reason. Created and already-had are done; a refused sale stays, with WorkSuite's
 * sentence, until a person sends it again or drops it; one the server did not mention is tried again.
 *
 * The status code says what to do with the rest (`Pos\Controllers\DeviceController`): 401 the credential is dead
 * (pair again; nothing is lost, the sales wait), 503 POS is switched off (wait), 5xx and 429 try later, any other
 * 4xx is a request the server could not read (keep the sales, say so, try later).
 */
export const BATCH = 25;

/** A sale in the outbox and its place in the queue. */
export interface Queued {
  seq: number;
  sale: PosSale;
}

export interface DeviceSaleResult {
  ref: string;
  status: 'created' | 'duplicate' | 'rejected';
  number: string | null;
  message: string | null;
}

export type Verdict =
  | { kind: 'results'; results: DeviceSaleResult[] }
  | { kind: 'reauth'; message: string }
  | { kind: 'off'; message: string }
  | { kind: 'retry'; message: string }
  | { kind: 'bad'; message: string };

/** What goes to the device door for one sale. The till names its sale; WorkSuite names the company, warehouse and channel. */
export function saleBody(s: PosSale): Record<string, unknown> {
  const customer = s.customer && (s.customer.name || s.customer.email || s.customer.phone) ? s.customer : undefined;
  return {
    ref: s.ref,
    date: s.created_at,
    currency: s.currency,
    paid: true,
    ...(customer ? { customer } : {}),
    lines: s.lines.map((l) => ({
      description: l.name,
      sku: l.code ?? undefined,
      product_id: l.product_id,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount_pct: l.discount_pct,
      tax_rate: l.tax_rate,
      net: l.net,
      tax: l.tax,
      total: l.total,
    })),
    subtotal: s.totals.subtotal,
    discount: s.totals.discount,
    tax: s.totals.tax,
    total: s.totals.total,
    cashier_id: s.cashier_id,
    ...(s.note ? { note: s.note } : {}),
    /* Read by the server's register half (the drawer, the payment, Finance) as it arrives; ignored before. */
    session_id: s.session_id,
    register_id: s.register_id,
    tenders: s.tenders.map((t) => ({ method: t.method, amount: t.amount, ...(t.reference ? { reference: t.reference } : {}) })),
    change_given: s.change_given,
    offline: s.priced_by === 'estimate',
    expected_total: s.totals.total,
    catalogue_version: s.catalogue_version,
  };
}

/** What to send now: waiting sales, oldest first, at most one batch. A refused sale does not hold the others back. */
export function batch(items: Queued[], max = BATCH): Queued[] {
  return items
    .filter((i) => i.sale.state === 'waiting')
    .sort((a, b) => a.seq - b.seq)
    .slice(0, max);
}

const text = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() !== '' ? v : fallback);

/** Read the device door's answer. */
export function readAnswer(status: number, body: Record<string, unknown> | null): Verdict {
  const message = text(body?.message, `WorkSuite answered ${status}.`);
  if (status === 401) return { kind: 'reauth', message: text(body?.message, 'The till could not be authenticated. Pair it again.') };
  if (status === 503) return { kind: 'off', message: text(body?.message, 'POS is switched off on WorkSuite.') };
  if ((status === 200 || status === 201 || status === 422) && Array.isArray(body?.results)) {
    const results: DeviceSaleResult[] = [];
    for (const r of body.results as unknown[]) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const st = o.status === 'created' || o.status === 'duplicate' || o.status === 'rejected' ? o.status : null;
      if (typeof o.ref !== 'string' || !st) continue;
      results.push({ ref: o.ref, status: st, number: typeof o.number === 'string' ? o.number : null, message: typeof o.message === 'string' ? o.message : null });
    }
    return { kind: 'results', results };
  }
  if (status >= 500 || status === 429 || status === 408 || status === 0) return { kind: 'retry', message };
  return { kind: 'bad', message };
}

export interface Applied {
  /** The sent items as they are now. */
  updated: Queued[];
  created: number;
  duplicates: number;
  refused: PosSale[];
}

/** Fold the server's per-sale answers into what was sent. */
export function apply(sent: Queued[], results: DeviceSaleResult[], now: string): Applied {
  const byRef = new Map(results.map((r) => [r.ref, r]));
  const updated: Queued[] = [];
  const refused: PosSale[] = [];
  let created = 0;
  let duplicates = 0;
  for (const q of sent) {
    const r = byRef.get(q.sale.ref);
    if (!r) {
      updated.push({ ...q, sale: { ...q.sale, attempts: q.sale.attempts + 1 } });
      continue;
    }
    if (r.status === 'created' || r.status === 'duplicate') {
      if (r.status === 'created') created++;
      else duplicates++;
      updated.push({ ...q, sale: { ...q.sale, state: 'sent', number: r.number ?? q.sale.number, message: null, sent_at: now, attempts: q.sale.attempts + 1 } });
    } else {
      const sale: PosSale = { ...q.sale, state: 'refused', message: r.message ?? 'WorkSuite would not record this sale.', attempts: q.sale.attempts + 1 };
      refused.push(sale);
      updated.push({ ...q, sale });
    }
  }
  return { updated, created, duplicates, refused };
}

/** The next number in a receipt sequence: past the last one used here, and past any a sale on record already has. */
export function nextSequence(last: number, highestOnRecord: number): number {
  return Math.max(Math.floor(last) || 0, Math.floor(highestOnRecord) || 0) + 1;
}

/** The sequence part of a receipt number of this prefix (`T01-7F3A2B-000042` → 42), or 0. */
export function sequenceOf(ref: string, prefix: string): number {
  if (!ref.startsWith(`${prefix}-`)) return 0;
  const n = Number(ref.slice(prefix.length + 1));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
