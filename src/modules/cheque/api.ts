import { apiGet, apiPatch, apiPost } from '../../core/api';
import { call } from '../../core/bridge';
import { CHEQUE_API } from '@shared/cheque';

/**
 * Cheque Manager on the desktop (Cheque SRS v1.0, boards D01–D06) over the server's `/api/cheque` exactly as server
 * docs/cheque-api.md describes it. This computer is the certified print station.
 *
 * THE SERVER IS AUTHORITATIVE. It runs the pre-print checks, owns every leaf's state, fits the amount in words and
 * decides what a spoiled leaf means for approval (BR-05). Nothing here moves a leaf: printing goes through the main
 * process (`cheque:print`, `cheque:printQueued`), and a leaf changes state only by the person's confirmation
 * (`print-jobs/{id}/confirm`) or a batch's reconciliation (`batches/{id}/reconcile`). The normalisers below only
 * read what the server sent into one shape for the screens; they add nothing up.
 */

export type PrintResult = 'printed' | 'failed_unused' | 'spoiled';
export type LeafFound = 'printed' | 'spoiled' | 'blank';

const A = CHEQUE_API;
type Row = Record<string, unknown>;
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const list = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : Array.isArray((v as Row | null)?.items) ? ((v as Row).items as Row[]) : Array.isArray((v as Row | null)?.data) ? ((v as Row).data as Row[]) : []);
const count = (v: unknown) => (typeof v === 'number' ? v : int((v as Row | null)?.count) ?? 0);

/** A display amount from integer minor units, by string (no floating point): 12545075 → "125450.75". */
export function fromMinor(minor: unknown, decimals = 2): string | null {
  const s = str(minor).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const neg = s.startsWith('-');
  const d = (neg ? s.slice(1) : s).padStart(decimals + 1, '0');
  return `${neg ? '-' : ''}${decimals ? `${d.slice(0, -decimals)}.${d.slice(-decimals)}` : d}`;
}
const amountOf = (r: Row) => str(r.amount) || fromMinor(r.amount_minor) || '';

// ── access ───────────────────────────────────────────────────────────────

export interface Access {
  permissions: string[];
}

/** `GET /me`: the caller's permissions per company, flattened (a slug held in any company counts here; the server checks the company). */
export function toAccess(d: unknown): Access {
  const r = (d ?? {}) as Row;
  const p = r.permissions;
  const out = new Set<string>();
  const add = (v: unknown) => Array.isArray(v) && v.forEach((x) => typeof x === 'string' && out.add(x));
  if (Array.isArray(p)) add(p);
  else if (p && typeof p === 'object') Object.values(p as Row).forEach(add);
  for (const c of list(r.companies)) add(c.permissions);
  return { permissions: [...out] };
}
export const fetchAccess = async (signal?: AbortSignal) => toAccess(await apiGet(`${A}/me`, undefined, signal));
export const has = (a: Access | undefined, p: string) => !!a?.permissions.includes(p);

// ── home ─────────────────────────────────────────────────────────────────

export interface StationHome {
  ready_to_print: number;
  awaiting_approval: number;
  received_pending: number;
  recent_prints: Array<{ id: string; cheque_number: string; payee_name: string; result: string; at: string | null; batch: boolean }>;
  /** What needs a person (`attention[]`: low books, failed prints…), as the server words it. */
  attention: Array<{ tone: string; title: string; text: string }>;
}

/** `GET /dashboard`: the station's tiles and recent prints. */
export function toHome(d: unknown): StationHome {
  const r = (d ?? {}) as Row;
  const k = (r.kpis ?? {}) as Row;
  const w = (r.widgets ?? {}) as Row;
  return {
    ready_to_print: count(k.ready_to_print),
    awaiting_approval: count(k.awaiting_approval),
    received_pending: count(k.received_pending),
    attention: list(r.attention).map((a) => ({ tone: str(a.tone), title: str(a.title), text: str(a.text) })),
    recent_prints: list(r.recent_prints ?? w.recent_prints).map((p, i) => ({
      id: str(p.id ?? p.job_id ?? p.attempt_id, String(i)),
      cheque_number: str(p.cheque_number ?? p.number),
      payee_name: str(p.payee_name ?? p.payee_name_snapshot ?? p.payee),
      result: str(p.result ?? p.status ?? p.state).toLowerCase(),
      at: str(p.at ?? p.confirmed_at ?? p.printed_at ?? p.created_at) || null,
      batch: p.batch_id != null && p.batch_id !== '',
    })),
  };
}
export const fetchHome = async (signal?: AbortSignal) => toHome(await apiGet(`${A}/dashboard`, undefined, signal));

