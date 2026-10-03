/**
 * Pictures inside a message (worksuite-desktop#188).
 *
 * A picture is kept in the editor and the draft as a `data:` URL and goes out
 * as an inline part shown by `cid:` — the server turns each embedded picture
 * into a part of its own when it sends (Mail's InlineImages), so the `data:`
 * URL itself never reaches a recipient. Before it goes in, a big picture is
 * made smaller here: no wider than 1600 px and about 1 MB at most, as a JPEG
 * (or a PNG when it has transparency and stays small enough). WebP and other
 * types become JPEG or PNG — Outlook shows neither WebP nor SVG.
 */

export const IMAGE_MAX_BYTES = 1_000_000;
export const IMAGE_MAX_WIDTH = 1600;
/** Most servers refuse a message over 25 MB; this is when the composer says so. */
export const MESSAGE_WARN_BYTES = 20 * 1024 * 1024;
export const MESSAGE_MAX_BYTES = 25 * 1024 * 1024;
/**
 * Pictures inside the message travel in the send request as base64 (a
 * third bigger), and the app's API proxy takes requests up to 25 MB: past
 * this, some have to go as attachments (which are uploaded on their own).
 */
export const INLINE_MAX_BYTES = 17 * 1024 * 1024;

const SAFE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];

export interface Source {
  width: number;
  height: number;
  bytes: number;
  type: string;
  /** PNG/GIF with see-through pixels: a JPEG would turn them black (or white). */
  transparent?: boolean;
}

/** Draws the picture at a size and encodes it; the browser's canvas in the app, a fake in tests. */
export type Encoder = (width: number, height: number, type: 'image/jpeg' | 'image/png', quality: number) => Promise<Blob>;

export interface Fitted {
  /** Null: the original is fine as it is. */
  blob: Blob | null;
  width: number;
  height: number;
  type: string;
  shrunk: boolean;
}

/**
 * How to make a picture fit: as it is when it is a safe type, small and
 * narrow enough; otherwise narrower and re-encoded, stepping the JPEG
 * quality and then the size down until it is under the limit.
 */
export async function fitImage(src: Source, encode: Encoder, maxBytes = IMAGE_MAX_BYTES, maxWidth = IMAGE_MAX_WIDTH): Promise<Fitted> {
  if (SAFE_TYPES.includes(src.type) && src.bytes <= maxBytes && src.width <= maxWidth) return { blob: null, width: src.width, height: src.height, type: src.type, shrunk: false };
  let scale = Math.min(1, maxWidth / Math.max(1, src.width));
  const type = src.transparent ? 'image/png' : 'image/jpeg';
  let last: Blob | null = null;
  for (let round = 0; round < 8; round++) {
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    for (const q of type === 'image/jpeg' ? [0.85, 0.75, 0.65] : [1]) {
      last = await encode(w, h, type, q);
      if (last.size <= maxBytes) return { blob: last, width: w, height: h, type, shrunk: true };
    }
    // A PNG that will not get small enough goes as a JPEG after all.
    if (type === 'image/png' && round === 1) {
      last = await encode(w, h, 'image/jpeg', 0.8);
      if (last.size <= maxBytes) return { blob: last, width: w, height: h, type: 'image/jpeg', shrunk: true };
    }
    scale *= 0.75;
  }
  return { blob: last, width: Math.round(src.width * scale), height: Math.round(src.height * scale), type, shrunk: true };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/** The bytes a data: URL stands for. */
export function dataUrlBytes(url: string): number {
  const at = url.indexOf(',');
  if (at < 0) return 0;
  const b64 = url.slice(at + 1).replace(/\s/g, '');
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

/** Every picture embedded in the message, in bytes (the same picture used twice goes once). */
export function embeddedBytes(html: string): number {
  const seen = new Set<string>();
  let total = 0;
  for (const m of html.matchAll(/src="(data:image\/[a-z]+;base64,[^"]+)"/gi)) {
    if (seen.has(m[1]!)) continue;
    seen.add(m[1]!);
    total += dataUrlBytes(m[1]!);
  }
  return total;
}

export function dataUrlToFile(url: string, name: string): File {
  const [head, b64 = ''] = url.split(',');
  const type = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] ?? 'bin');
  return new File([bytes], /\.[a-z0-9]{2,4}$/i.test(name) ? name : `${name}.${ext}`, { type });
}

/** Loads a picture from a file to its pixels, with the browser's decoder. */
function load(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file is not a picture WorkSuite can read.'));
    };
    img.src = url;
  });
}

function canvasEncoder(img: CanvasImageSource): Encoder {
  return (w, h, type, quality) =>
    new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Pictures cannot be resized here.'));
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be encoded.'))), type, quality);
    });
}

/**
 * A logo that disappears in dark mode (worksuite-desktop#166): see-through
 * around dark marks — on a dark background, nothing shows. `pixels` is RGBA.
 */
export function darkModeRisk(pixels: ArrayLike<number>): boolean {
  let clear = 0;
  let lum = 0;
  let solid = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3]!;
    if (a < 250) clear++;
    if (a < 64) continue;
    solid++;
    lum += (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
  }
  return clear > 0 && solid > 0 && lum / solid < 0.35;
}

