import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import type { PosSale, PosServerReceipt } from '@shared/pos';
import { COLUMNS, escpos, pairLine, plain, PosPrint, receiptHtml, receiptRows, reportRows, serverReceiptRows, type ReceiptRow } from '../../../electron/services/pos-print';
import { drawerPulse, type PrintJob } from '../../../electron/services/salon-print';

const sale: PosSale = {
  ref: 'T1-AAAAAA-000042',
  created_at: '2026-09-30T08:15:00.000Z',
  terminal_id: 7,
  cashier_id: 5,
  cashier_name: 'Kasun',
  state: 'sent',
  number: 'SO-2026-0100',
  message: null,
  attempts: 1,
  sent_at: '2026-09-30T08:15:02.000Z',
  session_id: 41,
  register_id: 3,
  currency: 'LKR',
  customer: { name: 'Nimal <Perera>' },
  lines: [{ product_id: 9, code: 'TEA-1', name: 'Ceylon tea — 100g', quantity: 2, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 900, tax: 0, total: 900 }],
  discount_pct: 10,
  totals: { subtotal: 900, discount: 90, tax: 0, total: 810 },
  tenders: [{ method: 'cash', amount: 1000 }],
  change_given: 190,
  priced_by: 'server',
  catalogue_version: 'v1',
};

function config() {
  const m = new Map<string, unknown>();
  return { m, getConfig: <T>(k: string) => m.get(k) as T | undefined, setConfig: (k: string, v: unknown) => void m.set(k, JSON.parse(JSON.stringify(v))), deleteConfig: (k: string) => void m.delete(k) };
}

function service(origin = 'https://ws.example') {
  const cfg = config();
  const jobs: PrintJob[] = [];
  const raw = vi.fn(async (_p: string, _b: Buffer) => ({ ok: true as const }));
  const p = new PosPrint({
    config: cfg,
    origin: () => origin,
    print: async (j) => {
      jobs.push(j);
      return { ok: true };
    },
    raw,
  });
  return { p, cfg, jobs, raw };
}

const has = (buf: Buffer, seq: number[]) => buf.indexOf(Buffer.from(seq)) >= 0;

