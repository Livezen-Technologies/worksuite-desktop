import { apiDelete, apiGet, apiPost, apiPut, type Query } from '../../core/api';

/**
 * Assets on the desktop (WS-ASSET-SRS-001 T-17, the "Assets — Desktop" boards D01–D26), over the server's
 * `/api/assets` (server Assets 1.1; docs/asset-api.md in the server repo).
 *
 * THE SERVER IS AUTHORITATIVE. Book values, depreciation, gain or loss, seat counts, warranty days and every total are
 * what the server sent. Endpoints the SRS adds in 1.1 (`resolve`, `bookings`, `plans`, `checkout`, `issues`,
 * `acknowledge`, `people`, `import`) may not be on the server this computer talks to: `orNull` turns their 404 into
 * "needs a newer server" on the screen, and the scan station falls back to the register's search.
 */

export const BASE = '/api/assets';

/** A 404 or 405 — an endpoint this server does not have yet — as null; anything else is thrown. */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if ([404, 405].includes((e as { status?: number }).status ?? 0)) return null;
    throw e;
  }
}

export type Can = Partial<Record<'view' | 'manage' | 'assign' | 'approve' | 'maintain' | 'finance' | 'audit' | 'settings', boolean>>;

export interface Company {
  id: number;
  name: string;
}

export interface Access {
  companies: Company[];
  unassigned: number;
  why?: string;
  permissions?: unknown;
}

export interface Asset {
  id: number;
  asset_code: string;
  name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  type?: string | null;
  vendor?: string | null;
  serial_number: string | null;
  barcode: string | null;
  status: string;
  condition: string;
  purchase_date: string | null;
  purchase_price: string;
  currency: string;
  base_amount?: string;
  base_currency?: string;
  warranty_end: string | null;
  warranty_days_left?: number | null;
  net_book_value: string;
  accumulated_depreciation?: string;
  department_id?: number | null;
  location: string | null;
  org_id: number | null;
  company: string | null;
  /** Who holds it, where the server names them (1.1). */
  holder?: string | null;
  image_token?: string | null;
}

export interface AssetList {
  assets: Asset[];
  total: number;
  page: number;
  per_page: number;
}

export interface AssetDetail extends Asset {
  notes: string | null;
  invoice_no?: string | null;
  po_number?: string | null;
  warranty_provider?: string | null;
  warranty_number?: string | null;
  warranty_start?: string | null;
  branch?: string | null;
  building?: string | null;
  floor?: string | null;
  room?: string | null;
  storage_location?: string | null;
  rustdesk_id?: string | null;
  rustdesk_uri?: string | null;
  category_id?: number | null;
  brand_id?: number | null;
  model_id?: number | null;
  type_id?: number | null;
  vendor_id?: number | null;
  depreciation_method: string;
  salvage_value?: string;
  life_months: number;
  depreciation_start?: string | null;
}

export interface Depreciation {
  method: string;
  cost: string;
  monthly: string;
  accumulated: string;
  net_book_value: string;
  life_months: number;
  months_elapsed: number;
  fully_depreciated: boolean;
  note: string | null;
}

export interface Holder {
  assignment_id: number;
  name: string | null;
  holder_type: string;
  assigned_at: string;
  expected_return_at: string | null;
  /** 1.1: whether the holder has confirmed the handover. */
  acknowledged_at?: string | null;
}

export interface AssetFull {
  asset: AssetDetail;
  holder: Holder | null;
  depreciation: Depreciation;
  schedule: Array<{ month: string; charge: string; accumulated: string; nbv: string; posted?: string | null; status?: string | null }>;
  assignments: Array<{ id: number; holder: string | null; holder_type: string; assigned_at: string; returned_at: string | null; condition_out: string; condition_in: string | null; notes: string | null; acknowledged_at?: string | null }>;
  maintenance: Array<{ id: number; kind: string; status: string; scheduled_for: string | null; completed_at: string | null; technician: string | null; vendor: string | null; cost: string; currency: string; notes: string | null }>;
  documents: Array<{ id: number; kind: string; token: string; name: string; mime: string | null; size: number; created_at: string }>;
  activity: Array<{ action: string; detail: string | null; actor: string | null; at: string }>;
  upkeep_total: string;
  can_manage: boolean;
  can?: Can;
}

export interface Dashboard {
  currency: string;
  unassigned?: { count: number; value: string };
  kpi: {
    total: number; active: number; assigned: number; available: number; maintenance: number; repair: number;
    warranty_expiring: number; licenses: number; license_expiring: number;
    pending_requests: number; pending_transfers: number; due_maintenance: number;
    asset_value: string; net_book_value: string; monthly_depreciation: string;
  };
  by_status: Record<string, number>;
  by_category: Array<{ category: string; count: number; total: string }>;
  recent_assignments: Array<{ asset: string; asset_code: string; holder: string | null; at: string }>;
  warranty_expiring: Array<{ id: number; asset_code: string; name: string; warranty_end: string; days_left: number }>;
  upcoming_maintenance: Array<{ id: number; kind: string; scheduled_for: string | null; asset: string; asset_code: string }>;
  can_manage: boolean;
  can?: Can;
}

