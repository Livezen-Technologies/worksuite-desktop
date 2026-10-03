import MsgReader from '@kenjiuno/msgreader';
import { addressList, buildMime, keptHeaders, mailDate, type MimeAddress, type MimeAttachment } from './mime';

/**
 * An Outlook .msg file — one message saved from Outlook (ENH-MAIL-03
 * DMO-DAT-04). Read with @kenjiuno/msgreader and turned into RFC 822 the
 * same way a .pst item is, so the viewer and the import treat both alike.
 * Read-only: WorkSuite never writes .msg (§1.3).
 */

const email = (v: string | undefined): string => (v && /@/.test(v) ? v.trim() : '');

function htmlOf(f: { bodyHtml?: string; html?: Uint8Array }): string {
  if (f.bodyHtml) return f.bodyHtml;
  if (!f.html?.length) return '';
  const bytes = Buffer.from(f.html);
  // The HTML property is bytes in the message's code page; a charset in the HTML says which, else UTF-8.
  const declared = /charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString('latin1'))?.[1]?.toLowerCase();
  try {
    return new TextDecoder(declared && declared !== 'utf-8' ? declared : 'utf-8').decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

export function msgToMime(data: Buffer, depth = 0): Buffer {
  const reader = new MsgReader(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const f = reader.getFileData();
  if (f.error) throw new Error(f.error);
  const transport = (f.headers || '').trim();
  const kept = transport ? keptHeaders(transport) : { lines: [], names: new Set<string>() };
  const headers: Array<[string, string]> = [];
  const add = (name: string, value: string | null | undefined) => {
    if (value && !kept.names.has(name.toLowerCase())) headers.push([name, value]);
  };
  const recipients: Record<'to' | 'cc' | 'bcc', MimeAddress[]> = { to: [], cc: [], bcc: [] };
  for (const r of f.recipients ?? []) {
    const addr = email(r.smtpAddress) || email(r.email);
    if (addr) recipients[r.recipType === 'cc' ? 'cc' : r.recipType === 'bcc' ? 'bcc' : 'to'].push({ name: r.name, email: addr });
  }
  const when = f.clientSubmitTime ?? f.messageDeliveryTime ?? f.creationTime;
  const date = when ? new Date(when) : null;
  add('Date', date && !Number.isNaN(date.getTime()) ? mailDate(date) : null);
  const from = email(f.senderSmtpAddress) || email(f.senderEmail);
  add('From', from ? addressList([{ name: f.senderName, email: from }]) : null);
  add('To', addressList(recipients.to) || null);
  add('Cc', addressList(recipients.cc) || null);
  if (!transport) add('Bcc', addressList(recipients.bcc) || null);
  add('Subject', f.subject || '');
  const mid = (f.messageId || '').trim();
  add('Message-ID', /^<[^<>\s]+>$/.test(mid) ? mid : null);

  const attachments: MimeAttachment[] = [];
  for (const a of f.attachments ?? []) {
    try {
      if (a.innerMsgContent && a.innerMsgContentFields && depth < 3) {
        const inner = reader.getAttachment(a);
        attachments.push({ name: `${(a.innerMsgContentFields.subject || a.name || 'message').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.eml`, mime: 'message/rfc822', data: msgToMime(Buffer.from(inner.content), depth + 1) });
        continue;
      }
      const got = reader.getAttachment(a);
      attachments.push({ name: got.fileName || a.fileName || a.fileNameShort || 'attachment', mime: a.attachMimeTag || 'application/octet-stream', data: Buffer.from(got.content), contentId: a.pidContentId || undefined });
    } catch {
      // An attachment the file cannot give back: the message comes without it.
    }
  }

  return buildMime({ raw: kept.lines, headers, text: f.body || '', html: htmlOf(f), attachments });
}
