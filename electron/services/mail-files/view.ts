import PostalMime, { type Address } from 'postal-mime';
import type { MailFileView } from './types';

/**
 * A message file opened to read (ENH-MAIL-03 DMO-DAT-04): parsed with
 * postal-mime in the data-file worker. The HTML is handed on untouched and
 * untrusted — the reader sanitises it exactly as it does received mail and
 * shows it in the same sandboxed frame. Attachments stay here until the
 * person saves one.
 */

type Addr = Address;

function flat(list: Addr[] | Addr | undefined): Array<{ name: string; email: string }> {
  const out: Array<{ name: string; email: string }> = [];
  for (const a of Array.isArray(list) ? list : list ? [list] : []) {
    if (a.group) out.push(...a.group.map((m) => ({ name: m.name, email: m.address })));
    else if (a.address) out.push({ name: a.name, email: a.address });
  }
  return out;
}

export interface ParsedFile {
  view: MailFileView;
  attachments: Array<{ name: string; mime: string; data: Buffer }>;
}

export async function parseMailFile(raw: Buffer): Promise<ParsedFile> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer', maxNestingDepth: 50 });
  const attachments = email.attachments.map((a, i) => {
    const data = typeof a.content === 'string' ? Buffer.from(a.content, 'utf8') : Buffer.from(a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : a.content);
    return { name: (a.filename || `attachment-${i + 1}`).replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_').slice(0, 200), mime: a.mimeType || 'application/octet-stream', data };
  });
  const date = email.date ? new Date(email.date) : null;
  return {
    view: {
      subject: email.subject ?? '',
      from: flat(email.from)[0] ?? null,
      to: flat(email.to),
      cc: flat(email.cc),
      date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      html: email.html ?? '',
      text: email.text ?? '',
      messageId: email.messageId ?? null,
      attachments: attachments.map((a, index) => ({ index, name: a.name, mime: a.mime, size: a.data.length })),
    },
    attachments,
  };
}
