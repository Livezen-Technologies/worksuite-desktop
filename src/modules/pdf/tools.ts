/**
 * PDF Studio's tool registry (WS-PDF-ENH-01 §4.1, tools T01–T26; base SRS §5.14
 * PDF-ACR-001): every tool the All tools panel, the home grid and the action
 * wizard show, grouped as Acrobat does, with where it runs, whether it needs
 * the Pro seat, and — honestly — how much of it this desktop build can do.
 *
 * `status`:
 *  - `ready`   works in this build end to end;
 *  - `partial` part of it works (`works` says which part);
 *  - `ui`      the screen is here, the work behind it is not on this computer.
 *
 * `needs` (audit D-G12): what the rest of a tool runs on — `server`, PDF Studio
 * Pro on the WorkSuite server (the Pro panel of a Drive PDF), or `office`,
 * WorkSuite Office's conversion. Panels say so where a run button would be,
 * instead of a button that is always off. `hidden`: nothing of it works in this
 * version anywhere, so it is not listed (Scan & OCR, Standards, Print
 * production, Measure); it comes back with its engine or server work.
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
  needs?: 'server' | 'office';
  hidden?: boolean;
}

export const GROUP_LABEL: Record<ToolGroup, string> = {
  create: 'Create & edit',
  review: 'Review & sign',
  protect: 'Protect',
  advanced: 'Advanced',
};

export const ALL_TOOLS: PdfTool[] = [
  {
    id: 'create', t: 'T02', group: 'create', label: 'Create a PDF', blurb: 'From Office, images, web page, scanner', icon: 'plus',
    pro: true, proNote: 'Images and print are standard', permission: 'files.pdf.create', lock: 'none', output: 'new-file', runs: 'both', screens: ['DK06'], phase: 'PRO-1', status: 'partial',
    works: 'On this computer: a PDF from pictures (PNG, JPEG), one page each, fitted on A4 or Letter or at their own size; blank pages of a paper size.',
    missing: ['Word, Excel, PowerPoint and web pages convert through WorkSuite Office (POST api/files/pdf/create)', 'Scanner bridge (TWAIN/WIA, ICA, SANE)'],
    needs: 'office',
  },
  {
    id: 'edit', t: 'T05', group: 'create', label: 'Edit text & images', blurb: 'Text, images, links, headers', icon: 'pen',
    pro: true, permission: 'files.pdf.edit', lock: 'edit', output: 'in-place', runs: 'desktop', screens: ['DK03'], phase: 'PRO-2', status: 'partial',
    works: "On this computer: headers, footers and watermarks stamped on pages (Bates & watermark). For Drive PDFs (Pro panel, on the server): find and replace in the document's own font, images, links, bookmarks, labels and boxes.",
    missing: ['On-canvas text-block editing in the engine (PDFium) with reflow', 'Sinhala and Tamil shaping for new text (HarfBuzz)'],
    needs: 'server',
  },
  {
    id: 'export', t: 'T06', group: 'create', label: 'Export a PDF', blurb: 'Word, Excel, PowerPoint, images', icon: 'external',
    pro: true, proNote: 'Images and text are standard', permission: 'files.pdf.export', lock: 'none', output: 'new-file', runs: 'both', screens: ['DK06'], phase: 'PRO-1', status: 'partial',
    works: 'On this computer: every page as a PNG image (72, 150 or 300 dpi) and the text as a .txt file. For Drive PDFs (Pro panel): Word, Excel, PowerPoint and other formats converted on the server.',
    missing: ['Word, Excel, PowerPoint and HTML through WorkSuite Office (POST api/files/{id}/pdf/export)'],
    needs: 'office',
  },
  {
    id: 'combine', t: 'T03', group: 'create', label: 'Combine files', blurb: 'Merge PDFs and other files', icon: 'merge',
    pro: false, proNote: 'Non-PDF inputs need Pro', permission: 'files.pdf.organize', lock: 'none', output: 'new-file', runs: 'both', screens: ['DK04'], phase: 'PRO-1', status: 'partial',
    works: 'On this computer: PDFs combined into a new PDF in the order chosen, with page ranges and a bookmark per file.',
    missing: ['Word, Excel and image files as inputs through WorkSuite Office (POST api/files/pdf/combine)', 'Drive and Mail sources'],
    needs: 'office',
  },
  {
    id: 'organize', t: 'T04', group: 'create', label: 'Organize pages', blurb: 'Reorder, rotate, insert, split', icon: 'grid',
    pro: false, proNote: 'Insert from scanner and replace need Pro', permission: 'files.pdf.organize', lock: 'edit', output: 'in-place', runs: 'both', screens: ['DK04', 'W04'], phase: 'PRO-1', status: 'partial',
    works: 'Rotate, delete, move, drag to reorder, insert blank, insert from a PDF, duplicate, extract, and split into files every n pages — with undo, the edit lock and saving to Drive.',
    missing: ['Drag pages between open PDF tabs', 'Page labels (i, ii, 1, A-1)'],
  },
  {
    id: 'ocr', t: 'T10', group: 'create', label: 'Scan & OCR', blurb: 'Searchable, editable scans', icon: 'scan',
    pro: true, proNote: 'Server OCR up to 20 pages is standard', permission: 'files.pdf.ocr', lock: 'edit', output: 'in-place', runs: 'both', screens: ['DK07', 'W08'], phase: 'PRO-1', status: 'partial',
    works: 'For Drive PDFs (Pro panel): text recognised on the WorkSuite server — the languages it has installed, page rotation found, and zonal templates read into fields.',
    missing: ['Device OCR in the engine process (tesseract.js is bundled for other modules; eng/sin/tam models)', 'Invisible text-layer writer in the engine', 'Enhance: deskew, auto-rotate, background removal, crop', 'Suspects correction with record suggestions', 'Server: api/files/{id}/pdf/tools/ocr + jobs list'],
    needs: 'server',
  },
  {
    id: 'compress', t: 'T07', group: 'create', label: 'Compress a PDF', blurb: 'Reduce size, optimize', icon: 'minimize',
    pro: false, proNote: 'The advanced optimizer needs Pro', permission: 'files.pdf.edit', lock: 'none', output: 'copy', runs: 'both', screens: ['DK06', 'W08'], phase: 'PRO-1', status: 'ui',
    missing: ['Server: api/files/{id}/pdf/tools/optimize (exists as api/pdf/server/optimize — move behind files.pdf.* + policy)', 'Desktop: image re-encoding and object cleanup in the engine', 'Size estimate and space-usage audit'],
    needs: 'server',
  },
  {
    id: 'comment', t: 'T08', group: 'review', label: 'Add comments', blurb: 'Notes, markup, shared review', icon: 'chat',
    pro: false, proNote: 'Summarize, import/export, audio and shared review need Pro', permission: 'files.pdf.annotate', lock: 'none', output: 'in-place', runs: 'both', screens: ['DK05', 'W03'], phase: 'PRO-2', status: 'partial',
    works: 'Highlight, underline, strike out, squiggle, note, text box, draw, rectangle, ellipse, line and stamps saved inside the PDF; for Drive PDFs (Pro panel) shared review — replies, statuses, @mentions — written into the file.',
    missing: ['Callout, cloud, polygon, arrow, eraser, attach file, record audio', 'Make task (Tasks API)', 'FDF/XFDF import/export on the desktop'],
  },
  {
    id: 'fill-sign', t: 'T11', group: 'review', label: 'Fill & Sign', blurb: 'Complete and sign forms', icon: 'signature',
    pro: false, permission: 'files.pdf.forms', lock: 'none', output: 'in-place', runs: 'both', screens: ['W09', 'M01'], phase: 'PRO-3', status: 'partial',
    works: 'Draw or type a signature and place it on the current page as an annotation saved in the PDF.',
    missing: ['Engine: AcroForm read/fill and field values in the journal', 'Saved signatures (api/files/pdf/signatures, encrypted per user)', 'In-person signing mode with witness audit'],
  },
  {
    id: 'esign', t: 'T12', group: 'review', label: 'Request e-signatures', blurb: 'Send, track, remind', icon: 'send',
    pro: true, permission: 'files.pdf.sign_request', lock: 'signing', output: 'new-file', runs: 'server', screens: ['DK08'], phase: 'PRO-4', status: 'partial',
    works: 'For Drive PDFs (Pro panel): send to signers by email with a signature line each; the server locks the PDF, sends one-time codes, reminds, and seals the result.',
    missing: ['Placing fields freely on the desktop canvas (the web builder has it)', 'Agreements tracker on the desktop'],
    needs: 'server',
  },
  {
    id: 'prepare-form', t: 'T13', group: 'review', label: 'Prepare a form', blurb: 'Detect and design fields', icon: 'list-checks',
    pro: true, permission: 'files.pdf.forms_design', lock: 'edit', output: 'in-place', runs: 'desktop', screens: ['DK09'], phase: 'PRO-3', status: 'partial',
    works: 'For Drive PDFs (Pro panel): detect fields on flat forms and add them; calculations, formats, tab order and data import/export through the server.',
    missing: ['Designing fields on the desktop canvas'],
    needs: 'server',
  },
  {
    id: 'compare', t: 'T17', group: 'review', label: 'Compare files', blurb: 'Text and visual differences', icon: 'layout-side',
    pro: true, proNote: 'Versions of one file, text only, is standard', permission: 'files.pdf.compare', lock: 'none', output: 'report', runs: 'both', screens: ['DK11', 'W07'], phase: 'PRO-2', status: 'partial',
    works: 'For Drive PDFs (Pro panel): compare two versions on the server — inserted, deleted, changed, moved and formatting differences — and save a report PDF.',
    missing: ['Two documents side by side with synced scroll on the desktop canvas (the web has it)', 'Comparing a local file'],
    needs: 'server',
  },
  {
    id: 'protect', t: 'T14', group: 'protect', label: 'Protect a PDF', blurb: 'Passwords, certificates', icon: 'lock',
    pro: true, permission: 'files.pdf.protect', lock: 'none', output: 'copy', runs: 'both', screens: ['DK10', 'W10'], phase: 'PRO-3', status: 'partial',
    works: 'On this computer: a protected copy — AES-256, a password to open and a permissions password, printing, copying, changes and comments allowed or not — and an unlocked copy of a protected PDF opened with its password.',
    missing: ['Certificate encryption and organization security policies (WorkSuite server)'],
    needs: 'server',
  },
  {
    id: 'redact', t: 'T15', group: 'protect', label: 'Redact a PDF', blurb: 'Remove sensitive content', icon: 'eye-off',
    pro: true, permission: 'files.pdf.redact', lock: 'edit', output: 'copy', runs: 'both', screens: ['DK10', 'W10'], phase: 'PRO-3', status: 'partial',
    works: 'On this computer: NIC, phone, email, card and account numbers and your own words found through the document search, reviewed, then truly removed from the pages (text under them taken out, black boxes drawn). For Drive PDFs (Pro panel) redaction on the server with reason codes, and Sanitise a copy.',
    missing: ['Drawing redaction marks by hand on the canvas', 'Sanitise (metadata, hidden layers) on this computer'],
    needs: 'server',
  },
  {
    id: 'certificates', t: 'T16', group: 'protect', label: 'Use a certificate', blurb: 'Sign, certify, validate', icon: 'badge-check',
    pro: true, proNote: 'Validate is standard', permission: 'files.pdf.sign_digital', lock: 'none', output: 'in-place', runs: 'both', screens: ['DK10'], phase: 'PRO-4', status: 'partial',
    works: 'For Drive PDFs (Pro panel): every signature validated by the server; sign with a PKCS#12 file on this computer (the key stays here) or a certificate WorkSuite holds, PAdES B-B to B-LTA.',
    missing: ['PKCS#11 smart cards and USB tokens (native module)', 'OS keystore (Windows certificate store, macOS keychain)', 'Signing local files'],
    needs: 'server',
  },
  {
    id: 'accessibility', t: 'T18', group: 'advanced', label: 'Prepare for accessibility', blurb: 'Check, tag, reading order', icon: 'user',
    pro: true, proNote: 'Check is standard', permission: 'files.pdf.accessibility', lock: 'edit', output: 'in-place', runs: 'both', screens: ['DK12'], phase: 'PRO-5', status: 'partial',
    works: 'For Drive PDFs (Pro panel): PDF/UA and WCAG check, auto-tag, and fixes for language, title and tab order on the server.',
    missing: ['Tag tree and reading-order editor on the desktop (the server API has it)', 'Read out loud (OS speech)'],
    needs: 'server',
  },
  {
    id: 'standards', t: 'T19', group: 'advanced', label: 'Standards', blurb: 'PDF/A, PDF/X, PDF/UA', icon: 'shield-check',
    pro: true, permission: 'files.pdf.standards', lock: 'none', output: 'copy', runs: 'server', screens: ['DK12'], phase: 'PRO-5', status: 'ui',
    missing: ['Server: veraPDF verify (POST api/files/{id}/pdf/verify), PDF/A convert (exists as api/pdf/server/pdfa)', 'Compliance badges from pdf_compliance_reports'],
    hidden: true,
    needs: 'server',
  },
  {
    id: 'print-production', t: 'T20', group: 'advanced', label: 'Print production', blurb: 'Preflight, output preview', icon: 'printer',
    pro: true, permission: 'files.pdf.print_production', lock: 'none', output: 'report', runs: 'desktop', screens: ['DK13'], phase: 'PRO-5', status: 'ui',
    missing: ['Colour management (LittleCMS) and separations in the engine', 'Preflight profiles and fixups', 'Page boxes and printer marks ops'],
    hidden: true,
  },
  {
    id: 'measure', t: 'T21', group: 'advanced', label: 'Measure objects', blurb: 'Distance, perimeter, area', icon: 'scaling',
    pro: true, permission: 'files.pdf.annotate', lock: 'none', output: 'in-place', runs: 'desktop', screens: ['DK13'], phase: 'PRO-5', status: 'ui',
    missing: ['Measure tools on the annotation layer (line/polygon + scale)', 'Snapping to paths (engine path geometry)', 'Measurement annotations and CSV export'],
    hidden: true,
  },
  {
    id: 'bates', t: 'T23', group: 'advanced', label: 'Bates, index & watermark', blurb: 'Number pages across files', icon: 'hash',
    pro: true, permission: 'files.pdf.edit', lock: 'edit', output: 'in-place', runs: 'both', screens: ['DK14'], phase: 'PRO-2', status: 'partial',
    works: 'On this computer: Bates numbers, headers, footers (Page n of N, the date) and diagonal watermarks stamped on the pages chosen, kept in the PDF, with undo.',
    missing: ['Multi-file runs and the Bates log CSV', 'Portable full-text index', 'Sinhala and Tamil words (the font pipeline)'],
  },
  {
    id: 'actions', t: 'T22', group: 'advanced', label: 'Action wizard', blurb: 'Guided batch actions', icon: 'zap',
    pro: true, permission: 'files.pdf.actions', lock: 'none', output: 'new-file', runs: 'both', screens: ['DK14'], phase: 'PRO-4', status: 'partial',
    works: 'For Drive PDFs (Pro panel): run a saved Action on this PDF; Actions, runs and watched folders are built on the web (PDF Studio Pro › Batch).',
    missing: ['Action builder on the desktop', 'Local runner for files on this computer'],
    needs: 'server',
  },
  {
    id: 'ai', t: 'T24', group: 'advanced', label: 'AI Assistant', blurb: 'Summaries, ask the document', icon: 'sparkles',
    pro: true, proNote: 'Summary is standard when AI is on', permission: 'files.pdf.ai', lock: 'none', output: 'report', runs: 'server', screens: ['DK15'], phase: 'PRO-3', status: 'partial',
    works: 'For Drive PDFs (Pro panel): summarise (whole or this page), ask with page citations, extract data, suggest redactions — through WorkSuite AI on the server.',
    missing: ['Citation highlight on the canvas', 'Save to record note / task'],
    needs: 'server',
  },
];

/** The tools this version lists: those with something that works, here or on the WorkSuite server. */
export const TOOLS: PdfTool[] = ALL_TOOLS.filter((t) => !t.hidden);

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

export const STATUS_LABEL: Record<ToolStatus, string> = { ready: 'Ready', partial: 'Partly ready', ui: 'On the server' };

export const NEEDS_LABEL: Record<NonNullable<PdfTool['needs']>, string> = { server: 'Needs the WorkSuite server', office: 'Needs WorkSuite Office' };

/** What a part of a tool that does not run on this computer needs (PRO-FW-008), or null when it may run here. */
export function toolGate(t: PdfTool): string | null {
  if (t.status !== 'ui') return null;
  return t.needs === 'office' ? `${NEEDS_LABEL.office}: ${t.missing[0]}.` : `${NEEDS_LABEL.server}: ${t.missing[0]}.`;
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
