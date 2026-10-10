import { API_BASE, ApiError, apiGet, apiPost, apiPut, apiDelete, apiUrl, request } from '../../../core/api';
import { text as t } from '../../../core/i18n';

/**
 * Every call the photo viewer and editor make (Drive ENH-03 SRS §14.3), in one place. DriveGuard decides on the
 * server; these only ask.
 *
 * Fields the SRS adds are optional here, so the editor keeps working against a server without them: a `can` block
 * missing falls back to the row's own access, an `editor` block missing means every tool on and no AI.
 */

/* ==================================================================== *
 * What the server answers
 * ==================================================================== */

export interface ImageFile {
  id: number;
  name: string;
  extension: string | null;
  mime_type: string | null;
  size: number;
  folder_id: number | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
  description: string | null;
  alt_text?: string | null;
  folder_path?: string | null;
  folder_name?: string | null;
  meta?: { title: string | null; author: string | null; copyright: string | null; category: string | null; keywords: string | null } | null;
  tags?: string[];
}

export interface ImageFacts {
  width: number | null;
  height: number | null;
  dpi?: number | null;
  has_alpha?: boolean;
  colour?: string | null;
  megapixels?: number | null;
  /** Animated GIF/WebP, or a multi-page TIFF: only the first frame or page is edited (EDT-E-15). */
  frames?: number | null;
  pages?: number | null;
}

export interface Exif {
  camera?: string | null;
  lens?: string | null;
  iso?: number | null;
  exposure?: string | null;
  aperture?: string | null;
  focal_length?: string | null;
  taken_at?: string | null;
  software?: string | null;
  orientation?: number | null;
  gps?: { lat: number; lng: number; alt: number | null; place?: string | null } | null;
}

export interface Neighbour {
  id: number;
  name: string;
  extension: string | null;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  version?: number;
  /** A recipe is saved with its current version (VWR-E-15's "Edited · vN"). */
  edited?: boolean;
}

export interface ImageVersion {
  id: number;
  version: number;
  size: number;
  note: string | null;
  author: string | null;
  created_at: string | null;
  editable: boolean;
  summary: string | null;
  thumb_url?: string | null;
}

export interface StoredRecipe {
  version: number;
  recipe: string;
  summary: string | null;
  width: number | null;
  height: number | null;
}

export interface RegionComment {
  comment_id: number;
  version: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
  author?: { id: number; name: string } | null;
  excerpt?: string | null;
  resolved?: boolean;
  created_at?: string | null;
}

/** The `editor` block of GET image/{id}, as the server sends it. */
export interface EditorBlock {
  company_id?: number;
  engine?: string;
  quick_design?: boolean;
  tools?: string[];
  saving?: { format?: 'same' | 'jpg' | 'png' | 'webp'; quality?: number; keep_layers?: boolean; strip_gps?: boolean; batch_output?: 'versions' | 'copies' };
  limits?: { max_render_mb?: number; max_recipe_mb?: number; batch_max_files?: number };
  libraries?: Partial<Record<'stickers' | 'frames' | 'fonts' | 'logos', boolean>>;
  ai?: { enabled?: boolean; code?: string | null; reason?: string | null; actions?: string[]; unavailable?: Record<string, string> | null; provider_label?: string | null };
}

/** Drive settings › Photo editor as an editor needs them (SET-03…08); absent means the defaults. */
export interface EditorSettings {
  tools?: Partial<Record<RailTool, boolean>>;
  ai?: { available: boolean; provider_label?: string | null; actions?: Array<'suggest' | 'alt_text' | 'caption' | 'crop' | 'generative'>; image_model?: boolean; reason?: string | null; unavailable?: Record<string, string> | null };
  save_defaults?: { format?: 'same' | 'jpg' | 'png' | 'webp'; quality?: number; keep_layers?: boolean; strip_gps?: boolean; batch_output?: 'versions' | 'copies' };
  limits?: { render_bytes?: number; recipe_bytes?: number; batch_files?: number };
  quick_design?: boolean;
  map_provider?: string | null;
}

