import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({})), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin' }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<object>()), navigate: vi.fn() }));

import { call } from '../../../src/core/bridge';
import { navigate } from '../../../src/core/tabs';
import { mediaToken, openDocument } from '../../../src/core/open-document';
import { openAttachment } from '../../../src/modules/chat/types';

describe('documents open on this computer, not in the browser', () => {
  beforeEach(() => vi.mocked(call).mockClear());

  it('reads the token of a signed media address', () => {
    expect(mediaToken('/media/Abc_123-x.y~z?download=1')).toBe('Abc_123-x.y~z');
    expect(mediaToken('https://ws.example/media/Abc_123-x.y~z')).toBe('Abc_123-x.y~z');
    expect(mediaToken('/chat/files/abc')).toBeNull();
    expect(mediaToken('/media/short')).toBeNull();
    expect(mediaToken(null)).toBeNull();
  });

  it('downloads and opens a document through the transfer manager', async () => {
    await openDocument({ hrDocument: 7, hrEmployee: 3 }, 'Contract.pdf');
    expect(call).toHaveBeenCalledWith('transfers:download', { hrDocument: 7, hrEmployee: 3, name: 'Contract.pdf', open: true });
  });

  it('opens a chat attachment by its token, and only falls back to the link without one', async () => {
    const link = vi.fn();
    openAttachment({ filename: 'Minutes.zip', download_url: '/media/Tok3n_abcdef?download=1' }, link);
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', { chatMedia: 'Tok3n_abcdef', name: 'Minutes.zip', open: true }));
    // A Word, Excel or PowerPoint file opens in a WorkSuite DOC / Sheet / Slides tab instead.
    openAttachment({ filename: 'Budget.xlsx', download_url: '/media/Tok3n_abcdef?download=1' }, link);
    expect(navigate).toHaveBeenCalledWith('/office/doc?src=api&name=Budget.xlsx&path=%2Fmedia%2FTok3n_abcdef%3Fdownload%3D1', null);
    expect(link).not.toHaveBeenCalled();
    openAttachment({ filename: 'old.doc', download_url: '/elsewhere/x' }, link);
    expect(link).toHaveBeenCalledWith('/elsewhere/x');
    openAttachment({ filename: 'gone.doc', download_url: null }, link);
    expect(link).toHaveBeenCalledTimes(1);
  });
});

describe('the Office tile', () => {
  it('lists the Office files among the recent ones, newest first', async () => {
    const { officeFiles } = await import('../../../src/modules/office/OfficeHome');
    const f = (id: number, name: string, extension = '') => ({ id, name, extension }) as never;
    expect(officeFiles([f(1, 'Plan.docx'), f(2, 'photo.png'), f(3, 'Budget', 'xlsx'), f(4, 'Brief.pdf'), f(5, 'Deck.pptx')]).map((x: { id: number }) => x.id)).toEqual([1, 3, 5]);
    expect(officeFiles(Array.from({ length: 50 }, (_, i) => f(i, `${i}.docx`)), 30)).toHaveLength(30);
  });
});
