import { createHash } from 'node:crypto';
import {
  approvalAskOf,
  formatReceipt,
  POS_APPROVAL_CODES,
  POS_DRAWER_REFUSALS,
  receiptTemplateOf,
  tenderOptionsOf,
  type PosApprovalNeed,
  type PosCatalogue,
  type PosCategoryNode,
  type PosDeskAnswer,
  type PosDeskOp,
  type PosGiveBack,
  type PosProduct,
  type PosReceiptTemplate,
  type PosReturn,
  type PosSale,
  type PosSellInput,
  type PosServerReceipt,
  type PosStockState,
  type PosTillStatus,
} from '@shared/pos';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { DeviceAnswer, PosDesk } from './pos-desk';
import { apply, batch, flagsOf, loyaltyOf, nextSequence, POS_OFF, readAnswer, saleBody, sequenceOf, type Queued } from './pos-outbox';
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
 *
 * No drawer, no sale: WorkSuite takes a sale only into an open register session. The register screen sells only while
 * one is open here; a sale that reaches WorkSuite after its register closed is still taken when it was made while the
 * register was open (`late`, flagged for review). Otherwise it is refused `drawer_closed` — or `session_not_here`, the
 * session it names being another till's — and kept with that reason; sent again, it goes into the register open now.
 */
const TICK_MS = 30_000;
const BEAT_MS = 60_000;
const MAX_ROUNDS = 20;
const KEEP_SENT_DAYS = 90;
const CATALOGUE_LIMIT = 2000;
/** How often the till's door is asked for the catalogue in the background (an unchanged one costs one short answer). */
const CATALOGUE_MS = 30 * 60_000;
const INVENTORY_PAGE = 100;
/** The company's receipt template, asked for with the catalogue (and kept, as the printer's layout, per till). */
const TEMPLATE_KEY = 'pos-receipt-template';

