// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * V-01, Voice calls — live call, history, call details (X-UI-08; UX-CALL-01/02): the LIVE menu's Voice calls entry with
 * its amber count of calls on now; the view's heading, Calls / Call-backs, site and period; the green "On a call now"
 * banner with Open call; the six tiles; the list filtered All / Answered / Missed / Recorded with its six columns and
 * result chips; and the picked call's details — WHAT HAPPENED, RECORDING, CALL NOTES · STAFF ONLY, Open chat, Add note
 * and Call back.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })) }));
vi.mock('../../../src/modules/chat/website/WebsiteThread', () => ({ WebsiteThread: ({ id }: { id: string }) => <div>Thread {id}</div> }));
vi.mock('../../../src/modules/chat/website/widget/WidgetSettings', () => ({ WidgetSettings: () => <div>The widget settings</div> }));
const tab = { route: '/chat?view=website&section=calls', go: vi.fn(), active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: tab.active, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { conversationStamp, timeLabel } from '../../../src/core/time';
import { call } from '../../../src/core/bridge';
import type { WebsiteRow } from '../../../src/modules/chat/website/api';
import { stepWords, whenLabel, type VoiceCallDetails, type VoiceCallRow, type VoiceCallsPage } from '../../../src/modules/chat/website/VoiceCalls';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const row = (over: Partial<WebsiteRow>): WebsiteRow => ({
  id: 1, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: true, inactive: false, label: 'Visitor 1', visitor_name: null,
  email: null, country: null, browser: null, os: null, device: null, current_url: null, last_seen: null, status: 'open',
  is_offline: false, priority: 'normal', updated_at: ago(0), agent: null, assigned_to: null, started_at: null,
  last_visitor_at: null, waiting_since: null, at_risk: false, awaiting_reply: false, rating: null, is_starred: false, tags: null,
  ...over,
});
const callRow = (over: Partial<VoiceCallRow>): VoiceCallRow => ({
  id: 1, conversation_id: 11, widget_id: 1, visitor: 'Visitor 4F2A', visitor_label: 'Visitor 4F2A', city: 'Colombo', country: 'LK', site: 'techubiz.com',
  status: 'ended', result: 'answered', callback: false, requested_at: ago(10 * 60_000), answered_at: ago(10 * 60_000 - 12_000), ended_at: ago(3 * 60_000),
  answered_by: 7, answered_by_name: 'Nuwan', handled_by: ['Nuwan'], offered_by_name: null, wait: 12, duration: 408, recorded: false, ...over,
});
const CALLS: VoiceCallRow[] = [
  callRow({}),
  callRow({ id: 2, conversation_id: 12, visitor: 'Ravi Silva', status: 'missed', result: 'missed', callback: true, answered_by: null, answered_by_name: null, handled_by: [], wait: 60, duration: null }),
  callRow({ id: 3, conversation_id: 13, visitor: 'Visitor 7B19', city: 'Kandy', status: 'cancelled', result: 'cancelled', answered_by: null, answered_by_name: null, handled_by: [], wait: 21, duration: null }),
  callRow({ id: 4, conversation_id: 14, visitor: 'Anne · Acme Ltd', city: 'Kandy', result: 'transferred', handled_by: ['Nuwan', 'Kasun'], wait: 5, duration: 542 }),
];
const page = (over: Partial<VoiceCallsPage> = {}): VoiceCallsPage => ({
  installed: true, days: 7,
  live: [{ ...callRow({ id: 9, conversation_id: 19, visitor: 'Visitor 9C1E', city: 'Galle', status: 'active', result: 'live' }), since: ago(134_000), on: [{ user_id: 7, name: 'Nuwan' }] }],
  stats: { requested: 38, answered: 33, missed: 5, avg_wait: 14, avg_duration: 272, callbacks_open: 2 },
  sites: [{ widget_id: 1, site: 'techubiz.com' }, { widget_id: 2, site: 'shop.techubiz.com' }],
  calls: CALLS, total: 38, page: 1, per_page: 25, has_more: true,
  counts: { all: 38, answered: 33, missed: 5, recorded: 0 },
  ...over,
});
const t0 = new Date(Date.now() - 10 * 60_000);
const at = (s: number) => new Date(t0.getTime() + s * 1000).toISOString();
const details = (over: Partial<VoiceCallDetails> = {}): VoiceCallDetails => {
  const { callback: _cb, ...base } = callRow({});
  return {
    ...base, visitor_id: 4, email: null, phone: '+94 77 123 4567', page_url: 'https://techubiz.com/shop/adobe-creative-cloud', conversation_status: 'open',
    ended_by: 'visitor', ended_by_name: null,
    timeline: [
      { at: at(0), kind: 'pressed', page: 'https://techubiz.com/shop/adobe-creative-cloud', by_name: null },
      { at: at(1), kind: 'rang', names: ['Nuwan', 'Dilini'] },
      { at: at(12), kind: 'answered', names: ['Nuwan'], after: 12 },
      { at: at(148), kind: 'joined', names: ['Dilini'] },
      { at: at(408), kind: 'ended', by: 'visitor', by_name: null },
    ],
    recording: { state: 'off', url: null }, notes: 'Wants 5 seats, student studio.', callback: null, can: { note: true, call: true },
    ...over,
  };
};

let listPage: VoiceCallsPage | Error = page();
let one: VoiceCallDetails = details();
let convs: WebsiteRow[] = [];

function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations') return { conversations: convs, can: { view: true, reply: true, manage: false } };
    if (path === '/api/chat/widget-admin/visitors') return { visitors: [] };
    if (path === '/api/chat/widget-admin/missed/count') return { count: 0 };
    if (path === '/api/chat/widget-admin/callbacks/counts') return { todo: 2, overdue: 0, mine: 0 };
    if (path === '/api/chat/widget-admin/calls') {
      if (listPage instanceof Error) throw listPage;
      return listPage;
    }
    if (path.startsWith('/api/chat/widget-admin/calls/')) return { ...one, id: Number(path.split('/').pop()) };
    throw new Error(`unexpected ${path}`);
  }) as never);
  const state: WebchatRingState = { chats: [], handoffs: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };
  vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state : null)) as never);
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const view = () => screen.getByRole('main', { name: 'Voice calls' });
const aside = () => screen.getByRole('complementary', { name: 'Call details' });
/** The details, once they are on screen. */
const details$ = () => screen.findByRole('complementary', { name: 'Call details' });
const callsAsked = () => vi.mocked(apiGet).mock.calls.filter(([p]) => p === '/api/chat/widget-admin/calls').map(([, q]) => q as Record<string, string>);

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  listPage = page();
  one = details();
  convs = [];
  tab.route = '/chat?view=website&section=calls';
  tab.go.mockReset();
  vi.mocked(apiGet).mockClear();
  vi.mocked(apiPost).mockClear();
  app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
  serve();
});
afterEach(() => cleanup());

