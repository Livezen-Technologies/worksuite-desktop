import { describe, expect, it } from 'vitest';
import type { SyncMode } from '@shared/types';
import { planContent, planMoves, type BaseItem, type ContentAction, type LocalItem, type Picture, type RemoteItem } from '../../../electron/services/sync/plan';
import { globToRegExp, isIgnored, localNameProblem, makeKey, policyRefusal } from '../../../electron/services/sync/rules';

const key = makeKey(true);

function pic<T extends { rel: string }>(items: T[], blind: string[] = []): Picture<T> {
  return { items: new Map(items.map((i) => [key(i.rel), i])), blind: new Set(blind.map(key)) };
}
function baseOf(items: BaseItem[]): Map<string, BaseItem> {
  return new Map(items.map((i) => [key(i.rel), i]));
}
const L = (rel: string, sha: string | null = 'aa', extra: Partial<LocalItem> = {}): LocalItem => ({ rel, kind: 'file', size: 10, mtimeMs: 1000, ino: `i-${rel}`, sha256: sha, ...extra });
const LD = (rel: string, ino = `d-${rel}`): LocalItem => ({ rel, kind: 'dir', size: 0, mtimeMs: 0, ino, sha256: null });
const R = (rel: string, id: number, sha = 'aa', version = 1, extra: Partial<RemoteItem> = {}): RemoteItem => ({ rel, kind: 'file', id, version, size: 10, sha256: sha, own: true, editable: true, deletable: true, movable: true, ...extra });
const RD = (rel: string, id: number): RemoteItem => ({ rel, kind: 'dir', id, version: 0, size: 0, sha256: null, own: true, editable: true, deletable: true, movable: true });
const B = (rel: string, id: number, sha = 'aa', version = 1, extra: Partial<BaseItem> = {}): BaseItem => ({ rel, kind: 'file', remoteId: id, version, sha256: sha, size: 10, mtimeMs: 1000, ino: `i-${rel}`, ...extra });
const BD = (rel: string, id: number, ino = `d-${rel}`): BaseItem => ({ rel, kind: 'dir', remoteId: id, version: 0, sha256: null, size: 0, mtimeMs: 0, ino });

function plan(base: BaseItem[], local: LocalItem[], remote: RemoteItem[], mode: SyncMode = 'two_way', blind: { local?: string[]; remote?: string[] } = {}): ContentAction[] {
  return planContent(baseOf(base), pic(local, blind.local), pic(remote, blind.remote), { mode, key });
}
const ops = (a: ContentAction[]) => a.map((x) => `${x.op} ${x.rel}`);

