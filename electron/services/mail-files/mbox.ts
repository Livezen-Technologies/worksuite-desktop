import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { MAX_MESSAGE_BYTES, type DataBatch, type DataFileReader, type DataFolder, type DataItem } from './types';

/**
 * An mbox file — Thunderbird, Apple Mail, Gmail Takeout (ENH-MAIL-03
 * DMO-DAT-02).
 *
 * Read in 1 MB slices, never whole: the first pass only notes where each
 * message starts (a "From " line at the start of the file or after an empty
 * line); a batch then reads just its messages' bytes.
 *
 * mboxrd quoting is undone (">From " → "From "), and the flags mail apps
 * keep in the message — Status/X-Status, Thunderbird's X-Mozilla-Status — are
 * carried as IMAP flags. A message Thunderbird marked deleted is not brought
 * back.
 */

const CHUNK = 1024 * 1024;

/** Where each message starts, and its From_ line's end. */
export function scanMbox(fd: number, size: number): number[] {
  const starts: number[] = [];
  const buf = Buffer.alloc(CHUNK + 6);
  let pos = 0;
  // "\n\n" before "From " — or the start of the file.
  let prev = Buffer.from('\n\n');
  while (pos < size) {
    const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
    if (n <= 0) break;
    const view = Buffer.concat([prev, buf.subarray(0, n)]);
    let i = view.indexOf('\nFrom ', 0);
    while (i >= 0) {
      const lineStart = i + 1;
      const blankBefore = i >= 1 && (view[i - 1] === 0x0a || (view[i - 1] === 0x0d && i >= 2 && view[i - 2] === 0x0a));
      const abs = pos - prev.length + lineStart;
      if (blankBefore && abs >= 0 && (starts.length === 0 || abs > starts[starts.length - 1]!)) starts.push(abs);
      i = view.indexOf('\nFrom ', i + 1);
    }
    prev = view.subarray(Math.max(0, view.length - 6));
    pos += n;
  }
  return starts;
}

/** A message's bytes without its From_ line, with mboxrd quoting undone and CRLF endings. */
export function unwrapMbox(chunk: Buffer): string {
  const text = chunk.toString('latin1');
  const body = text.replace(/^From [^\n]*\n/, '');
  return body
    .replace(/\r?\n/g, '\n')
    .replace(/^>(>*From )/gm, '$1')
    .replace(/\n+$/, '\n')
    .replace(/\n/g, '\r\n');
}

/** The IMAP flags a message's own status headers record; `deleted` when the mail app had deleted it. */
export function mboxFlags(headerBlock: string): { flags: string[]; deleted: boolean } {
  const h = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(headerBlock)?.[1]?.trim() ?? '';
  const flags = new Set<string>();
  const status = h('Status');
  const xstatus = h('X-Status');
  if (/R/.test(status)) flags.add('\\Seen');
  if (/F/.test(xstatus)) flags.add('\\Flagged');
  if (/A/.test(xstatus)) flags.add('\\Answered');
  let deleted = /D/.test(xstatus);
  const moz = h('X-Mozilla-Status');
  if (/^[0-9a-f]{4}$/i.test(moz)) {
    const v = parseInt(moz, 16);
    if (v & 0x0001) flags.add('\\Seen');
    if (v & 0x0002) flags.add('\\Answered');
    if (v & 0x0004) flags.add('\\Flagged');
    if (v & 0x0008) deleted = true;
  }
  return { flags: [...flags], deleted };
}

export class MboxReader implements DataFileReader {
  private readonly fd: number;
  private readonly size: number;
  private starts: number[] | null = null;

  constructor(private readonly path: string) {
    this.fd = openSync(path, 'r');
    this.size = fstatSync(this.fd).size;
  }

  private index(): number[] {
    if (!this.starts) {
      const s = scanMbox(this.fd, this.size);
      // A file that does not start with "From " still has a first message.
      this.starts = s.length && s[0] === 0 ? s : this.size > 0 ? [0, ...s] : s;
    }
    return this.starts;
  }

  folders(): { folders: DataFolder[]; unreadable: string[] } {
    const name = basename(this.path, extname(this.path)) || 'Mailbox';
    return { folders: [{ id: 1, path: name, count: this.index().length, mail: true }], unreadable: [] };
  }

  batch(folderId: number, offset: number, limit: number, maxBytes: number): DataBatch {
    const starts = this.index();
    if (folderId !== 1) return { items: [], next: null };
    const items: DataItem[] = [];
    let used = 0;
    let i = offset;
    for (; i < starts.length && items.length < limit && used < maxBytes; i++) {
      const from = starts[i]!;
      const to = i + 1 < starts.length ? starts[i + 1]! : this.size;
      const len = to - from;
      if (len > MAX_MESSAGE_BYTES) {
        items.push({ flags: [], date: null, error: 'Larger than 24 MB.' });
        continue;
      }
      const buf = Buffer.alloc(len);
      readSync(this.fd, buf, 0, len, from);
      const fromLine = /^From \S+\s+(.+)$/m.exec(buf.subarray(0, Math.min(len, 400)).toString('latin1'))?.[1];
      const raw = unwrapMbox(buf);
      const head = raw.split('\r\n\r\n', 1)[0] ?? '';
      const { flags, deleted } = mboxFlags(head);
      const subject = /^Subject:\s*(.*)$/im.exec(head)?.[1];
      if (deleted) {
        items.push({ flags, date: null, subject, skip: 'Deleted in the mail app it came from.' });
        continue;
      }
      const parsed = fromLine ? new Date(fromLine.replace(/\s+/g, ' ')) : null;
      items.push({ raw: Buffer.from(raw, 'latin1'), flags, date: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null, subject });
      used += len;
    }
    return { items, next: i < starts.length ? i : null };
  }

  close(): void {
    try {
      closeSync(this.fd);
    } catch {
      // already closed
    }
  }
}
