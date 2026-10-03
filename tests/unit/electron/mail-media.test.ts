import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {}, shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache, mailPathKind } from '../../../electron/services/offline-cache';
import { MailBodies } from '../../../electron/services/mail-bodies';
import { MailMedia, imageHash, messageOfBodyPath } from '../../../electron/services/mail-media';
import { DEFAULT_MAIL_MEDIA, attachmentKind, attachmentStorePath, attachmentStorePathOf, imageStorePath, mailMediaPrefs, shouldAutoDownload, storableImageType, type MailMediaPrefs } from '../../../shared/mail-media';
import { contract } from '../../../shared/ipc/contract';
import { TransferManager, queueConfig } from '../../../electron/services/transfers';
import { defaultDrivePrefs } from '../../../shared/transfers';

/**
 * Attachments downloaded ahead by size, kind and connection, and pictures and
 * attachments kept in the local mail store so they open at once next time,
 * also offline (worksuite-desktop#163).
 */

const MB = 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('which attachments are downloaded ahead (#163)', () => {
  const p = (patch: Partial<MailMediaPrefs> = {}) => ({ ...DEFAULT_MAIL_MEDIA, ...patch });
  const pdf = { name: 'Quote.pdf', mime: 'application/pdf', size: 2 * MB };

  it('by size: off, under 5 MB (the default), under 25 MB, all', () => {
    expect(mailMediaPrefs({}).autoDownload).toBe('5');
    expect(shouldAutoDownload(pdf, p({ autoDownload: 'off' }), { metered: false })).toBe(false);
    expect(shouldAutoDownload(pdf, p(), { metered: false })).toBe(true);
    expect(shouldAutoDownload({ ...pdf, size: 6 * MB }, p(), { metered: false })).toBe(false);
    expect(shouldAutoDownload({ ...pdf, size: 6 * MB }, p({ autoDownload: '25' }), { metered: false })).toBe(true);
    expect(shouldAutoDownload({ ...pdf, size: 30 * MB }, p({ autoDownload: '25' }), { metered: false })).toBe(false);
    expect(shouldAutoDownload({ ...pdf, size: 30 * MB }, p({ autoDownload: 'all' }), { metered: false })).toBe(true);
    expect(shouldAutoDownload({ ...pdf, size: 0 }, p(), { metered: false })).toBe(false);
  });

  it('by kind: images, PDFs, Office documents, or all', () => {
    const img = { name: 'photo.jpg', mime: 'image/jpeg', size: MB };
    const doc = { name: 'Plan.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: MB };
    const zip = { name: 'all.zip', mime: 'application/zip', size: MB };
    expect(attachmentKind(img.name, img.mime)).toBe('images');
    expect(attachmentKind(doc.name, doc.mime)).toBe('office');
    expect(attachmentKind('logo.svg', 'image/svg+xml')).toBe('other');
    expect(shouldAutoDownload(img, p({ types: ['pdf'] }), { metered: false })).toBe(false);
    expect(shouldAutoDownload(pdf, p({ types: ['pdf'] }), { metered: false })).toBe(true);
    expect(shouldAutoDownload(doc, p({ types: ['images', 'office'] }), { metered: false })).toBe(true);
    expect(shouldAutoDownload(zip, p({ types: ['images', 'pdf', 'office'] }), { metered: false })).toBe(false);
    expect(shouldAutoDownload(zip, p({ types: ['all'] }), { metered: false })).toBe(true);
  });

  it('by connection: not on a metered connection when asked, and never a blocked file', () => {
    expect(shouldAutoDownload(pdf, p({ network: 'unmetered' }), { metered: true })).toBe(false);
    expect(shouldAutoDownload(pdf, p({ network: 'unmetered' }), { metered: false })).toBe(true);
    expect(shouldAutoDownload(pdf, p({ network: 'any' }), { metered: true })).toBe(true);
    expect(shouldAutoDownload({ name: 'run.exe', mime: 'application/octet-stream', size: 1000 }, p(), { metered: false }, true)).toBe(false);
  });

  it('keeps an attachment under a key no page asks for, and finds it again from a download’s own address', () => {
    const key = attachmentStorePath({ uid: 12, ref: 'a1', folder: 'inbox', mailbox: '3' });
    expect(key).toBe('/api/mail/messages/12/attachments/a1?folder=inbox&mailbox=3&local=1');
    expect(attachmentStorePathOf('/api/mail/messages/12/attachments/a1?folder=inbox&dl=1&mailbox=3')).toBe(key);
    expect(attachmentStorePathOf('/api/files/9/download')).toBeNull();
    expect(mailPathKind(key)).toBe('messages');
    expect(messageOfBodyPath('/api/mail/messages/12?folder=inbox&mailbox=3')).toEqual({ uid: '12', folder: 'inbox', mailbox: '3' });
    expect(storableImageType('image/svg+xml')).toBeNull();
    expect(storableImageType('image/png; charset=binary')).toBe('image/png');
  });

  it('the settings channel accepts what the Images & media tab saves', () => {
    expect(contract['settings:set'].input.safeParse({ mailMedia: { autoDownload: '25', network: 'unmetered', types: ['images', 'pdf'], saveTo: 'files', filesFolder: { id: 4, name: 'Mail' } } }).success).toBe(true);
    expect(contract['settings:set'].input.safeParse({ mailMedia: { autoDownload: '100' } }).success).toBe(false);
    expect(contract['mail:images'].input.safeParse({ urls: ['https://cdn.example/a.png'], mailbox: '3', fetch: true }).success).toBe(true);
    expect(contract['mail:images'].input.safeParse({ urls: ['javascript:alert(1)'], mailbox: null, fetch: true }).success).toBe(false);
  });
});

function setup(prefs: { mailMedia?: Partial<MailMediaPrefs>; drive?: { meteredConnection?: boolean } } = {}, online = true) {
  const vault = new Vault(Vault.generateKey());
  const cache = new OfflineCache(new Database(':memory:'), () => vault);
  const fetched: string[] = [];
  const posted: Array<[string, unknown]> = [];
  const http = {
    url: (path: string) => new URL(path, 'https://ws.example.test').toString(),
    post: vi.fn(async (path: string, body: unknown) => {
      posted.push([path, body]);
      if (path === '/api/mail/image-links') return { enabled: true, links: Object.fromEntries((body as { urls: string[] }).urls.map((u, i) => [u, `/mail-image?t=${i}&s=x`])) };
      return {};
    }),
    raw: vi.fn(async (_m: string, url: string) => {
      const u = new URL(url);
      fetched.push(`${u.pathname}${u.search}`);
      if (u.pathname === '/mail-image') return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
      if (u.pathname.includes('/attachments/')) return new Response(Buffer.from('%PDF-1.7 hello'), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
      return new Response(JSON.stringify({ status: 'success', data: { id: 7, body_html: '<p>hi</p>', attachments: [{ ref: 'a0', name: 'Quote.pdf', mime: 'application/pdf', size: 2 * MB }, { ref: 'a1', name: 'Big.zip', mime: 'application/zip', size: 40 * MB }, { ref: 'a2', name: 'run.exe', mime: 'application/octet-stream', size: 1000 }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  };
  const media = new MailMedia({ http: http as never, cache, userId: () => 'u1', prefs: () => prefs, limits: () => ({ enabled: true, maxBytes: 256 * MB }), online: () => online });
  return { cache, http, fetched, posted, media };
}

describe('attachments downloaded with the bodies, and opened from the store (#163)', () => {
  const body = JSON.stringify({ status: 'success', data: { attachments: [{ ref: 'a0', name: 'Quote.pdf', mime: 'application/pdf', size: 2 * MB }, { ref: 'a1', name: 'Big.zip', mime: 'application/zip', size: 40 * MB }, { ref: 'a2', name: 'run.exe', mime: 'application/octet-stream', size: 1000 }] } });

  it('downloads what the settings want, keeps it encrypted, and opens it again without the network', async () => {
    const t = setup();
    expect(await t.media.afterBody('u1', '/api/mail/messages/7?folder=inbox&mailbox=3', body)).toBe(1);
    expect(t.fetched).toEqual(['/api/mail/messages/7/attachments/a0?folder=inbox&dl=1&mailbox=3']);
    const key = attachmentStorePathOf('/api/mail/messages/7/attachments/a0?folder=inbox&dl=1&mailbox=3')!;
    expect(t.media.localAttachment('u1', key)?.bytes.toString()).toBe('%PDF-1.7 hello');
    // Already kept: not fetched twice.
    await t.media.afterBody('u1', '/api/mail/messages/7?folder=inbox&mailbox=3', body);
    expect(t.fetched).toHaveLength(1);
    expect(await t.media.kept('u1', { uid: '7', folder: 'inbox', mailbox: '3', items: [{ ref: 'a0', name: 'Quote.pdf', mime: 'application/pdf', size: 2 * MB }, { ref: 'a1', name: 'Big.zip', mime: 'application/zip', size: 40 * MB }] }, false)).toEqual(['a0']);
  });

  it('downloads nothing from Junk, when turned off, or on a metered connection when told not to', async () => {
    const junk = setup();
    expect(await junk.media.afterBody('u1', '/api/mail/messages/7?folder=spam&mailbox=3', body)).toBe(0);
    const off = setup({ mailMedia: { autoDownload: 'off' } });
    expect(await off.media.afterBody('u1', '/api/mail/messages/7?folder=inbox&mailbox=3', body)).toBe(0);
    const metered = setup({ mailMedia: { network: 'unmetered' }, drive: { meteredConnection: true } });
    expect(await metered.media.afterBody('u1', '/api/mail/messages/7?folder=inbox&mailbox=3', body)).toBe(0);
    expect([...junk.fetched, ...off.fetched, ...metered.fetched]).toEqual([]);
  });

  it('also files it in WorkSuite Files when asked', async () => {
    const t = setup({ mailMedia: { saveTo: 'files', filesFolder: { id: 44, name: 'Mail attachments' } } });
    await t.media.afterBody('u1', '/api/mail/messages/7?folder=inbox&mailbox=3', body);
    expect(t.posted).toEqual([['/api/mail/messages/7/attachments/a0/save?folder=inbox&mailbox=3', { mailbox: '3', folder_id: 44 }]]);
  });

  it('runs inside the background body download (#190)', async () => {
    const t = setup();
    const http = {
      ...t.http,
      get: vi.fn(async (path: string) => (path === '/api/mail/mailboxes' ? { mailboxes: [{ id: 3 }] } : path === '/api/mail/messages' ? { messages: [{ id: 7, is_read: false, created_at: new Date().toISOString() }], has_more: false } : null)),
    };
    const bodies = new MailBodies({ http: http as never, cache: t.cache, userId: () => 'u1', prefs: () => ({ mailCacheDays: 30, mailFolderOffline: { '3:sent': 'online', '3:drafts': 'online' } }), limits: () => ({ enabled: true, maxBytes: 256 * MB }), online: () => true, pauseMs: 0, afterBody: (u, path, b) => t.media.afterBody(u, path, b) });
    (bodies as unknown as { stopped: boolean }).stopped = false;
    await bodies.pass();
    expect(t.fetched).toContain('/api/mail/messages/7/attachments/a0?folder=inbox&dl=1&mailbox=3');
    expect(t.cache.has('u1', attachmentStorePath({ uid: 7, ref: 'a0', folder: 'inbox', mailbox: '3' }))).toBe(true);
  });
});

describe('pictures kept in the local mail store (#163)', () => {
  it('fetches allowed pictures through the image proxy only, keeps them, and shows them offline next time', async () => {
    const t = setup();
    const r = await t.media.images('u1', ['https://cdn.example/a.png'], '3', true);
    expect(r.enabled).toBe(true);
    expect(r.images['https://cdn.example/a.png']).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(t.fetched).toEqual(['/mail-image?t=0&s=x']);
    expect(t.cache.has('u1', imageStorePath(imageHash('https://cdn.example/a.png'), '3'))).toBe(true);
    // Offline, nothing fetched: the kept copy.
    const off = await t.media.images('u1', ['https://cdn.example/a.png', 'https://cdn.example/b.png'], '3', false);
    expect(Object.keys(off.images)).toEqual(['https://cdn.example/a.png']);
    expect(t.fetched).toHaveLength(1);
  });

  it('loads nothing when the organisation turned the proxy off — never straight from the sender', async () => {
    const t = setup();
    t.http.post.mockResolvedValueOnce({ enabled: false, links: {} } as never);
    expect(await t.media.images('u1', ['https://cdn.example/a.png'], null, true)).toEqual({ enabled: false, images: {} });
    expect(t.fetched).toEqual([]);
  });

  it('keeps no SVG and nothing that is not a picture', async () => {
    const t = setup();
    t.http.raw.mockImplementation(async () => new Response('<svg/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } }));
    expect((await t.media.images('u1', ['https://cdn.example/a.svg'], null, true)).images).toEqual({});
  });
});

describe('a kept attachment opens from this computer, also offline (#163)', () => {
  it('is written from the store without asking the server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-mail-media-'));
    try {
      const t = setup();
      await t.media.afterBody('u1', '/api/mail/messages/7?folder=inbox&mailbox=3', JSON.stringify({ data: { attachments: [{ ref: 'a0', name: 'Quote.pdf', mime: 'application/pdf', size: 1000 }] } }));
      const asked: string[] = [];
      const transfers = new TransferManager({
        db: new Database(':memory:'),
        vault: () => new Vault(Vault.generateKey()),
        http: {
          url: (p: string) => `https://ws.example.test${p}`,
          raw: vi.fn(async (_m: string, url: string) => {
            asked.push(url);
            return new Response('server', { status: 200 });
          }),
        } as never,
        userId: () => 'u1',
        downloadFolder: () => join(dir, 'Downloads'),
        hash: async () => ({ sha256: 'abc', bytes: 0 }),
        canOpenFiles: () => true,
        audit: () => undefined,
        localCopy: (source) => {
          const key = attachmentStorePathOf(source);
          return key ? (t.media.localAttachment('u1', key)?.bytes ?? null) : null;
        },
        hasLocalCopy: (source) => {
          const key = attachmentStorePathOf(source);
          return !!key && t.cache.has('u1', key);
        },
      });
      transfers.configure(queueConfig(defaultDrivePrefs()));
      transfers.setOnline(false);
      const x = await transfers.download('/api/mail/messages/7/attachments/a0?folder=inbox&dl=1&mailbox=3', 'Quote.pdf', false, null);
      await vi.waitFor(() => expect(transfers.list().find((d) => d.id === x.id)?.state).toBe('done'));
      expect(readFileSync(join(dir, 'Downloads', 'Quote.pdf'), 'utf8')).toBe('%PDF-1.7 hello');
      expect(asked).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
