import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import PostalMime from 'postal-mime';
import { afterEach, describe, expect, it } from 'vitest';
import { MailFilesReader } from '../../../electron/services/mail-files/eml';
import { asctime, emlName, exportMail, mboxEntry, ZipWriter, type ExportHttp } from '../../../electron/services/mail-files/export';
import { MailFiles, kindOf, type ImportProgress, type WorkerChannel } from '../../../electron/services/mail-files/host';
import { MboxReader, mboxFlags, unwrapMbox } from '../../../electron/services/mail-files/mbox';
import { addressList, buildMime, encodeWord, keptHeaders, mailDate } from '../../../electron/services/mail-files/mime';
import { PstReader, isMailClass, isMailFolder } from '../../../electron/services/mail-files/pst';
import { createWorkerHandler, type WorkerRequest, type WorkerResponse } from '../../../electron/services/mail-files/worker-protocol';
import { checkLink, parseSafeLink, safeLinkHref, siteOf } from '../../../shared/mail-files';
import { closeSync, openSync } from 'node:fs';

/**
 * ENH-MAIL-03 P4 on this computer: data files read in the sandboxed worker —
 * .pst (DMO-DAT-01), .mbox and folders of .eml (DMO-DAT-02), one .eml/.msg to
 * read (DMO-DAT-04) — the import that streams them to the server with no
 * duplicates (AC-DMO-10), export to .mbox or a zip of .eml (DMO-DAT-03), and
 * the safe-link check (DMO-SEC-03).
 */

const ENRON = resolve(__dirname, '../../../node_modules/pst-extractor/example/testdata/enron.pst');
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'ws-mailfiles-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  dirs.length = 0;
});

const MBOX = [
  'From asha@livezen.lk Mon Oct 12 10:00:00 2026',
  'From: Asha <asha@livezen.lk>',
  'Subject: First',
  'Message-ID: <one@x>',
  'Status: RO',
  'X-Status: F',
  '',
  'Hello',
  '>From the start of a line',
  '',
  'From omar@livezen.lk Tue Oct 13 11:00:00 2026',
  'From: Omar <omar@livezen.lk>',
  'Subject: Second',
  'X-Mozilla-Status: 0008',
  '',
  'Deleted in Thunderbird',
  '',
  'From nimal@livezen.lk Wed Oct 14 12:00:00 2026',
  'From: Nimal <nimal@livezen.lk>',
  'Subject: Third',
  '',
  'Body',
  '',
].join('\n');

describe('messages built from a data file', () => {
  it('are the same bytes every time, with encoded headers and nothing injected', () => {
    const input = {
      headers: [
        ['Subject', 'ශ්‍රී ලංකා\r\nBcc: evil@x'],
        ['From', addressList([{ name: 'Asha Perera', email: 'asha@livezen.lk' }])],
        ['Date', mailDate(new Date(Date.UTC(2026, 9, 12, 4, 30)))],
      ] as Array<[string, string]>,
      text: 'Hi\nthere',
      html: '<p>Hi</p><img src="cid:logo">',
      attachments: [
        { name: 'logo.png', mime: 'image/png', data: Buffer.from('png'), contentId: 'logo' },
        { name: 'වාර්තාව.pdf', mime: 'application/pdf', data: Buffer.from('%PDF') },
      ],
    };
    const a = buildMime(input);
    expect(a.equals(buildMime(input))).toBe(true);
    const s = a.toString('utf8');
    expect(s).not.toMatch(/^Bcc:/m);
    expect(s).toContain('Subject: =?UTF-8?B?');
    expect(s).toContain('Date: Mon, 12 Oct 2026 04:30:00 +0000');
    expect(s).toMatch(/multipart\/mixed[\s\S]*multipart\/related[\s\S]*multipart\/alternative/);
    expect(s).toContain("filename*=UTF-8''");
    expect(encodeWord('plain')).toBe('plain');
    expect(addressList([{ name: 'Only a name', email: 'not an address' }])).toBe('');
  });

  it('keep a received message’s own headers but not its old body description', () => {
    const k = keptHeaders('Received: from a\r\n by b\r\nContent-Type: multipart/mixed;\r\n boundary="x"\r\nMIME-Version: 1.0\r\nMessage-ID: <m@x>\r\n\r\nbody');
    expect(k.lines).toEqual(['Received: from a\r\n by b', 'Message-ID: <m@x>']);
    expect([...k.names]).toEqual(['received', 'message-id']);
  });

  it('parse back to what they said', async () => {
    const raw = buildMime({ headers: [['Subject', 'Report'], ['From', 'asha@livezen.lk']], text: 'x', attachments: [{ name: 'a.txt', mime: 'text/plain', data: Buffer.from('hello') }] });
    const p = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
    expect(p.subject).toBe('Report');
    expect(p.attachments[0]!.filename).toBe('a.txt');
  });
});

