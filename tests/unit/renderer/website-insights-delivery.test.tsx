// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Insights › Delivery (WS-WCHAT OPS-04): the server's `delivery` section — sent, retried, deduplicated, re-synced,
 * emailed and not reaching staff per day — drawn as a table with the period's totals; nothing from an older server
 * (no field) or one before the migration (`installed` false).
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

import { apiGet } from '../../../src/core/api';
import { WebsiteInsights, type Insights, type InsightsDelivery } from '../../../src/modules/chat/website/Insights';

const DATES = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
const zero = { sent: 0, retried: 0, deduplicated: 0, resynced: 0, emailed: 0, not_reaching_staff: 0 };

const BASE: Insights = {
  period: '7d', since: '2026-09-29 00:00:00', until: '2026-10-05 12:00:00', widget_id: null,
  widgets: [{ id: 1, name: 'techubiz.com' }],
  conversations: { value: 3, previous: 0 },
  first_response: { value: null, previous: null },
  resolution: { value: null, previous: null },
  rating: { value: null, rated: 0, previous: null },
  missed: { value: 0, share: null, previous: 0 },
  visitors: { value: 0, returning: 0, returning_share: null },
  days: DATES.map((date) => ({ date, answered: 0, missed: 0 })),
  sources: [],
  devices: [],
  agents: [],
  join_median_seconds: null,
};

const DELIVERY: InsightsDelivery = {
  installed: true,
  from: '2026-09-29',
  to: '2026-10-05',
  days: DATES.map((date) => ({ date, ...zero })).map((x) =>
    x.date === '2026-10-01' ? { ...x, sent: 40, retried: 3, deduplicated: 2, resynced: 1 } : x.date === '2026-10-05' ? { ...x, sent: 12, emailed: 1, not_reaching_staff: 2 } : x,
  ),
  totals: { sent: 52, retried: 3, deduplicated: 2, resynced: 1, emailed: 1, not_reaching_staff: 2 },
};

let client: QueryClient;
const show = (ui: ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
const cells = (row: HTMLElement) => [...within(row).getAllByRole('rowheader'), ...within(row).getAllByRole('cell')].map((c) => c.textContent);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(apiGet).mockReset();
});
afterEach(() => cleanup());

describe('Insights · delivery (OPS-04)', () => {
  it('draws the totals and each day that had any, newest first', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...BASE, delivery: DELIVERY });
    show(<WebsiteInsights period="7d" widget={null} onChange={vi.fn()} />);
    const table = await screen.findByRole('table', { name: 'Delivery per day' });
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Day', 'Sent', 'Retried', 'Deduplicated', 'Re-synced', 'Emailed', 'Not reaching staff']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(cells)).toEqual([
      ['Total', '52', '3', '2', '1', '1', '2'],
      ['5 Oct', '12', '0', '0', '0', '1', '2'],
      ['1 Oct', '40', '3', '2', '1', '0', '0'],
    ]);
    expect(screen.getByText('29 Sep – 5 Oct')).toBeTruthy();
  });

  it('says it covers all widgets when one widget is chosen', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...BASE, widget_id: 1, delivery: DELIVERY });
    show(<WebsiteInsights period="7d" widget={1} onChange={vi.fn()} />);
    expect(await screen.findByText('All widgets, 29 Sep – 5 Oct')).toBeTruthy();
  });

  it('says a quiet period had nothing counted', async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...BASE, delivery: { ...DELIVERY, days: DATES.map((date) => ({ date, ...zero })), totals: zero } });
    show(<WebsiteInsights period="7d" widget={null} onChange={vi.fn()} />);
    expect(await screen.findByText('No messages counted in this period.')).toBeTruthy();
  });

  it('is not drawn for an older server, or before the migration', async () => {
    vi.mocked(apiGet).mockResolvedValue(BASE);
    const { unmount } = show(<WebsiteInsights period="7d" widget={null} onChange={vi.fn()} />);
    expect(await screen.findByRole('list', { name: 'Figures' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Delivery' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Delivery per day' })).toBeNull();
    unmount();

    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(apiGet).mockResolvedValue({ ...BASE, delivery: { ...DELIVERY, installed: false } });
    show(<WebsiteInsights period="7d" widget={null} onChange={vi.fn()} />);
    expect(await screen.findByRole('list', { name: 'Figures' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Delivery per day' })).toBeNull();
  });
});
