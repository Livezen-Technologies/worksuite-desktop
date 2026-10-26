import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LabelSettingsPatch, ReconcileDecision } from '@shared/label';
import { apiGet, apiPost, request } from '../../core/api';
import { call, on } from '../../core/bridge';

/**
 * Label Studio on the desktop (WS-LABEL-SRS-001 §4.27), over the server's `/api/labels` exactly as the server's
 * docs/label-api.md (Label module 1.0.0) describes it.
 *
 * THE SERVER IS AUTHORITATIVE. It renders every label (§12), allocates every sequence value (§13), keeps the queue
 * and decides reconciliations; this module asks it and shows what it says. Printing is the main process's
 * (electron/services/label/): the screens create a job and hand the main process its id, never printer bytes
 * (FR-DSK-03).
 */
export const LABEL = '/api/labels';

type List<T> = { items?: T[] } | T[];
const items = <T>(r: List<T> | null | undefined): T[] => (Array.isArray(r) ? r : (r?.items ?? []));

export interface Template {
  id: number;
  name: string;
  category?: string | null;
  context?: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | string;
  updated_at?: string | null;
  last_printed_at?: string | null;
}

/** The universal label model (`worksuite.label/1`): only what the desktop designer edits is typed. */
export interface TemplateElement {
  id: string;
  type: string;
  x_mm: number;
  y_mm: number;
  w_mm?: number;
  h_mm?: number;
  rotation?: 0 | 90 | 180 | 270;
  binding?: string;
  name?: string;
  locked?: boolean;
  font?: { family?: string; size_pt?: number; weight?: number };
  [extra: string]: unknown;
}

export interface LabelModel {
  schema?: string;
  size: { width_mm: number; height_mm: number; [k: string]: unknown };
  elements: TemplateElement[];
  [extra: string]: unknown;
}

export interface TemplateVersion {
  id: number;
  version: number;
  status: string;
  lock_version: number;
  model: LabelModel;
}

export interface TemplateDetail extends Template {
  draft: TemplateVersion | null;
  published: TemplateVersion | null;
  validation?: Array<{ severity: string; code: string; element?: string | null; message: string }>;
}

export interface ServerJob {
  id: number;
  code: string;
  status: string;
  job_type?: string;
  template_id?: number | null;
  printer_id?: number | null;
  labels_total: number;
  labels_confirmed: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  template_name?: string | null;
  printer_name?: string | null;
}

export interface SourceRecord {
  ref: string;
  values: Record<string, unknown>;
}

export interface Reconciliation {
  job: ServerJob;
  reserved: number;
  printed: number;
  void: number;
  last_confirmed: string | null;
  uncertain: Array<{ item_id: number; seq_no: number; value: string | null }>;
}

/** Where the print station looks a scanned code up (the server's data sources, FR-DSK-04). */
export const STATION_SOURCES: Array<{ id: string; label: string }> = [
  { id: 'inventory.product', label: 'Products' },
  { id: 'asset.asset', label: 'Assets' },
  { id: 'oms.shipment', label: 'Shipments' },
  { id: 'oms.order', label: 'Sales orders' },
  { id: 'garage.job', label: 'Garage jobs' },
];

export const K = {
  templates: (q: string, recent: boolean) => ['label', 'templates', q, recent] as const,
  template: (id: number) => ['label', 'template', id] as const,
  jobs: ['label', 'jobs'] as const,
  partial: ['label', 'jobs', 'partial'] as const,
  host: ['label', 'host'] as const,
  settings: ['label', 'settings'] as const,
  gateway: ['label', 'gateway'] as const,
};

/* ── Server ─────────────────────────────────────────────────────── */

export const fetchTemplates = (q: string, recent: boolean, signal?: AbortSignal) =>
  apiGet<List<Template>>(`${LABEL}/templates`, recent ? { status: 'PUBLISHED', sort: 'last_printed_at', dir: 'desc', per_page: 8 } : { q: q || undefined, per_page: 50 }, signal).then(items);
export const fetchTemplatesFor = (context: string, signal?: AbortSignal) => apiGet<List<Template>>(`${LABEL}/templates`, { context, status: 'PUBLISHED', per_page: 50 }, signal).then(items);
export const fetchTemplate = (id: number, signal?: AbortSignal) => apiGet<TemplateDetail>(`${LABEL}/templates/${id}`, undefined, signal);

/** Save the draft with the version it was read at (If-Match); 409 STALE_VERSION when someone saved meanwhile. */
export async function saveDraft(id: number, lockVersion: number, model: LabelModel): Promise<TemplateDetail> {
  return (await request<TemplateDetail>('PATCH', `${LABEL}/templates/${id}`, { body: { model }, headers: { 'If-Match': String(lockVersion) } })).data;
}

/** The server's own rendering as a picture (the same renderer that prints). */
export const preview = (templateId: number, model: LabelModel) =>
  apiPost<{ mime: string; base64: string }>(`${LABEL}/preview`, { template_id: templateId, model, provider: 'png', mode: 'normal' }).then((r) => `data:${r.mime || 'image/png'};base64,${r.base64}`);

export const fetchJobs = (signal?: AbortSignal, status?: string) => apiGet<List<ServerJob>>(`${LABEL}/jobs`, { per_page: 20, status }, signal).then(items);
export const fetchReconciliation = (jobId: number) => apiGet<Reconciliation>(`${LABEL}/jobs/${jobId}/reconciliation`);
export const reconcile = (jobId: number, body: { last_good_value?: string; decisions?: Array<{ value: string; decision: 'printed' | 'void' | 'reprint' }>; reason: string }) =>
  apiPost<{ job: ServerJob }>(`${LABEL}/jobs/${jobId}/reconcile`, body);
