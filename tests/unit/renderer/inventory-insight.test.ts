import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

const { REPORTS, reportQuery, reportsFor, reportView } = await import('../../../src/modules/inventory/insight');
const { attributeValues, settingChanges, unitBody, warehouseBody } = await import('../../../src/modules/inventory/admin');

const def = (key: string) => REPORTS.find((r) => r.key === key)!;
const p = { warehouse: 4, days: '90', serialStatus: 'in_stock', only: 'untagged' };

describe('inventory insight: reports', () => {
  it('leaves the reports that are all money to those who see costs', () => {
    expect(reportsFor(false).map((r) => r.key)).not.toEqual(expect.arrayContaining(['valuation', 'aging', 'abc', 'profitability', 'vendor']));
    expect(reportsFor(false).map((r) => r.key)).toEqual(expect.arrayContaining(['balance', 'movement', 'dead', 'serials']));
    expect(reportsFor(true)).toHaveLength(REPORTS.length);
  });

  it('asks each report only what it reads, in its own spelling', () => {
    expect(reportQuery(def('balance'), p)).toEqual({ warehouse_id: 4 });
    expect(reportQuery(def('movement'), p)).toEqual({ warehouse_id: 4, days: '90' });
    expect(reportQuery(def('serials'), p)).toEqual({ warehouse: 4, status: 'in_stock' });
    expect(reportQuery(def('serial-labels'), p)).toEqual({ only: 'untagged' });
    expect(reportQuery(def('vendor'), p)).toEqual({});
    expect(reportQuery(def('balance'), { ...p, warehouse: null })).toEqual({});
  });

  it('reads a valuation: the figure, and the columns in order', () => {
    const v = reportView('valuation', { rows: [{ product_id: 1 }], total_value: 1250, basis: 'Layers.' }, 'LKR');
    expect(v.headline).toBe('LKR 1,250.00 on the shelf');
    expect(v.tables[0]!.cols.map((c) => c.key)).toEqual(['code', 'name', 'quantity', 'unit_cost', 'value']);
    expect(v.basis).toBe('Layers.');
  });

  it('says nothing of a total it was not given', () => {
    expect(reportView('balance', { rows: [], total_value: null }, 'LKR').headline).toBeNull();
    expect(reportView('dead', { rows: [], total_value: null, window_days: 180 }, 'LKR').headline).toBe('Not issued in 180 days');
  });

  it('turns the aging buckets and profitability totals into tiles', () => {
    const aging = reportView('aging', { buckets: { '0-30': { label: 'Up to 30 days', value: 100, quantity: 4 } }, products: [] }, null);
    expect(aging.tiles).toEqual([['Up to 30 days', '100.00 · 4 units']]);
    const profit = reportView('profitability', { from: '2026-01-01', to: '2026-09-27', rows: [], totals: { revenue: 1000, cost: 600, margin: 400, margin_pct: 40 }, excluded: { invoices: 2, revenue: 300, note: 'Excluded.' } }, 'LKR');
    expect(profit.tiles.map((t) => t[0])).toEqual(['Revenue', 'Cost of goods', 'Margin', 'Margin %']);
    expect(profit.tiles[3]![1]).toBe('40%');
    expect(profit.notes).toEqual(['2 invoices worth LKR 300.00: Excluded.']);
  });

  it('gives the movement report its two tables, and ABC its note when nothing moved', () => {
    expect(reportView('movement', { days: [], by_type: [], window_days: 90 }, null).tables.map((t) => t.title)).toEqual(['By day', 'By reason']);
    const abc = reportView('abc', { rows: [], note: 'Nothing has been issued.' }, null);
    expect(abc.tables).toEqual([]);
    expect(abc.notes).toEqual(['Nothing has been issued.']);
  });

  it('reads the serial register: its states as chips, and says when it is cut short', () => {
    const v = reportView('serials', { rows: [], total: 1500, capped: true, summary: [{ status: 'in_stock', count: 900 }, { status: 'weird', count: 3 }] }, null);
    expect(v.headline).toBe('1,500 units');
    expect(v.chips).toEqual([
      ['Available', 900],
      ['weird', 3],
    ]);
    expect(v.notes[0]).toMatch(/newest 1,000 of 1,500/);
  });
});

describe('inventory setup', () => {
  it('makes a base unit at a factor of one, and a derived one against its base', () => {
    expect(unitBody({ name: 'Piece', code: 'pc', kind: 'count', base: null, factor: '12', decimals: '' })).toEqual({ body: { name: 'Piece', code: 'pc', kind: 'count', decimals: 2 }, error: null });
    expect(unitBody({ name: 'Carton', code: 'ctn', kind: 'count', base: 3, factor: '12', decimals: '0' }).body).toEqual({ name: 'Carton', code: 'ctn', kind: 'count', decimals: 0, base_unit_id: 3, factor: 12 });
    expect(unitBody({ name: 'Carton', code: 'ctn', kind: 'count', base: 3, factor: '0', decimals: '0' }).error).toMatch(/how many of the base/);
    expect(unitBody({ name: '', code: 'x', kind: 'count', base: null, factor: '', decimals: '' }).error).toMatch(/name and a code/);
    expect(unitBody({ name: 'X', code: 'x', kind: 'count', base: null, factor: '', decimals: '9' }).error).toMatch(/0 to 6/);
  });

  it('reads attribute values one a line or by commas, once each', () => {
    expect(attributeValues('Small\nMedium, Large\n\nSmall')).toEqual(['Small', 'Medium', 'Large']);
  });

  it('saves only the rules that changed, and never a blank prefix', () => {
    const list = [
      { key: 'po_prefix', label: 'PO', note: null, type: 'string' as const, value: 'PO-' },
      { key: 'allow_self_approval', label: 'Self', note: null, type: 'bool' as const, value: false },
      { key: 'expiry_warning_days', label: 'Days', note: null, type: 'int' as const, value: 30 },
    ];
    expect(settingChanges(list, {})).toEqual({});
    expect(settingChanges(list, { po_prefix: 'PO-', allow_self_approval: true, expiry_warning_days: '45' as unknown as number })).toEqual({ allow_self_approval: true, expiry_warning_days: 45 });
    expect(settingChanges(list, { po_prefix: '  ' })).toEqual({});
  });

  it('asks a warehouse for a code and a name, and sends the code in capitals', () => {
    const d = { code: 'main', name: 'Main', kind: 'warehouse', street: '', city: 'Colombo', country: '', phone: '', isDefault: true, allowNegative: false };
    expect(warehouseBody(d).body).toMatchObject({ code: 'MAIN', name: 'Main', city: 'Colombo', street: null, is_default: true, allow_negative: false });
    expect(warehouseBody({ ...d, name: ' ' }).error).toMatch(/code and a name/);
  });
});

describe('inventory setup: a warehouse as the server sends it', () => {
  it('reads "0" as off, not as a switch that is on', async () => {
    const api = await import('../../../src/core/api');
    vi.mocked(api.apiGet).mockResolvedValueOnce({ warehouse: { id: '7', is_default: '0', allow_negative: '1' }, users: [], bins: [], top_stock: [] });
    const { fetchWarehouse } = await import('../../../src/modules/inventory/admin');
    const d = await fetchWarehouse(7);
    expect(d.warehouse).toMatchObject({ id: 7, is_default: false, allow_negative: true });
  });
});
