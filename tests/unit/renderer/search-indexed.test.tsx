// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import type * as CoreApi from '../../../src/core/api';

/**
 * Search on the server's index (#57): the words marked wherever they start a
 * word, the snippet that shows why, the filters sent to the server, and an
 * index still being built said rather than passed off as "no results".
 */
Element.prototype.scrollIntoView ??= vi.fn();
const apiGet = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: (...a: unknown[]) => apiGet(...a) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => []),
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));

const { call } = await import('../../../src/core/bridge');
const { setLanguage } = await import('../../../src/core/i18n');
const { app } = await import('../../../src/core/app-state');
const { SearchOverlay, markWords, searchFileIcon } = await import('../../../src/app/overlays/SearchOverlay');

const answer = (over: Record<string, unknown> = {}) => ({
  results: [
    {
      group: 'Notes',
      key: 'notes',
      items: [
        { id: 4, title: 'Solar budget', subtitle: null, route: '/notes?note=4', at: null },
        { id: 9, title: 'Weekly notes', subtitle: null, route: '/notes?note=9', at: null, snippet: '…we discussed the solar budget at length…' },
      ],
    },
  ],
  terms: ['solar'],
  index: { state: 'ready', progress: 1, building: [] },
  companies: [],
  ...over,
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SearchOverlay mode="search" />
    </QueryClientProvider>,
  );
  return client;
}

const type = (q: string) => fireEvent.change(screen.getByLabelText('Search WorkSuite'), { target: { value: q } });
const lastParams = () => apiGet.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
  apiGet.mockReset();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue([] as never);
  apiGet.mockResolvedValue(answer());
  app.set({ auth: null, bootstrap: null, apps: visibleApps({ apps: ['notes', 'mail', 'chat'], permissions: [] }), status: { network: 'ONLINE' } as never });
});
afterEach(() => { cleanup(); setLanguage('en'); });

describe('marking the words', () => {
  it('marks every word that starts with a term, whole, and keeps Sinhala vowel signs inside the word', () => {
    expect(markWords('Solar budget for solaris', ['solar'])).toEqual([
      { text: 'Solar', match: true },
      { text: ' budget for ', match: false },
      { text: 'solaris', match: true },
    ]);
    expect(markWords('தமிழ் மொழி', ['தமிழ்']).find((p) => p.match)?.text).toBe('தமிழ்');
    expect(markWords('the consolar', ['solar']).some((p) => p.match)).toBe(false);
    expect(markWords('ශ්‍රී ලංකාව', ['ලංකා']).find((p) => p.match)?.text).toBe('ලංකාව');
  });
});

