/**
 * PDF Studio (WorkSuite PDF Studio SRS, stages D1 — the viewer — and D2 —
 * annotating, organising pages, saving, locks, recovery): what the
 * renderer, the main process and the engine worker say to each other.
 *
 * Plain data and pure helpers only, so the sandboxed preload, the renderer,
 * the main process and the utility process can all import it.
 *
 *   renderer ──window.worksuite.pdf.*──▶ main: DesktopPdfService ──message──▶ pdf-worker (PDFium, WebAssembly)
 *
 * The renderer holds a session id and page numbers, never a path, a URL of
 * the file or the file's bytes (PDF-API-001); the engine never runs in the
 * renderer (§2.5).
 */
import { z } from 'zod';

// ── sources ──────────────────────────────────────────────────────────────

const handle = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

/**
 * Where a PDF comes from (SRS §5). A Drive file by its id; a file on this
 * computer by the handle a dialog, a drop or the OS issued; a mail
 * attachment by the parts the main process builds its address from.
 */
export const pdfSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('drive'), fileId: z.number().int().positive().max(2 ** 31) }),
  z.strictObject({ kind: z.literal('local'), handle }),
  z.strictObject({
    kind: z.literal('mail'),
    uid: z.string().regex(/^\d{1,20}$/),
    ref: z.string().min(1).max(512),
    folder: z.string().regex(/^[A-Za-z0-9._\-/ ]{1,128}$/),
    mailbox: z.string().regex(/^\d{1,20}$/).nullable(),
    name: z.string().min(1).max(255),
  }),
]);
export type PdfSource = z.infer<typeof pdfSourceSchema>;
export type PdfSourceKind = PdfSource['kind'];

// ── the engine (§3.4, PDF-ARCH-001…005) ───────────────────────────────────

/**
 * What the engine behind `PDFEngineInterface` can do, asked at run time
 * (PDF-ARCH-005). The UI hides what is false. `javascript` is always false:
 * no provider may run a document's scripts (PDF-SEC-030).
 */
export interface PdfEngineCapabilities {
  engine: string;
  version: string;
  render: boolean;
  tiles: boolean;
  text: boolean;
  search: boolean;
  regex: boolean;
  outline: boolean;
  links: boolean;
  attachments: boolean;
  layers: boolean;
  annotationsRead: boolean;
  annotationsWrite: boolean;
  pages: boolean;
  save: boolean;
  editText: boolean;
  aes256: boolean;
  pades: boolean;
  javascript: false;
}

/** Errors the engine reports, by kind — never with document text or a password in them. */
export type PdfEngineErrorCode = 'password' | 'format' | 'file' | 'security' | 'page' | 'memory' | 'timeout' | 'crashed' | 'cancelled' | 'unsupported' | 'unknown';

export interface PdfDocInfo {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  created: string;
  modified: string;
  /** "1.7", "2.0"… */
  version: string;
}

/** The PDF's own permission flags (its /P entry), as they apply to whoever opened it. PDF-SEC-021. */
export interface PdfPermissions {
  print: boolean;
  printHighQuality: boolean;
  copy: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
  assemble: boolean;
}

/** By security-handler revision: 2 → RC4 40-bit, 3 → RC4 128-bit, 4 → 128-bit (RC4 or AES by crypt filter), 5–6 → AES-256. */
export type PdfEncryption = 'none' | 'rc4-40' | 'rc4-128' | '128-bit' | 'aes-256' | 'unknown';

export function encryptionOf(revision: number): PdfEncryption {
  if (revision < 0) return 'none';
  if (revision === 2) return 'rc4-40';
  if (revision === 3) return 'rc4-128';
  if (revision === 4) return '128-bit';
  if (revision === 5 || revision === 6) return 'aes-256';
  return 'unknown';
}

/**
 * Active and dangerous content found in the document (§12.5). Nothing here
 * is ever run: the counts are for the banner (PDF-SEC-035) and Properties.
 */
