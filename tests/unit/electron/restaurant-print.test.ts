import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import type { RestaurantPairing } from '@shared/restaurant';
import { printableText } from '@shared/restaurant';
import { DesktopError } from '../../../electron/main/errors';
import { escposBytes, RestaurantPrintAgent, textPage, type ClaimedJob } from '../../../electron/services/restaurant/print-agent';
import type { PrintJob } from '../../../electron/services/salon-print';

function config() {
  const m = new Map<string, unknown>();
  return {
    getConfig: <T>(k: string) => m.get(k) as T | undefined,
    setConfig: (k: string, v: unknown) => void m.set(k, JSON.parse(JSON.stringify(v))),
    deleteConfig: (k: string) => void m.delete(k),
    m,
  };
}

const TERMINAL: RestaurantPairing = { terminal_id: 7, org_id: 17, branch_id: 3, name: 'Kitchen host', code: 'P1', mode: 'print_host', station_id: null, area_id: null, counter_id: null, pos_register_id: null, paired_at: '2026-09-30T09:00:00Z' };
const KEY = `rt_${'ef'.repeat(24)}`;
const KOT = '*** ADD ***\nGRILL\nK-0004   Order #0012\nTable A1 · Dine-in\n--------------------------------\n2 x Chicken kottu\n    extra spicy';

function job(over: Partial<ClaimedJob> = {}): ClaimedJob {
  return { id: 91, document: 'kot', reprint: false, printer_id: 4, payload: { text: KOT, copies: 1 }, printer: { id: 4, name: 'Grill printer', kind: 'kitchen', connection: 'usb', paper: '80mm' }, ...over };
}

function agent(over: { jobs?: ClaimedJob[]; installed?: string[]; raw?: (p: string, b: Buffer) => Promise<{ ok: true } | { ok: false; reason: string }>; claim?: () => unknown } = {}) {
  const cfg = config();
  const calls: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }> = [];
  const request = vi.fn(async (method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    calls.push({ method, path, body: opts.body, headers: opts.headers });
    if (path.endsWith('/print-jobs/claim')) return over.claim ? over.claim() : { jobs: over.jobs ?? [job()] };
    return { job: {} };
  });
  const pages: PrintJob[] = [];
  const raw = vi.fn(over.raw ?? (async () => ({ ok: true as const })));
  const a = new RestaurantPrintAgent({
    config: cfg,
    http: { request } as never,
    origin: () => 'https://ws.example',
    terminal: () => TERMINAL,
    terminalKey: () => KEY,
    active: () => true,
    installed: async () => over.installed ?? ['EPSON TM-T20', 'Office laser'],
    changed: () => undefined,
    print: async (j) => {
      pages.push(j);
      return { ok: true };
    },
    raw,
    now: () => Date.parse('2026-09-30T10:00:00Z'),
  });
  return { a, cfg, calls, raw, pages };
}

