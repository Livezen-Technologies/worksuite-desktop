import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError, request } from '../../core/api';
import type { Product } from './api';

/**
 * The V2 product master (the server's `/api/inventory/products/{id}/…` V2 routes): one product's Product 360 —
 * overview, media, variants, specifications, documents, channels and SEO. Read-heavy; the edits are the ones a desk
 * does well (alt text, roles and order of pictures, specification values, SEO fields, publishing to a channel,
 * generating missing variants). Writes need `inventory.catalogue`; prices need `inventory.cost` — the server decides.
 */
const P = (id: number) => `/api/inventory/products/${id}`;

export const K2 = {
  p360: (id: number) => ['inventory', 'p360', id] as const,
  media: (id: number) => ['inventory', 'p360', id, 'media'] as const,
  variants: (id: number) => ['inventory', 'p360', id, 'variants'] as const,
  matrix: (id: number) => ['inventory', 'p360', id, 'matrix'] as const,
  specs: (id: number) => ['inventory', 'p360', id, 'specs'] as const,
  documents: (id: number) => ['inventory', 'p360', id, 'documents'] as const,
  channels: (id: number) => ['inventory', 'p360', id, 'channels'] as const,
  seo: (id: number, lang: string) => ['inventory', 'p360', id, 'seo', lang] as const,
};

// ── 360 ─────────────────────────────────────────────────────────────────

export type Section = 'general' | 'images' | 'description' | 'specifications' | 'documents' | 'seo';
export type ChannelState = 'off' | 'draft' | 'ready' | 'scheduled' | 'published';

export interface P360 {
  product: Product & { attribute_set_id?: number | null; images?: Array<{ url: string }> };
  completeness: { total: number; sections: Partial<Record<Section, number>> };
  counts: { on_hand: number; incoming: number; variants: number; suppliers: number; channels: number };
  pricing: { standard: number | null; currency?: string | null; lists: Array<{ name: string; price: number; min_qty?: number | null }>; average_cost: number | null; last_change: { at: string; by: string | null; from: string | null; to: string | null } | null };
  channels: Array<{ key: string; name: string; state: ChannelState; detail: string | null }>;
  seo_health: { meta_title_len: number; meta_description_state: 'missing' | 'short' | 'good' | 'long'; og_image: boolean; translations: Array<{ lang: string; state: Translation }> };
  documents: Doc[];
  activity: Array<{ id: number; action: string; summary: string | null; user: string | null; created_at: string }>;
  ai?: boolean;
}

export const fetch360 = (id: number, signal?: AbortSignal) => apiGet<P360>(`${P(id)}/360`, undefined, signal);

/** The tabs of Product 360 on the desktop, in the design's order. */
export const TABS360 = [
  { id: 'overview', label: 'Overview' },
  { id: 'general', label: 'General' },
  { id: 'media', label: 'Media' },
  { id: 'variants', label: 'Variants' },
  { id: 'specs', label: 'Specifications' },
  { id: 'documents', label: 'Documents' },
  { id: 'channels', label: 'Channels' },
  { id: 'seo', label: 'SEO' },
] as const;
export type Tab360 = (typeof TABS360)[number]['id'];
export const tab360 = (v: string | null | undefined): Tab360 => (TABS360.some((t) => t.id === v) ? (v as Tab360) : 'overview');

/** Which tab fixes a channel's missing field (the server's `fix_tab`, which names the web's tabs). */
export function fixTab(t: string | null | undefined): Tab360 {
  if (!t) return 'general';
  if (t === 'specifications' || t === 'attributes') return 'specs';
  if (t === 'images' || t === 'pictures') return 'media';
  return tab360(t);
}

export const SECTION_LABEL: Record<Section, string> = { general: 'General', images: 'Pictures', description: 'Description', specifications: 'Specifications', documents: 'Documents', seo: 'SEO' };

/** Green from 90, amber from 60, red below. */
export const scoreTone = (n: number): 'green' | 'amber' | 'red' => (n >= 90 ? 'green' : n >= 60 ? 'amber' : 'red');

