/**
 * The upload rules every module shares (worksuite-desktop#249): Drive, Tenders,
 * Tasks, Mail attachments and chats all send a file the same way — through the
 * transfer manager, in parts, resumably — so one file size limit and one set of
 * messages hold for all of them.
 *
 * A file above `CHUNKED_FROM` goes up in `CHUNK_BYTES` parts, `PARALLEL_PARTS`
 * at a time, each part tried `PART_ATTEMPTS` times with backoff. Nothing is
 * given an overall time limit: a part is stopped only when no bytes have moved
 * (and no answer has come) for `STALL_MS`.
 */

/** The largest file anybody can upload from this app, checked before a byte is sent. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/** How the limit reads in a message. */
export const MAX_UPLOAD_LABEL = '2 GB';
/** A mail attachment is staged for a message, and most mail servers refuse a message over 25 MB. */
export const MAX_MAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Files above this go in full-size parts, several at a time. */
export const CHUNKED_FROM = 8 * 1024 * 1024;
/** The size of one part of a large file (the server may ask for less: its own request limit). */
export const CHUNK_BYTES = 8 * 1024 * 1024;
/** Parts of one file in flight together. */
export const PARALLEL_PARTS = 3;
/** Tries for one part before the upload waits and is tried again later. */
export const PART_ATTEMPTS = 5;
/**
 * A voice message above this goes in `VOICE_CHUNK_BYTES` parts (worksuite-desktop#300), so an interrupted one carries
 * on from the last part the server has instead of starting again; below it, one request does it.
 */
export const VOICE_CHUNKED_FROM = 1024 * 1024;
/** One part of a voice message above `VOICE_CHUNKED_FROM` (the server takes no part under 256 KB). */
export const VOICE_CHUNK_BYTES = 512 * 1024;
/**
 * A chat message's automatic retries after a temporary failure (#300): 2 s, 5 s, 15 s, 30 s, 60 s, then it stops
 * and its bubble offers Retry and Cancel. It is tried again by itself when the connection comes back and when
 * WorkSuite next starts.
 */
export const CHAT_RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

/** No bytes moved and no answer for this long: the request is given up as stalled, and tried again. */
export const STALL_MS = 60_000;

export const TOO_LARGE = `File is larger than the ${MAX_UPLOAD_LABEL} limit`;
export const CONNECTION_LOST = 'Connection lost · paused, will continue automatically';
export const TYPE_REFUSED = 'Server rejected the file (type not allowed)';
export const STALLED = 'The upload stalled: no data moved for 60 seconds. It will continue automatically.';
export const PART_TOO_LARGE = 'Server rejected the upload: each part is larger than the server accepts. Ask your administrator to raise the upload limit (see the WorkSuite upload limits guide).';
export const MAIL_TOO_LARGE = 'File is larger than the 25 MB limit for mail attachments. Send it as a Drive link instead.';

/** Why a file cannot be uploaded at all, before anything is sent; null when it can. */
export function uploadRefusal(size: number, max = MAX_UPLOAD_BYTES): string | null {
  if (!Number.isFinite(size) || size < 0) return 'That file could not be read.';
  if (size > max) return max === MAX_MAIL_ATTACHMENT_BYTES ? MAIL_TOO_LARGE : TOO_LARGE;
  return null;
}

/**
 * The server's refusal of an upload, in words a person can act on. A 413 is a
 * size limit (the file, or one part of it), a 415 or a refusal that names the
 * file's type is the type; anything else keeps the server's own message.
 */
export function refusalMessage(status: number, serverMessage: string | null | undefined, where: 'file' | 'part' = 'file'): string {
  const said = (serverMessage ?? '').trim();
  if (status === 413) return where === 'part' ? PART_TOO_LARGE : said && /limit/i.test(said) ? said : TOO_LARGE;
  if (status === 415 || /\b(file )?type\b.*\b(not allowed|blocked|refused|isn'?t allowed)|\bnot allowed\b.*\btype\b|extension.*(not allowed|blocked)/i.test(said)) return TYPE_REFUSED;
  return said || `The server refused the file (${status}).`;
}

/** "Uploading 42%" for a row that is on its way, from the bytes the transfer manager reports. */
export function uploadPercent(bytes: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((bytes / total) * 100)));
}