export interface PosTillDeps {
  db: Database;
  vault: () => Vault;
  /** The signed-in person's calls (the catalogue). */
  http: Pick<HttpClient, 'request'>;
  desk: Pick<PosDesk, 'pairing' | 'device' | 'heartbeat' | 'door'>;
  /** Where the receipt template is kept (the config table; it is layout, not a secret). */
  config?: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
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

const STOCK: ReadonlySet<string> = new Set(['in_stock', 'low', 'out', 'untracked']);

/** A product from WorkSuite's till catalogue (the mobile API's shape, ids as strings or numbers), with Phase 2's fields where sent. */
export function productFromPos(p: Record<string, unknown>, categories: Map<string, string>, tree = false): PosProduct | null {
  const id = num(p.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const cat = str(p.category) ?? (str(p.category_id) ? (categories.get(str(p.category_id)!) ?? null) : null);
  const out: PosProduct = { id, code: str(p.code), barcode: str(p.barcode), name: str(p.name) ?? `#${id}`, unit: str(p.unit), category: cat, price: num(p.price), discount_pct: num(p.discount_pct), tax_rate: num(p.tax_rate) };
  // Phase 2 — each only when the server sent it, so an older catalogue reads exactly as before.
  if (tree && str(p.category_id)) out.category_id = str(p.category_id);
  if (typeof p.stock_state === 'string' && STOCK.has(p.stock_state)) out.stock_state = p.stock_state as PosStockState;
  else if (p.out_of_stock === true) out.stock_state = 'out';
  else if (p.low_stock === true) out.stock_state = 'low';
  if ('stock_available' in p) out.stock_available = p.stock_available === null ? null : num(p.stock_available);
  if (str(p.image_url)) out.image = true;
  if (str(p.promo_label)) out.promo_label = str(p.promo_label)!.slice(0, 40);
  if (p.favourite === true) out.favourite = true;
  return out;
}

/** The catalogue's tree of categories (`category_tree`), checked: ids and names, children within reason. */
export function categoryTreeOf(v: unknown, depth = 0): PosCategoryNode[] {
  if (!Array.isArray(v) || depth > 6) return [];
  const out: PosCategoryNode[] = [];
  for (const x of v.slice(0, 500)) {
    if (!x || typeof x !== 'object') continue;
    const c = x as Record<string, unknown>;
    const id = str(c.id);
    const name = str(c.name);
    if (!id || !name) continue;
    out.push({ id, name: name.slice(0, 80), parent_id: str(c.parent_id), product_count: Math.max(0, Math.floor(num(c.product_count))), children: categoryTreeOf(c.children, depth + 1) });
  }
  return out;
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
  /** WorkSuite's own sentence the last time it said POS is switched off (503), shown while it stays off. */
  private offMessage: string | null = null;
  /** The catalogue, when the policy does not let it be kept on disk. */
  private memory = new Map<string, PosCatalogue>();
  /** When the door was last asked for the catalogue (0: not yet since start-up). */
  private lastCatalogue = 0;
  /** The receipt template, when the policy does not let it be kept (or no config is given). */
  private templates = new Map<string, PosReceiptTemplate | null>();

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
    else if (p?.state === 'pos_off') problem = `${this.offMessage ?? POS_OFF} Sales wait here until it is on again.`;
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
    void this.refreshTemplate();
    const c = await this.fetchCatalogue(have, capable);
    this.keepCatalogue(s, c);
    this.d.changed();
    return c;
  }

  /** The tenders a heartbeat (or the door's `tenders`) named, onto the catalogue copy: they go with it, offline too. */
  private keepTenders(s: Scope, v: unknown): void {
    const tenders = tenderOptionsOf(v);
    const have = this.catalogue();
    if (!tenders || !have || JSON.stringify(have.tenders ?? null) === JSON.stringify(tenders)) return;
    this.keepCatalogue(s, { ...have, tenders });
    this.d.changed();
  }

  /* ── The receipt template (Phase 2 S3) ────────────────────────────── */

  private templateKey(s: Scope): string {
    return `${s.origin}|${s.terminal}`;
  }

  /** The company's published receipt template as last read, or null: the till prints today's receipt. */
  template(): PosReceiptTemplate | null {
    const s = this.scope();
    if (!s) return null;
    const key = this.templateKey(s);
    if (this.templates.has(key)) return this.templates.get(key) ?? null;
    const kept = this.d.config?.getConfig<Record<string, unknown>>(TEMPLATE_KEY)?.[key];
    return receiptTemplateOf(kept);
  }

  private keepTemplate(s: Scope, t: PosReceiptTemplate | null): void {
    const key = this.templateKey(s);
    if (!this.d.config || !this.caps().keep) {
      this.templates.set(key, t);
      return;
    }
    this.templates.delete(key);
    const all = { ...(this.d.config.getConfig<Record<string, unknown>>(TEMPLATE_KEY) ?? {}) };
    if (t) all[key] = t;
    else delete all[key];
    this.d.config.setConfig(TEMPLATE_KEY, all);
  }

  /** Ask the door for the template (`GET receipt-template`); an older server (404) prints today's receipt. */
  async refreshTemplate(): Promise<PosReceiptTemplate | null> {
    const s = this.scope();
    if (!s || !s.usable) return this.template();
    let a: DeviceAnswer;
    try {
      a = await this.d.desk.door('GET', 'receipt-template');
    } catch (e) {
      log.info('pos receipt template not read', { error: String((e as Error)?.message ?? e) });
      return this.template();
    }
    if (a.status === 200) this.keepTemplate(s, receiptTemplateOf(a.body?.template));
    else if (a.status === 404) this.keepTemplate(s, null);
    return this.template();
  }

  /** The door's catalogue, in the background: nobody need be signed in. An older server without it is left alone. */
  private async catalogueInBackground(s: Scope): Promise<void> {
    if (this.now() - this.lastCatalogue < CATALOGUE_MS) return;
    this.lastCatalogue = this.now();
    void this.refreshTemplate();
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
    this.keepCatalogue(s, withTenders(c, a.body));
    this.d.changed();
  }

  private async fetchCatalogue(have: PosCatalogue | null, capable?: boolean): Promise<PosCatalogue> {
    const fetched_at = this.stamp();
    const org = this.d.desk.pairing()?.terminal.org_id;
    if (capable !== false) {
      try {
        const data = await this.d.http.request<Record<string, unknown>>('GET', '/api/pos/catalogue', { query: { org, since_version: have?.source === 'pos' ? have.version : undefined } });
        const c = catalogueOf(data ?? {}, have, fetched_at);
        if (c) return withTenders(c, data ?? {});
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
  async sell(input: PosSellInput, cashier: { id: number; name: string | null }): Promise<{ sale: PosSale; queued: boolean } | { needs: PosApprovalNeed }> {
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
      // A discount past the cashier's rights (or an approval that no longer fits): a manager can approve it, and the
      // sale is made again with the approval. Not bound to this number — the next try is numbered afresh.
      const need = needOf(now.code ?? null, now.message, now.approval ?? null, 'discount', input.discount_pct);
      if (need) return { needs: { ...need, ask: { ...need.ask, subject: null } } };
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

  /**
   * A refused sale: send it again as it is (the reason may have gone), or drop it. One refused for its drawer
   * (`drawer_closed`, `session_not_here`) is sent into the register open at this till now (`sessionId`) — without one,
   * WorkSuite would only refuse it again.
   */
  async resolve(ref: string, action: 'retry' | 'drop', sessionId?: number): Promise<PosTillStatus> {
    const s = this.scope();
    const q = s ? this.rows(s, 'AND ref = ?', ref)[0] : undefined;
    if (!s || !q) throw new DesktopError('NOT_FOUND', 'That sale is not on this till.');
    if (q.sale.state !== 'refused') throw new DesktopError('CONFLICT', 'Only a sale WorkSuite refused can be sent again or dropped.');
    const drawer = !!q.sale.code && POS_DRAWER_REFUSALS.has(q.sale.code);
    if (action === 'retry' && drawer && !sessionId) throw new DesktopError('CONFLICT', 'No register is open at this till. Open the register, then send the sale again.');
    if (action === 'drop') this.d.db.run('DELETE FROM pos_sales WHERE origin = ? AND ref = ?', s.origin, ref);
    else if (drawer && sessionId) {
      const sale: PosSale = { ...q.sale, state: 'waiting', message: null, code: null, session_id: sessionId };
      this.d.db.run('UPDATE pos_sales SET session_id = ? WHERE origin = ? AND ref = ?', sessionId, s.origin, ref);
      this.save(s, { ...q, sale });
    } else this.save(s, { ...q, sale: { ...q.sale, state: 'waiting', message: null, code: null } });
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
  async giveBack(input: PosGiveBack, cashier: { id: number }): Promise<{ sale: PosSale; refund: PosReturn; message: string } | { needs: PosApprovalNeed }> {
    const { s, q } = this.sent(input.ref);
    if (q.sale.voided) throw new DesktopError('CONFLICT', 'That sale was voided.');
    // The same number for a refund asked again with a manager's approval: a lost answer is never a second refund.
    const own = returnRef(q.sale, input.kind);
    const body: Record<string, unknown> = { ref: own, cashier_id: cashier.id, reason: input.reason };
    if (input.kind === 'refund' && input.lines?.length) body.lines = input.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, ...(l.condition ? { condition: l.condition } : {}) }));
    if (input.kind === 'refund' && input.restock === false) body.restock = false;
    // Phase 2 (`capabilities.refund_to`): where the money goes; only sent when the person chose other than "as paid".
    if (input.kind === 'refund' && input.refund_to && input.refund_to !== 'original') body.refund_to = input.refund_to;
    if (input.approval_id) body.approval_id = input.approval_id;
    const a = await this.d.desk.door('POST', `sales/${encodeURIComponent(q.sale.ref)}/${input.kind}`, { body });
    this.reached();
    if (a.status === 403) {
      const need = needOf(str(a.body?.code), str(a.body?.message), approvalAskOf(a.body?.approval, input.kind), input.kind, null, q.sale.ref);
      if (need) return { needs: need };
    }
    if (a.status !== 200 && a.status !== 201) throw doorError(a, input.kind === 'void' ? 'WorkSuite did not void the sale.' : 'WorkSuite did not refund the sale.');
    const refund = returnOf(a.body?.refund, input.kind, own, this.stamp());
    const shape = (a.body?.sale ?? null) as Record<string, unknown> | null;
    const sale: PosSale = {
      ...q.sale,
      returns: [...(q.sale.returns ?? []).filter((r) => r.ref !== refund.ref), refund],
      voided: shape?.voided === true || input.kind === 'void',
      ...(typeof shape?.total === 'number' ? { server_total: shape.total } : {}),
      ...(shape && 'review' in shape ? { review: str(shape.review) } : {}),
      ...(shape && Array.isArray(shape.flags) ? { flags: flagsOf(shape.flags) } : {}),
    };
    this.save(s, { ...q, sale });
    this.d.changed();
    return { sale, refund, message: str(a.body?.message) ?? (input.kind === 'void' ? 'The sale was voided.' : 'The refund was recorded.') };
  }

  /* ── Phase 2's counter, through the till's door ──────────────────── */

  /**
   * One of the counter's calls (shared/pos.ts `posDeskSchema`) through the till's door, the cashier the signed-in
   * person (named here, never by the screen). The answer is WorkSuite's as it came — the screens read it — except that
   * the template is also kept for the printer.
   */
  async desk(op: PosDeskOp, cashier: { id: number } | null): Promise<PosDeskAnswer> {
    const s = this.scope();
    if (!s) throw new DesktopError('NOT_FOUND', 'This computer is not a paired till. Pair it in POS.');
    if (!s.usable) throw new DesktopError('PERMISSION_DENIED', 'WorkSuite no longer accepts this till. Pair this computer again.');
    const who = (): number => {
      if (!cashier || !Number.isInteger(cashier.id) || cashier.id <= 0) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to do that at the till.');
      return cashier.id;
    };
    const call = deskCall(op, who);
    let a: DeviceAnswer;
    try {
      a = await this.d.desk.door(call.method, call.path, { ...(call.body ? { body: call.body } : {}), ...(call.query ? { query: call.query } : {}) });
    } catch (e) {
      this.unreachable(e);
      throw e;
    }
    this.reached();
    if (op.op === 'template' && (a.status === 200 || a.status === 404)) this.keepTemplate(s, a.status === 200 ? receiptTemplateOf(a.body?.template) : null);
    if (op.op === 'tenders' && a.status === 200) this.keepTenders(s, a.body?.tenders);
    if (a.status === 503) throw doorError(a, POS_OFF);
    if (a.status === 401) throw doorError(a, 'WorkSuite no longer accepts this till.');
    return { status: a.status, body: a.body };
  }

  /** A manager's PIN, passed straight to the door (`POST approvals`) and forgotten: never logged, never kept. */
  async approve(input: { approver_id: number; pin: string; action: string; amount: number; subject?: string; reason?: string }, cashier: { id: number }): Promise<PosDeskAnswer> {
    const s = this.scope();
    if (!s || !s.usable) throw new DesktopError('NOT_FOUND', 'This computer is not a paired till. Pair it in POS.');
    const body = { cashier_id: cashier.id, approver_id: input.approver_id, pin: input.pin, action: input.action, amount: input.amount, ...(input.subject ? { subject: input.subject } : {}), ...(input.reason ? { reason: input.reason } : {}) };
    const a = await this.d.desk.door('POST', 'approvals', { body });
    this.reached();
    if (a.status === 503 || a.status === 401) throw doorError(a, POS_OFF);
    return { status: a.status, body: a.body };
  }

  /** Name this device on the server (`POST name`, `capabilities.device_rename`). */
  async rename(name: string): Promise<{ device_name: string; message: string }> {
    const s = this.scope();
    if (!s || !s.usable) throw new DesktopError('NOT_FOUND', 'This computer is not a paired till. Pair it in POS.');
    const a = await this.d.desk.door('POST', 'name', { body: { device_name: name.trim().slice(0, 120) } });
    this.reached();
    if (a.status !== 200) throw doorError(a, 'WorkSuite did not rename this device.');
    return { device_name: str(a.body?.device_name) ?? name.trim(), message: str(a.body?.message) ?? 'Device renamed.' };
  }

  /**
   * Hand the till back on the server (`POST unpair`, `capabilities.device_unpair`) before it is forgotten here: the
   * credential stops working at once and the till is free to pair again. False when WorkSuite did not (an older server,
   * out of reach): the till is forgotten here all the same, and a manager can revoke it from WorkSuite.
   */
  async unpair(): Promise<boolean> {
    const s = this.scope();
    if (!s || !s.usable) return false;
    try {
      const a = await this.d.desk.door('POST', 'unpair', { body: {} });
      return a.status === 200 || a.status === 401;
    } catch (e) {
      log.info('pos till not unpaired on the server', { error: String((e as Error)?.message ?? e) });
      return false;
    }
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
          if (a.status === 503) this.offMessage = str(a.body?.message)?.slice(0, 300) ?? null;
          this.d.changed();
          return;
        }
        // Phase 2: the tenders the till may offer, so a change on the settings screen reaches it on its next beat.
        if (a.status === 200) this.keepTenders(s, a.body?.tenders);
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
        if (v.kind === 'off') this.offMessage = v.message.slice(0, 300);
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
    const key = `${origin}|${terminalId}`;
    this.templates.delete(key);
    const kept = this.d.config?.getConfig<Record<string, unknown>>(TEMPLATE_KEY);
    if (kept && key in kept) {
      const { [key]: _gone, ...rest } = kept;
      this.d.config!.setConfig(TEMPLATE_KEY, rest);
    }
    this.d.changed();
  }

  /** Every till's copy, sales and counters (a wipe). */
  forgetAll(): void {
    this.d.db.run('DELETE FROM pos_sales');
    this.d.db.run('DELETE FROM pos_catalogue');
    this.d.db.run('DELETE FROM pos_counters');
    this.memory.clear();
    this.templates.clear();
    this.d.config?.deleteConfig(TEMPLATE_KEY);
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
  const tree = categoryTreeOf(data.category_tree);
  const products = (data.products as Array<Record<string, unknown>>).map((p) => productFromPos(p, names, tree.length > 0)).filter((p): p is PosProduct => !!p);
  const out: PosCatalogue = {
    version: str(data.version) ?? hashOf(products),
    fetched_at,
    currency: str(data.currency),
    source: 'pos',
    categories: [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    products,
    truncated: data.truncated === true,
  };
  // Phase 2, where the server sent them: the groups, the favourites and the tenders the till may offer.
  if (tree.length) out.category_tree = tree;
  if (Array.isArray(data.favourites)) out.favourites = (data.favourites as unknown[]).map((x) => num(x)).filter((x) => Number.isInteger(x) && x > 0).slice(0, 200);
  const tenders = tenderOptionsOf(data.tenders);
  if (tenders) out.tenders = tenders;
  return out;
}

/** Tenders sent beside an unchanged catalogue still apply: they are the company's now. */
export function withTenders(c: PosCatalogue, data: Record<string, unknown>): PosCatalogue {
  const tenders = tenderOptionsOf(data.tenders);
  return tenders ? { ...c, tenders } : c;
}

/** Codes that mean a manager's approval would lift the refusal. */
export function needOf(code: string | null, message: string | null, ask: ReturnType<typeof approvalAskOf>, action: 'discount' | 'refund' | 'void', amount: number | null, subject: string | null = null): PosApprovalNeed | null {
  if (!code || !POS_APPROVAL_CODES.has(code)) return null;
  const a = ask ?? (amount !== null ? { action, amount, threshold: null, subject } : null);
  if (!a) return null;
  return { code, message: message ?? 'This needs a manager’s approval.', ask: { ...a, subject: a.subject ?? subject } };
}

/** What one of the counter's operations asks of the door. */
export function deskCall(op: PosDeskOp, cashier: () => number): { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown>; query?: Record<string, string | number | undefined> } {
  switch (op.op) {
    case 'tenders':
      return { method: 'GET', path: 'tenders' };
    case 'held':
      return { method: 'GET', path: 'held' };
    case 'park': {
      const { op: _op, ...rest } = op;
      return { method: 'POST', path: 'held', body: { cashier_id: cashier(), ...rest } };
    }
    case 'recall':
      return { method: 'POST', path: `held/${op.id}/recall`, body: { cashier_id: cashier() } };
    case 'discard':
      return { method: 'POST', path: `held/${op.id}/discard`, body: { cashier_id: cashier() } };
    case 'voucher':
      return { method: 'GET', path: `vouchers/${op.code.toUpperCase()}` };
    case 'credit':
      return { method: 'GET', path: `store-credit/${op.client_id}` };
    case 'approvers':
      return { method: 'GET', path: 'approvers' };
    case 'ask': {
      const { op: _op, ...rest } = op;
      return { method: 'POST', path: 'approval-requests', body: { cashier_id: cashier(), ...rest } };
    }
    case 'request':
      return { method: 'GET', path: `approval-requests/${op.id}`, query: { cashier_id: cashier() } };
    case 'cancel':
      return { method: 'POST', path: `approval-requests/${op.id}/cancel`, body: { cashier_id: cashier() } };
    case 'customers':
      return { method: 'GET', path: 'customers', query: { q: op.q } };
    case 'customer':
      return { method: 'GET', path: `customers/${op.id}` };
    case 'customerCreate': {
      const { op: _op, ...rest } = op;
      return { method: 'POST', path: 'customers', body: { cashier_id: cashier(), ...rest } };
    }
    case 'loyalty':
      return { method: 'GET', path: 'loyalty' };
    case 'topSellers':
      return { method: 'GET', path: 'top-sellers', query: { limit: op.limit ?? 10 } };
    case 'stock':
      return { method: 'GET', path: 'stock', query: { ids: op.ids?.length ? op.ids.join(',') : undefined } };
    case 'report':
      return { method: 'GET', path: op.session_id ? `sessions/${op.session_id}/report` : 'session/report' };
    case 'template':
      return { method: 'GET', path: 'receipt-template' };
  }
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
    tenders: list(r.tenders).map((t) => ({ method: str(t.method) ?? 'other', amount: num(t.amount), ...(str(t.to) ? { to: str(t.to)! } : {}) })),
    ...(str(r.refund_to) ? { refund_to: str(r.refund_to) } : {}),
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
    company: { name: str(co.name) ?? '', address: str(co.address), phone: str(co.phone), tax_number: str(co.tax_number), ...(str(co.email) ? { email: str(co.email) } : {}), ...(str(co.registration) ? { registration: str(co.registration) } : {}) },
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
    payment_missing: r.payment_missing === true || r.status === 'payment_missing',
    status: str(r.status) ?? 'paid',
    void_reason: str(r.void_reason),
    footer: str(r.footer) ?? '',
    // Phase 2, additive: each only when sent.
    ...(r.till && typeof r.till === 'object' && str(obj(r.till).code) ? { till: { code: str(obj(r.till).code)!, name: str(obj(r.till).name) ?? '' } } : {}),
    ...(typeof r.tendered === 'number' ? { tendered: r.tendered } : {}),
    ...(Array.isArray(r.promotions) ? { promotions: list(r.promotions).map((p) => ({ label: str(p.label) ?? '', amount: num(p.amount) })).filter((p) => p.label && p.amount) } : {}),
    ...('loyalty' in r ? { loyalty: receiptLoyalty(r.loyalty) } : {}),
    ...('template' in r ? { template: receiptTemplateOf(r.template) } : {}),
  };
}

function receiptLoyalty(v: unknown): PosServerReceipt['loyalty'] {
  const l = loyaltyOf(v);
  return l ? { tier: l.tier ?? null, earned: l.earned, redeemed: l.redeemed, balance: l.balance ?? null } : null;
}

/** The door's refusal as an error the screens show: WorkSuite's sentence, with a code that says what it was. */
export function doorError(a: DeviceAnswer, fallback: string): DesktopError {
  const message = str(a.body?.message) ?? fallback;
  if (a.status === 401) return new DesktopError('PERMISSION_DENIED', 'WorkSuite no longer accepts this till. Pair this computer again.', 401);
  if (a.status === 503) return new DesktopError('SERVER_ERROR', str(a.body?.message) ?? POS_OFF, 503);
  if (a.status === 403) return new DesktopError('PERMISSION_DENIED', message, 403);
  if (a.status === 404) return new DesktopError('NOT_FOUND', message, 404);
  if (a.status === 409 || a.status === 422) return new DesktopError('CONFLICT', message, a.status);
  return new DesktopError('SERVER_ERROR', message, a.status);
}
