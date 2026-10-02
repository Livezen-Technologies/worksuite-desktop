import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache } from '../../../electron/services/offline-cache';
import { contract } from '../../../shared/ipc/contract';

/**
 * Mail on this computer: how much it keeps ("Local store 412 MB"), clearing
 * only Mail's saved answers, and downloading a message's original (.eml) and
 * attachments from a folder whose slug names a path (`label:Clients/Acme`).
 */
describe('mail kept offline', () => {
  it('measures and clears one app’s saved answers for one person', () => {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const cache = new OfflineCache(db, () => vault);
    const limits = { enabled: true, maxBytes: 64 * 1024 * 1024 };
    const res = (body: string) => ({ status: 200, contentType: 'application/json', body });
    cache.put('u1', 'mail', '/api/mail/messages?folder=inbox', res('x'.repeat(5000)), limits);
    cache.put('u1', 'mail', '/api/mail/views', res('y'.repeat(1000)), limits);
    cache.put('u1', 'tasks', '/api/tasks', res('z'.repeat(3000)), limits);
    cache.put('u2', 'mail', '/api/mail/views', res('w'.repeat(2000)), limits);
    const mine = cache.moduleBytes('u1', 'mail');
    expect(mine).toBeGreaterThan(6000);
    expect(mine).toBeLessThan(cache.totalBytes());
    expect(cache.moduleBytes('u1', 'nothing')).toBe(0);
    expect(cache.clearModule('u1', 'mail')).toBe(2);
    expect(cache.moduleBytes('u1', 'mail')).toBe(0);
    expect(cache.moduleBytes('u2', 'mail')).toBeGreaterThan(0);
    expect(cache.get('u1', '/api/tasks')).not.toBeNull();
  });

  it('takes only an app name for the size and the clear', () => {
    expect(contract['offline:moduleBytes'].input.safeParse({ module: 'mail' }).success).toBe(true);
    expect(contract['offline:moduleBytes'].input.safeParse({ module: '../x' }).success).toBe(false);
    expect(contract['offline:clearModule'].input.safeParse({ module: 'mail' }).success).toBe(true);
    expect(contract['offline:clearModule'].sensitive).toBe(true);
  });

  it('downloads a message’s original and attachments by parts, including from a custom folder', () => {
    const d = contract['transfers:download'].input;
    expect(d.safeParse({ mailSource: { uid: '41', folder: 'inbox', mailbox: '3' }, name: 'Revised BOQ.eml' }).success).toBe(true);
    expect(d.safeParse({ mail: { uid: '41', ref: '2', folder: 'label:Clients/Acme', mailbox: '3' }, name: 'BOQ.xlsx' }).success).toBe(true);
    // One thing at a time, and never a path the page makes up.
    expect(d.safeParse({ mailSource: { uid: '41', folder: 'inbox', mailbox: '3' }, mail: { uid: '41', ref: '2', folder: 'inbox', mailbox: null }, name: 'x' }).success).toBe(false);
    expect(d.safeParse({ mailSource: { uid: '../41', folder: 'inbox', mailbox: null }, name: 'x' }).success).toBe(false);
    expect(d.safeParse({ mailSource: { uid: '41', folder: 'inbox?x=1', mailbox: null }, name: 'x' }).success).toBe(false);
  });
});
