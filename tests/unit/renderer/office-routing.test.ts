import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({})), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<object>()), navigate: vi.fn() }));

const { call } = await import('../../../src/core/bridge');
const { navigate, recordKey } = await import('../../../src/core/tabs');
const { saveTenderFile, tenderFilePath } = await import('../../../src/modules/tenders/files');
const { isOfficeFile } = await import('../../../src/core/open-document');

describe('Office documents from other modules open in WorkSuite DOC / Sheet / Slides tabs', () => {
  it('opens a tender’s Word file in a tab, not in another application', async () => {
    await saveTenderFile({ tenderDocument: 12 }, 'Technical Proposal.docx', true);
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/office\/doc\?src=api&name=Technical\+Proposal\.docx&path=%2Fapi%2Ftenders%2Fdocuments%2F12%2Ffile$/), null);
    expect(call).not.toHaveBeenCalled();
    // Saving to the downloads folder, and other types, still go through the download manager.
    await saveTenderFile({ tenderDocument: 12 }, 'Technical Proposal.docx', false);
    await saveTenderFile({ tenderLibrary: 3 }, 'Drawing.pdf', true);
    expect(vi.mocked(call).mock.calls.map((c) => (c[1] as { open: boolean }).open)).toEqual([false, true]);
  });

  it('knows where each tender file is served', () => {
    expect(tenderFilePath({ tenderLine: { line: 4, version: 2 } })).toBe('/api/tenders/checklist/4/download?v=2');
    expect(tenderFilePath({ tenderLetter: { tender: 1, letter: 5 } })).toBe('/api/tenders/1/letters/5/download');
    expect(tenderFilePath({ tenderLibrary: 3 })).toBe('/api/tender/library/3/file');
  });

  it('opens the formats the tab edits; older ones still download', () => {
    expect(['a.docx', 'b.XLSX', 'c.pptx'].map(isOfficeFile)).toEqual([true, true, true]);
    expect(['a.doc', 'b.xls', 'c.odt', 'd.pdf'].map(isOfficeFile)).toEqual([false, false, false, false]);
  });

  it('keeps one tab per document, attachments included', () => {
    expect(recordKey('/office/42?mode=edit')).toBe(recordKey('/office/42?editor=builtin'));
    expect(recordKey('/office/doc?src=api&path=%2Fapi%2Fa&name=x.docx')).not.toBe(recordKey('/office/doc?src=api&path=%2Fapi%2Fb&name=x.docx'));
    expect(recordKey('/office/doc?src=api&path=%2Fapi%2Fa&name=x.docx')).toBe(recordKey('/office/doc?name=renamed.docx&src=api&path=%2Fapi%2Fa'));
  });
});
