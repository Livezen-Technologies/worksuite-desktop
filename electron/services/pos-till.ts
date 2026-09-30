import { createHash } from 'node:crypto';
import { formatReceipt, type PosCatalogue, type PosGiveBack, type PosProduct, type PosReturn, type PosSale, type PosSellInput, type PosServerReceipt, type PosTillStatus } from '@shared/pos';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { DeviceAnswer, PosDesk } from './pos-desk';
import { apply, batch, nextSequence, readAnswer, saleBody, sequenceOf, type Queued } from './pos-outbox';
import type { Vault } from './vault';

const log = logger('pos-till');

/**
 * POS: the till's working copy and its sales (FR-POS offline).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CATALOGUE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The products the till sells, with their barcodes and one-unit prices, are WorkSuite's till catalogue
 * (`catalogue?since_version=`, answered `{version, unchanged: true}` when the copy is current): read through the
 * till's own door in the background (`/api/pos/device/catalogue`, every half hour, with nobody signed in), and with
 * the signed-in person's session when they ask (`/api/pos/catalogue`, `pos.access` — no Inventory permission).
 * Only an older server without it (404, or `capabilities.catalogue` false) has Inventory's product list stand in,
 * for people who may read it. The copy is kept sealed (AES-256-GCM, `pos_catalogue`) where the desktop policy lets
 * this computer keep data offline, in memory otherwise. It is a preview: the screens show WorkSuite's price for the
 * cart whenever it answers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SALES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A sale is numbered here (the pairing's prefix and a counter that only goes up, `pos_counters`), sealed and written
 * to `pos_sales` — on disk (synchronous=FULL) before the cashier is told it is done — and then sent, in the order
 * the sales were made, through the till's own door (pos-outbox.ts). The till's credential, not a person's session,
 * sends them, so they keep going with nobody signed in. Sent sales stay (sealed) for ninety days: the history and a
 * reprinted receipt come from them.
 *
 * A sale WorkSuite refuses while the cashier waits was never made: it is removed and the refusal shown, the customer
 * still at the counter. One refused later (sold offline) stays, with the reason, for a person to send again or drop.
 */
const TICK_MS = 30_000;
const BEAT_MS = 60_000;
const MAX_ROUNDS = 20;
const KEEP_SENT_DAYS = 90;
const CATALOGUE_LIMIT = 2000;
/** How often the till's door is asked for the catalogue in the background (an unchanged one costs one short answer). */
const CATALOGUE_MS = 30 * 60_000;
const INVENTORY_PAGE = 100;

export interface PosTillDeps {
  db: Database;
  vault: () => Vault;
  /** The signed-in person's calls (the catalogue). */
  http: Pick<HttpClient, 'request'>;
  desk: Pick<PosDesk, 'pairing' | 'device' | 'heartbeat' | 'door'>;
  origin: () => string | null;
  /** What the company's desktop policy allows this computer. */
  caps: () => { offlineCache: boolean; offlineQueue: 'allowed' | 'drafts_only' | 'disabled' };
  changed: () => void;
  now?: () => number;
}

interface Scope {
  origin: string;
  terminal: number;
  prefix: string;
  usable: boolean;
}

const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null);

