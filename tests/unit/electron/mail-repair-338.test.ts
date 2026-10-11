import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache } from '../../../electron/services/offline-cache';
import { OfflineQueue } from '../../../electron/services/offline-queue';
import { backupPath, keptCounts, rebuildDatabase, rebuildIfAsked, repairMail, repairMarker } from '../../../electron/services/mail-repair';
import { contract } from '../../../shared/ipc/contract';
import { INVOKE_CHANNELS } from '../../../shared/ipc/channels';

/**
 * worksuite-desktop#338: Repair local mail data. Mail's copy on this computer is cleared and downloaded again, or
 * — the database failed its check — the database is rebuilt on restart; unsent mail in the outbox, drafts and the
 * settings are never lost either way.
 */
const res = (body: string) => ({ status: 200, contentType: 'application/json', body });
const limits = { enabled: true, maxBytes: 512 * 1024 * 1024 };
const vault = new Vault(Vault.generateKey());
const http = {} as never;

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-mail-repair-'));
  path = join(dir, 'worksuite.db');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A profile database with mail saved, two unsent messages, a draft, settings and another app's saved answers. */
function seed(): void {
  const db = new Database(path);
  const cache = new OfflineCache(db, () => vault);
  const queue = new OfflineQueue(db, () => vault, http, () => 'allowed');
  cache.put('u1', 'mail', '/api/mail/messages?folder=inbox&mailbox=3', res('{"data":{"messages":[]}}'), limits);
  cache.put('u1', 'mail', '/api/mail/messages/7?folder=inbox&mailbox=3', res('{"data":{"subject":"Hi"}}'), limits);
  cache.put('u1', 'mail', '/api/mail/mailboxes', res('{"data":{"mailboxes":[]}}'), limits);
  cache.put('u1', 'files', '/api/drive/files', res('{"data":[]}'), limits);
  cache.put('u2', 'mail', '/api/mail/mailboxes', res('{"data":{"mailboxes":[]}}'), limits);
  queue.enqueue('u1', { module: 'mail', entity: 'message.send', entityId: null, label: 'Send “Quarterly numbers”', method: 'POST', path: '/api/mail/send', body: { to: 'a@example.test', subject: 'Quarterly numbers' } } as never);
  queue.enqueue('u1', { module: 'mail', entity: 'message.send', entityId: null, label: 'Send “Contract”', method: 'POST', path: '/api/mail/send', body: { to: 'b@example.test', subject: 'Contract' } } as never);
  queue.saveDraft('u1', 'mail', 'compose:new', { subject: 'Half written', to: 'c@example.test' });
  db.setConfig('preferences', { mailCacheDays: 90, mailCacheDaysByMailbox: { '3': 30 } });
  db.close();
}

/** The outbox as it will be sent: in line, each message's label and body, decrypted. */
function outbox(db: Database): Array<{ label: string; body: unknown }> {
  const q = new OfflineQueue(db, () => vault, http, () => 'allowed');
  return q.list('u1').map((m) => ({ label: m.label, body: q.detail('u1', m.id)?.body ?? null }));
}