/** Reads a picture's pixels and says whether it would vanish on a dark background. */
export async function darkModeRiskOf(src: string): Promise<boolean> {
  try {
    // An <img> rather than fetch: the app may show pictures (data:, the WorkSuite server) it may not fetch.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      if (/^https?:/i.test(src)) i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('unreadable'));
      i.src = src;
    });
    const w = Math.min(96, img.naturalWidth || 96);
    const h = Math.min(96, img.naturalHeight || 96);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    return darkModeRisk(ctx.getImageData(0, 0, w, h).data);
  } catch {
    // A picture whose pixels cannot be read (another site's, without CORS) is not judged.
    return false;
  }
}

function hasTransparency(img: HTMLImageElement): boolean {
  try {
    const w = Math.min(64, img.naturalWidth);
    const h = Math.min(64, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]! < 250) return true;
  } catch {
    /* a canvas that cannot be read: treat as opaque */
  }
  return false;
}

export interface Prepared {
  src: string;
  width: number;
  height: number;
  bytes: number;
  shrunk: boolean;
}

/**
 * A picture file made ready to go inside the message. `maxBytes`: a
 * signature's pictures are kept to about 500 KB. An SVG is drawn and goes
 * as a PNG (no mail client can be trusted with SVG).
 */
export async function prepareImage(file: Blob, maxBytes = IMAGE_MAX_BYTES, maxWidth = IMAGE_MAX_WIDTH): Promise<Prepared> {
  const img = await load(file);
  try {
    // An SVG without a size of its own draws at 300 px wide.
    const width = img.naturalWidth || 300;
    const height = img.naturalHeight || Math.round(width / 2);
    const transparent = file.type !== 'image/jpeg' && (file.type === 'image/svg+xml' || hasTransparency(img));
    const fitted = await fitImage({ width, height, bytes: file.size, type: file.type, transparent }, canvasEncoder(img), maxBytes, maxWidth);
    const blob = fitted.blob ?? file;
    return { src: await blobToDataUrl(blob), width: fitted.width, height: fitted.height, bytes: blob.size, shrunk: fitted.shrunk };
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export interface CropBox {
  /** Percent of the picture taken off each side. */
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The pixel rectangle a crop keeps (at least 1×1). */
export function cropRect(width: number, height: number, box: CropBox): { x: number; y: number; w: number; h: number } {
  const clamp = (n: number) => Math.max(0, Math.min(95, n || 0));
  const x = Math.round((width * clamp(box.left)) / 100);
  const y = Math.round((height * clamp(box.top)) / 100);
  const w = Math.max(1, Math.round(width - x - (width * clamp(box.right)) / 100));
  const h = Math.max(1, Math.round(height - y - (height * clamp(box.bottom)) / 100));
  return { x, y, w, h };
}

/** A picture cut down to a crop. */
export async function cropImage(src: string, box: CropBox): Promise<string> {
  const img = await load(await (await fetch(src)).blob());
  try {
    const r = cropRect(img.naturalWidth, img.naturalHeight, box);
    const canvas = document.createElement('canvas');
    canvas.width = r.w;
    canvas.height = r.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Pictures cannot be cropped here.');
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const type = /^data:image\/png/.test(src) ? 'image/png' : 'image/jpeg';
    return canvas.toDataURL(type, 0.88);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export type ImageSize = 'small' | 'medium' | 'original' | 'full';
export type ImageAlign = 'inline' | 'left' | 'center' | 'right';

const PRESET_PX: Record<'small' | 'medium', number> = { small: 200, medium: 400 };

/** How wide a picture shows, written both ways Outlook and the rest read it. */
export function sizeImage(img: HTMLImageElement, size: ImageSize | number): void {
  const natural = img.naturalWidth || Number(img.getAttribute('data-width')) || 0;
  img.removeAttribute('height');
  img.style.removeProperty('height');
  if (size === 'full') {
    img.setAttribute('width', '100%');
    img.style.width = '100%';
  } else {
    const px = typeof size === 'number' ? Math.round(size) : size === 'original' ? Math.min(natural || 600, 1600) : PRESET_PX[size];
    img.setAttribute('width', String(Math.max(16, px)));
    img.style.width = `${Math.max(16, px)}px`;
  }
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
}

/** Where a picture sits: in the line, or on the left/right with text around it, or centred on its own. */
export function alignImage(img: HTMLImageElement, align: ImageAlign): void {
  for (const p of ['float', 'display', 'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom']) img.style.removeProperty(p);
  img.removeAttribute('align');
  if (align === 'left' || align === 'right') {
    img.setAttribute('align', align);
    img.style.cssFloat = align;
    img.style.margin = align === 'left' ? '0 12px 8px 0' : '0 0 8px 12px';
  } else if (align === 'center') {
    img.style.display = 'block';
    img.style.marginLeft = 'auto';
    img.style.marginRight = 'auto';
  }
}

export function alignOf(img: HTMLImageElement): ImageAlign {
  if (img.style.cssFloat === 'left' || img.getAttribute('align') === 'left') return 'left';
  if (img.style.cssFloat === 'right' || img.getAttribute('align') === 'right') return 'right';
  if (img.style.display === 'block' && img.style.marginLeft === 'auto') return 'center';
  return 'inline';
}

export function imageHtml(p: { src: string; alt?: string; width?: number }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const w = p.width ? Math.min(p.width, 600) : 0;
  return `<img src="${esc(p.src)}" alt="${esc(p.alt ?? '')}"${w ? ` width="${w}" style="width: ${w}px; max-width: 100%; height: auto"` : ' style="max-width: 100%; height: auto"'}>`;
}