/** The sections least complete first, for "what to do next". */
export function gaps(c: P360['completeness']): Array<{ key: Section; label: string; score: number }> {
  return (Object.entries(c.sections) as Array<[Section, number]>)
    .filter(([, v]) => v < 100)
    .sort((a, b) => a[1] - b[1])
    .map(([k, v]) => ({ key: k, label: SECTION_LABEL[k] ?? k, score: v }));
}

// ── media ───────────────────────────────────────────────────────────────

export type Role = 'primary' | 'gallery' | 'lifestyle' | 'packaging' | 'technical' | 'video';
export const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'primary', label: 'Primary' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'technical', label: 'Technical' },
  { value: 'video', label: 'Video' },
];

export interface Media {
  id: number;
  file_id: number | null;
  url: string | null;
  thumb_url: string | null;
  mime: string | null;
  bytes: number | null;
  position: number;
  role: Role;
  primary: boolean;
  alt: string | null;
  caption: string | null;
  variant_scope: number | null;
  variant_label: string | null;
  public: boolean;
  source: 'upload' | 'drive' | 'url';
  external_url: string | null;
}

export interface MediaList {
  media: Media[];
  require_alt: boolean;
  limit: number;
  max_bytes?: number;
}

export const fetchMedia = (id: number, signal?: AbortSignal) => apiGet<MediaList>(`${P(id)}/media`, undefined, signal);
export const patchMedia = (id: number, mid: number, patch: Partial<Pick<Media, 'role' | 'alt' | 'caption' | 'variant_scope' | 'public'>>) => apiPatch<{ media: Media[] }>(`${P(id)}/media/${mid}`, patch);
export const orderMedia = (id: number, ids: number[]) => apiPut<{ media: Media[] }>(`${P(id)}/media/order`, { ids });
export const removeMedia = (id: number, mid: number) => apiDelete<{ media: Media[] }>(`${P(id)}/media/${mid}`);
export async function uploadMedia(id: number, files: Array<{ blob: Blob; name: string }>): Promise<Media[]> {
  const form = new FormData();
  for (const f of files) form.append('files[]', f.blob, f.name);
  const r = await request<{ media: Media[] }>('POST', `${P(id)}/media`, { body: form });
  return r.data.media ?? [];
}

/** The ids with one moved `step` places (the first is the primary picture). */
export function moved(ids: readonly number[], id: number, step: -1 | 1): number[] {
  const at = ids.indexOf(id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= ids.length) return [...ids];
  const out = [...ids];
  [out[at], out[to]] = [out[to]!, out[at]!];
  return out;
}

/** Why a picture cannot go public yet: the settings ask for alt text first. */
export const altMissing = (m: Pick<Media, 'alt' | 'public'>, requireAlt: boolean) => requireAlt && !(m.alt ?? '').trim();

/** A file from this computer as the gallery takes it: HEIC is turned into JPEG; large photos are reduced. */
export const isHeic = (f: { type: string; name: string }) => /^image\/(heic|heif)$/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

// ── variants ────────────────────────────────────────────────────────────

export interface Matrix {
  axes: Array<{ attribute_id: number; name: string; values: Array<{ id: number; value: string }> }>;
  rules: Array<{ id: number; values: number[]; labels?: string[]; kind: 'exclude' }>;
  combinations: number;
  existing: number;
  excluded?: number;
  missing: Array<{ label: string; value_ids: number[] }>;
}

export interface Variant {
  id: number;
  code: string | null;
  barcode: string | null;
  variant_label: string | null;
  value_ids: number[];
  price: number | null;
  price_adjustment: number | null;
  cost: number | null;
  weight: number | null;
  weight_unit: string | null;
  image_url: string | null;
  active: boolean;
  on_hand: number;
  inherited: Partial<Record<'price' | 'weight' | 'dimensions' | 'image', boolean>>;
}

