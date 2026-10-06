import { approvalAskOf, POS_SALE_FLAGS, type PosApprovalAsk, type PosSale, type PosSaleFlag, type PosSaleLoyalty } from '@shared/pos';

/**
 * The till's outbox, as rules with no database in them.
 *
 * Every sale rung up here waits in `pos_sales` in the order it was made and goes to `POST /api/pos/device/sales`
 * (`{sales: [...]}`, at most `BATCH` at a time) with the till's credential. The sale's receipt number is its `ref`:
 * WorkSuite keys a till's sales by (channel, ref), so a sale sent twice — the answer lost, the app restarted mid-send
 * — is answered "already had" the second time and recorded once. The server answers each sale on its own: created,
 * already had, or refused with the reason — and, for a sale it priced again, its own `total` and a `review` note when
 * the till charged something else (kept on the sale, shown in Sales), with the `flags` codes (`price_differs`, `payment_missing`,
 * `late` — a sale sold while a register since closed was open, taken into it). Created and already-had are done; a refused
 * sale stays, with WorkSuite's sentence and `code` (`drawer_closed`: no register open for it; `session_not_here`: the session
 * it names is another till's), until a person sends it again or drops it; one the server did not mention is tried again.
 *
 * The status code says what to do with the rest (`Pos\Controllers\DeviceController`): 401 the credential is dead
 * (pair again; nothing is lost, the sales wait), 503 POS is switched off (wait), 5xx and 429 try later, any other
 * 4xx is a request the server could not read (keep the sales, say so, try later).
 */
export const BATCH = 25;

/** What the till says when WorkSuite answers 503 without its own sentence: where POS is switched on. */
export const POS_OFF = 'POS is switched off on WorkSuite. An administrator turns it on in Admin Centre → Apps → POS.';

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
  /** WorkSuite's own total for the sale (priced again where every line named its product). */
  total?: number | null;
  /** Set when the sale is flagged for somebody to look at (a total that disagreed, a late sale…): the sale stands. */
  review?: string | null;
  /** Why it is flagged, as codes. */
  flags?: PosSaleFlag[];
  /** Why it was refused, when WorkSuite said (`drawer_closed`, `session_not_here`, `approval_required`…). */
  code?: string | null;
  /** Phase 2: refused for want of a manager's approval — what to ask for. */
  approval?: PosApprovalAsk | null;
  /** Phase 2: the customer's points on the sale (`loyalty {earned, redeemed, customer_id}`). */
  loyalty?: PosSaleLoyalty | null;
}

export type Verdict =
  | { kind: 'results'; results: DeviceSaleResult[] }
  | { kind: 'reauth'; message: string }
  | { kind: 'off'; message: string }
  | { kind: 'retry'; message: string }
  | { kind: 'bad'; message: string };

/** What goes to the device door for one sale. The till names its sale; WorkSuite names the company, warehouse and channel. */
export function saleBody(s: PosSale): Record<string, unknown> {
  // The customer as the sale names them: name, phone, e-mail (the CRM id goes as `customer_id`; tier and points are the screen's).
  const c = s.customer;
  const customer = c && (c.name || c.email || c.phone) ? { ...(c.name ? { name: c.name } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}) } : undefined;
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
    /* Phase 2, only what the sale carries — an older server ignores them, and none sent is priced exactly as before. */
    ...(s.customer_id ? { customer_id: s.customer_id } : {}),
    ...phase2Pricing(s),
    // WorkSuite reads the cashier's percentage from `discount ÷ subtotal` when not told it; with Phase 2's pricing the
    // discount is the whole deduction (promotions, points too), so the percentage is said outright.
    ...(phase2(s) ? { discount_pct: s.discount_pct } : {}),
    ...(s.approval_id ? { approval_id: s.approval_id } : {}),
  };
}

/** Whether the sale carries any of Phase 2's pricing (an older till's sale carries none). */
function phase2(s: PosSale): boolean {
  return !!(s.customer_id || s.apply_promotions || s.promotion_ids || s.coupon_code || s.redeem_points || s.approval_id || s.promotions?.length || s.points);
}

/**
 * How WorkSuite is to price the sale (the counter's pricing): priced by WorkSuite online — with promotions where the
 * till asked for them (`apply_promotions`), a coupon, points; priced here offline — the promotions the till applied
 * (`promotion_ids`, `[]` for none: WorkSuite keeps the till's price). Points are never spent offline.
 */
export function phase2Pricing(s: Pick<PosSale, 'priced_by' | 'apply_promotions' | 'promotion_ids' | 'coupon_code' | 'redeem_points' | 'customer_id'>): Record<string, unknown> {
  if (s.priced_by === 'estimate') return s.promotion_ids ? { promotion_ids: s.promotion_ids } : {};
  return {
    ...(s.apply_promotions ? { apply_promotions: true } : {}),
    ...(s.coupon_code ? { coupon_code: s.coupon_code } : {}),
    ...(s.redeem_points && s.customer_id ? { redeem_points: s.redeem_points } : {}),
  };
}

