import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGetMeta, apiPatch, apiPost, type Query } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import type { DeviceType, ServiceStatus } from '@shared/service';

/**
 * Service & Repair over the staff API (`/api/v1/service/…`, blueprint §15). The server decides every rule —
 * workflow transitions, permissions, organisation and branch scoping, optimistic concurrency and idempotency for
 * money and stock. Reads go through the main process's offline cache (READ_CACHE over the base), so the last answers
 * stay readable offline; writes are refused offline.
 */
export const B = '/api/v1/service';

export const K = {
  all: ['service'] as const,
  overview: ['service', 'overview'] as const,
  jobs: (q: Query) => ['service', 'jobs', q] as const,
  job: (id: string) => ['service', 'job', id] as const,
  board: ['service', 'board'] as const,
  stock: (q: string) => ['service', 'stock', q] as const,
  device: (id: string) => ['service', 'device', id] as const,
  deviceSearch: (q: string) => ['service', 'devices', q] as const,
};

export interface Read<T> { data: T; offline: boolean; cachedAt: string | null }
async function read<T>(path: string, query?: Query, signal?: AbortSignal): Promise<Read<T>> {
  const r = await apiGetMeta<T>(`${B}${path}`, query, signal);
  return { data: r.data, offline: r.offline, cachedAt: r.cachedAt };
}

export function useOffline(): boolean {
  return useStore(app, (s) => s.status?.network === 'OFFLINE');
}

/** A random idempotency key for a financial or stock write, so a retry is not applied twice. */
export function idemKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── shapes ─────────────────────────────────────────────────────────────────

export interface Customer { id: string; name: string; phone?: string | null; email?: string | null; company?: string | null }
export interface Device {
  id: string; type: DeviceType | string; brand?: string | null; model?: string | null; imei?: string | null; serial?: string | null;
  asset_tag?: string | null; specs?: string | null; condition?: string | null; customer?: Customer | null;
}
export interface JobRow {
  id: string; number: string; status: ServiceStatus | string; priority?: 'low' | 'normal' | 'high' | 'urgent';
  customer?: Customer | null; device?: Device | null; problem?: string | null; technician?: { id: string; name: string } | null;
  promised_at?: string | null; overdue?: boolean; payment_status?: 'unpaid' | 'deposit' | 'paid' | 'refunded' | null;
  under_warranty?: boolean; total?: number | null; currency?: string | null; created_at?: string; version?: number;
}
export interface HistoryEntry { id: string; from?: string | null; to: string; at: string; by?: string | null; note?: string | null; customer_visible?: boolean }
export interface Diagnostic { id: string; finding: string; cause?: string | null; recommendation?: string | null; by?: string | null; at: string }
export interface JobPart {
  id: string; name: string; sku?: string | null; qty: number; state: 'required' | 'reserved' | 'used' | 'returned'; unit_price?: number | null; customer_supplied?: boolean;
  /** The Inventory product the part is, when it is stocked (a customer's own part is not). */
  product_id?: number | null; warehouse?: string | null;
}
export interface QuoteItem { kind: 'diagnosis' | 'labour' | 'part' | 'other'; description: string; qty: number; unit_price: number; tax?: number; product_id?: number | null }
/** A stocked part from Inventory, through the service API's inventory adapter: what it sells for and what is free. */
export interface StockPart { product_id: number; sku?: string | null; name: string; unit_price: number; currency?: string | null; on_hand?: number | null; available?: number | null; warehouse?: string | null }
/** The job's Billing invoice, once one is made from its approved billable items. */
export interface JobInvoice { id: number; number?: string | null; status: string; total: number; balance?: number | null; currency?: string | null }
export interface Quote { id: string; version: number; status: 'draft' | 'sent' | 'approved' | 'rejected' | 'superseded'; items: QuoteItem[]; discount?: number; total: number; currency?: string; decided_at?: string | null }
export interface QaResult { id: string; passed: boolean; checks: Array<{ label: string; ok: boolean }>; note?: string | null; by?: string | null; at: string }
export interface Activity { id: string; at: string; by?: string | null; text: string }
export interface Job extends JobRow {
  accessories?: string[]; intake_checklist?: Array<{ label: string; done: boolean }>; internal_notes?: string | null;
  history?: HistoryEntry[]; diagnostics?: Diagnostic[]; parts?: JobPart[]; quotes?: Quote[]; qa?: QaResult[]; activity?: Activity[];
  deposit?: number | null; paid?: number | null; balance?: number | null;
  warranty?: { until?: string | null; terms?: string | null } | null;
  invoice?: JobInvoice | null;
}
export interface Page<T> { items: T[]; total: number; page: number; per_page: number }
export interface Overview {
  active: number; awaiting_approval: number; ready_for_pickup: number; overdue: number;
  revenue_today?: number | null; revenue_month?: number | null; currency?: string | null;
  by_status?: Record<string, number>; by_technician?: Array<{ name: string; open: number }>;
}

// ── reads ──────────────────────────────────────────────────────────────────

export function useOverview() {
  return useQuery({ queryKey: K.overview, queryFn: ({ signal }) => read<Overview>('/reports/overview', undefined, signal), refetchInterval: 60_000 });
}

export function useJobs(q: Query) {
  return useQuery({ queryKey: K.jobs(q), queryFn: ({ signal }) => read<Page<JobRow>>('/jobs', q, signal), placeholderData: keepPreviousData });
}

