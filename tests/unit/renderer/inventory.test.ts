import { describe, expect, it, vi } from 'vitest';
import { resolveWebLink } from '../../../shared/links';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { attention, bodyOf, can, cost, currencyOf, draftOf, hitProduct, isDay, moveWhat, num, parentsFor, qty, short, signed, stampFull, stampWords, treeOf, withOrg } = await import('../../../src/modules/inventory/api');
const { dayWords } = await import('../../../src/core/time');

describe('inventory: who may do what', () => {
  it('follows the server’s slugs, with inventory.manage standing in for all but viewing', () => {
    expect(can(['inventory.view'], 'inventory.view')).toBe(true);
    expect(can(['inventory.view'], 'inventory.catalogue')).toBe(false);
    expect(can(['inventory.manage'], 'inventory.catalogue')).toBe(true);
    expect(can(['inventory.manage'], 'inventory.cost')).toBe(true);
    expect(can(['inventory.manage'], 'inventory.view')).toBe(false);
    expect(can(['*'], 'inventory.settings')).toBe(true);
    expect(can(undefined, 'inventory.view')).toBe(false);
    expect(can(['inventory.manage'], 'billing.view')).toBe(false);
  });

  it('names the company on a read only when one is chosen', () => {
    expect(withOrg('', { q: 'x' })).toEqual({ q: 'x' });
    expect(withOrg('3', { q: 'x' })).toEqual({ org_id: '3', q: 'x' });
  });
});

describe('inventory: numbers as the server sends them', () => {
  it('reads DECIMAL strings, and keeps null apart from zero', () => {
    expect(num('950.0000')).toBe(950);
    expect(num(null)).toBeNull();
    expect(num('')).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num(0)).toBe(0);
  });

  it('draws a count as a count and a measure to four places', () => {
    expect(qty('2.0000')).toBe('2');
    expect(qty('0.0025', 'kg')).toBe('0.0025 kg');
    expect(qty(null)).toBe('—');
    expect(signed(40)).toBe('+40');
    expect(signed('-6.0000')).toBe('−6');
    expect(signed(0)).toBe('0');
  });

  it('draws a masked cost as a dash, never as 0.00', () => {
    expect(cost(null, 'LKR')).toBe('—');
    expect(cost(0, 'LKR')).toBe('LKR 0.00');
    expect(short(18_400_000, 'LKR')).toBe('LKR 18.4M');
    expect(short(318_450, 'LKR')).toBe('LKR 318k');
    expect(short(null)).toBe('—');
  });

  it('prices in the chosen company’s currency, or the one they all share', () => {
    const cos = [
      { id: 1, name: 'A', currency: 'LKR' },
      { id: 2, name: 'B', currency: 'LKR' },
    ];
    expect(currencyOf(cos, '')).toBe('LKR');
    expect(currencyOf([...cos, { id: 3, name: 'C', currency: 'USD' }], '')).toBeNull();
    expect(currencyOf([...cos, { id: 3, name: 'C', currency: 'USD' }], '3')).toBe('USD');
  });
});

const cat = (id: number, name: string, parent: number | null, path: string, products: number, sort = 0) => ({
  id,
  name,
  code: null,
  parent_id: parent,
  path,
  depth: path.split('/').length - 2,
  sort_order: sort,
  status: 'active',
  product_count: products,
});

describe('inventory: the category tree', () => {
  const flat = [
    cat(4, 'Garage parts', null, '/', 2),
    cat(1, 'CCTV', null, '/', 1),
    cat(2, 'Cameras', 1, '/1/', 52),
    cat(3, 'Recorders', 1, '/1/', 21),
    cat(5, 'Brakes', 4, '/4/', 38, 1),
    cat(6, 'Filters & oils', 4, '/4/', 46, 0),
    cat(7, 'Front', 5, '/4/5/', 3),
  ];

  it('reads parent then children by their own order, each counting everything beneath it', () => {
    const t = treeOf(flat);
    expect(t.map((n) => `${'-'.repeat(n.level)}${n.name}:${n.total}`)).toEqual(['CCTV:74', '-Cameras:52', '-Recorders:21', 'Garage parts:89', '-Filters & oils:46', '-Brakes:41', '--Front:3']);
  });

  it('shows a category whose parent is not listed at the top rather than losing it', () => {
    const t = treeOf([cat(9, 'Orphan', 99, '/99/', 5)]);
    expect(t).toHaveLength(1);
    expect(t[0]!.level).toBe(0);
  });

  it('never offers a category itself, or anything beneath it, as its new parent', () => {
    const t = treeOf(flat);
    expect(parentsFor(t, 4).map((n) => n.name)).toEqual(['CCTV', 'Cameras', 'Recorders']);
    expect(parentsFor(t, 5).map((n) => n.name)).not.toContain('Front');
    expect(parentsFor(t, 5).map((n) => n.name)).toContain('Filters & oils');
  });
});

