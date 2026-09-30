import { describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn(async () => ({ data: { current: { version: 8 } }, offline: false, cachedAt: null })) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));

const { request } = await import('../../../src/core/api');
const { saveVersion } = await import('../../../src/modules/office/BuiltinEditor');
const { betterFormat } = await import('../../../src/modules/office/better/format');

describe("WorkSuite's built-in Office editor (BetterOffice)", () => {
  it('edits the OOXML formats only', () => {
    expect(betterFormat('Plan.docx')).toBe('docx');
    expect(betterFormat('Budget', 'XLSX')).toBe('xlsx');
    expect(betterFormat('Deck.pptx')).toBe('pptx');
    expect(betterFormat('Old.doc')).toBeNull();
    expect(betterFormat('Sheet.ods')).toBeNull();
  });

  it('saves the edited bytes as the next Drive version', async () => {
    const v = await saveVersion(42, 'Plan.docx', new Uint8Array([0x50, 0x4b, 3, 4]), 7);
    expect(v).toBe(8);
    const [method, path, opts] = vi.mocked(request).mock.calls[0]! as [string, string, { body: FormData }];
    expect([method, path]).toEqual(['POST', '/api/files/42/versions']);
    const file = opts.body.get('file') as File;
    expect(file.name).toBe('Plan.docx');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(opts.body.get('base_version')).toBe('7');
  });
});
