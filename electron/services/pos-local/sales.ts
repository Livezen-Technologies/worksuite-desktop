import { randomUUID } from 'node:crypto';
import { expectedCash, receiptRef, settle, totalsOf, type CartLine, type DrawerCount, type LocalProduct, type PosLocalTaxMode, type SaleTotals, type Tender, type CashRounding } from '@shared/pos-local-sale';
import { may, type PosLocalUser } from '@shared/pos-local';
import { DesktopError } from '../../main/errors';
import type { PosLocalStore } from './store';

/**
 * Selling on the offline till (ENH-POS-01 §1, phase 2).
 *
 * A till is the system of record for its own sales, so each one is written in a single transaction with its lines,
 * its payments, the stock it moved and the drawer it went into: a crash between them would otherwise leave money
 * taken and nothing sold, or stock gone and no sale.
 *
 * Nothing is ever deleted. A mistake is voided, which leaves the sale and its receipt number where they are and
 * puts the stock back — what a shop can show an auditor, and what a sync to WorkSuite can replay later.
 */

export interface TillSettings {
  /** What the till is called in a receipt number: `T1`. */
  code: string;
  taxMode: PosLocalTaxMode;
  rounding: CashRounding;
  currency: string;
}

export const DEFAULT_SETTINGS: TillSettings = { code: 'T1', taxMode: 'inclusive', rounding: 1, currency: 'LKR' };

export interface SaleInput {
  lines: Array<{ productId: string | null; name?: string; unitPrice?: number; qty: number; taxRate?: number; discount?: number }>;
  tenders: Tender[];
  saleDiscount?: number;
  customer?: string | null;
}

export interface RecordedSale {
  ref: string;
  totals: SaleTotals;
  change: number;
  soldAt: string;
}

export interface OpenRegister {
  id: string;
  openedAt: string;
  openedBy: string;
  float: number;
}

interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  price: number;
  tax_rate: number;
  stock: number | null;
  active: number;
}

const product = (r: ProductRow): LocalProduct => ({ id: r.id, sku: r.sku, barcode: r.barcode, name: r.name, price: r.price, taxRate: r.tax_rate, stock: r.stock, active: !!r.active });

export class PosLocalSales {
  constructor(private readonly store: PosLocalStore, private readonly now: () => number = Date.now) {}

  private get db() {
    return this.store.db.raw;
  }

  settings(): TillSettings {
    const raw = this.store.setting('till');
    if (!raw) return DEFAULT_SETTINGS;
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<TillSettings>) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  setSettings(patch: Partial<TillSettings>, by: PosLocalUser): TillSettings {
    if (!may(by.role, 'manage_settings')) throw new DesktopError('PERMISSION_DENIED', 'Only an owner changes the till’s settings.');
    const next = { ...this.settings(), ...patch };
    this.store.setSetting('till', JSON.stringify(next));
    return next;
  }

  /* ── Products ──────────────────────────────────────────────────────── */

  products(search = ''): LocalProduct[] {
    const q = search.trim();
    const rows = q
      ? (this.db.prepare('SELECT * FROM pos_local_products WHERE active = 1 AND (name LIKE ? OR sku = ? OR barcode = ?) ORDER BY name LIMIT 200').all(`%${q}%`, q, q) as unknown as ProductRow[])
      : (this.db.prepare('SELECT * FROM pos_local_products WHERE active = 1 ORDER BY name LIMIT 200').all() as unknown as ProductRow[]);
    return rows.map(product);
  }

  /** The one product a scanned barcode is, or null — the barcode is exact, never a guess. */
  byBarcode(code: string): LocalProduct | null {
    const r = this.db.prepare('SELECT * FROM pos_local_products WHERE barcode = ? AND active = 1').get(code.trim()) as unknown as ProductRow | undefined;
    return r ? product(r) : null;
  }