export interface ImageOpen {
  file: ImageFile;
  image: ImageFacts | null;
  exif: Exif | null;
  source: string | null;
  editable: boolean;
  needs: string | null;
  recipe: StoredRecipe | null;
  neighbours?: Neighbour[];
  versions: ImageVersion[];
  edit_reason?: string | null;
  rating?: { mine: number | null; average: number | null; count: number } | null;
  tags?: string[];
  region_comments?: RegionComment[];
  can?: { edit?: boolean; upload_here?: boolean; comment?: boolean; rate?: boolean; tag?: boolean; restore?: boolean; download?: boolean };
  /** People following this file, for "Notify N people" (SAV-04). */
  followers?: number;
  editor?: EditorBlock | null;
}

export type RailTool = 'select' | 'crop' | 'adjust' | 'filters' | 'area' | 'text' | 'shapes' | 'stickers' | 'frames' | 'draw' | 'mark' | 'redact' | 'ai';

export interface SaveResult {
  saved: boolean;
  version: number;
  width?: number;
  height?: number;
  size?: number;
  versions?: ImageVersion[];
}

/** A stale save (SAV-05): who saved which version, and when. */
export interface StaleSave {
  version: number;
  author: string | null;
  savedAt: string | null;
}

export interface LibraryItem {
  file_id: number;
  version: number;
  name: string;
  /** svg, png, jpeg, webp, ttf, otf, woff, woff2. */
  kind?: string | null;
  vector?: boolean;
  mime_type?: string | null;
  /** An SVG's is `/api/drive/image/libraries/svg/{id}` (sanitised, fetched with the session); others a signed `/media/…`. */
  url: string;
  /** For fonts: the family to register it under. */
  family?: string | null;
  category?: string | null;
}

export interface LibraryShelf {
  configured: boolean;
  available: boolean;
  reason: string | null;
  folder_id: number | null;
  folder?: string | null;
  items: LibraryItem[];
}

export interface Libraries {
  stickers: LibraryItem[];
  frames: LibraryItem[];
  fonts: LibraryItem[];
  logos: LibraryItem[];
}

export interface Preset {
  id: number;
  kind: 'filter' | 'text' | 'watermark' | 'batch';
  name: string;
  /** Null for the organization's. */
  user_id?: number | null;
  scope?: 'org' | 'personal';
  payload: Record<string, unknown>;
}

export interface BatchStep {
  type: 'resize' | 'filter' | 'watermark' | 'frame' | 'convert' | 'strip_gps' | 'rename' | 'ai_alt_text';
  enabled?: boolean;
  preset_id?: number;
  [k: string]: unknown;
}

export interface BatchJob {
  job_id: number | string;
  state: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  total: number;
  done: number;
  skipped: number;
  failed: number;
  eta_seconds?: number | null;
  remaining?: number;
  progress?: number;
  failures?: Array<{ file_id: number; name: string; state?: string; reason: string }>;
  skipped_files?: Array<{ file_id: number; name: string; reason: string }>;
}

export interface AiAnswer {
  action?: string;
  request_id?: string | null;
  model?: string | null;
  sent?: { width: number; height: number } | null;
  /** Suggested edits, as editor steps (AI-03). */
  steps?: AiStepIn[];
  /** Steps the server dropped as not the editor's own. */
  dropped?: number;
  summary?: string | null;
  /** Alt text (≤ 250 characters) or a caption. */
  text?: string | null;
  /** Suggested crops (AI-05), fractions of the picture. */
  crops?: Array<{ x: number; y: number; w: number; h: number; ratio?: string | null; reason?: string | null }>;
}

export type AiStepIn = { type: string; [k: string]: unknown };

export interface CompareSide {
  file_id: number;
  name: string;
  version: number;
  current: boolean;
  url: string;
  width: number | null;
  height: number | null;
  size: number | null;
  author: string | null;
  created_at: string | null;
  note: string | null;
  summary: string | null;
  editable: boolean;
}

