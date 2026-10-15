import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import { contract } from '@shared/ipc/contract';
import { deliveryNoteHtml, looksLikeZpl, reportExportPath } from '@shared/sales';
import { SalesDesk, type SalesDeskDeps } from '../../../electron/services/sales-desk';
import type { PrintJob } from '../../../electron/services/salon-print';

/** WS-OMS-SRS-001 FR-DSK-06, FR-LBL-06: labels and delivery notes on this computer's printers; reports saved as PDF. */
const ZPL = '^XA^FO50,50^BCN,100^FDKMB-00941781^FS^XZ';

function desk(answer: (url: string) => Response, over: Partial<SalesDeskDeps> = {}) {
  const config = new Map<string, unknown>();
  const raw = vi.fn(async () => ({ ok: true as const }));
  const pdf = vi.fn(async () => ({ ok: true as const }));
  const print = vi.fn(async (_job: PrintJob) => ({ ok: true as const }));
  const asked: string[] = [];
  const d = new SalesDesk({
    http: {
      raw: (async (_m: string, url: string) => (asked.push(url), answer(url))) as SalesDeskDeps['http']['raw'],
      url: (p: string) => `https://ws.example${p}`,
      get: (async (p: string) => (p.startsWith('/api/inventory/deliveries/') ? { delivery: { id: 3, dn_number: 'DN-00321', so_id: 484, ship_to: 'Matara <b>' }, lines: [{ code: 'TWL', product_name: 'Towel', quantity: '2.0000' }] } : { order: { number: 'SO-00484', client: 'Nimali' } })) as SalesDeskDeps['http']['get'],
      post: (async () => ({})) as SalesDeskDeps['http']['post'],
    },
    config: { getConfig: <T,>(k: string) => config.get(k) as T | undefined, setConfig: (k, v) => void config.set(k, v), deleteConfig: (k) => void config.delete(k) },
    origin: () => 'https://ws.example',
    notify: () => undefined,
    markRead: async () => undefined,
    enabled: () => true,
    open: () => undefined,
    refreshCounts: () => undefined,
    toast: () => undefined,
    printers: async () => ['Zebra ZD421', 'Brother HL'],
    saveDialog: async () => null,
    documents: () => '/docs',
    temp: () => '/tmp',
    openPath: async () => undefined,
    reveal: () => undefined,
    platform: 'linux',
    raw,
    pdf,
    print,
    ...over,
  });
  return { d, raw, pdf, print, asked };
}

describe('Sales printing on this computer', () => {
  it('declares its channels in the contract', () => {
    for (const c of ['sales:printSettings', 'sales:printSettingsSet', 'sales:printNote', 'sales:printLabel', 'sales:saveReport', 'sales:reveal'] as const) expect(contract[c]).toBeTruthy();
  });

  it('remembers a printer per kind, and only one this computer has', () => {
    const { d } = desk(() => new Response(''));
    expect(d.update({ label_printer: 'Zebra ZD421' }, ['Zebra ZD421']).label_printer).toBe('Zebra ZD421');
    expect(d.settings()).toMatchObject({ label_printer: 'Zebra ZD421', label_format: 'zpl', silent: true });
    expect(() => d.update({ note_printer: 'Ghost' }, ['Zebra ZD421'])).toThrow(/no printer called/);
  });

  it('sends a ZPL label raw to the label printer, and refuses what is not ZPL', async () => {
    const t = desk(() => new Response(ZPL, { headers: { 'content-type': 'text/plain' } }));
    t.d.update({ label_printer: 'Zebra ZD421' }, ['Zebra ZD421']);
    const r = await t.d.printLabel(900, ['Zebra ZD421'], { reason: 'reprint' });
    expect(r).toMatchObject({ ok: true, via: 'raw', printer: 'Zebra ZD421' });
    expect(t.asked[0]).toBe('https://ws.example/api/oms/shipments/900/labels?format=zpl&reason=reprint');
    expect(t.raw).toHaveBeenCalledWith('Zebra ZD421', Buffer.from(ZPL));

    const bad = desk(() => new Response('<html>nope</html>'));
    bad.d.update({ label_printer: 'Zebra ZD421' }, ['Zebra ZD421']);
    expect(await bad.d.printLabel(900, ['Zebra ZD421'])).toMatchObject({ ok: false });
    expect(bad.raw).not.toHaveBeenCalled();
  });

  it('prints a PDF label through the driver, and asks for a printer first', async () => {
    const t = desk(() => new Response('%PDF-1.7 …'));
    expect(await t.d.printLabel(900, ['Zebra ZD421'])).toMatchObject({ ok: false, message: expect.stringMatching(/Choose the label printer/) });
    t.d.update({ label_printer: 'Zebra ZD421', label_format: 'pdf' }, ['Zebra ZD421']);
    expect(await t.d.printLabel(900, ['Zebra ZD421'])).toMatchObject({ ok: true, via: 'pdf' });
    expect(t.asked.at(-1)).toContain('format=pdf_a6');
    expect(t.pdf).toHaveBeenCalled();
  });

  it('lays a delivery note out from Inventory’s record, escaped, on the note printer, silently', async () => {
    const t = desk(() => new Response(''));
    t.d.update({ note_printer: 'Brother HL' }, ['Brother HL']);
    const r = await t.d.printNote(3, ['Brother HL']);
    expect(r).toMatchObject({ ok: true, via: 'page', printer: 'Brother HL' });
    const job = t.print.mock.calls[0]![0];
    expect(job).toMatchObject({ deviceName: 'Brother HL', silent: true, paper: 'a4' });
    expect(job.html).toContain('DN-00321');
    expect(job.html).toContain('SO-00484');
    expect(job.html).toContain('Matara &#60;b&#62;');
    expect(job.html).not.toContain('<script');
    expect(job.html).toContain('<svg');
  });

  it('builds the addresses and checks ZPL', () => {
    expect(reportExportPath({ report: 'sales', from: '2026-07-01', to: '2026-09-30', group: 'client' })).toBe('/api/oms/reports/sales/export?format=pdf&from=2026-07-01&to=2026-09-30&group=client');
    expect(looksLikeZpl(ZPL)).toBe(true);
    expect(looksLikeZpl('hello')).toBe(false);
    expect(deliveryNoteHtml({ id: 1, dn_number: 'DN-1' }, [])).toContain('Delivery note DN-1');
  });

  it('shows in its folder only a report it saved', () => {
    const reveal = vi.fn();
    const { d } = desk(() => new Response(''), { reveal });
    expect(d.revealSaved('/etc/passwd')).toBe(false);
    expect(reveal).not.toHaveBeenCalled();
  });
});
