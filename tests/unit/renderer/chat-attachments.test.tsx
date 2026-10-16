// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '../../../src/modules/chat/AttachmentViewer';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({})), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/tabs', () => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { call } = await import('../../../src/core/bridge');
const { navigate } = await import('../../../src/core/tabs');
const { app } = await import('../../../src/core/app-state');
const { CSV_ROWS, TEXT_LIMIT, closePreview, justOpenedFromChat, openChatAttachment, openedFromChat, parseCsv, previewKind } = await import('../../../src/modules/chat/AttachmentViewer');
const { ui } = await import('../../../src/core/ui');

const file = (filename: string, mime: string, over: Partial<Attachment> = {}): Attachment => {
  const token = `tok${filename.replace(/[^A-Za-z0-9]/g, '')}xxxxxxxx`;
  return { id: Math.floor(Math.random() * 1e6), filename, mime, size: 2048, url: `/media/${token}`, download_url: `/media/${token}?download=1`, ...over };
};
const link = vi.fn();
const dialog = () => screen.queryByRole('dialog');

beforeEach(() => {
  vi.mocked(call).mockClear();
  vi.mocked(navigate).mockClear();
  link.mockClear();
  app.set({ auth: { server: { origin: 'https://ws.example.com' } } } as never);
});
afterEach(() => {
  act(() => closePreview());
  cleanup();
  vi.unstubAllGlobals();
});

/** jsdom loads no pictures: say it loaded (or failed). */
const loaded = () => fireEvent.load(screen.getByRole('img'));

