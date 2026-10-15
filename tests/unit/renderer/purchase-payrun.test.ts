import { describe, expect, it, vi } from 'vitest';
import { purchaseExportName, purchaseExportPath, purchaseExportSchema } from '@shared/purchase';
import { contract } from '@shared/ipc/contract';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { runActions, runExportRequest } = await import('../../../src/modules/purchase/payrun');
const { runOf, qcItemOf, agreementOf, queueItemOf, reportTable } = await import('../../../src/modules/purchase/api');

/**
 * SRS-PUR-001 G-20, G-27: payment runs — proposal → approval by somebody else → the bank file (CSV, or ISO 20022
 * pain.001 XML) saved on this computer → paid — and report exports, through the download manager, from addresses the
 * main process builds.
 */
const run = (over: Record<string, unknown> = {}) => ({ id: 14, reference: 'PRUN-0014', status: 'approved', mine: false, ...over });
const can = { pay: true, approve: true, offline: false };

describe('payment runs', () => {
  it('is approved by somebody other than whoever proposed it', () => {
    expect(runActions(run({ status: 'proposed' }), can)).toEqual({ approve: true, export: false, markPaid: false, note: null });
    expect(runActions(run({ status: 'proposed', mine: true }), can)).toEqual({ approve: false, export: false, markPaid: false, note: 'You proposed this run, so someone else approves it.' });
    expect(runActions(run({ status: 'proposed' }), { ...can, approve: false }).note).toBe('Waiting on approval.');
    // The server's own answer (`can_approve` on a `draft` run) decides where it is sent.
    expect(runActions(run({ status: 'draft', can_approve: true, mine: undefined }), can)).toMatchObject({ approve: true, note: null });
    expect(runActions(run({ status: 'draft', can_approve: false, mine: undefined }), can)).toMatchObject({ approve: false, note: 'You proposed this run, so someone else approves it.' });
  });

  it('makes the bank file and is marked paid only once approved, by whoever may pay', () => {
    expect(runActions(run(), can)).toMatchObject({ approve: false, export: true, markPaid: true });
    expect(runActions(run({ status: 'exported' }), can)).toMatchObject({ export: true, markPaid: true });
    expect(runActions(run(), { ...can, pay: false })).toMatchObject({ export: false, markPaid: false });
    expect(runActions(run({ status: 'paid' }), can)).toMatchObject({ approve: false, export: false, markPaid: false });
    expect(runActions(run(), { ...can, offline: true })).toEqual({ approve: false, export: false, markPaid: false, note: 'This waits for the connection.' });
  });

  it('exports the bank file as CSV or pain.001 XML, never before approval', () => {
    expect(runExportRequest(run({ status: 'proposed' }), 'csv')).toBeNull();
    const csv = runExportRequest(run(), 'csv')!;
    expect(csv).toEqual({ purchaseExport: { what: 'payment-run', run: 14, format: 'csv' }, name: 'payment-run-PRUN-0014.csv' });
    const xml = runExportRequest(run({ status: 'exported' }), 'pain001')!;
    expect(xml.name).toBe('payment-run-PRUN-0014.xml');
    expect(purchaseExportPath(csv.purchaseExport)).toBe('/api/purchase/payment-runs/14/export?format=csv');
    expect(purchaseExportPath(xml.purchaseExport)).toBe('/api/purchase/payment-runs/14/export?format=pain001');
  });

  it('is a download the IPC contract accepts — and nothing the page could point elsewhere', () => {
    const dl = contract['transfers:download'].input;
    expect(dl.safeParse(runExportRequest(run(), 'pain001')).success).toBe(true);
    expect(dl.safeParse({ purchaseExport: { what: 'payment-run', run: 14, format: 'mt940' }, name: 'x.txt' }).success).toBe(false);
    expect(dl.safeParse({ purchaseExport: { what: 'payment-run', run: '14/../../users', format: 'csv' }, name: 'x.csv' }).success).toBe(false);
    // One thing per download.
    expect(dl.safeParse({ ...runExportRequest(run(), 'csv'), fileId: '9' }).success).toBe(false);
  });
});

