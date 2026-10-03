import { PSTFile, type PSTFolder, type PSTMessage } from 'pst-extractor';
import { addressList, buildMime, keptHeaders, mailDate, type MimeAddress, type MimeAttachment } from './mime';
import { MAX_MESSAGE_BYTES, type DataBatch, type DataFileReader, type DataFolder, type DataItem } from './types';

/**
 * An Outlook data file (.pst, also .ost) in the data-file worker
 * (ENH-MAIL-03 DMO-DAT-01, WF-DO09).
 *
 * Read with pst-extractor, which reads the file a block at a time through a
 * file descriptor — a 4 GB file is never in memory. Each email becomes a real
 * RFC 822 message (mime.ts): a received one keeps its own transport headers
 * (Received, Message-ID, Date, From …) and only its body is rebuilt; one that
 * never travelled (a draft, a sent item from an Exchange mailbox) gets
 * headers made from its properties.
 *
 * A folder the library cannot read — a damaged part of the file, a search
 * folder — is reported as unreadable and the rest carries on.
 */

/** PR_ATTACH_METHOD: by value, an embedded message. */
const ATTACH_BY_VALUE = 1;
const ATTACH_EMBEDDED = 5;

/** Message classes that are email (a meeting request is mail too: it carries an invitation). */
export function isMailClass(cls: string): boolean {
  return /^(IPM\.Note|IPM\.Post|IPM\.Schedule\.Meeting|REPORT\.IPM|IPM\.Outlook\.Recall|IPM\.Sharing)/i.test(cls || 'IPM.Note');
}

/** A folder of email, by its container class (an empty class is mail in older files). */
export function isMailFolder(containerClass: string): boolean {
  return !containerClass || /^IPF\.(Note|Imap)/i.test(containerClass);
}

const email = (v: string | null | undefined): string => (v && /@/.test(v) ? v.trim() : '');

/** One email item as RFC 822. Embedded messages become message/rfc822 attachments, three deep at most. */
export function pstMessageToMime(m: PSTMessage, depth = 0): Buffer {
  const transport = (m.transportMessageHeaders || '').trim();
  const kept = transport ? keptHeaders(transport) : { lines: [], names: new Set<string>() };
  const headers: Array<[string, string]> = [];
  const add = (name: string, value: string | null | undefined) => {
    if (value && !kept.names.has(name.toLowerCase())) headers.push([name, value]);
  };

  const when = m.clientSubmitTime ?? m.messageDeliveryTime ?? m.creationTime;
  const fromEmail = email(m.senderEmailAddress) || email(m.sentRepresentingEmailAddress);
  const fromName = m.senderName || m.sentRepresentingName || '';
  const recipients: Record<'to' | 'cc' | 'bcc', MimeAddress[]> = { to: [], cc: [], bcc: [] };
  for (let i = 0; i < m.numberOfRecipients; i++) {
    const r = m.getRecipient(i);
    if (!r) continue;
    const kind = r.recipientType === 2 ? 'cc' : r.recipientType === 3 ? 'bcc' : 'to';
    const addr = email(r.smtpAddress) || email(r.emailAddress);
    if (addr) recipients[kind].push({ name: r.displayName, email: addr });
  }

  add('Date', when ? mailDate(when) : null);
  add('From', fromEmail ? addressList([{ name: fromName, email: fromEmail }]) : null);
  add('To', addressList(recipients.to) || null);
  add('Cc', addressList(recipients.cc) || null);
  // Only on a message that never went: who it was for is the sender's own record.
  if (!transport) add('Bcc', addressList(recipients.bcc) || null);
  add('Subject', m.subject || '');
  add('Message-ID', /^<[^<>\s]+>$/.test((m.internetMessageId || '').trim()) ? m.internetMessageId.trim() : null);
  add('In-Reply-To', /^<[^<>\s]+>$/.test((m.inReplyToId || '').trim()) ? m.inReplyToId.trim() : null);
  if (m.importance === 2) add('Importance', 'High');
  if (m.importance === 0) add('Importance', 'Low');

  const attachments: MimeAttachment[] = [];
  for (let i = 0; i < m.numberOfAttachments; i++) {
    try {
      const a = m.getAttachment(i);
      if (a.attachMethod === ATTACH_EMBEDDED && depth < 3) {
        const inner = a.embeddedPSTMessage;
        if (inner) attachments.push({ name: `${(inner.subject || 'message').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.eml`, mime: 'message/rfc822', data: pstMessageToMime(inner, depth + 1) });
        continue;
      }
      if (a.attachMethod !== ATTACH_BY_VALUE) continue;
      const stream = a.fileInputStream;
      if (!stream) continue;
      const size = a.filesize;
      if (size > MAX_MESSAGE_BYTES) continue;
      const data = Buffer.alloc(size);
      if (size > 0) stream.readCompletely(data);
      attachments.push({ name: a.longFilename || a.filename || `attachment-${i + 1}`, mime: a.mimeTag || 'application/octet-stream', data, contentId: a.contentId || undefined });
    } catch {
      // An attachment the file cannot give back: the message comes without it.
    }
  }

  return buildMime({ raw: kept.lines, headers, text: m.body || '', html: m.bodyHTML || '', attachments });
}

