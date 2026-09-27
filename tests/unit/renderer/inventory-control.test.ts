import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { adjustmentActions, adjustmentBody, countedOf, docStatus, lineWorth, newLine, openingBody, serialList, tagsOf, transferActions, transferBody } = await import('../../../src/modules/inventory/control');

const product = (tracking: 'none' | 'batch' | 'serial', id = 7) => ({ id, code: 'BRK-PAD-F', barcode: null, name: 'Brake pads — front', variant_label: null, unit: 'set', tracking, is_stocked: 1, on_hand: '4.0000', reserved: '0' });

describe('inventory control: what may be done now', () => {
  const o = { needsApproval: true, canApprove: true, canAdjust: true, mine: false, manage: false };

  it('walks an adjustment draft → pending → approved → posted, with approval on', () => {
    expect(adjustmentActions({ status: 'draft', reverses_id: null }, o)).toMatchObject({ edit: true, submit: true, post: false, approve: false, remove: true });
    expect(adjustmentActions({ status: 'pending', reverses_id: null }, o)).toMatchObject({ approve: true, reject: true, post: false, edit: false });
    expect(adjustmentActions({ status: 'approved', reverses_id: null }, o)).toMatchObject({ post: true, approve: false });
    expect(adjustmentActions({ status: 'posted', reverses_id: null }, o)).toMatchObject({ reverse: true, remove: false, post: false });
    expect(adjustmentActions({ status: 'posted', reverses_id: '12' }, o).reverse).toBe(false);
    expect(adjustmentActions({ status: 'rejected', reverses_id: null }, o)).toMatchObject({ edit: true, submit: true });
  });

  it('posts a draft straight away when approval is off', () => {
    const off = { ...o, needsApproval: false };
    expect(adjustmentActions({ status: 'draft', reverses_id: null }, off)).toMatchObject({ post: true, submit: false });
  });

  it('never offers Approve to whoever raised it, unless they manage inventory', () => {
    expect(adjustmentActions({ status: 'pending', reverses_id: null }, { ...o, mine: true })).toMatchObject({ approve: false, reject: true, selfNote: true });
    expect(adjustmentActions({ status: 'pending', reverses_id: null }, { ...o, mine: true, manage: true }).approve).toBe(true);
  });

  it('walks a transfer approved → in transit → received, and ships a draft only with approval off', () => {
    const t = { needsApproval: true, canApprove: true, canTransfer: true };
    expect(transferActions({ status: 'draft' }, t)).toMatchObject({ approve: true, ship: false, cancel: true, remove: true });
    expect(transferActions({ status: 'approved' }, t)).toMatchObject({ ship: true, cancel: true, remove: false });
    expect(transferActions({ status: 'in_transit' }, t)).toMatchObject({ receive: true, cancel: false, ship: false });
    expect(transferActions({ status: 'received' }, t)).toMatchObject({ receive: false, cancel: false, remove: false });
    expect(transferActions({ status: 'draft' }, { ...t, needsApproval: false })).toMatchObject({ ship: true, approve: false });
    // A cancelled transfer never ships (the server now refuses it too).
    expect(transferActions({ status: 'cancelled' }, { ...t, needsApproval: false })).toMatchObject({ ship: false, remove: true });
  });

  it('never offers Approve on a transfer to whoever raised it, unless they manage inventory', () => {
    const t = { needsApproval: true, canApprove: true, canTransfer: true };
    expect(transferActions({ status: 'draft' }, { ...t, mine: true })).toMatchObject({ approve: false, selfNote: true });
    expect(transferActions({ status: 'draft' }, { ...t, mine: true, manage: true })).toMatchObject({ approve: true, selfNote: false });
    expect(transferActions({ status: 'draft' }, { ...t, mine: false })).toMatchObject({ approve: true, selfNote: false });
  });

  it('names every status the server writes', () => {
    expect(docStatus('in_transit').label).toBe('In transit');
    expect(docStatus('review').label).toBe('Review');
    expect(docStatus('something_new').label).toBe('something new');
  });
});