describe('restaurant print agent: claims, prints and answers', () => {
  it('claims nothing until a printer is mapped here', async () => {
    const { a, calls } = agent();
    expect(await a.tick()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('claims only for the mapped printers, with the terminal key, prints ESC/POS raw and reports it printed', async () => {
    const { a, calls, raw } = agent();
    a.update({ printers: { '4': { device: 'EPSON TM-T20', mode: 'escpos', paper: '80mm', cut: true } } }, ['EPSON TM-T20']);
    expect(await a.tick()).toBe(1);

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/restaurant/v1/print-jobs/claim', body: { printer_ids: [4], limit: 10 }, headers: { 'X-Terminal-Key': KEY } });
    expect(raw).toHaveBeenCalledTimes(1);
    const [device, bytes] = raw.mock.calls[0]!;
    expect(device).toBe('EPSON TM-T20');
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(bytes.subarray(-4)).toEqual(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
    expect(bytes.toString('latin1')).toContain('2 x Chicken kottu');
    expect(calls[1]).toMatchObject({ path: '/api/restaurant/v1/print-jobs/91/printed', headers: { 'X-Terminal-Key': KEY } });
    expect(a.jobs()[0]).toMatchObject({ job_id: 91, ok: true, printer_name: 'Grill printer' });
    expect(a.printers()).toEqual([{ id: 4, status: 'online' }]);
  });

  it('prints through the driver as a page when asked, with nothing in it that runs', async () => {
    const { a, pages } = agent({ jobs: [job({ payload: { text: 'Bill <script>x</script>', copies: 2 } })] });
    a.update({ printers: { '4': { device: 'Office laser', mode: 'page', paper: '58mm', cut: false } } }, ['Office laser']);
    await a.tick();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ deviceName: 'Office laser', silent: true, paper: '58mm', copies: 2 });
    expect(pages[0]!.html).toContain('&lt;script&gt;');
    expect(pages[0]!.html).not.toContain('<script>');
  });

  it('reports a failure with why: a printer gone from this computer, or one that would not print', async () => {
    const gone = agent({ installed: ['Office laser'] });
    gone.a.update({ printers: { '4': { device: 'EPSON TM-T20', mode: 'escpos', paper: '80mm', cut: true } } }, ['EPSON TM-T20']);
    await gone.a.tick();
    expect(gone.calls[1]).toMatchObject({ path: '/api/restaurant/v1/print-jobs/91/failed', body: { error: 'The printer “EPSON TM-T20” is not on this computer any more.' } });

    const jam = agent({ raw: async () => ({ ok: false, reason: 'lp: printer is out of paper' }) });
    jam.a.update({ printers: { '4': { device: 'EPSON TM-T20', mode: 'escpos', paper: '80mm', cut: true } } }, ['EPSON TM-T20']);
    await jam.a.tick();
    expect(jam.calls[1]).toMatchObject({ path: '/api/restaurant/v1/print-jobs/91/failed', body: { error: 'lp: printer is out of paper' } });
    expect(jam.a.printers()).toEqual([{ id: 4, status: 'error' }]);
    expect(jam.a.jobs()[0]).toMatchObject({ ok: false, message: 'lp: printer is out of paper' });
  });

  it('waits quietly when WorkSuite is out of reach, and shows a refusal', async () => {
    const off = agent({
      claim: () => {
        throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
      },
    });
    off.a.update({ printers: { '4': { device: 'EPSON TM-T20', mode: 'escpos', paper: '80mm', cut: true } } }, ['EPSON TM-T20']);
    await off.a.tick();
    expect(off.a.status().problem).toBeNull();

    const revoked = agent({
      claim: () => {
        throw new DesktopError('SERVER_ERROR', 'Only a paired terminal of the branch prints. Send its device key.', 403);
      },
    });
    revoked.a.update({ printers: { '4': { device: 'EPSON TM-T20', mode: 'escpos', paper: '80mm', cut: true } } }, ['EPSON TM-T20']);
    await revoked.a.tick();
    expect(revoked.a.status().problem).toMatch(/paired terminal/);
  });

  it('does nothing when switched off', async () => {
    const { a, calls } = agent();
    a.update({ agent: false, printers: { '4': { device: 'EPSON TM-T20', mode: 'escpos', paper: '80mm', cut: true } } }, ['EPSON TM-T20']);
    expect(await a.tick()).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('restaurant print agent: settings, test prints, the drawer', () => {
  it('keeps the mapping per server, refuses a printer this computer does not have, and a null removes one', () => {
    const { a, cfg } = agent();
    expect(() => a.update({ printers: { '4': { device: 'Nowhere', mode: 'escpos', paper: '80mm', cut: true } } }, ['EPSON TM-T20'])).toThrow(/no printer called/);
    a.update({ printers: { '4': { device: 'EPSON TM-T20', mode: 'escpos', paper: '80mm', cut: true } }, drawer_printer_id: 4 }, ['EPSON TM-T20']);
    expect(cfg.m.get('restaurant-print')).toMatchObject({ 'https://ws.example': { drawer_printer_id: 4, printers: { '4': { device: 'EPSON TM-T20' } } } });
    a.update({ printers: { '4': null } }, []);
    expect(a.settings().printers).toEqual({});
  });

  it('prints a test slip and a document no route took, and opens the drawer through the receipt printer', async () => {
    const { a, raw } = agent();
    expect((await a.drawer(['EPSON TM-T20'])).ok).toBe(false);
    a.update({ printers: { '4': { device: 'EPSON TM-T20', mode: 'escpos', paper: '80mm', cut: true } }, drawer_printer_id: 4, drawer_pin: 5 }, ['EPSON TM-T20']);

    expect(await a.test(4, ['EPSON TM-T20'])).toMatchObject({ ok: true, device: 'EPSON TM-T20' });
    expect(raw.mock.calls[0]![1].toString('latin1')).toContain('Test print');
    expect(await a.text('BILL B-0007\nTotal 2,450.00', null, 1, ['EPSON TM-T20'])).toMatchObject({ ok: true });
    expect(raw.mock.calls[1]![1].toString('latin1')).toContain('BILL B-0007');
    expect(await a.drawer(['EPSON TM-T20'])).toMatchObject({ ok: true, message: 'Drawer opened.' });
    expect(raw.mock.calls[2]![1]).toEqual(Buffer.from([0x1b, 0x70, 0x01, 0x19, 0xfa]));
    expect(await a.drawer([])).toMatchObject({ ok: false });
  });
});

describe('restaurant print agent: what a printer is sent', () => {
  it('sends printable text only, in the printer’s single-byte code page', () => {
    expect(printableText('a\r\nb \u0007\n\n')).toBe('a\nb');
    const b = escposBytes('Café — 2 × Kottu', false);
    expect(b.toString('latin1')).toContain('Cafe ? 2 ? Kottu');
    expect(b.subarray(-1)[0]).toBe(0x0a);
    expect(escposBytes('x', true, 2).length).toBe(2 * escposBytes('x', true).length);
  });

  it('lays a page out as monospace at the roll’s width', () => {
    expect(textPage('A & B', '80mm')).toContain('<pre>A &amp; B</pre>');
    expect(textPage('x', '58mm')).toContain('10px');
  });
});