describe('ESC/POS', () => {
  it('initialises, picks the code page, prints the rows and cuts', () => {
    const rows: ReceiptRow[] = [{ kind: 'text', text: 'Shop', align: 'center', bold: true }, { kind: 'rule' }, { kind: 'pair', left: 'TOTAL', right: '810.00', bold: true }];
    const b = escpos(rows, 32);
    expect([...b.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x00]);
    expect([...b.subarray(b.length - 4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(has(b, [0x1b, 0x61, 0x01])).toBe(true); // centred
    expect(has(b, [0x1b, 0x45, 0x01])).toBe(true); // bold on
    expect(b.toString('latin1')).toContain(`${'-'.repeat(32)}\n`);
    expect(b.toString('latin1')).toContain(`TOTAL${' '.repeat(32 - 5 - 6)}810.00\n`);
  });

  it('opens the drawer first when asked, and repeats the receipt for copies', () => {
    const rows: ReceiptRow[] = [{ kind: 'text', text: 'x' }];
    const b = escpos(rows, 48, { pulse: drawerPulse(2), copies: 2 });
    expect([...b.subarray(5, 10)]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect(b.toString('latin1').split('\x1dVB\x00').length - 1).toBe(2);
    expect(has(escpos(rows, 48), [0x1b, 0x70])).toBe(false);
    expect([...drawerPulse(5)]).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });

  it('reduces text to what a code page prints', () => {
    expect(plain('Café — “tea” × 2 ’')).toBe('Cafe - "tea" x 2 \'');
    expect(plain('ආයුබෝවන් Kasun')).toMatch(/^\?+ Kasun$/);
    expect(plain('a\u001bp\u0000')).toBe('a?p?');
  });

  it('keeps the amount whole and cuts the label', () => {
    expect(pairLine('Subtotal', '900.00', 20)).toBe('Subtotal      900.00');
    expect(pairLine('A very long product name indeed', '1,234.00', 20)).toBe('A very long 1,234.00');
    expect(pairLine('x', '12345678901234567890123', 20)).toHaveLength(21);
  });
});

describe('the receipt', () => {
  it('lays out the sale from the till’s record', () => {
    const text = receiptRows(sale, { header: 'Acme Stores\nColombo 03', footer: 'No returns after 14 days' }, { till: 'Front till' })
      .map((r) => (r.kind === 'rule' ? '---' : r.kind === 'pair' ? `${r.left}|${r.right}` : r.text))
      .join('\n');
    expect(text).toContain('Acme Stores\nColombo 03\n---\nReceipt|T1-AAAAAA-000042\nOrder|SO-2026-0100');
    expect(text).toContain('Ceylon tea — 100g\n  2 x 450.00|900.00');
    expect(text).toContain('Discount 10%|-90.00');
    expect(text).toContain('TOTAL|LKR 810.00');
    expect(text).toContain('Cash|1,000.00\nChange|190.00');
    expect(text).not.toContain('Provisional');
    expect(text).not.toContain('COPY');
    const again = receiptRows({ ...sale, priced_by: 'estimate' }, { header: '', footer: '' }, { till: null, reprint: true });
    expect(again.some((r) => r.kind === 'text' && r.text === '*** COPY ***')).toBe(true);
    expect(again.some((r) => r.kind === 'text' && r.text.startsWith('Provisional'))).toBe(true);
  });

  it('lays out WorkSuite’s receipt: its figures, invoice, refunds and status', () => {
    const r: PosServerReceipt = {
      company: { name: 'Acme Stores', address: 'Colombo 03', phone: null, tax_number: 'VAT-1' },
      receipt_no: 'T1-AAAAAA-000042',
      order_number: 'SO-2026-0100',
      invoice_number: 'INV-77',
      register: 'Front (R1)',
      cashier: 'Kasun',
      customer: null,
      at: '2026-09-30 13:45',
      currency: 'LKR',
      lines: [{ description: 'Ceylon tea', quantity: 2, unit_price: 440, discount_pct: 0, amount: 880, tax: 0, total: 880 }],
      taxes: [],
      totals: { subtotal: 880, discount: 0, tax: 0, total: 880 },
      tenders: [{ label: 'Cash', amount: 1000, reference: null }],
      change: 120,
      refunds: [{ ref: 'T1-AAAAAA-000042-R1', kind: 'refund', amount: 440, cash: 440, reason: 'Damaged' }],
      refunded: 440,
      status: 'part_refunded',
      void_reason: null,
      footer: 'Thank you',
    };
    const text = serverReceiptRows(r, { header: '', footer: '' }, { till: 'Front till', reprint: true })
      .map((x) => (x.kind === 'rule' ? '---' : x.kind === 'pair' ? `${x.left}|${x.right}` : x.text))
      .join('\n');
    expect(text).toContain('Acme Stores\nColombo 03\nTax no. VAT-1\n*** COPY ***\n*** PART REFUNDED ***');
    expect(text).toContain('Receipt|T1-AAAAAA-000042\nInvoice|INV-77');
    expect(text).toContain('  2 x 440.00|880.00');
    expect(text).toContain('TOTAL|LKR 880.00');
    expect(text).toContain('Cash|1,000.00\nChange|120.00');
    expect(text).toContain('Refund T1-AAAAAA-000042-R1|-440.00');
    expect(text).toContain('---\nThank you');
  });

  it('escapes everything on the driver’s page', () => {
    const html = receiptHtml(receiptRows(sale, { header: '<b>Shop</b>', footer: '' }, { till: null }), '58mm');
    expect(html).toContain('&lt;b&gt;Shop&lt;/b&gt;');
    expect(html).toContain('Nimal &lt;Perera&gt;');
    expect(html).not.toContain('<script');
    expect(html).toContain('width:219px');
  });

  it('prints a report from the screens’ rows', () => {
    const rows = reportRows({ title: 'Z report', rows: [{ label: 'Expected', value: '5,000.00' }, { rule: true }, { label: 'Variance', value: '-10.00', strong: true }] }, { header: '' });
    expect(rows).toEqual([{ kind: 'text', text: 'Z report', align: 'center', bold: true, big: true }, { kind: 'rule' }, { kind: 'pair', left: 'Expected', right: '5,000.00', bold: undefined }, { kind: 'rule' }, { kind: 'pair', left: 'Variance', right: '-10.00', bold: true }]);
  });
});

describe('the till’s printer', () => {
  it('sends ESC/POS to the receipt printer, with the drawer pulse when cash was taken', async () => {
    const { p, raw } = service();
    p.update({ receipt_printer: 'EPSON TM-T20', drawer: 'printer', drawer_pin: 5 }, ['EPSON TM-T20']);
    const o = await p.receipt(sale, ['EPSON TM-T20'], { till: 'Front till', kick: true });
    expect(o).toEqual({ ok: true, printer: 'EPSON TM-T20', message: 'Sent to EPSON TM-T20.' });
    const [printer, bytes] = raw.mock.calls[0]!;
    expect(printer).toBe('EPSON TM-T20');
    expect([...bytes.subarray(5, 10)]).toEqual([...drawerPulse(5)]);
    expect(bytes.toString('latin1')).toContain('T1-AAAAAA-000042');
    expect(bytes.toString('latin1').length).toBeGreaterThan(COLUMNS['80mm']);
  });

  it('prints through the driver silently and pulses the drawer after', async () => {
    const { p, raw, jobs } = service();
    p.update({ receipt_printer: 'Thermal', mode: 'driver', drawer: 'printer' }, ['Thermal']);
    await p.receipt(sale, ['Thermal'], { till: null, kick: true });
    expect(jobs[0]).toMatchObject({ deviceName: 'Thermal', silent: true, paper: '80mm', copies: 1 });
    expect(raw).toHaveBeenCalledWith('Thermal', drawerPulse(2));
  });

  it('does not open the drawer for a reprint or a sale without cash', async () => {
    const { p, raw } = service();
    p.update({ receipt_printer: 'Thermal', drawer: 'printer' }, ['Thermal']);
    await p.receipt(sale, ['Thermal'], { till: null, reprint: true });
    expect(raw.mock.calls[0]![1].indexOf(Buffer.from([0x1b, 0x70]))).toBe(-1);
  });

  it('says what is missing rather than guessing a printer', async () => {
    const { p } = service();
    expect((await p.receipt(sale, [], { till: null })).message).toMatch(/Choose the receipt printer/);
    expect((await p.drawer([])).message).toBe('No cash drawer is set up on this computer.');
    p.update({ receipt_printer: 'Gone' }, ['Gone']);
    expect((await p.receipt(sale, ['Other'], { till: null })).ok).toBe(false);
    expect(() => p.update({ receipt_printer: 'Nope' }, ['Other'])).toThrow(/no printer called/);
  });

  it('keeps settings per server, and forgets them at a wipe', () => {
    const { p, cfg } = service();
    p.update({ copies: 2, header: 'Acme' }, []);
    expect(p.settings()).toMatchObject({ copies: 2, header: 'Acme', mode: 'escpos', paper: '80mm' });
    p.forgetAll();
    expect(cfg.m.size).toBe(0);
    expect(p.settings().copies).toBe(1);
  });
});