// ── printer profiles, templates ──────────────────────────────────────────

export interface Profile {
  id: number;
  device_id: string | null;
  printer_name: string;
  tray: string | null;
  offset_x_mm: number;
  offset_y_mm: number;
  version_ids: number[];
  restricted_accounts: number[] | null;
  active: boolean;
}

export function toProfile(r: Row): Profile {
  const restricted = (r.restricted ?? {}) as Row;
  return {
    id: int(r.id) ?? 0,
    device_id: r.device_id == null ? null : str(r.device_id),
    printer_name: str(r.printer_name),
    tray: str(r.tray) || null,
    offset_x_mm: Number(r.offset_x_mm ?? 0) || 0,
    offset_y_mm: Number(r.offset_y_mm ?? 0) || 0,
    version_ids: (Array.isArray(r.version_ids) ? r.version_ids : []).map(int).filter((x): x is number => x !== null),
    restricted_accounts: Array.isArray(restricted.bank_account_ids) && restricted.bank_account_ids.length ? restricted.bank_account_ids.map(int).filter((x): x is number => x !== null) : null,
    active: r.active !== false && r.active !== 0,
  };
}
/** This computer's profiles only (CHQ-PRN-02, BR-11). */
export const fetchProfiles = async (device: string | null, signal?: AbortSignal) => (device ? list(await apiGet(`${A}/printers`, undefined, signal)).map(toProfile).filter((p) => p.device_id === device && p.active) : []);

export interface TemplateVersion {
  id: number;
  template_id: number;
  name: string;
  version: string;
  status: string;
}

/** `GET /templates`: every version the library lists, with its template's name, so a profile's version ids can be named. */
export async function fetchVersions(signal?: AbortSignal): Promise<TemplateVersion[]> {
  const rows = list(await apiGet(`${A}/templates`, undefined, signal));
  const out: TemplateVersion[] = [];
  for (const t of rows) {
    const name = [str((t.bank as Row | undefined)?.short_name ?? t.bank_name ?? t.bank_short_name), str(t.family), str(t.series)].filter(Boolean).join(' ') || `Template ${str(t.id)}`;
    const versions = list(t.versions);
    const ids = versions.length ? versions : t.current_version_id ? [{ id: t.current_version_id, version: t.current_version ?? '' }] : [];
    for (const v of ids) {
      const id = int(v.id);
      if (id) out.push({ id, template_id: int(t.id) ?? 0, name, version: str(v.version), status: str(t.status) });
    }
  }
  return out;
}

export interface Geometry {
  width_mm: number;
  height_mm: number;
  fields: Array<{ key: string; x_mm: number; y_mm: number; width_mm: number; height_mm: number }>;
  zones: Array<{ kind: string; x_mm: number; y_mm: number; width_mm: number; height_mm: number }>;
}
const rect = (r: Row) => ({ x_mm: Number(r.x_mm) || 0, y_mm: Number(r.y_mm) || 0, width_mm: Number(r.width_mm) || 0, height_mm: Number(r.height_mm) || 0 });
export async function fetchGeometry(templateId: number, versionId: number, signal?: AbortSignal): Promise<Geometry | null> {
  const t = (await apiGet<Row>(`${A}/templates/${templateId}`, undefined, signal)) ?? {};
  const v = list(t.versions).find((x) => int(x.id) === versionId);
  if (!v) return null;
  return {
    width_mm: Number(v.width_mm) || 178,
    height_mm: Number(v.height_mm) || 82,
    fields: list(v.fields).map((f) => ({ key: str(f.key), ...rect(f) })),
    zones: list(v.zones).map((z) => ({ kind: str(z.kind), ...rect(z) })),
  };
}

export interface Marker {
  name: string;
  x_mm: number;
  y_mm: number;
}
/** The sheet's crosshair markers, where they should land (for D04's measurements). */
export async function fetchMarkers(versionId: number, profileId: number, signal?: AbortSignal): Promise<Marker[]> {
  const d = (await apiGet<Row>(`${A}/template-versions/${versionId}/calibration-sheet`, { profile_id: profileId }, signal)) ?? {};
  return list(d.markers).map((m, i) => ({ name: str(m.name, `M${i + 1}`), x_mm: Number(m.x_mm ?? m.x ?? m.expected_x_mm) || 0, y_mm: Number(m.y_mm ?? m.y ?? m.expected_y_mm) || 0 }));
}

