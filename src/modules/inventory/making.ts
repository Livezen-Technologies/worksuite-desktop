import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { num, withOrg } from './api';
import { serialList } from './control';

/**
 * Making (the "Inv" Manufacturing designs): recipes — bills of materials —
 * and the jobs built from them. A job is released, which fixes its component
 * list from the recipe and reserves the parts, then completed in one run or
 * several, which consumes the parts and puts the goods on the shelf at what
 * the parts, labour and overhead actually cost.
 *
 * A recipe belongs to the company of the product it makes; a job to one
 * company. Costs — the parts' prices, labour and overhead — are for those
 * who may see them: the server sends null to anyone else, and a recipe saved
 * by such a person keeps its labour and overhead.
 */

type Q = Record<string, string | number | boolean | undefined>;
const bodyOrg = (org: string, body: object) => (org ? { org_id: Number(org), ...body } : body);

export const KM = {
  jobs: (org: string, f: object) => ['inventory', 'jobs', org, f] as const,
  job: (id: number) => ['inventory', 'job', id] as const,
  boms: (org: string, f: object) => ['inventory', 'boms', org, f] as const,
  bom: (id: number) => ['inventory', 'bom', id] as const,
  bomCost: (id: number) => ['inventory', 'bom-cost', id] as const,
};

// ── jobs (assembly orders) ──────────────────────────────────────────────

