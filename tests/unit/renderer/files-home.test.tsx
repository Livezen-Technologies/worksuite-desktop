// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Ctx from '../../../src/modules/files/ctx';
import type { DriveFile, DriveHome } from '../../../src/modules/files/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/files/ctx', async (orig) => ({
  ...(await orig<typeof Ctx>()),
  // The real menu asks Office and Chat what they allow; here it is a stand-in with the usual separator.
  fileMenu: vi.fn((f: DriveFile) => [{ label: 'Open', run: vi.fn() }, { label: 'Preview', run: vi.fn() }, { sep: true }, { label: f.starred ? 'Remove star' : 'Star', run: vi.fn() }]),
}));

// jsdom has no IntersectionObserver; a document's cover is asked for once its card is on screen, which here is never.
globalThis.IntersectionObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;

const { apiGet, apiGetMeta, ApiError } = await import('../../../src/core/api');
const { DriveCtx } = await import('../../../src/modules/files/ctx');
const { Home, groupShares, accessLabel } = await import('../../../src/modules/files/Home');
const { isJunkFile } = await import('../../../src/modules/files/api');

const NOW = Date.parse('2026-10-01T10:00:00Z');
let n = 0;
const file = (name: string, over: Partial<DriveFile> = {}): DriveFile =>
  ({ id: ++n, name, description: null, extension: name.split('.').pop() ?? null, kind: 'other', mime_type: null, size: 1000, folder_id: 7, folder_name: 'Tenders', folder_path: 'Tenders', has_thumb: false, version: 1, downloads: 0, owner_id: 1, owner_name: 'Me', created_at: '2026-09-30 08:00:00', updated_at: '2026-09-30 08:00:00', opened_at: null, deleted_at: null, ...over }) as DriveFile;
const home = (over: Partial<DriveHome> = {}): DriveHome => ({ continue: [], recent: [], starred: [], starred_folders: [], shared: [], counts: { files: 120, folders: 9, starred: 2, recent: 10, trash: 0, used: 5 * 1024 * 1024 }, ...over });

const drive = { upload: vi.fn(), open: vi.fn(), openFolder: vi.fn() };
const onPlace = vi.fn();
const newItems = [{ label: 'New folder', run: vi.fn() }];