export interface CalibrationRun {
  id: number;
  proposal: { offset_x_mm: number; offset_y_mm: number; scale_pct: number };
  residual_mm: number;
  residual_after_fit_mm: number | null;
  result: 'pass' | 'fail' | string;
}
/** CHQ-CAL-04: the run is stored, pass or fail; the server fits the proposal. */
export const recordCalibration = (versionId: number, body: { profile_id: number; kind: 'sheet' | 'test_print'; markers: Array<{ name: string; expected_x_mm: number; expected_y_mm: number; measured_x_mm: number; measured_y_mm: number }> }) =>
  apiPost<CalibrationRun>(`${A}/template-versions/${versionId}/calibrations`, body);
/** Writes the proposal to the printer profile (never the template). */
export const applyCalibration = (runId: number) => apiPost(`${A}/calibrations/${runId}/apply`, {});
/** D04: offsets typed by hand, saved to this computer's printer profile only (cheque.printer.manage). */
export const saveOffsets = (profileId: number, x: number, y: number) => apiPatch(`${A}/printers/${profileId}`, { offset_x_mm: x, offset_y_mm: y });

// ── the print queue ──────────────────────────────────────────────────────

export interface QueueItem {
  cheque_id: number;
  cheque_number: string;
  payee_name: string;
  amount: string;
  currency: string;
  bank_account_id: number;
  bank_account: string;
  template_version_id: number | null;
}

export function toQueueItem(r: Row, accounts: Map<number, string>): QueueItem {
  const acct = int(r.bank_account_id) ?? 0;
  return {
    cheque_id: int(r.id) ?? 0,
    cheque_number: str(r.cheque_number),
    payee_name: str(r.payee_name_snapshot ?? r.payee_name),
    amount: amountOf(r),
    currency: str(r.currency),
    bank_account_id: acct,
    bank_account: str((r.bank_account as Row | undefined)?.name ?? r.bank_account_name) || accounts.get(acct) || `Account ${acct}`,
    template_version_id: int(r.template_version_id),
  };
}

/** Approved cheques (CHQ-PRT-01), with their Finance bank account names. */
export async function fetchQueue(signal?: AbortSignal): Promise<QueueItem[]> {
  const [rows, accts] = await Promise.all([apiGet(`${A}/cheques`, { status: 'APPROVED', per_page: 200 }, signal), apiGet(`${A}/bank-accounts`, undefined, signal).catch(() => [])]);
  const names = new Map<number, string>(list(accts).map((a) => [int(a.id) ?? 0, str(a.name ?? a.code)]));
  return list(rows).map((r) => toQueueItem(r, names));
}

/** Which of this computer's profiles can print a cheque: linked to its template version, not restricted away from its account. */
export function profileFor(item: QueueItem, profiles: Profile[]): Profile | null {
  return profiles.find((p) => (item.template_version_id === null || p.version_ids.length === 0 || p.version_ids.includes(item.template_version_id)) && (!p.restricted_accounts || p.restricted_accounts.includes(item.bank_account_id))) ?? null;
}

export interface Checks {
  ok: boolean;
  checks: Array<{ key: string; ok: boolean; message: string }>;
}
export const fetchChecks = async (chequeId: number, profileId: number, signal?: AbortSignal): Promise<Checks> => {
  const d = (await apiGet<Row>(`${A}/cheques/${chequeId}/pre-print-checks`, { profile_id: profileId }, signal)) ?? {};
  return { ok: d.ok === true, checks: list(d.checks).map((c) => ({ key: str(c.key), ok: c.ok === true, message: str(c.message ?? c.key) })) };
};

/** D03: what the person found when they took the leaf out. Only this makes a leaf PRINTED or VOID. */
export const confirmPrint = (jobId: number, result: PrintResult, notes?: string) => apiPost<Row | null>(`${A}/print-jobs/${jobId}/confirm`, { result, ...(notes ? { notes } : {}) });
/** WF-12: reprint is blocked by default; this asks a different approver (BR-12). */
export const requestReprint = (chequeId: number, reason: string) => apiPost(`${A}/cheques/${chequeId}/reprint-request`, { reason });

// ── batches ──────────────────────────────────────────────────────────────

export type BatchItemState = 'waiting' | 'queued' | 'sending' | 'spooled' | 'confirmed' | 'unknown' | 'spoiled' | 'blank';

export interface BatchItem {
  cheque_id: number;
  /** Known for the leaves the server lists as unsettled (the ones a reconciliation must account for). */
  leaf_id: number | null;
  job_id: number | null;
  cheque_number: string;
  payee_name: string;
  amount: string;
  currency: string;
  state: BatchItemState;
}

