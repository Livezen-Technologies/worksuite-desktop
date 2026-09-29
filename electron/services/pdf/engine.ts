import type {
  PdfAttachmentView,
  PdfDocInfo,
  PdfEngineCapabilities,
  PdfEngineErrorCode,
  PdfLinkView,
  PdfOutlineNode,
  PdfPageSize,
  PdfPermissions,
  PdfSearchHit,
  PdfSearchOptions,
  PdfSecurityReport,
} from '@shared/pdf';

/**
 * PDFEngineInterface (SRS §3.4, PDF-ARCH-001).
 *
 * Every engine call goes through this interface. Providers:
 *  - `PdfiumProvider` (pdfium-provider.ts): PDFium compiled to WebAssembly
 *    (@embedpdf/pdfium, MIT; PDFium BSD-3-Clause/Apache-2.0). Runs only in
 *    the pdf-worker utility process, one process per open document.
 *  - `WorkerEngine` (worker-engine.ts): the main process's side of that
 *    worker — the same interface, over messages.
 *  - A fake in the unit tests.
 *
 * MuPDF is not a provider: it is AGPL or commercial (§2.5 asks for licensing
 * to be cleared first). Swapping the provider changes nothing above this
 * interface (PDF-ARCH-003): the renderer, the IPC contract and what WorkSuite
 * stores never see which engine is behind it.
 *
 * Passwords go in and never come out: no method returns, logs or reports
 * one, and errors carry a code and a fixed sentence, never document text.
 */

/** How the engine reaches the file: the user's own file in place, or a sealed working copy (AES-256-GCM chunks). */
export type EngineFile = { kind: 'plain'; path: string; size: number } | { kind: 'sealed'; path: string; size: number; key: string };

export interface EngineOpened {
  pageCount: number;
  pages: PdfPageSize[];
  info: PdfDocInfo;
  permissions: PdfPermissions;
  /** What is known without walking the pages: encryption, document scripts, embedded files, XFA, signatures. */
  security: PdfSecurityReport;
}

export interface RenderRequest {
  page: number;
  /** Device pixels per PDF point. */
  scale: number;
  /** A part of the page in device pixels at this scale (PDF-VIEW-012); the whole page when absent. */
  tile?: { x: number; y: number; w: number; h: number };
  /** Draw annotations and form fields' appearances. */
  annotations: boolean;
  /** Printing quality (no LCD text, print appearances). */
  printing?: boolean;
  /** `rgba` for the screen; `bgra` for images the main process encodes. */
  order: 'rgba' | 'bgra';
}

export interface RenderedPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface SearchProgress {
  hits: PdfSearchHit[];
  pagesDone: number;
  truncated: boolean;
}

/** Cancelled when `cancelled` turns true; the engine checks between pages. */
export interface CancelToken {
  cancelled: boolean;
}

export interface PDFEngine {
  capabilities(): PdfEngineCapabilities;
  open(file: EngineFile, password: string | null): Promise<EngineOpened>;
  render(req: RenderRequest): Promise<RenderedPixels>;
  /** Streams hits as pages are searched (PDF-SRCH-004); resolves when done or cancelled. */
  search(query: string, options: PdfSearchOptions, onProgress: (p: SearchProgress) => void, cancel: CancelToken): Promise<void>;
  outline(): Promise<PdfOutlineNode[]>;
  links(page: number): Promise<PdfLinkView[]>;
  attachments(): Promise<PdfAttachmentView[]>;
  /** Walks every page and the file's structure for active content, reporting as it goes. */
  scan(onProgress: (s: PdfSecurityReport) => void, cancel: CancelToken): Promise<PdfSecurityReport>;
  close(): Promise<void>;
}

export class EngineError extends Error {
  constructor(
    readonly code: PdfEngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export function isEngineError(e: unknown): e is EngineError {
  return e instanceof Error && e.name === 'EngineError' && typeof (e as EngineError).code === 'string';
}

/** The sentence a person sees for each kind of engine failure. */
export const ENGINE_MESSAGES: Record<PdfEngineErrorCode, string> = {
  password: 'This PDF is protected with a password.',
  format: 'This file is not a PDF, or it is damaged beyond reading.',
  file: 'The file could not be read.',
  security: 'This PDF uses a kind of protection that cannot be opened here.',
  page: 'That page could not be read.',
  memory: 'This PDF needs more memory than WorkSuite allows for one document.',
  timeout: 'The PDF engine stopped answering.',
  crashed: 'The PDF engine stopped unexpectedly.',
  cancelled: 'Cancelled.',
  unsupported: 'This is not available for this PDF.',
  unknown: 'The PDF could not be opened.',
};
