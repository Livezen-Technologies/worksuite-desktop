import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache, mailPathKind, mailboxOfPath } from '../../../electron/services/offline-cache';
import { contract, preferencesPatchSchema } from '../../../shared/ipc/contract';
import { findMailtoInArgv, mailBodiesKept, mailtoRoute, parseMailto } from '../../../shared/mailto';

/**
 * Settings › Mail on this computer (designs D04, D09): what Mail keeps, by
 * kind and by mailbox, a mailbox's own keep period, and mailto: links from
 * other apps opening a prefilled message — never sending one.
 */
describe('what Mail keeps on this computer', () => {
  const res = (body: string) => ({ status: 200, contentType: 'application/json', body });
  const limits = { enabled: true, maxBytes: 64 * 1024 * 1024 };

  it('sorts saved answers into messages, lists, search and the rest, and counts each mailbox’s messages', () => {
    const vault = new Vault(Vault.generateKey());
    const cache = new OfflineCache(new Database(':memory:'), () => vault);
    cache.put('u1', 'mail', '/api/mail/messages/41?folder=inbox&mailbox=3', res('a'.repeat(4000)), limits);
    cache.put('u1', 'mail', '/api/mail/messages/42?folder=inbox&mailbox=3', res('b'.repeat(4000)), limits);
    cache.put('u1', 'mail', '/api/mail/messages/42/context?folder=inbox&mailbox=3', res('c'.repeat(500)), limits);
    cache.put('u1', 'mail', '/api/mail/messages/7?folder=inbox&mailbox=33', res('d'.repeat(1000)), limits);
    cache.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=3&page=1', res('e'.repeat(2000)), limits);
    cache.put('u1', 'mail', '/api/mail/search?q=boq&scope=all', res('f'.repeat(800)), limits);
    cache.put('u2', 'mail', '/api/mail/messages/41?folder=inbox&mailbox=3', res('g'.repeat(9000)), limits);

    const s = cache.mailStats('u1');
    expect(s.total).toBe(s.messages + s.lists + s.search + s.other);
    expect(s.messages).toBeGreaterThan(s.lists);
    expect(s.search).toBeGreaterThan(0);
    // Two messages of mailbox 3 (the context answer is not a message); mailbox 33 is not mailbox 3.
    expect(s.byMailbox['3']!.messages).toBe(2);
    expect(s.byMailbox['33']!.messages).toBe(1);
    expect(cache.mailStats('nobody').total).toBe(0);
  });

  it('keeps one mailbox for its own period, and headers only means none of its messages', () => {
    const vault = new Vault(Vault.generateKey());
    const db = new Database(':memory:');
    const cache = new OfflineCache(db, () => vault);
    cache.put('u1', 'mail', '/api/mail/messages/41?folder=inbox&mailbox=3', res('a'), limits);
    cache.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=3', res('b'), limits);
    cache.put('u1', 'mail', '/api/mail/messages/9?folder=inbox&mailbox=4', res('c'), limits);
    expect(cache.pruneMailbox('u1', '3', 0)).toBe(1);
    expect(cache.get('u1', '/api/mail/messages?folder=inbox&mailbox=3')).not.toBeNull();
    expect(cache.get('u1', '/api/mail/messages/9?folder=inbox&mailbox=4')).not.toBeNull();
    db.run("UPDATE cached_records SET cached_at = '2020-01-01T00:00:00.000Z'");
    expect(cache.pruneMailbox('u1', '4', 7)).toBe(1);
    expect(cache.get('u1', '/api/mail/messages?folder=inbox&mailbox=3')).not.toBeNull();
  });

  it('reads a path’s kind and mailbox', () => {
    expect(mailPathKind('/api/mail/messages/12/context?folder=x')).toBe('messages');
    expect(mailPathKind('/api/mail/folders?mailbox=3')).toBe('lists');
    expect(mailPathKind('/api/mail/search?q=a')).toBe('search');
    expect(mailPathKind('/api/mail/templates')).toBe('other');
    expect(mailboxOfPath('/api/mail/messages?mailbox=12&folder=inbox')).toBe('12');
    expect(mailboxOfPath('/api/mail/messages?mailbox=../x')).toBeNull();
    expect(mailboxOfPath('/api/mail/views')).toBeNull();
  });

  it('keeps a body unless its mailbox, or Mail, keeps headers only', () => {
    const prefs = { mailCacheDays: 30, mailCacheDaysByMailbox: { '3': 0 as const } };
    expect(mailBodiesKept(prefs, '/api/mail/messages/1?mailbox=3')).toBe(false);
    expect(mailBodiesKept(prefs, '/api/mail/messages/1?mailbox=4')).toBe(true);
    expect(mailBodiesKept({ mailCacheDays: 0 }, '/api/mail/messages/1')).toBe(false);
    expect(mailBodiesKept({ mailCacheDays: 0, mailCacheDaysByMailbox: { '5': 30 } }, '/api/mail/messages/1?mailbox=5')).toBe(true);
  });

  it('declares the stats channel and accepts the new preferences only in their shapes', () => {
    expect(contract['offline:mailStats']).toBeDefined();
    expect(preferencesPatchSchema.safeParse({ mailtoHandler: true }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ mailCacheDaysByMailbox: { '3': 7 } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ mailCacheDaysByMailbox: { '3': 5 } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ mailCacheDaysByMailbox: { x: 7 } }).success).toBe(false);
  });
});

describe('mailto: links', () => {
  it('reads the addresses, subject and body, and nothing it should not', () => {
    const f = parseMailto('mailto:nimal@sfcl.lk,bad-address?cc=a@b.lk&bcc=c@d.lk&subject=Revised%20BOQ%0D%0Anext&body=Hello%20there%0D%0AThanks&attach=/etc/passwd');
    expect(f).toEqual({ to: ['nimal@sfcl.lk'], cc: ['a@b.lk'], bcc: ['c@d.lk'], subject: 'Revised BOQ next', body: 'Hello there\nThanks' });
    expect(parseMailto('https://example.com')).toBeNull();
    expect(parseMailto(`mailto:a@b.lk?body=${'x'.repeat(9000)}`)).toBeNull();
    expect(parseMailto('mailto:?subject=Hi')?.to).toEqual([]);
    // A plus is a plus, not a space.
    expect(parseMailto('mailto:a+tag@b.lk')?.to).toEqual(['a+tag@b.lk']);
  });

  it('becomes a Mail route that opens a new message, and is found among launch arguments', () => {
    const route = mailtoRoute({ to: ['a@b.lk'], cc: [], bcc: [], subject: 'Hi & bye', body: 'Line 1\nLine 2' });
    expect(route.startsWith('/mail?compose=1&')).toBe(true);
    const q = new URLSearchParams(route.split('?')[1]);
    expect(q.get('to')).toBe('a@b.lk');
    expect(q.get('subject')).toBe('Hi & bye');
    expect(q.get('body')).toBe('Line 1\nLine 2');
    expect(findMailtoInArgv(['/opt/WorkSuite', '--x', 'mailto:a@b.lk'])).toBe('mailto:a@b.lk');
    expect(findMailtoInArgv(['/opt/WorkSuite', 'worksuite://mail'])).toBeNull();
  });
});
