import { describe, expect, it, vi } from 'vitest';
import { purchaseExportName, purchaseExportPath, purchaseExportSchema } from '@shared/purchase';
import { contract } from '@shared/ipc/contract';

vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

const { runActions, runExportRequest } = await import('../../../src/modules/purchase/payrun');

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
    const x = purchaseExportSchema.parse({ what: 'report', report: 'department-spend', format: 'xlsx', from: '2026-01-01', to: '2026-10-15', org: '2' });
    expect(purchaseExportPath(x)).toBe('/api/purchase/reports/department-spend/export?format=xlsx&from=2026-01-01&to=2026-10-15&org=2');
    expect(purchaseExportName(x, 'department-spend', '2026-10-15')).toBe('purchasing-department-spend-2026-10-15.xlsx');
    expect(purchaseExportSchema.safeParse({ what: 'report', report: 'everything', format: 'csv' }).success).toBe(false);
  });
});
