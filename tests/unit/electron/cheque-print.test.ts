import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.2.57' }, safeStorage: {}, BrowserWindow: class {} }));

import { ChequeStation, layoutHashMatches, sheetLayout } from '../../../electron/services/cheque-print';
import { canonicalPhp, pageSizeMicrons, renderExactHtml, sha256Text, type ExactPrintJob, type ExactPrintResult } from '../../../electron/services/core-print';
import { canonicalJson } from '../../../shared/canonical-json';
import { clampOffset, modelToLayout, parseOffset, renderModel, signedMm } from '../../../shared/cheque';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');

/** The server's Layout::model for a 178 × 82 mm leaf, offsets already in the positions. */
const MODEL = {
  page: { w_pt: 504.56, h_pt: 232.44, w_mm: 178, h_mm: 82 },
  offset_pt: { x: 3.4, y: -2.27 },
  rotation: 0,
  scale: 1,
  items: [
    { key: 'payee', text: 'Ceylon <Paper> Mills', x_pt: 72.28, y_pt: 74.55, w_pt: 317.48, h_pt: 19.84, font: 'Helvetica', size_pt: 11, align: 'left', letter_spacing_pt: 0 },
    { key: 'amount_words', lines: ['One Hundred and Twenty Five Thousand', 'Only'], x_pt: 52.73, y_pt: 106.58, w_pt: 348.66, h_pt: 34.02, font: 'Helvetica', size_pt: 10, align: 'left', letter_spacing_pt: 0 },
    { key: 'crossing', text: 'A/C PAYEE ONLY', lines_draw: true, x_pt: 10, y_pt: 10, w_pt: 80, h_pt: 20, font: 'Helvetica', size_pt: 8, align: 'center', letter_spacing_pt: 0 },
  ],
  zones: [{ kind: 'micr', x_pt: 0, y_pt: 187, w_pt: 504.56, h_pt: 45.35 }],
  problems: [] as string[],
};

function signedJob(over: { model?: unknown; device?: string; expires?: number; cheque?: number; tamper?: boolean } = {}) {
  const layout = over.model ?? MODEL;
  // As the server hashes it: PHP's canonical JSON with whole floats written 11.0 (everything but rotation is a float).
  const sha = sha256Text(canonicalPhp(layout, (p) => p[p.length - 1] === 'rotation'));
  const envelope = { job_id: 88214, attempt_id: '9f2c4e', cheque_id: over.cheque ?? 1217, leaf_id: 51, cheque_number: '001217', device_id: over.device ?? '42', org_id: 1, kind: 'cheque', printer: 'HP_M404', tray: null, expires: over.expires ?? 4_102_444_800, layout_sha256: sha };
  const signature = sign(null, Buffer.from(canonicalJson(envelope)), privateKey).toString('base64');
  return { job_id: 88214, attempt_id: '9f2c4e', lease_until: null, envelope: over.tamper ? { ...envelope, leaf_id: 52 } : envelope, signature, layout };
}

const PROFILE = { id: 5, device_id: '42', printer_name: 'HP_M404', tray: 'Manual feed', offset_x_mm: 1.2, offset_y_mm: -0.8, rotation: 0, version_ids: [9] };

function http(answers: Record<string, { status?: number; body: unknown }>) {
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
      const key = Object.keys(answers).find((k) => url.includes(k));
      const a = key ? answers[key]! : { body: { success: true, data: {} } };
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
    },
  };
}

const ok = (data: unknown) => ({ body: { success: true, message: 'OK', data } });
const base = (job: unknown = signedJob()) => ({
  '/cheque/stations/7/claim': ok({ jobs: [job] }),
  '/cheque/stations': ok({ station_id: 7, public_key: PUB }),
  '/cheque/printers': ok([PROFILE]),
  '/print-job': ok({ id: 88214, status: 'QUEUED', station_online: true }),
});

function station(h: ReturnType<typeof http>, result: ExactPrintResult = { ok: true }, device: string | null = '42') {
  const jobs: ExactPrintJob[] = [];
  const s = new ChequeStation({
    http: h as never,
    deviceId: () => device,
    host: () => 'FINANCE-PC-02',
    version: () => '0.2.279',
    printers: async () => [{ name: 'HP_M404', displayName: 'HP LaserJet Pro M404', isDefault: true }],
    print: async (j) => (jobs.push(j), result),
  });
  return { s, jobs };
}

const progress = (h: ReturnType<typeof http>) => h.calls.filter((c) => c.url.includes('/progress')).map((c) => (c.body as { state: string }).state);

