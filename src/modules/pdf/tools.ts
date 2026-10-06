/**
 * PDF Studio's tool registry (WS-PDF-ENH-01 §4.1, tools T01–T26; base SRS §5.14
 * PDF-ACR-001): every tool the All tools panel, the home grid and the action
 * wizard show, grouped as Acrobat does, with where it runs, whether it needs
 * the Pro seat, and — honestly — how much of it this desktop build can do.
 *
 * `status`:
 *  - `ready`   works in this build end to end;
 *  - `partial` part of it works (`works` says which part);
 *  - `ui`      the screen is here, the engine or server work behind it is not
 *              yet (`missing` names it) — its run button stays off with that reason
 *              instead of pretending (PRO-FW-008).
 */
export type ToolGroup = 'create' | 'review' | 'protect' | 'advanced';
export type ToolStatus = 'ready' | 'partial' | 'ui';
export type ToolRuns = 'desktop' | 'server' | 'both';

export type ToolId =
  | 'create'
  | 'edit'
  | 'export'
  | 'combine'
  | 'organize'
  | 'ocr'
  | 'compress'
  | 'comment'
  | 'fill-sign'
  | 'esign'
  | 'prepare-form'
  | 'compare'
  | 'protect'
  | 'redact'
  | 'certificates'
  | 'accessibility'
  | 'standards'
  | 'print-production'
  | 'measure'
  | 'bates'
  | 'actions'
  | 'ai';

export interface PdfTool {
  id: ToolId;
  /** ENH-01 tool number. */
  t: string;
  group: ToolGroup;
  label: string;
  /** The home grid's one line. */
  blurb: string;
  icon: string;
  /** Needs the `pdf_studio_pro` seat (part of it may be standard: `proNote`). */
  pro: boolean;
  proNote?: string;
  /** The role permission the server asks for (base §13.1, ENH §9.1). */
  permission: string;
  lock: 'none' | 'edit' | 'signing';
  output: 'in-place' | 'copy' | 'new-file' | 'report';
  runs: ToolRuns;
  /** Design screens. */
  screens: string[];
  /** ENH-01 delivery phase. */
  phase: string;
  status: ToolStatus;
  /** What works today, when `partial`. */
  works?: string;
  /** What is still to build, in one sentence each (the gap list). */
  missing: string[];
}

export const GROUP_LABEL: Record<ToolGroup, string> = {
  create: 'Create & edit',
  review: 'Review & sign',
  protect: 'Protect',
  advanced: 'Advanced',
};

