// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn(async () => []) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = vi.hoisted(() => ({ route: '/social-media/analytics', go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { route: tab.route, query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), openInWindow: vi.fn(), active: true, openLink: vi.fn(), setTitle: vi.fn(), tabId: 't1' };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import SocialMediaPage from '../../../src/modules/social-media/SocialMediaPage';
import { campaigns, heatmap, library, overview, socialAnswer } from './social-fixtures';

/**
 * Analytics, Content library and Campaigns (W07–W09): numbers as measured and "Not measured" where they are not
 * (WF-12), the heat map, the never-silently-summed notice (SMM-ANL-008), reuse of library media (SMM-MED-007) and a
 * campaign's UTM tags (SMM-CPG-002), on a server with the module and on today's.
 */

type Answer = (path: string, query?: Record<string, unknown>) => Promise<unknown>;

/** The design's server, with some routes answered differently. */
function serve(overrides: Record<string, unknown> = {}, offered = true): void {
  const base = socialAnswer(offered) as Answer;
  vi.mocked(apiGet).mockImplementation((async (path: string, query?: Record<string, unknown>) => (path in overrides ? overrides[path] : base(path, query))) as never);
}

function mount(route: string) {
  tab.route = route;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SocialMediaPage tabId="t1" route={route} active />
    </QueryClientProvider>,
  );
}

let go: ReturnType<typeof vi.fn>;

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never });
  go = vi.fn();
  tab.go = go as never;
});
afterEach(() => cleanup());

describe('W07 Analytics', () => {
  it('shows the KPIs, and a metric the server could not measure as “Not measured”, never 0', async () => {
    serve({ '/api/social-media/analytics/overview': { ...overview, kpis: { ...overview.kpis, impressions: { value: null, delta: null } } } });
    mount('/social-media/analytics');
    expect(await screen.findByText('48,215')).toBeTruthy();
    expect(screen.getByText('412k')).toBeTruthy();
    expect(screen.getByText('4.6%')).toBeTruthy();
    expect(screen.getByText('38 min')).toBeTruthy();
    const impressions = screen.getByText('Impressions').parentElement!;
    expect(within(impressions).getByText('Not measured')).toBeTruthy();
    expect(within(impressions).queryByText('0')).toBeNull();
    // A shorter reply time is the better change: green.
    expect(screen.getByText('−12 min').className).toContain('text-success');
    expect(screen.getByText('+18%').className).toContain('text-success');
  });

  it('draws the trend with a summary and the series as a table', async () => {
    serve();
    mount('/social-media/analytics');
    const chart = await screen.findByRole('img', { name: /Reach and engagements per day from 6 Sep to 5 Oct/ });
    expect(chart.querySelectorAll('path').length).toBe(2);
    const table = screen.getByRole('table', { name: 'Reach and engagements per day' });
    expect(within(table).getAllByRole('row').length).toBe(31);
  });

  it('draws the heat map with seven labelled weekday rows, hatching hours without enough data', async () => {
    const cells = heatmap.cells.map((r) => [...r]);
    cells[6]![9] = null;
    serve({ '/api/social-media/analytics/heatmap': { ...heatmap, cells } });
    mount('/social-media/analytics');
    const map = await screen.findByRole('table', { name: 'Engagement per post by weekday and hour' });
    expect(
      within(map)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['MonMonday', 'TueTuesday', 'WedWednesday', 'ThuThursday', 'FriFriday', 'SatSaturday', 'SunSunday']);
    expect(within(map).getAllByTitle('Not enough data').length).toBe(1);
    expect(within(map).getByLabelText('Thursday 10:00: 0.1 engagements per post · a best time').className).toContain('outline-primary');
    expect(screen.getByText(/last 90 days, Asia\/Colombo\)\. Used to suggest queue slots\./)).toBeTruthy();
  });

  it('says that metrics defined differently per network are not added up, and gives each definition on the heading', async () => {
    serve();
    mount('/social-media/analytics');
    expect(await screen.findByText('Reach is defined differently by each network, so it is shown per account and not added up.')).toBeTruthy();
    const byAccount = screen.getByRole('heading', { name: 'By account' }).closest('section')!;
    const reachHead = within(byAccount)
      .getAllByRole('columnheader')
      .find((h) => h.textContent === 'Reach')!;
    expect(reachHead.querySelector('[title]')!.getAttribute('title')).toMatch(/^Facebook: .*\nInstagram: .*\nX: X reports impressions only/);
  });

  it('exports as PDF and says the export is being prepared', async () => {
    serve();
    vi.mocked(apiPost).mockResolvedValue({ job_id: 4 } as never);
    mount('/social-media/analytics');
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /PDF/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/analytics/export', expect.objectContaining({ format: 'pdf', from: expect.any(String), to: expect.any(String) })));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', "Your export is being prepared — you'll get a notification when it's ready."));
  });

  it('offers export and scheduled reports only to those allowed to export', async () => {
    app.set({ bootstrap: { permissions: ['social.view', 'social.analytics.view'] } as never });
    serve();
    mount('/social-media/analytics');
    expect(await screen.findByText('48,215')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Schedule report' })).toBeNull();
  });

  it('opens a post from the Posts tab', async () => {
    serve();
    mount('/social-media/analytics');
    fireEvent.click(await screen.findByRole('tab', { name: 'Posts' }));
    fireEvent.click(await screen.findByText('Customer story — Ceylon Freight on WorkSuite Fleet'));
    expect(go).toHaveBeenCalledWith('/social-media/posts/107');
  });

  it('on today’s server keeps its tabs and panels, each saying what is not offered', async () => {
    serve({}, false);
    mount('/social-media/analytics');
    expect(await screen.findByRole('tab', { name: 'Inbox & response' })).toBeTruthy();
    expect(await screen.findByText(/The engagement heat map isn’t offered by this WorkSuite server yet/)).toBeTruthy();
    expect(screen.getByText(/Results by account isn’t offered/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Reach and engagements' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Audience' }));
    expect(await screen.findByText(/Audience analytics isn’t offered/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Competitors' }));
    expect(screen.getByText('Competitor benchmarks arrive in a later phase (SMM-ANL-010)')).toBeTruthy();
  });
});

