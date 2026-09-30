import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGetMeta: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/upload', () => ({ uploadBlob: vi.fn(async () => ({ uploadId: 'u', fileId: 900 })) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async (ch: string) => (ch === 'office:readFile' ? new Uint8Array([0x50, 0x4b, 1]) : { size: 3 })), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));

const { apiGetMeta, apiPost } = await import('../../../src/core/api');
const { uploadBlob } = await import('../../../src/core/upload');
const { call } = await import('../../../src/core/bridge');
const { driveCopy, linkedLocal, writeBack, COPIES_FOLDER } = await import('../../../src/modules/office/copies');

describe('online, a document that is not a Drive file opens as a Drive copy in the Document Server', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x50, 0x4b, 9]))));
  });

  it('copies it once into My files → WorkSuite copies, made when missing', async () => {
    vi.mocked(apiGetMeta).mockResolvedValue({ data: { folders: [{ id: 3, name: 'Tenders' }] }, offline: false, cachedAt: null } as never);
    vi.mocked(apiPost).mockResolvedValue({ id: 44 });
    const src = { kind: 'api' as const, path: '/api/mail/messages/1/attachments/a?folder=INBOX&dl=1', name: 'Proposal.docx' };
    expect(await driveCopy(src)).toEqual({ id: 900, name: 'Proposal.docx' });
    expect(apiPost).toHaveBeenCalledWith('/api/folders', { name: COPIES_FOLDER, parent_id: null });
    expect(uploadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Proposal.docx', { kind: 'files', folderId: '44' });
    // The same attachment again: the same copy, nothing uploaded twice.
    await driveCopy(src);
    expect(uploadBlob).toHaveBeenCalledTimes(1);
    expect(linkedLocal(900)).toBeNull();
  });

  it('links a copy of a file on this computer, and writes the Drive version back to it', async () => {
    vi.mocked(uploadBlob).mockResolvedValueOnce({ uploadId: 'u2', fileId: 901 });
    const src = { kind: 'local' as const, handle: '0e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10', name: 'Budget.xlsx' };
    await driveCopy(src);
    expect(call).toHaveBeenCalledWith('office:readFile', { handle: src.handle });
    expect(linkedLocal(901)).toEqual({ handle: src.handle, name: 'Budget.xlsx' });
    expect(await writeBack(901)).toBe(true);
    expect(call).toHaveBeenCalledWith('office:writeFile', { handle: src.handle, bytes: new Uint8Array([0x50, 0x4b, 9]) });
    expect(await writeBack(12345)).toBe(false);
  });
});
