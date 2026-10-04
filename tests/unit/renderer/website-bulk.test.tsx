// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * C-03, the list views with bulk actions (UX-LIST-01/02, INB-08): one table for Live chats, Unassigned, Assigned to
 * me, Awaiting reply and Starred while nothing is open — rows picked as in Chat's own list, a tri-state header box,
 * the bulk bar's Assign to…, Priority, Star and Close on up to 200 at a time, and the priority filter and sort.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn() }));
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
const tab = { route: '/chat?view=website&section=live', go: vi.fn(), active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: tab.active, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { useMultiSelect } from '../../../src/modules/chat/selection';
import type { WebsiteRow } from '../../../src/modules/chat/website/api';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const row = (over: Partial<WebsiteRow>): WebsiteRow => ({
  id: 1, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: true, inactive: false, label: 'Visitor 1', visitor_name: null,
  email: null, country: null, browser: null, os: null, device: null, current_url: null, last_seen: null, status: 'open',
  is_offline: false, priority: 'normal', updated_at: ago(0), agent: null, assigned_to: null, started_at: null,
  last_visitor_at: null, waiting_since: null, at_risk: false, awaiting_reply: false, rating: null, is_starred: false, tags: null,
  ...over,
});
const ROWS = [
  row({ id: 1, visitor_name: 'Anne', email: 'anne@acme.lk', awaiting_reply: true, at_risk: true, priority: 'urgent', waiting_since: ago(3 * 60_000), updated_at: ago(60_000),
    last_message: { id: 9, body: 'My activation key says invalid', file: null, from: 'visitor', agent: null, at: ago(3 * 60_000) } }),
  row({ id: 2, visitor_name: 'Visitor 4F2A', awaiting_reply: true, waiting_since: ago(90_000), updated_at: ago(30_000), priority: 'vip', is_starred: true }),
  row({ id: 3, visitor_name: 'Kasun P.', email: 'kasun@studio.lk', assigned_to: 9, agent: 'Nuwan', priority: 'high', updated_at: ago(5_000),
    last_message: { id: 8, body: 'The trial runs for 14 days.', file: null, from: 'agent', agent: 'Nuwan', at: ago(5_000) } }),
];

let rows = ROWS;
function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations') return { conversations: rows, can: { view: true, reply: true, manage: false } };
    if (path === '/api/chat/widget-admin/agents') return { agents: [{ id: 7, name: 'Me Myself', email: null }, { id: 8, name: 'Kasun Jayasuriya', email: null }] };
    if (path === '/api/chat/widget-admin/visitors') return { visitors: [] };
    if (path === '/api/chat/widget-admin/missed/count') return { count: 0 };
    if (path === '/api/chat/widget-admin/callbacks') return { callbacks: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(request).mockImplementation((async () => ({ data: { count: 2 }, offline: false, cachedAt: null, message: '2 updated' })) as never);
  const state: WebchatRingState = { chats: [], handoffs: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };
  vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state : null)) as never);
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const grid = () => screen.getByRole('grid', { name: 'Live chats' });
const rowOf = (name: string) => within(grid()).getByText(name).closest<HTMLElement>('[role="row"]')!;
const order = () => [...grid().querySelectorAll('[data-website-row]')].map((el) => Number(el.getAttribute('data-website-row')));
const bulkCalls = () => vi.mocked(request).mock.calls.filter(([, path]) => path === '/api/chat/widget-admin/conversations/bulk').map(([, , opts]) => (opts as { body: unknown }).body);

beforeEach(() => {
  rows = ROWS;
  tab.route = '/chat?view=website&section=live';
  tab.active = true;
  tab.go.mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(toast).mockReset();
  app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
  serve();
});
afterEach(() => cleanup());