export function useBoard() {
  return useQuery({ queryKey: K.board, queryFn: ({ signal }) => read<Page<JobRow>>('/jobs', { scope: 'active', per_page: 500 }, signal), refetchInterval: 30_000 });
}

export function useJob(id: string | null) {
  return useQuery({ queryKey: K.job(id ?? ''), enabled: !!id, queryFn: ({ signal }) => read<Job>(`/jobs/${encodeURIComponent(id!)}`, undefined, signal) });
}

export function useDeviceSearch(q: string) {
  return useQuery({ queryKey: K.deviceSearch(q), enabled: q.trim().length >= 3, queryFn: ({ signal }) => read<Page<Device>>('/devices', { q: q.trim() }, signal) });
}

export function useDeviceHistory(id: string | null) {
  return useQuery({ queryKey: K.device(id ?? ''), enabled: !!id, queryFn: ({ signal }) => read<{ device: Device; jobs: JobRow[] }>(`/devices/${encodeURIComponent(id!)}/history`, undefined, signal) });
}

/** Stocked parts matching a name, SKU or barcode (Inventory, through the service API so branch and price rules hold). */
export function useStockSearch(q: string) {
  return useQuery({ queryKey: K.stock(q), enabled: q.trim().length >= 2, queryFn: ({ signal }) => read<{ items: StockPart[] }>('/parts', { q: q.trim() }, signal), staleTime: 30_000 });
}

// ── writes ─────────────────────────────────────────────────────────────────

/** A write against a job: on success every Service & Repair read is refreshed. */
function useJobWrite<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: K.all }) });
}

export function useTransition(job: Pick<Job, 'id' | 'version'>) {
  return useJobWrite((v: { to: ServiceStatus; note?: string; customer_visible?: boolean }) =>
    apiPost(`${B}/jobs/${encodeURIComponent(job.id)}/transition`, { ...v, version: job.version }));
}

export function useAssign(job: Pick<Job, 'id' | 'version'>) {
  return useJobWrite((technician_id: string | null) => apiPatch(`${B}/jobs/${encodeURIComponent(job.id)}`, { technician_id, version: job.version }));
}

export function useAddDiagnostic(jobId: string) {
  return useJobWrite((v: { finding: string; cause?: string; recommendation?: string }) => apiPost(`${B}/jobs/${encodeURIComponent(jobId)}/diagnostics`, v));
}

export function usePart(jobId: string, action: 'reserve' | 'consume') {
  return useJobWrite((v: { part_id: string; qty: number }) => apiPost(`${B}/jobs/${encodeURIComponent(jobId)}/parts/${action}`, { ...v, idempotency_key: idemKey() }));
}

/** Adds a part the job needs: a stocked one by its product, or the customer's own (never added to owned stock). */
export function useAddPart(jobId: string) {
  return useJobWrite((v: { product_id?: number; name?: string; qty: number; unit_price?: number; customer_supplied?: boolean; reserve?: boolean }) =>
    apiPost(`${B}/jobs/${encodeURIComponent(jobId)}/parts`, { ...v, idempotency_key: idemKey() }));
}

/** Gives a reserved or used part back to stock (returned, or found defective). */
export function useReturnPart(jobId: string) {
  return useJobWrite((v: { part_id: string; qty: number; condition: 'good' | 'defective' }) =>
    apiPost(`${B}/jobs/${encodeURIComponent(jobId)}/parts/return`, { ...v, idempotency_key: idemKey() }));
}

/** Makes the job's Billing invoice from its approved, billable items (the server's billing adapter; once only). */
export function useCreateInvoice(jobId: string) {
  return useJobWrite(() => apiPost<{ invoice: JobInvoice }>(`${B}/jobs/${encodeURIComponent(jobId)}/invoice`, { idempotency_key: idemKey() }));
}

export function useCreateQuote(jobId: string) {
  return useJobWrite((v: { items: QuoteItem[]; discount?: number }) => apiPost(`${B}/jobs/${encodeURIComponent(jobId)}/quotes`, v));
}

/** Staff record the customer's decision taken at the counter or by phone (the portal records its own). */
export function useQuoteDecision(action: 'approve' | 'reject') {
  return useJobWrite((v: { quote_id: string; note?: string }) => apiPost(`${B}/quotes/${encodeURIComponent(v.quote_id)}/${action}`, { note: v.note, channel: 'staff' }));
}

export function useQa(jobId: string) {
  return useJobWrite((v: { passed: boolean; checks: Array<{ label: string; ok: boolean }>; note?: string }) => apiPost(`${B}/jobs/${encodeURIComponent(jobId)}/qa`, v));
}

export function useHandover(jobId: string) {
  return useJobWrite((v: { identity_verified: boolean; received_by: string; note?: string }) => apiPost(`${B}/jobs/${encodeURIComponent(jobId)}/handover`, { ...v, idempotency_key: idemKey() }));
}

export interface CheckIn {
  customer: { id?: string; name: string; phone?: string; email?: string };
  device: { id?: string; type: DeviceType; brand?: string; model?: string; imei?: string; serial?: string; condition?: string };
  problem: string; accessories: string[]; checklist: Array<{ label: string; done: boolean }>;
  priority: 'low' | 'normal' | 'high' | 'urgent'; consent: { access: boolean; backup: boolean; reset: boolean };
  device_locked: boolean; deposit?: number;
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CheckIn) => apiPost<{ id: string; number: string }>(`${B}/jobs`, { ...v, idempotency_key: idemKey() }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.all }),
  });
}