describe('the menu (C-01, DsWsNav)', () => {
  it('lists Voice calls under LIVE with an amber count of the calls ringing or on now', async () => {
    tab.route = '/chat?view=website&section=inbox';
    convs = [row({ id: 1, call: { status: 'active', since: ago(60_000) } }), row({ id: 2, call: { status: 'ringing', since: ago(5_000) } }), row({ id: 3 })];
    wrap(<WebsiteWorkspace />);
    const nav = screen.getByRole('navigation', { name: 'Website chats' });
    const item = await within(nav).findByRole('button', { name: /Voice calls/ });
    await waitFor(() => expect(item.textContent).toContain('2'));
    expect(item.querySelector('.bg-warning-bg')?.textContent).toBe('2');
    // In LIVE, after Visitors online.
    const labels = within(nav).getAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels.findIndex((l) => l.startsWith('Voice calls'))).toBe(labels.findIndex((l) => l.startsWith('Visitors online')) + 1);
    fireEvent.click(item);
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=calls');
  });

  it('is lit while the view shows, and the conversation sections are not', async () => {
    wrap(<WebsiteWorkspace />);
    const nav = screen.getByRole('navigation', { name: 'Website chats' });
    expect(within(nav).getByRole('button', { name: /Voice calls/ }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('button', { name: /^Inbox/ }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('region', { name: 'Conversations', hidden: true }).className).toContain('hidden');
  });
});

describe('the Voice calls view (UX-CALL-01)', () => {
  it('heads it with the design’s words, Calls / Call-backs, the site and the period', async () => {
    wrap(<WebsiteWorkspace />);
    expect(await within(view()).findByRole('heading', { name: 'Voice calls' })).toBeTruthy();
    expect(within(view()).getByText('Calls from the website widget — live, answered, missed, and the call-backs visitors asked for.')).toBeTruthy();
    const show = within(view()).getByRole('radiogroup', { name: 'Show' });
    expect(within(show).getByRole('radio', { name: 'Calls' }).getAttribute('aria-checked')).toBe('true');
    const cb = within(show).getByRole('radio', { name: /Call-backs/ });
    await waitFor(() => expect(cb.textContent).toBe('Call-backs 2'));
    fireEvent.click(cb);
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=calls&show=callbacks');
    expect(within(view()).getByRole('combobox', { name: 'Site' }).textContent).toContain('All sites');
    expect(within(view()).getByRole('combobox', { name: 'Period' }).textContent).toContain('Last 7 days');
    expect(callsAsked()[0]).toMatchObject({ result: 'all', days: '7', page: '1' });
  });

  it('shows the call on now in a green banner, with me as "You", and Open call goes to its chat', async () => {
    wrap(<WebsiteWorkspace />);
    const banner = (await within(view()).findByRole('button', { name: 'Open call' })).closest('[role="status"]') as HTMLElement;
    expect(banner.textContent).toMatch(/^On a call now · Visitor 9C1E \(Galle\) with You · 2:1\d · not recorded/);
    fireEvent.click(within(banner).getByRole('button', { name: 'Open call' }));
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=inbox&website=19');
  });

  it('says nothing is on when no call is', async () => {
    listPage = page({ live: [] });
    wrap(<WebsiteWorkspace />);
    await within(view()).findByText('Visitor 4F2A');
    expect(within(view()).queryByRole('button', { name: 'Open call' })).toBeNull();
  });

  it('has the six tiles, missed in red and call-backs open in amber; a tile filters or opens Call-backs', async () => {
    wrap(<WebsiteWorkspace />);
    const tiles = await within(view()).findByRole('list', { name: 'Calls in this period' });
    const text = within(tiles).getAllByRole('listitem').map((t) => t.textContent);
    expect(text).toEqual(['Calls38', 'Answered33', 'Missed5', 'Avg wait0:14', 'Avg length4:32', 'Call-backs open2']);
    expect(within(tiles).getByRole('listitem', { name: /^Missed: 5/ }).className).toContain('bg-[#fff6f5]');
    expect(within(tiles).getByRole('listitem', { name: /^Call-backs open: 2/ }).className).toContain('bg-[#fffaf0]');
    fireEvent.click(within(tiles).getByRole('listitem', { name: /^Missed: 5/ }));
    await waitFor(() => expect(callsAsked().at(-1)).toMatchObject({ result: 'missed', page: '1' }));
    fireEvent.click(within(tiles).getByRole('listitem', { name: /^Call-backs open: 2/ }));
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=calls&show=callbacks');
  });

  it('lists the calls in the design’s columns, with who answered and how each ended', async () => {
    wrap(<WebsiteWorkspace />);
    const grid = await within(view()).findByRole('grid', { name: 'Calls' });
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Visitor', 'When', 'Answered by', 'Wait', 'Length', 'Result']);
    const cells = (name: string) => within(within(grid).getByText(name).closest('[role="row"]') as HTMLElement).getAllByRole('gridcell').map((c) => c.textContent);
    expect(cells('Visitor 4F2A').filter((_, i) => i !== 1)).toEqual(['Visitor 4F2A · Colombo', 'Nuwan', '0:12', '6:48', 'Answered']);
    expect(cells('Ravi Silva').filter((_, i) => i !== 1)).toEqual(['Ravi Silva · Colombo', 'Nobody', '1:00', '—', 'Missed · call-back']);
    expect(cells('Visitor 7B19').filter((_, i) => i !== 1)).toEqual(['Visitor 7B19 · Kandy', '—', '0:21', '—', 'Cancelled by visitor']);
    expect(cells('Anne · Acme Ltd').filter((_, i) => i !== 1)).toEqual(['Anne · Acme Ltd · Kandy', 'Nuwan → Kasun', '0:05', '9:02', 'Transferred']);
  });

  it('filters All · n / Answered / Missed / Recorded on the server, and pages through the rest', async () => {
    wrap(<WebsiteWorkspace />);
    const show = await within(view()).findByRole('group', { name: 'Show' });
    expect(within(show).getAllByRole('button').map((b) => b.textContent)).toEqual(['All · 38', 'Answered', 'Missed', 'Recorded']);
    fireEvent.click(within(show).getByRole('button', { name: 'Recorded' }));
    await waitFor(() => expect(callsAsked().at(-1)).toMatchObject({ result: 'recorded' }));
    expect(within(show).getByRole('button', { name: 'Recorded' }).getAttribute('aria-pressed')).toBe('true');

    expect(within(view()).getByText('1–4 of 38')).toBeTruthy();
    fireEvent.click(within(view()).getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(callsAsked().at(-1)).toMatchObject({ page: '2' }));
  });

  it('says when a period has no calls', async () => {
    listPage = page({ calls: [], total: 0, has_more: false });
    wrap(<WebsiteWorkspace />);
    expect(await within(view()).findByText('No calls in this period')).toBeTruthy();
  });

  it('picks a row into the address', async () => {
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await within(view()).findByText('Ravi Silva'));
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=calls&voice=2');
  });

  it('tells somebody on an older server that the view needs a newer WorkSuite', async () => {
    listPage = new ApiError(404, 'Not found', null);
    wrap(<WebsiteWorkspace />);
    expect(await within(view()).findByText('Voice calls need a newer WorkSuite')).toBeTruthy();
  });
});

