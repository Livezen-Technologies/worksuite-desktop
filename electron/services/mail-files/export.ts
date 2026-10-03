import { closeSync, openSync, writeSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Export a folder or a search result to an .mbox file or a zip of .eml files
 * (ENH-MAIL-03 DMO-DAT-03). Each message is the server's original, byte for
 * byte, fetched one at a time and written straight to the file — the export
 * never holds the folder in memory. Export to .pst is not offered: the
 * format is Outlook's own and cannot be written faithfully (the wizard says so).
 *
 * Only when the organisation allows exports (`mail.datafile.export`, off by
 * default); every export is recorded in the activity log.
 */

export interface ExportHttp {
  get<T>(path: string, opts?: { query?: Record<string, string | number | boolean | null | undefined> }): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  source(uid: string, folder: string, mailbox: string | null): Promise<Buffer>;
}

export interface ExportRequest {
  mailbox: string | null;
  folder: string;
  folderName: string;
  format: 'mbox' | 'eml';
  /** A search result: these messages only, each from its own folder. Otherwise the whole folder. */
  items?: Array<{ uid: string; folder: string; mailbox: string | null }>;
}

export const MAX_EXPORT = 50_000;

/** asctime, as the From_ line wants it: "Mon Oct 12 10:00:00 2026". */
export function asctime(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
}

/** One message as an mbox entry (mboxrd): a From_ line, LF endings, "From " lines in the body quoted. */
export function mboxEntry(raw: Buffer): Buffer {
  const text = raw.toString('latin1').replace(/\r\n/g, '\n');
  const head = text.split('\n\n', 1)[0] ?? '';
  const from = /^Return-Path:\s*<([^>\s]*)>/im.exec(head)?.[1] || /^From:.*?([^\s<>"]+@[^\s<>"]+)/im.exec(head)?.[1] || 'MAILER-DAEMON';
  const dateHeader = /^Date:\s*(.+)$/im.exec(head)?.[1];
  const d = dateHeader ? new Date(dateHeader) : new Date(0);
  const when = Number.isNaN(d.getTime()) ? new Date(0) : d;
  const quoted = text.replace(/^(>*From )/gm, '>$1');
  return Buffer.from(`From ${from} ${asctime(when)}\n${quoted}${quoted.endsWith('\n') ? '' : '\n'}\n`, 'latin1');
}

/** A file name from a subject. */
export function emlName(n: number, subject: string): string {
  const s = subject.replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'message';
  return `${String(n).padStart(5, '0')} ${s}.eml`;
}

/** A zip written as it goes: each entry's header, then its deflated bytes; the directory at the end. No zip64. */
export class ZipWriter {
  private offset = 0;
  private readonly central: Buffer[] = [];
  private count = 0;

  constructor(private readonly fd: number) {}

  private write(b: Buffer): void {
    writeSync(this.fd, b);
    this.offset += b.length;
  }

  add(name: string, data: Buffer, when = new Date()): void {
    if (this.count >= 65_000) throw new Error('A zip can hold 65,000 messages; export the rest as .mbox.');
    const fileName = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data);
    if (this.offset + deflated.length + 100 > 0xffffffff) throw new Error('The zip would pass 4 GB; export as .mbox instead.');
    const crc = crc32(data) >>> 0;
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
    const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const at = this.offset;
    this.write(Buffer.concat([local, fileName]));
    this.write(deflated);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(deflated.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(fileName.length, 28);
    c.writeUInt32LE(at, 42);
    this.central.push(Buffer.concat([c, fileName]));
    this.count++;
  }

  finish(): void {
    const start = this.offset;
    for (const c of this.central) this.write(c);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
  }
}

/** The messages of a folder, newest first, a page at a time. */
async function listFolder(http: ExportHttp, req: ExportRequest): Promise<Array<{ uid: string; subject: string; folder: string; mailbox: string | null }>> {
  const out: Array<{ uid: string; subject: string; folder: string; mailbox: string | null }> = [];
  for (let page = 1; out.length < MAX_EXPORT; page++) {
    const r = await http.get<{ messages: Array<{ id: number | string; subject: string }>; has_more: boolean }>('/api/mail/messages', {
      query: { folder: req.folder, page, per_page: 100, ...(req.mailbox ? { mailbox: req.mailbox } : {}) },
    });
    for (const m of r.messages ?? []) out.push({ uid: String(m.id), subject: m.subject ?? '', folder: req.folder, mailbox: req.mailbox });
    if (!r.has_more || !(r.messages ?? []).length) break;
  }
  return out.slice(0, MAX_EXPORT);
}

export async function exportMail(
  http: ExportHttp,
  req: ExportRequest,
  path: string,
  progress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<{ count: number; failed: number; cancelled: boolean }> {
  const policy = await http.get<{ export: boolean }>('/api/mail/imports/datafile/policy');
  if (!policy.export) throw new Error('Your organisation does not allow exporting mail to a file.');
  const list = req.items?.length ? req.items.slice(0, MAX_EXPORT).map((it) => ({ ...it, subject: '' })) : await listFolder(http, req);
  const fd = openSync(path, 'w', 0o600);
  const zip = req.format === 'eml' ? new ZipWriter(fd) : null;
  let count = 0;
  let failed = 0;
  try {
    for (const [i, m] of list.entries()) {
      if (cancelled()) break;
      try {
        const raw = await http.source(m.uid, m.folder, m.mailbox);
        if (zip) zip.add(emlName(i + 1, m.subject || /^Subject:\s*(.*)$/im.exec(raw.subarray(0, 16384).toString('utf8'))?.[1] || ''), raw);
        else writeSync(fd, mboxEntry(raw));
        count++;
      } catch (e) {
        if (/zip/i.test((e as Error).message)) throw e;
        failed++;
      }
      progress(i + 1, list.length);
    }
    zip?.finish();
  } finally {
    closeSync(fd);
  }
  await http.post('/api/mail/exports/log', { format: req.format, count, folder: req.folderName }).catch(() => undefined);
  return { count, failed, cancelled: cancelled() };
}