describe('an Outlook data file (.pst)', () => {
  it('lists its mail folders, skips search folders, and turns each email into a real message', async () => {
    const r = new PstReader(ENRON);
    const { folders } = r.folders();
    const personal = folders.find((f) => f.path.endsWith('/Personal'))!;
    expect(personal).toMatchObject({ path: 'lokay-m/MLOKAY (Non-Privileged)/Personal', count: 47, mail: true });
    expect(folders.some((f) => /Search/.test(f.path))).toBe(false);

    const first = r.batch(personal.id, 0, 5, 64 * 1024 * 1024);
    expect(first.items).toHaveLength(5);
    expect(first.next).toBe(5);
    const msg = first.items.find((i) => i.raw)!;
    const parsed = await PostalMime.parse(msg.raw!);
    expect(parsed.subject).toBeTruthy();
    expect(parsed.messageId).toMatch(/^<.+>$/);
    expect(msg.date).toMatch(/^\d{4}-/);

    // The same item read again is the same bytes: a re-import is recognised (AC-DMO-10).
    const again = new PstReader(ENRON);
    const p2 = again.folders().folders.find((f) => f.path === personal.path)!;
    expect(again.batch(p2.id, 0, 5, 64 * 1024 * 1024).items.map((i) => i.raw?.toString('base64'))).toEqual(first.items.map((i) => i.raw?.toString('base64')));

    const rest = r.batch(personal.id, 45, 10, 64 * 1024 * 1024);
    expect(rest.items).toHaveLength(2);
    expect(rest.next).toBeNull();
    r.close();
    again.close();
  });

  it('knows mail from calendars and contacts', () => {
    expect(isMailFolder('IPF.Note')).toBe(true);
    expect(isMailFolder('')).toBe(true);
    expect(isMailFolder('IPF.Appointment')).toBe(false);
    expect(isMailFolder('IPF.Contact')).toBe(false);
    expect(isMailClass('IPM.Note.SMIME')).toBe(true);
    expect(isMailClass('IPM.Schedule.Meeting.Request')).toBe(true);
    expect(isMailClass('IPM.Appointment')).toBe(false);
  });
});

describe('an mbox file', () => {
  it('is split on From_ lines, unquoted, carries its flags and leaves deleted mail behind', () => {
    const d = tmp();
    const path = join(d, 'Archive.mbox');
    writeFileSync(path, MBOX);
    const r = new MboxReader(path);
    expect(r.folders().folders).toEqual([{ id: 1, path: 'Archive', count: 3, mail: true }]);
    const b = r.batch(1, 0, 10, 1e9);
    expect(b.next).toBeNull();
    expect(b.items.map((i) => i.subject)).toEqual(['First', 'Second', 'Third']);
    expect(b.items[0]!.flags.sort()).toEqual(['\\Flagged', '\\Seen']);
    expect(b.items[0]!.raw!.toString('latin1')).toContain('\r\nFrom the start of a line\r\n');
    expect(b.items[0]!.raw!.toString('latin1').startsWith('From: Asha')).toBe(true);
    expect(b.items[0]!.date).toBe('2026-10-12T10:00:00.000Z');
    expect(b.items[1]!.skip).toBe('Deleted in the mail app it came from.');
    expect(r.batch(1, 2, 10, 1e9).items.map((i) => i.subject)).toEqual(['Third']);
    r.close();
    expect(mboxFlags('X-Mozilla-Status: 0005').flags.sort()).toEqual(['\\Flagged', '\\Seen']);
    expect(unwrapMbox(Buffer.from('From x\n>>From y\n'))).toBe('>From y\r\n');
  });
});