describe('useMultiSelect, shared by every chat list', () => {
  it('toggles with Ctrl-click, picks a range with Shift-click, selects all or none, and ends on Esc', () => {
    const { result } = renderHook(() => useMultiSelect(['a', 'b', 'c', 'd'], { globalEscape: true }));
    let picked = false;
    act(() => void (picked = result.current.onRowClick({ ctrlKey: true, metaKey: false, shiftKey: false }, 'b')));
    expect(picked).toBe(true);
    expect(result.current.picked).toEqual(['b']);
    expect(result.current.state).toBe('some');
    act(() => void result.current.onRowClick({ ctrlKey: false, metaKey: false, shiftKey: true }, 'd'));
    expect(result.current.picked).toEqual(['b', 'c', 'd']);
    act(() => void result.current.onRowClick({ ctrlKey: true, metaKey: false, shiftKey: false }, 'c'));
    expect(result.current.picked).toEqual(['b', 'd']);
    act(() => result.current.toggleAll());
    expect(result.current.state).toBe('all');
    act(() => result.current.toggleAll());
    expect(result.current.state).toBe('none');
    // A plain click is not a selection gesture: the caller opens the row, and what was picked is let go.
    act(() => result.current.toggle('a'));
    act(() => void (picked = result.current.onRowClick({ ctrlKey: false, metaKey: false, shiftKey: false }, 'c')));
    expect(picked).toBe(false);
    expect(result.current.picked).toEqual([]);
    act(() => result.current.toggle('a'));
    act(() => void fireEvent.keyDown(window, { key: 'Escape' }));
    expect(result.current.picked).toEqual([]);
    act(() => result.current.setSelecting(true));
    expect(result.current.escape({ key: 'x' })).toBe(false);
    act(() => void expect(result.current.escape({ key: 'Escape' })).toBe(true));
    expect(result.current.selecting).toBe(false);
  });

  it('with Ctrl-click on another row, picks the open one too', () => {
    const { result } = renderHook(() => useMultiSelect([1, 2, 3], { current: 1 }));
    act(() => void result.current.onRowClick({ ctrlKey: true, metaKey: false, shiftKey: false }, 3));
    expect(result.current.picked).toEqual([1, 3]);
  });
});

