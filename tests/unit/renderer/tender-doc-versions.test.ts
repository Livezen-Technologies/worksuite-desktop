import { describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));

const api = await import('../../../src/core/api');
const v = await import('../../../src/modules/tenders/versions');
const { diffLines, diffStats, sideBySide, MAX_CELLS } = await import('../../../src/modules/tenders/lineDiff');
const { tenderFilePath } = await import('../../../src/modules/tenders/files');

describe('tenders: a document line diff', () => {
  it('keeps shared lines and marks the rest', () => {
    const d = diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd']);
    expect(d).toEqual([
      { op: 'same', text: 'a' },
      { op: 'removed', text: 'b' },
      { op: 'added', text: 'x' },
      { op: 'same', text: 'c' },
      { op: 'added', text: 'd' },
    ]);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
  });

  it('pairs a reworded line on one row', () => {
    expect(sideBySide(diffLines(['a', 'b', 'c'], ['a', 'B', 'c']))).toEqual([
      { left: 'a', right: 'a', kind: 'same' },
      { left: 'b', right: 'B', kind: 'changed' },
      { left: 'c', right: 'c', kind: 'same' },
    ]);
    expect(sideBySide(diffLines(['a'], []))).toEqual([{ left: 'a', right: null, kind: 'removed' }]);
    expect(sideBySide(diffLines([], ['z']))).toEqual([{ left: null, right: 'z', kind: 'added' }]);
  });

  it('falls back to everything changed for very long documents', () => {
    const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 1;
    const a = Array.from({ length: n }, (_, i) => `a${i}`);
    const b = Array.from({ length: n }, (_, i) => `b${i}`);
    expect(diffStats(diffLines(['h', ...a], ['h', ...b]))).toEqual({ added: n, removed: n });
  });
});

describe('tenders: document versions', () => {
  it('reads the versions newest first, with what the reader may do', async () => {
    vi.mocked(api.apiGet).mockResolvedValueOnce({
      id: '4', title: 'Bid', file_id: '31', current: '3', comparable: true,
      versions: [{ version: '2', size: '100', current: false, author: { name: 'Ann' }, made_at: '2026-10-01', label: null }, { version: 3, size: null, current: true, author: 'Bo', made_at: null, label: 'Restored v1' }],
      can: { view: true, download: '1', restore: false, edit: 0 },
    });
    const r = await v.documentVersions(4);
    expect(api.apiGet).toHaveBeenLastCalledWith('/api/tenders/documents/4/versions');
    expect(r.versions.map((x) => x.version)).toEqual([3, 2]);
    expect(r.versions[1]).toMatchObject({ author: 'Ann', size: 100, current: false });
    expect(r.can).toEqual({ view: true, download: true, restore: false, edit: false });
  });

  it('asks the server how to open it online', async () => {
    vi.mocked(api.apiGet).mockResolvedValueOnce({ id: 4, file_id: 31, name: 'Bid.docx', online: true, mode: 'VIEW', can_edit: false, reason: 'Locked' });
    expect(await v.documentOnline(4)).toMatchObject({ file_id: 31, mode: 'VIEW', can_edit: false, reason: 'Locked' });
    vi.mocked(api.apiGet).mockResolvedValueOnce({ id: 4, mode: 'nonsense' });
    expect((await v.documentOnline(4)).mode).toBeNull();
  });

  it('compares older to newer whichever was picked first, and restores', async () => {
    vi.mocked(api.apiGet).mockResolvedValueOnce({ from: { version: 1, lines: ['a'], truncated: false }, to: { version: 3, lines: ['b'], truncated: true } });
    const c = await v.compareVersions(4, 3, 1);
    expect(api.apiGet).toHaveBeenLastCalledWith('/api/tenders/documents/4/compare', { from: '1', to: '3' });
    expect(c.to).toEqual({ version: 3, lines: ['b'], truncated: true });
    vi.mocked(api.apiPost).mockResolvedValueOnce({ id: 4, restored: 1, version: 4 });
    expect(await v.restoreVersion(4, 1)).toBe(4);
    expect(api.apiPost).toHaveBeenLastCalledWith('/api/tenders/documents/4/versions/1/restore', {});
  });

  it('names and fetches a version file', () => {
    expect(v.versionFileName('Bid.docx', 2)).toBe('Bid (v2).docx');
    expect(v.versionFileName('Bid', 2)).toBe('Bid (v2)');
    expect(tenderFilePath({ tenderDocument: 4, tenderDocumentVersion: 2 })).toBe('/api/tenders/documents/4/versions/2/file');
    expect(tenderFilePath({ tenderDocument: 4 })).toBe('/api/tenders/documents/4/file');
  });
});