describe('a folder of .eml files', () => {
  it('is a folder per directory, a message per file', () => {
    const d = tmp();
    mkdirSync(join(d, 'Clients', 'Acme'), { recursive: true });
    writeFileSync(join(d, 'a.eml'), 'Subject: Top\r\n\r\nx');
    writeFileSync(join(d, 'Clients', 'Acme', 'b.eml'), 'Subject: Deep\r\n\r\ny');
    writeFileSync(join(d, 'Clients', 'notes.txt'), 'not mail');
    const r = new MailFilesReader(d, 'eml');
    const f = r.folders().folders;
    expect(f.map((x) => [x.path, x.count])).toEqual([['Clients/Acme', 1], [d.split(/[\\/]/).pop(), 1]]);
    expect(r.batch(1, 0, 10, 1e9).items[0]!.subject).toBe('Deep');
    expect(kindOf(d, true)).toBe('eml');
    expect(kindOf('x.PST', false)).toBe('pst');
    expect(kindOf('x.docx', false)).toBeNull();
  });
});

describe('the data-file worker', () => {
  it('opens a message file to read and hands an attachment over only when asked', async () => {
    const d = tmp();
    const path = join(d, 'note.eml');
    writeFileSync(path, buildMime({ headers: [['Subject', 'Invoice'], ['From', 'Pat <pat@client.example>'], ['To', 'asha@livezen.lk']], html: '<p onclick="x()">Pay</p>', attachments: [{ name: 'inv.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4') }] }));
    const h = createWorkerHandler();
    const view = await h({ id: 1, op: 'view', path, kind: 'eml' });
    expect(view.ok).toBe(true);
    const v = (view as Extract<WorkerResponse, { ok: true }>).result as { subject: string; from: { email: string }; html: string; attachments: Array<{ name: string; size: number }> };
    expect(v.subject).toBe('Invoice');
    expect(v.from.email).toBe('pat@client.example');
    // Untouched here: the reader sanitises it like any received mail.
    expect(v.html).toContain('onclick');
    expect(v.attachments).toEqual([{ index: 0, name: 'inv.pdf', mime: 'application/pdf', size: 8 }]);
    const att = await h({ id: 2, op: 'attachment', index: 0 });
    expect(Buffer.from((att as { result: { data: Uint8Array } }).result.data).toString()).toBe('%PDF-1.4');
    expect((await h({ id: 3, op: 'attachment', index: 5 })).ok).toBe(false);
    expect((await h({ id: 4, op: 'batch', folderId: 1, offset: 0, limit: 1, maxBytes: 1 })).ok).toBe(false);
  });
});

/** A worker channel that answers in this process. */
function inProcess(): WorkerChannel {
  const handle = createWorkerHandler();
  let listener: ((m: WorkerResponse) => void) | null = null;
  return {
    post: (m: WorkerRequest) => void handle(m).then((r) => listener?.(r)),
    onMessage: (cb) => {
      listener = cb;
    },
    onExit: () => undefined,
    kill: () => undefined,
  };
}