describe('the list views as one table (C-03, UX-LIST-01)', () => {
  it('draws the heading, the columns and each row: visitor and last message, site, status, priority, owner, wait', async () => {
    wrap(<WebsiteWorkspace />);
    await within(grid()).findByText('Kasun P.');
    expect(screen.getByRole('heading', { name: 'Live chats' })).toBeTruthy();
    expect(screen.getByText('Open conversations with a visitor still on the site.')).toBeTruthy();
    expect(screen.getByText(/Departed visitors leave this list at once/)).toBeTruthy();
    expect(within(grid()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Visitor', 'Site', 'Status', 'Priority', 'Owner', 'Waiting']);
    // No Open / Mine / Closed pills in the list views.
    expect(screen.queryByRole('button', { name: /^Open · / })).toBeNull();

    const anne = rowOf('Anne');
    expect(within(anne).getByText('· anne@acme.lk')).toBeTruthy();
    expect(within(anne).getByText('“My activation key says invalid”')).toBeTruthy();
    expect(within(anne).getByText('At risk')).toBeTruthy();
    expect(within(anne).getByText('Urgent').className).toContain('text-danger');
    expect(within(anne).getByText('Nobody').className).toContain('text-ink-3');
    expect(within(anne).getByLabelText(/^waiting 3:0\d$/).className).toContain('text-danger');

    const kasun = rowOf('Kasun P.');
    expect(within(kasun).getByText('Nuwan: The trial runs for 14 days.')).toBeTruthy();
    expect(within(kasun).getByText('Chatting')).toBeTruthy();
    expect(within(kasun).getByText('High')).toBeTruthy();
    expect(within(kasun).getByText('Nuwan')).toBeTruthy();
    expect(within(kasun).getByText('—')).toBeTruthy();
    expect(within(rowOf('Visitor 4F2A')).getByText('Awaiting reply')).toBeTruthy();
    // Longest waiting first.
    expect(order()).toEqual([1, 2, 3]);
  });

  it('a plain click opens the chat, and then the card list stands beside it', async () => {
    wrap(<WebsiteWorkspace />);
    await within(grid()).findByText('Anne');
    fireEvent.click(rowOf('Kasun P.'));
    expect(tab.go).toHaveBeenLastCalledWith('/chat?view=website&section=live&website=3');
    cleanup();
    tab.route = '/chat?view=website&section=live&website=3';
    wrap(<WebsiteWorkspace />);
    expect(await screen.findByText('Thread 3')).toBeTruthy();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(await within(screen.getByRole('region', { name: 'Conversations' })).findByText('Anne')).toBeTruthy();
  });

  it('Invited keeps its own list, without the table', async () => {
    tab.route = '/chat?view=website&section=invited';
    wrap(<WebsiteWorkspace />);
    expect(await screen.findByText('No invitations')).toBeTruthy();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('filters by priority and sorts by newest activity or visitor name', async () => {
    wrap(<WebsiteWorkspace />);
    await within(grid()).findByText('Anne');
    fireEvent.click(screen.getByRole('combobox', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('option', { name: 'Newest activity' }));
    expect(order()).toEqual([3, 2, 1]);
    fireEvent.click(screen.getByRole('combobox', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('option', { name: 'Visitor name' }));
    expect(order()).toEqual([1, 3, 2]);
    fireEvent.click(screen.getByRole('combobox', { name: 'Priority' }));
    fireEvent.click(screen.getByRole('option', { name: 'VIP' }));
    expect(order()).toEqual([2]);
  });
});

describe('picking rows and the bulk bar (UX-LIST-02, INB-08)', () => {
  it('the header box is ticked, mixed or clear; Ctrl-click and Space pick, Esc and Clear let go', async () => {
    wrap(<WebsiteWorkspace />);
    await within(grid()).findByText('Anne');
    const all = within(grid()).getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
    expect(all.checked).toBe(false);
    fireEvent.click(within(rowOf('Anne')).getByRole('checkbox', { name: 'Select Anne' }));
    expect(all.indeterminate).toBe(true);
    expect(tab.go).not.toHaveBeenCalled();
    fireEvent.click(rowOf('Kasun P.'), { ctrlKey: true });
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    expect(within(bar).getByText('Up to 200 at a time · each assignee is alerted')).toBeTruthy();
    expect(rowOf('Kasun P.').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(all);
    expect(all.checked).toBe(true);
    expect(within(bar).getByText('3 selected')).toBeTruthy();
    fireEvent.click(all);
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();

    const anne = rowOf('Anne');
    anne.focus();
    fireEvent.keyDown(anne, { key: ' ' });
    expect(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByText('1 selected')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
    fireEvent.keyDown(anne, { key: ' ' });
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
    expect(tab.go).not.toHaveBeenCalled();
  });

  it('assigns, sets a priority, stars and closes the picked chats in one request each', async () => {
    wrap(<WebsiteWorkspace />);
    await within(grid()).findByText('Anne');
    const pick = () => {
      fireEvent.click(within(rowOf('Anne')).getByRole('checkbox'));
      fireEvent.click(within(rowOf('Visitor 4F2A')).getByRole('checkbox'));
      return screen.getByRole('toolbar', { name: 'Bulk actions' });
    };

    fireEvent.click(within(pick()).getByRole('button', { name: /Assign to…/ }));
    let menu = await screen.findByRole('menu', { name: 'Assign to' });
    expect(within(menu).getByRole('menuitem', { name: /Assign to me/ })).toBeTruthy();
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /Kasun Jayasuriya/ }));
    await waitFor(() => expect(bulkCalls()).toEqual([{ ids: [1, 2], action: 'assign', user_id: 8 }]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '2 updated'));
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());

    fireEvent.click(within(pick()).getByRole('button', { name: /Priority/ }));
    menu = await screen.findByRole('menu', { name: 'Priority' });
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Urgent/ }));
    await waitFor(() => expect(bulkCalls()[1]).toEqual({ ids: [1, 2], action: 'priority', priority: 'urgent' }));
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());

    // One of the two is starred already: Star.
    fireEvent.click(within(pick()).getByRole('button', { name: 'Star' }));
    await waitFor(() => expect(bulkCalls()[2]).toEqual({ ids: [1, 2], action: 'star' }));
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());

    fireEvent.click(within(pick()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(bulkCalls()[3]).toEqual({ ids: [1, 2], action: 'close' }));
  });

  it('Unstar when every picked chat is starred; right-click on picked rows offers the same', async () => {
    wrap(<WebsiteWorkspace />);
    await within(grid()).findByText('Anne');
    fireEvent.click(within(rowOf('Visitor 4F2A')).getByRole('checkbox'));
    expect(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Unstar' })).toBeTruthy();
    fireEvent.click(within(rowOf('Anne')).getByRole('checkbox'));
    fireEvent.contextMenu(rowOf('Anne'));
    const menu = await screen.findByRole('menu', { name: 'Conversation actions' });
    expect(within(menu).getByRole('menuitem', { name: /Assign to…/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Close/ }));
    await waitFor(() => expect(bulkCalls()).toEqual([{ ids: [1, 2], action: 'close' }]));
  });

  it('takes up to 200 at a time, and says so when more are picked', async () => {
    rows = Array.from({ length: 201 }, (_, i) => row({ id: i + 1, visitor_name: `Visitor ${i + 1}` }));
    wrap(<WebsiteWorkspace />);
    await within(grid()).findByText('Visitor 201');
    fireEvent.click(within(grid()).getByRole('checkbox', { name: 'Select all' }));
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(bar).getByText('201 selected')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('take up to 200 at a time');
    expect((within(bar).getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(rowOf('Visitor 7')).getByRole('checkbox'));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect((bulkCalls()[0] as { ids: number[] }).ids).toHaveLength(200));
  });
});
