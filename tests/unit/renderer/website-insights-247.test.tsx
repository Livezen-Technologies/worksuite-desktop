// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * worksuite-desktop#247 "Website chats → Insights shows 'Not found' and no data": a server without the report (404)
 * says it needs updating, no permission (403) says so, any other failure gives its cause, the request's id, Retry and
 * Copy details; a period without chats is an empty state over empty charts; All widgets sends no widget at all; and a
 * newer server's by-widget table, start pages and busiest hours are drawn.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: true,
  hasDesktop: () => true,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { failureDetails, insightsFailure, WebsiteInsights, type Insights } from '../../../src/modules/chat/website/Insights';

const zeros = (): number[][] => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

const EMPTY: Insights = {
  period: '7d', since: '2026-09-29 00:00:00', until: '2026-10-05 12:00:00', widget_id: null,
  widgets: [{ id: 1, name: 'techubiz.com' }, { id: 2, name: 'techhub.com.lk' }],
  conversations: { value: 0, previous: 0 },
  first_response: { value: null, previous: null },
  resolution: { value: null, previous: null },
  rating: { value: null, rated: 0, previous: null },
  missed: { value: 0, share: null, previous: 0 },
  visitors: { value: 0, returning: 0, returning_share: null },
  days: ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((date) => ({ date, answered: 0, missed: 0 })),
  sources: [],
  devices: [{ name: 'desktop', count: 0, share: 0 }, { name: 'mobile', count: 0, share: 0 }, { name: 'tablet', count: 0, share: 0 }],
  agents: [],
  join_median_seconds: null,
  by_widget: [],
  start_pages: [],
  hours: zeros(),
  timezone: 'Asia/Colombo',
};

let client: QueryClient;
const show = (ui: ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
const failWith = (e: Error) => vi.mocked(apiGet).mockRejectedValue(e);
const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(apiGet).mockReset();
  vi.mocked(call).mockClear();
  vi.mocked(toast).mockReset();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => cleanup());

describe('#247 · a server without Insights (404)', () => {
  it('says the server needs updating, offers the web, and does not export', async () => {
    failWith(new ApiError(404, 'Not found', null));
    show(<WebsiteInsights period="7d" widget={null} onChange={vi.fn()} />);
    expect(await screen.findByText('Insights needs a newer WorkSuite server (Communication 1.41 or later).')).toBeTruthy();
    expect(screen.getByText('Ask your administrator to update.')).toBeTruthy();
    expect(screen.queryByText('Not found')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Open Reports on the web' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/website-chats' });
  });
});

