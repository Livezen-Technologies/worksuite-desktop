import { text } from '../../core/i18n';
import { admit } from './vision';

/**
 * Images in the composer (worksuite-desktop#59), in the window: checked as they are attached, kept as they are until
 * sent, and drawn again only to send — a PNG for the text reader on this computer, a smaller JPEG for online AI.
 * Every format the person attaches (GIF's first frame, BMP) leaves here as one of those two.
 */

export interface AskImage {
  id: string;
  name: string;
  size: number;
  blob: Blob;
  /** An object URL for the thumbnail and the preview; revoked when the image is removed or the conversation ends. */
  url: string;
  width: number;
  height: number;
}

/** One picture for online AI: base64, as `POST /api/ai/assist/chat` takes it. */
export interface UploadImage {
  name: string;
  mime: 'image/jpeg' | 'image/png';
  data: string;
}

/** The longest side sent online: vision models scale larger pictures down anyway. */
export const UPLOAD_SIDE = 2048;
/** The longest side the text reader is given: more detail stops helping, and costs memory. */
export const OCR_SIDE = 4000;

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function decode(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') throw new Error('Images cannot be opened here.');
  return createImageBitmap(blob);
}

/** Files offered by the picker, a drop or a paste: those that may be attached, and a sentence for each that may not. */
export async function admitImages(already: number, files: File[]): Promise<{ added: AskImage[]; problems: string[] }> {
  const offered = await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, head: new Uint8Array(await f.slice(0, 16).arrayBuffer()) })));
  const { accepted, problems } = admit(already, offered);
  const added: AskImage[] = [];
  for (const i of accepted) {
    const f = files[i]!;
    const name = f.name || text('Pasted image');
    try {
      const bmp = await decode(f);
      added.push({ id: newId(), name, size: f.size, blob: f, url: URL.createObjectURL(f), width: bmp.width, height: bmp.height });
      bmp.close();
    } catch {
      problems.push(text('“{name}” could not be opened as an image. It may be damaged.', { name }));
    }
  }
  return { added, problems };
}

/** The picture drawn at most `side` pixels on its longest side, on white (a transparent PNG reads as black otherwise). */
async function draw(img: AskImage, side: number, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  const bmp = await decode(img.blob);
  try {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('The image could not be drawn.');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    return await canvas.convertToBlob({ type, quality });
  } finally {
    bmp.close();
  }
}

/** For the text reader on this computer. */
export async function ocrPng(img: AskImage): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await draw(img, OCR_SIDE, 'image/png')).arrayBuffer());
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** For online AI: a JPEG at most 2048 px on its longest side, made smaller until it is under 2 MB. */
export async function uploadImage(img: AskImage): Promise<UploadImage> {
  let blob = await draw(img, UPLOAD_SIDE, 'image/jpeg', 0.9);
  for (let side = Math.round(UPLOAD_SIDE * 0.75); blob.size > 2 * 1024 * 1024 && side >= 512; side = Math.round(side * 0.75)) blob = await draw(img, side, 'image/jpeg', 0.8);
  return { name: img.name, mime: 'image/jpeg', data: base64(new Uint8Array(await blob.arrayBuffer())) };
}