export const TOOLS: PdfTool[] = [
  {
    id: 'create', t: 'T02', group: 'create', label: 'Create a PDF', blurb: 'From Office, images, web page, scanner', icon: 'plus',
    pro: true, proNote: 'Images and print are standard', permission: 'files.pdf.create', lock: 'none', output: 'new-file', runs: 'both', screens: ['DK06'], phase: 'PRO-1', status: 'ui',
    missing: ['Engine: images/text → PDF on the device', 'Server: POST api/files/pdf/create (LibreOffice, headless Chromium web capture with SSRF guard)', 'Scanner bridge (TWAIN/WIA, ICA, SANE)', 'Clipboard/screenshot capture'],
  },
  {
    id: 'edit', t: 'T05', group: 'create', label: 'Edit text & images', blurb: 'Text, images, links, headers', icon: 'pen',
    pro: true, permission: 'files.pdf.edit', lock: 'edit', output: 'in-place', runs: 'desktop', screens: ['DK03'], phase: 'PRO-2', status: 'ui',
    missing: ['Engine: text-block segmentation and content-stream rewrite', 'Font matching/subsetting (HarfBuzz, FreeType) incl. Sinhala and Tamil shaping', 'Image add/replace/crop ops', 'Link ops', 'Page design ops: crop boxes, header & footer, watermark, background, page labels', 'Edit ops in the journal (pdfEditOpSchema) with summary kinds text_edited/images_changed'],
  },
  {
    id: 'export', t: 'T06', group: 'create', label: 'Export a PDF', blurb: 'Word, Excel, PowerPoint, images', icon: 'external',
    pro: true, proNote: 'Images and text are standard', permission: 'files.pdf.export', lock: 'none', output: 'new-file', runs: 'both', screens: ['DK06'], phase: 'PRO-1', status: 'ui',
    missing: ['Desktop: page images (PNG/JPEG/TIFF) and text export from the engine', 'Server: POST api/files/{id}/pdf/export (LibreOffice, poppler) with auto-OCR', 'Policy allow_export gate in the session flags'],
  },
  {
    id: 'combine', t: 'T03', group: 'create', label: 'Combine files', blurb: 'Merge PDFs and other files', icon: 'merge',
    pro: false, proNote: 'Non-PDF inputs need Pro', permission: 'files.pdf.organize', lock: 'none', output: 'new-file', runs: 'both', screens: ['DK04'], phase: 'PRO-1', status: 'partial',
    works: 'Insert the pages of another PDF from this computer into the open PDF (Organize › Insert from PDF).',
    missing: ['Combine dialog backend: build a new PDF from a file list with page ranges', 'Bookmarks per file and a table-of-contents page', 'Drive and Mail sources; non-PDF inputs via server convert (POST api/files/pdf/combine)', 'Save as a new Drive file in a chosen folder'],
  },
  {
    id: 'organize', t: 'T04', group: 'create', label: 'Organize pages', blurb: 'Reorder, rotate, insert, split', icon: 'grid',
    pro: false, proNote: 'Insert from scanner and replace need Pro', permission: 'files.pdf.organize', lock: 'edit', output: 'in-place', runs: 'both', screens: ['DK04', 'W04'], phase: 'PRO-1', status: 'partial',
    works: 'Rotate, delete, move, drag to reorder, insert blank, insert from a PDF, extract — with undo, the edit lock and saving to Drive.',
    missing: ['Duplicate and replace pages', 'Split by pages / size / top-level bookmarks', 'Drag pages between open PDF tabs', 'Page labels (i, ii, 1, A-1)', '"Changes in this session" list built from the journal', 'Thumbnail size control'],
  },
  {
    id: 'ocr', t: 'T10', group: 'create', label: 'Scan & OCR', blurb: 'Searchable, editable scans', icon: 'scan',
    pro: true, proNote: 'Server OCR up to 20 pages is standard', permission: 'files.pdf.ocr', lock: 'edit', output: 'in-place', runs: 'both', screens: ['DK07', 'W08'], phase: 'PRO-1', status: 'ui',
    missing: ['Device OCR in the engine process (tesseract.js is bundled for other modules; eng/sin/tam models)', 'Invisible text-layer writer in the engine', 'Enhance: deskew, auto-rotate, background removal, crop', 'Suspects correction with record suggestions', 'Server: api/files/{id}/pdf/tools/ocr + jobs list'],
  },
  {
    id: 'compress', t: 'T07', group: 'create', label: 'Compress a PDF', blurb: 'Reduce size, optimize', icon: 'minimize',
    pro: false, proNote: 'The advanced optimizer needs Pro', permission: 'files.pdf.edit', lock: 'none', output: 'copy', runs: 'both', screens: ['DK06', 'W08'], phase: 'PRO-1', status: 'ui',
    missing: ['Server: api/files/{id}/pdf/tools/optimize (exists as api/pdf/server/optimize — move behind files.pdf.* + policy)', 'Desktop: image re-encoding and object cleanup in the engine', 'Size estimate and space-usage audit'],
  },
  {
    id: 'comment', t: 'T08', group: 'review', label: 'Add comments', blurb: 'Notes, markup, shared review', icon: 'chat',
    pro: false, proNote: 'Summarize, import/export, audio and shared review need Pro', permission: 'files.pdf.annotate', lock: 'none', output: 'in-place', runs: 'both', screens: ['DK05', 'W03'], phase: 'PRO-2', status: 'partial',
    works: 'Highlight, underline, strike out, squiggle, note, text box, draw, rectangle, ellipse, line and stamps saved inside the PDF; Comments panel to go to, edit and delete.',
    missing: ['Replies, @mentions, resolve/status, filter and sort', 'Replace/insert text, callout, cloud, polygon, arrow, eraser, attach file, record audio', 'Opacity and fill controls; per-tool defaults', 'Make task (Tasks API)', 'Summarize comments, FDF/XFDF import/export', 'Shared review: api/files/{id}/pdf/reviews', 'Server annotation index (GET …/pdf/annotations)'],
  },
  {
    id: 'fill-sign', t: 'T11', group: 'review', label: 'Fill & Sign', blurb: 'Complete and sign forms', icon: 'signature',
    pro: false, permission: 'files.pdf.forms', lock: 'none', output: 'in-place', runs: 'both', screens: ['W09', 'M01'], phase: 'PRO-3', status: 'ui',
    missing: ['Engine: AcroForm read/fill and field values in the journal', 'Signature capture (draw, type, image) as a stamp/ink annotation', 'Saved signatures (api/files/pdf/signatures, encrypted per user)', 'In-person signing mode with witness audit', 'Record prefill from form mappings'],
  },
  {
    id: 'esign', t: 'T12', group: 'review', label: 'Request e-signatures', blurb: 'Send, track, remind', icon: 'send',
    pro: true, permission: 'files.pdf.sign_request', lock: 'signing', output: 'new-file', runs: 'server', screens: ['DK08'], phase: 'PRO-4', status: 'ui',
    missing: ['Server: PDFAgreementService, api/pdf/agreements, public sign/{token} page with OTP', 'SIGNING lock type', 'Field placement per recipient, text tags', 'Agreements tracker', 'Envelope metering'],
  },
  {
    id: 'prepare-form', t: 'T13', group: 'review', label: 'Prepare a form', blurb: 'Detect and design fields', icon: 'list-checks',
    pro: true, permission: 'files.pdf.forms_design', lock: 'edit', output: 'in-place', runs: 'desktop', screens: ['DK09'], phase: 'PRO-3', status: 'ui',
    missing: ['Engine: field create/edit/delete ops', 'Auto-detect fields on flat PDFs', 'Safe formula engine (no document JavaScript)', 'Record mappings and responses (api/pdf/forms/*)'],
  },
  {
    id: 'compare', t: 'T17', group: 'review', label: 'Compare files', blurb: 'Text and visual differences', icon: 'layout-side',
    pro: true, proNote: 'Versions of one file, text only, is standard', permission: 'files.pdf.compare', lock: 'none', output: 'report', runs: 'both', screens: ['DK11', 'W07'], phase: 'PRO-2', status: 'ui',
    missing: ['Open two documents in one view with synced scroll', 'Text diff from the engine text layer; visual overlay', 'Report PDF and pdf_comparisons (POST api/files/{id}/pdf/compare)'],
  },
  {
    id: 'protect', t: 'T14', group: 'protect', label: 'Protect a PDF', blurb: 'Passwords, certificates', icon: 'lock',
    pro: true, permission: 'files.pdf.protect', lock: 'none', output: 'copy', runs: 'both', screens: ['DK10', 'W10'], phase: 'PRO-3', status: 'ui',
    missing: ['Server: api/files/{id}/pdf/tools/protect (qpdf AES-256; exists as api/pdf/server/secure)', 'Desktop AES-256 writer in the engine', 'Certificate encryption and organization security policies', 'Remove security'],
  },
  {
    id: 'redact', t: 'T15', group: 'protect', label: 'Redact a PDF', blurb: 'Remove sensitive content', icon: 'eye-off',
    pro: true, permission: 'files.pdf.redact', lock: 'edit', output: 'copy', runs: 'both', screens: ['DK10', 'W10'], phase: 'PRO-3', status: 'partial',
    works: 'Pattern finding (Sri Lankan NIC, phones, emails, cards, bank numbers) through the document search, listing every hit to review.',
    missing: ['Redaction marks as annotations', 'Engine: apply — remove text, vectors and image pixels under marks', 'Sanitize: metadata/XMP, attachments, comments, hidden layers, scripts', 'Verification and report; audit pdf.redaction.applied'],
  },
  {
    id: 'certificates', t: 'T16', group: 'protect', label: 'Use a certificate', blurb: 'Sign, certify, validate', icon: 'badge-check',
    pro: true, proNote: 'Validate is standard', permission: 'files.pdf.sign_digital', lock: 'none', output: 'in-place', runs: 'both', screens: ['DK10'], phase: 'PRO-4', status: 'ui',
    missing: ['Signature validation (pkijs is bundled; the engine counts signatures already)', 'OS keystore / PKCS#12 / PKCS#11 bridge', 'PAdES signing with incremental save', 'TSA timestamps, LTV, trust list'],
  },
  {
    id: 'accessibility', t: 'T18', group: 'advanced', label: 'Prepare for accessibility', blurb: 'Check, tag, reading order', icon: 'user',
    pro: true, proNote: 'Check is standard', permission: 'files.pdf.accessibility', lock: 'edit', output: 'in-place', runs: 'both', screens: ['DK12'], phase: 'PRO-5', status: 'ui',
    missing: ['Engine: structure tree read/write', 'PDF/UA + WCAG checker', 'Autotag, reading order tool, alt text', 'Read out loud (OS speech)'],
  },
  {
    id: 'standards', t: 'T19', group: 'advanced', label: 'Standards', blurb: 'PDF/A, PDF/X, PDF/UA', icon: 'shield-check',
    pro: true, permission: 'files.pdf.standards', lock: 'none', output: 'copy', runs: 'server', screens: ['DK12'], phase: 'PRO-5', status: 'ui',
    missing: ['Server: veraPDF verify (POST api/files/{id}/pdf/verify), PDF/A convert (exists as api/pdf/server/pdfa)', 'Compliance badges from pdf_compliance_reports'],
  },
  {
    id: 'print-production', t: 'T20', group: 'advanced', label: 'Print production', blurb: 'Preflight, output preview', icon: 'printer',
    pro: true, permission: 'files.pdf.print_production', lock: 'none', output: 'report', runs: 'desktop', screens: ['DK13'], phase: 'PRO-5', status: 'ui',
    missing: ['Colour management (LittleCMS) and separations in the engine', 'Preflight profiles and fixups', 'Page boxes and printer marks ops'],
  },
  {
    id: 'measure', t: 'T21', group: 'advanced', label: 'Measure objects', blurb: 'Distance, perimeter, area', icon: 'scaling',
    pro: true, permission: 'files.pdf.annotate', lock: 'none', output: 'in-place', runs: 'desktop', screens: ['DK13'], phase: 'PRO-5', status: 'ui',
    missing: ['Measure tools on the annotation layer (line/polygon + scale)', 'Snapping to paths (engine path geometry)', 'Measurement annotations and CSV export'],
  },
  {
    id: 'bates', t: 'T23', group: 'advanced', label: 'Bates, index & watermark', blurb: 'Number pages across files', icon: 'hash',
    pro: true, permission: 'files.pdf.edit', lock: 'edit', output: 'in-place', runs: 'both', screens: ['DK14'], phase: 'PRO-2', status: 'ui',
    missing: ['Engine: text stamp op (Bates, header/footer, watermark share it)', 'Multi-file runs and Bates log CSV', 'Portable full-text index'],
  },
  {
    id: 'actions', t: 'T22', group: 'advanced', label: 'Action wizard', blurb: 'Guided batch actions', icon: 'zap',
    pro: true, permission: 'files.pdf.actions', lock: 'none', output: 'new-file', runs: 'both', screens: ['DK14'], phase: 'PRO-4', status: 'ui',
    missing: ['Server: api/pdf/actions + runs (PDFActionService)', 'Local runner over the tool steps', 'Built-in action library'],
  },
  {
    id: 'ai', t: 'T24', group: 'advanced', label: 'AI Assistant', blurb: 'Summaries, ask the document', icon: 'sparkles',
    pro: true, proNote: 'Summary is standard when AI is on', permission: 'files.pdf.ai', lock: 'none', output: 'report', runs: 'server', screens: ['DK15'], phase: 'PRO-3', status: 'ui',
    missing: ['Server: POST api/files/{id}/pdf/ai/{summary|ask|extract|compare} via CoreAIService', 'Text extraction with page anchors from the engine', 'Citation highlight on the canvas', 'Save to record note / task'],
  },
];

