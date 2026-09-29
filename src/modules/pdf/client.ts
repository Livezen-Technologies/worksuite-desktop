import { isIpcFailure } from '@shared/ipc/contract';
import type { PdfBitmap, PdfLocalPick, PdfSearchProgress, PdfSessionView, PdfSource } from '@shared/pdf';
import { call, DesktopError, on } from '../../core/bridge';

/**
 * PDF Studio's talk with the main process: sessions, pages and tickets over
 * `window.worksuite.pdf` (preload), never a path or a file's bytes.
 */
let seq = 0;
/** A render request's name, so a request scrolled past can be cancelled before it is drawn. */
export function ticket(): string {
  seq = (seq + 1) % 1e9;
  return `t${Date.now().toString(36)}${seq.toString(36)}`;
}

export function onSession(id: string, cb: (v: PdfSessionView) => void): () => void {
  return on<PdfSessionView>('pdf:changed', (v) => {
    if (v?.id === id) cb(v);
  });
}

export function onSearch(id: string, cb: (p: PdfSearchProgress) => void): () => void {
  return on<PdfSearchProgress>('pdf:search', (p) => {
    if (p?.session === id) cb(p);
  });
}

/** Where a tab's route says its PDF is: `?file=<Drive id>`, `?local=<handle>`, or `?mail=<uid>&ref=…&folder=…&mailbox=…&name=…`. */
export function sourceFromQuery(q: URLSearchParams): PdfSource | null {
  const file = q.get('file');
  if (file && /^\d{1,10}$/.test(file) && Number(file) > 0) return { kind: 'drive', fileId: Number(file) };
  const local = q.get('local');
  if (local && /^[A-Za-z0-9-]{8,64}$/.test(local)) return { kind: 'local', handle: local };
  const uid = q.get('mail');
  const ref = q.get('ref');
  const folder = q.get('folder');
  if (uid && /^\d{1,20}$/.test(uid) && ref && folder) {
    const mailbox = q.get('mailbox');
    return { kind: 'mail', uid, ref, folder, mailbox: mailbox && /^\d{1,20}$/.test(mailbox) ? mailbox : null, name: (q.get('name') || 'Attachment.pdf').slice(0, 255) };
  }
  return null;
}

export function routeFor(source: PdfSource): string {
  if (source.kind === 'drive') return `/pdf?file=${source.fileId}`;
  if (source.kind === 'local') return `/pdf?local=${source.handle}`;
  const q = new URLSearchParams({ mail: source.uid, ref: source.ref, folder: source.folder, name: source.name, ...(source.mailbox ? { mailbox: source.mailbox } : {}) });
  return `/pdf?${q.toString()}`;
}

/** Draws a rendered bitmap into a canvas of its size (raw RGBA) — or, for an encoded image, decodes it first. */
export async function paint(canvas: HTMLCanvasElement, b: PdfBitmap): Promise<boolean> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  if (b.format === 'rgba') {
    canvas.width = b.width;
    canvas.height = b.height;
    const pixels = new Uint8ClampedArray(b.data.buffer as ArrayBuffer, b.data.byteOffset, b.data.byteLength);
    ctx.putImageData(new ImageData(pixels, b.width, b.height), 0, 0);
    return true;
  }
  const bmp = await createImageBitmap(new Blob([b.data as BlobPart], { type: b.format === 'jpeg' ? 'image/jpeg' : 'image/png' }));
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return true;
}

export const pdf = {
  open: (source: PdfSource) => call('pdf:open', { source }),
  state: (session: string) => call('pdf:state', { session }),
  close: (session: string) => call('pdf:close', { session }),
};

/** PDFs from a real drop: the preload turns them into paths, the main process into handles (never the renderer). */
export async function registerDroppedPdfs(files: File[]): Promise<{ files: PdfLocalPick[]; rejected: Array<{ name: string; reason: string }> }> {
  const ns = (typeof window !== 'undefined' ? window.worksuite?.pdf : undefined) as { registerDropped?: (f: File[]) => Promise<unknown> } | undefined;
  if (!ns?.registerDropped) return { files: [], rejected: [] };
  const res = await ns.registerDropped(files);
  if (isIpcFailure(res)) throw new DesktopError(res.code, res.message);
  return res as { files: PdfLocalPick[]; rejected: Array<{ name: string; reason: string }> };
}