describe('Drive sync — what a pass does with each file', () => {
  it('uploads a new file, downloads a new Drive file, and leaves an agreed file alone', () => {
    expect(ops(plan([], [L('a.txt')], []))).toEqual(['upload a.txt']);
    expect(ops(plan([], [], [R('b.txt', 7)]))).toEqual(['download b.txt']);
    expect(plan([B('c.txt', 3)], [L('c.txt')], [R('c.txt', 3)])).toEqual([]);
  });

  it('records a file that already matches on both sides instead of copying it', () => {
    expect(ops(plan([], [L('a.txt', 'x')], [R('a.txt', 4, 'x')]))).toEqual(['record a.txt']);
  });

  it('sends an edit up against the version it started from, and brings Drive’s edit down', () => {
    const up = plan([B('a.txt', 3, 'old', 2)], [L('a.txt', 'new')], [R('a.txt', 3, 'old', 2)]);
    expect(up).toEqual([expect.objectContaining({ op: 'upload', fileId: 3, baseVersion: 2 })]);
    const down = plan([B('a.txt', 3, 'old', 2)], [L('a.txt', 'old')], [R('a.txt', 3, 'theirs', 3)]);
    expect(ops(down)).toEqual(['download a.txt']);
  });

  it('keeps both copies when both sides changed a file differently', () => {
    expect(ops(plan([B('a.txt', 3, 'old', 2)], [L('a.txt', 'mine')], [R('a.txt', 3, 'theirs', 3)]))).toEqual(['conflict a.txt']);
    expect(ops(plan([], [L('a.txt', 'mine')], [R('a.txt', 3, 'theirs')]))).toEqual(['conflict a.txt']);
    // Both made the same change: nothing to keep twice.
    expect(ops(plan([B('a.txt', 3, 'old', 2)], [L('a.txt', 'same')], [R('a.txt', 3, 'same', 3)]))).toEqual(['record a.txt']);
  });

  it('carries a deletion only when the other side still has what was agreed', () => {
    expect(ops(plan([B('a.txt', 3)], [], [R('a.txt', 3)]))).toEqual(['delete-remote a.txt']);
    expect(ops(plan([B('a.txt', 3)], [L('a.txt')], []))).toEqual(['delete-local a.txt']);
    // Deleted here, but somebody changed it in Drive: their change comes back.
    expect(ops(plan([B('a.txt', 3, 'aa', 1)], [], [R('a.txt', 3, 'bb', 2)]))).toEqual(['download a.txt']);
    // Deleted in Drive, but changed here: the change goes up as a new file.
    expect(plan([B('a.txt', 3)], [L('a.txt', 'edited')], [])).toEqual([expect.objectContaining({ op: 'upload', fileId: null })]);
    expect(ops(plan([B('a.txt', 3)], [], []))).toEqual(['forget a.txt']);
  });

  it('never deletes a colleague’s file it may not delete; it brings it back instead', () => {
    expect(ops(plan([B('a.txt', 3)], [], [R('a.txt', 3, 'aa', 1, { deletable: false, own: false })]))).toEqual(['download a.txt']);
  });

  it('does not upload an edit to a file this person may only view', () => {
    const a = plan([B('a.txt', 3, 'old')], [L('a.txt', 'new')], [R('a.txt', 3, 'old', 1, { editable: false, own: false })]);
    expect(a).toEqual([expect.objectContaining({ op: 'skip' })]);
  });

  it('leaves a file that is still being written for the next pass', () => {
    expect(plan([B('a.txt', 3)], [L('a.txt', null, { unstable: true })], [R('a.txt', 3, 'bb', 2)])).toEqual([]);
  });

  it('does nothing under a place it could not see — an unreadable folder is not a deleted one', () => {
    expect(plan([B('Locked/a.txt', 3), BD('Locked', 9)], [LD('Locked'), L('Locked/a.txt')], [], 'two_way', { remote: ['Locked'] })).toEqual([]);
    expect(plan([B('Box/a.txt', 3)], [], [R('Box/a.txt', 3)], 'two_way', { local: ['Box'] })).toEqual([]);
  });

  it('refuses a file and a folder with the same name', () => {
    expect(ops(plan([], [LD('Report')], [R('Report', 3)]))).toEqual(['skip Report']);
  });

  it('upload-only: Drive follows this computer, and Drive’s own changes stay in Drive', () => {
    expect(plan([B('a.txt', 3, 'aa', 1)], [L('a.txt', 'aa')], [R('a.txt', 3, 'bb', 2)], 'upload_only')).toEqual([]);
    expect(plan([B('a.txt', 3, 'aa', 1)], [L('a.txt', 'cc')], [R('a.txt', 3, 'bb', 2)], 'upload_only')).toEqual([expect.objectContaining({ op: 'upload', fileId: 3, baseVersion: 2 })]);
    expect(ops(plan([B('a.txt', 3)], [], [R('a.txt', 3)], 'upload_only'))).toEqual(['delete-remote a.txt']);
    // Removed from Drive while unchanged here: it goes back up.
    expect(ops(plan([B('a.txt', 3)], [L('a.txt')], [], 'upload_only'))).toEqual(['upload a.txt']);
    expect(plan([], [], [R('b.txt', 4)], 'upload_only')).toEqual([]);
  });

  it('download-only: this computer follows Drive, and an edit here is kept aside rather than lost', () => {
    expect(plan([], [L('mine.txt')], [], 'download_only')).toEqual([]);
    expect(ops(plan([B('a.txt', 3)], [], [R('a.txt', 3)], 'download_only'))).toEqual(['download a.txt']);
    expect(ops(plan([B('a.txt', 3, 'aa', 1)], [L('a.txt', 'mine')], [R('a.txt', 3, 'bb', 2)], 'download_only'))).toEqual(['conflict a.txt']);
    expect(plan([B('a.txt', 3, 'aa', 1)], [L('a.txt', 'mine')], [R('a.txt', 3, 'aa', 1)], 'download_only')).toEqual([]);
  });
});

describe('Drive sync — folders', () => {
  it('creates folders top down before the files that go in them', () => {
    expect(ops(plan([], [LD('A'), LD('A/B'), L('A/B/x.txt')], []))).toEqual(['mkdir-remote A', 'mkdir-remote A/B', 'upload A/B/x.txt']);
    expect(ops(plan([], [], [RD('A', 1), RD('A/B', 2), R('A/B/x.txt', 3)]))).toEqual(['mkdir-local A', 'mkdir-local A/B', 'download A/B/x.txt']);
  });

  it('removes a folder deleted on the other side only once everything in it is going too, deepest first', () => {
    const a = plan([BD('A', 1), BD('A/B', 2), B('A/B/x.txt', 3)], [], [RD('A', 1), RD('A/B', 2), R('A/B/x.txt', 3)]);
    expect(ops(a)).toEqual(['delete-remote A/B/x.txt', 'delete-remote A/B', 'delete-remote A']);
  });

  it('keeps a folder when something inside it changed on the side that still has it', () => {
    // Deleted here, but a file inside was changed in Drive: the folder comes back with it.
    const a = plan([BD('A', 1), B('A/x.txt', 3, 'aa', 1)], [], [RD('A', 1), R('A/x.txt', 3, 'bb', 2)]);
    expect(ops(a)).toEqual(['mkdir-local A', 'download A/x.txt']);
    // Deleted in Drive, but a new file was put inside it here: the folder goes back up with it.
    const b = plan([BD('A', 1)], [LD('A'), L('A/new.txt')], []);
    expect(ops(b)).toEqual(['mkdir-remote A', 'upload A/new.txt']);
  });
});