describe('search on the index (#57)', () => {
  it('hides old results immediately and aborts an outdated query before the next debounce', async () => {
    show();
    type('solar');
    await screen.findAllByText('Solar', { exact: false });
    const signal = apiGet.mock.calls.at(-1)?.[2] as AbortSignal;
    type('different');
    expect(screen.queryByText('Solar', { exact: false })).toBeNull();
    expect(screen.queryByText('Weekly notes')).toBeNull();
    // An already completed request need not be aborted; cancellation is exercised below.
    expect(signal).toBeInstanceOf(AbortSignal);
    apiGet.mockImplementation(() => new Promise(() => {}));
    await waitFor(() => expect(lastParams().q).toBe('different'));
    const pending = apiGet.mock.calls.at(-1)?.[2] as AbortSignal;
    type('replacement');
    await waitFor(() => expect(pending.aborted).toBe(true));
  });

  it('does not reuse another user or previous bootstrap results', async () => {
    show();
    type('solar');
    await screen.findByText('Weekly notes');
    apiGet.mockImplementation(() => new Promise(() => {}));
    act(() => app.set({ auth: { user: { id: 99 }, server: { origin: 'https://other.example' } } as never }));
    expect(screen.queryByText('Weekly notes')).toBeNull();
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    apiGet.mockResolvedValue(answer());
    act(() => app.set({ apps: [...app.get().apps] }));
    await screen.findByText('Weekly notes');
    apiGet.mockImplementation(() => new Promise(() => {}));
    act(() => app.set({ bootstrap: {} as never }));
    expect(screen.queryByText('Weekly notes')).toBeNull();
  });

  it('hides cached offline content when returning online', async () => {
    vi.mocked(call).mockResolvedValue([{ module: 'notes', route: '/notes?note=8', title: 'Offline budget', subtitle: 'Saved note', cachedAt: new Date().toISOString() }] as never);
    app.set({ status: { network: 'OFFLINE' } as never });
    show();
    type('budget');
    await screen.findByText('Offline budget');
    apiGet.mockImplementation(() => new Promise(() => {}));
    act(() => app.set({ status: { network: 'ONLINE' } as never }));
    expect(screen.queryByText('Offline budget')).toBeNull();
  });

  it('shows the snippet with the words marked, in the list and the preview', async () => {
    show();
    type('solar');

    expect(await screen.findAllByText('…we discussed the', { exact: false })).toBeTruthy();
    const marks = [...document.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toContain('Solar');
    expect(marks).toContain('solar');
  });

  it('sends the group in view, the date, "mine" and the company to the server', async () => {
    apiGet.mockResolvedValue(
      answer({
        companies: [
          { id: 1, name: 'Livezen' },
          { id: 2, name: 'Asterix' },
        ],
      }),
    );
    show();
    type('solar');
    await screen.findByRole('tab', { name: /Notes/ });

    fireEvent.click(screen.getByRole('tab', { name: /Notes/ }));
    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'solar', types: 'Notes' }));

    fireEvent.click(screen.getByRole('combobox', { name: 'Date Range' }));
    fireEvent.click(screen.getByRole('option', { name: 'Past week' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Mine' }));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Company' }));
    fireEvent.click(screen.getByRole('option', { name: 'Asterix' }));

    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'solar', types: 'Notes', owner: 'me', company: 2 }));
    expect(String(lastParams().from)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('says the index is still being built, so an empty answer is not read as "nothing there"', async () => {
    apiGet.mockResolvedValue(answer({ results: [], index: { state: 'building', progress: 0.42, building: ['Mail', 'Chat'] } }));
    show();
    type('quarterly');

    expect(await screen.findByText('Search is still indexing (42%).')).toBeTruthy();
    const status = document.querySelector('details')!;
    expect(status.open).toBe(false);
    fireEvent.click(status.querySelector('summary')!);
    expect(status.textContent).toContain('Mail, Chat');
    expect(screen.getByText(/still being built, so this may not be everything/)).toBeTruthy();
  });
});

