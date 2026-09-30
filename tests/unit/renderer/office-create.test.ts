import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiPost: vi.fn() }));
vi.mock('../../../src/core/upload', () => ({ uploadBlob: vi.fn(async () => ({ uploadId: 'u1', fileId: 77 })) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));

const { apiPost, ApiError } = await import('../../../src/core/api');
const { uploadBlob } = await import('../../../src/core/upload');
const { createBlank } = await import('../../../src/modules/office/create');

describe('Office → New makes a blank file on any server', () => {
  beforeEach(() => {
    vi.mocked(apiPost).mockReset();
    vi.mocked(uploadBlob).mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4]))));
  });

  it("uses the server's Office API when it has one", async () => {
    vi.mocked(apiPost).mockResolvedValue({ file: { id: 5, name: 'Document.docx' }, template: null, open: { mode: 'EDIT', session: 's' } });
    expect(await createBlank('document', null, true)).toEqual({ id: 5, name: 'Document.docx' });
    expect(apiPost).toHaveBeenCalledWith('/api/files/office/new', { type: 'document', folder_id: null });
  });

  it("otherwise Drive's own blank documents", async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 6, name: 'Untitled spreadsheet.xlsx' });
    expect(await createBlank('spreadsheet', 3, false)).toEqual({ id: 6, name: 'Untitled spreadsheet.xlsx' });
    expect(apiPost).toHaveBeenCalledWith('/api/files/create', { type: 'xlsx', name: 'Untitled spreadsheet.xlsx', folder_id: 3 });
    expect(uploadBlob).not.toHaveBeenCalled();
  });

  it("and only on a server with neither, WorkSuite's own blank file, uploaded", async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(404, 'Not found', null));
    expect(await createBlank('presentation', null, false)).toEqual({ id: 77, name: 'Untitled presentation.pptx' });
    expect(uploadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Untitled presentation.pptx', { kind: 'files', folderId: null });
  });

  it('reads a blank file Vite inlined as a data: URL without fetching it (the CSP would refuse)', async () => {
    const { blankBlob } = await import('../../../src/modules/office/create');
    const b = await blankBlob('data:application/octet-stream;base64,UEsDBA==');
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not paper over the server's refusal", async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(403, 'You may not create files here.', null));
    await expect(createBlank('document', 9, false)).rejects.toThrow('You may not create files here.');
    expect(uploadBlob).not.toHaveBeenCalled();
  });
});