export interface Batch {
  id: number;
  reference: string;
  status: string;
  profile_id: number | null;
  message: string | null;
  /** How many cheques the batch holds (the list's rows carry this but not the run). */
  count: number;
  items: BatchItem[];
  /** RECONCILE_REQUIRED: every leaf of the run not yet settled, which the reconciliation must name. */
  unsettled: Array<{ job_id: number; leaf_id: number; cheque_number: string; job_status: string }>;
}

/**
 * A leaf's place in the run from the cheque's and its latest job's status. A job sent to the printer but not
 * reported spooled is unknown: the software does not know what came out (CHQ-BAT-05).
 */
export function itemState(chequeStatus: unknown, jobStatus: unknown): BatchItemState {
  const c = str(chequeStatus).toUpperCase();
  const j = str(jobStatus).toUpperCase();
  if (c === 'PRINTED' || c === 'ISSUED' || j === 'CONFIRMED') return 'confirmed';
  if (j === 'SPOOLED' || j === 'AWAITING_CONFIRMATION') return 'spooled';
  if (j === 'SENT_TO_DEVICE' || j === 'FAILED') return 'unknown';
  if (j === 'QUEUED') return 'queued';
  return 'waiting';
}

export function toBatch(d: unknown): Batch {
  const r = (d ?? {}) as Row;
  const id = int(r.id) ?? 0;
  return {
    id,
    reference: str(r.reference ?? r.code) || `Batch ${id}`,
    status: str(r.status).toUpperCase(),
    profile_id: int(r.profile_id),
    message: str(r.message) || null,
    count: int(r.count) ?? list(r.run).length,
    items: list(r.run).map((x) => {
      const job = (x.job ?? null) as Row | null;
      return {
        cheque_id: int(x.cheque_id) ?? 0,
        leaf_id: int(x.leaf_id),
        job_id: job ? int(job.id) : null,
        cheque_number: str(x.cheque_number),
        payee_name: str(x.payee ?? x.payee_name ?? x.payee_name_snapshot),
        amount: str(x.amount) || fromMinor(x.amount_minor) || '',
        currency: str(x.currency),
        state: itemState(x.status, job?.status),
      };
    }),
    unsettled: list(r.unsettled).map((u) => ({ job_id: int(u.job_id) ?? 0, leaf_id: int(u.leaf_id) ?? 0, cheque_number: str(u.cheque_number), job_status: str(u.job_status) })),
  };
}

export const fetchBatch = async (id: number, signal?: AbortSignal) => toBatch(await apiGet(`${A}/batches/${id}`, undefined, signal));
export const fetchBatches = async (signal?: AbortSignal) => list(await apiGet(`${A}/batches`, undefined, signal)).map(toBatch);
export const startBatch = (id: number, profileId?: number) => apiPost(`${A}/batches/${id}/start`, profileId ? { profile_id: profileId } : {});
export const resumeBatch = (id: number) => apiPost(`${A}/batches/${id}/resume`, {});
export const pauseBatch = (id: number) => apiPost(`${A}/batches/${id}/pause`, {});
/** CHQ-BAT-04: a failed or stopped print puts the batch in RECONCILE_REQUIRED. */
export const interruptBatch = (id: number, message: string) => apiPost(`${A}/batches/${id}/interrupt`, { message });
/** BR-19: every unconfirmed leaf of the run, as found. PAUSED (resumable) or COMPLETED. */
export const reconcileBatch = (id: number, leaves: Array<{ leaf_id: number; outcome: LeafFound }>) => apiPost(`${A}/batches/${id}/reconcile`, { leaves });

export const K = {
  access: ['cheque', 'access'] as const,
  home: ['cheque', 'dashboard'] as const,
  queue: ['cheque', 'queue'] as const,
  profiles: (device: string | null) => ['cheque', 'printers', device] as const,
  versions: ['cheque', 'versions'] as const,
  geometry: (t: number, v: number) => ['cheque', 'geometry', t, v] as const,
  markers: (v: number, p: number) => ['cheque', 'markers', v, p] as const,
  checks: (c: number, p: number) => ['cheque', 'checks', c, p] as const,
  batches: ['cheque', 'batches'] as const,
  batch: (id: number) => ['cheque', 'batch', id] as const,
};

// ── this computer (main process) ─────────────────────────────────────────

export const station = () => call('cheque:station');
export const printCheque = (input: { cheque_id: number; profile_id: number }) => call('cheque:print', input);
export const printQueued = (input: { cheque_ids: number[]; profile_id: number }) => call('cheque:printQueued', input);
export const printCalibration = (input: { template_id: number; version_id: number; profile_id: number; sheet: 'a4' | 'leaf'; offsets?: { x_mm: number; y_mm: number } }) => call('cheque:printCalibration', input);