describe('importing a data file', () => {
  it('streams every message to the server in batches and finishes, telling every window', async () => {
    const d = tmp();
    const path = join(d, 'Old.mbox');
    writeFileSync(path, MBOX);
    const posts: Array<{ path: string; body: { messages?: Array<{ raw: string }>; folder?: string; destination?: string; state?: string } }> = [];
    const progress: ImportProgress[] = [];
    const files = new MailFiles({
      http: { post: async <T,>(p: string, body?: unknown) => { posts.push({ path: p, body: body as never }); return { copied: (body as { messages?: unknown[] }).messages?.length ?? 0, skipped: 0, failed: 0 } as T; } },
      spawn: inProcess,
      broadcast: (p) => progress.push(p),
      audit: () => undefined,
      retryMs: 0,
    });
    const h = files.add(path)!;
    expect(h.kind).toBe('mbox');
    const scan = await files.scan(h.id);
    files.start(h.id, 9, [{ folder: scan.folders[0]!.id, source: 'Old', destination: 'Imported/Old' }]);
    await expect.poll(() => progress.at(-1)?.state).toBe('done');
    const stream = posts.filter((p) => p.path === '/api/mail/imports/datafile/9/stream');
    expect(stream).toHaveLength(1);
    expect(stream[0]!.body.messages).toHaveLength(2);
    expect(stream[0]!.body.destination).toBe('Imported/Old');
    expect(Buffer.from(stream[0]!.body.messages![0]!.raw, 'base64').toString()).toContain('Subject: First');
    expect(posts.at(-1)).toEqual({ path: '/api/mail/imports/datafile/9/finish', body: { state: 'done', unreadable: [] } });
    expect(progress.at(-1)).toMatchObject({ done: 3, total: 3, copied: 2, skipped: 1, failed: 0 });
  });

  it('pauses where it got to when the server cannot take more, and resumes from there', async () => {
    const d = tmp();
    const path = join(d, 'Old.mbox');
    writeFileSync(path, MBOX);
    let down = true;
    const sent: string[] = [];
    const progress: ImportProgress[] = [];
    const files = new MailFiles({
      http: {
        post: async <T,>(p: string, body?: unknown) => {
          if (p.endsWith('/stream')) {
            if (down) throw new Error('Offline');
            sent.push(...((body as { messages: Array<{ raw: string }> }).messages.map((m) => /Subject: (\w+)/.exec(Buffer.from(m.raw, 'base64').toString())![1]!)));
            return { copied: 2, skipped: 0, failed: 0 } as T;
          }
          return {} as T;
        },
      },
      spawn: inProcess,
      broadcast: (p) => progress.push(p),
      audit: () => undefined,
      retryMs: 0,
    });
    const h = files.add(path)!;
    const scan = await files.scan(h.id);
    files.start(h.id, 4, [{ folder: scan.folders[0]!.id, source: 'Old', destination: 'INBOX' }]);
    await expect.poll(() => progress.at(-1)?.state).toBe('paused');
    expect(progress.at(-1)!.error).toBe('Offline');
    down = false;
    files.start(h.id, 4, [{ folder: scan.folders[0]!.id, source: 'Old', destination: 'INBOX' }]);
    await expect.poll(() => progress.at(-1)?.state).toBe('done');
    expect(sent).toEqual(['First', 'Third']);
  });
});

