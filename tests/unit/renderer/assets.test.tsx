// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})) }));

import { apiGet } from '../../../src/core/api';
import { orNull, parseCsv, resolveCode, toCsv, type Asset } from '../../../src/modules/assets/api';
import { code128, labelsHtml } from '../../../src/modules/assets/labels';
import { nextAct } from '../../../src/modules/assets/Scan';
import { stageOf } from '../../../src/modules/assets/Requests';
import { columnsOf, toTsv } from '../../../src/modules/assets/Reports';
import { weekOf } from '../../../src/modules/assets/Bookings';
import { assetAlerts, assetNoticeActions, assetNoticeLink, assetsCached } from '../../../shared/assets';

const asset = (over: Partial<Asset> = {}): Asset => ({ id: 1, asset_code: 'AST-0001', name: 'Laptop', category: null, brand: null, model: null, serial_number: 'SN1', barcode: null, status: 'available', condition: 'good', purchase_date: null, purchase_price: '1.00', currency: 'LKR', warranty_end: null, net_book_value: '1.00', location: null, org_id: 1, company: 'Livezen', ...over });
const notFound = Object.assign(new Error('nf'), { status: 404 });

describe('scan resolution (T-11)', () => {
  it('uses the server resolver where there is one', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ asset: asset({ id: 9 }) });
    expect(await resolveCode('AST-0009')).toEqual({ kind: 'asset', asset: expect.objectContaining({ id: 9 }) });
  });
  it('falls back to an exact code, barcode or serial match on an older server — never a near one', async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(notFound).mockResolvedValueOnce({ assets: [asset({ id: 2, asset_code: 'AST-00010' }), asset({ id: 3, serial_number: 'ast-0001' })], total: 2, page: 1, per_page: 10 });
    expect(await resolveCode('AST-0001')).toMatchObject({ kind: 'asset', asset: { id: 3 } });
    vi.mocked(apiGet).mockRejectedValueOnce(notFound).mockResolvedValueOnce({ assets: [asset({ asset_code: 'AST-00010', serial_number: null })], total: 1, page: 1, per_page: 10 });
    expect(await resolveCode('E-0231', [{ id: 4, name: 'Ayesha', employee_no: 'E-0231' }])).toMatchObject({ kind: 'person', person: { id: 4 } });
  });
  it('turns a missing endpoint into null and passes any other error on', async () => {
    expect(await orNull(Promise.reject(notFound))).toBeNull();
    await expect(orNull(Promise.reject(Object.assign(new Error('x'), { status: 500 })))).rejects.toThrow('x');
  });
});

describe('the scan station decides what Enter does', () => {
  const p = { id: 4, name: 'Ayesha', employee_no: 'E-0231' };
  it('issues an available asset once the person is known', () => {
    expect(nextAct('issue', asset(), null)).toMatchObject({ act: 'none', why: expect.stringMatching(/ID card/) });
    expect(nextAct('issue', asset(), p).act).toBe('issue');
    expect(nextAct('issue', asset({ status: 'repair' }), p).act).toBe('none');
  });
  it('returns only what is out, and lends out or takes back', () => {
    expect(nextAct('return', asset({ status: 'assigned' }), null).act).toBe('return');
    expect(nextAct('return', asset(), null).act).toBe('none');
    expect(nextAct('loan', asset(), p).act).toBe('checkout');
    expect(nextAct('loan', asset({ status: 'checked_out' }), null).act).toBe('checkin');
    expect(nextAct('lookup', asset(), p).act).toBe('none');
  });
});

