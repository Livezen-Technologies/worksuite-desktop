import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache, cacheKeyPath } from '../../../electron/services/offline-cache';
import { MailBodies, bodyFolders, bodyPath, stampMs, type BodyPrefs } from '../../../electron/services/mail-bodies';
import { contract } from '../../../shared/ipc/contract';

/**
 * "Download message bodies" (worksuite-desktop#190): with it on, Mail's
 * bodies within the keep period are fetched in the background into the
 * offline cache — unread Inbox first, then newest first, never marking
 * anything read — under the key an offline open of the message looks for.
 */

const NOW = Date.parse('2026-10-03T12:00:00Z');
const day = 86_400_000;
const stamp = (msAgo: number) => new Date(NOW - msAgo).toISOString().replace('T', ' ').slice(0, 19);

interface Row {
  id: number;
  is_read: boolean;
  created_at: string;
}

function server(folders: Record<string, Row[]>, opts: { mailboxes?: Array<{ id: number; archived?: boolean }> } = {}) {
  const fetched: string[] = [];
  const listed: string[] = [];
  const http = {
    url: (path: string, query?: Record<string, unknown>) => {
      const u = new URL(path, 'https://ws.example.test');
      for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, String(v));
      return u.toString();
    },
    get: vi.fn(async (path: string, o?: { query?: Record<string, string | number> }) => {
      if (path === '/api/mail/mailboxes') return { mailboxes: opts.mailboxes ?? [{ id: 3 }] };
      if (path === '/api/mail/messages') {
        const q = o!.query!;
        listed.push(`${q.mailbox}:${q.folder}:${q.page}`);
        const rows = folders[`${q.mailbox}:${q.folder}`] ?? [];
        const page = Number(q.page);
        const per = Number(q.per_page);
        return { messages: rows.slice((page - 1) * per, page * per), has_more: rows.length > page * per };
      }
      throw new Error(`unexpected ${path}`);
    }),
    raw: vi.fn(async (_method: string, url: string) => {
      const u = new URL(url);
      fetched.push(`${u.pathname}${u.search}`);
      return new Response(JSON.stringify({ status: 'success', data: { id: Number(u.pathname.split('/').pop()), body_html: '<p>hi</p>' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  };
  return { http, fetched, listed };
}

function setup(folders: Record<string, Row[]>, prefs: BodyPrefs = { mailCacheDays: 30 }, opts: { online?: () => boolean; mailboxes?: Array<{ id: number; archived?: boolean }> } = {}) {
  const vault = new Vault(Vault.generateKey());
  const cache = new OfflineCache(new Database(':memory:'), () => vault);
  const s = server(folders, opts);
  const bodies = new MailBodies({
    http: s.http as never,
    cache,
    userId: () => 'u1',
    prefs: () => prefs,
    limits: () => ({ enabled: true, maxBytes: 64 * 1024 * 1024 }),
    online: opts.online ?? (() => true),
    now: () => NOW,
    pauseMs: 0,
  });
  (bodies as unknown as { stopped: boolean }).stopped = false;
  return { ...s, cache, bodies };
}

describe('mail bodies downloaded for reading offline', () => {
  it('fetches every body in the keep period, unread Inbox first then newest, with peek so nothing is marked read', async () => {
    const t = setup({
      '3:inbox': [
        { id: 30, is_read: true, created_at: stamp(1 * 3600_000) },
        { id: 29, is_read: false, created_at: stamp(5 * day) },
        { id: 28, is_read: true, created_at: stamp(40 * day) },
      ],
      '3:sent': [{ id: 7, is_read: true, created_at: stamp(2 * 3600_000) }],
      '3:drafts': [],
    });
    await t.bodies.pass();

    expect(t.fetched).toEqual([
      '/api/mail/messages/29?folder=inbox&mailbox=3&peek=1',
      '/api/mail/messages/30?folder=inbox&mailbox=3&peek=1',
      '/api/mail/messages/7?folder=sent&mailbox=3&peek=1',
    ]);
    // Older than 30 days: not wanted.
    expect(t.fetched.some((f) => f.includes('/28?'))).toBe(false);
    expect(t.bodies.progress()['3']).toMatchObject({ stored: 3, wanted: 3, running: false, error: null });

    // An offline open — with or without peek, parameters in its own order — finds it.
    expect(t.cache.get('u1', '/api/mail/messages/29?folder=inbox&peek=1&mailbox=3')?.body).toContain('hi');
    expect(t.cache.get('u1', '/api/mail/messages/30?folder=inbox&mailbox=3')?.body).toContain('hi');
    // And the local store grows.
    expect(t.cache.mailStats('u1').byMailbox['3']!.messages).toBe(3);
  });

  it('downloads only what it does not have, and lists folders again only now and then', async () => {
    const t = setup({ '3:inbox': [{ id: 5, is_read: true, created_at: stamp(day) }] });
    await t.bodies.pass();
    const lists = t.listed.length;
    await t.bodies.pass();
    expect(t.fetched).toHaveLength(1);
    expect(t.listed).toHaveLength(lists);
    // A changed setting lists again.
    t.bodies.kick(0, true);
    await t.bodies.pass();
    expect(t.listed.length).toBeGreaterThan(lists);
    t.bodies.stop();
  });

  it('keeps nothing for a mailbox or folder kept as headers only', async () => {
    const rows = { '3:inbox': [{ id: 1, is_read: false, created_at: stamp(day) }], '4:inbox': [{ id: 2, is_read: false, created_at: stamp(day) }], '4:sent': [{ id: 3, is_read: true, created_at: stamp(day) }] };
    const t = setup(rows, { mailCacheDays: 30, mailCacheDaysByMailbox: { '3': 0 }, mailFolderOffline: { '4:sent': 'headers' } }, { mailboxes: [{ id: 3 }, { id: 4 }, { id: 5, archived: true }] });
    await t.bodies.pass();
    expect(t.fetched).toEqual(['/api/mail/messages/2?folder=inbox&mailbox=4&peek=1']);
    expect(t.bodies.progress()['3']).toMatchObject({ stored: 0, wanted: 0 });
    expect(t.bodies.progress()['5']).toBeUndefined();
  });

  it('stops when the server goes out of reach, and carries on next time', async () => {
    let online = true;
    const t = setup({ '3:inbox': Array.from({ length: 6 }, (_, i) => ({ id: 100 - i, is_read: true, created_at: stamp(i * 3600_000) })) }, { mailCacheDays: 7 }, { online: () => online });
    t.http.raw.mockImplementation(async (_m: string, url: string) => {
      const u = new URL(url);
      t.fetched.push(`${u.pathname}${u.search}`);
      if (t.fetched.length === 2) online = false;
      return new Response('{"data":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    await t.bodies.pass();
    expect(t.fetched.length).toBeLessThan(6);
    online = true;
    await t.bodies.pass();
    expect(t.bodies.progress()['3']).toMatchObject({ stored: 6, wanted: 6 });
  });

  it('keeps one body under one key, however it was asked for', () => {
    expect(cacheKeyPath('/api/mail/messages/9?folder=inbox&peek=1&mailbox=3')).toBe('/api/mail/messages/9?folder=inbox&mailbox=3');
    expect(cacheKeyPath('/api/mail/messages/9?mailbox=3&folder=inbox')).toBe('/api/mail/messages/9?folder=inbox&mailbox=3');
    // Anything else is its own answer.
    expect(cacheKeyPath('/api/mail/messages?folder=inbox&peek=1')).toBe('/api/mail/messages?folder=inbox&peek=1');
    expect(cacheKeyPath('/api/mail/messages/9/thread?folder=inbox&peek=1')).toBe('/api/mail/messages/9/thread?folder=inbox&peek=1');
    expect(bodyPath('3', 'label:Clients/Acme', 9)).toBe('/api/mail/messages/9?folder=label%3AClients%2FAcme&mailbox=3');
  });

  it('reads the server’s UTC times, and takes a mailbox’s own “recent” folders', () => {
    expect(stampMs('2026-10-03 18:40:00')).toBe(Date.parse('2026-10-03T18:40:00Z'));
    expect(stampMs('2026-10-03T18:40:00+05:30')).toBe(Date.parse('2026-10-03T13:10:00Z'));
    expect(Number.isNaN(stampMs(undefined))).toBe(true);
    expect(bodyFolders({ mailCacheDays: 30, mailFolderOffline: { '3:drafts': 'online', '3:label:Clients': 'recent', '4:archive': 'recent' } }, '3').sort()).toEqual(['inbox', 'label:Clients', 'sent']);
  });

  it('reports the downloads with what Mail keeps (offline:mailStats)', () => {
    expect(contract['offline:mailStats']).toBeDefined();
  });
});

describe('giving way to what a person opens (worksuite-desktop#228)', () => {
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('asks in the background, says who the message is, and never asks for a row without a server ID', async () => {
    const t = setup({
      '3:inbox': [
        { id: 30, is_read: false, created_at: stamp(3600_000), uidvalidity: 1700000000, message_id: '<a30@x>' } as Row,
        { id: 0, is_read: false, created_at: stamp(3600_000) },
      ],
    });
    await t.bodies.pass();
    expect(t.fetched).toEqual(['/api/mail/messages/30?folder=inbox&mailbox=3&message_id=%3Ca30%40x%3E&uidvalidity=1700000000&peek=1']);
    expect((t.http.raw.mock.calls[0] as unknown[])[2]).toMatchObject({ headers: { 'X-Mail-Priority': 'background' } });
    // Kept under the reader's own key, without who-it-is.
    expect(t.cache.has('u1', bodyPath('3', 'inbox', 30))).toBe(true);
  });

  it('a body the server was too busy for waits 30 seconds before it is asked for again', async () => {
    const t = setup({ '3:inbox': [{ id: 30, is_read: false, created_at: stamp(3600_000) }, { id: 31, is_read: false, created_at: stamp(7200_000) }] });
    t.http.raw.mockImplementation(async (_m: string, url: string) => {
      const u = new URL(url);
      t.fetched.push(`${u.pathname}${u.search}`);
      return u.pathname.endsWith('/30')
        ? answer(503, { status: 'error', message: 'Waiting for a free connection.', errors: { code: 'mail_busy', reason: 'busy' } })
        : answer(200, { status: 'success', data: { id: 31, body_html: '<p>hi</p>' } });
    });
    await t.bodies.pass();
    expect(t.fetched.map((f) => f.split('?')[0])).toEqual(['/api/mail/messages/30', '/api/mail/messages/31']);
    t.fetched.length = 0;
    (t.bodies as unknown as { listed: Map<string, unknown> }).listed.clear();
    await t.bodies.pass();
    expect(t.fetched).toEqual([]);
  });

  it('while the account builds its first headers, the download stops and waits', async () => {
    const t = setup({ '3:inbox': [{ id: 30, is_read: false, created_at: stamp(3600_000) }, { id: 31, is_read: false, created_at: stamp(7200_000) }] });
    t.http.raw.mockImplementation(async (_m: string, url: string) => {
      t.fetched.push(new URL(url).pathname);
      return answer(503, { status: 'error', message: 'Fetching ahead waits until this mailbox has its headers.', errors: { code: 'mail_busy', reason: 'syncing' } });
    });
    await t.bodies.pass();
    // Stopped at the first answer (the second worker may have asked once too), then nothing until the pause ends.
    expect(t.fetched.length).toBeLessThanOrEqual(2);
    t.fetched.length = 0;
    await t.bodies.pass();
    expect(t.fetched).toEqual([]);
    expect(t.bodies.progress()['3']!.running).toBe(false);
  });
});