  saveProduct(input: { id?: string; sku: string; barcode?: string | null; name: string; price: number; taxRate?: number; stock?: number | null; active?: boolean }, by: PosLocalUser): LocalProduct {
    if (!may(by.role, 'manage_products')) throw new DesktopError('PERMISSION_DENIED', 'A cashier does not change products.');
    if (!input.sku.trim()) throw new DesktopError('CONFLICT', 'Give the product a code.');
    if (!input.name.trim()) throw new DesktopError('CONFLICT', 'Give the product a name.');
    if (!Number.isInteger(input.price) || input.price < 0) throw new DesktopError('CONFLICT', 'A price is whole cents, and not negative.');
    const id = input.id ?? `posp_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const at = new Date(this.now()).toISOString();
    const clash = this.db.prepare('SELECT id FROM pos_local_products WHERE (sku = ? OR (barcode IS NOT NULL AND barcode = ?)) AND id <> ?').get(input.sku.trim(), input.barcode ?? '\u0000', id) as unknown as { id: string } | undefined;
    if (clash) throw new DesktopError('CONFLICT', 'Another product already has that code or barcode.');
    this.db
      .prepare(
        `INSERT INTO pos_local_products (id, sku, barcode, name, price, tax_rate, stock, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, barcode = excluded.barcode, name = excluded.name, price = excluded.price,
           tax_rate = excluded.tax_rate, stock = excluded.stock, active = excluded.active, updated_at = excluded.updated_at`,
      )
      .run(id, input.sku.trim(), input.barcode?.trim() || null, input.name.trim(), input.price, input.taxRate ?? 0, input.stock ?? null, input.active === false ? 0 : 1, at);
    return product(this.db.prepare('SELECT * FROM pos_local_products WHERE id = ?').get(id) as unknown as ProductRow);
  }

  /* ── The drawer ────────────────────────────────────────────────────── */

  openRegister(): OpenRegister | null {
    const r = this.db.prepare('SELECT id, opened_at, opened_by, float_amount FROM pos_local_registers WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1').get() as unknown as
      | { id: string; opened_at: string; opened_by: string; float_amount: number }
      | undefined;
    return r ? { id: r.id, openedAt: r.opened_at, openedBy: r.opened_by, float: r.float_amount } : null;
  }

  open(float: number, by: PosLocalUser): OpenRegister {
    if (!may(by.role, 'open_register')) throw new DesktopError('PERMISSION_DENIED', 'You may not open the register.');
    if (this.openRegister()) throw new DesktopError('CONFLICT', 'The register is already open.');
    if (!Number.isInteger(float) || float < 0) throw new DesktopError('CONFLICT', 'A float is whole cents, and not negative.');
    const id = `posr_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const at = new Date(this.now()).toISOString();
    this.db.prepare('INSERT INTO pos_local_registers (id, opened_at, opened_by, float_amount) VALUES (?, ?, ?, ?)').run(id, at, by.id, float);
    return { id, openedAt: at, openedBy: by.id, float };
  }

  /** What the drawer should hold, from everything that went through this register. */
  drawer(registerId?: string): DrawerCount & { expected: number; registerId: string | null } {
    const reg = registerId ?? this.openRegister()?.id ?? null;
    if (!reg) return { float: 0, cashSales: 0, cashRefunds: 0, paidIn: 0, paidOut: 0, change: 0, expected: 0, registerId: null };
    const row = this.db.prepare('SELECT float_amount FROM pos_local_registers WHERE id = ?').get(reg) as unknown as { float_amount: number } | undefined;
    const cash = this.db
      .prepare("SELECT COALESCE(SUM(p.amount), 0) AS n FROM pos_local_payments p JOIN pos_local_sales s ON s.ref = p.ref WHERE s.register_id = ? AND p.kind = 'cash' AND s.voided_at IS NULL")
      .get(reg) as unknown as { n: number };
    const change = this.db.prepare('SELECT COALESCE(SUM(change_given), 0) AS n FROM pos_local_sales WHERE register_id = ? AND voided_at IS NULL').get(reg) as unknown as { n: number };
    const moves = this.db.prepare('SELECT direction, COALESCE(SUM(amount), 0) AS n FROM pos_local_cash_moves WHERE register_id = ? GROUP BY direction').all(reg) as unknown as Array<{ direction: string; n: number }>;
    const count: DrawerCount = {
      float: Number(row?.float_amount ?? 0),
      cashSales: Number(cash.n),
      cashRefunds: 0,
      paidIn: Number(moves.find((m) => m.direction === 'in')?.n ?? 0),
      paidOut: Number(moves.find((m) => m.direction === 'out')?.n ?? 0),
      change: Number(change.n),
    };
    return { ...count, expected: expectedCash(count), registerId: reg };
  }

  cashMove(direction: 'in' | 'out', amount: number, reason: string, by: PosLocalUser): void {
    if (!may(by.role, 'cash_move')) throw new DesktopError('PERMISSION_DENIED', 'You may not pay money in or out.');
    const reg = this.openRegister();
    if (!reg) throw new DesktopError('CONFLICT', 'Open the register first.');
    if (!Number.isInteger(amount) || amount <= 0) throw new DesktopError('CONFLICT', 'Enter an amount.');
    this.db.prepare('INSERT INTO pos_local_cash_moves (register_id, at, by_user, direction, amount, reason) VALUES (?, ?, ?, ?, ?, ?)').run(reg.id, new Date(this.now()).toISOString(), by.id, direction, amount, reason.slice(0, 200));
  }

  close(counted: number, note: string, by: PosLocalUser): { expected: number; counted: number; variance: number } {
    if (!may(by.role, 'close_register')) throw new DesktopError('PERMISSION_DENIED', 'You may not close the register.');
    const reg = this.openRegister();
    if (!reg) throw new DesktopError('CONFLICT', 'The register is not open.');
    const { expected } = this.drawer(reg.id);
    this.db.prepare('UPDATE pos_local_registers SET closed_at = ?, closed_by = ?, counted = ?, expected = ?, note = ? WHERE id = ?').run(new Date(this.now()).toISOString(), by.id, counted, expected, note.slice(0, 200), reg.id);
    return { expected, counted, variance: counted - expected };
  }

  /* ── Selling ───────────────────────────────────────────────────────── */

  /** The next receipt number for today, which starts again at 1 each day. */
  private nextRef(day: string, code: string): string {
    const row = this.db.prepare('SELECT seq FROM pos_local_counters WHERE day = ?').get(day) as unknown as { seq: number } | undefined;
    const seq = Number(row?.seq ?? 0) + 1;
    this.db.prepare('INSERT INTO pos_local_counters (day, seq) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET seq = excluded.seq').run(day, seq);
    return receiptRef(code, day, seq);
  }

  /**
   * Ring up a sale. Everything — the sale, its lines, its payments, the stock and the receipt number — happens in
   * one transaction, so a till that loses power mid-sale either sold it or did not.
   */
  sell(input: SaleInput, by: PosLocalUser): RecordedSale {
    if (!may(by.role, 'sell')) throw new DesktopError('PERMISSION_DENIED', 'You may not sell on this till.');
    const reg = this.openRegister();
    if (!reg) throw new DesktopError('CONFLICT', 'Open the register before selling.');
    if (!input.lines.length) throw new DesktopError('CONFLICT', 'There is nothing in the sale.');
    if (input.saleDiscount && !may(by.role, 'discount')) throw new DesktopError('PERMISSION_DENIED', 'You may not give a discount.');

    const settings = this.settings();
    const lines: CartLine[] = input.lines.map((l) => {
      if (l.productId) {
        const p = this.db.prepare('SELECT * FROM pos_local_products WHERE id = ?').get(l.productId) as unknown as ProductRow | undefined;
        if (!p) throw new DesktopError('NOT_FOUND', 'One of the products is no longer on this till.');
        return { productId: p.id, name: p.name, unitPrice: p.price, qty: l.qty, taxRate: p.tax_rate, discount: l.discount ?? 0 };
      }
      /* An open line: something without a product, priced by hand. */
      if (!l.name || l.unitPrice === undefined) throw new DesktopError('CONFLICT', 'An open line needs a name and a price.');
      return { productId: '', name: l.name, unitPrice: l.unitPrice, qty: l.qty, taxRate: l.taxRate ?? 0, discount: l.discount ?? 0 };
    });
    if (lines.some((l) => l.qty <= 0)) throw new DesktopError('CONFLICT', 'A line needs a quantity.');

    const totals = totalsOf(lines, { mode: settings.taxMode, saleDiscount: input.saleDiscount, rounding: settings.rounding });
    const { due, change } = settle(totals.total, input.tenders);
    if (due > 0) throw new DesktopError('CONFLICT', 'The sale is not paid in full.');

    const soldAt = new Date(this.now());
    const day = soldAt.toISOString().slice(0, 10);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const ref = this.nextRef(day, settings.code);
      this.db
        .prepare(
          `INSERT INTO pos_local_sales (ref, register_id, sold_at, sold_by, sold_by_name, customer, gross, discount, net, tax, rounding, total, change_given)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ref, reg.id, soldAt.toISOString(), by.id, by.displayName, input.customer ?? null, totals.gross, totals.discount, totals.net, totals.tax, totals.rounding, totals.total, change);
      for (const l of lines) {
        this.db.prepare('INSERT INTO pos_local_sale_lines (ref, product_id, name, unit_price, qty, tax_rate, discount) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ref, l.productId || null, l.name, l.unitPrice, l.qty, l.taxRate, l.discount);
        if (l.productId) this.db.prepare('UPDATE pos_local_products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL').run(l.qty, l.productId);
      }
      for (const t of input.tenders) this.db.prepare('INSERT INTO pos_local_payments (ref, kind, amount, reference) VALUES (?, ?, ?, ?)').run(ref, t.kind, t.amount, t.reference ?? null);
      this.db.exec('COMMIT');
      return { ref, totals, change, soldAt: soldAt.toISOString() };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Void a sale: it stays, with its number, and the stock goes back. Only a manager or owner may. */
  void(ref: string, by: PosLocalUser): void {
    if (!may(by.role, 'void_sale')) throw new DesktopError('PERMISSION_DENIED', 'You may not void a sale.');
    const sale = this.db.prepare('SELECT ref, voided_at FROM pos_local_sales WHERE ref = ?').get(ref) as unknown as { ref: string; voided_at: string | null } | undefined;
    if (!sale) throw new DesktopError('NOT_FOUND', 'That receipt is not on this till.');
    if (sale.voided_at) throw new DesktopError('CONFLICT', 'That sale is already void.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE pos_local_sales SET voided_at = ?, voided_by = ? WHERE ref = ?').run(new Date(this.now()).toISOString(), by.id, ref);
      for (const l of this.db.prepare('SELECT product_id, qty FROM pos_local_sale_lines WHERE ref = ? AND product_id IS NOT NULL').all(ref) as unknown as Array<{ product_id: string; qty: number }>)
        this.db.prepare('UPDATE pos_local_products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').run(l.qty, l.product_id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** One receipt, with everything on it. */
  sale(ref: string): (RecordedSale & { lines: CartLine[]; tenders: Tender[]; voided: boolean; soldByName: string }) | null {
    const s = this.db.prepare('SELECT * FROM pos_local_sales WHERE ref = ?').get(ref) as unknown as Record<string, unknown> | undefined;
    if (!s) return null;
    const lines = (this.db.prepare('SELECT product_id, name, unit_price, qty, tax_rate, discount FROM pos_local_sale_lines WHERE ref = ? ORDER BY id').all(ref) as unknown as Array<Record<string, unknown>>).map((l) => ({
      productId: String(l.product_id ?? ''),
      name: String(l.name),
      unitPrice: Number(l.unit_price),
      qty: Number(l.qty),
      taxRate: Number(l.tax_rate),
      discount: Number(l.discount),
    }));
    const tenders = (this.db.prepare('SELECT kind, amount, reference FROM pos_local_payments WHERE ref = ? ORDER BY id').all(ref) as unknown as Array<Record<string, unknown>>).map((t) => ({
      kind: String(t.kind) as Tender['kind'],
      amount: Number(t.amount),
      reference: (t.reference as string | null) ?? null,
    }));
    const totals = totalsOf(lines, { mode: this.settings().taxMode });
    return {
      ref,
      soldAt: String(s.sold_at),
      soldByName: String(s.sold_by_name),
      change: Number(s.change_given),
      voided: !!s.voided_at,
      lines,
      tenders,
      totals: { ...totals, gross: Number(s.gross), discount: Number(s.discount), net: Number(s.net), tax: Number(s.tax), rounding: Number(s.rounding), total: Number(s.total) },
    };
  }

  /** The day's figures for the register that is open (or one named): what the X and Z reports are built from. */
  summary(registerId?: string): { sales: number; voided: number; gross: number; net: number; tax: number; total: number; byTender: Array<{ kind: string; amount: number }>; drawer: ReturnType<PosLocalSales['drawer']> } {
    const reg = registerId ?? this.openRegister()?.id;
    const where = reg ? 'WHERE register_id = ?' : 'WHERE 1 = 0';
    const args = reg ? [reg] : [];
    const totals = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(net),0) AS net, COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(total),0) AS total FROM pos_local_sales ${where} AND voided_at IS NULL`).get(...args) as unknown as Record<string, number>;
    const voided = this.db.prepare(`SELECT COUNT(*) AS n FROM pos_local_sales ${where} AND voided_at IS NOT NULL`).get(...args) as unknown as { n: number };
    const byTender = this.db
      .prepare(`SELECT p.kind, COALESCE(SUM(p.amount),0) AS amount FROM pos_local_payments p JOIN pos_local_sales s ON s.ref = p.ref ${where.replace('register_id', 's.register_id')} AND s.voided_at IS NULL GROUP BY p.kind`)
      .all(...args) as unknown as Array<{ kind: string; amount: number }>;
    return {
      sales: Number(totals.n),
      voided: Number(voided.n),
      gross: Number(totals.gross),
      net: Number(totals.net),
      tax: Number(totals.tax),
      total: Number(totals.total),
      byTender: byTender.map((t) => ({ kind: String(t.kind), amount: Number(t.amount) })),
      drawer: this.drawer(reg),
    };
  }
}
