import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache } from '../../../electron/services/offline-cache';
import { contract, preferencesPatchSchema } from '../../../shared/ipc/contract';
import { INVOKE_CHANNELS } from '../../../shared/ipc/channels';
import { folderOffline, mailBodiesKept, mailKeptForever } from '../../../shared/mailto';

/**
 * worksuite-desktop#162: Mail's store on this computer — encrypted, per
 * person, read first by the page, a folder kept whole, and a removed
 * mailbox's mail taken off the computer with it.
 */
const res = (body: string) => ({ status: 200, contentType: 'application/json', body });
const limits = { enabled: true, maxBytes: 512 * 1024 * 1024 };

describe('Mail on this computer (#162)', () => {
  it('is encrypted at rest and kept apart per person', () => {
    const db = new Database(':memory:');
    const cache = new OfflineCache(db, () => new Vault(Vault.generateKey()));
    const vault = new Vault(Vault.generateKey());
    const mine = new OfflineCache(db, () => vault);
    mine.put('u1', 'mail', '/api/mail/messages/1?folder=inbox&mailbox=3', res('{"data":{"subject":"Quarterly numbers"}}'), limits);
    const raw = db.all<{ payload: string }>('SELECT payload FROM cached_records');
    expect(raw).toHaveLength(1);
    expect(raw[0]!.payload.startsWith('v1:')).toBe(true);
    expect(raw[0]!.payload).not.toContain('Quarterly');
    expect(mine.get('u2', '/api/mail/messages/1?folder=inbox&mailbox=3')).toBeNull();
    // Another key (another profile's vault) cannot read it, and drops it.
    expect(cache.get('u1', '/api/mail/messages/1?folder=inbox&mailbox=3')).toBeNull();
  });

  it('takes a removed mailbox’s mail off this computer, and only that mailbox’s', () => {
    const vault = new Vault(Vault.generateKey());
    const cache = new OfflineCache(new Database(':memory:'), () => vault);
    cache.put('u1', 'mail', '/api/mail/messages/1?folder=inbox&mailbox=3', res('a'), limits);
    cache.put('u1', 'mail', '/api/mail/folders?mailbox=3', res('b'), limits);
    cache.put('u1', 'mail', '/api/mail/folders?mailbox=33', res('c'), limits);
    cache.put('u2', 'mail', '/api/mail/folders?mailbox=3', res('d'), limits);
    cache.put('u1', 'tasks', '/api/tasks?mailbox=3', res('e'), limits);
    expect(cache.clearMailbox('u1', '3')).toBe(2);
    expect(cache.get('u1', '/api/mail/folders?mailbox=33')).not.toBeNull();
    expect(cache.get('u2', '/api/mail/folders?mailbox=3')).not.toBeNull();
    expect(cache.get('u1', '/api/tasks?mailbox=3')).not.toBeNull();
    expect(cache.clearUser('u1')).toBe(2);
  });

  it('keeps a folder kept whole past the keep period, and prunes the rest', () => {
    const vault = new Vault(Vault.generateKey());
    const db = new Database(':memory:');
    const cache = new OfflineCache(db, () => vault);
    const prefs = { mailCacheDays: 30 as const, mailFolderOffline: { '3:label:Contracts': 'all' as const } };
    cache.put('u1', 'mail', '/api/mail/messages/1?folder=label%3AContracts&mailbox=3', res('a'), limits);
    cache.put('u1', 'mail', '/api/mail/messages/2?folder=inbox&mailbox=3', res('b'), limits);
    db.run("UPDATE cached_records SET cached_at = '2020-01-01T00:00:00.000Z'");
    const keep = (path: string) => mailKeptForever(prefs, path);
    expect(cache.pruneModuleOlderThan('mail', 30, keep)).toBe(1);
    expect(cache.get('u1', '/api/mail/messages/1?folder=label%3AContracts&mailbox=3')).not.toBeNull();
    expect(cache.pruneMailbox('u1', '3', 0, keep)).toBe(0);
    expect(cache.pruneModuleOlderThan('mail', 30)).toBe(1);
  });

  it('offers All messages as a folder’s offline choice, which keeps bodies even in a headers-only mailbox', () => {
    const prefs = { mailCacheDays: 0 as const, mailFolderOffline: { '3:label:Contracts': 'all' as const } };
    expect(folderOffline(prefs, '3', 'label:Contracts')).toBe('all');
    expect(mailBodiesKept(prefs, '/api/mail/messages/1?folder=label%3AContracts&mailbox=3')).toBe(true);
    expect(mailBodiesKept(prefs, '/api/mail/messages/1?folder=inbox&mailbox=3')).toBe(false);
    expect(mailKeptForever(prefs, '/api/mail/messages?folder=label%3AContracts&mailbox=3')).toBe(false);
    expect(preferencesPatchSchema.safeParse({ mailFolderOffline: { '3:label:Contracts': 'all' } }).success).toBe(true);
  });

  it('reads saved answers by Mail path only, a few at a time; clears a mailbox by its id', () => {
    const peek = contract['offline:peek'].input;
    expect(peek.safeParse({ paths: ['/api/mail/folders?mailbox=4', '/api/mail/messages/9?folder=inbox&peek=1&mailbox=4'] }).success).toBe(true);
    expect(peek.safeParse({ paths: ['/api/tasks'] }).success).toBe(false);
    expect(peek.safeParse({ paths: [] }).success).toBe(false);
    expect(peek.safeParse({ paths: Array.from({ length: 13 }, () => '/api/mail/views') }).success).toBe(false);
    expect(contract['offline:clearMailbox'].input.safeParse({ mailbox: '12' }).success).toBe(true);
    expect(contract['offline:clearMailbox'].input.safeParse({ mailbox: '../x' }).success).toBe(false);
    expect(INVOKE_CHANNELS).toEqual(expect.arrayContaining(['offline:peek', 'offline:clearMailbox']));
  });

  it('searches the lists and opened messages kept here, offline, one row per message', () => {
    const vault = new Vault(Vault.generateKey());
    const cache = new OfflineCache(new Database(':memory:'), () => vault);
    const list = { messages: [{ id: 1, from_name: 'Nimal', from_email: 'nimal@x.test', subject: 'Budget review', preview: 'numbers', created_at: '2026-10-01 09:00:00' }, { id: 2, from_name: 'Kasun', from_email: 'k@x.test', subject: 'Lunch', preview: '', created_at: '2026-10-01 10:00:00' }] };
    cache.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=3&page=1', res(JSON.stringify({ status: 'success', data: list })), limits);
    cache.put('u1', 'mail', '/api/mail/messages/1?folder=inbox&mailbox=3', res(JSON.stringify({ status: 'success', data: { id: 1, from_name: 'Nimal', from_email: 'nimal@x.test', subject: 'Budget review', body_html: '<p>The <b>BOQ</b> for Colombo</p>', created_at: '2026-10-01 09:00:00' } })), limits);
    cache.put('u1', 'mail', '/api/mail/messages/7?folder=label%3AClients&mailbox=3', res(JSON.stringify({ status: 'success', data: { id: 7, from_name: 'Acme', from_email: 'a@acme.test', subject: 'Contract', body_html: '<style>.boq{}</style><p>Signed BOQ attached</p>', attachments: [{}], created_at: '2026-09-01 09:00:00' } })), limits);
    cache.put('u2', 'mail', '/api/mail/messages/9?folder=inbox&mailbox=8', res(JSON.stringify({ status: 'success', data: { id: 9, subject: 'BOQ for someone else' } })), limits);
    expect(cache.mailSearch('u1', 'budget').map((r) => r.id)).toEqual([1]);
    const boq = cache.mailSearch('u1', 'boq');
    expect(boq.map((r) => `${String(r.folder_slug)}:${String(r.id)}`).sort()).toEqual(['inbox:1', 'label:Clients:7']);
    expect(boq.find((r) => r.id === 7)).toMatchObject({ mailbox: { id: 3 }, has_attachment: true, preview: 'Signed BOQ attached' });
    expect(cache.mailSearch('u1', 'boq colombo').map((r) => r.id)).toEqual([1]);
    expect(cache.mailSearch('u1', '   ')).toEqual([]);
    expect(contract['offline:mailSearch'].input.safeParse({ q: '' }).success).toBe(false);
  });

  it('answers a read from a large store at once (synthetic: 2,000 saved answers)', { timeout: 60_000 }, () => {
    const vault = new Vault(Vault.generateKey());
    const cache = new OfflineCache(new Database(':memory:'), () => vault);
    const body = res(JSON.stringify({ data: { subject: 'x'.repeat(200), body_html: '<p>' + 'y'.repeat(2000) + '</p>' } }));
    for (let i = 0; i < 2000; i++) cache.put('u1', 'mail', `/api/mail/messages/${i}?folder=inbox&mailbox=${i % 5}`, body, limits);
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) expect(cache.get('u1', `/api/mail/messages/${(i * 7) % 2000}?folder=inbox&mailbox=${((i * 7) % 2000) % 5}`)).not.toBeNull();
    const perRead = (performance.now() - t0) / 500;
    // A keyed read is an index lookup and one decryption: well under a frame. Generous for a loaded CI machine.
    expect(perRead).toBeLessThan(5);
  });
});
