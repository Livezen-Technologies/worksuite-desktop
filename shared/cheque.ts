import { z } from 'zod';

/**
 * WorkSuite Cheque Manager on this computer (Cheque SRS v1.0 §3.4 CHQ-CAL/PRN, §3.9 CHQ-PRT, §3.10 CHQ-BAT; the
 * desktop boards D01–D06; server `docs/cheque-api.md`): the certified print station.
 *
 * WorkSuite Desktop is the only client that prints cheques (§2.2). What is printed is never something a page hands
 * over: the main process registers this computer as a print station (`POST /stations`), claims the job from the
 * server itself (`POST /stations/{id}/claim`), verifies the Ed25519-signed envelope (its device, expiry, attempt
 * and the SHA-256 of the layout), and prints the server's render model silently at 100 % at the leaf's exact size
 * through CorePrintService (electron/services/core-print.ts). The printer profile's offsets, scale and rotation
 * are already in the model (the server's `Layout::model`, the same model the web preview draws). Then it reports
 * `sent`, `spooled` or `failed` (`POST print-jobs/{id}/progress`).
 *
 * Nothing here consumes a leaf: a leaf becomes PRINTED only when the person confirms (`print-jobs/{id}/confirm`),
 * and a batch's leaves only through its reconciliation (`batches/{id}/reconcile`).
 *
 * Plain data and zod schemas shared by the main process, the IPC contract and the Cheque Manager screens.
 */

export const CHEQUE_API = '/api/cheque';

/** C3: 1 mm = 2.8346 pt (the server's constant, so a round trip lands where it left). */
export const PT_PER_MM = 2.8346;
/** The furthest a calibration offset may move anything (mm). More than this is a wrong profile, not a printer. */
export const MAX_OFFSET_MM = 10;
/** A calibration residual at or under this passes (D04; the server's Calibration::TARGET_MM). */
export const RESIDUAL_TARGET_MM = 0.5;

const mm = (lo: number, hi: number) => z.number().finite().min(lo).max(hi);
const pt = z.number().finite().min(-50).max(1200);

/** One box on a page, in millimetres from the page's top-left corner — what CorePrintService draws. */
export const layoutBox = z.object({
  key: z.string().regex(/^[a-z0-9_.: -]{1,48}$/i),
  kind: z.enum(['text', 'box', 'zone', 'crosshair', 'ruler', 'rules']).default('text'),
  x_mm: mm(-5, 420),
  y_mm: mm(-5, 420),
  width_mm: mm(0, 420),
  height_mm: mm(0, 420),
  /** One line, or several (the server already wrapped the amount in words). */
  lines: z.array(z.string().max(400)).max(6).default([]),
  /** A font family name; only plain names, nothing that could be CSS. */
  font: z.string().regex(/^[A-Za-z0-9 -]{1,40}$/).optional(),
  size_pt: z.number().min(4).max(48).default(10),
  align: z.enum(['left', 'center', 'right']).default('left'),
  letter_spacing_mm: mm(0, 20).default(0),
});
export type LayoutBox = z.infer<typeof layoutBox>;

/** A page to print at an exact size: the leaf (e.g. 178 × 82 mm) or the A4 calibration sheet. */
export const exactLayout = z.object({
  width_mm: mm(50, 300),
  height_mm: mm(30, 420),
  boxes: z.array(layoutBox).max(200),
});
export type ExactLayout = z.infer<typeof exactLayout>;

/** The server's render model (`Layout::model`, docs/cheque-api.md): points, offsets and scale already applied. */
export const renderModel = z.object({
  page: z.object({ w_pt: pt, h_pt: pt, w_mm: z.number().optional(), h_mm: z.number().optional() }),
  offset_pt: z.object({ x: z.number(), y: z.number() }).optional(),
  rotation: z.union([z.literal(0), z.literal(180)]).default(0),
  scale: z.number().optional(),
  items: z
    .array(
      z.object({
        key: z.string().max(48),
        text: z.string().max(400).optional(),
        lines: z.array(z.string().max(400)).max(6).optional(),
        x_pt: pt,
        y_pt: pt,
        w_pt: pt,
        h_pt: pt,
        font: z.string().max(40).optional(),
        size_pt: z.number().min(4).max(48),
        align: z.enum(['left', 'center', 'right']).default('left'),
        letter_spacing_pt: z.number().min(0).max(60).default(0),
        lines_draw: z.boolean().optional(),
      }),
    )
    .max(60),
  /** Anything the server found that blocks printing ("Amount in words exceeds template area"). */
  problems: z.array(z.string()).default([]),
});
export type RenderModel = z.infer<typeof renderModel>;