describe('report exports', () => {
  it('builds the report’s export address with its period and company', () => {
    const x = purchaseExportSchema.parse({ what: 'report', report: 'spend-department', format: 'xlsx', from: '2026-01-01', to: '2026-10-15', org: '2' });
    expect(purchaseExportPath(x)).toBe('/api/purchase/reports/spend-department/export?format=xlsx&from=2026-01-01&to=2026-10-15&org_id=2');
    expect(purchaseExportName(x, 'spend-department', '2026-10-15')).toBe('purchasing-spend-department-2026-10-15.xlsx');
    for (const key of ['spend-project', 'cycle-time', 'rfq-savings', 'maverick']) expect(purchaseExportSchema.safeParse({ what: 'report', report: key, format: 'pdf' }).success).toBe(true);
    // Only the reports the server exports.
    expect(purchaseExportSchema.safeParse({ what: 'report', report: 'department-spend', format: 'csv' }).success).toBe(false);
    expect(purchaseExportSchema.safeParse({ what: 'report', report: 'spend', format: 'csv' }).success).toBe(false);
  });
});

describe('the server’s shapes', () => {

  it('reads a payment run and its bills as `GET payment-runs/{id}` sends them', () => {
    const r = runOf(
      { id: 3, reference: 'PRUN-3', status: 'draft', pay_date: '2026-10-20', currency: 'LKR', total: 1000, bill_count: 1, created_by: 'Ruwan S.', approved_by: null, can_approve: false, filters: { due_by: '2026-10-31' } },
      [{ id: 9, bill_id: 4, bill_number: 'BILL-4', vendor: { id: 2, name: 'Ceylon Paper Mills' }, due_date: '2026-10-09', amount: 1000, currency: 'LKR', bank: null }],
    );
    expect(r).toMatchObject({ pay_on: '2026-10-20', due_by: '2026-10-31', created_by_name: 'Ruwan S.', can_approve: false });
    expect(r.bills).toEqual([{ id: 9, bill_number: 'BILL-4', vendor: 'Ceylon Paper Mills', due_date: '2026-10-09', amount: 1000, currency: 'LKR', bank: null }]);
  });

  it('reads a quality hold, an agreement, a queue row and a report', () => {
    expect(qcItemOf({ id: 5, status: 'held', receipt_id: 7, receipt_number: 'GRN-7', po_id: 2, po_number: 'PO-2', product: 'PoE injector', code: 'PSU-48V', vendor: { id: 1, name: 'Gulf Tech' }, qty: 12, unit: 'pcs', batch: 'B-1', received_at: '2026-10-01' })).toMatchObject({
      grn_id: 7,
      grn_number: 'GRN-7',
      vendor: 'Gulf Tech',
      quantity: 12,
      batch_no: 'B-1',
      held_at: '2026-10-01',
    });
    expect(agreementOf({ id: 1, reference: 'AGR-1', type: 'contract', vendor_id: 2, vendor: { id: 2, name: 'Metro' }, cap: 500000, released: 1000, remaining: 499000, lines: [{ id: 3, product_id: 8, description: 'Cable', unit_cost: 33600, max_qty: 20, released_qty: 2 }], schedule: { frequency: 'monthly', next_run: '2026-11-01', active: true } })).toMatchObject({
      kind: 'contract',
      vendor: 'Metro',
      schedule: 'monthly',
      next_run: '2026-11-01',
      lines: [{ id: 3, product: 'Cable', unit_price: 33600, max_qty: 20, released_qty: 2 }],
    });
    expect(queueItemOf({ doc_type: 'purchase_request', id: 4, number: 'PR-4', vendor: null, amount: null, currency: 'LKR', requester: 'Nadeesha P.', submitted_at: '2026-10-14', step: 1, step_label: 'Department' })).toMatchObject({ doc: 'request', id: 4, number: 'PR-4', label: 'Department', requested_by: 'Nadeesha P.' });
    const t = reportTable({ key: 'spend-department', columns: [{ key: 'name', label: 'Department' }, { key: 'ordered', label: 'Ordered' }], rows: [{ name: 'IT', ordered: 1200 }], totals: { ordered: 1200 }, basis: 'Approved orders', formats: ['csv', 'pdf'] });
    expect(t).toMatchObject({ total: { ordered: 1200 }, basis: 'Approved orders', formats: ['csv', 'pdf'] });
    expect(t.columns.map((c) => c.kind)).toEqual(['text', 'money']);
  });
});