describe('#247 · no permission (403)', () => {
  it('says so, not "Not found"', async () => {
    failWith(new ApiError(403, 'Missing permission: chat.widget.view', null));
    show(<WebsiteInsights period="30d" widget={null} onChange={vi.fn()} />);
    expect(await screen.findByText("You don't have access to Website chat reports")).toBeTruthy();
    expect(screen.getByText('Ask an admin.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('#247 · a real failure (500)', () => {
  it('shows the cause, the server’s message and the request id, retries, and copies the details', async () => {
    failWith(new ApiError(500, "Couldn't build the Insights report on the server.", null, null, '9f3c2a7b1d4e6f80'));
    show(<WebsiteInsights period="7d" widget={2} onChange={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText("Couldn't load Insights (server error)")).toBeTruthy();
    expect(within(alert).getByText("Couldn't build the Insights report on the server.")).toBeTruthy();
    expect(within(alert).getByText('Request ID: 9f3c2a7b1d4e6f80')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(alert).getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Details copied.'));
    const copied = String((writeText.mock.calls[0] as unknown[])[0]);
    expect(copied).toContain("Couldn't load Insights (server error)");
    expect(copied).toContain('Request: GET /api/chat/widget-admin/insights?period=7d&widget_id=2');
    expect(copied).toContain('Status: 500');
    expect(copied).toContain('Request ID: 9f3c2a7b1d4e6f80');

    vi.mocked(apiGet).mockResolvedValue(EMPTY);
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Figures' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('words the cause of each kind of failure, and copes without a request id', () => {
    expect(insightsFailure(new ApiError(502, 'Bad gateway', null))).toMatchObject({ kind: 'error', cause: 'server error', requestId: null });
    expect(insightsFailure(new ApiError(0, 'unreachable', 'NETWORK_UNREACHABLE'))).toMatchObject({ kind: 'error', cause: 'no connection' });
    expect(insightsFailure(new ApiError(422, 'Bad period', null))).toMatchObject({ kind: 'error', cause: 'error 422' });
    expect(insightsFailure(new Error('boom'))).toMatchObject({ kind: 'error', cause: 'request failed', status: 0, message: 'boom' });
    const f = insightsFailure(new ApiError(500, 'x', null));
    expect(f.kind === 'error' && failureDetails(f, 'all', null)).toContain('Request ID: none sent by the server');
    expect(f.kind === 'error' && failureDetails(f, 'all', null)).toContain('insights?period=all\n');
  });
});

describe('#247 · a period without chats', () => {
  it('is an empty state over empty charts, not an error', async () => {
    vi.mocked(apiGet).mockResolvedValue(EMPTY);
    show(<WebsiteInsights period="7d" widget={null} onChange={vi.fn()} />);
    const empty = await screen.findByText('No chats in this period');
    expect(empty.closest('[role="status"]')?.textContent).toBe('No chats in this periodTry a longer period or another widget.');
    expect(screen.queryByRole('alert')).toBeNull();
    // The figures are zeros and dashes, the chart has its seven empty days, the tables say there is nothing.
    const tiles = within(screen.getByRole('list', { name: 'Figures' })).getAllByRole('listitem');
    expect(tiles.map((t) => t.textContent)).toEqual(['Conversations0', 'Avg first response—', 'Avg resolution—', 'Avg rating—from 0 rated', 'Missed0', 'Visitors0']);
    expect(within(screen.getByRole('region', { name: 'Conversations per day' })).getAllByRole('listitem', { name: /answered/ })).toHaveLength(7);
    expect(screen.getByText('No visitors in this period.')).toBeTruthy();
    expect(screen.getByText('No widget had chats in this period.')).toBeTruthy();
    expect(screen.getByText('No pages recorded in this period.')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Chats by weekday and hour' })).getAllByRole('cell')).toHaveLength(7 * 24);
  });
});

describe('#247 · All widgets', () => {
  it('sends no widget filter at all, and exports without one', async () => {
    vi.mocked(apiGet).mockResolvedValue(EMPTY);
    show(<WebsiteInsights period="30d" widget={null} onChange={vi.fn()} />);
    await screen.findByRole('list', { name: 'Figures' });
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/insights', { period: '30d' }, expect.anything());
    const query = vi.mocked(apiGet).mock.calls[0]![1] as Record<string, unknown>;
    expect('widget_id' in query).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(call).toHaveBeenCalledWith('transfers:download', expect.objectContaining({ websiteInsights: { period: '30d' } }));
  });

  it('one widget sends its id', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...EMPTY, widget_id: 1 });
    const onChange = vi.fn();
    show(<WebsiteInsights period="7d" widget={1} onChange={onChange} />);
    await screen.findByRole('list', { name: 'Figures' });
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/insights', { period: '7d', widget_id: 1 }, expect.anything());
  });
});

describe('#247 · by widget, start pages and busiest hours', () => {
  it('draws them when the server sends them', async () => {
    const hours = zeros();
    hours[1]![14] = 6;
    hours[1]![15] = 2;
    hours[4]![10] = 3;
    vi.mocked(apiGet).mockResolvedValue({
      ...EMPTY,
      conversations: { value: 11, previous: 4 },
      by_widget: [
        { id: 1, name: 'techubiz.com', conversations: 8, missed: 1, first_response_seconds: 42, rating: 4.5 },
        { id: 2, name: 'techhub.com.lk', conversations: 3, missed: 0, first_response_seconds: null, rating: null },
      ],
      start_pages: [{ page: 'techubiz.com/pricing', count: 7, share: 64 }, { page: 'techubiz.com/contact', count: 4, share: 36 }],
      hours,
    });
    show(<WebsiteInsights period="7d" widget={null} onChange={vi.fn()} />);
    const table = await screen.findByRole('table', { name: 'By widget' });
    expect(screen.queryByText('No chats in this period')).toBeNull();
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual(['WidgetChatsMissedFirst replyRating', 'techubiz.com810:424.5', 'techhub.com.lk30——']);
    expect(within(screen.getByRole('list', { name: 'Top start pages' })).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['techubiz.com/pricing64%', 'techubiz.com/contact36%']);
    const busiest = screen.getByRole('region', { name: 'Busiest hours' });
    expect(within(busiest).getByText('Busiest: Tue 14:00')).toBeTruthy();
    expect(within(busiest).getByRole('cell', { name: 'Tue 14:00: 6 chats' })).toBeTruthy();
    expect(within(busiest).getByText('Times in Asia/Colombo.')).toBeTruthy();
  });

  it('leaves them out for one widget, and for an older server that does not send them', async () => {
    const { by_widget: _w, start_pages: _p, hours: _h, timezone: _z, ...older } = { ...EMPTY, conversations: { value: 2, previous: 1 } };
    vi.mocked(apiGet).mockResolvedValue(older);
    show(<WebsiteInsights period="7d" widget={null} onChange={vi.fn()} />);
    await screen.findByRole('list', { name: 'Figures' });
    expect(screen.queryByRole('table', { name: 'By widget' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Busiest hours' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Top start pages' })).toBeNull();
    cleanup();

    vi.mocked(apiGet).mockResolvedValue({ ...EMPTY, widget_id: 1, by_widget: [{ id: 1, name: 'techubiz.com', conversations: 0, missed: 0, first_response_seconds: null, rating: null }] });
    show(<WebsiteInsights period="7d" widget={1} onChange={vi.fn()} />);
    await screen.findByRole('list', { name: 'Figures' });
    expect(screen.queryByRole('table', { name: 'By widget' })).toBeNull();
  });
});
