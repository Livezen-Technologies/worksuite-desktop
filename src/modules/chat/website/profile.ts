/**
 * The website channel profile of the shared composer (WS-WCHAT ENH-02,
 * RDC-02/03/04): what a website visitor can receive, checked before anything
 * is uploaded, and saved replies found with "/".
 */

/** What the widget's attach accepts (WidgetGate::UPLOAD_TYPES), by extension. */
export const VISITOR_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The widget's default upload limit (chat_widgets.max_upload_kb). */
export const VISITOR_MAX_KB = 5120;

/**
 * Why a file cannot go to a visitor, in a sentence — or null when it can.
 * The server checks again; this only saves uploading something it would refuse.
 */
export function refuseForVisitor(name: string, size: number, maxKb = VISITOR_MAX_KB): string | null {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!ext || !VISITOR_TYPES[ext]) return `${ext ? `${ext.toUpperCase()} files` : 'Files without a type'} can't be sent to a visitor.`;
  const limit = Math.max(64, maxKb) * 1024;
  if (size > limit) return `${name} is larger than the ${(limit / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB a visitor can receive.`;
  return null;
}

export interface SavedReply {
  id: number;
  shortcut: string | null;
  title: string;
  body: string;
  /** Uses in all; the composer's chips are the most used (RDC-03). */
  uses?: number;
  /** The widget it is for; null for every widget (CAN-01). From S-09. */
  widget_id?: number | null;
  /** Uses this month: "Used 54 times this month" (S-09, UX-SET-10). */
  month_uses?: number;
}

/** A "/" being typed at the start of a word, with what follows it (RDC-03). */
export function savedReplyQuery(text: string, caret: number): { start: number; word: string } | null {
  const m = /(^|\s)\/([a-z0-9-]{0,40})$/i.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, word: m[2]!.toLowerCase() } : null;
}

/** Saved replies for what follows the "/": shortcuts that start with it first, then titles that contain it. */
export function matchReplies(replies: SavedReply[], word: string, limit = 8): SavedReply[] {
  const w = word.toLowerCase();
  if (!w) return replies.slice(0, limit);
  const byShortcut = replies.filter((r) => r.shortcut?.toLowerCase().startsWith(w));
  const byTitle = replies.filter((r) => !byShortcut.includes(r) && (r.title.toLowerCase().includes(w) || r.shortcut?.toLowerCase().includes(w)));
  return [...byShortcut, ...byTitle].slice(0, limit);
}