export interface MyAsset extends Asset {
  assignment_id: number;
  assigned_at: string;
  expected_return_at: string | null;
  acknowledged_at?: string | null;
  /** 1.2: the server asks this holder to confirm receipt. */
  needs_acknowledgement?: boolean;
  acknowledge_required?: boolean;
  kind?: 'issue' | 'loan' | string;
}

/** Whether the server wants this holder to confirm the handover. */
export const toConfirm = (a: Pick<MyAsset, 'needs_acknowledgement' | 'acknowledge_required' | 'acknowledged_at'>) => !!(a.needs_acknowledgement ?? a.acknowledge_required) && !a.acknowledged_at;

export interface AssetRequest {
  id: number; request_no: string | null; title: string; justification: string | null; needed_by: string | null;
  status: string; requester: string | null; category: string | null; is_mine: boolean;
  manager_by: string | null; manager_at: string | null; manager_note: string | null;
  it_by: string | null; it_at: string | null; it_note: string | null;
  asset: string | null; asset_code: string | null; asset_id: number | null; fulfilled_at: string | null; created_at: string;
  /** 1.2: whether I own the current gate. */
  can_decide?: boolean;
}

export interface Transfer {
  id: number; asset: string; asset_code: string; asset_id: number; from: string | null; to: string | null; to_type: string;
  status: string; transfer_date: string | null; condition: string; requested_by: string | null; decided_by: string | null;
  decided_at: string | null; note: string | null; created_at: string;
  /** 1.2: I raised it (and so may not decide it), whether I may decide, and what blocks it. */
  mine?: boolean; can_decide?: boolean; blocked?: string | null;
}

export interface Job {
  id: number; asset_id: number; asset: string; asset_code: string; kind: string; status: string; scheduled_for: string | null;
  started_at: string | null; completed_at: string | null; technician: string | null; vendor: string | null; vendor_id: number | null;
  cost: string; currency: string; warranty_claim: boolean; notes: string | null; created_by: string | null; overdue: boolean;
}

export interface License {
  id: number; name: string; vendor: string | null; version: string | null; status: string;
  seats_total: number; seats_used: number; seats_available: number; over_allocated: boolean;
  purchase_date: string | null; expiry_date: string | null; days_left: number | null; cost: string; currency: string; has_key: boolean; notes: string | null;
}

export interface StockItem {
  id: number; name: string; sku: string | null; kind: string; unit: string; category: string | null; reorder_level: number; stock: number; low: boolean;
}

export interface Audit {
  id: number; name: string; status: string; scheduled_for: string | null; started_at: string | null; completed_at: string | null;
  created_by: string | null; note: string | null; progress: { total: number; checked: number; found: number; missing: number };
}

export interface AuditLine {
  id: number; asset_id: number; asset: string; asset_code: string; asset_status: string; expected_location: string | null;
  found: boolean | null; condition: string | null; note: string | null; checked_by: string | null; checked_at: string | null;
  outcome?: 'found' | 'missing' | 'elsewhere' | 'unexpected' | null; actual_location?: string | null;
}

export interface Disposal {
  id: number; asset_id: number; asset: string; asset_code: string; method: string; status: string; disposal_date: string | null;
  proceeds: string; currency: string; net_book_value: string; gain_loss: string; reason: string | null;
  requested_by: string | null; approved_by: string | null; approved_at: string | null; created_at: string;
}

export interface Lookup {
  id: number; name: string; status: string; assets: number; code?: string | null; default_life_months?: number; default_method?: string;
}

export interface Person {
  id: number;
  name: string;
  employee_no: string;
  email?: string | null;
}

export interface Booking {
  id: number; asset_id: number; asset?: string; asset_code?: string; starts_at: string; ends_at: string;
  status: 'booked' | 'checked_out' | 'returned' | 'cancelled' | 'no_show' | string; booked_for?: string | null; purpose?: string | null; overdue?: boolean;
}

export interface Plan {
  id: number; name: string; asset_code?: string | null; category?: string | null; interval_unit: 'days' | 'months' | 'km' | 'hours' | string; interval_value: number;
  next_due_on?: string | null; next_due_meter?: number | null; last_done_on?: string | null; status?: string;
}

export interface Activity {
  id: number; action: string; detail: string | null; actor: string | null; asset: string | null; asset_code: string | null; at: string; company?: string | null;
}

// ── reads ───────────────────────────────────────────────────────────────

export const K = {
  access: ['assets', 'access'] as const,
  dashboard: (org: number) => ['assets', 'dashboard', org] as const,
};

