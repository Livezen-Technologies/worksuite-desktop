import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../src/modules/tasks/api';
import { groupActivity, isTransferArtifact, recentFiles, type ActivityRow, type RecentFile } from '../../../src/modules/home/feed';
import { DEFAULT_LAYOUT, compactCount, loadLayout, resize, saveLayout, taskBuckets, toggle } from '../../../src/modules/home/today';

const row = (over: Partial<ActivityRow>): ActivityRow => ({ id: 1, description: 'Uploaded report.pdf', user: 'Ann', at: '2026-10-22T08:00:00Z', module: 'files', ...over });
const file = (name: string): RecentFile => ({ id: 1, name, extension: name.split('.').pop() ?? '', size: 1, location: 'My Drive', at: '2026-10-22T08:00:00Z' });
const task = (over: Partial<Task>): Task => ({
  id: 1, task_key: null, list_id: null, org_id: null, org_name: null, owner_id: 5, assignee_id: 5, assignee_name: null, title: 'T', description: null,
  status: 'todo', priority: 'medium', tags: [], start_date: null, start_at: null, due_date: null, due_at: null, estimated_hours: null, progress: 0,
  position: 0, archived: false, completed_at: null, created_at: null, updated_at: null, ...over,
});

describe('Home #104: compact counts', () => {
  it('keeps small numbers whole and shortens large ones', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(12_345)).toBe('12.3K');
    expect(compactCount(1_200_000)).toBe('1.2M');
  });
});

describe('Home #104: task buckets', () => {
  it('puts each task in exactly one of due today, overdue and upcoming', () => {
    const now = Date.parse('2026-10-22T06:00:00Z');
    const b = taskBuckets([task({ id: 1, due_date: '2026-10-22' }), task({ id: 2, due_date: '2026-10-20' }), task({ id: 3, due_date: '2026-10-24' }), task({ id: 4, due_date: '2026-10-20', status: 'done' })], '2026-10-22', now);
    expect(b.today.map((t) => t.id)).toEqual([1]);
    expect(b.overdue.map((t) => t.id)).toEqual([2]);
    expect(b.upcoming.map((t) => t.id)).toEqual([3]);
  });
});

describe('Home #104: activity', () => {
  it('drops transfer-part lines', () => {
    expect(groupActivity([row({ description: 'Uploaded part 3 of 12' }), row({ id: 2, description: 'Upload chunk received' })])).toEqual([]);
  });
  it('groups a run of the same update by the same person, and keeps the server count', () => {
    const out = groupActivity([
      row({ id: 1, at: '2026-10-22T08:00:00Z' }),
      row({ id: 2, at: '2026-10-22T07:50:00Z', count: 3 }),
      row({ id: 3, at: '2026-10-22T07:40:00Z', user: 'Ben' }),
      row({ id: 4, at: '2026-10-22T05:00:00Z', user: 'Ben' }),
    ]);
    expect(out.map((a) => [a.id, a.count ?? 1])).toEqual([[1, 4], [3, 1], [4, 1]]);
  });
});

describe('Home #104: files', () => {
  it('leaves out a transfer’s temporary pieces and keeps real files', () => {
    for (const n of ['report.pdf.part', 'video.mp4.part3', 'big.zip.001', 'upload-3f2a9c1e-77aa.bin', 'x.chunk', '~$draft.docx', '.DS_Store', 'a.crdownload']) expect(isTransferArtifact(n)).toBe(true);
    expect(recentFiles([file('Q3 report.pdf'), file('report.pdf.tmp'), file('Budget 2026.xlsx')]).map((f) => f.name)).toEqual(['Q3 report.pdf', 'Budget 2026.xlsx']);
  });
});

describe('Home #104: layout persistence', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('saves per person, reads back, and falls back to the default when storage refuses', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
    const l = resize(toggle(DEFAULT_LAYOUT, 'files'), 'work', 'wide');
    saveLayout(7, l);
    expect(loadLayout(7)).toEqual(l);
    expect(loadLayout(8)).toEqual(DEFAULT_LAYOUT);
    mem.set('ws.home.layout:9', '{not json');
    expect(loadLayout(9)).toEqual(DEFAULT_LAYOUT);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(() => saveLayout(7, l)).not.toThrow();
    expect(loadLayout(7)).toEqual(DEFAULT_LAYOUT);
  });
});
