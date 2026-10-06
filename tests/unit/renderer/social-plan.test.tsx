// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn(async () => []) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/social-media', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { route: tab.route, query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), openInWindow: vi.fn(), active: true, openLink: vi.fn(), setTitle: vi.fn(), tabId: 't1' };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import { scope } from '../../../src/modules/social-media/parts';
import Calendar from '../../../src/modules/social-media/screens/Calendar';
import Overview from '../../../src/modules/social-media/screens/Overview';
import Queue from '../../../src/modules/social-media/screens/Queue';
import { NOW, posts, socialAnswer } from './social-fixtures';

/**
 * W01 Overview, W03 Calendar and W04 Queue against the design's sample server (Tue 6 Oct 2026, 10:00 in Colombo)
 * and today's server without the module.
 */
function mount(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** A DataTransfer for HTML5 drag and drop in jsdom, shared by dragstart and drop like the browser's. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    data,
    dropEffect: 'none',
    effectAllowed: 'all',
    get types() {
      return [...data.keys()];
    },
    setData: (k: string, v: string) => void data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  setRegional({ timezone: 'Asia/Colombo' });
  app.set({ bootstrap: { permissions: ['*'] } as never });
  scope.set({ brandId: null });
  tab.go = vi.fn();
  vi.mocked(apiGet).mockImplementation(socialAnswer(true) as never);
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPut).mockReset();
  vi.mocked(toast).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('W01 Overview', () => {
  it('names the accounts that need attention', async () => {
    tab.route = '/social-media';
    mount(<Overview />);
    const banner = await screen.findByText(/accounts need attention/);
    const text = banner.closest('[role="status"]')!.textContent!;
    expect(text).toContain('2 accounts need attention.');
    expect(text).toContain('X @techhubiz needs to be reconnected — 1 post is on hold.');
    expect(text).toContain('Instagram @creativefx.studio access expires in 3 days.');
    fireEvent.click(screen.getByRole('button', { name: 'Review accounts' }));
    expect(tab.go).toHaveBeenCalledWith('/social-media/accounts');
  });

  it('lists the next 7 days in time order and opens a post', async () => {
    tab.route = '/social-media';
    mount(<Overview />);
    const list = await screen.findByRole('list', { name: 'Coming up' });
    const rows = within(list).getAllByRole('button');
    const expected = [
      ['Today 16:30', 'WorkSuite 3.2 is here'],
      ['Today 18:00', 'Thread: 5 things'],
      ['Tomorrow 10:30', 'Carousel'],
      ['Tomorrow 12:00', 'Video — Setting up'],
      ['Thu 09:00', 'We are hiring'],
    ];
    expect(rows).toHaveLength(expected.length);
    rows.forEach((r, i) => {
      expect(r.textContent).toContain(expected[i]![0]);
      expect(r.textContent).toContain(expected[i]![1]);
    });
    expect(rows.some((r) => r.textContent!.includes('Customer story'))).toBe(false); // published last week
    fireEvent.click(rows[2]!);
    expect(tab.go).toHaveBeenCalledWith('/social-media/posts/103');
  });

  it('shows the waiting counts and top posts, and Create post only with social.post.create', async () => {
    tab.route = '/social-media';
    app.set({ bootstrap: { permissions: ['social.view', 'social.post.approve', 'social.inbox.view'] } as never });
    mount(<Overview />);
    expect(await screen.findByRole('button', { name: /Posts to approve\s*4/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Messages assigned to you\s*6/ })).toBeTruthy();
    expect(await screen.findByText('Launch teaser — WorkSuite Desktop offline mode')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create post' })).toBeNull();
  });
});

describe('W03 Calendar', () => {
  const cell = (ymd: string) => document.querySelector(`[data-day="${ymd}"]`) as HTMLElement;

  it('places posts on their day in the viewer’s zone', async () => {
    tab.route = '/social-media/calendar?view=month&date=2026-10-01';
    mount(<Calendar />);
    expect(await screen.findByRole('heading', { level: 2, name: 'October 2026' })).toBeTruthy();
    await waitFor(() => expect(within(cell('2026-10-07')).getByRole('button', { name: /10:30 Carousel/ })).toBeTruthy());
    expect(within(cell('2026-10-06')).getByRole('button', { name: /16:30 WorkSuite 3.2/ })).toBeTruthy();
    expect(within(cell('2026-10-02')).getByRole('button', { name: /09:30 Customer story/ })).toBeTruthy();
    expect(within(cell('2026-10-06')).queryByRole('button', { name: /Carousel/ })).toBeNull();
    // Drafts without a time are in Unscheduled, not on the grid.
    const drafts = screen.getByRole('list', { name: 'Unscheduled drafts' });
    expect(within(drafts).getByText(/Partner spotlight/)).toBeTruthy();
  });

  it('refuses to move a published post', async () => {
    tab.route = '/social-media/calendar?view=month&date=2026-10-01';
    mount(<Calendar />);
    const chip = await within(cell('2026-10-02')).findByRole('button', { name: /Customer story/ });
    const dt = dataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    fireEvent.dragOver(cell('2026-10-08'), { dataTransfer: dt });
    fireEvent.drop(cell('2026-10-08'), { dataTransfer: dt });
    expect(toast).toHaveBeenCalledWith('warning', expect.stringMatching(/Already publishing or published/));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('moves a scheduled post to another day at the same time and says when it goes back to review', async () => {
    vi.mocked(apiPost).mockResolvedValue({ post: { ...posts[0]!, status: 'in_review' } });
    tab.route = '/social-media/calendar?view=month&date=2026-10-01';
    mount(<Calendar />);
    const chip = await within(cell('2026-10-06')).findByRole('button', { name: /WorkSuite 3.2/ });
    const dt = dataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    fireEvent.drop(cell('2026-10-08'), { dataTransfer: dt });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/posts/101/schedule', { mode: 'at', at: '2026-10-08T11:00:00.000Z', timezone: 'Asia/Colombo' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', 'Moved — it goes back to review because the approval policy asks for it'));
  });

  it('queues an unscheduled draft dropped on a day', async () => {
    vi.mocked(apiPost).mockResolvedValue({ post: { ...posts[8]!, status: 'queued' } });
    tab.route = '/social-media/calendar?view=month&date=2026-10-01';
    mount(<Calendar />);
    const draft = await screen.findByRole('button', { name: /Partner spotlight/ });
    const dt = dataTransfer();
    fireEvent.dragStart(draft, { dataTransfer: dt });
    fireEvent.drop(cell('2026-10-15'), { dataTransfer: dt });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/posts/109/schedule', { mode: 'queue', at: '2026-10-14T18:30:00.000Z', timezone: 'Asia/Colombo' }));
  });

  it('keeps the view and day in the route and hides statuses from the legend', async () => {
    tab.route = '/social-media/calendar?view=month&date=2026-10-01';
    mount(<Calendar />);
    await within(cell('2026-10-02')).findByRole('button', { name: /Customer story/ });
    fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(tab.go).toHaveBeenLastCalledWith('/social-media/calendar?view=week&date=2026-10-01');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(tab.go).toHaveBeenLastCalledWith('/social-media/calendar?view=month&date=2026-11-01');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Published' }));
    expect(within(cell('2026-10-02')).queryByRole('button', { name: /Customer story/ })).toBeNull();
    fireEvent.click(cell('2026-10-20'));
    expect(tab.go).toHaveBeenLastCalledWith('/social-media/compose?date=2026-10-20');
  });

  it('draws the D01 week grid', async () => {
    tab.route = '/social-media/calendar?view=week&date=2026-10-07';
    mount(<Calendar />);
    expect(await screen.findByRole('heading', { level: 2, name: '5 – 11 October 2026' })).toBeTruthy();
    expect(screen.getByText('Mon 05')).toBeTruthy();
    await waitFor(() => expect(within(cell('2026-10-07')).getByRole('button', { name: /12:00 Video/ })).toBeTruthy());
  });
});

describe('W04 Queue', () => {
  it('adds a slot and saves the week', async () => {
    vi.mocked(apiPut).mockResolvedValue({});
    tab.route = '/social-media/queue';
    mount(<Queue />);
    expect(await screen.findByRole('tab', { name: 'TechHubiz · all accounts' })).toBeTruthy();
    const sunday = await screen.findByRole('group', { name: 'Sun' });
    expect(within(sunday).getByText('No slots')).toBeTruthy();
    fireEvent.click(within(sunday).getByRole('button', { name: 'Add a slot on Sun' }));
    fireEvent.change(screen.getByLabelText('New slot on Sun'), { target: { value: '08:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add slot on Sun' }));
    expect(within(sunday).getByText('08:15')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const [path, body] = vi.mocked(apiPut).mock.calls[0]! as [string, { brand_id: number; slots: Array<{ weekday: number; local_time: string }>; min_gap_minutes: number }];
    expect(path).toBe('/api/social-media/queue/slots');
    expect(body.brand_id).toBe(1);
    expect(body.min_gap_minutes).toBe(90);
    expect(body.slots).toHaveLength(14);
    expect(body.slots).toContainEqual({ weekday: 7, local_time: '08:15', enabled: true });
  });

  it('lists the queue with the design’s summary and reorders it', async () => {
    vi.mocked(apiPost).mockResolvedValue({});
    tab.route = '/social-media/queue';
    mount(<Queue />);
    expect(await screen.findByText('Drag to reorder · 14 posts · fills slots until 31 Oct')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Next in queue' });
    expect(within(list).getAllByRole('listitem')[0]!.textContent).toContain('Tue 13 · 10:00');
    fireEvent.click(within(list).getByRole('button', { name: /Move “Webinar recap.*” down/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/queue/reorder', { brand_id: 1, target_ids: [15, 14, 16] }));
  });
});

describe('on today’s server', () => {
  for (const [name, el, title] of [
    ['Overview', <Overview key="o" />, 'Overview'],
    ['Calendar', <Calendar key="c" />, 'Calendar'],
    ['Queue', <Queue key="q" />, 'Queue & posting slots'],
  ] as const) {
    it(`draws ${name} and says what isn’t offered`, async () => {
      vi.mocked(apiGet).mockImplementation(socialAnswer(false) as never);
      tab.route = '/social-media';
      mount(el);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
      expect((await screen.findAllByText(/isn’t offered by this WorkSuite server/)).length).toBeGreaterThan(0);
    });
  }
});