describe('exporting a folder', () => {
  it('writes an mbox with From_ lines and quoted From lines, and a zip of .eml', async () => {
    expect(asctime(new Date(Date.UTC(2026, 9, 3, 7, 5, 9)))).toBe('Sat Oct  3 07:05:09 2026');
    expect(mboxEntry(Buffer.from('Return-Path: <a@x>\r\nDate: Mon, 12 Oct 2026 10:00:00 +0000\r\nSubject: s\r\n\r\nFrom here\r\n')).toString()).toBe('From a@x Mon Oct 12 10:00:00 2026\nReturn-Path: <a@x>\nDate: Mon, 12 Oct 2026 10:00:00 +0000\nSubject: s\n\n>From here\n\n');
    expect(emlName(7, 'Re: a/b?')).toBe('00007 Re_ a_b_.eml');

    const sources: Record<string, string> = { '1': 'Subject: One\r\n\r\nFrom x\r\n', '2': 'Subject: Two\r\n\r\ny\r\n' };
    const logged: unknown[] = [];
    const http: ExportHttp = {
      get: async <T,>(p: string) => (p.endsWith('/policy') ? { export: true } : { messages: [{ id: 1, subject: 'One' }, { id: 2, subject: 'Two' }], has_more: false }) as T,
      post: async <T,>(_p: string, body?: unknown) => { logged.push(body); return null as T; },
      source: async (uid) => Buffer.from(sources[uid]!),
    };
    const d = tmp();
    const mbox = join(d, 'out.mbox');
    const done: number[] = [];
    expect(await exportMail(http, { mailbox: '3', folder: 'inbox', folderName: 'Inbox', format: 'mbox' }, mbox, (n) => done.push(n), () => false)).toEqual({ count: 2, failed: 0, cancelled: false });
    expect(readFileSync(mbox, 'latin1')).toContain('\n>From x\n');
    expect(done).toEqual([1, 2]);
    expect(logged).toEqual([{ format: 'mbox', count: 2, folder: 'Inbox' }]);

    const zip = join(d, 'out.zip');
    await exportMail(http, { mailbox: '3', folder: 'inbox', folderName: 'Inbox', format: 'eml', items: [{ uid: '2', folder: 'inbox', mailbox: '3' }] }, zip, () => undefined, () => false);
    const bytes = readFileSync(zip);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(bytes.length - 22 + 10)).toBe(1);
    const nameLen = bytes.readUInt16LE(26);
    expect(bytes.subarray(30, 30 + nameLen).toString()).toBe('00001 Two.eml');
    const size = bytes.readUInt32LE(18);
    expect(inflateRawSync(bytes.subarray(30 + nameLen, 30 + nameLen + size)).toString()).toBe(sources['2']);
  });

  it('is refused when the organisation does not allow it', async () => {
    const http: ExportHttp = { get: async <T,>() => ({ export: false }) as T, post: async <T,>() => null as T, source: async () => Buffer.from('') };
    await expect(exportMail(http, { mailbox: null, folder: 'inbox', folderName: 'Inbox', format: 'mbox' }, join(tmp(), 'x.mbox'), () => undefined, () => false)).rejects.toThrow('does not allow');
  });

  it('a zip that would need zip64 stops with a way out', () => {
    const fd = openSync(join(tmp(), 'z.zip'), 'w');
    const z = new ZipWriter(fd);
    (z as unknown as { count: number }).count = 65_000;
    expect(() => z.add('x.eml', Buffer.from('x'))).toThrow(/mbox/);
    closeSync(fd);
  });
});

describe('safe links', () => {
  it('point at the app while shown and say where they lead when clicked', () => {
    const href = safeLinkHref('https://example.com/a?b=1', 'Example');
    expect(parseSafeLink(href)).toEqual({ url: 'https://example.com/a?b=1', text: 'Example' });
    expect(parseSafeLink('https://example.com')).toBeNull();
  });

  it('judge a link on its own signs, as the server does', () => {
    expect(checkLink('https://www.livezen.lk/x', 'livezen.lk').verdict).toBe('ok');
    expect(checkLink('https://login.bad.example', 'www.paypal.com')).toMatchObject({ verdict: 'danger', reasons: ['text_mismatch'] });
    expect(checkLink('https://paypal.com@bad.example').reasons).toContain('credentials');
    expect(checkLink('https://10.0.0.5/').reasons).toContain('ip_address');
    expect(checkLink('https://xn--pypal-4ve.com').reasons).toContain('lookalike');
    expect(checkLink('https://bit.ly/x').verdict).toBe('caution');
    expect(checkLink('http://intranet.livezen.lk').verdict).toBe('caution');
    expect(checkLink('javascript:alert(1)').verdict).toBe('danger');
    expect(checkLink('mailto:a@b.org').verdict).toBe('ok');
    expect(siteOf('shop.example.co.uk')).toBe('example.co.uk');
  });
});