describe('Drive sync — moves and renames keep the file', () => {
  it('follows a rename made in Drive, found by the file’s id', () => {
    const m = planMoves(baseOf([B('old.txt', 3)]), pic([L('old.txt')]), pic([R('new.txt', 3)]), { mode: 'two_way', key });
    expect(m).toEqual([{ op: 'move-local', kind: 'file', baseRel: 'old.txt', from: 'old.txt', to: 'new.txt' }]);
  });

  it('carries a rename made here to Drive, found by the inode', () => {
    const m = planMoves(baseOf([B('old.txt', 3)]), pic([L('Docs/new.txt', 'aa', { ino: 'i-old.txt' }), LD('Docs')]), pic([R('old.txt', 3), RD('Docs', 5)]), { mode: 'two_way', key });
    expect(m).toEqual([{ op: 'move-remote', kind: 'file', baseRel: 'old.txt', from: 'old.txt', to: 'Docs/new.txt', remoteId: 3 }]);
  });

  it('does not take a new file that reused an old inode for a rename', () => {
    const m = planMoves(baseOf([B('old.txt', 3)]), pic([L('other.txt', 'zz', { ino: 'i-old.txt', mtimeMs: 5000 })]), pic([R('old.txt', 3)]), { mode: 'two_way', key });
    expect(m).toEqual([]);
  });

  it('moves a folder once, carrying what is inside it', () => {
    const base = baseOf([BD('A', 1), B('A/x.txt', 3), BD('A/B', 2), B('A/B/y.txt', 4)]);
    const remote = pic([RD('Z', 1), R('Z/x.txt', 3), RD('Z/B', 2), R('Z/B/y.txt', 4)]);
    const local = pic([LD('A', 'd-A'), L('A/x.txt'), LD('A/B', 'd-A/B'), L('A/B/y.txt')]);
    expect(planMoves(base, local, remote, { mode: 'two_way', key })).toEqual([{ op: 'move-local', kind: 'dir', baseRel: 'A', from: 'A', to: 'Z' }]);
  });

  it('when both sides moved the same file, Drive’s place wins; when to the same place, only the index follows', () => {
    const base = baseOf([B('a.txt', 3)]);
    expect(planMoves(base, pic([L('here.txt', 'aa', { ino: 'i-a.txt' })]), pic([R('there.txt', 3)]), { mode: 'two_way', key })).toEqual([{ op: 'move-local', kind: 'file', baseRel: 'a.txt', from: 'here.txt', to: 'there.txt' }]);
    expect(planMoves(base, pic([L('b.txt', 'aa', { ino: 'i-a.txt' })]), pic([R('b.txt', 3)]), { mode: 'two_way', key })).toEqual([{ op: 'rebase', kind: 'file', baseRel: 'a.txt', from: 'a.txt', to: 'b.txt' }]);
  });
});

describe('Drive sync — rules', () => {
  it('matches ignore patterns the way the server’s fnmatch does, without case', () => {
    expect(globToRegExp('*.tmp').test('Draft.TMP')).toBe(true);
    expect(globToRegExp('report-?.pdf').test('report-1.pdf')).toBe(true);
    expect(globToRegExp('[!a]*').test('abc')).toBe(false);
    expect(isIgnored('Docs/.DS_Store', [])).toBe(true);
    expect(isIgnored('Docs/~$budget.xlsx', [])).toBe(true);
    expect(isIgnored('node_modules', ['node_modules'])).toBe(true);
    expect(isIgnored('Docs/plan.pdf', ['*.tmp'])).toBe(false);
  });

  it('refuses what the sync policy refuses', () => {
    const policy = { max_devices: 10, max_file_bytes: 1000, upload_kbps: 0, download_kbps: 0, blocked_types: ['exe', '.iso'], ignored_patterns: [], allow_offline: true, require_encryption: false, block_size: 4194304 };
    expect(policyRefusal(policy, 'a.pdf', 2000)).toMatch(/limit for synced files/);
    expect(policyRefusal(policy, 'setup.EXE', 10)).toMatch(/\.exe files/);
    expect(policyRefusal(policy, 'disk.iso', 10)).toMatch(/\.iso files/);
    expect(policyRefusal(policy, 'a.pdf', 10)).toBeNull();
  });

  it('knows which Drive names Windows cannot hold', () => {
    expect(localNameProblem('a:b.txt', 'win32')).toMatch(/Windows/);
    expect(localNameProblem('CON.txt', 'win32')).toMatch(/Windows/);
    expect(localNameProblem('trailing.', 'win32')).toMatch(/dot/);
    expect(localNameProblem('a:b.txt', 'darwin')).toBeNull();
  });

  it('compares names composed and, where the disk does, without case', () => {
    expect(makeKey(true)('Café/Report.PDF')).toBe(makeKey(true)('Café/report.pdf'));
    expect(makeKey(false)('A.txt')).not.toBe(makeKey(false)('a.txt'));
  });
});