describe('the call details (UX-CALL-02)', () => {
  it('opens on the first call: who, when, how long, which site, and Open chat', async () => {
    wrap(<WebsiteWorkspace />);
    await waitFor(() => expect(aside().textContent).toContain('Visitor 4F2A'));
    expect(within(aside()).getByText(/^Today .+ · 6:48 · techubiz\.com$/)).toBeTruthy();
    fireEvent.click(within(aside()).getByRole('button', { name: 'Open chat' }));
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=inbox&website=11');
    expect(vi.mocked(apiGet).mock.calls.some(([p]) => p === '/api/chat/widget-admin/calls/1')).toBe(true);
  });

  it('says what happened, in order, to the second', async () => {
    wrap(<WebsiteWorkspace />);
    const steps = await waitFor(() => {
      const items = within(aside()).getAllByRole('listitem');
      expect(items.length).toBe(5);
      return items.map((li) => li.textContent?.replace(/^\d\d:\d\d:\d\d /, ''));
    });
    expect(steps).toEqual(['Visitor pressed Call on /shop/adobe-creative-cloud', 'Rang Nuwan, Dilini', 'Nuwan answered', 'Dilini joined the call', 'Ended by the visitor']);
    expect(within(aside()).getByText('Nuwan answered').tagName).toBe('B');
  });

  it('shows the recording state and the staff’s notes', async () => {
    wrap(<WebsiteWorkspace />);
    expect(await within(await details$()).findByText('Not recorded — recording is off for this widget.')).toBeTruthy();
    expect(within(aside()).getByText('Call notes · staff only')).toBeTruthy();
    expect(within(aside()).getByText('Wants 5 seats, student studio.')).toBeTruthy();
  });

  it('adds a note to the call', async () => {
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await within(await details$()).findByRole('button', { name: 'Add note' }));
    fireEvent.change(within(aside()).getByRole('textbox', { name: 'Call note' }), { target: { value: 'Sent edu form + quote after the call.' } });
    fireEvent.click(within(aside()).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/calls/1/note', { note: 'Sent edu form + quote after the call.' }));
  });

  it('cannot add a note without the reply permission', async () => {
    one = details({ can: { note: false, call: false } });
    wrap(<WebsiteWorkspace />);
    await within(await details$()).findByText('Wants 5 seats, student studio.');
    expect((within(aside()).getByRole('button', { name: 'Add note' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls back on their number, and without one offers the visitor a call in their open chat', async () => {
    wrap(<WebsiteWorkspace />);
    fireEvent.click(await within(await details$()).findByRole('button', { name: 'Call back' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'tel:+94771234567' });
    cleanup();

    one = details({ phone: null });
    wrap(<WebsiteWorkspace />);
    await within(await details$()).findByText('Wants 5 seats, student studio.');
    fireEvent.click(within(aside()).getByRole('button', { name: 'Call back' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/11/offer-call', {}));
    cleanup();

    one = details({ phone: null, conversation_status: 'closed' });
    wrap(<WebsiteWorkspace />);
    await within(await details$()).findByText('Wants 5 seats, student studio.');
    expect((within(aside()).getByRole('button', { name: 'Call back' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the picked call, not the first', async () => {
    tab.route = '/chat?view=website&section=calls&voice=4';
    wrap(<WebsiteWorkspace />);
    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.some(([p]) => p === '/api/chat/widget-admin/calls/4')).toBe(true));
    const picked = within(view()).getByText('Anne · Acme Ltd').closest('[role="row"]');
    expect(picked?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('the words', () => {
  it('words every step of the timeline', () => {
    expect(stepWords({ at: at(0), kind: 'pressed', page: null, by_name: 'Nuwan' }).text).toBe('Visitor accepted the call Nuwan offered');
    expect(stepWords({ at: at(0), kind: 'pressed' }).text).toBe('Visitor pressed Call');
    expect(stepWords({ at: at(0), kind: 'declined', names: ['Dilini'] }).text).toBe('Dilini declined');
    expect(stepWords({ at: at(0), kind: 'left', names: ['Nuwan'] }).text).toBe('Nuwan left the call');
    expect(stepWords({ at: at(0), kind: 'missed' }).text).toBe('Nobody answered — missed');
    expect(stepWords({ at: at(0), kind: 'cancelled' }).text).toBe('Cancelled by the visitor');
    expect(stepWords({ at: at(0), kind: 'dropped' }).text).toBe('The connection dropped');
    expect(stepWords({ at: at(0), kind: 'ended', by: 'agent', by_name: 'Kasun' }).text).toBe('Ended by Kasun');
  });

  it('says WHEN as the time today and the day and time before', () => {
    const now = new Date('2026-10-08T12:00:00');
    const today = new Date('2026-10-08T10:44:00').toISOString();
    const thursday = new Date('2026-10-06T15:02:00').toISOString();
    expect(whenLabel(today, now)).toBe(timeLabel(today));
    expect(whenLabel(thursday, now)).toBe(`${conversationStamp(thursday, now)} ${timeLabel(thursday)}`);
  });
});
