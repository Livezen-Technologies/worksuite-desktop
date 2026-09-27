import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { orderActions, orderBody, receiptBody, vendorChanges, vendorForm, PO_LABEL, poTone } = await import('../../../src/modules/inventory/buying');

const nut = { id: 7, code: 'EPN1', name: 'Nut' };
const line = (over: object = {}) => ({ id: 1, po_line_id: 3, product_id: 7, code: 'EPN1', product_name: 'Nut', unit: 'pcs', tracking: 'none', quantity: '10', rejected_qty: '0', reject_reason: null, unit_cost: '100', landed_cost: '100', batch_no: null, expiry_date: null, serials: null, bin: null, ...over });
const draft = (over: object = {}) => ({ accepted: '10', rejected: '', reason: '', batch: '', expiry: '', serials: '', ...over });

describe('inventory buying: orders', () => {
  it('offers what each state allows, by who may buy and who may approve', () => {
    const c = { purchase: true, approve: true };
    expect(orderActions({ status: 'draft' }, 0, c)).toMatchObject({ edit: true, approve: true, receive: false, cancel: true, remove: true });
    expect(orderActions({ status: 'approved' }, 0, c)).toMatchObject({ edit: false, approve: false, receive: true, cancel: true, remove: false });
    expect(orderActions({ status: 'acknowledged' }, 0, c).receive).toBe(true);
    // Once anything has arrived it cannot be cancelled.
    expect(orderActions({ status: 'partial' }, 5, c)).toMatchObject({ receive: true, cancel: false });
    expect(orderActions({ status: 'received' }, 10, c)).toMatchObject({ receive: false, cancel: false });
    expect(orderActions({ status: 'draft' }, 0, { purchase: true, approve: false }).approve).toBe(false);
  });

  it('leaves Approve off for whoever raised the order, and says someone else approves it', () => {
    // `mayApprove` is the server's answer; absent (an older server) changes nothing.
    expect(orderActions({ status: 'draft' }, 0, { purchase: true, approve: true, mayApprove: false })).toMatchObject({ approve: false, waiting: true, edit: true });
    expect(orderActions({ status: 'draft' }, 0, { purchase: true, approve: true, mayApprove: true })).toMatchObject({ approve: true, waiting: false });
    expect(orderActions({ status: 'draft' }, 0, { purchase: true, approve: true })).toMatchObject({ approve: true, waiting: false });
    expect(orderActions({ status: 'approved' }, 0, { purchase: true, approve: true, mayApprove: false }).waiting).toBe(false);
    expect(orderActions({ status: 'draft' }, 0, { purchase: true, approve: false, mayApprove: false }).waiting).toBe(false);
  });

  it('names the states the web names', () => {
    expect(PO_LABEL.acknowledged).toBe('Vendor accepted');
    expect(PO_LABEL.partial).toBe('Part received');
    expect(poTone('received')).toBe('green');
  });

  it('sends a blank cost as nothing, so the catalogue’s is used, never as free', () => {
    const d = { vendor: { id: 4, name: 'Bosch' }, warehouse: 2, expected: '', reference: '', freight: '200', insurance: '', duty: '', notes: '', lines: [{ key: 0, id: null, product: nut, qty: '10', cost: '' }] };
    const { body, error } = orderBody(d, true);
    expect(error).toBeNull();
    expect(body).toMatchObject({ vendor_id: 4, warehouse_id: 2, freight_cost: 200, insurance_cost: 0, duty_cost: 0 });
    expect((body.lines as Array<Record<string, unknown>>)[0]).toEqual({ id: undefined, product_id: 7, quantity: 10 });
  });

  it('never sends a cost from someone who may not see costs', () => {
    const d = { vendor: { id: 4, name: 'Bosch' }, warehouse: 2, expected: '', reference: '', freight: '', insurance: '', duty: '', notes: '', lines: [{ key: 0, id: 12, product: nut, qty: '3', cost: '999' }] };
    expect((orderBody(d, false).body.lines as Array<Record<string, unknown>>)[0]).toEqual({ id: 12, product_id: 7, quantity: 3 });
  });

  it('asks for a vendor, a warehouse and quantities', () => {
    const base = { vendor: null, warehouse: 2, expected: '', reference: '', freight: '', insurance: '', duty: '', notes: '', lines: [] };
    expect(orderBody(base, true).error).toBe('Choose the vendor.');
    expect(orderBody({ ...base, vendor: { id: 1, name: 'x' }, warehouse: null }, true).error).toBe('Choose where it is delivered.');
    expect(orderBody({ ...base, vendor: { id: 1, name: 'x' }, lines: [{ key: 0, id: null, product: nut, qty: '0', cost: '' }] }, true).error).toMatch(/quantity to order/);
    expect(orderBody({ ...base, vendor: { id: 1, name: 'x' }, freight: '-5' }, true).error).toMatch(/Freight must be a number/);
  });
});

describe('inventory buying: receipts', () => {
  const h = { invoice: ' INV-9 ', delivery: '', charges: '200', notes: '' };

  it('posts what was accepted and why the rest was turned away', () => {
    const { body, error } = receiptBody(h, [{ line: line() as never, d: draft({ accepted: '8', rejected: '2' }) }]);
    expect(error).toBeNull();
    expect(body).toMatchObject({ vendor_invoice_no: 'INV-9', other_charges: 200, lines: [{ id: 1, quantity: 8, rejected_qty: 2, reject_reason: 'other' }] });
  });

  it('names the batch and one serial per unit before posting', () => {
    expect(receiptBody(h, [{ line: line({ tracking: 'batch' }) as never, d: draft() }]).error).toMatch(/batch tracked — name the batch/);
    expect(receiptBody(h, [{ line: line({ tracking: 'serial' }) as never, d: draft({ accepted: '2', serials: 'A1' }) }]).error).toMatch(/give 2 serial numbers, one per unit \(1 given\)/);
    const ok = receiptBody(h, [{ line: line({ tracking: 'serial' }) as never, d: draft({ accepted: '2', serials: 'A1\nA2' }) }]);
    expect((ok.body.lines as Array<Record<string, unknown>>)[0]!.serials).toEqual(['A1', 'A2']);
  });
});

describe('inventory buying: vendors', () => {
  it('saves only what changed, so nothing comes back as it went out', () => {
    const before = vendorForm({ name: 'Bosch', bank_name: 'HNB', payment_terms_days: 30 } as never);
    const after = { ...before, phone: '011 400 2020' };
    expect(vendorChanges(before, after, true)).toEqual({ body: { phone: '011 400 2020' }, error: null });
  });

  it('never writes bank details or a credit limit from someone who may not see them', () => {
    const before = vendorForm({ name: 'Bosch' } as never);
    const after = { ...before, bank_name: 'Typed', credit_limit: '9', payment_terms_days: '45' };
    expect(vendorChanges(before, after, false).body).toEqual({ payment_terms_days: 45 });
  });

  it('asks for a name, and reads numbers as numbers', () => {
    expect(vendorChanges(vendorForm(null), { ...vendorForm(null), name: ' ' }, true).error).toBe('Give the vendor a name.');
    expect(vendorChanges(vendorForm(null), { ...vendorForm(null), name: 'X', lead_time_days: 'soon' }, true).error).toMatch(/lead time days must be a number/);
    expect(vendorChanges(vendorForm(null), { ...vendorForm(null), name: 'X', credit_limit: '2,000,000' }, true).body).toMatchObject({ name: 'X', credit_limit: 2000000 });
  });
});