/** A product from WorkSuite's till catalogue (the mobile API's shape, ids as strings or numbers). */
export function productFromPos(p: Record<string, unknown>, categories: Map<string, string>): PosProduct | null {
  const id = num(p.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const cat = str(p.category) ?? (str(p.category_id) ? (categories.get(str(p.category_id)!) ?? null) : null);
  return { id, code: str(p.code), barcode: str(p.barcode), name: str(p.name) ?? `#${id}`, unit: str(p.unit), category: cat, price: num(p.price), discount_pct: num(p.discount_pct), tax_rate: num(p.tax_rate) };
}

/** A product from Inventory's list (`GET api/inventory/products`): its own price, no list discount. */
export function productFromInventory(p: Record<string, unknown>): PosProduct | null {
  const id = num(p.id);
  if (!Number.isInteger(id) || id <= 0 || p.kind === 'variable' || p.active === false) return null;
  const variant = str(p.variant_label);
  const name = str(p.name) ?? `#${id}`;
  return {
    id,
    code: str(p.code),
    barcode: str(p.barcode),
    name: variant ? `${name} — ${variant}` : name,
    unit: str(p.unit_code) ?? str(p.unit),
    category: str(p.category),
    price: num(p.unit_price),
    discount_pct: 0,
    tax_rate: num(p.tax_rate),
  };
}

export class PosTill {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private reachable = true;
  private lastContact: string | null = null;
  private lastSync: string | null = null;
  private lastBeat = 0;
  private problem: string | null = null;
  /** The catalogue, when the policy does not let it be kept on disk. */
  private memory = new Map<string, PosCatalogue>();
  /** When the door was last asked for the catalogue (0: not yet since start-up). */
  private lastCatalogue = 0;

  constructor(private readonly d: PosTillDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private scope(): Scope | null {
    const origin = this.d.origin();
    const p = this.d.desk.pairing();
    return origin && p ? { origin, terminal: p.terminal.id, prefix: p.prefix, usable: p.usable } : null;
  }

  private caps(): { keep: boolean; queue: boolean } {
    try {
      const c = this.d.caps();
      return { keep: c.offlineCache, queue: c.offlineQueue === 'allowed' };
    } catch {
      return { keep: false, queue: false };
    }
  }

  /* ── Status ───────────────────────────────────────────────────────── */

  pending(): number {
    const s = this.scope();
    if (!s) return 0;
    return this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM pos_sales WHERE origin = ? AND terminal_id = ? AND state != 'sent'", s.origin, s.terminal)?.n ?? 0;
  }

  status(): PosTillStatus {
    const s = this.scope();
    const p = this.d.desk.pairing();
    const counts = s
      ? this.d.db.all<{ state: string; n: number }>('SELECT state, COUNT(*) AS n FROM pos_sales WHERE origin = ? AND terminal_id = ? GROUP BY state', s.origin, s.terminal)
      : [];
    const count = (st: string) => counts.find((c) => c.state === st)?.n ?? 0;
    const cat = this.catalogue();
    const caps = this.caps();
    let problem = this.problem;
    if (p?.state === 'revoked') problem = 'WorkSuite no longer accepts this till. Pair this computer again; its sales wait here until then.';
    else if (p?.state === 'pos_off') problem = 'POS is switched off on WorkSuite. Sales wait here until it is on again.';
    return {
      till: p ? { terminal: p.terminal, paired_at: p.paired_at, state: p.state, prefix: p.prefix } : null,
      waiting: count('waiting'),
      refused: count('refused'),
      reachable: this.reachable,
      last_contact: this.lastContact,
      last_sync: this.lastSync,
      problem,
      can_queue: caps.queue,
      can_keep: caps.keep,
      catalogue: cat ? { version: cat.version, fetched_at: cat.fetched_at, products: cat.products.length, source: cat.source, truncated: cat.truncated } : null,
    };
  }

  /* ── The catalogue ───────────────────────────────────────────────── */

  catalogue(): PosCatalogue | null {
    const s = this.scope();
    if (!s) return null;
    const mem = this.memory.get(`${s.origin}|${s.terminal}`);
    if (mem) return mem;
    const row = this.d.db.get<{ payload: string }>('SELECT payload FROM pos_catalogue WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal);
    return row ? (this.d.vault().decrypt<PosCatalogue>(row.payload) ?? null) : null;
  }

  private keepCatalogue(s: Scope, c: PosCatalogue): void {
    const key = `${s.origin}|${s.terminal}`;
    if (this.caps().keep) {
      this.memory.delete(key);
      this.d.db.run(
        'INSERT INTO pos_catalogue (origin, terminal_id, version, payload, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(origin, terminal_id) DO UPDATE SET version = excluded.version, payload = excluded.payload, fetched_at = excluded.fetched_at',
        s.origin,
        s.terminal,
        c.version,
        this.d.vault().encrypt(c),
        c.fetched_at,
      );
    } else {
      this.d.db.run('DELETE FROM pos_catalogue WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal);
      this.memory.set(key, c);
    }
  }

  /**
   * Read the catalogue again from WorkSuite, with the signed-in person's session. `capable` is what the server's
   * `options.capabilities.catalogue` said: false is an older server, whose Inventory list stands in.
   */
  async refreshCatalogue(capable?: boolean): Promise<PosCatalogue> {
    const s = this.scope();
    if (!s) throw new DesktopError('NOT_FOUND', 'This computer is not a paired till. Pair it in POS.');
    const have = this.catalogue();
    const c = await this.fetchCatalogue(have, capable);
    this.keepCatalogue(s, c);
    this.d.changed();
    return c;
  }

  /** The door's catalogue, in the background: nobody need be signed in. An older server without it is left alone. */
  private async catalogueInBackground(s: Scope): Promise<void> {
    if (this.now() - this.lastCatalogue < CATALOGUE_MS) return;
    this.lastCatalogue = this.now();
    const have = this.catalogue();
    let a: DeviceAnswer;
    try {
      a = await this.d.desk.door('GET', 'catalogue', { query: { since_version: have?.source === 'pos' ? have.version : undefined } });
    } catch (e) {
      log.info('pos catalogue not refreshed', { error: String((e as Error)?.message ?? e) });
      return;
    }
    if (a.status !== 200 || !a.body) return;
    const c = catalogueOf(a.body, have, this.stamp());
    if (!c) return;
    this.keepCatalogue(s, c);
    this.d.changed();
  }

  private async fetchCatalogue(have: PosCatalogue | null, capable?: boolean): Promise<PosCatalogue> {
    const fetched_at = this.stamp();
    const org = this.d.desk.pairing()?.terminal.org_id;
    if (capable !== false) {
      try {
        const data = await this.d.http.request<Record<string, unknown>>('GET', '/api/pos/catalogue', { query: { org, since_version: have?.source === 'pos' ? have.version : undefined } });
        const c = catalogueOf(data ?? {}, have, fetched_at);
        if (c) return c;
        throw new DesktopError('SERVER_ERROR', 'WorkSuite answered, but not with a till catalogue this app can read.');
      } catch (e) {
        // No till catalogue on this (older) server: Inventory's list stands in, for people who may read it.
        if (!isDesktopError(e) || e.code !== 'NOT_FOUND' || capable === true) throw e;
      }
    }
    const products: PosProduct[] = [];
    let truncated = false;
    for (let page = 1; page <= CATALOGUE_LIMIT / INVENTORY_PAGE; page++) {
      let data: { products?: unknown; total?: unknown };
      try {
        data = await this.d.http.request('GET', '/api/inventory/products', { query: { page, per_page: INVENTORY_PAGE, include_variants: 1, sort: 'name' } });
      } catch (e) {
        if (isDesktopError(e) && (e.code === 'PERMISSION_DENIED' || e.code === 'APP_ACCESS_DENIED' || e.code === 'NOT_FOUND')) {
          throw new DesktopError('PERMISSION_DENIED', 'WorkSuite has no till catalogue for this server yet, and your role cannot read the product list in its place. Ask for Inventory access, or for the POS catalogue on the server.');
        }
        throw e;
      }
      const rows = Array.isArray(data?.products) ? (data.products as Array<Record<string, unknown>>) : [];
      for (const r of rows) {
        const p = productFromInventory(r);
        if (p) products.push(p);
      }
      const total = num(data?.total, rows.length);
      if (rows.length < INVENTORY_PAGE || page * INVENTORY_PAGE >= total) break;
      if (page === CATALOGUE_LIMIT / INVENTORY_PAGE) truncated = true;
    }
    return {
      version: hashOf(products),
      fetched_at,
      currency: null,
      source: 'inventory',
      categories: [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
      products,
      truncated,
    };
  }

  /* ── Sales ────────────────────────────────────────────────────────── */

  private rows(s: Scope, where = '', ...params: Array<string | number>): Queued[] {
    const v = this.d.vault();
    return this.d.db
      .all<{ seq: number; item: string }>(`SELECT seq, item FROM pos_sales WHERE origin = ? AND terminal_id = ? ${where} ORDER BY seq`, s.origin, s.terminal, ...params)
      .map((r) => ({ seq: r.seq, sale: v.decrypt<PosSale>(r.item) }))
      .filter((q): q is Queued => !!q.sale);
  }

  private save(s: Scope, q: Queued): void {
    this.d.db.run('UPDATE pos_sales SET state = ?, item = ?, updated_at = ? WHERE origin = ? AND ref = ?', q.sale.state, this.d.vault().encrypt(q.sale), this.stamp(), s.origin, q.sale.ref);
  }

  /** Number a sale and keep it — on disk before anything else happens to it. */
  private record(s: Scope, input: PosSellInput, cashier: { id: number; name: string | null }): PosSale {
    const created_at = this.stamp();
    return this.d.db.tx(() => {
      const last = this.d.db.get<{ last: number }>('SELECT last FROM pos_counters WHERE origin = ? AND prefix = ?', s.origin, s.prefix)?.last ?? 0;
      const top = this.d.db.get<{ ref: string }>('SELECT ref FROM pos_sales WHERE origin = ? AND ref LIKE ? ORDER BY seq DESC LIMIT 1', s.origin, `${s.prefix}-%`);
      const n = nextSequence(last, top ? sequenceOf(top.ref, s.prefix) : 0);
      this.d.db.run('INSERT INTO pos_counters (origin, prefix, last) VALUES (?, ?, ?) ON CONFLICT(origin, prefix) DO UPDATE SET last = excluded.last', s.origin, s.prefix, n);
      const seq = (this.d.db.get<{ m: number | null }>('SELECT MAX(seq) AS m FROM pos_sales WHERE origin = ?', s.origin)?.m ?? 0) + 1;
      const sale: PosSale = {
        ...input,
        ref: formatReceipt(s.prefix, n),
        created_at,
        terminal_id: s.terminal,
        cashier_id: cashier.id,
        cashier_name: cashier.name,
        state: 'waiting',
        number: null,
        message: null,
        attempts: 0,
        sent_at: null,
      };
      this.d.db.run(
        'INSERT INTO pos_sales (ref, origin, terminal_id, seq, state, session_id, created_at, item, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        sale.ref,
        s.origin,
        s.terminal,
        seq,
        'waiting',
        sale.session_id,
        created_at,
        this.d.vault().encrypt(sale),
        created_at,
      );
      return sale;
    });
  }

  /**
   * Ring up a sale: number it, keep it, and send it now. Answers the sale as it then stands — sent, or waiting for
   * WorkSuite (`queued`). A refusal while WorkSuite answered is thrown: nothing was sold.
   */
  async sell(input: PosSellInput, cashier: { id: number; name: string | null }): Promise<{ sale: PosSale; queued: boolean }> {
    const s = this.scope();
    if (!s) throw new DesktopError('NOT_FOUND', 'This computer is not a paired till. Pair it in POS.');
    if (!s.usable) throw new DesktopError('PERMISSION_DENIED', 'WorkSuite no longer accepts this till. Pair this computer again before selling.');
    if (!Number.isInteger(cashier.id) || cashier.id <= 0) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to sell.');
    if (!this.reachable && !this.caps().queue) {
      throw new DesktopError('POLICY_DENIED', 'WorkSuite cannot be reached, and your organization does not let this computer keep sales to send later.');
    }
    const sale = this.record(s, input, cashier);
    this.d.changed();
    // Straight to the sales door: the cashier does not wait for a heartbeat.
    await this.sync(false);
    const now = this.rows(s, 'AND ref = ?', sale.ref)[0]?.sale ?? sale;
    if (now.state === 'refused') {
      // WorkSuite answered, and said no, while the customer is still here: it was never sold.
      this.d.db.run('DELETE FROM pos_sales WHERE origin = ? AND ref = ?', s.origin, sale.ref);
      this.d.changed();
      throw new DesktopError('CONFLICT', now.message ?? 'WorkSuite would not record this sale.');
    }
    return { sale: now, queued: now.state !== 'sent' };
  }

  /** The till's sales, newest first: this session's, or since a moment. */
  sales(filter: { session_id?: number; since?: string; limit?: number } = {}): PosSale[] {
    const s = this.scope();
    if (!s) return [];
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.session_id) {
      where.push('AND session_id = ?');
      params.push(filter.session_id);
    }
    if (filter.since) {
      where.push('AND created_at >= ?');
      params.push(filter.since);
    }
    return this.rows(s, where.join(' '), ...params)
      .reverse()
      .slice(0, filter.limit ?? 200)
      .map((q) => q.sale);
  }

  sale(ref: string): PosSale | null {
    const s = this.scope();
    return s ? (this.rows(s, 'AND ref = ?', ref)[0]?.sale ?? null) : null;
  }

  /** A refused sale: send it again as it is (the reason may have gone), or drop it. */
  async resolve(ref: string, action: 'retry' | 'drop'): Promise<PosTillStatus> {
    const s = this.scope();
    const q = s ? this.rows(s, 'AND ref = ?', ref)[0] : undefined;
    if (!s || !q) throw new DesktopError('NOT_FOUND', 'That sale is not on this till.');
    if (q.sale.state !== 'refused') throw new DesktopError('CONFLICT', 'Only a sale WorkSuite refused can be sent again or dropped.');
    if (action === 'drop') this.d.db.run('DELETE FROM pos_sales WHERE origin = ? AND ref = ?', s.origin, ref);
    else this.save(s, { ...q, sale: { ...q.sale, state: 'waiting', message: null } });
    this.d.changed();
    if (action === 'retry') await this.sync();
    return this.status();
  }

  /* ── After the sale: WorkSuite's receipt, e-mail, refunds and voids (the till's door, the cashier named) ── */

  private sent(ref: string): { s: Scope; q: Queued } {
    const s = this.scope();
    const q = s ? this.rows(s, 'AND ref = ?', ref)[0] : undefined;
    if (!s || !q) throw new DesktopError('NOT_FOUND', 'That sale is not on this till.');
    if (!s.usable) throw new DesktopError('PERMISSION_DENIED', 'WorkSuite no longer accepts this till. Pair this computer again.');
    if (q.sale.state !== 'sent') throw new DesktopError('CONFLICT', 'That sale has not reached WorkSuite yet.');
    return { s, q };
  }

  private reached(): void {
    this.reachable = true;
    this.lastContact = this.stamp();
  }

  /** WorkSuite's receipt for one of this till's sales (`GET device/sales/{ref}/receipt`), or null when it has none to give. */
  async serverReceipt(ref: string): Promise<PosServerReceipt | null> {
    this.sent(ref);
    const a = await this.d.desk.door('GET', `sales/${encodeURIComponent(ref)}/receipt`);
    this.reached();
    return a.status === 200 ? receiptOf(a.body?.receipt) : null;
  }

  /** E-mail the receipt: to the address given, else the customer's on the sale (WorkSuite's rule). */
  async email(ref: string, email: string | undefined): Promise<{ message: string }> {
    this.sent(ref);
    const a = await this.d.desk.door('POST', `sales/${encodeURIComponent(ref)}/email`, { body: email ? { email } : {} });
    this.reached();
    if (a.status !== 200) throw doorError(a, 'WorkSuite could not e-mail the receipt.');
    return { message: str(a.body?.message) ?? 'The receipt was e-mailed.' };
  }

  /**
   * Refund (every line, or the quantities named) or void one of this till's sales, by its receipt number, with the
   * cashier named — WorkSuite asks them for `pos.sale.refund` / `pos.sale.void` now. The request carries the till's own
   * number for it (`<receipt>-R<n>`, `<receipt>-V`), so a request whose answer was lost, sent again, is the same
   * refund. A refund's cash leaves the drawer open at this till; a void is recorded in the sale's own session, while it
   * is open. What WorkSuite answers — the amount, the tenders it went back on, the cash out — is kept on the sale.
   */
  async giveBack(input: PosGiveBack, cashier: { id: number }): Promise<{ sale: PosSale; refund: PosReturn; message: string }> {
    const { s, q } = this.sent(input.ref);
    if (q.sale.voided) throw new DesktopError('CONFLICT', 'That sale was voided.');
    const own = returnRef(q.sale, input.kind);
    const body: Record<string, unknown> = { ref: own, cashier_id: cashier.id, reason: input.reason };
    if (input.kind === 'refund' && input.lines?.length) body.lines = input.lines;
    if (input.kind === 'refund' && input.restock === false) body.restock = false;
    const a = await this.d.desk.door('POST', `sales/${encodeURIComponent(q.sale.ref)}/${input.kind}`, { body });
    this.reached();
    if (a.status !== 200 && a.status !== 201) throw doorError(a, input.kind === 'void' ? 'WorkSuite did not void the sale.' : 'WorkSuite did not refund the sale.');
    const refund = returnOf(a.body?.refund, input.kind, own, this.stamp());
    const shape = (a.body?.sale ?? null) as Record<string, unknown> | null;
    const sale: PosSale = {
      ...q.sale,
      returns: [...(q.sale.returns ?? []).filter((r) => r.ref !== refund.ref), refund],
      voided: shape?.voided === true || input.kind === 'void',
      ...(typeof shape?.total === 'number' ? { server_total: shape.total } : {}),
      ...(shape && 'review' in shape ? { review: str(shape.review) } : {}),
    };
    this.save(s, { ...q, sale });
    this.d.changed();
    return { sale, refund, message: str(a.body?.message) ?? (input.kind === 'void' ? 'The sale was voided.' : 'The refund was recorded.') };
  }

  /* ── Sending ──────────────────────────────────────────────────────── */

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), TICK_MS);
    this.timer.unref?.();
    void this.sync();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Call in and send what waits (single-flight: a call while one runs waits for it and runs once more). */
  async sync(beat = true): Promise<PosTillStatus> {
    if (this.running) {
      this.again = true;
      await this.running;
      return this.status();
    }
    this.running = this.run(beat)
      .catch((e) => log.warn('pos sync failed', { error: String((e as Error)?.message ?? e) }))
      .finally(() => {
        this.running = null;
      });
    await this.running;
    if (this.again) {
      this.again = false;
      return this.sync();
    }
    return this.status();
  }

  private unreachable(e: unknown): void {
    this.reachable = false;
    this.problem = isDesktopError(e) && e.code !== 'NETWORK_UNREACHABLE' ? e.message : null;
  }

  private async run(beat: boolean): Promise<void> {
    const s = this.scope();
    if (!s || !s.usable) return;
    const before = this.reachable;
    if (beat && this.now() - this.lastBeat >= BEAT_MS) {
      try {
        const a = await this.d.desk.heartbeat(this.pending());
        this.lastBeat = this.now();
        this.reachable = true;
        this.lastContact = this.stamp();
        if (a.status === 401 || a.status === 503) {
          this.d.changed();
          return;
        }
      } catch (e) {
        this.unreachable(e);
        if (before) this.d.changed();
        return;
      }
    }
    let progressed = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const send = batch(this.rows(s, "AND state = 'waiting'"));
      if (send.length === 0) break;
      let answer;
      try {
        answer = await this.d.desk.device('sales', { sales: send.map((q) => saleBody(q.sale)) });
      } catch (e) {
        this.unreachable(e);
        break;
      }
      this.reachable = true;
      this.lastContact = this.stamp();
      const v = readAnswer(answer.status, answer.body);
      if (v.kind !== 'results') {
        this.problem = v.kind === 'reauth' || v.kind === 'off' ? null : v.message;
        if (v.kind === 'bad' || v.kind === 'retry') for (const q of send) this.save(s, { ...q, sale: { ...q.sale, attempts: q.sale.attempts + 1 } });
        break;
      }
      this.problem = null;
      const done = apply(send, v.results, this.stamp());
      this.d.db.tx(() => {
        for (const q of done.updated) this.save(s, q);
      });
      progressed = true;
      if (done.created + done.duplicates + done.refused.length === 0) break;
    }
    if (beat && this.reachable) await this.catalogueInBackground(s);
    const cutoff = new Date(this.now() - KEEP_SENT_DAYS * 86_400_000).toISOString();
    this.d.db.run("DELETE FROM pos_sales WHERE origin = ? AND terminal_id = ? AND state = 'sent' AND created_at < ?", s.origin, s.terminal, cutoff);
    this.lastSync = this.stamp();
    if (progressed || before !== this.reachable) this.d.changed();
  }

  /* ── Forgetting ───────────────────────────────────────────────────── */

  /** What this till kept on this server (the pairing is forgotten, or another till is paired). */
  forgetTill(origin: string, terminalId: number): void {
    this.d.db.run('DELETE FROM pos_sales WHERE origin = ? AND terminal_id = ?', origin, terminalId);
    this.d.db.run('DELETE FROM pos_catalogue WHERE origin = ? AND terminal_id = ?', origin, terminalId);
    this.memory.delete(`${origin}|${terminalId}`);
    this.d.changed();
  }

  /** Every till's copy, sales and counters (a wipe). */
  forgetAll(): void {
    this.d.db.run('DELETE FROM pos_sales');
    this.d.db.run('DELETE FROM pos_catalogue');
    this.d.db.run('DELETE FROM pos_counters');
    this.memory.clear();
  }
}

function hashOf(products: PosProduct[]): string {
  return createHash('sha256').update(JSON.stringify(products)).digest('hex').slice(0, 16);
}

/** A catalogue answer (staff API or door, the same keys), or null when it is neither a catalogue nor "unchanged". */
export function catalogueOf(data: Record<string, unknown>, have: PosCatalogue | null, fetched_at: string): PosCatalogue | null {
  if (data.unchanged === true) return have && have.source === 'pos' ? { ...have, fetched_at } : null;
  if (!Array.isArray(data.products)) return null;
  const cats = Array.isArray(data.categories) ? (data.categories as Array<Record<string, unknown>>) : [];
  const names = new Map(cats.map((c) => [str(c.id) ?? '', str(c.name) ?? ''] as const));
  const products = (data.products as Array<Record<string, unknown>>).map((p) => productFromPos(p, names)).filter((p): p is PosProduct => !!p);
  return {
    version: str(data.version) ?? hashOf(products),
    fetched_at,
    currency: str(data.currency),
    source: 'pos',
    categories: [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    products,
    truncated: data.truncated === true,
  };
}

/** The till's own number for a refund or void of a sale: the next refund's, or the sale's one void. */
export function returnRef(sale: PosSale, kind: 'refund' | 'void'): string {
  if (kind === 'void') return `${sale.ref}-V`;
  return `${sale.ref}-R${(sale.returns ?? []).filter((r) => r.kind === 'refund').length + 1}`;
}

/** A refund or void as WorkSuite answered it (`Returns::shape`). */
export function returnOf(v: unknown, kind: 'refund' | 'void', ref: string, at: string): PosReturn {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? (x as Array<Record<string, unknown>>) : []);
  const note = r.credit_note && typeof r.credit_note === 'object' ? str((r.credit_note as Record<string, unknown>).number) : null;
  return {
    ref: str(r.ref) ?? ref,
    kind: r.kind === 'void' || r.kind === 'refund' ? r.kind : kind,
    status: str(r.status) ?? 'done',
    amount: num(r.amount),
    cash_out: num(r.cash_out),
    tenders: list(r.tenders).map((t) => ({ method: str(t.method) ?? 'other', amount: num(t.amount) })),
    lines: list(r.lines).map((l) => ({ product_id: num(l.product_id) || null, quantity: num(l.quantity) })),
    reason: str(r.reason),
    credit_note: note,
    at: str(r.created_at) ?? at,
  };
}

/** WorkSuite's receipt (`Receipt::data`), or null when it is not one. */
export function receiptOf(v: unknown): PosServerReceipt | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const obj = (x: unknown) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});
  const list = (x: unknown) => (Array.isArray(x) ? (x as Array<Record<string, unknown>>) : []);
  const receipt_no = str(r.receipt_no);
  if (!receipt_no || !Array.isArray(r.lines)) return null;
  const co = obj(r.company);
  const t = obj(r.totals);
  const cust = r.customer && typeof r.customer === 'object' ? obj(r.customer) : null;
  return {
    company: { name: str(co.name) ?? '', address: str(co.address), phone: str(co.phone), tax_number: str(co.tax_number) },
    receipt_no,
    order_number: str(r.order_number),
    invoice_number: str(r.invoice_number),
    register: str(r.register),
    cashier: str(r.cashier),
    customer: cust && str(cust.name) ? { name: str(cust.name)!, email: str(cust.email) } : null,
    at: str(r.at),
    currency: str(r.currency) ?? '',
    lines: list(r.lines).map((l) => ({ description: str(l.description) ?? '', quantity: num(l.quantity), unit_price: num(l.unit_price), discount_pct: num(l.discount_pct), amount: num(l.amount), tax: num(l.tax), total: num(l.total) })),
    taxes: list(r.taxes).map((x) => ({ name: str(x.name) ?? '', amount: num(x.amount) })),
    totals: { subtotal: num(t.subtotal), discount: num(t.discount), tax: num(t.tax), total: num(t.total) },
    tenders: list(r.tenders).map((x) => ({ label: str(x.label) ?? str(x.method) ?? '', amount: num(x.amount), reference: str(x.reference) })),
    change: num(r.change),
    refunds: list(r.refunds).map((x) => ({ ref: str(x.ref) ?? '', kind: str(x.kind) ?? 'refund', amount: num(x.amount), cash: num(x.cash), reason: str(x.reason) })),
    refunded: num(r.refunded),
    status: str(r.status) ?? 'paid',
    void_reason: str(r.void_reason),
    footer: str(r.footer) ?? '',
  };
}

/** The door's refusal as an error the screens show: WorkSuite's sentence, with a code that says what it was. */
export function doorError(a: DeviceAnswer, fallback: string): DesktopError {
  const message = str(a.body?.message) ?? fallback;
  if (a.status === 401) return new DesktopError('PERMISSION_DENIED', 'WorkSuite no longer accepts this till. Pair this computer again.', 401);
  if (a.status === 503) return new DesktopError('SERVER_ERROR', 'POS is switched off on WorkSuite.', 503);
  if (a.status === 403) return new DesktopError('PERMISSION_DENIED', message, 403);
  if (a.status === 404) return new DesktopError('NOT_FOUND', message, 404);
  if (a.status === 409 || a.status === 422) return new DesktopError('CONFLICT', message, a.status);
  return new DesktopError('SERVER_ERROR', message, a.status);
}