describe('CorePrintService layout', () => {
  it('lays the server’s model out in mm at the exact page size, with no extra offset, text escaped', () => {
    const layout = modelToLayout(renderModel.parse(MODEL));
    const html = renderExactHtml({ layout, offset: { x_mm: 0, y_mm: 0 }, title: 't' });
    expect(html).toContain('@page{size:178mm 82mm;margin:0}');
    expect(html).toContain('left:25.499mm;top:26.3mm');
    expect(html).toContain('Ceylon &lt;Paper&gt; Mills');
    expect(html).toContain('One Hundred and Twenty Five Thousand<br>Only');
    expect(html).toContain('class="l"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('micr');
    expect(pageSizeMicrons(layout)).toEqual({ width: 178_000, height: 82_000 });
  });

  it('moves an offset the other way on a page turned 180°', () => {
    const layout = { width_mm: 178, height_mm: 82, boxes: [{ key: 'a', kind: 'text' as const, x_mm: 10, y_mm: 10, width_mm: 5, height_mm: 5, lines: ['x'], size_pt: 10, align: 'left' as const, letter_spacing_mm: 0 }] };
    const html = renderExactHtml({ layout, offset: { x_mm: 1, y_mm: 1 }, rotation: 180, title: 't' });
    expect(html).toContain('left:9mm;top:9mm');
    expect(html).toContain('rotate(180deg)');
  });

  it('draws the A4 calibration sheet from the server’s model', () => {
    const l = sheetLayout({
      page: { w_mm: 210, h_mm: 297, w_pt: 595.27, h_pt: 841.88 },
      leaf_origin_mm: { x: 17.2, y: 19.2 },
      leaf: { w_mm: 178, h_mm: 82 },
      boxes: [{ label: 'payee', x_mm: 41.5, y_mm: 46.3, w_mm: 112, h_mm: 7 }],
      zones: [{ kind: 'micr', x_mm: 17.2, y_mm: 85.2, w_mm: 178, h_mm: 16, hatched: true }],
      markers: [{ name: 'TL', x_mm: 0, y_mm: 0, sheet_x_mm: 17.2, sheet_y_mm: 19.2, crosshair_mm: 6 }],
      rulers: { x: { from_mm: 0, to_mm: 178, tick_mm: 10 }, y: { from_mm: 0, to_mm: 82, tick_mm: 10 } },
      scale: '100% — do not scale to fit',
    })!;
    expect(l).toMatchObject({ width_mm: 210, height_mm: 297 });
    expect(l.boxes.find((b) => b.key === 'leaf')).toMatchObject({ x_mm: 17.2, y_mm: 19.2, width_mm: 178, height_mm: 82 });
    expect(l.boxes.find((b) => b.key === 'payee')).toMatchObject({ kind: 'box', x_mm: 41.5, y_mm: 46.3, width_mm: 112 });
    expect(l.boxes.find((b) => b.kind === 'zone')).toMatchObject({ y_mm: 85.2, lines: ['MICR / clearing zone'] });
    expect(l.boxes.find((b) => b.kind === 'crosshair')).toMatchObject({ x_mm: 17.2, y_mm: 19.2, width_mm: 6 });
    expect(l.boxes.filter((b) => b.kind === 'ruler').map((b) => [b.width_mm, b.height_mm])).toEqual([[178, 0], [0, 82]]);
  });

  it('matches the server’s layout hash whether or not it kept whole floats as 11.0', () => {
    expect(layoutHashMatches(MODEL, sha256Text(canonicalPhp(MODEL, (p) => p[p.length - 1] === 'rotation')), 'cheque')).toBe(true);
    expect(layoutHashMatches(MODEL, sha256Text(canonicalJson(MODEL)), 'cheque')).toBe(true);
    expect(layoutHashMatches(MODEL, sha256Text(canonicalJson({ ...MODEL, rotation: 180 })), 'cheque')).toBe(false);
    expect(canonicalPhp({ b: 11, a: [1.5, 0], rotation: 0 }, (p) => p[p.length - 1] === 'rotation')).toBe('{"a":[1.5,0.0],"b":11.0,"rotation":0}');
  });
});

describe('cheque print station', () => {
  it('registers the station, asks for the job, claims it, verifies it, prints it silently on the profile’s printer, reports spooled — and consumes no leaf', async () => {
    const h = http(base());
    const { s, jobs } = station(h);
    const r = await s.printCheque({ cheque_id: 1217, profile_id: 5 }, null);
    expect(r).toMatchObject({ ok: true, job_id: 88214, cheque_id: 1217, spooled: true });
    expect(h.calls.find((c) => c.url.endsWith('/api/cheque/stations'))!.body).toMatchObject({ device_id: '42', name: 'FINANCE-PC-02', version: '0.2.279' });
    expect(h.calls.find((c) => c.url.includes('/print-job'))).toMatchObject({ url: 'https://ws.example/api/cheque/cheques/1217/print-job', body: { profile_id: 5, station_id: 7 } });
    expect(jobs[0]).toMatchObject({ deviceName: 'HP_M404', silent: true, offset: { x_mm: 0, y_mm: 0 }, rotation: 0, layout: { width_mm: 178, height_mm: 82 } });
    expect(progress(h)).toEqual(['printing', 'spooled', 'sent']);
    expect(h.calls.find((c) => c.url.includes('/progress'))!.body).toMatchObject({ attempt_id: '9f2c4e' });
    expect(h.calls.some((c) => c.url.includes('/confirm') || c.url.includes('/reconcile'))).toBe(false);
  });

  it('prints nothing when the server refuses the job, or for an unregistered computer', async () => {
    const h = http({ ...base(), '/print-job': { status: 422, body: { success: false, message: 'Amount in words exceeds template area', errors: { code: 'WORDS_OVERFLOW' } } } });
    const { s, jobs } = station(h);
    expect(await s.printCheque({ cheque_id: 1217, profile_id: 5 }, null)).toMatchObject({ ok: false, spooled: false, message: 'Amount in words exceeds template area' });
    const u = station(http(base()), { ok: true }, null);
    expect((await u.s.printCheque({ cheque_id: 1217, profile_id: 5 }, null)).ok).toBe(false);
    expect(jobs).toHaveLength(0);
    expect(u.jobs).toHaveLength(0);
  });

  it.each([
    ['a forged envelope', { tamper: true }, 'signature does not verify'],
    ['another computer’s job', { device: '9' }, 'another computer'],
    ['an expired job', { expires: 978_307_200 }, 'expired'],
    ['a model with problems', { model: { ...MODEL, problems: ['Amount in words exceeds template area'] } }, 'Amount in words exceeds template area'],
  ])('refuses %s and reports it failed', async (_n, over, reason) => {
    const h = http(base(signedJob(over)));
    const { s, jobs } = station(h);
    const r = await s.printCheque({ cheque_id: 1217, profile_id: 5 }, null);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(reason);
    expect(jobs).toHaveLength(0);
    expect(progress(h)).toEqual(['failed']);
  });

  it('refuses a layout changed after it was signed', async () => {
    const job = signedJob();
    const h = http(base({ ...job, layout: { ...MODEL, items: [{ ...MODEL.items[0], text: 'Someone Else' }] } }));
    const { s, jobs } = station(h);
    expect((await s.printCheque({ cheque_id: 1217, profile_id: 5 }, null)).message).toContain('not what was signed');
    expect(jobs).toHaveLength(0);
  });

  it('refuses a profile bound to another computer before asking for a job', async () => {
    const h = http({ ...base(), '/cheque/printers': ok([{ ...PROFILE, device_id: '9' }]) });
    const { s, jobs } = station(h);
    expect((await s.printCheque({ cheque_id: 1217, profile_id: 5 }, null)).ok).toBe(false);
    expect(h.calls.some((c) => c.url.includes('/print-job'))).toBe(false);
    expect(jobs).toHaveLength(0);
  });

  it('reports a printer failure as failed, the leaf still reserved', async () => {
    const h = http(base());
    const { s } = station(h, { ok: false, reason: 'paper jam' });
    const r = await s.printCheque({ cheque_id: 1217, profile_id: 5 }, null);
    expect(progress(h)).toEqual(['printing', 'failed']);
    expect(r).toMatchObject({ ok: false, spooled: false, message: 'Cheque 001217 was not printed: paper jam. The leaf stays reserved.' });
  });

  it('in a batch prints only the next leaf in the stack, and says when nothing is waiting yet', async () => {
    const h = http(base(signedJob({ cheque: 4930 })));
    const { s, jobs } = station(h);
    const r = await s.printQueued({ cheque_ids: [4929], profile_id: 5 }, null);
    expect(r).toMatchObject({ ok: false, none_waiting: true });
    expect(jobs).toHaveLength(0);
    expect(progress(h)).toEqual([]);
    const ok2 = await s.printQueued({ cheque_ids: [4930], profile_id: 5 }, null);
    expect(ok2).toMatchObject({ ok: true, cheque_id: 4930 });
  });

  it('prints the calibration sheet moved by the offsets being tried, relative to the saved ones', async () => {
    const h = http({ ...base(), '/calibration-sheet': ok({ page: { w_mm: 210, h_mm: 297 }, leaf_origin_mm: { x: 17.2, y: 19.2 }, leaf: { w_mm: 178, h_mm: 82 }, boxes: [{ label: 'payee', x_mm: 41.5, y_mm: 46.3, w_mm: 112, h_mm: 7 }], markers: [] }) });
    const { s, jobs } = station(h);
    const r = await s.printCalibration({ template_id: 3, version_id: 9, profile_id: 5, sheet: 'a4', offsets: { x_mm: 1.35, y_mm: -0.75 } }, null);
    expect(h.calls.find((c) => c.url.includes('/calibration-sheet'))!.url).toBe('https://ws.example/api/cheque/template-versions/9/calibration-sheet?profile_id=5');
    expect(jobs[0]!.offset.x_mm).toBeCloseTo(0.15);
    expect(jobs[0]!.offset.y_mm).toBeCloseTo(0.05);
    expect(r.ok).toBe(true);
  });
});

describe('offsets', () => {
  it('parses, clamps and shows offsets as the boards do', () => {
    expect(parseOffset('−0.75')).toBe(-0.75);
    expect(parseOffset('+1,35')).toBe(1.35);
    expect(parseOffset('abc')).toBeNull();
    expect(parseOffset('25')).toBeNull();
    expect(clampOffset(1.2 + 0.1)).toBe(1.3);
    expect(clampOffset(99)).toBe(10);
    expect(signedMm(-0.8)).toBe('−0.80');
    expect(signedMm(1.2)).toBe('+1.20');
  });
});
