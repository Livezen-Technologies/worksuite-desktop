import type { PosReceiptLogo } from '@shared/pos';

/**
 * A picture as a receipt logo: scaled to fit `maxDots` across (a multiple of 8, as the printer takes it) and at most
 * `maxHeight` down, made black and white at a threshold on its brightness (transparent is white), and kept both as
 * dots for ESC/POS (`GS v 0`, a row at a time, most significant bit first) and as a PNG of those same dots for the
 * screen and the driver's page.
 */
export function logoFromPixels(rgba: Uint8ClampedArray, width: number, height: number, threshold = 160): { rows: Uint8Array; bytesWide: number } {
  const bytesWide = Math.ceil(width / 8);
  const rows = new Uint8Array(bytesWide * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3]! / 255;
      // brightness over white
      const lum = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) * a + 255 * (1 - a);
      if (lum < threshold) rows[y * bytesWide + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { rows, bytesWide };
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Size to draw a picture at: as wide as fits `maxDots` (rounded down to 8), never taller than `maxHeight`. */
export function logoSize(w: number, h: number, maxDots: number, maxHeight = 200): { width: number; height: number } {
  let width = Math.min(maxDots, w);
  let height = Math.round((h * width) / w);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round((w * height) / h);
  }
  width = Math.max(8, Math.floor(width / 8) * 8);
  return { width, height: Math.max(1, Math.round((h * width) / w)) };
}

/** A logo from an image file the person chose (in the browser: a canvas does the drawing). */
export async function logoFromFile(file: File, maxDots: number, threshold = 160): Promise<PosReceiptLogo> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = logoSize(bitmap.width, bitmap.height, maxDots);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This picture could not be read.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const { rows, bytesWide } = logoFromPixels(img.data, width, height, threshold);
  // the PNG is the dots themselves, so the screen shows what the printer prints
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const on = (rows[y * bytesWide + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
      const i = (y * width + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = on ? 0 : 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { png: canvas.toDataURL('image/png'), width, height, raster: toBase64(rows) };
}