/** What to send now: waiting sales, oldest first, at most one batch. A refused sale does not hold the others back. */
export function batch(items: Queued[], max = BATCH): Queued[] {
  return items
    .filter((i) => i.sale.state === 'waiting')
    .sort((a, b) => a.seq - b.seq)
    .slice(0, max);
}

/** The flags WorkSuite named that this till knows, once each. */
export function flagsOf(v: unknown[]): PosSaleFlag[] {
  return [...new Set(v.filter((f): f is PosSaleFlag => typeof f === 'string' && (POS_SALE_FLAGS as readonly string[]).includes(f)))];
}

const text = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() !== '' ? v : fallback);

/** Read the device door's answer. */
export function readAnswer(status: number, body: Record<string, unknown> | null): Verdict {
  const message = text(body?.message, `WorkSuite answered ${status}.`);
  if (status === 401) return { kind: 'reauth', message: text(body?.message, 'The till could not be authenticated. Pair it again.') };
  if (status === 503) return { kind: 'off', message: text(body?.message, POS_OFF) };
  if ((status === 200 || status === 201 || status === 422) && Array.isArray(body?.results)) {
    const results: DeviceSaleResult[] = [];
    for (const r of body.results as unknown[]) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const st = o.status === 'created' || o.status === 'duplicate' || o.status === 'rejected' ? o.status : null;
      if (typeof o.ref !== 'string' || !st) continue;
      results.push({
        ref: o.ref,
        status: st,
        number: typeof o.number === 'string' ? o.number : null,
        message: typeof o.message === 'string' ? o.message : null,
        ...(typeof o.total === 'number' && Number.isFinite(o.total) ? { total: o.total } : {}),
        ...(typeof o.review === 'string' && o.review.trim() ? { review: o.review.trim().slice(0, 600) } : {}),
        ...(Array.isArray(o.flags) ? { flags: flagsOf(o.flags) } : {}),
        ...(typeof o.code === 'string' && /^[a-z_]{2,40}$/.test(o.code) ? { code: o.code } : {}),
        ...(o.approval ? { approval: approvalAskOf(o.approval, 'discount') } : {}),
        ...(o.loyalty && typeof o.loyalty === 'object' ? { loyalty: loyaltyOf(o.loyalty) } : {}),
      });
    }
    return { kind: 'results', results };
  }
  if (status >= 500 || status === 429 || status === 408 || status === 0) return { kind: 'retry', message };
  return { kind: 'bad', message };
}

/** The customer's points on a sale as the door answers them (`{earned, redeemed, customer_id}`; the web's shape too). */
export function loyaltyOf(v: unknown): PosSaleLoyalty | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
  return {
    customer_id: n(o.customer_id),
    earned: n(o.earned) ?? n(o.points_earned) ?? 0,
    redeemed: n(o.redeemed) ?? n(o.points_redeemed) ?? 0,
    balance: n(o.balance) ?? n(o.points_balance),
    tier: typeof o.tier === 'string' && o.tier.trim() ? o.tier.trim() : null,
  };
}

/**
 * The points on a sale with the customer's balance after it: WorkSuite's where it said, else what the customer card
 * said before the sale, less what was spent, plus what was earned (shown on the receipt and the customer display).
 */
export function withBalance(l: PosSaleLoyalty, s: Pick<PosSale, 'customer' | 'loyalty'>): PosSaleLoyalty {
  const before = s.customer?.points;
  const balance = l.balance ?? s.loyalty?.balance ?? (typeof before === 'number' ? Math.max(0, before - l.redeemed + l.earned) : null);
  return { ...l, balance, tier: l.tier ?? s.loyalty?.tier ?? s.customer?.tier ?? null };
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
      updated.push({
        ...q,
        sale: {
          ...q.sale,
          state: 'sent',
          number: r.number ?? q.sale.number,
          message: null,
          sent_at: now,
          attempts: q.sale.attempts + 1,
          server_total: r.total ?? q.sale.server_total ?? null,
          review: r.review ?? q.sale.review ?? null,
          ...(r.flags ? { flags: r.flags } : q.sale.flags ? { flags: q.sale.flags } : {}),
          ...(r.loyalty ? { loyalty: withBalance(r.loyalty, q.sale) } : {}),
          code: null,
          approval: null,
          // A manager's approval is spent with the sale: it is not kept on this computer.
          approval_id: undefined,
        },
      });
    } else {
      const sale: PosSale = {
        ...q.sale,
        state: 'refused',
        message: r.message ?? 'WorkSuite would not record this sale.',
        code: r.code ?? null,
        attempts: q.sale.attempts + 1,
        ...(r.approval ? { approval: r.approval } : {}),
      };
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