export interface PdfSecurityReport {
  encrypted: boolean;
  encryption: PdfEncryption;
  /** Document-level scripts, page open/close actions, and script tokens in the file's structure. */
  javascript: number;
  /** Actions that start another program or open a file (links, bookmarks, the file's structure). */
  launchActions: number;
  /** Links to web addresses: each asks first, or follows the organisation's rule (PDF-SEC-032). */
  externalLinks: number;
  /** Links into other PDF files, form submissions, imports and media: never followed. */
  otherActions: number;
  embeddedFiles: number;
  /** Embedded files that would run as a program if opened. */
  dangerousFiles: number;
  xfa: boolean;
  signatures: number;
  /** Pages checked so far (the scan runs in the background on large files). */
  pagesScanned: number;
  /** Whether the whole-file structure scan has finished. */
  structureScanned: boolean;
}

export function emptySecurity(): PdfSecurityReport {
  return { encrypted: false, encryption: 'none', javascript: 0, launchActions: 0, externalLinks: 0, otherActions: 0, embeddedFiles: 0, dangerousFiles: 0, xfa: false, signatures: 0, pagesScanned: 0, structureScanned: false };
}

/** Whether anything active was found (and therefore blocked). */
export function activeContentBlocked(s: PdfSecurityReport): boolean {
  return s.javascript > 0 || s.launchActions > 0 || s.otherActions > 0 || s.xfa || s.embeddedFiles > 0;
}

/** One page's size in points, as displayed (its own rotation applied). */
export type PdfPageSize = [width: number, height: number];

export interface PdfOutlineNode {
  title: string;
  /** Zero-based page, or null for an entry that goes nowhere in this file. */
  page: number | null;
  /** What following it would do other than going to a page (never done). */
  action?: 'uri' | 'launch' | 'remote' | 'other';
  children: PdfOutlineNode[];
}

/** A rectangle on a page, in points from the page's top-left corner as displayed. */
export type PdfRect = [x: number, y: number, w: number, h: number];

export interface PdfLinkView {
  index: number;
  rect: PdfRect;
  kind: 'page' | 'uri' | 'launch' | 'remote' | 'other';
  /** Zero-based target page, for `page`. */
  page?: number;
  /** The address, for `uri` — shown in the tooltip; following it goes back to the main process, which reads it again. */
  uri?: string;
}

export interface PdfAttachmentView {
  index: number;
  name: string;
  size: number;
  /** Would run as a program if opened; never opened here (PDF-SEC-033, PDF-EDIT-043). */
  dangerous: boolean;
}

// ── search (§6.3) ────────────────────────────────────────────────────────

export const pdfSearchOptionsSchema = z.strictObject({
  matchCase: z.boolean(),
  wholeWord: z.boolean(),
  regex: z.boolean(),
  /** PDF-SRCH-002: the pages' text, and optionally comments and bookmarks. */
  comments: z.boolean(),
  bookmarks: z.boolean(),
});
export type PdfSearchOptions = z.infer<typeof pdfSearchOptionsSchema>;

export interface PdfSearchHit {
  source: 'text' | 'comment' | 'bookmark';
  page: number;
  /** Character index on the page (text hits), for ordering. */
  index: number;
  before: string;
  match: string;
  after: string;
  rects: PdfRect[];
}

/** Streamed as pages are searched (PDF-SRCH-004): each message carries the new hits only. */
export interface PdfSearchProgress {
  session: string;
  searchId: string;
  hits: PdfSearchHit[];
  pagesDone: number;
  pageCount: number;
  done: boolean;
  /** Stopped at the cap: more hits exist than are listed. */
  truncated: boolean;
  error: string | null;
}

export const SEARCH_MAX_HITS = 5000;
export const SEARCH_MAX_QUERY = 200;

