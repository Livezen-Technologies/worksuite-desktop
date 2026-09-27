import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { withOrg } from './api';

/**
 * Setup (the "Inv" Lookups, Settings and My access designs): the brands,
 * units and attributes products are described with; the module's own rules
 * and numbering; the warehouses and their locations; and what the reader
 * may see and do here. Brands and attributes need `inventory.catalogue`;
 * units, the rules and the warehouses `inventory.settings`.
 */

const bodyOrg = (org: string, body: object) => (org ? { org_id: Number(org), ...body } : body);

export const KS = {
  brands: (org: string) => ['inventory', 'brands', org] as const,
  units: (org: string) => ['inventory', 'units', org] as const,
  attributes: (org: string) => ['inventory', 'attributes', org] as const,
  settings: ['inventory', 'settings'] as const,
  warehousesAll: (org: string) => ['inventory', 'warehouses-all', org] as const,
  warehouse: (id: number) => ['inventory', 'warehouse', id] as const,
  explain: ['inventory', 'access-explain'] as const,
  moduleAccess: ['inventory', 'module-access'] as const,
};

// ── brands, units and attributes ────────────────────────────────────────

export interface Brand {
  id: number;
  name: string;
  code: string | null;
  manufacturer: string | null;
  website: string | null;
  country: string | null;
  description: string | null;
  status: string;
  product_count: number;
}

export interface Unit {
  id: number;
  name: string;
  code: string;
  kind: string;
  base_unit_id: number | null;
  base_code: string | null;
  base_name: string | null;
  factor: number;
  decimals: number;
  is_default: boolean;
  status: string;
}

export interface Attribute {
  id: number;
  name: string;
  code: string | null;
  kind: string;
  is_variantal: boolean;
  unit: string | null;
  values: Array<{ id: number; value: string; code: string | null; colour_hex: string | null }>;
}

export const fetchBrands = (org: string, signal?: AbortSignal) => apiGet<{ brands: Brand[] }>('/api/inventory/brands', withOrg(org), signal).then((r) => r.brands ?? []);
export const saveBrand = (org: string, id: number | null, body: Record<string, unknown>) => (id ? apiPut<unknown>(`/api/inventory/brands/${id}`, body) : apiPost<{ id: number }>('/api/inventory/brands', bodyOrg(org, body)));
export const deleteBrand = (id: number) => apiDelete<unknown>(`/api/inventory/brands/${id}`);

export const fetchUnits = (org: string, signal?: AbortSignal) => apiGet<{ units: Unit[] }>('/api/inventory/units', withOrg(org), signal).then((r) => r.units ?? []);
export const createUnit = (org: string, body: Record<string, unknown>) => apiPost<{ id: number }>('/api/inventory/units', bodyOrg(org, body));
export const deleteUnit = (id: number) => apiDelete<unknown>(`/api/inventory/units/${id}`);

export const fetchAttributes = (org: string, signal?: AbortSignal) => apiGet<{ attributes: Attribute[] }>('/api/inventory/attributes', withOrg(org), signal).then((r) => r.attributes ?? []);
export const createAttribute = (org: string, body: Record<string, unknown>) => apiPost<{ id: number }>('/api/inventory/attributes', bodyOrg(org, body));
export const addAttributeValue = (id: number, value: string) => apiPost<{ id: number }>(`/api/inventory/attributes/${id}/values`, { value });
export const deleteAttribute = (id: number) => apiDelete<unknown>(`/api/inventory/attributes/${id}`);

export const UNIT_KINDS = [
  { value: 'count', label: 'Count' },
  { value: 'weight', label: 'Weight' },
  { value: 'length', label: 'Length' },
  { value: 'area', label: 'Area' },
  { value: 'volume', label: 'Volume' },
  { value: 'time', label: 'Time' },
];

export interface UnitDraft {
  name: string;
  code: string;
  kind: string;
  base: number | null;
  factor: string;
  decimals: string;
}

/**
 * A unit's body. A derived unit gives its factor against a base unit directly
 * — the server refuses chains, because each hop compounds rounding — and a
 * base unit's factor is 1.
 */
export function unitBody(d: UnitDraft): { body: Record<string, unknown>; error: string | null } {
  if (!d.name.trim() || !d.code.trim()) return { body: {}, error: 'A unit needs a name and a code.' };
  const decimals = d.decimals.trim() === '' ? 2 : Number(d.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) return { body: {}, error: 'Decimals are a whole number from 0 to 6.' };
  const body: Record<string, unknown> = { name: d.name.trim(), code: d.code.trim(), kind: d.kind, decimals };
  if (d.base) {
    const f = Number(d.factor.replace(/,/g, ''));
    if (!d.factor.trim() || !Number.isFinite(f) || f <= 0) return { body: {}, error: 'Say how many of the base unit one of these is.' };
    body.base_unit_id = d.base;
    body.factor = f;
  }
  return { body, error: null };
}