export function toolById(id: string | null | undefined): PdfTool | null {
  return TOOLS.find((t) => t.id === id) ?? null;
}

export function toolsIn(group: ToolGroup): PdfTool[] {
  return TOOLS.filter((t) => t.group === group);
}

/** All tools search (PRO-FW-001): by name, blurb, group or tool number. */
export function searchTools(query: string): PdfTool[] {
  const q = query.trim().toLowerCase();
  if (!q) return TOOLS;
  return TOOLS.filter((t) => [t.label, t.blurb, GROUP_LABEL[t.group], t.t, t.id].some((s) => s.toLowerCase().includes(q)));
}

export const STATUS_LABEL: Record<ToolStatus, string> = { ready: 'Ready', partial: 'Partly ready', ui: 'Coming' };

/** Why a tool's run button is off (PRO-FW-008), or null when it may run. */
export function toolGate(t: PdfTool): string | null {
  if (t.status === 'ready') return null;
  return `Not in this version yet — needs: ${t.missing[0]}.`;
}

// ── redaction patterns (PRO-RED-002) ─────────────────────────────────────

export interface RedactPattern {
  id: string;
  label: string;
  /** For the document search (regex mode). */
  regex: string;
}

/**
 * Sri Lankan NIC (old: 9 digits + V/X; new: 12 digits), Sri Lankan phone
 * numbers (+94 / 0, mobile and landline), emails, card-like and bank-account-like
 * numbers. The search runs them in the engine; nothing leaves the device.
 */
export const REDACT_PATTERNS: RedactPattern[] = [
  { id: 'nic', label: 'NIC numbers (old and new)', regex: '\\b(?:\\d{9}[VvXx]|\\d{12})\\b' },
  { id: 'phone', label: 'Sri Lankan phone numbers', regex: '(?:\\+94|\\b0)\\s?\\d{2}\\s?\\d{3}\\s?\\d{4}\\b' },
  { id: 'email', label: 'Email addresses', regex: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' },
  { id: 'card', label: 'Card numbers', regex: '\\b(?:\\d[ -]?){13,19}\\b' },
  { id: 'bank', label: 'Bank account numbers', regex: '\\b\\d{8,16}\\b' },
];

/** Whether a word matches a pattern the way the engine's regex search would (for tests and the review list). */
export function matchesPattern(id: string, text: string): boolean {
  const p = REDACT_PATTERNS.find((x) => x.id === id);
  if (!p) return false;
  return new RegExp(p.regex, 'u').test(text);
}
