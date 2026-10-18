import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.2.262', isPackaged: false } }));

import { copyHasUnsentEdits, type OfficeLocalCopy } from '@shared/office';
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { pendingCopies, pendingCount, unsyncedSummary } from '../../../electron/services/accounts/unsynced';
import { GONE_MESSAGE, OfficeExternal } from '../../../electron/services/office-external';

/*
 * "You have 4 unsynced changes" while the status bar said "0 pending changes", and Sync Now did nothing: copies of
 * Drive files edited in other apps were listed at sign-out but counted nowhere else and retried by nothing; failed
 * downloads were listed as if they held edits; two rows for one file were two changes.
 */

function copy(o: Partial<OfficeLocalCopy & { path: string | null }> = {}) {
  return { id: 'c1', fileId: 1, name: 'diulaptiya_tender.pdf', folderId: null, baseVersion: 3, app: 'default', state: 'changed', syncOwned: false, error: null, conflict: null, changedAt: '2026-10-05T07:39:00.000Z', updatedAt: '2026-10-05T07:39:00.000Z', path: null, sha256: null, size: 0, mtimeMs: 0, misses: 0, ...o } as OfficeLocalCopy & { path: string | null; sha256: null; size: number; mtimeMs: number; misses: number };
}

describe('what counts as a change waiting (one rule)', () => {
  it('a failed download, a synced copy and a missing copy hold nothing to send', () => {
    expect(copyHasUnsentEdits(copy({ state: 'failed', changedAt: null }))).toBe(false);
    expect(copyHasUnsentEdits(copy({ state: 'open', syncOwned: true }))).toBe(false);
    expect(copyHasUnsentEdits(copy({ state: 'missing', changedAt: null }))).toBe(false);
    expect(copyHasUnsentEdits(copy({ state: 'changed' }))).toBe(true);
    expect(copyHasUnsentEdits(copy({ state: 'quota' }))).toBe(true);
  });

  it('two rows for one file are one change, the newer', () => {
    const rows = pendingCopies([copy({ id: 'a', updatedAt: '2026-10-05T07:00:00Z' }), copy({ id: 'b', updatedAt: '2026-10-05T08:00:00Z' }), copy({ id: 'c', fileId: 2, state: 'failed', changedAt: null })]);
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });

  it('the summary lists copies once, with why they failed, and the count matches', () => {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const copies = [
      copy({ id: 'a', fileId: 1, error: GONE_MESSAGE }),
      copy({ id: 'a2', fileId: 1, updatedAt: '2026-10-01T00:00:00Z' }),
      copy({ id: 'b', fileId: 2, name: 'WorkSuite_for_Councils_Proposal (1).pdf', state: 'failed', changedAt: null }),
    ];
    db.setConfig('office_local_copies:7', vault.encrypt(copies));
    db.run("INSERT INTO transfers (id, user_id, direction, name, meta, state, error, created_at, updated_at) VALUES ('t1', '7', 'upload', 'Report.pdf', 'm', 'failed', 'The server answered 500.', 'now', 'now')");
    const summary = unsyncedSummary({ db, vault, accountId: 'acc', userId: '7' });
    expect(summary.items.map((i) => [i.id, i.error])).toEqual([
      ['office:a', GONE_MESSAGE],
      ['upload:t1', 'The server answered 500.'],
    ]);
    expect(summary.items.every((i) => i.discardable)).toBe(true);
    // The status bar reads the same list (itemsOnly), from memory when given.
    const live = unsyncedSummary({ db, vault, accountId: 'acc', userId: '7', officeCopies: () => copies, itemsOnly: true });
    expect(pendingCount(live)).toBe(pendingCount(summary));
    expect(pendingCount(live)).toBe(2);
  });
});

