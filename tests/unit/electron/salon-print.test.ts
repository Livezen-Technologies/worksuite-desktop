import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import { contract } from '@shared/ipc/contract';
import { DEFAULT_PRINT, drawerPulse, fullPage, pageSize, printDocument, rawCommand, SalonPrint, sendRaw, type PrintJob, type SpawnLike } from '../../../electron/services/salon-print';

function config() {
  const m = new Map<string, unknown>();
  return {
    getConfig: <T>(k: string) => m.get(k) as T | undefined,
    setConfig: (k: string, v: unknown) => void m.set(k, JSON.parse(JSON.stringify(v))),
    deleteConfig: (k: string) => void m.delete(k),
    m,
  };
}

function service(over: { origin?: string | null; response?: () => Response; desk?: number | null } = {}) {
  const cfg = config();
  const jobs: PrintJob[] = [];
  const raw = vi.fn(async (_p: string, _b: Buffer) => ({ ok: true as const }));
  const fetched: string[] = [];
  let origin = over.origin === undefined ? 'https://salon.example' : over.origin;
  const http = {
    url: (path: string, q?: Record<string, string | number | boolean | undefined>) => `${origin}${path}?${new URLSearchParams(q as Record<string, string>)}`,
    raw: vi.fn(async (_m: string, url: string) => {
      fetched.push(url);
      return over.response ? over.response() : new Response('<!doctype html><html><head><style>body{}</style></head><body>Receipt</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }),
  };
  const s = new SalonPrint({
    config: cfg,
    http: http as never,
    origin: () => origin,
    desk: over.desk === undefined ? undefined : () => over.desk ?? null,
    print: async (j) => {
      jobs.push(j);
      return { ok: true };
    },
    raw,
  });
  return { s, cfg, jobs, raw, fetched, setOrigin: (o: string | null) => (origin = o) };
}

describe('the page a receipt is printed from', () => {
  it('puts a policy that allows no script before anything in the page', () => {
    const doc = printDocument('<!DOCTYPE html><html><head><script>alert(1)</script></head><body>x</body></html>');
    expect(doc.startsWith(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`)).toBe(true);
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script>'));
    expect(doc).not.toMatch(/<!DOCTYPE html><html><head><script>/);
  });

  it('is as long as the receipt on a roll, and A4 on A4', () => {
    expect(pageSize('80mm', 1404)).toEqual({ width: 80_000, height: Math.ceil(1404 * (25_400 / 96)) + 12_000 });
    expect(pageSize('58mm', 2000)).toMatchObject({ width: 58_000 });
    // A short receipt is still taller than it is wide, so it is not printed turned.
    expect(pageSize('80mm', 40)).toEqual({ width: 80_000, height: 90_000 });
    expect(pageSize('a4', 5000)).toBe('A4');
    expect(pageSize('letter', 5000)).toBe('Letter');
    expect(fullPage('letter') && fullPage('a4') && !fullPage('80mm') && !fullPage('58mm')).toBe(true);
  });
});

describe('the cash drawer', () => {
  it('is sent the ESC/POS pulse for its pin', () => {
    expect([...drawerPulse(2)]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect([...drawerPulse(5)]).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });

  it('reaches the printer raw, and never through a shell', () => {
    const name = 'EPSON TM-T20 "Front"; rm -rf ~ & calc.exe';
    const bytes = drawerPulse(2);

    const cups = rawCommand('linux', name, bytes);
    expect(cups).toMatchObject({ cmd: 'lp', args: ['-d', name, '-o', 'raw', '-t', 'WorkSuite drawer'] });
    expect([...cups.stdin!]).toEqual([...bytes]);
    expect(rawCommand('darwin', name, bytes).cmd).toBe('lp');

    const win = rawCommand('win32', name, bytes);
    expect(win.cmd).toBe('powershell.exe');
    expect(win.args.join(' ')).not.toContain(name);
    expect(win.env).toEqual({ WS_PRINTER: name, WS_BYTES: bytes.toString('base64') });
    expect(win.args.at(-1)).toContain('pDataType = "RAW"');
  });

  it('says why it did not open', async () => {
    const fake = (code: number | null, stderr = '', error?: NodeJS.ErrnoException) =>
      ((cmd: string, args: string[], opts: { shell?: boolean }) => {
        expect(opts.shell).toBe(false);
        const child = new EventEmitter() as EventEmitter & { stdin: { end: (b?: Buffer) => void }; stderr: EventEmitter; kill: () => void };
        child.stderr = new EventEmitter();
        child.kill = () => undefined;
        child.stdin = {
          end: (b?: Buffer) => {
            expect(cmd).toBe('lp');
            expect(args).toContain('raw');
            expect(b && [...b]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
            queueMicrotask(() => {
              if (error) child.emit('error', error);
              if (stderr) child.stderr.emit('data', Buffer.from(stderr));
              if (code !== null) child.emit('close', code);
            });
          },
        };
        return child;
      }) as unknown as SpawnLike;

    await expect(sendRaw('Receipt', drawerPulse(2), 'linux', fake(0))).resolves.toEqual({ ok: true });
    await expect(sendRaw('Receipt', drawerPulse(2), 'linux', fake(1, 'lp: warning\nlp: The printer or class does not exist.\n'))).resolves.toEqual({ ok: false, reason: 'lp: The printer or class does not exist.' });
    await expect(sendRaw('Receipt', drawerPulse(2), 'linux', fake(null, '', Object.assign(new Error('spawn lp ENOENT'), { code: 'ENOENT' })))).resolves.toEqual({ ok: false, reason: 'lp is not available on this computer.' });
  });
});

describe('the desk’s printers', () => {
  it('are this computer’s, filed under the server, and forgotten by a wipe', () => {
    const { s, cfg, setOrigin } = service();
    expect(s.settings()).toEqual(DEFAULT_PRINT);

    s.update({ receipt_printer: 'TM-T20', paper: '58mm' }, ['TM-T20', 'Office A4']);
    expect(s.settings()).toMatchObject({ receipt_printer: 'TM-T20', paper: '58mm', silent: true });

    setOrigin('https://other.example');
    expect(s.settings()).toEqual(DEFAULT_PRINT);

    s.forgetAll();
    setOrigin('https://salon.example');
    expect(s.settings()).toEqual(DEFAULT_PRINT);
    expect(cfg.m.size).toBe(0);
  });

  it('must be printers this computer has', () => {
    const { s } = service();
    expect(() => s.update({ receipt_printer: 'Gone' }, ['TM-T20'])).toThrow(/no printer called “Gone”/);
    expect(() => service({ origin: null }).s.update({ paper: '58mm' }, [])).toThrow(/No WorkSuite server/);
  });
});

describe('printing a receipt', () => {
  it('prints the server’s own receipt, straight to the desk’s printer', async () => {
    const { s, jobs, fetched } = service();
    s.update({ receipt_printer: 'TM-T20', copies: 2 }, ['TM-T20']);

    const r = await s.receipt(42, undefined, ['TM-T20']);

    expect(fetched).toEqual(['https://salon.example/api/salon/v1/visits/42/receipt?paper=80mm']);
    expect(jobs).toEqual([{ html: expect.stringContaining('Receipt') as string, paper: '80mm', deviceName: 'TM-T20', silent: true, copies: 2 }]);
    expect(r).toEqual({ ok: true, printer: 'TM-T20', silent: true, message: 'Sent to TM-T20.' });
  });

  it('names the desk, so the receipt comes in the template the desk was paired with', async () => {
    const { s, fetched } = service({ desk: 7 });
    await s.receipt(42, '58mm', []);
    expect(fetched).toEqual(['https://salon.example/api/salon/v1/visits/42/receipt?paper=58mm&desk=7']);
  });

  it('asks where to print when no printer is set up, and sends A4 to the A4 printer', async () => {
    const { s, jobs } = service();
    await s.receipt(42, undefined, []);
    expect(jobs[0]).toMatchObject({ deviceName: null, silent: false });

    s.update({ receipt_printer: 'TM-T20', a4_printer: 'Office A4' }, ['TM-T20', 'Office A4']);
    await s.receipt(42, 'a4', ['TM-T20', 'Office A4']);
    expect(jobs[1]).toMatchObject({ paper: 'a4', deviceName: 'Office A4', silent: true });
  });

  it('does not print to a printer that has gone', async () => {
    const { s, jobs } = service();
    s.update({ receipt_printer: 'TM-T20' }, ['TM-T20']);
    const r = await s.receipt(42, undefined, []);
    expect(jobs).toHaveLength(0);
    expect(r).toMatchObject({ ok: false, message: 'The printer “TM-T20” is not on this computer any more. Choose another in Printers.' });
  });

  it('passes on what the server said when there is no receipt', async () => {
    const { s } = service({ response: () => new Response(JSON.stringify({ status: 'error', message: 'This visit has not been checked out yet.' }), { status: 409, headers: { 'Content-Type': 'application/json' } }) });
    await expect(s.receipt(42, undefined, [])).rejects.toThrow('This visit has not been checked out yet.');
  });

  it('prints the test receipt once, and a page built here', async () => {
    const { s, jobs, fetched } = service();
    s.update({ copies: 3 }, []);
    await s.test('58mm', []);
    await s.page('<div>Z-report</div>', undefined, []);
    expect(fetched).toEqual(['https://salon.example/api/salon/v1/desk/test-receipt?paper=58mm']);
    expect(jobs.map((j) => [j.paper, j.copies])).toEqual([['58mm', 1], ['80mm', 1]]);
  });
});

describe('opening the drawer', () => {
  it('only when a drawer is set up, through the receipt printer', async () => {
    const { s, raw } = service();
    expect(await s.drawer(['TM-T20'])).toMatchObject({ ok: false, message: 'No cash drawer is set up on this computer.' });

    s.update({ drawer: 'printer' }, []);
    expect(await s.drawer(['TM-T20'])).toMatchObject({ ok: false, message: 'Choose the receipt printer the drawer is plugged into.' });

    s.update({ receipt_printer: 'TM-T20', drawer_pin: 5 }, ['TM-T20']);
    expect(await s.drawer(['TM-T20'])).toMatchObject({ ok: true, message: 'Drawer opened.' });
    expect(raw).toHaveBeenCalledWith('TM-T20', drawerPulse(5));
  });
});

describe('the print channels', () => {
  it('take only what they can print', () => {
    const set = contract['salon:printSettingsSet'].input;
    expect(set.safeParse({ paper: '58mm', copies: 2, drawer: 'printer', drawer_pin: 5 }).success).toBe(true);
    expect(set.safeParse({ paper: 'a3' }).success).toBe(false);
    expect(set.safeParse({ copies: 9 }).success).toBe(false);
    expect(set.safeParse({ drawer_pin: 3 }).success).toBe(false);
    expect(contract['salon:printReceipt'].input.safeParse({ visit_id: 0 }).success).toBe(false);
    expect(contract['salon:printPage'].input.safeParse({ html: 'x'.repeat(500_001) }).success).toBe(false);
    expect(contract['salon:openDrawer']).toMatchObject({ session: true, sensitive: true });
  });
});