export const JOB_LABEL: Record<string, string> = {
  draft: 'Draft',
  planned: 'Planned',
  released: 'Released',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const jobTone = (s: string): 'grey' | 'amber' | 'blue' | 'green' => (s === 'completed' ? 'green' : s === 'in_progress' ? 'amber' : s === 'released' ? 'blue' : 'grey');

export interface Job {
  id: number | string;
  reference: string;
  bom_id: number | string | null;
  bom_version?: string | null;
  product_id: number | string;
  code: string | null;
  product_name: string;
  unit: string | null;
  warehouse_id: number | string;
  warehouse: string | null;
  quantity: number | string;
  produced_qty: number | string;
  scrapped_qty: number | string;
  status: string;
  planned_for: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  serials: string | null;
  component_cost: number | string | null;
  labour_cost: number | string | null;
  overhead_cost: number | string | null;
  unit_cost: number | string | null;
  notes: string | null;
  created_by_name?: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface JobLine {
  id: number | string;
  component_id: number | string;
  code: string | null;
  component_name: string;
  unit: string | null;
  tracking: string | null;
  required_qty: number | string;
  consumed_qty: number | string;
  available: number | string;
  short: number | string;
  cost_value: number | string | null;
}

export interface JobDetail {
  assembly: Job;
  lines: JobLine[];
  product: { id: number; code: string | null; name: string; unit: string | null; tracking: 'none' | 'batch' | 'serial' } | null;
}

export const PER = 30;

export const fetchJobs = (org: string, wh: number | null, f: { status: string; page: number }, signal?: AbortSignal) =>
  apiGet<{ assemblies: Job[]; total: number }>('/api/inventory/assemblies', withOrg(org, { status: f.status || undefined, ...(wh ? { warehouse_id: wh } : {}), page: f.page, per_page: PER } as Q), signal).then((r) => ({
    rows: r.assemblies ?? [],
    total: num(r.total) ?? 0,
  }));
export const fetchJob = (id: number, signal?: AbortSignal) => apiGet<JobDetail>(`/api/inventory/assemblies/${id}`, undefined, signal);
export const createJob = (org: string, body: Record<string, unknown>) => apiPost<{ id: number }>('/api/inventory/assemblies', bodyOrg(org, body));
export const jobAct = (id: number, act: 'release' | 'complete' | 'cancel', body?: object) => apiPost<{ assembly?: Job; short?: string[]; unit_cost?: number }>(`/api/inventory/assemblies/${id}/${act}`, body ?? {});
export const deleteJob = (id: number) => apiDelete<unknown>(`/api/inventory/assemblies/${id}`);

/** What may be done to a job now. Everything needs `inventory.manufacture`. */
export function jobActions(a: Pick<Job, 'status' | 'produced_qty'>, canMake: boolean) {
  const s = a.status;
  const open = s === 'draft' || s === 'planned';
  return {
    release: canMake && open,
    complete: canMake && (s === 'released' || s === 'in_progress'),
    // Nothing made yet: the server refuses once anything has been.
    cancel: canMake && !['completed', 'cancelled'].includes(s) && (num(a.produced_qty) ?? 0) <= 0,
    remove: canMake && open,
  };
}

/** What is left of the plan: made and scrapped both use it up. */
export const leftToMake = (a: Pick<Job, 'quantity' | 'produced_qty' | 'scrapped_qty'>) => Math.max(0, (num(a.quantity) ?? 0) - (num(a.produced_qty) ?? 0) - (num(a.scrapped_qty) ?? 0));

const amountOf = (v: string) => {
  const t = v.replace(/,/g, '').trim();
  return t === '' ? null : Number(t);
};

export interface NewJobDraft {
  bom: number | null;
  warehouse: number | null;
  quantity: string;
  plannedFor: string;
  notes: string;
}

export function jobBody(d: NewJobDraft): { body: Record<string, unknown>; error: string | null } {
  if (!d.bom) return { body: {}, error: 'Choose the recipe to build.' };
  if (!d.warehouse) return { body: {}, error: 'Choose where it is made.' };
  const q = amountOf(d.quantity);
  if (q === null || !Number.isFinite(q) || q <= 0) return { body: {}, error: 'Say how many to make.' };
  return { body: { bom_id: d.bom, warehouse_id: d.warehouse, quantity: q, planned_for: d.plannedFor || null, notes: d.notes.trim() || null }, error: null };
}

export interface RunDraft {
  made: string;
  scrapped: string;
  batch: string;
  expiry: string;
  serials: string;
}

/**
 * The body a run completes with. A blank "made" is left out, so the server
 * makes what is left of the plan after the scrap; batches and serials only
 * for a product tracked that way.
 */
export function runBody(d: RunDraft, tracking: 'none' | 'batch' | 'serial', left: number): { body: Record<string, unknown>; error: string | null } {
  const made = amountOf(d.made);
  const scrapped = amountOf(d.scrapped) ?? 0;
  if (made !== null && (!Number.isFinite(made) || made <= 0)) return { body: {}, error: 'Good units made must be more than zero.' };
  if (!Number.isFinite(scrapped) || scrapped < 0) return { body: {}, error: 'Scrapped must be zero or more.' };
  const willMake = made ?? Math.max(0, left - scrapped);
  if (willMake <= 0) return { body: {}, error: 'Nothing is left to make. Say how many good units were made.' };
  const body: Record<string, unknown> = { scrapped };
  if (made !== null) body.quantity = made;
  if (tracking === 'batch') {
    if (!d.batch.trim()) return { body: {}, error: 'Name the batch this run produced.' };
    body.batch_no = d.batch.trim();
    if (d.expiry) body.expiry_date = d.expiry;
  }
  if (tracking === 'serial') {
    const sns = serialList(d.serials);
    if (sns.length !== willMake) return { body: {}, error: `List one serial for each unit made: ${willMake} needed, ${sns.length} given.` };
    body.serials = sns;
  }
  return { body, error: null };
}

// ── recipes (bills of materials) ────────────────────────────────────────

export const BOM_LABEL: Record<string, string> = { draft: 'Draft', active: 'Active', archived: 'Archived' };
export const bomTone = (s: string): 'grey' | 'green' => (s === 'active' ? 'green' : 'grey');

export interface Bom {
  id: number | string;
  product_id: number | string;
  code: string | null;
  product_name: string;
  unit: string | null;
  name: string | null;
  version: string;
  status: string;
  is_default: number | string | boolean;
  output_qty: number | string;
  labour_cost: number | string | null;
  overhead_cost: number | string | null;
  notes: string | null;
  line_count?: number | string;
}

export interface BomLine {
  id: number | string;
  component_id: number | string;
  code: string | null;
  component_name: string;
  unit: string | null;
  product_unit: string | null;
  quantity: number | string;
  wastage_pct: number | string;
  cost_price: number | string | null;
  average_cost: number | string | null;
  tracking: string | null;
  has_bom: number | string;
}

export interface BomDetail {
  bom: Bom;
  lines: BomLine[];
  product: { id: number; code: string | null; name: string; unit: string | null; tracking: string } | null;
}

export interface BomCost {
  quantity: number;
  component_cost: number;
  labour_cost: number;
  overhead_cost: number;
  total_cost: number;
  unit_cost: number;
  basis: string;
}

export const fetchBoms = (org: string, f: { status: string; q: string }, signal?: AbortSignal) =>
  apiGet<{ boms: Bom[] }>('/api/inventory/boms', withOrg(org, { status: f.status || undefined, q: f.q.trim() || undefined, per_page: 100 } as Q), signal).then((r) => r.boms ?? []);
export const fetchBom = (id: number, signal?: AbortSignal) => apiGet<BomDetail>(`/api/inventory/boms/${id}`, undefined, signal);
export const fetchBomCost = (id: number, signal?: AbortSignal) => apiGet<BomCost>(`/api/inventory/boms/${id}/cost`, undefined, signal);
export const saveBom = (id: number | null, body: Record<string, unknown>) => (id ? apiPut<unknown>(`/api/inventory/boms/${id}`, body) : apiPost<{ id: number }>('/api/inventory/boms', body));
export const deleteBom = (id: number) => apiDelete<unknown>(`/api/inventory/boms/${id}`);

/** Wastage divides rather than multiplies: 100 good at 5% loss needs 105.26, not 105. */
export const needed = (quantity: number, wastagePct: number) => quantity / (1 - Math.min(99.99, Math.max(0, wastagePct)) / 100);

export interface BomLineDraft {
  key: number;
  component: { id: number; code: string | null; name: string } | null;
  qty: string;
  waste: string;
}

export interface BomDraft {
  product: { id: number; code: string | null; name: string } | null;
  name: string;
  version: string;
  output: string;
  labour: string;
  overhead: string;
  notes: string;
  lines: BomLineDraft[];
}

/**
 * The body a recipe saves as. Labour and overhead are costs: someone who may
 * not see them doesn't send them, so the recipe keeps its own.
 */
export function bomBody(d: BomDraft, canCost: boolean): { body: Record<string, unknown>; error: string | null } {
  if (!d.product) return { body: {}, error: 'Choose what this recipe makes.' };
  const output = amountOf(d.output);
  if (output === null || !Number.isFinite(output) || output <= 0) return { body: {}, error: 'Say how many one run makes.' };
  const body: Record<string, unknown> = { product_id: d.product.id, name: d.name.trim() || null, version: d.version.trim() || '1', output_qty: output, notes: d.notes.trim() || null };
  if (canCost) {
    for (const [k, v, label] of [
      ['labour_cost', d.labour, 'Labour'],
      ['overhead_cost', d.overhead, 'Overhead'],
    ] as const) {
      const n = amountOf(v);
      if (n !== null && (!Number.isFinite(n) || n < 0)) return { body: {}, error: `${label} must be a number, zero or more.` };
      body[k] = n ?? 0;
    }
  }
  const lines: Array<Record<string, unknown>> = [];
  for (const l of d.lines) {
    if (!l.component) continue;
    if (l.component.id === d.product.id) return { body: {}, error: 'A product cannot be a component of itself.' };
    const q = amountOf(l.qty);
    if (q === null || !Number.isFinite(q) || q <= 0) return { body: {}, error: `Say how much “${l.component.name}” one run uses.` };
    const w = amountOf(l.waste) ?? 0;
    if (!Number.isFinite(w) || w < 0 || w >= 100) return { body: {}, error: `The wastage on “${l.component.name}” must be from 0 to under 100%.` };
    lines.push({ component_id: l.component.id, quantity: q, wastage_pct: w });
  }
  if (!lines.length) return { body: {}, error: 'Add at least one component.' };
  body.lines = lines;
  return { body, error: null };
}