/** An attribute's values, typed one a line or separated by commas. */
export const attributeValues = (text: string) => [
  ...new Set(
    text
      .split(/[\n,]+/)
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];

// ── the module's rules and numbering ────────────────────────────────────

export interface InvSetting {
  key: string;
  label: string;
  note: string | null;
  type: 'bool' | 'int' | 'string';
  value: boolean | number | string;
}

export const fetchSettings = (signal?: AbortSignal) => apiGet<{ settings: InvSetting[]; editable: boolean }>('/api/inventory/settings', undefined, signal);
export const saveSettings = (changes: Record<string, unknown>) => apiPut<{ changed: string[] }>('/api/inventory/settings', changes);

/** Only what changed, so a save never rewrites a rule nobody touched. A prefix left blank is not sent: the server keeps the old one. */
export function settingChanges(list: InvSetting[], draft: Record<string, boolean | number | string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of list) {
    if (!(s.key in draft)) continue;
    const v = draft[s.key];
    if (s.type === 'string' && String(v).trim() === '') continue;
    const now = s.type === 'int' ? Number(v) : s.type === 'bool' ? !!v : String(v).trim();
    if (now !== s.value) out[s.key] = now;
  }
  return out;
}

// ── warehouses ──────────────────────────────────────────────────────────

export const WAREHOUSE_KINDS = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'branch', label: 'Branch' },
  { value: 'store', label: 'Store' },
  { value: 'retail', label: 'Retail' },
  { value: 'distribution', label: 'Distribution centre' },
  { value: 'virtual', label: 'Virtual' },
  { value: 'transit', label: 'In transit' },
];
export const BIN_KINDS = ['zone', 'aisle', 'rack', 'shelf', 'bin', 'receiving', 'dispatch', 'staging'].map((k) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1) }));

export interface WarehouseRow {
  id: number;
  code: string;
  name: string;
  kind: string;
  street: string | null;
  city: string | null;
  country: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  capacity: number | null;
  capacity_unit: string | null;
  is_default: boolean;
  allow_negative: boolean;
  status: string;
  notes: string | null;
  bin_count: number;
  product_count: number;
  units: number;
  value: number | null;
  can_act: boolean;
}

export interface Bin {
  id: number;
  parent_id: number | null;
  code: string;
  name: string | null;
  kind: string;
  depth: number;
  on_hand: number;
  products: number;
}

export interface WarehouseDetail {
  warehouse: WarehouseRow;
  users: Array<{ user_id: number; role: string; name: string; email: string | null }>;
  bins: Bin[];
  top_stock: Array<{ product_id: number; code: string | null; name: string; unit: string | null; on_hand: number; reserved: number; average_cost: number | null }>;
}

export const fetchWarehousesAll = (org: string, signal?: AbortSignal) => apiGet<{ warehouses: WarehouseRow[] }>('/api/inventory/warehouses', withOrg(org, { include_archived: 1 }), signal).then((r) => r.warehouses ?? []);
/**
 * One warehouse. Its row comes back as the database has it — "0" and "1" for
 * its switches, which read as true alike — so they are made booleans here,
 * or the panel called every warehouse the default and its form ticked both.
 */
export const fetchWarehouse = (id: number, signal?: AbortSignal) =>
  apiGet<WarehouseDetail>(`/api/inventory/warehouses/${id}`, undefined, signal).then((d) => ({
    ...d,
    warehouse: { ...d.warehouse, is_default: Number(d.warehouse.is_default) === 1, allow_negative: Number(d.warehouse.allow_negative) === 1, id: Number(d.warehouse.id) },
  }));
export const saveWarehouse = (org: string, id: number | null, body: Record<string, unknown>) => (id ? apiPut<unknown>(`/api/inventory/warehouses/${id}`, body) : apiPost<{ id: number }>('/api/inventory/warehouses', bodyOrg(org, body)));
export const archiveWarehouse = (id: number) => apiDelete<unknown>(`/api/inventory/warehouses/${id}`);
export const createBin = (warehouseId: number, body: Record<string, unknown>) => apiPost<{ id: number }>(`/api/inventory/warehouses/${warehouseId}/bins`, body);

export interface WarehouseDraft {
  code: string;
  name: string;
  kind: string;
  street: string;
  city: string;
  country: string;
  phone: string;
  isDefault: boolean;
  allowNegative: boolean;
}

export function warehouseBody(d: WarehouseDraft): { body: Record<string, unknown>; error: string | null } {
  if (!d.code.trim() || !d.name.trim()) return { body: {}, error: 'A warehouse needs a short code and a name.' };
  return {
    body: {
      code: d.code.trim().toUpperCase(),
      name: d.name.trim(),
      kind: d.kind,
      street: d.street.trim() || null,
      city: d.city.trim() || null,
      country: d.country.trim() || null,
      phone: d.phone.trim() || null,
      is_default: d.isDefault,
      allow_negative: d.allowNegative,
    },
    error: null,
  };
}

// ── my access ───────────────────────────────────────────────────────────

export interface Explain {
  warehouses: { all: boolean; count: number; total: number; names: string[]; why: string; open_note: string };
  cost: { held: boolean; why: string };
}

export interface ModuleAccess {
  label: string;
  permissions: Array<{ slug: string; name: string; held: boolean }>;
  held: number;
  of: number;
  why: string;
}

export const fetchExplain = (signal?: AbortSignal) => apiGet<Explain>('/api/inventory/access', undefined, signal);
export const fetchModuleAccess = (signal?: AbortSignal) => apiGet<ModuleAccess>('/api/access/module/Inventory', undefined, signal);