const toMm = (v: number) => Math.round((v / PT_PER_MM) * 1000) / 1000;
const plainFont = (f: string | undefined) => (f && /^[A-Za-z0-9 -]{1,40}$/.test(f) ? f : undefined);

/**
 * The render model as an exact page in mm. The model's offsets are already in its positions, so nothing is added
 * here. A crossing (`lines_draw`) is its text between two rules, as the web preview draws it.
 */
export function modelToLayout(m: RenderModel): ExactLayout {
  const boxes: LayoutBox[] = [];
  for (const it of m.items) {
    const base = { key: it.key, x_mm: toMm(it.x_pt), y_mm: toMm(it.y_pt), width_mm: toMm(it.w_pt), height_mm: toMm(it.h_pt) };
    if (it.lines_draw) boxes.push({ ...base, kind: 'rules', lines: [], size_pt: it.size_pt, align: 'left', letter_spacing_mm: 0 });
    boxes.push({ ...base, kind: 'text', lines: it.lines ?? [it.text ?? ''], font: plainFont(it.font === 'Helvetica' ? undefined : it.font), size_pt: it.size_pt, align: it.align, letter_spacing_mm: toMm(it.letter_spacing_pt) });
  }
  return { width_mm: m.page.w_mm ?? toMm(m.page.w_pt), height_mm: m.page.h_mm ?? toMm(m.page.h_pt), boxes };
}

/**
 * The signed envelope a claimed job carries (docs/cheque-api.md §Print stations; the server's `Printing::claim`).
 * Unknown keys are kept: the signature covers the envelope exactly as the server sent it.
 */
export const jobEnvelope = z
  .object({
    job_id: z.number().int().positive(),
    attempt_id: z.union([z.number(), z.string()]),
    cheque_id: z.number().int().positive(),
    /** Null for a test-alignment job, which has no leaf. */
    leaf_id: z.number().int().positive().nullable(),
    cheque_number: z.string().max(32).nullable(),
    device_id: z.union([z.string(), z.number()]),
    org_id: z.number().int(),
    kind: z.enum(['cheque', 'test']).default('cheque'),
    printer: z.string().max(200).nullable().optional(),
    /** Unix seconds, or an ISO date. */
    expires: z.union([z.string(), z.number()]),
    layout_sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  })
  .passthrough();
export type JobEnvelope = z.infer<typeof jobEnvelope>;

export const claimedJob = z.object({
  job_id: z.number().int().positive(),
  attempt_id: z.union([z.number(), z.string()]),
  lease_until: z.string().nullable().optional(),
  envelope: jobEnvelope,
  signature: z.string().min(16).max(400),
  layout: z.unknown(),
  /** The exact canonical string the server hashed into `layout_sha256` (newer servers). */
  layout_canonical: z.string().max(2_000_000).optional(),
});
export type ClaimedJob = z.infer<typeof claimedJob>;

/** A printer profile (CHQ-PRN-01), bound to one Desktop device (CHQ-PRN-02, BR-11). */
export const printerProfile = z.object({
  id: z.number().int().positive(),
  device_id: z.union([z.string(), z.number()]).nullable().optional(),
  station_id: z.number().nullable().optional(),
  printer_name: z.string().min(1).max(200),
  tray: z.string().max(60).nullable().optional(),
  offset_x_mm: z.coerce.number().finite().min(-MAX_OFFSET_MM).max(MAX_OFFSET_MM),
  offset_y_mm: z.coerce.number().finite().min(-MAX_OFFSET_MM).max(MAX_OFFSET_MM),
  scale_pct: z.coerce.number().nullable().optional(),
  rotation: z.coerce.number().nullable().optional(),
});
export type PrinterProfile = z.infer<typeof printerProfile>;