/* ==================================================================== *
 * Calls
 * ==================================================================== */

export const openImage = (id: number, signal?: AbortSignal) => apiGet<ImageOpen>(`/api/drive/image/${id}`, undefined, signal);

export const prepareImage = (id: number) => apiPost<{ ready?: boolean; source?: string; job_id?: number; message?: string }>(`/api/drive/image/${id}/prepare`);

export const versionRecipe = (id: number, version: number) => apiGet<{ recipe: StoredRecipe }>(`/api/drive/image/${id}/recipe/${version}`);

/** Autosave (EDT-E-10): the recipe alone, no new version. */
export const autosaveRecipe = (id: number, recipe: string, summary: string, width: number | null, height: number | null) =>
  apiPost<{ saved: boolean; version: number }>(`/api/drive/image/${id}/recipe`, { recipe, summary, width, height });

/** The bytes of one version (the base a recipe is redrawn on). */
export async function versionBytes(fileId: number, versionId: number, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(apiUrl(`/api/files/${fileId}/versions/${versionId}/download`), { signal });
  if (!res.ok) throw new ApiError(res.status, t('That version of the picture could not be loaded.'), null);
  return res.blob();
}

/** A multipart POST that reports how much has gone (SAV-08). Falls back to an ordinary request where XHR is missing. */
export function postWithProgress<T>(path: string, form: FormData, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  if (typeof XMLHttpRequest === 'undefined' || !onProgress) return request<T>('POST', path, { body: form, signal }).then((r) => r.data);
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.min(1, e.loaded / e.total));
    xhr.onerror = () => reject(new ApiError(0, t('The picture could not be sent. Check the connection and try again.'), 'NETWORK_UNREACHABLE'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        json = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && json?.status !== 'error') {
        onProgress(1);
        resolve((json && 'data' in json ? json.data : json) as T);
      } else {
        const message = typeof json?.message === 'string' ? json.message : t('The server answered {status}.', { status: xhr.status });
        reject(new ApiError(xhr.status, message, typeof json?.code === 'string' ? json.code : null, json?.data ?? json?.errors ?? null));
      }
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}

export interface SaveInput {
  blob: Blob;
  fileName: string;
  /** Null: saved without editable layers (SAV-04). */
  recipe: string | null;
  summary: string;
  note: string;
  baseVersion: number;
  stripGps: boolean;
  notify: boolean;
  /** Steps an AI suggested that are in this save (AI-09). */
  aiApplied?: boolean;
}

/** Save as the next version (SAV-01). A 409 means somebody saved a newer version first: see `staleOf`. */
export function saveVersion(id: number, s: SaveInput, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<SaveResult> {
  const form = new FormData();
  form.append('image', s.blob, s.fileName);
  if (s.recipe !== null) form.append('recipe', s.recipe);
  form.append('summary', s.summary);
  form.append('note', s.note);
  form.append('base_version', String(s.baseVersion));
  form.append('strip_gps', s.stripGps ? '1' : '0');
  form.append('notify', s.notify ? '1' : '0');
  if (s.aiApplied) form.append('ai_applied', '1');
  return postWithProgress<SaveResult>(`/api/drive/image/${id}/save`, form, onProgress, signal);
}

/** What a 409 from a save says about the newer version (`IMAGE_VERSION_CONFLICT`: current_version, saved_by, saved_at). */
export function staleOf(e: unknown): StaleSave | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const d = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
  if (d.code !== undefined && d.code !== 'IMAGE_VERSION_CONFLICT') return null;
  const by = d.saved_by as { name?: string } | string | null | undefined;
  const v = Number(d.current_version ?? d.version ?? 0);
  return {
    version: Number.isFinite(v) ? v : 0,
    author: typeof by === 'string' ? by : (by?.name ?? null),
    savedAt: typeof d.saved_at === 'string' ? d.saved_at : null,
  };
}

