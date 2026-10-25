import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  CHEQUE_API,
  claimedJob,
  modelToLayout,
  printerProfile,
  renderModel,
  versionGeometry,
  type ChequePrintOutcome,
  type ClaimedJob,
  type ExactLayout,
  type LayoutBox,
  type PrinterProfile,
  type StationInfo,
} from '@shared/cheque';
import type { IpcRouter } from '../ipc/router';
import type { HttpClient } from './http';
import { CorePrintService, canonicalPhp, ed25519Key, sha256Canonical, sha256Text, verifyCanonical, type ExactPrintJob, type ExactPrintResult } from './core-print';

/**
 * Cheque Manager's print station (Cheque SRS §3.9 CHQ-PRT-03..07/10/11, §3.4 CHQ-CAL-01..02, CHQ-PRN-01..02; boards
 * D02–D06; server docs/cheque-api.md §Printer profiles and print stations). The renderer names a cheque and a
 * printer profile; everything printed comes from the server and is checked here first:
 *
 *  1. This computer is registered as a print station for the signed-in person (`POST /stations`, idempotent per
 *     person + device), which answers with the station id and the server's Ed25519 public key.
 *  2. `POST /cheques/{id}/print-job {profile_id, station_id}` — the server runs the pre-print checks (approval hash,
 *     leaf, template ACTIVE, profile bound to this device, period open, words fit, print lock) and queues the job.
 *  3. `POST /stations/{id}/claim` — the job, its single-use attempt, the signed envelope and the render model.
 *     Nothing prints unless the signature verifies, the envelope is for this device and not expired, and the
 *     SHA-256 of the model is the one signed. A model with problems (words that do not fit) is refused.
 *  4. `progress sent` → printed silently at 100 % on the profile's printer — never another one — through
 *     CorePrintService → `progress spooled` or `failed`.
 *
 * The leaf is not consumed here. Only the person's answer (`print-jobs/{id}/confirm`, from D03) or a batch's
 * reconciliation (D06) makes it PRINTED or VOID: software never assumes the printer did what it was told
 * (CHQ-BAT-05). Jobs claimed here that are not the one asked for are left alone; their 60-second lease runs out and
 * the server puts them back in the queue.
 */
export interface ChequeStationDeps {
  http: Pick<HttpClient, 'raw' | 'url'>;
  deviceId: () => string | null;
  host: () => string;
  version: () => string;
  printers: (sender: WebContents | null) => Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>;
  print?: (job: ExactPrintJob) => Promise<ExactPrintResult>;
  now?: () => number;
}

type Envelope = { success?: boolean; status?: string; message?: string; data?: unknown; errors?: { code?: string } };
type Sent = { ok: boolean; status: number; env: Envelope };
type Station = { key: string; station_id: number; public_key: string };

const fail = (message: string, job_id: number | null = null, cheque_id: number | null = null): ChequePrintOutcome => ({ ok: false, job_id, cheque_id, spooled: false, message });

export class ChequeStation {
  private registered: Station | null = null;

  constructor(private readonly d: ChequeStationDeps) {}