describe('inventory control: the forms', () => {
  it('reads serials one per line, or by commas, semicolons or tabs, each once', () => {
    expect(serialList('A1\nA2, A3;A4\tA4\n\n')).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('refuses an adjustment line without a quantity, and a batch or serial line without its names', () => {
    const h = { warehouse: 3, reason: 'damage', note: 'Dropped' };
    expect(adjustmentBody({ ...h, warehouse: null }, [newLine(0)]).error).toBe('Choose the warehouse.');
    expect(adjustmentBody(h, [newLine(0)]).error).toBe('Add at least one product.');
    expect(adjustmentBody(h, [{ ...newLine(0), product: product('none'), qty: '0' }]).error).toMatch(/negative writes stock off/);
    expect(adjustmentBody(h, [{ ...newLine(0), product: product('batch'), qty: '-2' }]).error).toMatch(/batch tracked — name the batch/);
    expect(adjustmentBody(h, [{ ...newLine(0), product: product('serial'), qty: '-2', serials: 'SN1' }]).error).toMatch(/give 2 serial numbers, one per unit \(1 given\)/);
  });

  it('builds the body the server expects, signed, with typed minus signs understood', () => {
    const { body, error } = adjustmentBody({ warehouse: 3, reason: 'damage', note: ' Dropped ' }, [
      { ...newLine(0), product: product('none'), qty: '−2', note: 'Lens cracked' },
      { ...newLine(1), product: product('batch', 8), qty: '5', batch: 'B-24-118', expiry: '2027-01-31' },
      { ...newLine(2), product: product('serial', 9), qty: '-2', serials: 'SN1\nSN2' },
    ]);
    expect(error).toBeNull();
    expect(body).toEqual({
      warehouse_id: 3,
      reason: 'damage',
      note: 'Dropped',
      lines: [
        { product_id: 7, quantity: -2, note: 'Lens cracked' },
        { product_id: 8, quantity: 5, note: null, batch_no: 'B-24-118', expiry_date: '2027-01-31' },
        { product_id: 9, quantity: -2, note: null, serials: ['SN1', 'SN2'] },
      ],
    });
  });

  it('keeps a transfer between two warehouses, of unserialised stock, naming batches', () => {
    const h = { from: 1, to: 2, date: '2026-09-27', expected: '', carrier: '', tracking: '', note: '' };
    expect(transferBody({ ...h, to: 1 }, []).error).toBe('A transfer needs two different warehouses.');
    expect(transferBody(h, [{ product: product('serial'), qty: '1', batchId: null }]).error).toMatch(/adjustment at each end/);
    expect(transferBody(h, [{ product: product('batch'), qty: '1', batchId: null }]).error).toMatch(/choose the batch/);
    expect(transferBody(h, [{ product: product('none'), qty: '5', batchId: null }]).body).toMatchObject({ from_warehouse_id: 1, to_warehouse_id: 2, transfer_date: '2026-09-27', lines: [{ product_id: 7, quantity: 5 }] });
  });

  it('reads an empty count as not counted, never as zero', () => {
    expect(countedOf('')).toEqual({ value: null, ok: true });
    expect(countedOf('0')).toEqual({ value: 0, ok: true });
    expect(countedOf('1,240')).toEqual({ value: 1240, ok: true });
    expect(countedOf('-1').ok).toBe(false);
    expect(countedOf('ten').ok).toBe(false);
  });

  it('values a line at its posted value, or before posting at quantity × cost', () => {
    expect(lineWorth({ quantity: '-2', unit_cost: '21800', value: '0' }, false)).toBe(-43600);
    expect(lineWorth({ quantity: '-2', unit_cost: '21800', value: '-41200' }, true)).toBe(-41200);
    expect(lineWorth({ quantity: '-2', unit_cost: null, value: null }, false)).toBeNull();
  });

  it('records opening stock once per line, a serial per unit', () => {
    const { body, error } = openingBody({ warehouse: 3, asAt: '2026-09-01' }, [{ product: product('serial'), qty: '2', cost: '21,640', batch: '', expiry: '', serials: 'X1\nX2' }]);
    expect(error).toBeNull();
    expect(body).toEqual({ warehouse_id: 3, as_at: '2026-09-01', lines: [{ product_id: 7, quantity: 2, unit_cost: 21640, serials: 'X1\nX2' }] });
    expect(openingBody({ warehouse: 3, asAt: '' }, [{ product: product('none'), qty: '0', cost: '', batch: '', expiry: '', serials: '' }]).error).toMatch(/quantity that was on the shelf/);
  });

  it('names the ways a unit is known', () => {
    expect(tagsOf({ barcode: '479', uid: 'ab', nfc_uid: null })).toBe('barcode · QR');
    expect(tagsOf({ barcode: null, uid: null, nfc_uid: null })).toBe('—');
  });
});