describe('files', () => {
  it('reads CSV and tab-separated text with quotes as Excel writes them', () => {
    const r = parseCsv('﻿Name,Purchase Price,Notes\r\n"Desk, oak",42000,"said ""fine"""\r\n\r\nChair,9000,\n');
    expect(r.head).toEqual(['name', 'purchase_price', 'notes']);
    expect(r.rows[0]).toMatchObject({ purchase_price: '42000', notes: 'said "fine"' });
    expect(r.rows).toHaveLength(2);
    expect(parseCsv('name\tserial\nA\tS1').rows[0]).toEqual({ name: 'A', serial: 'S1' });
  });
  it('writes CSV that a spreadsheet cannot run as a formula', () => {
    expect(toCsv(['a', 'b'], [['=SUM(A1)', 'x,y'], [-5, null]])).toBe("a,b\r\n'=SUM(A1),\"x,y\"\r\n-5,\r\n");
    expect(toTsv(['a'], [{ a: 'x\ty' }])).toBe('A\nx y');
  });
});

describe('labels (D22)', () => {
  it('encodes Code 128 B with its check digit, and refuses what it cannot carry', () => {
    const m = code128('AST-0142')!;
    // Start (6) + 8 characters + check (6 each) + stop (7 modules wide in 7 bars and spaces).
    expect(m.length).toBe(6 * 10 + 7);
    expect(m.reduce((s, w) => s + w, 0)).toBe(11 * 10 + 13);
    expect(code128('naïve')).toBeNull();
  });
  it('lays the labels out for the stock chosen', () => {
    const html = labelsHtml([{ code: 'AST-1', name: 'Desk <oak>', company: 'Livezen' }], { stock: 'a4', code: 'both' });
    expect(html).toContain('size:A4');
    expect(html).toContain('Property of Livezen');
    expect(html).toContain('Desk &lt;oak&gt;');
  });
});

describe('queues and reports', () => {
  it('puts a request in the stage its status and author say', () => {
    const r = { status: 'pending', is_mine: false } as never;
    expect(stageOf(r)).toBe('waiting');
    expect(stageOf({ status: 'pending', is_mine: true } as never)).toBe('open');
    expect(stageOf({ status: 'it_approved', is_mine: false } as never)).toBe('ready');
    expect(stageOf({ status: 'fulfilled', is_mine: false } as never)).toBe('closed');
  });
  it("shows a report's columns as the server sent them, ids left out", () => {
    expect(columnsOf([{ id: 1, category: 'IT', cost: '1.00', asset_id: 4, nested: {} }])).toEqual(['category', 'cost']);
  });
  it('starts the week on Monday', () => {
    expect(weekOf(new Date('2026-10-28T10:00:00Z'))[0]).toBe('2026-10-26');
  });
});

describe('alerts and tray (D03)', () => {
  it('raises the handovers to confirm, the loans overdue and the approvals waiting', () => {
    const r = assetAlerts({ mine: { assets: [{ id: 1, name: 'iPhone 15', asset_code: 'AST-0179', assignment_id: 7, acknowledge_required: true, acknowledged_at: null }, { id: 2, name: 'Camera', expected_return_at: '2026-10-23' }] }, dashboard: { kpi: { pending_requests: 1, pending_transfers: 2 } } }, '2026-10-25');
    expect(r.alerts.map((a) => a.link)).toEqual(['/assets?tab=mine&confirm=7', '/assets?asset=2', '/assets?tab=requests']);
    expect(r.tray.waiting).toBe(5);
    expect(assetAlerts({ mine: { assets: [{ id: 1, assignment_id: 7 }] } }, '2026-10-25').alerts).toEqual([]);
  });
  it('opens the right screen and offers buttons that only open it', () => {
    expect(assetNoticeLink('asset.transfer.pending', {})).toBe('/assets?tab=transfers');
    expect(assetNoticeLink('payroll.run', {})).toBeNull();
    expect(assetNoticeActions('asset.handover', { assignment_id: 7 })?.buttons[0]).toEqual({ label: 'I received it', link: '/assets?tab=mine&confirm=7' });
  });
  it('keeps the lists offline but never a licence key', () => {
    expect(assetsCached('/api/assets?page=2')).toBe(true);
    expect(assetsCached('/api/assets/42')).toBe(true);
    expect(assetsCached('/api/assets/licenses/3/seats')).toBe(true);
    expect(assetsCached('/api/assets/licenses/3/key')).toBe(false);
    expect(assetsCached('/api/assets/documents/abc')).toBe(false);
  });
});
