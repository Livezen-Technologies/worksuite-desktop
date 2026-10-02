import { z } from 'zod';

/**
 * Text read from images on this computer (worksuite-desktop#59): Tesseract (tesseract.js, WebAssembly) in the main
 * process, with its English, Sinhala and Tamil language data downloaded the first time text is read — each file pinned
 * by size and SHA-256, and never used otherwise. Mixed-language images are read with all three at once.
 */

export const OCR_LANGUAGES = ['eng', 'sin', 'tam'] as const;
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

export interface OcrLanguageFile {
  id: OcrLanguage;
  label: string;
  /** tesseract.js-data's `4.0.0_best_int` traineddata, gzipped, as jsDelivr serves the npm package. */
  url: string;
  bytes: number;
  sha256: string;
}

const DATA = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';

export const OCR_LANGUAGE_FILES: Record<OcrLanguage, OcrLanguageFile> = {
  eng: { id: 'eng', label: 'English', url: `${DATA}/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz`, bytes: 2_952_873, sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91' },
  sin: { id: 'sin', label: 'Sinhala', url: `${DATA}/sin@1.0.0/4.0.0_best_int/sin.traineddata.gz`, bytes: 1_138_317, sha256: '02d34b1f6565d26991fa25605c0bbddd3e39d9eefe471fce4b8a27fe9363ec94' },
  tam: { id: 'tam', label: 'Tamil', url: `${DATA}/tam@1.0.0/4.0.0_best_int/tam.traineddata.gz`, bytes: 1_446_167, sha256: '2c4b255ede87931cb56c20a5b2b8e2cda4913e34fb3e4957f9b9e04ea069ff21' },
};

/** The largest picture handed to the reader: a PNG the window made, at most this many bytes. */
export const OCR_MAX_BYTES = 40 * 1024 * 1024;

export const ocrRequestSchema = z.strictObject({
  /** The window's id for this job, so it can be cancelled. */
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  /** A PNG the window drew from the person's image (any format they attached, GIF's first frame). */
  png: z.instanceof(Uint8Array).refine((b) => b.byteLength > 8 && b.byteLength <= OCR_MAX_BYTES, 'The picture is empty or too large to read.'),
  languages: z.array(z.enum(OCR_LANGUAGES)).min(1).max(3).optional(),
});
export type OcrRequest = z.infer<typeof ocrRequestSchema>;

export interface OcrWord {
  text: string;
  /** 0–100, as Tesseract reports it. */
  confidence: number;
}

/** One line as it reads; a paragraph break is an empty line between. */
export interface OcrLine {
  words: OcrWord[];
}

export interface OcrResult {
  lines: OcrLine[];
  /** Tesseract's own confidence for the whole page, 0–100. */
  confidence: number;
  languages: OcrLanguage[];
  ms: number;
  cancelled: boolean;
}

export interface OcrStatus {
  languages: Array<{ id: OcrLanguage; label: string; bytes: number; installed: boolean }>;
}

/** Where a job is, sent to the window that asked (`ai:ocrProgress`). */
export interface OcrProgress {
  id: string;
  stage: 'downloading' | 'loading' | 'recognizing';
  /** 0–1 where it can tell. */
  progress: number | null;
}
