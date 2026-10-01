// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import type * as CoreApi from '../../../src/core/api';

/**
 * Search on the server's index (#57): the words marked wherever they start a
 * word, the snippet that shows why, the filters sent to the server, and an
 * index still being built said rather than passed off as "no results".
 */
const apiGet = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: (...a: unknown[]) => apiGet(...a) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));

const { app } = await import('../../../src/core/app-state');
const { SearchOverlay, markWords } = await import('../../../src/app/overlays/SearchOverlay');

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
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SearchOverlay mode="search" />
    </QueryClientProvider>,
  );
}

const type = (q: string) => fireEvent.change(screen.getByLabelText('Search WorkSuite'), { target: { value: q } });
const lastParams = () => apiGet.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue(answer());
  app.set({ apps: visibleApps({ apps: ['notes', 'mail', 'chat'], permissions: [] }), status: { network: 'ONLINE' } as never });
});
afterEach(cleanup);

describe('marking the words', () => {
  it('marks every word that starts with a term, whole, and keeps Sinhala vowel signs inside the word', () => {
    expect(markWords('Solar budget for solaris', ['solar'])).toEqual([
      { text: 'Solar', match: true },
      { text: ' budget for ', match: false },
      { text: 'solaris', match: true },
    ]);
    expect(markWords('the consolar', ['solar']).some((p) => p.match)).toBe(false);
    expect(markWords('ශ්‍රී ලංකාව', ['ලංකා']).find((p) => p.match)?.text).toBe('ලංකාව');
  });
});

describe('search on the index (#57)', () => {
  it('shows the snippet with the words marked, in the list and the preview', async () => {
    show();
    type('solar');

    expect(await screen.findAllByText('…we discussed the', { exact: false })).toBeTruthy();
    const marks = [...document.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toContain('Solar');
    expect(marks).toContain('solar');
  });

  it('sends the group in view, the date, "mine" and the company to the server', async () => {
    apiGet.mockResolvedValue(answer({ companies: [{ id: 1, name: 'Livezen' }, { id: 2, name: 'Asterix' }] }));
    show();
    type('solar');
    await screen.findByRole('tab', { name: /Notes/ });

    fireEvent.click(screen.getByRole('tab', { name: /Notes/ }));
    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'solar', types: 'Notes' }));

    fireEvent.change(screen.getByLabelText('When'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Mine' }));
    fireEvent.change(await screen.findByLabelText('Company'), { target: { value: '2' } });

    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'solar', types: 'Notes', owner: 'me', company: 2 }));
    expect(String(lastParams().from)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('says the index is still being built, so an empty answer is not read as "nothing there"', async () => {
    apiGet.mockResolvedValue(answer({ results: [], index: { state: 'building', progress: 0.42, building: ['Mail', 'Chat'] } }));
    show();
    type('quarterly');

    expect(await screen.findByText(/Search is still indexing \(42%\)\. Mail, Chat are searched the slower way/)).toBeTruthy();
    expect(screen.getByText(/still being built, so this may not be everything/)).toBeTruthy();
  });
});
