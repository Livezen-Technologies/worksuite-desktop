import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache, cacheKeyPath } from '../../../electron/services/offline-cache';
import { contract } from '../../../shared/ipc/contract';
import { INVOKE_CHANNELS } from '../../../shared/ipc/channels';

/**
 * worksuite-desktop#208: a folder's list from what this computer keeps — every
 * saved page of it, one row per message, newest first, 100 from an offset —
 * and #209: a message's body is kept once however its identity was sent.
 */
const res = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data }) });
const limits = { enabled: true, maxBytes: 512 * 1024 * 1024 };
const row = (id: number, day: number, box?: number) => ({ id, subject: `m${id}`, created_at: `2026-09-${String(day).padStart(2, '0')} 10:00:00`, ...(box ? { mailbox: { id: box }, folder_slug: 'inbox' } : {}) });

function cache() {
  const vault = new Vault(Vault.generateKey());
  return new OfflineCache(new Database(':memory:'), () => vault);
}

describe('a folder from this computer (#208)', () => {
  it('reads every saved page of the folder, newest first, one row per message, 100 from an offset', () => {
    const c = cache();
    // Page 1 and page 2 of mailbox 3's inbox, saved at different times, overlapping by one message.
    c.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=3&page=1&per_page=100', res({ messages: Array.from({ length: 100 }, (_, i) => row(300 - i, 30 - Math.floor(i / 10))) }), limits);
    c.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=3&page=2&per_page=100', res({ messages: Array.from({ length: 60 }, (_, i) => row(201 - i, 20 - Math.floor(i / 10))) }), limits);
    // Another mailbox, another folder and a search are not this list.
    c.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=4&page=1', res({ messages: [row(1, 30)] }), limits);
    c.put('u1', 'mail', '/api/mail/messages?folder=sent&mailbox=3&page=1', res({ messages: [row(2, 30)] }), limits);
    c.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=3&q=budget', res({ messages: [row(999, 30)] }), limits);

    const first = c.mailList('u1', { mailbox: '3', folder: 'inbox', limit: 100 });
    expect(first.total).toBe(159);
    expect(first.messages).toHaveLength(100);
    expect(first.messages[0]).toMatchObject({ id: 300, mailbox: { id: 3 } });
    const stamps = first.messages.map((m) => Date.parse(String(m.created_at)));
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
    expect(first.messages.some((m) => m.id === 999 || m.id === 1 || m.id === 2)).toBe(false);
    const rest = c.mailList('u1', { mailbox: '3', folder: 'inbox', limit: 100, offset: 100 });
    expect(rest.messages).toHaveLength(59);
  });

  it('builds All Accounts from every account’s saved pages and the role’s own', () => {
    const c = cache();
    c.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=3&page=1', res({ messages: [row(1, 10), row(2, 12)] }), limits);
    c.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=4&page=1', res({ messages: [row(1, 11)] }), limits);
    c.put('u1', 'mail', '/api/mail/views/all/inbox?page=1&per_page=100', res({ messages: [row(7, 15, 5)] }), limits);
    const all = c.mailList('u1', { mailbox: null, folder: 'inbox', role: 'inbox', limit: 100 });
    expect(all.messages.map((m) => `${(m.mailbox as { id: number }).id}:${String(m.id)}`)).toEqual(['5:7', '3:2', '4:1', '3:1']);
  });

  it('is a declared channel with bounded input', () => {
    expect(INVOKE_CHANNELS).toContain('offline:mailList');
    expect(contract['offline:mailList'].input.safeParse({ mailbox: '3', folder: 'inbox', limit: 100 }).success).toBe(true);
    expect(contract['offline:mailList'].input.safeParse({ mailbox: null, folder: 'inbox', role: 'inbox', limit: 100, offset: 200 }).success).toBe(true);
    expect(contract['offline:mailList'].input.safeParse({ mailbox: 'x', folder: 'inbox', limit: 100 }).success).toBe(false);
    expect(contract['offline:mailList'].input.safeParse({ mailbox: '3', folder: 'inbox', limit: 5000 }).success).toBe(false);
  });
});

describe('a message kept once, whatever identity was sent with it (#209)', () => {
  it('keys the body by mailbox, folder and UID only', () => {
    expect(cacheKeyPath('/api/mail/messages/9?folder=inbox&mailbox=3&message_id=%3Ca%40b%3E&uidvalidity=11&locate=1&peek=1')).toBe('/api/mail/messages/9?folder=inbox&mailbox=3');
    expect(cacheKeyPath('/api/mail/messages/9?mid_hash=abc&folder=inbox&mailbox=3')).toBe('/api/mail/messages/9?folder=inbox&mailbox=3');
  });
});