export interface CopyInput {
  blob: Blob;
  sourceId: number | null;
  name: string;
  folderId: number | null;
  format: 'jpg' | 'png' | 'webp';
  quality: number;
  stripGps: boolean;
  recipe: string | null;
  summary: string;
}

/** Save as a copy, in a folder the person may upload to (SAV-01, SAV-07). */
export function deriveImage(c: CopyInput, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<{ file_id: number; name: string; folder_id?: number | null; version?: number; gps_removed?: boolean }> {
  const form = new FormData();
  form.append('image', c.blob, c.name);
  if (c.sourceId !== null) form.append('source_id', String(c.sourceId));
  form.append('name', c.name);
  // An empty folder_id is the top of My Drive; leaving it out would put the copy beside the source.
  form.append('folder_id', c.folderId === null ? '' : String(c.folderId));
  form.append('format', c.format);
  form.append('quality', String(c.quality));
  form.append('strip_gps', c.stripGps ? '1' : '0');
  if (c.recipe !== null) form.append('recipe', c.recipe);
  form.append('summary', c.summary);
  return postWithProgress(`/api/drive/image/derive`, form, onProgress, signal);
}

/** A new, blank image file in a folder (NEW-02), made when the new picture is first saved. */
export const newImage = (input: { folder_id: number | null; name: string; size?: 'square' | 'portrait' | 'banner' | 'story' | 'a4' | 'custom'; width: number; height: number; background: string | null; template_id?: number | null }) =>
  apiPost<{ file_id: number; name: string; folder_id: number | null; width: number; height: number; version: number }>('/api/drive/image/new', { ...input, size: input.size ?? 'custom', background: input.background ?? 'transparent' });

/** Save a turn or flip from the viewer as a new version: lossless for JPEG where it can be (VWR-E-03). */
export const rotateImage = (id: number, input: { rotate: 0 | 90 | 180 | 270; flip_h: boolean; flip_v: boolean; base_version: number }) =>
  apiPost<{ saved: boolean; version: number; method: 'lossless' | 'reencoded'; width: number; height: number }>(`/api/drive/image/${id}/rotate`, input);

/** A new version without GPS tags (VWR-E-08). */
export const stripLocation = (id: number, baseVersion: number) => apiPost<{ saved: boolean; version: number; gps_removed: boolean }>(`/api/drive/image/${id}/strip-location`, { base_version: baseVersion });

export const setRating = (id: number, stars: number) => apiPut<{ file_id: number; rating: ImageOpen['rating'] }>(`/api/drive/image/${id}/rating`, { stars });

export const setTags = (id: number, tags: string[]) => apiPut<{ tags: string[] }>(`/api/drive/files/${id}/tags`, { tags });

/** Two versions (`file:version`) or two files, ready to show side by side (VWR-E-04, SAV-09). */
export const compareImages = (a: string, b: string, signal?: AbortSignal) => apiGet<{ a: CompareSide; b: CompareSide }>('/api/drive/image/compare', { a, b }, signal);

export const libraries = (signal?: AbortSignal) => apiGet<{ company_id?: number; libraries: Partial<Record<keyof Libraries, LibraryShelf>> }>('/api/drive/image/libraries', undefined, signal);

export const listPresets = (kind: Preset['kind'], signal?: AbortSignal) => apiGet<{ presets: Preset[] }>('/api/drive/image/presets', { kind }, signal).then((r) => r.presets ?? []);
export const savePreset = (p: { kind: Preset['kind']; name: string; payload: Record<string, unknown>; scope?: 'personal' | 'org' }) => apiPost<Preset>('/api/drive/image/presets', p);
export const deletePreset = (id: number) => apiDelete(`/api/drive/image/presets/${id}`);

export const startBatch = (input: { file_ids: number[]; steps: BatchStep[]; output: 'versions' | 'copies'; folder_id?: number | null }) =>
  apiPost<{ job_id: number | string | null; renamed?: Array<{ id: number; from: string; to: string }>; skipped_files?: Array<{ file_id: number; name: string; reason: string }> }>('/api/drive/image/batch', input);
export const batchStatus = (job: number | string, signal?: AbortSignal) => apiGet<BatchJob>(`/api/drive/image/batch/${job}`, undefined, signal);
export const pauseBatch = (job: number | string, paused: boolean) => apiPost(`/api/drive/image/batch/${job}/${paused ? 'pause' : 'resume'}`);
export const cancelBatch = (job: number | string) => apiPost(`/api/drive/image/batch/${job}/cancel`);

/**
 * The AI assistant (AI-03…08): the picture goes downscaled to 1536 px and re-encoded (so no EXIF or GPS), only when
 * the person asks.
 */
export function askAi(id: number, input: { action: 'suggest' | 'alt_text' | 'caption' | 'crop' | 'generative'; prompt?: string; ratio?: string | null; image: Blob }, signal?: AbortSignal): Promise<AiAnswer> {
  const form = new FormData();
  form.append('action', input.action);
  if (input.prompt) form.append('prompt', input.prompt);
  if (input.ratio) form.append('ratio', input.ratio);
  form.append('image', input.image, 'picture.jpg');
  return request<AiAnswer>('POST', `/api/drive/image/${id}/ai`, { body: form, signal }).then((r) => r.data);
}

/** The `editor` block read for the editor: tools on, AI only when enabled, save defaults and limits (SET-03…08). */
export function editorOf(b: EditorBlock | null | undefined): EditorSettings {
  if (!b) return {};
  const ai = b.ai;
  const tools = Array.isArray(b.tools) ? (Object.fromEntries(RAIL_TOOLS.map((t) => [t, b.tools!.includes(t)])) as EditorSettings['tools']) : undefined;
  return {
    tools,
    ai: ai ? { available: ai.enabled === true, provider_label: ai.provider_label ?? null, actions: (ai.actions ?? []) as NonNullable<EditorSettings['ai']>['actions'], image_model: !ai.unavailable?.generative, reason: ai.reason ?? null, unavailable: ai.unavailable ?? null } : undefined,
    save_defaults: b.saving,
    limits: b.limits ? { render_bytes: (b.limits.max_render_mb ?? 60) * 1048576, recipe_bytes: (b.limits.max_recipe_mb ?? 24) * 1048576, batch_files: b.limits.batch_max_files ?? 500 } : undefined,
    quick_design: b.quick_design === true,
  };
}

export const RAIL_TOOLS = ['select', 'crop', 'adjust', 'filters', 'area', 'text', 'shapes', 'stickers', 'frames', 'draw', 'mark', 'redact'] as const;

/** The Drive description (AI-04 "Save to file description"). */
export const saveDescription = (id: number, description: string) => apiPut(`/api/drive/media/${id}/meta`, { description });

/** A comment pinned to an area of the picture (VWR-E-11). */
export const regionComment = (id: number, body: string, region: { x: number; y: number; w: number; h: number; version: number }) =>
  apiPost(`/api/drive/comments/file/${id}`, { body, mentions: [], region });

export const restoreVersion = (fileId: number, versionId: number) => apiPost(`/api/files/${fileId}/versions/${versionId}/restore`);

/** View only: ask the owner for Edit (SAV-06). */
export const requestEdit = (fileId: number, message?: string) => apiPost(`/api/drive/access/file/${fileId}/request-edit`, message ? { message } : {});

/** A signed `/media/…` or `/api/…` address the app can fetch. */
export function sourceUrl(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source.startsWith('/api/')) return apiUrl(source);
  if (source.startsWith('/media/')) return apiUrl(source);
  const at = source.indexOf('/media/');
  if (at >= 0) return apiUrl(source.slice(at));
  if (/^(https?:|blob:|data:)/.test(source)) return source;
  return null;
}
