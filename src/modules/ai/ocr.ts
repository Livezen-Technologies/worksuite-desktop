import type { OcrProgress, OcrResult } from '@shared/ocr';
import { call, on } from '../../core/bridge';

/** One picture read on this computer (worksuite-desktop#59): its progress as it goes, and Stop. */
export interface OcrJob {
  done: Promise<OcrResult>;
  cancel(): void;
}

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9-]/g, '');

export function readImage(png: Uint8Array<ArrayBuffer>, onProgress: (p: OcrProgress) => void): OcrJob {
  const id = newId();
  const off = on<OcrProgress>('ai:ocrProgress', (p) => {
    if (p.id === id) onProgress(p);
  });
  const done: Promise<OcrResult> = call('ai:ocr', { id, png }).finally(off);
  return { done, cancel: () => void call('ai:ocrCancel', { id }).catch(() => undefined) };
}