/** The folder path inside the file, without the store's own root. */
function pathOf(names: string[]): string {
  return names
    .map((n) => n.replace(/\//g, '-').trim())
    .filter(Boolean)
    .join('/');
}

export class PstReader implements DataFileReader {
  private readonly file: PSTFile;
  private readonly byId = new Map<number, PSTFolder>();

  constructor(path: string) {
    this.file = new PSTFile(path);
  }

  folders(): { folders: DataFolder[]; unreadable: string[] } {
    const out: DataFolder[] = [];
    const unreadable: string[] = [];
    const root = this.file.getRootFolder();
    let tops: PSTFolder[] = [];
    try {
      tops = root.getSubFolders();
    } catch {
      return { folders: [], unreadable: ['(the whole file)'] };
    }
    // The mail lives under "Top of Personal Folders" / "Top of Outlook data file"; search folders beside it are not mail.
    const top = tops.find((f) => /^top of /i.test(f.displayName));
    const walk = (folder: PSTFolder, trail: string[]) => {
      let subs: PSTFolder[] = [];
      try {
        subs = folder.hasSubfolders ? folder.getSubFolders() : [];
      } catch {
        unreadable.push(pathOf(trail) || folder.displayName);
        return;
      }
      for (const sub of subs) {
        const names = [...trail, sub.displayName];
        const id = this.byId.size + 1;
        this.byId.set(id, sub);
        out.push({ id, path: pathOf(names), count: sub.contentCount, mail: isMailFolder(sub.containerClass) });
        if (out.length < 5000) walk(sub, names);
      }
    };
    if (top) walk(top, []);
    else walk(root, []);
    return { folders: out, unreadable };
  }

  batch(folderId: number, offset: number, limit: number, maxBytes: number): DataBatch {
    const folder = this.byId.get(folderId);
    if (!folder) return { items: [], next: null };
    const items: DataItem[] = [];
    let used = 0;
    folder.moveChildCursorTo(offset);
    let at = offset;
    while (items.length < limit) {
      let child: PSTMessage | null = null;
      try {
        child = folder.getNextChild() as PSTMessage | null;
      } catch (e) {
        items.push({ flags: [], date: null, error: `Item ${at + 1} could not be read (${(e as Error).message.slice(0, 80)}).` });
        at++;
        continue;
      }
      if (!child) return { items, next: null };
      at++;
      const date = (child.messageDeliveryTime ?? child.clientSubmitTime ?? child.creationTime)?.toISOString() ?? null;
      if (!isMailClass(child.messageClass)) {
        items.push({ flags: [], date, subject: child.subject, skip: 'Not an email.' });
        continue;
      }
      try {
        const raw = pstMessageToMime(child);
        if (raw.length > MAX_MESSAGE_BYTES) {
          items.push({ flags: [], date, subject: child.subject, error: 'Larger than 24 MB.' });
          continue;
        }
        const flags = [...(child.isRead ? ['\\Seen'] : []), ...(child.isUnsent ? ['\\Draft'] : [])];
        items.push({ raw, flags, date, subject: child.subject });
        used += raw.length;
        if (used >= maxBytes) break;
      } catch (e) {
        items.push({ flags: [], date, subject: child.subject, error: `Could not be read (${(e as Error).message.slice(0, 80)}).` });
      }
    }
    return { items, next: at };
  }

  close(): void {
    try {
      this.file.close();
    } catch {
      // already closed
    }
  }
}