describe('what an attachment opens in (#38)', () => {
  it('knows pictures, video, sound, PDF, Office, CSV and text from the type or the name', () => {
    expect(previewKind(file('a.png', 'image/png'))).toBe('image');
    expect(previewKind(file('a.bin', 'application/octet-stream', { is_image: true }))).toBe('image');
    expect(previewKind(file('a.mp4', 'video/mp4'))).toBe('video');
    expect(previewKind(file('a.m4a', 'audio/mp4'))).toBe('audio');
    expect(previewKind(file('Quote.pdf', 'application/octet-stream'))).toBe('pdf');
    expect(previewKind(file('Plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe('office');
    expect(previewKind(file('rates.csv', 'application/octet-stream'))).toBe('csv');
    expect(previewKind(file('notes.md', 'application/octet-stream'))).toBe('text');
    expect(previewKind(file('setup.exe', 'application/x-msdownload'))).toBe('other');
  });

  it('sends a PDF to PDF Studio and a Word file to a DOC tab, as before', () => {
    openChatAttachment(file('Quote.pdf', 'application/pdf'), link);
    expect(call).toHaveBeenCalledWith('transfers:download', expect.objectContaining({ name: 'Quote.pdf', open: true }));
    openChatAttachment(file('Plan.docx', ''), link);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});

describe('a document opened from the chat drawer', () => {
  it('steps a floating drawer aside so the document shows, and marks the tab as opened from chat', () => {
    openedFromChat.at = 0;
    vi.stubGlobal('innerWidth', 900);
    ui.set({ dock: 'chat', chatRoom: '7', chatMinimised: [] } as never);
    openChatAttachment(file('01_Cover_Letter.docx', ''), link);
    expect(ui.get().dock).toBeNull();
    expect(ui.get().chatMinimised).toContain('7');
    expect(justOpenedFromChat()).toBe(true);
    expect(justOpenedFromChat(Date.now() + 60_000)).toBe(false);
  });

  it('leaves a docked drawer beside the page, and a picture preview leaves the drawer alone', () => {
    openedFromChat.at = 0;
    vi.stubGlobal('innerWidth', 1600);
    ui.set({ dock: 'chat', chatRoom: '7', chatMinimised: [] } as never);
    openChatAttachment(file('Quote.pdf', 'application/pdf'), link);
    expect(ui.get().dock).toBe('chat');
    expect(justOpenedFromChat()).toBe(true);
    openedFromChat.at = 0;
    vi.stubGlobal('innerWidth', 900);
    act(() => openChatAttachment(file('one.png', 'image/png'), link));
    expect(ui.get().dock).toBe('chat');
    expect(justOpenedFromChat()).toBe(false);
  });
});

describe('the picture preview (#38)', () => {
  it('zooms, rotates and goes through the conversation’s pictures; Escape returns to the message that opened it', () => {
    const pics = [file('one.png', 'image/png'), file('two.jpg', 'image/jpeg'), file('three.webp', 'image/webp')];
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    act(() => openChatAttachment(pics[1]!, link, [...pics, file('doc.pdf', 'application/pdf')]));
    expect(dialog()!.getAttribute('aria-label')).toBe('Preview two.jpg');
    expect(screen.getByText(/2 of 3/)).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
    loaded();
    expect(screen.queryByText('Loading…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: 'Fit to window' }).textContent).toBe('150%');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    expect(screen.getByRole('img').style.transform).toBe('rotate(90deg) scale(1.5)');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(dialog()!.getAttribute('aria-label')).toBe('Preview three.webp');
    // A new picture starts fitted and upright.
    expect(screen.getByRole('img').style.transform).toBe('rotate(0deg)');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(dialog()!.getAttribute('aria-label')).toBe('Preview two.jpg');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps its toolbar clear of the window buttons Windows draws at the top right', () => {
    act(() => openChatAttachment(file('one.png', 'image/png'), link));
    const bar = screen.getByRole('button', { name: 'Close' }).parentElement as HTMLElement;
    expect(bar.style.paddingRight).toBe('150px');
  });

  it('asks for full screen', () => {
    act(() => openChatAttachment(file('one.png', 'image/png'), link));
    const ask = vi.fn(async () => undefined);
    dialog()!.requestFullscreen = ask;
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(ask).toHaveBeenCalled();
  });

  it('says when a picture could not be loaded, and tries again', () => {
    act(() => openChatAttachment(file('one.png', 'image/png'), link));
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('alert').textContent).toContain('one.png could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('shows the name, type and size, and downloads without opening', () => {
    const f = file('one.png', 'image/png', { size: 3 * 1024 * 1024 });
    act(() => openChatAttachment(f, link));
    expect(screen.getByText('one.png')).toBeTruthy();
    expect(screen.getByText(/image\/png · 3\.0 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(call).toHaveBeenCalledWith('transfers:download', { chatMedia: f.url!.slice('/media/'.length), name: 'one.png', open: false });
  });
});

describe('video and sound (#38)', () => {
  it('plays with the player’s own controls', () => {
    act(() => openChatAttachment(file('clip.mp4', 'video/mp4'), link));
    const v = dialog()!.querySelector('video')!;
    expect(v.controls).toBe(true);
    expect(v.getAttribute('src')).toBe('https://ws.example.com/media/tokclipmp4xxxxxxxx');
    act(() => closePreview());
    act(() => openChatAttachment(file('note.m4a', 'audio/mp4'), link));
    expect(dialog()!.querySelector('audio')!.controls).toBe(true);
  });
});

describe('CSV and text (#38)', () => {
  it('reads a CSV through the app and lays it out as a table', async () => {
    const fetch = vi.fn(async (_url: string) => new Response('Name,Rate\n"Kandy, roof",240000\nGalle,"1"""\n'));
    vi.stubGlobal('fetch', fetch);
    act(() => openChatAttachment(file('rates.csv', 'text/csv'), link));
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    expect(fetch.mock.calls[0]![0]).toBe('app://bundle/__api/media/tokratescsvxxxxxxxx');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Rate']);
    expect(screen.getByText('Kandy, roof')).toBeTruthy();
    expect(screen.getByText('1"')).toBeTruthy();
    expect(screen.getByText('2 rows')).toBeTruthy();
  });

  it('draws the first rows of a long CSV and says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(['a,b', ...Array.from({ length: CSV_ROWS + 5 }, (_, n) => `${n},x`)].join('\n'))));
    act(() => openChatAttachment(file('big.csv', 'text/csv'), link));
    await waitFor(() => expect(screen.getByText(/The first 1,000 of 1,005 rows/)).toBeTruthy());
    expect(screen.getAllByRole('row')).toHaveLength(CSV_ROWS + 1);
  });

  it('shows text as text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('line one\nline two')));
    act(() => openChatAttachment(file('notes.txt', 'text/plain'), link));
    await waitFor(() => expect(screen.getByText(/line one/)).toBeTruthy());
  });

  it('says plainly when access is gone, and tries again', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    act(() => openChatAttachment(file('notes.txt', 'text/plain'), link));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('You no longer have access to this file.'));
    fetch.mockImplementationOnce(async () => new Response('back again'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('back again')).toBeTruthy());
  });

  it('offers a download for a file too large to read here, without reading it', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    act(() => openChatAttachment(file('huge.log', 'text/plain', { size: TEXT_LIMIT + 1 }), link));
    expect(screen.getByRole('alert').textContent).toContain('too large to preview');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: /Download/ }).length).toBeGreaterThan(0);
  });
});

describe('a file with no preview (#38)', () => {
  it('offers Download and Open in app', () => {
    const f = file('setup.exe', 'application/x-msdownload');
    act(() => openChatAttachment(f, link));
    expect(screen.getByRole('alert').textContent).toContain('There is no preview for this kind of file.');
    fireEvent.click(screen.getAllByRole('button', { name: /Open in app/ }).at(-1)!);
    expect(call).toHaveBeenCalledWith('transfers:download', { chatMedia: f.url!.slice('/media/'.length), name: 'setup.exe', open: true });
  });
});

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, separators and line breaks inside quotes, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
    expect(parseCsv('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