export const fetchAccess = (signal?: AbortSignal) => apiGet<Access>(`${BASE}/access`, undefined, signal);
export const fetchDashboard = (org: number, signal?: AbortSignal) => apiGet<Dashboard>(`${BASE}/dashboard`, org ? { org } : undefined, signal);
export const fetchAssets = (q: Query, signal?: AbortSignal) => apiGet<AssetList>(BASE, q, signal);
export const fetchAsset = (id: number, signal?: AbortSignal) => apiGet<AssetFull>(`${BASE}/${id}`, undefined, signal);
export const fetchMine = (signal?: AbortSignal) => apiGet<{ assets: MyAsset[]; note?: string }>(`${BASE}/mine`, undefined, signal);
export const fetchLookups = (kind: string, signal?: AbortSignal) => apiGet<{ items: Lookup[] }>(`${BASE}/lookups/${kind}`, undefined, signal);

/** The holder picker: 1.1's `people` (narrowed to the asset's company), else the older `employees`. */
export async function fetchPeople(org: number | null, signal?: AbortSignal): Promise<Person[]> {
  const p = await orNull(apiGet<{ people?: Person[]; employees?: Person[] }>(`${BASE}/people`, org ? { org } : undefined, signal));
  if (p) return p.people ?? p.employees ?? [];
  return (await apiGet<{ employees: Person[] }>(`${BASE}/employees`, undefined, signal)).employees;
}

/** A scanned code: what it may be is an asset's code, barcode or serial (or, 1.1, an NFC tag). */
export type Resolved = { kind: 'asset'; asset: Asset } | { kind: 'person'; person: Person } | { kind: 'none'; code: string };

