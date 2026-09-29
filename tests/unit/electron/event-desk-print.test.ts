import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.2.57' }, safeStorage: {}, BrowserWindow: class {} }));

import { EventDeskPrint, badgeSize, type BadgePrintJob, type BadgePrintResult } from '../../../electron/services/event-desk-print';

const SHEET = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>2 badges</title><style>@page{size:86mm 54mm;margin:0}body{margin:0}</style></head><body><section class="b">A</section><section class="b">B</section></body></html>';

function config() {
  const m = new Map<string, unknown>();
  return { m, getConfig: <T,>(k: string) => m.get(k) as T | undefined, setConfig: (k: string, v: unknown) => void m.set(k, v), deleteConfig: (k: string) => void m.delete(k) };
}

function http(sheet: { status?: number; type?: string; body: string } = { body: SHEET }) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  return {
    calls,
    url: (path: string, q?: Record<string, string | number | boolean | null | undefined>) => {
      const u = new URL(path, 'https://ws.example');
      for (const [k, v] of Object.entries(q ?? {})) if (v != null) u.searchParams.set(k, String(v));
      return u.toString();
    },
    raw: async (method: string, url: string, init: { body?: BodyInit }) => {
      calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (method === 'GET') return new Response(sheet.body, { status: sheet.status ?? 200, headers: { 'content-type': sheet.type ?? 'text/html; charset=utf-8' } });
      return new Response(JSON.stringify({ status: 'success', data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
}

function printer(result: BadgePrintResult = { ok: true }) {
  const jobs: BadgePrintJob[] = [];
  return { jobs, print: async (j: BadgePrintJob) => (jobs.push(j), result) };
}

describe('event desk badges', () => {
  it('reads the badge’s size from the server’s page', () => {
    expect(badgeSize(SHEET)).toEqual({ width: 86_000, height: 54_000 });
    expect(badgeSize('<style>@page{size: 105mm 148mm}</style>')).toEqual({ width: 105_000, height: 148_000 });
    expect(badgeSize('<p>no page</p>')).toBeNull();
    expect(badgeSize('<style>@page{size:5000mm 1mm}</style>')).toBeNull();
  });

  it('prints the server’s sheet for the jobs on the desk’s printer, silently at the template’s size, and reports each printed', async () => {
    const h = http();
    const p = printer();
    const d = new EventDeskPrint({ config: config(), http: h as never, origin: () => 'https://ws.example', print: p.print });
    d.update({ badge_printer: 'Zebra_ZD421', silent: true }, ['Zebra_ZD421', 'Office']);

    const r = await d.printJobs(7, [11, 12], ['Zebra_ZD421', 'Office']);

    expect(h.calls[0]!.url).toBe('https://ws.example/api/events/v1/events/7/badge-prints/sheet?ids=11%2C12');
    expect(p.jobs[0]).toMatchObject({ deviceName: 'Zebra_ZD421', silent: true, pageSize: { width: 86_000, height: 54_000 } });
    expect(h.calls.slice(1).map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', 'https://ws.example/api/events/v1/badge-prints/11/printed', { printer: 'Zebra_ZD421' }],
      ['POST', 'https://ws.example/api/events/v1/badge-prints/12/printed', { printer: 'Zebra_ZD421' }],
    ]);
    expect(r).toEqual({ ok: true, printed: [11, 12], failed: [], message: '2 badges sent to Zebra_ZD421.' });
  });

  it('uses the printer’s own label size when the desk says so, and the dialog without a printer', async () => {
    const p = printer();
    const d = new EventDeskPrint({ config: config(), http: http() as never, origin: () => 'https://ws.example', print: p.print });
    d.update({ page: 'printer' }, []);
    await d.printJobs(7, [11], []);
    expect(p.jobs[0]).toMatchObject({ deviceName: null, silent: false, pageSize: null });
  });

  it('reports a printer’s failure to WorkSuite, and leaves a cancelled print waiting', async () => {
    const failing = http();
    const f = new EventDeskPrint({ config: config(), http: failing as never, origin: () => 'https://ws.example', print: printer({ ok: false, reason: 'Out of labels' }).print });
    expect(await f.printJobs(7, [11], [])).toMatchObject({ ok: false, failed: [11], message: 'The badges could not be printed: Out of labels.' });
    expect(failing.calls[1]).toMatchObject({ url: 'https://ws.example/api/events/v1/badge-prints/11/failed', body: { error: 'Out of labels' } });

    const cancelled = http();
    const c = new EventDeskPrint({ config: config(), http: cancelled as never, origin: () => 'https://ws.example', print: printer({ ok: false, reason: 'cancelled' }).print });
    expect(await c.printJobs(7, [11], [])).toMatchObject({ ok: false, printed: [], failed: [] });
    expect(cancelled.calls).toHaveLength(1);
  });

  it('refuses a printer this computer does not have, and says what the server said when there is no sheet', async () => {
    const d = new EventDeskPrint({ config: config(), http: http() as never, origin: () => 'https://ws.example', print: printer().print });
    expect(() => d.update({ badge_printer: 'Ghost' }, ['Office'])).toThrow(/no printer called “Ghost”/);
    d.update({ badge_printer: 'Office', printer_name: '  Hall A desk  ' }, ['Office']);
    expect(d.settings()).toMatchObject({ badge_printer: 'Office', printer_name: 'Hall A desk' });
    expect(d.update({ printer_name: null }, ['Office']).printer_name).toBeNull();
    expect((await d.printJobs(7, [11], [])).message).toContain('is not on this computer any more');

    const missing = new EventDeskPrint({
      config: config(),
      http: http({ status: 404, type: 'application/json', body: JSON.stringify({ status: 'error', message: 'Badges not found' }) }) as never,
      origin: () => 'https://ws.example',
      print: printer().print,
    });
    expect(await missing.printJobs(7, [99], [])).toMatchObject({ ok: false, message: 'Badges not found' });
  });
});