export const fetchMatrix = (id: number, signal?: AbortSignal) => apiGet<Matrix>(`${P(id)}/variant-matrix`, undefined, signal);
export const fetchVariants = (id: number, signal?: AbortSignal) => apiGet<{ price_mode: 'override' | 'adjustment'; variants: Variant[] }>(`${P(id)}/variants`, undefined, signal);
export const generateVariants = (id: number, m: Pick<Matrix, 'axes' | 'rules'>) =>
  apiPost<{ created: number; skipped: number; excluded: number }>(`${P(id)}/variant-matrix/generate`, {
    axes: m.axes.map((a) => ({ attribute_id: a.attribute_id, value_ids: a.values.map((v) => v.id) })),
    rules: m.rules.map((r) => ({ values: r.values })),
  });
export const bulkVariants = (id: number, ids: number[], set: { price?: number | null; weight?: number | null; active?: boolean }, generateBarcodes = false) =>
  apiPatch<{ updated: number }>(`${P(id)}/variants/bulk`, { ids, set, ...(generateBarcodes ? { generate_barcodes: true } : {}) });

// ── specifications ──────────────────────────────────────────────────────

export interface SpecField {
  attribute_id: number;
  name: string;
  kind: 'list' | 'colour' | 'text' | 'number' | 'boolean';
  unit: string | null;
  required: boolean;
  value: string | number | boolean | null;
  value_label?: string | null;
  options?: Array<{ id: number; value: string }>;
  error?: string | null;
}

export interface Specs {
  set: { id: number; name: string; source: 'category' | 'product' } | null;
  groups: Array<{ name: string; fields: SpecField[] }>;
  sets?: Array<{ id: number; name: string }>;
}

export const fetchSpecs = (id: number, signal?: AbortSignal) => apiGet<Specs>(`${P(id)}/specs`, undefined, signal);
export const saveSpecs = (id: number, values: Record<string, unknown>) => apiPut<Specs>(`${P(id)}/specs`, { values });

/** A field's value as typed into a box. */
export const specText = (f: Pick<SpecField, 'value'>) => (f.value === null || f.value === undefined ? '' : typeof f.value === 'boolean' ? (f.value ? '1' : '0') : String(f.value));

/** Only what changed, as the server takes it: `{attribute_id: value}`; an emptied box is null. */
export function specChanges(specs: Specs | undefined, typed: Record<string, string>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  const fields = new Map((specs?.groups ?? []).flatMap((g) => g.fields).map((f) => [String(f.attribute_id), f]));
  for (const [k, v] of Object.entries(typed)) {
    const f = fields.get(k);
    if (!f || v === specText(f)) continue;
    const t = v.trim();
    out[k] = t === '' ? null : f.kind === 'boolean' ? t === '1' : f.kind === 'list' || f.kind === 'colour' ? Number(t) : t;
  }
  return out;
}

