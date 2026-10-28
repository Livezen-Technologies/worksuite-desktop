import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.2.286', isPackaged: false } }));

import { PosLocalStore } from '../../../electron/services/pos-local/store';
import { PosLocalSales } from '../../../electron/services/pos-local/sales';
import type { PosLocalUser } from '@shared/pos-local';

/*
 * Selling with no server: a sale is written whole or not at all, the drawer adds up, and what a cashier may not do
 * is refused here rather than hidden on a screen.
 */
let dir: string;
let store: PosLocalStore;
let till: PosLocalSales;
let clock = Date.parse('2026-10-29T10:00:00Z');
let owner: PosLocalUser;
let cashier: PosLocalUser;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pos-sales-'));
  clock = Date.parse('2026-10-29T10:00:00Z');
  store = new PosLocalStore(join(dir, 'pos.sqlite'), () => clock);
  till = new PosLocalSales(store, () => clock);
  owner = store.addUser({ username: 'sunil', displayName: 'Sunil', password: 'till-of-the-day', role: 'owner' }, null);
  cashier = store.addUser({ username: 'nimal', displayName: 'Nimal', password: 'second-person', role: 'cashier' }, owner);
  till.setSettings({ code: 'T1', taxMode: 'inclusive', rounding: 1 }, owner);
  till.saveProduct({ sku: 'TEA', barcode: '500100', name: 'Tea 400g', price: 1150, taxRate: 15, stock: 10 }, owner);
  till.saveProduct({ sku: 'BAG', name: 'Carrier bag', price: 500, taxRate: 0, stock: null }, owner);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const tea = () => till.products('TEA')[0]!;

describe('selling offline', () => {
  it('will not sell before the register is open', () => {
    expect(() => till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'cash', amount: 1150 }] }, cashier)).toThrow(/Open the register/);
  });

  it('rings up a sale, numbers the receipt and gives change', () => {
    till.open(10_000, owner);
    const out = till.sell({ lines: [{ productId: tea().id, qty: 2 }], tenders: [{ kind: 'cash', amount: 5000 }] }, cashier);
    expect(out.ref).toBe('T1-20261029-0001');
    expect(out.totals.total).toBe(2300);
    expect(out.totals.tax).toBe(300);
    expect(out.change).toBe(2700);
    expect(till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'cash', amount: 1150 }] }, cashier).ref).toBe('T1-20261029-0002');
  });

  it('takes the stock down, and puts it back when the sale is voided', () => {
    till.open(0, owner);
    const sale = till.sell({ lines: [{ productId: tea().id, qty: 3 }], tenders: [{ kind: 'cash', amount: 3450 }] }, cashier);
    expect(tea().stock).toBe(7);
    till.void(sale.ref, owner);
    expect(tea().stock).toBe(10);
    expect(till.sale(sale.ref)?.voided).toBe(true);
  });

  it('leaves nothing behind when a sale cannot be written', () => {
    till.open(0, owner);
    expect(() => till.sell({ lines: [{ productId: 'gone', qty: 1 }], tenders: [{ kind: 'cash', amount: 100 }] }, cashier)).toThrow(/no longer on this till/);
    expect(till.summary().sales).toBe(0);
    /* The receipt number was not spent either: the next real sale is the first one. */
    expect(till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'cash', amount: 1150 }] }, cashier).ref).toBe('T1-20261029-0001');
  });

  it('refuses a sale that is not paid in full', () => {
    till.open(0, owner);
    expect(() => till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'card', amount: 1000 }] }, cashier)).toThrow(/not paid in full/);
  });

  it('refuses a cashier the discount, the void and the till’s settings', () => {
    till.open(0, owner);
    expect(() => till.sell({ lines: [{ productId: tea().id, qty: 1 }], saleDiscount: 100, tenders: [{ kind: 'cash', amount: 1050 }] }, cashier)).toThrow(/may not give a discount/);
    const sale = till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'cash', amount: 1150 }] }, cashier);
    expect(() => till.void(sale.ref, cashier)).toThrow(/may not void/);
    expect(() => till.setSettings({ rounding: 5 }, cashier)).toThrow(/Only an owner/);
    expect(() => till.saveProduct({ sku: 'X', name: 'X', price: 1 }, cashier)).toThrow(/does not change products/);
  });

  it('adds the drawer up: float, cash taken, change given, money in and out', () => {
    till.open(10_000, owner);
    till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'cash', amount: 2000 }] }, cashier); // 1150, change 850
    till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'card', amount: 1150 }] }, cashier); // no cash
    till.cashMove('in', 5_000, 'Float top-up', owner);
    till.cashMove('out', 2_000, 'Milk for the staff room', owner);
    const d = till.drawer();
    expect(d.cashSales).toBe(2000);
    expect(d.change).toBe(850);
    expect(d.expected).toBe(10_000 + 2000 + 5_000 - 2_000 - 850);
  });

  it('closes the register with what was counted, and says how far out it is', () => {
    till.open(10_000, owner);
    till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'cash', amount: 1150 }] }, cashier);
    const close = till.close(11_100, 'Short by a hundred', owner);
    expect(close.expected).toBe(11_150);
    expect(close.variance).toBe(-50);
    expect(till.openRegister()).toBeNull();
  });

  it('will not open a register twice, and a cashier may not pay money out', () => {
    till.open(0, owner);
    expect(() => till.open(0, owner)).toThrow(/already open/);
    expect(() => till.cashMove('out', 100, 'x', cashier)).toThrow(/may not pay money/);
  });

  it('sells something with no product on it, priced by hand', () => {
    till.open(0, owner);
    const out = till.sell({ lines: [{ productId: null, name: 'Repair', unitPrice: 2500, qty: 1, taxRate: 0 }], tenders: [{ kind: 'cash', amount: 2500 }] }, cashier);
    expect(out.totals.total).toBe(2500);
    expect(till.sale(out.ref)?.lines[0]?.name).toBe('Repair');
  });

  it('summarises the day the register has had', () => {
    till.open(10_000, owner);
    till.sell({ lines: [{ productId: tea().id, qty: 2 }], tenders: [{ kind: 'cash', amount: 2300 }] }, cashier);
    const two = till.sell({ lines: [{ productId: tea().id, qty: 1 }], tenders: [{ kind: 'card', amount: 1150 }] }, cashier);
    till.void(two.ref, owner);
    const s = till.summary();
    expect(s.sales).toBe(1);
    expect(s.voided).toBe(1);
    expect(s.total).toBe(2300);
    expect(s.byTender.find((t) => t.kind === 'cash')?.amount).toBe(2300);
    expect(s.byTender.find((t) => t.kind === 'card')).toBeUndefined();
  });

  it('finds a product by its barcode, exactly', () => {
    expect(till.byBarcode('500100')?.sku).toBe('TEA');
    expect(till.byBarcode('50010')).toBeNull();
  });

  it('refuses two products with the same code', () => {
    expect(() => till.saveProduct({ sku: 'TEA', name: 'Another tea', price: 100 }, owner)).toThrow(/already has that code/);
  });
});