/** A template version's geometry (`GET /templates/{id}` → versions[]). */
export const versionGeometry = z.object({
  id: z.number().int().positive(),
  width_mm: z.coerce.number().min(50).max(300),
  height_mm: z.coerce.number().min(30).max(300),
  fields: z.array(z.object({ key: z.string().max(48), x_mm: z.coerce.number(), y_mm: z.coerce.number(), width_mm: z.coerce.number(), height_mm: z.coerce.number() })).max(60).default([]),
  zones: z.array(z.object({ kind: z.string().max(24), x_mm: z.coerce.number(), y_mm: z.coerce.number(), width_mm: z.coerce.number(), height_mm: z.coerce.number() })).max(30).default([]),
});
export type VersionGeometry = z.infer<typeof versionGeometry>;

export interface StationInfo {
  /** This computer's Desktop device id (CHQ-PRN-02); null until the computer is registered. */
  device_id: string | null;
  /** The server's print-station id for this computer and person, once registered (`POST /stations`). */
  station_id: number | null;
  host: string;
  printers: Array<{ name: string; displayName: string; isDefault: boolean }>;
}

export interface ChequePrintOutcome {
  ok: boolean;
  /** The server's print job, when one was claimed. */
  job_id: number | null;
  cheque_id: number | null;
  /** Spooled to the printer: the person now checks the leaf and confirms. */
  spooled: boolean;
  /** Nothing was printed because no job for these cheques was waiting yet (a batch's next leaf is queued in turn). */
  none_waiting?: boolean;
  message: string;
}

/** Rounded to 0.05 mm, kept inside ±MAX_OFFSET_MM. */
export function clampOffset(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 20) / 20;
  return Math.max(-MAX_OFFSET_MM, Math.min(MAX_OFFSET_MM, r));
}

/** "+1.20" / "−0.75" (a real minus sign), as the boards show offsets. */
export function signedMm(v: number): string {
  const s = Math.abs(v).toFixed(2);
  return v < 0 ? `−${s}` : `+${s}`;
}

/** An offset or measurement as typed: "+1.35", "-0.75", "−0.75", "1,2". Null when it is not a number in range. */
export function parseOffset(raw: string, max = MAX_OFFSET_MM): number | null {
  const t = raw.trim().replace('−', '-').replace(',', '.');
  if (!/^[+-]?\d{0,3}(\.\d{0,3})?$/.test(t) || !/\d/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

// ── the IPC contract ─────────────────────────────────────────────────────

const none = z.undefined().or(z.null()).optional();
const id = z.number().int().positive();
const offsets = z.strictObject({ x_mm: mm(-MAX_OFFSET_MM, MAX_OFFSET_MM), y_mm: mm(-MAX_OFFSET_MM, MAX_OFFSET_MM) });

/** D03: ask for the job (`POST cheques/{id}/print-job` for this station), claim it, verify it, print it. */
export const chequePrintInput = z.strictObject({ cheque_id: id, profile_id: id, test_alignment: z.boolean().optional() });
/** D05: print the next job the server queued for this station, if it is one of these cheques (a batch's run). */
export const chequePrintQueuedInput = z.strictObject({ cheque_ids: z.array(id).min(1).max(500), profile_id: id });
export const chequeCalibrationInput = z.strictObject({
  template_id: id,
  version_id: id,
  profile_id: id,
  /** The A4 sheet (CHQ-CAL-02) or the field boxes and markers on a voided leaf (CHQ-CAL-01, CHQ-PRN-04). */
  sheet: z.enum(['a4', 'leaf']),
  /** Offsets being tried in D04 before they are saved to the profile; the profile's own when absent. */
  offsets: offsets.optional(),
});

export const chequeContract = {
  'cheque:station': { input: none, session: true },
  'cheque:print': { input: chequePrintInput, session: true, sensitive: true, rate: 4 },
  'cheque:printQueued': { input: chequePrintQueuedInput, session: true, sensitive: true, rate: 30 },
  'cheque:printCalibration': { input: chequeCalibrationInput, session: true, rate: 3 },
};

export interface ChequeOutputs {
  'cheque:station': StationInfo;
  'cheque:print': ChequePrintOutcome;
  'cheque:printQueued': ChequePrintOutcome;
  'cheque:printCalibration': ChequePrintOutcome;
}