/** The server's per-field refusals (422 `invalid_specs`): attribute id → message. */
export function specErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !e.data || typeof e.data !== 'object') return {};
  const fields = (e.data as { fields?: unknown }).fields;
  return fields && typeof fields === 'object' ? Object.fromEntries(Object.entries(fields as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : {};
}

// ── documents ───────────────────────────────────────────────────────────

export interface Doc {
  id: number;
  type: 'data_sheet' | 'manual' | 'warranty' | 'compliance' | 'price_sheet' | 'other';
  title: string;
  languages: string[];
  visibility: 'public' | 'customer' | 'vendor' | 'internal';
  expires_on: string | null;
  expiry_state: 'ok' | 'expiring' | 'expired' | null;
  primary: boolean;
  rev: number;
  file_id: number | null;
  file_name: string | null;
  revisions?: Array<{ id: number; rev: number; file_id: number; file_name: string | null; note: string | null; by: string | null; at: string }>;
}

export const DOC_TYPE: Record<Doc['type'], string> = { data_sheet: 'Data sheet', manual: 'Manual', warranty: 'Warranty', compliance: 'Compliance', price_sheet: 'Price sheet', other: 'Other' };
export const VISIBILITY: Record<Doc['visibility'], string> = { public: 'Public', customer: 'Customers', vendor: 'Vendors', internal: 'Internal' };
export const fetchDocuments = (id: number, signal?: AbortSignal) => apiGet<{ documents: Doc[]; expiring: number }>(`${P(id)}/documents`, undefined, signal);

// ── channels ────────────────────────────────────────────────────────────

export interface Channel {
  key: string;
  name: string;
  state: ChannelState;
  visible_from: string | null;
  visible_to: string | null;
  scheduled_at?: string | null;
  price_list?: string | null;
  price?: number | null;
  badges?: string[];
  detail: string | null;
  validation: { ok: boolean; missing: Array<{ field: string; message: string; fix_tab: string | null }> };
}

export const CHANNEL_STATE: Record<ChannelState, { label: string; tone: 'grey' | 'amber' | 'blue' | 'green' }> = {
  off: { label: 'Off', tone: 'grey' },
  draft: { label: 'Draft', tone: 'grey' },
  ready: { label: 'Ready', tone: 'blue' },
  scheduled: { label: 'Scheduled', tone: 'amber' },
  published: { label: 'Published', tone: 'green' },
};

export const fetchChannels = (id: number, signal?: AbortSignal) => apiGet<{ channels: Channel[] }>(`${P(id)}/channels`, undefined, signal).then((r) => r.channels ?? []);
export const channelAct = (id: number, key: string, act: 'publish' | 'unpublish') => apiPost<{ channel: Channel }>(`${P(id)}/channels/${encodeURIComponent(key)}/${act}`, {});
export const setChannel = (id: number, key: string, patch: { state?: 'off' | 'draft' }) => apiPut<{ channel: Channel }>(`${P(id)}/channels/${encodeURIComponent(key)}`, patch);

/** What may be done with a channel now: publish when it is valid and not out, take it down when it is. */
export function channelActions(c: Pick<Channel, 'state' | 'validation'>): { publish: boolean; unpublish: boolean; turnOn: boolean } {
  const live = c.state === 'published' || c.state === 'scheduled';
  return { publish: !live && c.state !== 'off' && c.validation.ok, unpublish: live, turnOn: c.state === 'off' };
}

// ── SEO ─────────────────────────────────────────────────────────────────

export type Translation = 'complete' | 'partial' | 'not_started';

export interface Seo {
  seo: { lang: string; channel: string | null; slug: string | null; meta_title: string | null; meta_description: string | null; canonical: string | null; robots: string | null; og_image_url: string | null };
  defaults: { slug: string | null; meta_title: string | null; meta_description: string | null };
  redirects: Array<{ from: string; to: string; code: number; at: string }>;
  translations: Array<{ lang: string; state: Translation }>;
  languages: string[];
  ai: boolean;
}

export const fetchSeo = (id: number, lang: string, signal?: AbortSignal) => apiGet<Seo>(`${P(id)}/seo`, { lang }, signal);
export const saveSeo = (id: number, body: { lang: string; slug?: string; meta_title?: string; meta_description?: string; canonical?: string; robots?: string }) => apiPut<Seo>(`${P(id)}/seo`, body);
export const draftSeo = (id: number, lang: string) => apiPost<{ meta_title: string; meta_description: string; slug: string }>(`${P(id)}/seo/ai-draft`, { lang });

/** Search engines show about 60 characters of a title and 120–160 of a description. */
export function seoLength(kind: 'title' | 'description', text: string | null | undefined): { n: number; tone: 'green' | 'amber' | 'red'; words: string } {
  const n = (text ?? '').trim().length;
  if (kind === 'title') {
    if (!n) return { n, tone: 'red', words: 'missing' };
    return n > 60 ? { n, tone: 'amber', words: 'may be cut off' } : n < 30 ? { n, tone: 'amber', words: 'short' } : { n, tone: 'green', words: 'good' };
  }
  if (!n) return { n, tone: 'red', words: 'missing' };
  return n < 120 ? { n, tone: 'amber', words: 'short' } : n > 160 ? { n, tone: 'amber', words: 'long' } : { n, tone: 'green', words: 'good' };
}

/** A slug as the server keeps it: lower case, words joined by hyphens. */
export const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

/** "The server does not have this yet" — a 404 or 405 from a V2 route on an older WorkSuite. */
export const notOnServer = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