describe('search details and responsive filters (#129)', () => {
  it('keeps the selected record and filters when refreshed results reorder', async () => {
    const client = show();
    type('solar');
    fireEvent.click(await screen.findByRole('option', { name: /Weekly notes/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Mine' }));
    await waitFor(() => expect(lastParams().owner).toBe('me'));
    await waitFor(() => expect(within(screen.getByLabelText('Preview')).getByText('Weekly notes')).toBeTruthy());
    const next = answer();
    next.results[0]!.items.reverse();
    apiGet.mockResolvedValue(next);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['search'] });
    });
    expect(screen.getByRole('option', { name: /Weekly notes/ }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByLabelText('Preview')).getByText('Weekly notes')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Mine' }).getAttribute('aria-checked')).toBe('true');
  });

  it('searches long company lists and keeps the chosen company during a pending update', async () => {
    apiGet.mockResolvedValue(answer({ companies: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Company ${i + 1}` })) }));
    show();
    type('solar');
    fireEvent.click(await screen.findByRole('combobox', { name: 'Company' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Company' }), { target: { value: 'Company 12' } });
    expect(screen.queryByRole('option', { name: 'Company 1' })).toBeNull();
    apiGet.mockImplementation(() => new Promise(() => {}));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search Company' }), { key: 'Enter' });
    await waitFor(() => expect(lastParams().company).toBe(12));
    expect(screen.getByRole('combobox', { name: 'Company' }).textContent).toContain('Company 12');
  });

  it('moves filters into More Filters and shows a details drawer with a way back on narrow windows', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
    show();
    type('solar');
    await screen.findByRole('option', { name: /Weekly notes/ });
    expect(screen.queryByRole('combobox', { name: 'Date Range' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More Filters' }));
    expect(screen.getByRole('combobox', { name: 'Date Range' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Weekly notes/ }));
    expect(screen.queryByRole('listbox', { name: 'Results' })).toBeNull();
    const back = screen.getByRole('button', { name: 'Back to Results' });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(screen.getByRole('listbox', { name: 'Results' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Weekly notes/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: /Weekly notes/ }));
    fireEvent.keyDown(screen.getByLabelText('Preview'), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('option', { name: /Weekly notes/ })));
  });

  it('shows complete filenames and permission-checked file facts without leaking the previous selection', async () => {
    app.set({ apps: visibleApps({ apps: ['drive'], permissions: ['files.view'] }) });
    const name = 'very-long-unbroken-filename-'.repeat(6) + '.xlsx';
    const pending = new Promise(() => {});
    apiGet.mockImplementation((path: string) => {
      if (path === '/api/files/4/details')
        return Promise.resolve({
          id: 4,
          extension: 'xlsx',
          size: 2048,
          company: { id: 1, name: 'Livezen' },
          location: [{ id: 7, name: 'Reports' }],
          modified_at: '2026-10-01',
          updated_at: null,
        });
      if (path === '/api/files/9/details') return pending;
      return Promise.resolve(
        answer({
          results: [
            {
              group: 'Files',
              key: 'files',
              items: [
                { id: 4, title: name, route: '/files?folder=7', subtitle: 'XLSX · 2 KB', at: null },
                { id: 9, title: 'Other.pdf', route: '/files', subtitle: 'PDF · 8 KB', at: null },
              ],
            },
          ],
        }),
      );
    });
    show();
    type('report');
    expect(await screen.findByText('Livezen')).toBeTruthy();
    const preview = screen.getByLabelText('Preview');
    expect(within(preview).getByTitle(name).textContent).toBe(name);
    expect(within(preview).getByText('Reports')).toBeTruthy();
    expect(within(preview).getByText('XLSX')).toBeTruthy();
    fireEvent.click(within(preview).getByRole('button', { name: 'New window' }));
    expect(call).toHaveBeenCalledWith('windows:open', { kind: 'record', route: '/files?folder=7&file=4', title: 'WorkSuite' });
    fireEvent.click(screen.getByRole('option', { name: /Other.pdf/ }));
    expect(within(screen.getByLabelText('Preview')).queryByText('Livezen')).toBeNull();
    expect(within(screen.getByLabelText('Preview')).getByText('PDF')).toBeTruthy();
  });
});


it.each([['invoice.pdf', 'file-text'], ['report.docx', 'file-text'], ['report.xlsx', 'file-sheet'], ['photo.jpg', 'file-image'], ['slides.pptx', 'board'], ['video.mp4', 'film'], ['backup.zip', 'archive'], ['unknown', 'file']])('uses the document kind for %s', (name, icon) => {
  expect(searchFileIcon(name)).toBe(icon);
});

it('updates filter labels when the interface language changes', async () => {
  show(); type('solar');
  await screen.findByRole('combobox', { name: 'Date Range' });
  act(() => setLanguage('si'));
  fireEvent.click(screen.getByRole('combobox', { name: 'දින පරාසය' }));
  expect(screen.getByRole('option', { name: 'පසුගිය සතිය' })).toBeTruthy();
});