describe('local copies: tidy on start, Sync Now, discard', () => {
  let dir: string;
  let db: Database;
  let vault: Vault;
  let xs: OfficeExternal[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ws-unsynced-'));
    db = new Database(join(dir, 'db.sqlite'));
    vault = new Vault(Vault.generateKey());
    xs = [];
  });
  afterEach(() => {
    xs.forEach((x) => x.stop());
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function make(answer: () => Response = () => new Response(JSON.stringify({ data: { current: { version: 4 } } }), { status: 201 })) {
    const posts: string[] = [];
    const x = new OfficeExternal({
      db,
      vault: () => vault,
      http: { url: (p: string) => `https://ws.example${p}`, raw: async (_m: string, url: string) => (posts.push(url), answer()) } as never,
      userId: () => '7',
      platform: 'linux',
      home: dir,
      canOpenFiles: () => true,
      syncedPath: () => null,
      download: async () => undefined,
      uploadNew: async () => undefined,
      openPath: async () => '',
      audit: () => undefined,
      onChanged: () => undefined,
      pollMs: 60_000,
    });
    xs.push(x);
    return { x, posts };
  }

  it('lets go of failed downloads and duplicate rows, keeps the edited one, and never touches a file', () => {
    const edited = join(dir, 'diulaptiya_tender.pdf');
    writeFileSync(edited, 'edited');
    db.setConfig(
      'office_local_copies:7',
      vault.encrypt([
        copy({ id: 'old', fileId: 1, state: 'open', changedAt: null, path: edited, updatedAt: '2026-10-06T00:00:00Z' }),
        copy({ id: 'edit', fileId: 1, state: 'changed', path: edited, updatedAt: '2026-10-05T00:00:00Z' }),
        copy({ id: 'dl1', fileId: 2, state: 'failed', changedAt: null, name: 'WorkSuite_for_Councils_Proposal (1).pdf' }),
        copy({ id: 'gone', fileId: 3, state: 'changed', path: join(dir, 'nope.pdf') }),
      ]),
    );
    const { x } = make();
    const list = x.list();
    expect(list.map((c) => c.id)).toEqual(['edit', 'gone']);
    expect(list.find((c) => c.id === 'gone')!.error).toBe(GONE_MESSAGE);
    expect(existsSync(edited)).toBe(true);
    // Saved: the next read (another start) finds the tidy list.
    const again = make().x;
    expect(again.list().map((c) => c.id)).toEqual(['edit', 'gone']);
  });

  it('Sync Now sends each edited copy and reports, per copy, the one that cannot go', async () => {
    const edited = join(dir, 'a.pdf');
    writeFileSync(edited, 'edited');
    db.setConfig('office_local_copies:7', vault.encrypt([copy({ id: 'a', fileId: 1, path: edited }), copy({ id: 'b', fileId: 2, name: 'b.pdf', path: join(dir, 'b.pdf') })]));
    const { x, posts } = make();
    const r = await x.syncPending();
    expect(r.sent).toBe(1);
    expect(r.errors).toEqual([{ id: 'b', name: 'b.pdf', error: GONE_MESSAGE }]);
    expect(posts).toEqual(['https://ws.example/api/files/1/versions']);
    const summary = unsyncedSummary({ db, vault, accountId: 'acc', userId: '7', officeCopies: () => x.list() });
    expect(summary.items.map((i) => [i.label, i.error])).toEqual([['b.pdf', GONE_MESSAGE]]);
    // Discard this change: the row goes, nothing on disk changes.
    expect(x.forget('b')).toBe(true);
    expect(unsyncedSummary({ db, vault, accountId: 'acc', userId: '7', officeCopies: () => x.list() }).items).toEqual([]);
    expect(existsSync(edited)).toBe(true);
  });

  it('a server refusal stays on the copy as its reason', async () => {
    const edited = join(dir, 'a.pdf');
    writeFileSync(edited, 'edited');
    db.setConfig('office_local_copies:7', vault.encrypt([copy({ id: 'a', fileId: 1, path: edited })]));
    const { x } = make(() => new Response(JSON.stringify({ message: 'File not found.' }), { status: 404 }));
    const r = await x.syncPending();
    expect(r.errors[0]!.error).toBe('File not found.');
    expect(x.list()[0]).toMatchObject({ state: 'changed', error: 'File not found.' });
  });
});