  private async send(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string | number>): Promise<Sent> {
    const res = await this.d.http.raw(method, this.d.http.url(path, query), {
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const env = ((await res.json().catch(() => null)) ?? {}) as Envelope;
    return { ok: res.ok && env.success !== false && env.status !== 'error', status: res.status, env };
  }

  /** Register (or find) this computer's print station. Re-asked when the device or the server changed. */
  private async ensureStation(force = false): Promise<Station | null> {
    const device = this.d.deviceId();
    if (!device) return null;
    const key = `${this.d.http.url('/')}|${device}`;
    if (!force && this.registered?.key === key) return this.registered;
    const r = await this.send('POST', `${CHEQUE_API}/stations`, { device_id: device, name: this.d.host(), platform: process.platform, version: this.d.version() });
    const data = r.env.data as { station_id?: unknown; id?: unknown; public_key?: unknown } | undefined;
    const sid = Number(data?.station_id ?? data?.id);
    if (!r.ok || !Number.isInteger(sid) || sid <= 0) return null;
    let pub = typeof data?.public_key === 'string' ? data.public_key : '';
    if (!pub) {
      const k = await this.send('GET', `${CHEQUE_API}/stations/key`);
      pub = String((k.env.data as { public_key?: unknown } | undefined)?.public_key ?? '');
    }
    this.registered = { key, station_id: sid, public_key: pub };
    return this.registered;
  }

  async station(sender: WebContents | null): Promise<StationInfo> {
    const printers = await this.d.printers(sender).catch(() => []);
    const s = await this.ensureStation(true).catch(() => null);
    // The heartbeat says this station is online with these printers (CHQ-PRT-11: the web's jobs wait for it).
    if (s) await this.send('POST', `${CHEQUE_API}/stations/${s.station_id}/heartbeat`, { printers: printers.map((p) => ({ name: p.name, status: 'ready' })) }).catch(() => undefined);
    return { device_id: this.d.deviceId(), station_id: s?.station_id ?? null, host: this.d.host(), printers };
  }

  forget(): void {
    this.registered = null;
  }

  private async progress(jobId: number, attemptId: number | string, state: 'printing' | 'spooled' | 'sent' | 'failed', message?: string): Promise<boolean> {
    try {
      return (await this.send('POST', `${CHEQUE_API}/print-jobs/${jobId}/progress`, { attempt_id: attemptId, state, ...(message ? { message: message.slice(0, 250) } : {}) })).ok;
    } catch {
      return false;
    }
  }

  private core(sender: WebContents | null): CorePrintService {
    return new CorePrintService({ printers: async () => (await this.d.printers(sender)).map((p) => p.name), print: this.d.print });
  }

  /**
   * Whether a claimed job may be printed here: the signature over the envelope exactly as sent (`raw`), the job and
   * attempt, the device, the expiry and the layout's hash; then the model itself must read and have no problems.
   */
  check(job: ClaimedJob, raw: unknown, publicKey: string): { ok: true; layout: ExactLayout; rotation: 0 | 180 } | { ok: false; reason: string } {
    const key = ed25519Key(publicKey);
    if (!key) return { ok: false, reason: 'WorkSuite has not given this computer its signing key.' };
    if (!verifyCanonical(raw, job.signature, key)) return { ok: false, reason: 'The print job’s signature does not verify.' };
    const e = job.envelope;
    if (e.job_id !== job.job_id || String(e.attempt_id) !== String(job.attempt_id)) return { ok: false, reason: 'The envelope is for another job.' };
    if (String(e.device_id) !== this.d.deviceId()) return { ok: false, reason: 'The print job is for another computer.' };
    const exp = typeof e.expires === 'number' ? e.expires * (e.expires < 1e12 ? 1000 : 1) : Date.parse(e.expires);
    if (!Number.isFinite(exp) || exp <= (this.d.now ?? Date.now)()) return { ok: false, reason: 'The print job’s signature has expired.' };
    if (!layoutHashMatches(job.layout, e.layout_sha256, e.kind)) return { ok: false, reason: 'The layout is not what was signed.' };
    if (e.kind === 'test') {
      const sheet = sheetLayout(job.layout);
      return sheet ? { ok: true, layout: sheet, rotation: 0 } : { ok: false, reason: 'The test sheet could not be read.' };
    }
    const model = renderModel.safeParse(job.layout);
    if (!model.success) return { ok: false, reason: 'The layout could not be read.' };
    if (model.data.problems.length) return { ok: false, reason: model.data.problems.join('; ') };
    return { ok: true, layout: modelToLayout(model.data), rotation: model.data.rotation };
  }

  private async profile(profileId: number): Promise<PrinterProfile | null> {
    const r = await this.send('GET', `${CHEQUE_API}/printers`);
    const list = Array.isArray(r.env.data) ? r.env.data : ((r.env.data as { items?: unknown[] } | undefined)?.items ?? []);
    const raw = list.find((p) => (p as { id?: unknown }).id === profileId);
    const p = printerProfile.safeParse(raw);
    return p.success ? p.data : null;
  }

  /** Claim this station's queued jobs and print the first that is for one of these cheques. */
  private async claimAndPrint(chequeIds: number[], printer: string, sender: WebContents | null, wantJob: number | null): Promise<ChequePrintOutcome> {
    const s = await this.ensureStation();
    if (!s) return fail('This computer is not registered as a cheque print station.');
    // A batch's next leaf is the first queued job for this device (the server orders them by position): claim one.
    const r = await this.send('POST', `${CHEQUE_API}/stations/${s.station_id}/claim`, { max: wantJob ? 5 : 1 });
    if (!r.ok) return fail(r.env.message ?? 'WorkSuite did not hand over the print job.');
    const raws = (r.env.data as { jobs?: unknown[] } | undefined)?.jobs ?? [];
    const jobs = raws.map((j) => ({ raw: (j as { envelope?: unknown } | null)?.envelope, parsed: claimedJob.safeParse(j) }));
    const mine = jobs.find((j) => j.parsed.success && (wantJob ? j.parsed.data.job_id === wantJob : chequeIds.includes(j.parsed.data.envelope.cheque_id)));
    if (!mine || !mine.parsed.success) return { ...fail(jobs.length ? 'WorkSuite handed over a job, but not for this cheque. Nothing was printed.' : 'There was no print job waiting for this computer. Nothing was printed.'), none_waiting: true };
    const job = mine.parsed.data;
    const cheque = job.envelope.cheque_id;
    if (!chequeIds.includes(cheque)) {
      await this.progress(job.job_id, job.attempt_id, 'failed', 'Claimed for another cheque.');
      return fail('The print job is for a different cheque. Nothing was printed.', job.job_id, cheque);
    }
    if (job.envelope.printer && job.envelope.printer !== printer) {
      await this.progress(job.job_id, job.attempt_id, 'failed', 'Signed for another printer.');
      return fail(`The job is for ${job.envelope.printer}, not ${printer}. Nothing was printed.`, job.job_id, cheque);
    }
    const ok = this.check(job, mine.raw, s.public_key);
    if (!ok.ok) {
      await this.progress(job.job_id, job.attempt_id, 'failed', ok.reason);
      return fail(`${ok.reason} Nothing was printed.`, job.job_id, cheque);
    }
    await this.progress(job.job_id, job.attempt_id, 'printing');
    const out = await this.core(sender)
      .printExact({ layout: ok.layout, deviceName: printer, offset: { x_mm: 0, y_mm: 0 }, rotation: ok.rotation, silent: true, title: job.envelope.kind === 'test' ? 'Test alignment' : `Cheque ${job.envelope.cheque_number ?? ''}` })
      .catch((e: unknown): ExactPrintResult => ({ ok: false, reason: e instanceof Error ? e.message : 'the printer failed' }));
    if (!out.ok) {
      await this.progress(job.job_id, job.attempt_id, 'failed', out.reason);
      return fail(`Cheque ${job.envelope.cheque_number} was not printed: ${out.reason}. The leaf stays reserved.`, job.job_id, cheque);
    }
    // Spooled, then sent: the job now waits for the person to say what came out (AWAITING_CONFIRMATION).
    const told = (await this.progress(job.job_id, job.attempt_id, 'spooled')) && (await this.progress(job.job_id, job.attempt_id, 'sent'));
    return {
      ok: true,
      job_id: job.job_id,
      cheque_id: cheque,
      spooled: true,
      message: told ? `Cheque ${job.envelope.cheque_number} sent to ${printer}. Check the leaf, then confirm.` : `Cheque ${job.envelope.cheque_number} sent to ${printer}, but WorkSuite was not told yet. Check the leaf, then confirm.`,
    };
  }

  /** D03: one cheque on its leaf. */
  async printCheque(input: { cheque_id: number; profile_id: number; test_alignment?: boolean }, sender: WebContents | null): Promise<ChequePrintOutcome> {
    if (!this.d.deviceId()) return fail('This computer is not registered with WorkSuite yet, so it cannot print cheques (CHQ-PRN-02).');
    try {
      const s = await this.ensureStation();
      if (!s) return fail('This computer could not be registered as a cheque print station.');
      const profile = await this.profile(input.profile_id);
      if (!profile) return fail('That printer profile is not available to you.');
      if (profile.device_id != null && String(profile.device_id) !== this.d.deviceId()) return fail('That printer profile belongs to another computer. Nothing was printed.');
      const r = await this.send('POST', `${CHEQUE_API}/cheques/${input.cheque_id}/print-job`, { profile_id: input.profile_id, station_id: s.station_id, ...(input.test_alignment ? { test_alignment: true } : {}) });
      if (!r.ok) return fail(r.env.message ?? 'WorkSuite refused the print. Nothing was printed.');
      const jobId = Number((r.env.data as { id?: unknown; job_id?: unknown } | undefined)?.id ?? (r.env.data as { job_id?: unknown } | undefined)?.job_id);
      return await this.claimAndPrint([input.cheque_id], profile.printer_name, sender, Number.isInteger(jobId) && jobId > 0 ? jobId : null);
    } catch {
      return fail('WorkSuite could not be reached. Nothing was printed.');
    }
  }

  /** D05: the next job the server queued for this station in a batch's run, on the batch's profile printer. */
  async printQueued(input: { cheque_ids: number[]; profile_id: number }, sender: WebContents | null): Promise<ChequePrintOutcome> {
    if (!this.d.deviceId()) return fail('This computer is not registered with WorkSuite yet, so it cannot print cheques.');
    try {
      const profile = await this.profile(input.profile_id);
      if (!profile) return fail('That printer profile is not available to you.');
      if (profile.device_id != null && String(profile.device_id) !== this.d.deviceId()) return fail('That printer profile belongs to another computer. Nothing was printed.');
      return await this.claimAndPrint(input.cheque_ids, profile.printer_name, sender, null);
    } catch {
      return fail('WorkSuite could not be reached. Nothing was printed.');
    }
  }

  /**
   * D04: the A4 calibration sheet (the server's model, `GET template-versions/{id}/calibration-sheet`) or the
   * version's field boxes and corner markers on a voided leaf, moved by the offsets being tried. Prints no cheque.
   */
  async printCalibration(
    input: { template_id: number; version_id: number; profile_id: number; sheet: 'a4' | 'leaf'; offsets?: { x_mm: number; y_mm: number } },
    sender: WebContents | null,
  ): Promise<ChequePrintOutcome> {
    if (!this.d.deviceId()) return fail('This computer is not registered with WorkSuite yet.');
    try {
      const profile = await this.profile(input.profile_id);
      if (!profile) return fail('That printer profile is not available to you.');
      if (profile.device_id != null && String(profile.device_id) !== this.d.deviceId()) return fail('That printer profile belongs to another computer.');
      // The model carries the saved offsets; only the difference being tried is added here.
      const delta = input.offsets ? { x_mm: input.offsets.x_mm - profile.offset_x_mm, y_mm: input.offsets.y_mm - profile.offset_y_mm } : { x_mm: 0, y_mm: 0 };
      let layout: ExactLayout | null;
      if (input.sheet === 'a4') {
        const r = await this.send('GET', `${CHEQUE_API}/template-versions/${input.version_id}/calibration-sheet`, undefined, { profile_id: input.profile_id });
        if (!r.ok) return fail(r.env.message ?? 'WorkSuite did not send the calibration sheet.');
        layout = sheetLayout(r.env.data);
      } else {
        const r = await this.send('GET', `${CHEQUE_API}/templates/${input.template_id}`);
        if (!r.ok) return fail(r.env.message ?? 'WorkSuite did not send the template.');
        const versions = ((r.env.data as { versions?: unknown[] } | undefined)?.versions ?? []) as Array<{ id?: unknown }>;
        const v = versionGeometry.safeParse(versions.find((x) => x.id === input.version_id));
        layout = v.success ? testLeafLayout(v.data, profile) : null;
      }
      if (!layout) return fail('The calibration sheet WorkSuite sent could not be read.');
      const out = await this.core(sender)
        .printExact({ layout, deviceName: profile.printer_name, offset: delta, rotation: profile.rotation === 180 ? 180 : 0, silent: true, title: input.sheet === 'a4' ? 'Calibration sheet' : 'Test print' })
        .catch((e: unknown): ExactPrintResult => ({ ok: false, reason: e instanceof Error ? e.message : 'the printer failed' }));
      return out.ok
        ? { ok: true, job_id: null, cheque_id: null, spooled: true, message: input.sheet === 'a4' ? `Calibration sheet sent to ${profile.printer_name}.` : `Test print sent to ${profile.printer_name}. Use a voided leaf.` }
        : fail(`Not printed: ${out.reason}.`);
    } catch {
      return fail('WorkSuite could not be reached.');
    }
  }

  register(router: IpcRouter): void {
    router.handle('cheque:station', (_i, c) => this.station(c.sender));
    router.handle('cheque:print', (input, c) => this.printCheque(input, c.sender));
    router.handle('cheque:printQueued', (input, c) => this.printQueued(input, c.sender));
    router.handle('cheque:printCalibration', (input, c) => this.printCalibration(input, c.sender));
  }
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const label = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v.slice(0, 40) : fallback).replace(/[^A-Za-z0-9_.: -]/g, '');

/**
 * The server's A4 sheet model (`Templates::calibrationSheet`: `{page, leaf_origin_mm, leaf, boxes[], zones[],
 * markers[], rulers}`, positions already on the sheet with the profile's offsets) as an exact page: the leaf
 * boundary, every field box with its name, the protected zones hatched, the crosshair markers and a 10 mm ruler
 * along each edge of the leaf (CHQ-CAL-02).
 */
export function sheetLayout(data: unknown): ExactLayout | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const page = (d.page ?? {}) as Record<string, unknown>;
  const o = (d.leaf_origin_mm ?? {}) as Record<string, unknown>;
  const ox = num(o.x ?? o.x_mm);
  const oy = num(o.y ?? o.y_mm);
  const leaf = (d.leaf ?? {}) as Record<string, unknown>;
  const rect = (r: Record<string, unknown>) => ({ x_mm: num(r.x_mm ?? r.x), y_mm: num(r.y_mm ?? r.y), width_mm: num(r.width_mm ?? r.w_mm ?? r.w), height_mm: num(r.height_mm ?? r.h_mm ?? r.h) });
  const boxes: LayoutBox[] = [];
  const base = { lines: [] as string[], size_pt: 6, align: 'left' as const, letter_spacing_mm: 0 };
  const lw = num(leaf.width_mm ?? leaf.w_mm);
  const lh = num(leaf.height_mm ?? leaf.h_mm);
  if (lw > 0 && lh > 0) boxes.push({ ...base, key: 'leaf', kind: 'box', x_mm: ox, y_mm: oy, width_mm: lw, height_mm: lh, lines: ['leaf'] });
  for (const b of (Array.isArray(d.boxes) ? d.boxes : []) as Array<Record<string, unknown>>) {
    const name = label(b.label ?? b.key ?? b.name, 'field') || 'field';
    boxes.push({ ...base, key: name, kind: 'box', ...rect(b), lines: [name] });
  }
  for (const z of (Array.isArray(d.zones) ? d.zones : []) as Array<Record<string, unknown>>) {
    const name = label(z.kind ?? z.label, 'zone') || 'zone';
    boxes.push({ ...base, key: name, kind: 'zone', ...rect(z), lines: [name === 'micr' ? 'MICR / clearing zone' : name] });
  }
  for (const m of (Array.isArray(d.markers) ? d.markers : []) as Array<Record<string, unknown>>) {
    const size = num(m.crosshair_mm, 6);
    boxes.push({ ...base, key: label(m.name, 'marker') || 'marker', kind: 'crosshair', x_mm: m.sheet_x_mm != null ? num(m.sheet_x_mm) : ox + num(m.x_mm), y_mm: m.sheet_y_mm != null ? num(m.sheet_y_mm) : oy + num(m.y_mm), width_mm: size, height_mm: size });
  }
  const rulers = (d.rulers ?? {}) as Record<string, Record<string, unknown> | undefined>;
  if (rulers.x) boxes.push({ ...base, key: 'ruler-x', kind: 'ruler', x_mm: ox + num(rulers.x.from_mm), y_mm: Math.max(0, oy - 7), width_mm: num(rulers.x.to_mm, lw) - num(rulers.x.from_mm), height_mm: 0 });
  if (rulers.y) boxes.push({ ...base, key: 'ruler-y', kind: 'ruler', x_mm: Math.max(0, ox - 7), y_mm: oy + num(rulers.y.from_mm), width_mm: 0, height_mm: num(rulers.y.to_mm, lh) - num(rulers.y.from_mm) });
  return boxes.length > 0 ? { width_mm: num(page.w_mm, 210), height_mm: num(page.h_mm, 297), boxes } : null;
}

/** A test on a voided leaf: every field box with its name, the protected zones and a marker at each corner. */
export function testLeafLayout(v: { width_mm: number; height_mm: number; fields: Array<{ key: string; x_mm: number; y_mm: number; width_mm: number; height_mm: number }>; zones: Array<{ kind: string; x_mm: number; y_mm: number; width_mm: number; height_mm: number }> }, profile: PrinterProfile): ExactLayout {
  const base = { size_pt: 7, align: 'left' as const, letter_spacing_mm: 0 };
  const ox = profile.offset_x_mm;
  const oy = profile.offset_y_mm;
  const boxes: LayoutBox[] = [
    ...v.fields.map((f) => ({ ...base, key: label(f.key, 'field') || 'field', kind: 'box' as const, x_mm: f.x_mm + ox, y_mm: f.y_mm + oy, width_mm: f.width_mm, height_mm: f.height_mm, lines: [`${label(f.key, 'field')} · TEST · VOID`] })),
    ...v.zones.map((z) => ({ ...base, key: label(z.kind, 'zone') || 'zone', kind: 'zone' as const, x_mm: z.x_mm + ox, y_mm: z.y_mm + oy, width_mm: z.width_mm, height_mm: z.height_mm, lines: [label(z.kind, 'zone')] })),
    ...[
      [5, 5],
      [v.width_mm - 5, 5],
      [5, v.height_mm - 5],
      [v.width_mm - 5, v.height_mm - 5],
    ].map(([x, y], i) => ({ ...base, key: `corner-${i + 1}`, kind: 'crosshair' as const, x_mm: x! + ox, y_mm: y! + oy, width_mm: 6, height_mm: 6, lines: [] })),
  ];
  return { width_mm: v.width_mm, height_mm: v.height_mm, boxes };
}

/**
 * Does the layout hash to what the envelope signed? The server hashes PHP's canonical JSON, which writes a whole
 * float as `11.0`; the wire copy has lost that, so the PHP form is rebuilt from what the server's models hold:
 * in a cheque's render model every number is a float but `rotation`; in the A4 sheet the page size, the corner
 * markers' zero coordinates, the crosshair size and the ruler's start and tick are integers. Plain canonical JSON
 * is tried too, for a server that hashes without the zero fraction.
 */
export function layoutHashMatches(layout: unknown, sha: string, kind: 'cheque' | 'test'): boolean {
  const want = sha.toLowerCase();
  if (sha256Canonical(layout) === want) return true;
  const ints = kind === 'test'
    ? (p: readonly string[], v: number) => {
        const k = p[p.length - 1] ?? '';
        if (p[0] === 'page' && (k === 'w_mm' || k === 'h_mm')) return true;
        if (k === 'crosshair_mm' || k === 'tick_mm' || k === 'from_mm') return true;
        return p[0] === 'markers' && (k === 'x_mm' || k === 'y_mm') && v === 0;
      }
    : (p: readonly string[]) => p[p.length - 1] === 'rotation';
  try {
    return sha256Text(canonicalPhp(layout, ints)) === want;
  } catch {
    return false;
  }
}