describe('W08 Content library', () => {
  it('shows the counts, the selected file’s details, and starts a post with its file', async () => {
    serve();
    mount('/social-media/library');
    expect(await screen.findByRole('tab', { name: 'Media (148)' })).toBeTruthy();
    expect(await screen.findByText('Drive › Marketing › Social')).toBeTruthy();
    expect((screen.getByLabelText(/^Alt text/) as HTMLInputElement).value).toBe('WorkSuite 3.2 desktop window on a desk');
    fireEvent.click(screen.getByRole('button', { name: 'Use in new post' }));
    expect(go).toHaveBeenCalledWith('/social-media/compose?file=9001');
  });

  it('blocks reuse of a file whose licence expired', async () => {
    const expired = { ...library[0]!, media: { ...library[0]!.media!, licence_expired: true } };
    serve({ '/api/social-media/library': { items: [expired], counts: { media: 1 } } });
    mount('/social-media/library');
    expect((await screen.findAllByText('Expired licence')).length).toBe(1);
    expect((screen.getByRole('button', { name: 'Use in new post' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('on today’s server keeps its chrome and says the library is not offered', async () => {
    serve({}, false);
    mount('/social-media/library');
    expect(await screen.findByRole('button', { name: 'Add from Drive' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Search file names, tags, alt text')).toBeTruthy();
    expect(await screen.findByText(/Hashtag sets isn’t offered/)).toBeTruthy();
    expect(screen.getByText('Media live in WorkSuite Drive; the library is a view with social metadata, not a second file store.')).toBeTruthy();
  });
});

describe('W09 Campaigns', () => {
  it('lists campaigns as the design writes them, and opens one', async () => {
    serve();
    mount('/social-media/campaigns');
    expect(await screen.findByText('01 Oct – 31 Oct')).toBeTruthy();
    expect(screen.getByText('Ongoing')).toBeTruthy();
    expect(screen.getByText('24 · 9 published')).toBeTruthy();
    expect(screen.getByText('41 leads')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Studio stories' }));
    expect(go).toHaveBeenCalledWith('/social-media/campaigns/2');
  });

  it('saves the campaign’s UTM tags', async () => {
    serve();
    vi.mocked(apiPut).mockResolvedValue({ campaign: campaigns[0] } as never);
    mount('/social-media/campaigns/1');
    const utm = (await screen.findByLabelText('utm_campaign')) as HTMLInputElement;
    expect(utm.value).toBe('ws32-launch');
    fireEvent.change(utm, { target: { value: 'ws32-october' } });
    fireEvent.change(screen.getByLabelText('utm_medium'), { target: { value: 'organic-social' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/social-media/campaigns/1', expect.objectContaining({ utm: { campaign: 'ws32-october', medium: 'organic-social' }, short_domain: 'wks.lk' })));
    expect(screen.getByText('214,600')).toBeTruthy();
    expect(screen.getByText('Link clicks (wks.lk)')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Share campaign for review' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows results the server did not measure as “Not measured”', async () => {
    serve();
    mount('/social-media/campaigns/2');
    expect(await screen.findByRole('heading', { name: 'Results so far' })).toBeTruthy();
    expect((await screen.findAllByText('Not measured')).length).toBe(3);
  });

  it('creates a campaign with utm_medium “social” by default', async () => {
    serve();
    vi.mocked(apiPost).mockResolvedValue({ campaign: { ...campaigns[2]!, id: 9 } } as never);
    mount('/social-media/campaigns');
    fireEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Year-end offer' } });
    fireEvent.change(within(dialog).getByLabelText('utm_campaign'), { target: { value: 'year-end' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/campaigns', expect.objectContaining({ name: 'Year-end offer', utm: { campaign: 'year-end', medium: 'social' } })));
    await waitFor(() => expect(go).toHaveBeenCalledWith('/social-media/campaigns/9'));
  });

  it('hides New campaign from those who may not manage campaigns, and degrades on today’s server', async () => {
    app.set({ bootstrap: { permissions: ['social.view'] } as never });
    serve({}, false);
    mount('/social-media/campaigns');
    expect(await screen.findByText(/Campaigns isn’t offered by this WorkSuite server yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New campaign' })).toBeNull();
  });
});