export const resumeServerJob = (jobId: number) => apiPost(`${LABEL}/jobs/${jobId}/resume`, { reason: 'Resumed at the printer.' });

/** A scanned code in one data source: the records whose code, barcode or serial match. */
export const findRecords = (source: string, code: string) => apiGet<SourceRecord[]>(`${LABEL}/data-sources/${source.replace('.', '_')}/records`, { q: code, limit: 5 });
/** `product:12` → 12. */
export const recordId = (ref: string) => ref.split(':').pop() ?? ref;

export interface PrintRequest {
  template_id: number;
  printer_id: number;
  mode: 'single' | 'copies' | 'test';
  copies?: number;
  records?: Array<{ source: string; ref: string }>;
  confirm?: boolean;
  source_module?: string;
}

/** Create a job (`POST print`); the idempotency key keeps a double Enter from printing twice. */
export async function createJob(body: PrintRequest, key: string): Promise<ServerJob> {
  const r = await request<{ job: ServerJob }>('POST', `${LABEL}/print`, { body: { output: 'printer', quantity: 1, ...body }, headers: { 'Idempotency-Key': key } });
  return r.data.job;
}

export async function reprint(jobId: number, reason: string, key: string): Promise<ServerJob> {
  return (await request<{ job: ServerJob }>('POST', `${LABEL}/jobs/${jobId}/reprint`, { body: { type: 'exact', reason }, headers: { 'Idempotency-Key': key } })).data.job;
}

/* ── This computer (the main process) ───────────────────────────── */

export const hostStatus = () => call('label:status');
export const hostSettings = () => call('label:settings');
export const setHostSettings = (patch: LabelSettingsPatch) => call('label:settingsSet', patch);
export const registerHost = () => call('label:register');
export const discover = () => call('label:discover');
export const sendJob = (jobId: number) => call('label:send', { job_id: String(jobId) });
export const cancelJob = (jobId: string) => call('label:cancel', { job_id: jobId });
export const resolveJob = (jobId: string, decision: ReconcileDecision, reason: string, lastPrinted?: number) =>
  call('label:resolve', { job_id: jobId, decision, reason, ...(lastPrinted !== undefined ? { last_printed: lastPrinted } : {}) });
export const gatewayStatus = () => call('labelGateway:status');
export const checkGatewayUpdate = () => call('labelGateway:checkUpdate');
export const downloadGatewayUpdate = () => call('labelGateway:downloadUpdate');

/** The server's printers with their pause state (Label 1.1, FR-QUE-04); null on a server without it. */
export async function fetchServerPrinters(signal?: AbortSignal): Promise<Array<{ id: number; paused: boolean; paused_reason: string | null }> | null> {
  try {
    const r = await apiGet<unknown>(`${LABEL}/printers`, { per_page: 200 }, signal);
    const rows = Array.isArray(r) ? r : ((r as { items?: unknown[] } | null)?.items ?? []);
    return (rows as Array<{ id?: unknown; paused?: unknown; paused_at?: unknown; paused_reason?: unknown }>).map((p) => ({ id: Number(p.id), paused: !!p.paused || !!p.paused_at, paused_reason: typeof p.paused_reason === 'string' ? p.paused_reason : null }));
  } catch (e) {
    if ([403, 404, 405].includes((e as { status?: number }).status ?? 0)) return null;
    throw e;
  }
}
/** A paused printer takes no new job; its queue waits until it is resumed (Label 1.1). */
export const pausePrinter = (id: number, reason?: string) => apiPost(`${LABEL}/printers/${id}/pause`, reason ? { reason } : {});
export const resumePrinter = (id: number) => apiPost(`${LABEL}/printers/${id}/resume`, {});
export const pairGateway = (url: string, code: string, name: string) => call('labelGateway:pair', { url, code, name });
export const unpairGateway = () => call('labelGateway:unpair');
export const setGatewayHeadless = (enabled: boolean) => call('labelGateway:headless', { enabled });

/** Print a job on this computer now: the server makes it, the main process claims and prints it. */
export async function createAndSend(body: PrintRequest, key: string) {
  const job = await createJob(body, key);
  return sendJob(job.id);
}

export const newKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** The host and gateway screens follow the main process's changes. */
export function useLabelEvents(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const a = on('label:changed', () => void qc.invalidateQueries({ queryKey: K.host }));
    const b = on('labelGateway:changed', () => void qc.invalidateQueries({ queryKey: K.gateway }));
    return () => {
      a();
      b();
    };
  }, [qc]);
}

export const STATE_TEXT: Record<string, string> = {
  ready: 'Ready', printing: 'Printing', paused: 'Paused', paper_out: 'Out of labels', ribbon_out: 'Out of ribbon', head_open: 'Head open', offline: 'Offline', error: 'Error', unknown: '—',
  queued: 'Queued', waiting_printer: 'Waiting for printer', interrupted: 'Needs a person', done: 'Done', cancelled: 'Cancelled', failed: 'Failed',
  QUEUED: 'Queued', SENDING: 'Sending', PRINTING: 'Printing', COMPLETED: 'Completed', PARTIAL: 'Needs reconciling', PAUSED: 'Paused', FAILED: 'Failed', CANCELLED: 'Cancelled', PENDING_APPROVAL: 'Waiting for approval',
};