const same = (a: string | null | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Resolve a scan (T-11): the server's `GET resolve?code=` where it has one, else the register's search with only an
 * exact match on code, barcode or serial taken — never the first of several near ones. A code that is not an asset
 * may be a person's ID card (their employee number), when `people` is given.
 */
export async function resolveCode(code: string, people?: readonly Person[]): Promise<Resolved> {
  const c = code.trim();
  const r = await orNull(apiGet<{ asset?: Asset | null; kind?: string }>(`${BASE}/resolve`, { code: c }));
  if (r?.asset) return { kind: 'asset', asset: r.asset };
  if (!r) {
    const list = await apiGet<AssetList>(BASE, { q: c, per_page: 10 });
    const hit = list.assets.find((a) => same(a.asset_code, c) || same(a.barcode, c) || same(a.serial_number, c));
    if (hit) return { kind: 'asset', asset: hit };
  }
  const person = people?.find((p) => same(p.employee_no, c) || same(p.email, c));
  return person ? { kind: 'person', person } : { kind: 'none', code: c };
}

// ── writes ──────────────────────────────────────────────────────────────

export interface IssueInput {
  holder_type: 'employee' | 'department' | 'location';
  holder_id?: number;
  holder_label?: string;
  expected_return_at?: string;
  condition_out: string;
  notes?: string;
  items?: string[];
}

export const issueAsset = (id: number, b: IssueInput) => apiPost<{ assignment_id?: number }>(`${BASE}/${id}/assign`, { ...b, notes: [b.notes, b.items?.length ? `With: ${b.items.join(', ')}` : null].filter(Boolean).join('\n') || undefined, items: b.items });
export const returnAsset = (id: number, condition_in: string, notes?: string, items?: string[]) => apiPost(`${BASE}/${id}/return`, { condition_in, notes: notes || undefined, items });
export const setStatus = (id: number, status: string) => apiPost(`${BASE}/${id}/status`, { status });
export const saveAsset = (id: number | null, body: Record<string, unknown>) => (id ? apiPut<{ id?: number; asset_code?: string }>(`${BASE}/${id}`, body) : apiPost<{ id?: number; asset_code?: string }>(BASE, body));
/** Loans (1.1): out with a due-back time and condition, and back in. Null on a server without them. */
export const checkout = (id: number, b: { holder_id: number; due_back: string; condition_out: string }) => orNull(apiPost(`${BASE}/${id}/checkout`, b));
export const checkin = (id: number, condition_in: string) => orNull(apiPost(`${BASE}/${id}/checkin`, { condition_in }));
/** A holder confirming a handover (1.1). Null on a server without it. */
export const acknowledge = (assignment: number, note?: string) => orNull(apiPost(`${BASE}/assignments/${assignment}/acknowledge`, { kind: 'receipt', note: note || undefined }));
/** A holder's fault report (1.1), which becomes a repair job. Null on a server without it. */
export const reportIssue = (asset: number, b: { title: string; description?: string; severity?: 'low' | 'normal' | 'high' | 'critical'; take_offline?: boolean }) => orNull(apiPost(`${BASE}/${asset}/issues`, b));
export const createRequest = (b: { title: string; category_id?: number; justification?: string; needed_by?: string }) => apiPost(`${BASE}/requests`, b);
export const decideRequest = (id: number, decision: 'approve' | 'reject', note?: string) => apiPost(`${BASE}/requests/${id}/decide`, { decision, note: note || undefined });
export const fulfilRequest = (id: number, asset_id: number) => apiPost(`${BASE}/requests/${id}/fulfil`, { asset_id });
export const bulkRequests = (ids: number[], decision: 'approve' | 'reject') => apiPost<{ done: unknown[]; failed: Array<{ id: number; why: string }> }>(`${BASE}/requests/bulk`, { ids, decision });
export const createTransfer = (b: Record<string, unknown>) => apiPost(`${BASE}/transfers`, b);
export const decideTransfer = (id: number, decision: 'approve' | 'reject') => apiPost(`${BASE}/transfers/${id}/decide`, { decision });
export const saveJob = (id: number | null, b: Record<string, unknown>) => apiPost(id ? `${BASE}/maintenance/${id}` : `${BASE}/maintenance`, b);
export const revealKey = (id: number) => apiGet<{ license_key: string }>(`${BASE}/licenses/${id}/key`);
export const assignSeat = (id: number, b: { employee_id?: number; label?: string }) => apiPost(`${BASE}/licenses/${id}/seats`, b);
export const releaseSeat = (seat: number) => apiDelete(`${BASE}/license-seats/${seat}`);
export const moveStock = (id: number, b: { kind: 'in' | 'out'; qty: number; unit_cost?: string; issued_to?: string; note?: string }) => apiPost(`${BASE}/consumables/${id}/move`, b);
export const checkAudit = (id: number, b: { line_id?: number; asset_code?: string; found: boolean; outcome?: 'found' | 'missing' | 'elsewhere'; condition?: string; note?: string }) => apiPost<{ line?: AuditLine; message?: string }>(`${BASE}/audits/${id}/check`, b);
export const completeAudit = (id: number, force: boolean) => apiPost(`${BASE}/audits/${id}/complete`, { force });
export const raiseDisposal = (b: { asset_id: number; method: string; proceeds: string; disposal_date: string; reason: string }) => apiPost(`${BASE}/disposals`, b);
export const decideDisposal = (id: number, decision: 'approve' | 'reject') => apiPost(`${BASE}/disposals/${id}/decide`, { decision });
export const saveSettings = (settings: Record<string, string>) => apiPut(`${BASE}/settings`, settings);
/** File an asset that belongs to no company (D26): it is the asset's company, set as any other edit. */
export const fileToCompany = (id: number, org_id: number) => apiPut(`${BASE}/${id}`, { org_id });
/** Import (1.1, T-10): a dry run first, then the same rows for real. Null on a server without it. */
export const importAssets = (b: { rows: Array<Record<string, string>>; org_id: number; apply: boolean }) => orNull(apiPost<ImportResult>(`${BASE}/import`, b));

/** The dry run's answer (`rows`, `summary`), or after `apply` the ids made and changed. */
export interface ImportResult {
  rows?: Array<{ row: number; action: 'create' | 'update' | 'skip' | string; asset_code?: string | null; errors?: string[]; warnings?: string[] }>;
  summary?: { create: number; update: number; error: number };
  created?: number[];
  updated?: number[];
}

// ── shapes the screens share ───────────────────────────────────────────

export const STATUS_LABEL: Record<string, string> = {
  available: 'Available', assigned: 'Assigned', maintenance: 'Maintenance', repair: 'Repair', reserved: 'Reserved', missing: 'Missing',
  lost: 'Lost', stolen: 'Stolen', retired: 'Retired', disposed: 'Disposed', pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
  fulfilled: 'Issued', cancelled: 'Cancelled', completed: 'Completed', scheduled: 'Scheduled', in_progress: 'In progress', open: 'Open',
  manager_approved: 'Manager approved', it_approved: 'Ready to issue', active: 'Active', expired: 'Expired', draft: 'Draft', checked_out: 'Checked out',
};
export const statusLabel = (s: string | null | undefined) => (s ? (STATUS_LABEL[s] ?? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())) : '—');

/** CSV text from rows, as a spreadsheet reads it (export, D21). Values are written as the server sent them. */
export function toCsv(head: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // A leading = + - @ would be read as a formula by Excel; quote it as text.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Rows from CSV or tab-separated text (D21), the first line naming the columns. Quotes as Excel writes them. */
export function parseCsv(text: string): { head: string[]; rows: Array<Record<string, string>> } {
  const sep = (text.split(/\r?\n/, 1)[0] ?? '').includes('\t') ? '\t' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  const lines = out.filter((r) => r.some((c) => c.trim() !== ''));
  const head = (lines.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return { head, rows: lines.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