describe('Repair local mail data (#338)', () => {
  it('is an IPC channel with a typed answer, allowed once at a time', () => {
    expect(INVOKE_CHANNELS).toContain('offline:repairMail');
    expect(contract['offline:repairMail']).toBeDefined();
  });

  it('a healthy database: clears Mail’s copy for the person, keeps a backup, and never touches the outbox, drafts or settings', () => {
    seed();
    const db = new Database(path);
    const before = outbox(db);
    expect(before.map((m) => m.label)).toEqual(['Send “Quarterly numbers”', 'Send “Contract”']);
    const kick = vi.fn();
    const r = repairMail({ db, dbPath: path, userId: 'u1', afterClear: kick });
    expect(r).toMatchObject({ check: 'ok', healthy: true, action: 'cleared', removed: 3, kept: { outbox: 2, drafts: 1 }, backup: backupPath(path) });
    expect(existsSync(backupPath(path))).toBe(true);
    expect(kick).toHaveBeenCalledOnce();
    // Mail's saved answers for this person are gone; another app's, and another person's, are not.
    const rows = db.all<{ user_id: string; module: string }>('SELECT user_id, module FROM cached_records ORDER BY user_id, module');
    expect(rows).toEqual([
      { user_id: 'u1', module: 'files' },
      { user_id: 'u2', module: 'mail' },
    ]);
    // The outbox (decrypted, as it will be sent), the draft and the settings are as they were.
    expect(outbox(db)).toEqual(before);
    expect(new OfflineQueue(db, () => vault, http, () => 'allowed').getDraft('u1', 'mail', 'compose:new')?.content).toEqual({ subject: 'Half written', to: 'c@example.test' });
    expect(db.getConfig('preferences')).toEqual({ mailCacheDays: 90, mailCacheDaysByMailbox: { '3': 30 } });
    db.close();
  });

  it('a database that fails its check: asks for a rebuild on restart and changes nothing now', () => {
    seed();
    const db = new Database(path);
    const damaged = { integrityCheck: () => '*** in database main *** Page 12: btreeInitPage() returns error code 11', run: db.run.bind(db), get: db.get.bind(db) };
    const r = repairMail({ db: damaged, dbPath: path, userId: 'u1' });
    expect(r).toMatchObject({ healthy: false, action: 'restart', removed: 0, kept: { outbox: 2, drafts: 1 } });
    expect(existsSync(repairMarker(path))).toBe(true);
    expect(db.all('SELECT 1 FROM cached_records')).toHaveLength(5);
    db.close();
  });

  it('a check that throws is a failed check, never a crash', () => {
    const db = new Database(':memory:');
    const r = repairMail({ db: { integrityCheck: () => { throw new Error('database disk image is malformed'); }, run: db.run.bind(db), get: db.get.bind(db) }, dbPath: path, userId: 'u1' });
    expect(r).toMatchObject({ healthy: false, check: 'database disk image is malformed', action: 'restart' });
  });

  it('the rebuild on restart: the old file becomes .bak, and a fresh database holds the outbox, drafts and settings — not the saved answers', () => {
    seed();
    writeFileSync(repairMarker(path), '{}');
    const report = rebuildIfAsked(path);
    expect(report).not.toBeNull();
    expect(report!.lost).toEqual([]);
    expect(report!.kept).toMatchObject({ offline_mutations: 2, drafts: 1 });
    expect(existsSync(repairMarker(path))).toBe(false);
    expect(existsSync(backupPath(path))).toBe(true);

    const fresh = new Database(path);
    expect(fresh.all('SELECT 1 FROM cached_records')).toHaveLength(0);
    expect(outbox(fresh)).toEqual([
      { label: 'Send “Quarterly numbers”', body: { to: 'a@example.test', subject: 'Quarterly numbers' } },
      { label: 'Send “Contract”', body: { to: 'b@example.test', subject: 'Contract' } },
    ]);
    expect(keptCounts(fresh, 'u1')).toEqual({ outbox: 2, drafts: 1 });
    expect(new OfflineQueue(fresh, () => vault, http, () => 'allowed').getDraft('u1', 'mail', 'compose:new')?.content).toEqual({ subject: 'Half written', to: 'c@example.test' });
    expect(fresh.getConfig('preferences')).toEqual({ mailCacheDays: 90, mailCacheDaysByMailbox: { '3': 30 } });
    // The backup is the old database, whole: what was in it can still be read from it.
    const old = new Database(backupPath(path));
    expect(old.all('SELECT 1 FROM cached_records')).toHaveLength(5);
    old.close();
    fresh.close();
    // Asked once: the next start opens the database as it is.
    expect(rebuildIfAsked(path)).toBeNull();
  });

  it('a file that is no database at all: set aside, and the app starts on a fresh one', () => {
    writeFileSync(path, 'this is not a database '.repeat(400));
    const report = rebuildDatabase(path);
    expect(report.lost).toContain('*');
    expect(readFileSync(backupPath(path), 'utf8')).toContain('this is not a database');
    const fresh = new Database(path);
    expect(fresh.integrityCheck()).toBe('ok');
    fresh.close();
  });
});