/** Whole-word and case-insensitive matching the way search does it, for comments and bookmarks. */
export function textMatcher(query: string, o: Pick<PdfSearchOptions, 'matchCase' | 'wholeWord' | 'regex'>): RegExp | null {
  if (!query) return null;
  let source = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${o.matchCase ? '' : 'i'}`);
  } catch {
    return null;
  }
}

// ── rendering (§6.2) ─────────────────────────────────────────────────────

/** Device pixels in one tile side, and the most a whole-page render may have before tiles are required. */
export const TILE_SIZE = 1024;
export const MAX_RENDER_PIXELS = 16 * 1024 * 1024;
export const MAX_RENDER_SIDE = 16384;

export interface PdfBitmap {
  page: number;
  width: number;
  height: number;
  /** `rgba`: raw pixels, row after row; `jpeg`/`png`: an encoded image (thumbnails). */
  format: 'rgba' | 'jpeg' | 'png';
  data: Uint8Array;
}

// ── zoom and layout (§6.1) ───────────────────────────────────────────────

/** PDF-VIEW-002: 25 %–6400 %. 100 % shows a page at its printed size on a 96-dpi screen. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 64;
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
/** CSS pixels per PDF point at 100 %. */
export const CSS_PER_POINT = 96 / 72;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export function nextZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-6) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? ZOOM_MIN;
}

export type PdfViewMode = 'single' | 'continuous' | 'two-page' | 'two-page-continuous';
export const VIEW_MODES: PdfViewMode[] = ['single', 'continuous', 'two-page', 'two-page-continuous'];

/**
 * A page range as people type it ("1-5, 8, 11-"), one-based, into
 * zero-based page indexes in order, without repeats. Null when it names no
 * page of this document or cannot be read.
 */
export function parsePageRange(text: string, pageCount: number): number[] | null {
  const out: number[] = [];
  const seen = new Set<number>();
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || pageCount < 1) return null;
  for (const part of parts) {
    const m = /^(\d+)?\s*(-\s*(\d+)?)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : pageCount) : from;
    if (from < 1 || to < from || from > pageCount) return null;
    for (let p = from; p <= Math.min(to, pageCount); p++) {
      if (!seen.has(p - 1)) {
        seen.add(p - 1);
        out.push(p - 1);
      }
    }
  }
  return out.length ? out : null;
}

// ── the session the renderer sees ────────────────────────────────────────

export type PdfSessionState = 'opening' | 'password' | 'ready' | 'failed';

/** Why an action is off, or null when it is allowed (PDF-UI-006: disabled with a reason). */
export type Gate = string | null;

/** Title-bar save state (PDF-UI-003): read-only, nothing to save, saving, changes not saved, or kept on this computer until WorkSuite can take them. */
export type PdfSaveState = 'read-only' | 'saved' | 'saving' | 'unsaved' | 'saved-locally';

/** Edit session modes (§16, the server's `PdfPermissions::MODES`). */
export type PdfMode = 'VIEW' | 'ANNOTATE' | 'EDIT';
export const PDF_MODES: PdfMode[] = ['VIEW', 'ANNOTATE', 'EDIT'];

// ── editing (stage D2) ───────────────────────────────────────────────────

/**
 * Every change is one of these operations. The engine applies them; the
 * main process keeps them, in order, as the session's journal (sealed on
 * disk): undo and redo replay the journal onto the opened version, a
 * crashed or closed window's work is recovered by replaying it
 * (PDF-SAVE-020), and a save declares what they add up to (the server's
 * change summary, PDF-SAVE-008).
 *
 * Positions are in points from the displayed page's top-left corner — what
 * the renderer draws in — and the engine turns them into page space.
 */
const point = z.tuple([z.number().min(-20_000).max(20_000), z.number().min(-20_000).max(20_000)]);
const rect = z.tuple([z.number().min(-20_000).max(20_000), z.number().min(-20_000).max(20_000), z.number().min(0).max(20_000), z.number().min(0).max(20_000)]);
const rgb = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]);
const pageIndex = z.number().int().min(0).max(100_000);
/** An annotation's WorkSuite id (its /NM), or `idx:<n>` for one the file had without a name. */
export const annotIdSchema = z.string().regex(/^(ws-[A-Za-z0-9-]{8,64}|idx:\d{1,5})$/);

export const ANNOT_KINDS = ['highlight', 'underline', 'strikeout', 'squiggly', 'note', 'ink', 'square', 'circle', 'line', 'text', 'stamp'] as const;
export type PdfAnnotKind = (typeof ANNOT_KINDS)[number];
/** Kinds drawn over text the person dragged across. */
export const MARKUP_KINDS: PdfAnnotKind[] = ['highlight', 'underline', 'strikeout', 'squiggly'];

export const STAMPS = ['Approved', 'Rejected', 'Draft', 'Confidential', 'Final', 'For comment', 'Received', 'Void'] as const;

export const pdfNewAnnotSchema = z.strictObject({
  id: annotIdSchema,
  kind: z.enum(ANNOT_KINDS),
  color: rgb,
  opacity: z.number().min(0.1).max(1),
  /** Line width in points (ink, shapes, lines). */
  width: z.number().min(0.25).max(24),
  /** The box: shapes, notes, text boxes, stamps; worked out from the rest for markup and ink. */
  rect: rect.optional(),
  /** Markup: one rectangle per line of text covered. */
  rects: z.array(rect).max(400).optional(),
  /** Ink: strokes of points; a line: one stroke of two points. */
  strokes: z.array(z.array(point).min(1).max(4000)).max(200).optional(),
  /** The comment (/Contents); a text box's or stamp's own words. */
  text: z.string().max(10_000).optional(),
  fontSize: z.number().min(4).max(144).optional(),
});
export type PdfNewAnnot = z.infer<typeof pdfNewAnnotSchema>;

export const pdfEditOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('annot.add'), page: pageIndex, annot: pdfNewAnnotSchema }),
  z.strictObject({
    op: z.literal('annot.update'),
    page: pageIndex,
    id: annotIdSchema,
    color: rgb.optional(),
    opacity: z.number().min(0.1).max(1).optional(),
    text: z.string().max(10_000).optional(),
    rect: rect.optional(),
  }),
  z.strictObject({ op: z.literal('annot.remove'), page: pageIndex, id: annotIdSchema }),
  z.strictObject({ op: z.literal('page.rotate'), pages: z.array(pageIndex).min(1).max(10_000), by: z.union([z.literal(90), z.literal(180), z.literal(270)]) }),
  z.strictObject({ op: z.literal('page.delete'), pages: z.array(pageIndex).min(1).max(10_000) }),
  /** Moves the pages, in their order, to start at `to` in the document as it is after they are taken out. */
  z.strictObject({ op: z.literal('page.move'), pages: z.array(pageIndex).min(1).max(10_000), to: pageIndex }),
  z.strictObject({ op: z.literal('page.insertBlank'), at: pageIndex, size: z.tuple([z.number().min(36).max(14_400), z.number().min(36).max(14_400)]) }),
  /** Pages of another PDF on this computer, by the handle it was chosen with; the main process keeps a sealed copy with the journal. */
  z.strictObject({ op: z.literal('page.insertFile'), at: pageIndex, file: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), pages: z.array(pageIndex).max(10_000).optional() }),
]);
export type PdfEditOp = z.infer<typeof pdfEditOpSchema>;

/** An annotation as the renderer lists and selects it (the Comments panel, the selection box). */
export interface PdfAnnotView {
  id: string;
  page: number;
  kind: PdfAnnotKind | 'other';
  /** PDF subtype number, for the ones WorkSuite does not create (links, fields and popups are never listed). */
  subtype: number;
  rect: PdfRect;
  color: [number, number, number] | null;
  opacity: number;
  text: string;
  author: string;
  modified: string;
  /** WorkSuite can change or remove it here. */
  editable: boolean;
}

/** The counts a save declares (the server's `PdfSaves::SUMMARY`). */
export interface PdfChangeSummary {
  pages_rotated: number;
  pages_deleted: number;
  pages_inserted: number;
  pages_reordered: number;
  pages_extracted: number;
  annotations_added: number;
  annotations_changed: number;
  annotations_removed: number;
  content_edits: number;
}

export function emptySummary(): PdfChangeSummary {
  return { pages_rotated: 0, pages_deleted: 0, pages_inserted: 0, pages_reordered: 0, pages_extracted: 0, annotations_added: 0, annotations_changed: 0, annotations_removed: 0, content_edits: 0 };
}

/** The part of an operation a summary reads (the journal's engine operations have it too). */
export type SummarizableOp =
  | { op: 'annot.add'; annot: { id: string } }
  | { op: 'annot.update' | 'annot.remove'; id: string }
  | { op: 'page.rotate' | 'page.delete' | 'page.move'; pages: number[] }
  | { op: 'page.insertBlank' }
  | { op: 'page.insertFile'; pages?: number[] };

/** What a journal of operations adds up to. An annotation added and then removed before saving counts for neither. */
export function summarize(ops: readonly SummarizableOp[]): PdfChangeSummary {
  const s = emptySummary();
  const added = new Set<string>();
  for (const o of ops) {
    if (o.op === 'annot.add') {
      added.add(o.annot.id);
      s.annotations_added++;
    } else if (o.op === 'annot.update') {
      if (!added.has(o.id)) s.annotations_changed++;
    } else if (o.op === 'annot.remove') {
      if (added.has(o.id)) {
        added.delete(o.id);
        s.annotations_added--;
      } else s.annotations_removed++;
    } else if (o.op === 'page.rotate') s.pages_rotated += o.pages.length;
    else if (o.op === 'page.delete') s.pages_deleted += o.pages.length;
    else if (o.op === 'page.move') s.pages_reordered += o.pages.length;
    else if (o.op === 'page.insertBlank') s.pages_inserted++;
    else if (o.op === 'page.insertFile') s.pages_inserted += o.pages?.length ?? 1;
  }
  return s;
}

/** "3 pages rotated, 5 annotations added" — the words a save shows; the server writes its own for the version. */
export function describeSummary(s: PdfChangeSummary): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n > 0 && parts.push(`${n} ${n === 1 ? one : many}`);
  add(s.annotations_added, 'annotation added', 'annotations added');
  add(s.annotations_changed, 'annotation changed', 'annotations changed');
  add(s.annotations_removed, 'annotation removed', 'annotations removed');
  add(s.pages_rotated, 'page rotated', 'pages rotated');
  add(s.pages_deleted, 'page deleted', 'pages deleted');
  add(s.pages_inserted, 'page inserted', 'pages inserted');
  add(s.pages_reordered, 'page moved', 'pages moved');
  return parts.join(', ');
}

/** Which permission a change needs (the server's `PdfSaves::SUMMARY`): annotating, or organising pages. */
export function opNeeds(op: PdfEditOp): 'annotate' | 'organize' {
  return op.op.startsWith('annot.') ? 'annotate' : 'organize';
}

/** The server's refusal of a save because Drive moved on (PDF-SAVE-004, §17.2). */
export interface PdfConflict {
  baseVersion: number;
  serverVersion: number;
  savedBy: string | null;
  savedAt: string | null;
  offline: boolean;
  message: string;
}

/** The edit side of a session (stage D2): what may be done here, what has been done, and where saving has got to. */
export interface PdfEditState {
  /** The modes the server offers this person on this file now (VIEW first). */
  modes: PdfMode[];
  canAnnotate: boolean;
  canOrganize: boolean;
  canSaveVersion: boolean;
  canSaveCopy: boolean;
  /** Why a mode or save is not offered, in the server's words (PDF-COL-002, §21.3). */
  reason: string | null;
  undo: number;
  redo: number;
  summary: PdfChangeSummary;
  /** Unsaved work found on this computer for this file and version, recovered into the session (PDF-SAVE-020). */
  recovered: boolean;
  /** Somebody saved a newer version in WorkSuite since this one was opened. */
  newVersion: boolean;
  /** The edit lock: held by this session, with its expiry and the last-two-minutes warning (PDF-COL-003). */
  lock: { mine: boolean; holder: string; device: string | null; expiresInS: number | null; warning: boolean } | null;
  /** The lock was taken away (expired, released, taken over): who and why; the work stays here to save as a copy. */
  lockLost: { reason: string; by: string | null } | null;
  /** Offered when the server refused the lock: take it over (an owner or PDF administrator). */
  mayTakeOver: boolean;
  conflict: PdfConflict | null;
  /** The last save: the Drive version it made, or the copy. */
  lastSaved: { version: number | null; copyFileId: number | null; at: string } | null;
  /** A save is waiting for WorkSuite (offline, or it did not answer): it goes when it can. */
  pendingSave: boolean;
  /** The server's sentence about the last thing that failed, for the banner. */
  message: string | null;
  /** A local file: Save writes it back in place. */
  local: boolean;
  /** Goes up with every change to what the pages look like: the window draws them again. */
  revision: number;
}

export function emptyEditState(): PdfEditState {
  return {
    modes: ['VIEW'],
    canAnnotate: false,
    canOrganize: false,
    canSaveVersion: false,
    canSaveCopy: false,
    reason: null,
    undo: 0,
    redo: 0,
    summary: emptySummary(),
    recovered: false,
    newVersion: false,
    lock: null,
    lockLost: null,
    mayTakeOver: false,
    conflict: null,
    lastSaved: null,
    pendingSave: false,
    message: null,
    local: false,
    revision: 0,
  };
}

export interface PdfSessionView {
  id: string;
  state: PdfSessionState;
  name: string;
  source: {
    kind: PdfSourceKind;
    fileId: number | null;
    version: number | null;
    /** Where it lives, for the title bar ("WorkSuite Drive", "This computer", "Mail attachment"). */
    label: string;
  };
  /** Edit session mode (§16). */
  mode: PdfMode;
  saveState: PdfSaveState;
  edit: PdfEditState;
  /** Why the document is read-only here. */
  readOnly: string;
  size: number;
  pageCount: number;
  pages: PdfPageSize[];
  info: PdfDocInfo | null;
  permissions: PdfPermissions | null;
  security: PdfSecurityReport;
  capabilities: PdfEngineCapabilities | null;
  gates: { print: Gate; download: Gate; copy: Gate; externalLinks: Gate };
  /** Someone holds WorkSuite's edit lock on this Drive file (informational while viewing). */
  lock: { holder: string; mine: boolean } | null;
  password: { attempts: number; wrong: boolean } | null;
  error: { code: PdfEngineErrorCode | 'not_found' | 'forbidden' | 'too_large' | 'offline' | 'too_many' | 'gone'; message: string; retry: boolean } | null;
}

/** Drive facts for the Review panel (Versions, Activity), when the source is a Drive file. */
export interface PdfDriveDetails {
  versions: Array<{ id: number; version: number; size: number; author: string | null; note: string | null; createdAt: string }>;
  activity: Array<{ action: string; description: string | null; author: string | null; at: string }>;
}

// ── print (§14.4) ────────────────────────────────────────────────────────

export const PRINT_MAX_PAGES = 500;

export const pdfPrintSchema = z.strictObject({
  session: handle,
  /** One-based ranges as typed ("1-5, 8"); "all" or the current page are sent as such. */
  range: z.union([z.literal('all'), z.strictObject({ current: z.number().int().min(0).max(100_000) }), z.strictObject({ pages: z.string().min(1).max(200) })]),
  fit: z.enum(['fit', 'actual']),
  annotations: z.boolean(),
  quality: z.enum(['standard', 'high']),
});
export type PdfPrintRequest = z.infer<typeof pdfPrintSchema>;

// ── local files ──────────────────────────────────────────────────────────

export interface PdfLocalPick {
  handle: string;
  name: string;
  size: number;
}

/** The largest PDF opened (the Max PDF Size policy default, §21.2; the engine's own ceiling is 2 GB). */
export const MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024;

// ── diagnostics (§24.5, PDF-NFR-032) ─────────────────────────────────────

export interface PdfDiagnosticCheck {
  id: 'engine' | 'worker' | 'renderer' | 'fonts' | 'temp' | 'drive' | 'offline-db' | 'ocr' | 'conversion' | 'print';
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail: string;
  ms?: number;
}

/** A failure as it is reported (PDF-NFR-030/031): the file's facts and the engine's error, never its content. */
export interface PdfFailureReport {
  at: string;
  stage: 'open' | 'render' | 'search' | 'print' | 'worker';
  code: string;
  format: string;
  size: number;
  pages: number;
  engine: string;
  appVersion: string;
}

export const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'com', 'bat', 'cmd', 'scr', 'pif', 'msi', 'msp', 'msc', 'cpl', 'dll', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'hta', 'jar', 'app', 'command', 'sh', 'bash', 'run', 'bin', 'lnk', 'reg', 'docm', 'xlsm', 'pptm', 'iso', 'dmg', 'pkg', 'deb', 'rpm', 'appimage',
]);

export function isDangerousName(name: string): boolean {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase();
  return !!ext && DANGEROUS_EXTENSIONS.has(ext);
}
