/**
 * The composer's pure rules (FR-COM-04/05/08, FR-DSK-06), kept apart so they are tested on their own.
 */

/** The "/word" being typed at the start of a line, if the caret is in one: what the canned picker searches for. */
export function slashQuery(text: string, caret: number): { start: number; word: string } | null {
  const m = /(^|\n)\/([^\s/]{0,40})$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, word: m[2]! } : null;
}

/** The "@word" being typed, if the caret is in one: what the mention picker searches for (Chat's rule). */
export function mentionQuery(text: string, caret: number): { start: number; word: string } | null {
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, word: m[2]! } : null;
}

/** `text` with the part from `start` to `end` replaced, and where the caret goes after it. */
export function spliceText(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

/** What Chromium calls a picture that came without a name of its own: a screenshot, a copied image. */
const UNNAMED = /^image\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A pasted picture's name, as the Mac names a screenshot: "Screenshot 2026-10-04 at 09.47.12.png". A pasted file
 * that came with a name of its own (copied in Finder or Explorer) keeps it.
 */
export function pastedName(file: { name: string; type: string }, at: Date): string {
  if (file.name && !UNNAMED.test(file.name)) return file.name;
  const ext = /^image\/(png|jpeg|gif|webp)$/.exec(file.type)?.[1]?.replace('jpeg', 'jpg') ?? 'png';
  return `Screenshot ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} at ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}.${ext}`;
}

/**
 * Whether a paste is files to attach rather than text to type. A screenshot is only a picture; a file copied in
 * Finder or Explorer is the file (with its name as text). Cells copied from a spreadsheet, or a paragraph from Word,
 * come as their text with an unnamed picture of it — the text is what was meant.
 */
export function pasteIsFiles(files: ReadonlyArray<{ name: string }>, text: string): boolean {
  if (!files.length) return false;
  if (!text.trim()) return true;
  return !files.every((f) => UNNAMED.test(f.name));
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** CC addresses as typed — commas, semicolons or spaces between them — and what is no address. */
export function parseCc(raw: string): { emails: string[]; bad: string[] } {
  const parts = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const emails: string[] = [];
  const bad: string[] = [];
  for (const p of parts) {
    if (!EMAIL.test(p)) bad.push(p);
    else if (!emails.some((e) => e.toLowerCase() === p.toLowerCase())) emails.push(p);
  }
  return { emails, bad };
}

/** The people a note still mentions: those picked whose "@Name" is still in the text. */
export function mentionedIds(body: string, picked: ReadonlyArray<{ id: number; name: string }>): number[] {
  return [...new Set(picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id))];
}
