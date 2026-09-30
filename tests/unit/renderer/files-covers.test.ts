import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux' }));

const { coverId, coverKind } = await import('../../../src/modules/files/covers');
const { contract } = await import('../../../shared/ipc/contract');

describe("Drive covers (first pages of PDFs and Office files, drawn by the window)", () => {
  it('are drawn for PDF, Word, Excel and PowerPoint files up to 25 MB', () => {
    const f = (name: string, size = 1000) => ({ name, extension: null, size });
    expect(['a.pdf', 'b.docx', 'c.XLSX', 'd.pptx'].map((n) => coverKind(f(n)))).toEqual(['pdf', 'docx', 'xlsx', 'pptx']);
    expect(coverKind(f('e.doc'))).toBeNull();
    expect(coverKind(f('f.png'))).toBeNull();
    expect(coverKind(f('big.pdf', 26 * 1024 * 1024))).toBeNull();
  });

  it('are kept per file version, and the cache takes only that name and a small JPEG', () => {
    expect(coverId({ id: 7, version: 3, updated_at: null })).toBe('drive:7:v3');
    expect(coverId({ id: 7, version: null, updated_at: '2026-09-30T07:15:00Z' })).toBe('drive:7:2026-09-30T07:15:00Z');
    expect(contract['pdf:coverGet'].input.safeParse({ id: 'drive:7:v3' }).success).toBe(true);
    expect(contract['pdf:coverGet'].input.safeParse({ id: '../../etc/passwd' }).success).toBe(false);
    expect(contract['pdf:coverPut'].input.safeParse({ id: 'drive:7:v3', jpeg: new Uint8Array(600 * 1024) }).success).toBe(false);
    expect(contract['pdf:coverPut'].input.safeParse({ id: 'drive:7:v3', jpeg: new Uint8Array([0xff, 0xd8]) }).success).toBe(true);
  });
});