describe('inventory: the product form', () => {
  it('asks for a name, and refuses what is not a number', () => {
    expect(bodyOf({ ...draftOf(null), name: ' ' }, true).error).toBe('Give the product a name.');
    expect(bodyOf({ ...draftOf(null), name: 'Pads', unit_price: 'ten' }, true).error).toBe('The selling price must be a number, zero or more.');
    expect(bodyOf({ ...draftOf(null), name: 'Pads', reorder_point: '-1' }, true).error).toBe('The reorder point must be a number, zero or more.');
  });

  it('sends typed amounts as numbers and blanks as not set', () => {
    const { body, error } = bodyOf({ ...draftOf(null), name: 'Brake pads — rear', unit_price: '10,900', cost_price: '6800', tax_rate: '18', reorder_point: '' }, true);
    expect(error).toBeNull();
    expect(body).toMatchObject({ name: 'Brake pads — rear', unit_price: 10900, cost_price: 6800, tax_rate: 18, reorder_point: null, code: null, tracking: 'none', costing_method: 'fifo', is_stocked: 1 });
  });

  it('leaves the cost price out for someone who may not see it', () => {
    const { body } = bodyOf({ ...draftOf(null), name: 'Pads', cost_price: '' }, false);
    expect('cost_price' in body).toBe(false);
  });

  it('fills the form from a product the server sent with strings for numbers', () => {
    const d = draftOf({ name: 'Bolt', unit_price: '12.50', cost_price: null, reorder_point: '10.0000', tracking: 'batch', costing_method: 'average', is_stocked: true } as never);
    expect(d).toMatchObject({ name: 'Bolt', unit_price: '12.5', cost_price: '', reorder_point: '10', tracking: 'batch', costing_method: 'average' });
  });
});

describe('inventory: words for what happened', () => {
  it('names a movement by its type and reference, and an adjustment by its reason', () => {
    expect(moveWhat({ ref_type: 'purchase', ref_no: 'GRN-00188' })).toBe('Received · GRN-00188');
    expect(moveWhat({ ref_type: 'adjustment', ref_no: 'ADJ-00031', reason: 'damage' })).toBe('Adjusted · ADJ-00031 · Damage');
    expect(moveWhat({ ref_type: 'delivery', ref_no: 'DN-00412', serial_no: '4K02-00931' })).toBe('Delivered · DN-00412 · SN 4K02-00931');
    expect(moveWhat({ ref_type: 'return_in', ref_no: 'SRN-0021' })).toBe('Returned in · SRN-0021');
  });

  it('lists what is waiting, worded, with the stock ones first', () => {
    const d = {
      totals: { stocked_products: 0, units: 0, reserved: 0, incoming: 0, value: null, out_of_stock: 2, low_stock: 1, expiring_batches: 3 },
      pending: { purchase_orders: 1, sales_orders: 4, adjustments: 2, transfers: 0, counts: 1, assemblies: 0 },
    } as never;
    expect(attention(d).map((a) => a.label)).toEqual(['2 products out of stock', '1 product at or below minimum', '3 batches expiring', '2 adjustments awaiting approval', '1 count open', '1 order awaiting delivery', '4 sales orders to ship']);
    expect(attention(undefined)).toEqual([]);
  });

  it('opens a product, or a serial’s product, from the search', () => {
    expect(hitProduct({ type: 'product', id: 7, code: 'X', label: 'X' })).toBe(7);
    expect(hitProduct({ type: 'serial', id: 91, product_id: 7, code: 'SN1', label: 'X' })).toBe(7);
    expect(hitProduct({ type: 'transfer', id: 3, code: 'TR-1', label: 'Transfer · draft' })).toBeNull();
  });
});

describe('inventory: when', () => {
  it('reads a stamp at exactly midnight as the day the server stored, not as an hour', () => {
    expect(isDay('2026-09-20 00:00:00')).toBe(true);
    expect(isDay('2026-09-20T00:00:00Z')).toBe(true);
    expect(isDay('2026-09-20 10:12:00')).toBe(false);
    expect(isDay(null)).toBe(false);
    // Opening stock "as at" a day: shown as that day, whatever the reader's zone.
    expect(stampFull('2026-09-20 00:00:00')).toBe(dayWords('2026-09-20'));
    expect(stampWords('2026-09-20 00:00:00')).toBe(dayWords('2026-09-20'));
    expect(stampFull('2026-09-20 10:12:00')).toMatch(/\d/);
    expect(stampFull('2026-09-20 10:12:00')).not.toBe(dayWords('2026-09-20'));
  });
});

describe('inventory: the server’s links open here', () => {
  it('opens a product from a notification or the web in the Inventory module', () => {
    expect(resolveWebLink('/inventory?product=42')).toEqual({ kind: 'tab', route: '/inventory?product=42', app: 'inventory' });
    expect(resolveWebLink('/inventory/products/42')).toEqual({ kind: 'tab', route: '/inventory/products/42', app: 'inventory' });
  });
});