function show(data: DriveHome | Error, shares: Array<{ id: number; file_id: number; url: string; status: string }> = []) {
  vi.mocked(apiGetMeta).mockImplementation(async () => {
    if (data instanceof Error) throw data;
    return { data, offline: false, cachedAt: null } as never;
  });
  vi.mocked(apiGet).mockResolvedValue({ items: shares } as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DriveCtx.Provider value={drive as never}>
        <Home onPlace={onPlace} now={NOW} newItems={newItems} />
      </DriveCtx.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('Drive Home (#41)', () => {
  it('has one compact header: search, New with the same menu as the rail, and Upload', async () => {
    show(home());
    expect(await screen.findByText(/120 files · 9 folders · 5\.0 MB used/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search Drive'), { target: { value: 'tender' } });
    fireEvent.keyDown(screen.getByLabelText('Search Drive'), { key: 'Enter' });
    expect(onPlace).toHaveBeenCalledWith({ view: 'folder', folder: null }, 'tender');
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(drive.upload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(within(screen.getByRole('menu')).getByText('New folder')).toBeTruthy();
    // No second set of upload and folder buttons on the page.
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Upload/ })).toHaveLength(1);
  });

  it('shows a few files as compact rows, more as tiles, and never .part or temporary files', async () => {
    show(home({
      continue: [file('Quote.docx', { last_action: 'edited', last_at: '2026-10-01 09:00:00' }), file('movie.mp4.part'), file('~$Quote.docx')],
      recent: ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf', 'f.pdf', 'g.pdf', '.DS_Store'].map((x) => file(x, { opened_at: '2026-10-01 08:00:00' })),
    }));
    await screen.findByText('Quote.docx');
    const cont = screen.getByRole('region', { name: 'Continue working' });
    expect(within(cont).getByText('Quote.docx')).toBeTruthy();
    expect(within(cont).queryByText('movie.mp4.part')).toBeNull();
    expect(within(cont).queryByText('~$Quote.docx')).toBeNull();
    expect(within(cont).getByText(/^Edited /)).toBeTruthy();
    // One file: a row, not a wide grid of tiles.
    expect(cont.querySelector('[data-placeholder]')).toBeNull();
    const recent = screen.getByRole('region', { name: 'Recently opened' });
    // Six at most, with See all for the rest; when it was opened, not changed.
    expect(within(recent).getAllByRole('button', { name: /^More actions for/ })).toHaveLength(6);
    expect(within(recent).queryByText('g.pdf')).toBeNull();
    expect(within(recent).queryByText('.DS_Store')).toBeNull();
    expect(within(recent).getAllByText(/^Opened /).length).toBe(6);
    // A file with no picture shows its kind, not a blank card.
    expect(recent.querySelectorAll('[data-placeholder]').length).toBe(6);
    fireEvent.click(within(recent).getByRole('button', { name: 'See all' }));
    expect(onPlace).toHaveBeenCalledWith({ view: 'recent', folder: null });
  });

  it('offers a file’s actions from a button, with Open containing folder', async () => {
    show(home({ continue: [file('Quote.docx')] }));
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Quote.docx' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
    expect(items.slice(0, 3)).toEqual(['Open', 'Preview', expect.stringContaining('Open containing folder')]);
    fireEvent.click(within(screen.getByRole('menu')).getByText('Open containing folder'));
    expect(onPlace).toHaveBeenCalledWith({ view: 'folder', folder: 7 });
  });

  it('keeps starred folders compact, six at most', async () => {
    show(home({ starred_folders: Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, name: `Folder ${i}`, color: null, path: null, file_count: 1, total_size: 10 })) }));
    await screen.findByText('Folder 0');
    const s = screen.getByRole('region', { name: 'Starred folders' });
    expect(within(s).getAllByRole('button', { name: /^Folder \d/ })).toHaveLength(6);
    expect(within(s).getAllByText('1 file · 10 B')).toHaveLength(6);
    fireEvent.click(within(s).getByRole('button', { name: 'See all' }));
    expect(onPlace).toHaveBeenCalledWith({ view: 'starred', folder: null });
  });

  it('groups links by the file they open, keeps two files with one name apart, and says who can open each', async () => {
    const link = (id: number, file_id: number, name: string, visibility: string, downloads_used = 0) => ({ id, token: `t${id}`, visibility, expires_at: null, downloads_used, file_id, name, extension: 'pdf', size: 2048 });
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    show(home({ shared: [link(1, 50, 'Price list.pdf', 'public', 3), link(2, 50, 'Price list.pdf', 'password', 1), link(3, 51, 'Price list.pdf', 'public')] }), [
      { id: 1, file_id: 50, url: 'https://ws.example.com/s/t1', status: 'active' },
      { id: 3, file_id: 51, url: 'https://ws.example.com/s/t3', status: 'active' },
    ]);
    await screen.findByRole('list', { name: 'Files shared by link' });
    const s = screen.getByRole('region', { name: 'Shared by link' });
    const rows = within(s).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Anybody with the link · Anybody with the password · 2 links');
    expect(rows[0]!.textContent).toContain('4 downloads');
    expect(rows[1]!.textContent).toContain('Anybody with the link · 2.0 KB');
    await waitFor(() => expect(within(rows[1]!).getByRole('button', { name: 'Copy link to Price list.pdf' })).toHaveProperty('disabled', false));
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Copy link to Price list.pdf' }));
    expect(writeText).toHaveBeenCalledWith('https://ws.example.com/s/t3');
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Manage links to Price list.pdf' }));
    expect(onPlace).toHaveBeenCalledWith({ view: 'links', folder: null });
  });

  it('shows each section’s shape while loading, says what is empty, and offers Try again on an error', async () => {
    vi.mocked(apiGetMeta).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(apiGet).mockResolvedValue({ items: [] } as never);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DriveCtx.Provider value={drive as never}>
          <Home onPlace={onPlace} now={NOW} newItems={newItems} />
        </DriveCtx.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getAllByTestId('home-skeleton')).toHaveLength(4);
    cleanup();
    show(home());
    expect(await screen.findByText('Files you change or upload show up here.')).toBeTruthy();
    expect(screen.getByText('Nothing is out on a public link.')).toBeTruthy();
    expect(screen.getByText('Star a folder to keep it here.')).toBeTruthy();
    cleanup();
    show(new ApiError(500, 'The server answered 500.', 'SERVER') as Error);
    const retry = await screen.findByRole('button', { name: /Try again|Retry/ });
    vi.mocked(apiGetMeta).mockResolvedValue({ data: home(), offline: false, cachedAt: null } as never);
    fireEvent.click(retry);
    expect(await screen.findByText('Files you change or upload show up here.')).toBeTruthy();
  });
});

describe('what Home leaves out (#41)', () => {
  it('knows downloads in progress, temporary and system files', () => {
    for (const junk of ['film.mp4.part', 'a.crdownload', 'x.tmp', '~$Report.docx', '.~lock.Report.docx#', '.DS_Store', 'Thumbs.db', 'notes.txt~', 'v.swp']) expect(isJunkFile(junk)).toBe(true);
    for (const ok of ['Report.docx', 'part list.xlsx', 'Party.pdf', 'temp plan.docx']) expect(isJunkFile(ok)).toBe(false);
  });

  it('groups by file id, and words the access levels', () => {
    const l = (id: number, file_id: number) => ({ id, token: '', visibility: 'public', expires_at: null, downloads_used: 0, file_id, name: 'Same.pdf', extension: 'pdf', size: 1 });
    expect(groupShares([l(1, 5), l(2, 6), l(3, 5)]).map((g) => [g.fileId, g.links.length])).toEqual([
      [5, 2],
      [6, 1],
    ]);
    expect(accessLabel('password')).toBe('Anybody with the password');
    expect(accessLabel('private')).toBe('Named people');
  });
});
