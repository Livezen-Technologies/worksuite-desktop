/**
 * Settings › Mail › Images & media, the part kept on this computer
 * (worksuite-desktop#163): which attachments the background sync downloads
 * ahead, on which connection, of which kinds, and where they are kept — and
 * the keys under which downloaded attachments and loaded pictures are kept in
 * the local mail store, so the next open is instant and works offline.
 *
 * What pictures load (Always · Ask · Only from trusted senders · Never) and
 * whom to trust are the person's on every device, so they live with Mail's
 * other settings on the server (src/modules/mail/images.ts).
 */
import { extensionOf } from './attachments';

export type AutoDownload = 'off' | '5' | '25' | 'all';
export type AutoDownloadType = 'images' | 'pdf' | 'office' | 'all';

export interface MailMediaPrefs {
  /** Attachments downloaded ahead: none, under 5 MB (the default), under 25 MB, or all. */
  autoDownload: AutoDownload;
  /** Any connection, or not on one that is metered (a mobile hotspot, a data allowance). */
  network: 'any' | 'unmetered';
  /** Which kinds; "all" alone means every kind. */
  types: AutoDownloadType[];
  /** Kept in the local mail store only, or also saved into a WorkSuite Files folder. */
  saveTo: 'local' | 'files';
  filesFolder: { id: number; name: string } | null;
}

export const DEFAULT_MAIL_MEDIA: MailMediaPrefs = { autoDownload: '5', network: 'any', types: ['all'], saveTo: 'local', filesFolder: null };

/** "All" downloads ahead up to this much a file: one attachment never fills the store. */
export const ALL_LIMIT_BYTES = 100 * 1024 * 1024;

export function mailMediaPrefs(p: { mailMedia?: Partial<MailMediaPrefs> } | null | undefined): MailMediaPrefs {
  const m = { ...DEFAULT_MAIL_MEDIA, ...(p?.mailMedia ?? {}) };
  return { ...m, types: m.types?.length ? m.types : ['all'] };
}

export function sizeLimit(a: AutoDownload): number {
  return a === 'off' ? 0 : a === '5' ? 5 * 1024 * 1024 : a === '25' ? 25 * 1024 * 1024 : ALL_LIMIT_BYTES;
}

const OFFICE = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'csv']);

/** What kind of file an attachment is, for the Download types setting. */
export function attachmentKind(name: string, mime: string): 'images' | 'pdf' | 'office' | 'other' {
  const m = (mime || '').toLowerCase();
  const ext = extensionOf(name);
  if (m.startsWith('image/') && m !== 'image/svg+xml') return 'images';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) return 'images';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (OFFICE.has(ext) || /msword|ms-excel|ms-powerpoint|officedocument|opendocument/.test(m)) return 'office';
  return 'other';
}

export interface AutoDownloadInput {
  name: string;
  mime: string;
  size: number;
}

/**
 * Whether the background sync downloads this attachment ahead: the size,
 * type and network settings — and never a file WorkSuite blocks (`blocked`).
 */
export function shouldAutoDownload(a: AutoDownloadInput, prefs: MailMediaPrefs, net: { metered: boolean }, blocked = false): boolean {
  if (blocked || prefs.autoDownload === 'off') return false;
  if (prefs.network === 'unmetered' && net.metered) return false;
  if (!(a.size > 0) || a.size > sizeLimit(prefs.autoDownload)) return false;
  if (prefs.types.includes('all')) return true;
  const kind = attachmentKind(a.name, a.mime);
  return kind !== 'other' && prefs.types.includes(kind);
}

/**
 * Where a downloaded attachment is kept in the local mail store: its message's
 * address with `local=1`, which no request from a page carries — so the copy
 * is found only by the code that asks for it, never served as the API's answer.
 */
export function attachmentStorePath(m: { uid: string | number; ref: string; folder: string; mailbox: string | null | undefined }): string {
  const q = new URLSearchParams({ folder: m.folder, ...(m.mailbox ? { mailbox: String(m.mailbox) } : {}), local: '1' });
  return `/api/mail/messages/${m.uid}/attachments/${encodeURIComponent(m.ref)}?${q.toString()}`;
}

/** The same key for a download's own address (`?folder=&dl=1&mailbox=`), or null when it is not an attachment's. */
export function attachmentStorePathOf(apiPath: string): string | null {
  const m = /^\/api\/mail\/messages\/(\d{1,20})\/attachments\/([^/?]+)\?(.*)$/.exec(apiPath);
  if (!m) return null;
  const q = new URLSearchParams(m[3]);
  const folder = q.get('folder');
  if (!folder) return null;
  return attachmentStorePath({ uid: m[1]!, ref: decodeURIComponent(m[2]!), folder, mailbox: q.get('mailbox') });
}

/** Where a picture loaded from the web is kept: by a hash of its address, never the address itself. */
export function imageStorePath(hash: string, mailbox?: string | null): string {
  return `/api/mail/images/${hash}${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`;
}

/** A picture type the reader shows from the store: SVG never (it can carry script). */
export function storableImageType(contentType: string): string | null {
  const t = contentType.split(';')[0]!.trim().toLowerCase();
  return /^image\/(png|jpe?g|gif|webp|bmp|avif)$/.test(t) ? (t === 'image/jpg' ? 'image/jpeg' : t) : null;
}
