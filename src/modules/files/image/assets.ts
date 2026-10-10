import { apiGet, apiUrl } from '../../../core/api';
import { call, hasDesktop } from '../../../core/bridge';
import { libraries as fetchLibraries, type Libraries, type LibraryItem } from './api';
import type { AssetLookup, Drawable } from './render';
import { recolourSvg, sanitiseSvg, stickerById, stickerSvg } from './stickers';

/**
 * Brand libraries and the pictures a recipe draws (CRT-30…34, DSK-04).
 *
 * The library list and every item used are kept on this computer after first use, so stickers, frames, fonts and
 * logos work offline. An item the person cannot view (or that is gone) is never fetched another way: it draws as a
 * grey placeholder, and the saved pixels are not touched (CRT-34).
 */

const EMPTY: Libraries = { stickers: [], frames: [], fonts: [], logos: [] };

async function cacheGet(key: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  if (!hasDesktop()) return null;
  try {
    const hit = await call('image:cacheGet', { key });
    return hit ? { bytes: new Uint8Array(hit.bytes), type: hit.type } : null;
  } catch {
    return null;
  }
}

async function cachePut(key: string, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<void> {
  if (!hasDesktop() || !bytes.byteLength) return;
  await call('image:cachePut', { key, bytes, type }).catch(() => undefined);
}

export interface LibraryFolders {
  stickers?: { name: string; count: number } | null;
  frames?: { name: string; count: number } | null;
  fonts?: { name: string; count: number } | null;
  logos?: { name: string; count: number } | null;
}

const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

/** The libraries: from the server when it answers (and kept), else the copy kept here (DSK-04). */
export async function loadLibraries(signal?: AbortSignal): Promise<{ libraries: Libraries; offline: boolean; folders: LibraryFolders; reasons: Partial<Record<keyof Libraries, string | null>> }> {
  try {
    const r = await fetchLibraries(signal);
    const libs: Libraries = { stickers: [], frames: [], fonts: [], logos: [] };
    const folders: LibraryFolders = {};
    const reasons: Partial<Record<keyof Libraries, string | null>> = {};
    for (const k of ['stickers', 'frames', 'fonts', 'logos'] as const) {
      const shelf = r.libraries?.[k];
      libs[k] = (shelf?.items ?? []).map((it) => ({ ...it, mime_type: it.mime_type ?? MIME[it.kind ?? ''] ?? null, vector: it.vector ?? it.kind === 'svg' }));
      folders[k] = shelf?.available ? { name: shelf.folder ?? k, count: shelf.items.length } : null;
      reasons[k] = shelf?.reason ?? null;
    }
    void cachePut('libraries', new TextEncoder().encode(JSON.stringify({ ...libs, folders, reasons })), 'application/json');
    return { libraries: libs, offline: false, folders, reasons };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const kept = await cacheGet('libraries');
    if (!kept) return { libraries: EMPTY, offline: true, folders: {}, reasons: {} };
    try {
      const j = JSON.parse(new TextDecoder().decode(kept.bytes)) as Libraries & { folders?: LibraryFolders; reasons?: Partial<Record<keyof Libraries, string | null>> };
      return { libraries: { stickers: j.stickers ?? [], frames: j.frames ?? [], fonts: j.fonts ?? [], logos: j.logos ?? [] }, offline: true, folders: j.folders ?? {}, reasons: j.reasons ?? {} };
    } catch {
      return { libraries: EMPTY, offline: true, folders: {}, reasons: {} };
    }
  }
}

/** A library item's picture as a blob URL for a thumbnail: fetched with the session (SVGs must be), kept for offline. */
export async function itemPicture(item: LibraryItem): Promise<string | null> {
  const got = await itemBytes(item, item.file_id, item.version);
  if (!got) return null;
  if (isSvg(got.type, got.bytes)) {
    const clean = sanitiseSvg(new TextDecoder().decode(got.bytes));
    return clean ? URL.createObjectURL(new Blob([clean], { type: 'image/svg+xml' })) : null;
  }
  return URL.createObjectURL(new Blob([got.bytes.slice().buffer], { type: got.type }));
}

const itemKey = (fileId: number, version: number) => `item:${fileId}:${version}`;

function addressOf(u: string): string {
  if (u.startsWith('/api/') || u.startsWith('/media/')) return apiUrl(u);
  return u;
}

/** One item's bytes: kept here, or fetched (and kept). Null when it cannot be had — no access, or gone. */
export async function itemBytes(item: Pick<LibraryItem, 'file_id' | 'version' | 'url' | 'mime_type'> | null, fileId: number, version: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  const key = itemKey(fileId, version);
  const kept = await cacheGet(key);
  if (kept) return kept;
  let url = item?.url ?? null;
  if (!url) {
    // A file picked from the Drive (CRT-32) rather than a library: its own preview address, which DriveGuard checks.
    try {
      const p = await apiGet<{ url: string | null; status?: string }>(`/api/drive/preview/${fileId}`);
      url = p.url;
    } catch {
      return null;
    }
  }
  if (!url) return null;
  try {
    const res = await fetch(addressOf(url));
    if (!res.ok) return null;
    const type = res.headers.get('content-type')?.split(';')[0] ?? item?.mime_type ?? 'application/octet-stream';
    const bytes = new Uint8Array(await res.arrayBuffer());
    void cachePut(key, bytes, type);
    return { bytes, type };
  } catch {
    return null;
  }
}

function isSvg(type: string, bytes: Uint8Array): boolean {
  if (type.includes('svg')) return true;
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

async function pictureOf(blob: Blob): Promise<Drawable> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Kept until decoded; an <img> holds its pixels after that.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export async function svgPicture(svg: string): Promise<Drawable> {
  return pictureOf(new Blob([svg], { type: 'image/svg+xml' }));
}

/** Registers the brand fonts with the page (CRT-11): their families become choosable, offline too once kept. */
export async function loadBrandFonts(items: LibraryItem[]): Promise<string[]> {
  const out: string[] = [];
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return out;
  for (const f of items) {
    const family = (f.family || f.name.replace(/\.[^.]+$/, '').replace(/[-_](Regular|Bold|Italic|Medium|Light)$/i, '')).trim();
    if (!family) continue;
    const got = await itemBytes(f, f.file_id, f.version);
    if (!got) continue;
    try {
      const face = new FontFace(family, got.bytes.slice().buffer);
      await face.load();
      document.fonts.add(face);
      if (!out.includes(family)) out.push(family);
    } catch {
      /* not a font this computer can read */
    }
  }
  return out;
}

/**
 * The pictures a recipe draws, loaded as they are asked for: built-in stickers (made from their colour and outline),
 * library items (by Drive id and version), and pictures dropped in from this computer.
 */
export class AssetStore implements AssetLookup {
  private map = new Map<string, Drawable | 'missing'>();
  private pending = new Map<string, Promise<void>>();
  private items = new Map<string, LibraryItem>();

  /** A dropped-in picture's data URL by its layer id (the editor keeps it current). */
  private dataOf: (objectId: string) => string | null = () => null;

  readData(fn: (objectId: string) => string | null): void {
    this.dataOf = fn;
  }

  constructor(private readonly onLoad: () => void) {}

  setLibraries(l: Libraries): void {
    this.items.clear();
    for (const it of [...l.stickers, ...l.frames, ...l.logos]) this.items.set(`${it.file_id}:${it.version}`, it);
  }

  get(key: string): Drawable | 'missing' | null {
    if (!key) return null;
    const v = this.map.get(key);
    if (v !== undefined) return v;
    void this.load(key);
    return null;
  }

  /** Waits for every one of `keys` (before saving, so nothing is drawn half-loaded). */
  async ensure(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.load(k)));
  }

  load(key: string): Promise<void> {
    if (this.map.has(key)) return Promise.resolve();
    const running = this.pending.get(key);
    if (running) return running;
    const p = this.fetch(key)
      .then((d) => void this.map.set(key, d ?? 'missing'))
      .catch(() => void this.map.set(key, 'missing'))
      .finally(() => {
        this.pending.delete(key);
        this.onLoad();
      });
    this.pending.set(key, p);
    return p;
  }

  private async fetch(key: string): Promise<Drawable | null> {
    const [kind, ...rest] = key.split(':');
    if (kind === 'builtin') {
      const [id, colour, ...outline] = rest;
      const s = stickerById(id);
      if (!s) return null;
      const o = outline.join(':');
      const [w, c] = o === '-' ? ['0', '#000000'] : o.split(':');
      return svgPicture(stickerSvg(s, colour ?? s.colour, { on: o !== '-', width: Number(w) || 0, colour: c ?? '#000000' }));
    }
    if (kind === 'data') {
      const data = this.dataOf(rest.join(':'));
      if (!data) return null;
      const res = await fetch(data);
      return pictureOf(await res.blob());
    }
    if (kind === 'asset') {
      const fileId = Number(rest[0]);
      const version = Number(rest[1]);
      const colour = rest[2] ?? null;
      const item = this.items.get(`${fileId}:${version}`) ?? null;
      const got = await itemBytes(item, fileId, version);
      if (!got) return null;
      if (isSvg(got.type, got.bytes)) {
        const clean = sanitiseSvg(new TextDecoder().decode(got.bytes));
        if (!clean) return null;
        return svgPicture(colour ? recolourSvg(clean, colour) : clean);
      }
      return pictureOf(new Blob([got.bytes.slice().buffer], { type: got.type }));
    }
    return null;
  }

  /** A picture dropped in, ready at once. */
  put(key: string, d: Drawable): void {
    this.map.set(key, d);
  }

  forget(key: string): void {
    this.map.delete(key);
  }
}
