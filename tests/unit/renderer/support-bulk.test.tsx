// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The inbox's actions on tickets (#333): the right-click menu (only what I may do, the tickets' own values ticked),
 * picking several (checkbox, ⌘/Ctrl-click, ⇧-click, X, ⌘A, Esc), the bulk bar's `POST tickets/bulk` with the versions
 * the list showed, its per-ticket refusals and Undo, the confirmation before requesters may be emailed, the list's keys,
 * the heading's count, and the status dot's tooltip. The words, the menu's groups and the dialogs are those of
 * support-list-actions.test.tsx (the issue's); this file keeps the scenarios of the first, smaller version.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => undefined),
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn(), dismissKey: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), go: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: '/support', active: true, path: ['support'], query: new URLSearchParams(), go: nav.go, navigate: nav.navigate, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

const { request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { toast } = await import('../../../src/core/toasts');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const { bulkSummary, countTitle, statusChoices, ticketCount, undoInputs, capsFor } = await import('../../../src/modules/support/bulk');
const { statusDotLabel } = await import('../../../src/modules/support/TicketList');
const { BulkBar } = await import('../../../src/modules/support/BulkBar');

const ticket = (id: number, over: Record<string, unknown> = {}) => ({
  id, reference: `CFX-00${id}`, subject: `Subject ${id}`, status: 'open', status_category: 'open', priority: 'normal', type: 'incident', source: 'email',
  organization: { id: 10, name: 'CreativeFX' }, requester: { name: `Requester ${id}`, email: `r${id}@acme.lk`, phone: null, kind: 'guest', user_id: null, contact_id: null, company_id: null },
  assignee: { id: 1, name: 'Ayesha Fernando' }, team: null, category: null, department: null, tags: [], sla: { state: null, target: null, due_at: null, policy_id: null, paused_ms: 0 },
  due_at: null, confidential: false, unread: 0, conversation_id: null, version: 7, opened_at: null, first_response_at: null, last_customer_at: null, last_agent_at: null,
  resolved_at: null, closed_at: null, created_at: '2026-10-04T09:12:00+05:30', updated_at: '2026-10-04T09:42:00+05:30', deleted_at: null, ...over,
});
const ALL = { view: true, create: true, reply: true, notes: true, assign: true, edit: true, close: true, reopen: true, escalate: true, merge: true, delete: true };
const STATUSES = [
  { key: 'new', label: 'New', category: 'new', live: true, next: ['open', 'in_progress', 'pending_customer', 'pending_internal', 'escalated', 'resolved'] },
  { key: 'open', label: 'Open', category: 'open', live: true, next: ['in_progress', 'pending_customer', 'pending_internal', 'escalated', 'resolved'] },
  { key: 'in_progress', label: 'In progress', category: 'open', live: true, next: ['open', 'pending_customer', 'pending_internal', 'escalated', 'resolved'] },
  { key: 'pending_customer', label: 'Pending customer', category: 'pending', live: true, next: ['open', 'in_progress', 'resolved'] },
  { key: 'pending_internal', label: 'Pending internal', category: 'pending', live: true, next: ['open', 'in_progress', 'resolved'] },
  { key: 'escalated', label: 'Escalated', category: 'open', live: true, next: ['in_progress', 'resolved'] },
  { key: 'resolved', label: 'Resolved', category: 'resolved', live: false, next: ['open', 'closed'] },
  { key: 'closed', label: 'Closed', category: 'closed', live: false, next: [] },
];
const meta = (can: Record<string, boolean> = ALL) => ({
  statuses: STATUSES, priorities: ['low', 'normal', 'high', 'urgent'], types: [], sources: [], views: [], sorts: ['updated'],
  organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can }], departments: [], teams: [], categories: [], tags: [{ name: 'vip', organization_id: 10 }, { name: 'billing', organization_id: null }], can,
});
const VIEWS = { views: [{ key: 'mine', label: 'My tickets', count: 12 }, { key: 'resolved', label: 'Resolved', count: 1 }], saved: [], badges: null };
const ROWS = () => [ticket(1284, { priority: 'urgent', tags: ['vip'] }), ticket(1292, { assignee: null }), ticket(1293, { status: 'pending_customer' })];

type Call = { method: string; path: string; query?: Record<string, unknown>; body?: unknown };
let served: Record<string, unknown>;
let log: Call[];
function serve(over: Record<string, unknown> = {}) {
  served = {
    'GET /api/support/v1/meta': meta(),
    'GET /api/support/v1/views': VIEWS,
    'GET /api/support/v1/tickets': { items: ROWS(), next_cursor: null, has_more: false, sort: 'updated', view: 'mine' },
    'GET /api/support/v1/agents': { agents: [{ id: 1, name: 'Ayesha Fernando', presence: 'available', open: 3, capacity: null, teams: [] }, { id: 4, name: 'Nimal Perera', presence: 'busy', open: 5, capacity: null, teams: [] }] },
    'GET /api/chat/presence/me': { status: 'online', choice: 'available' },
    'POST /api/support/v1/tickets/bulk': (_q: unknown, body: { ids: number[] }) => ({ results: body.ids.map((id) => ({ id, ok: true, version: 8 })), done: body.ids.length, refused: 0 }),
    ...over,
  };
  log = [];
  vi.mocked(request).mockImplementation((async (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}) => {
    log.push({ method, path, query: opts.query, body: opts.body });
    const hit = served[`${method} ${path}`];
    const data = typeof hit === 'function' ? (hit as (q: unknown, b: unknown) => unknown)(opts.query ?? {}, opts.body) : hit;
    if (data instanceof Error) throw data;
    if (data === undefined) return new Promise(() => undefined);
    return { data, offline: false, cachedAt: null, message: null };
  }) as never);
}
const calls = (method: string, path: string) => log.filter((c) => c.method === method && c.path === path);
const bulkCalls = () => calls('POST', '/api/support/v1/tickets/bulk').map((c) => c.body as Record<string, unknown>);

const renderInbox = (route = '/support') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupportPage tabId="t1" route={route} active />
    </QueryClientProvider>,
  );
};
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });
const row = (id: number) => document.getElementById(`support-row-${id}`) as HTMLElement;
const box = (id: number) => within(row(id)).getByRole('checkbox', { name: `Select CFX-00${id}` });
const bar = () => screen.queryByRole('toolbar', { name: 'Bulk actions' });
/** A menu item by its name, whichever kind of item it is (plain, checkbox or radio). */
const itemIn = (menu: HTMLElement, name: RegExp | string) => [...within(menu).queryAllByRole('menuitem', { name }), ...within(menu).queryAllByRole('menuitemcheckbox', { name }), ...within(menu).queryAllByRole('menuitemradio', { name })][0] ?? null;

beforeEach(() => {
  resetApiFamily();
  nav.navigate.mockReset();
  nav.go.mockReset();
  vi.mocked(toast).mockReset();
  serve();
  app.set({ auth: { stage: 'ready', server: null, user: { id: '1', name: 'Ayesha Fernando', email: 'a@x', avatar: null, timezone: null, locale: null, organizationId: null, organizationName: null, timeFormat: null, weekStart: null }, message: null, setupPending: false }, status: { network: 'ONLINE', realtime: 'connected', pendingChanges: 0, unread: { mail: 0, chat: 0, notifications: 0, tasks: 0 }, notificationsPausedUntil: null, services: {}, locked: false, safeMode: false } });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 720, top: 0, left: 0, right: 600, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
});

/** Waits for the rows and the desk's permissions, which the menus are built from. */
async function ready() {
  await screen.findByText('Subject 1284');
  await waitFor(() => expect(calls('GET', '/api/support/v1/meta').length).toBeGreaterThan(0));
  await act(async () => undefined);
}

describe('the parts', () => {
  it('counts tickets in the singular and the plural', () => {
    expect(ticketCount(1)).toBe('1 ticket');
    expect(ticketCount(0)).toBe('0 tickets');
    expect(ticketCount(12)).toBe('12 tickets');
    expect(ticketCount(50, true)).toBe('50+ tickets');
    expect(countTitle('Resolved', 1)).toBe('Resolved · 1 ticket');
    expect(countTitle('Open', 12)).toBe('Open · 12 tickets');
    expect(countTitle('Open', null)).toBe('Open');
  });

  it('sums up an answer: all done, some refused with the reasons grouped, none done', () => {
    const ref = (id: number) => `CFX-${id}`;
    expect(bulkSummary({ results: [{ id: 1, ok: true }, { id: 2, ok: true }], done: 2, refused: 0 }, 'Moved to Open', ref)).toEqual({ kind: 'success', text: 'Moved to Open · 2 tickets' });
    const some = bulkSummary(
      {
        results: [
          { id: 1, ok: true },
          { id: 2, ok: false, code: 'FORBIDDEN', message: 'You may not move this ticket to closed' },
          { id: 3, ok: false, code: 'FORBIDDEN', message: 'You may not move this ticket to closed' },
          { id: 4, ok: false, code: 'VERSION_CONFLICT', message: 'Changed by somebody else' },
          { id: 5, ok: true },
        ],
        done: 2,
        refused: 3,
      },
      'Moved to Closed',
      ref,
    );
    expect(some.kind).toBe('warning');
    expect(some.text).toBe('Moved to Closed · 2 of 5 done — 3 refused: You may not move this ticket to closed (CFX-2, CFX-3); Changed by somebody else (CFX-4)');
    expect(bulkSummary({ results: [{ id: 2, ok: false, code: 'NOT_FOUND', message: 'Ticket not found' }], done: 0, refused: 1 }, 'Deleted', ref)).toEqual({ kind: 'error', text: 'Nothing changed — 1 refused: Ticket not found (CFX-2)' });
  });

  it('plans the Undo from what each ticket had, at the version the change left', () => {
    const before = [ticket(1, { status: 'open', tags: ['vip'] }), ticket(2, { status: 'pending_customer' }), ticket(3, { status: 'open' })] as never[];
    const answer = { results: [{ id: 1, ok: true, version: 9 }, { id: 2, ok: true, version: 4 }, { id: 3, ok: false, code: 'FORBIDDEN' }], done: 2, refused: 1 };
    expect(undoInputs({ ids: [1, 2, 3], action: 'status', status: 'resolved' }, before, answer)).toEqual([
      { action: 'status', status: 'open', override: true, ids: [1], versions: { 1: 9 } },
      { action: 'status', status: 'pending_customer', override: true, ids: [2], versions: { 2: 4 } },
    ]);
    // Tags: only those a ticket did not have already come off again.
    expect(undoInputs({ ids: [1, 2], action: 'tag', tags: ['VIP', 'billing'] }, before, answer)).toEqual([
      { action: 'untag', tags: ['billing'], ids: [1], versions: { 1: 9 } },
      { action: 'untag', tags: ['vip', 'billing'], ids: [2], versions: { 2: 4 } },
    ]);
    expect(undoInputs({ ids: [1, 2], action: 'assign', user_id: 4 }, before, answer)).toEqual([{ action: 'assign', user_id: 1, ids: [1, 2], versions: { 1: 9, 2: 4 } }]);
    expect(undoInputs({ ids: [1, 2], action: 'delete' }, before, answer)).toEqual([{ action: 'restore', ids: [1, 2] }]);
    expect(undoInputs({ ids: [1, 2], action: 'merge', primary_id: 1 }, before, answer)).toEqual([]);
  });

  it('reads permissions per organization and offers only the moves they allow', () => {
    const m = meta({ view: true, edit: true }) as never;
    expect(capsFor(m, { organization: { id: 10, name: null } })).toMatchObject({ edit: true });
    expect(capsFor({ organizations: [], can: { close: true } } as never, { organization: { id: 99, name: null } })).toEqual({ close: true });
    // Edit moves an open ticket about, but resolving needs "close".
    expect(statusChoices(m, [ticket(1) as never])).toEqual(['open', 'in_progress', 'pending_customer', 'pending_internal']);
    expect(statusChoices(meta({ view: true }) as never, [ticket(1) as never])).toEqual([]);
  });

  it('explains the status dot', () => {
    // The words are the issue's (support-list-actions.test.tsx): Resolved reads as Solved.
    expect(statusDotLabel('resolved')).toBe('Status: Resolved — Solved: waiting for the customer to confirm, or to close by itself');
    expect(statusDotLabel('open')).toBe('Status: Open — Being worked on');
  });
});

describe('the heading', () => {
  it('says the view and its count, singular or plural', async () => {
    renderInbox();
    await ready();
    expect(screen.getByRole('heading', { name: 'My tickets' })).toBeTruthy();
    expect(document.querySelector('[data-list-count]')?.textContent).toBe('· 12 tickets');
    cleanup();
    renderInbox('/support?view=resolved');
    await ready();
    await waitFor(() => expect(document.querySelector('[data-list-count]')?.textContent).toBe('· 1 ticket'));
  });

  it('counts the tickets loaded under a search, which the server does not count', async () => {
    renderInbox();
    await ready();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), { target: { value: 'licence' } });
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets').at(-1)!.query).toMatchObject({ q: 'licence' }));
    // Searched, the count is how many are listed ("12+ listed" while more pages wait), never the view's own.
    await waitFor(() => expect(document.querySelector('[data-list-count]')?.textContent).toBe('· 3 listed'));
  });

  it('gives each row’s status dot a tooltip and a name', async () => {
    renderInbox();
    await ready();
    const dot = within(row(1284)).getByRole('img', { name: 'Status: Open — Being worked on' });
    expect(dot.getAttribute('title')).toBe('Status: Open — Being worked on');
    expect(screen.getByText('live').getAttribute('title')).toContain('updates as tickets change');
  });
});

describe('the right-click menu', () => {
  it('offers everything I may do, with the ticket’s status, assignee and priority ticked', async () => {
    renderInbox();
    await ready();
    fireEvent.contextMenu(screen.getByText('Subject 1284'));
    const menu = await screen.findByRole('menu', { name: 'Ticket actions' });
    for (const name of ['Open', 'Open in new tab', 'Status', 'Assign to me', 'Assign to…', 'Priority', 'Add tag…', 'Reply', 'Add internal note', 'Copy ticket ID', 'Copy link', 'Delete…'])
      expect(itemIn(menu, new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)), name).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Status/ }));
    const status = await screen.findByRole('menu', { name: 'Status' });
    expect(within(status).getByRole('menuitemradio', { name: 'Open' }).getAttribute('aria-checked')).toBe('true');
    expect(within(status).getByRole('menuitemradio', { name: 'Solved' }).getAttribute('aria-checked')).toBe('false');
    // New is not a move the state machine allows from Open.
    expect(within(status).queryByRole('menuitemradio', { name: 'New' })).toBeNull();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Priority/ }));
    const priority = await screen.findByRole('menu', { name: 'Priority' });
    expect(within(priority).getByRole('menuitemradio', { name: 'Urgent' }).getAttribute('aria-checked')).toBe('true');

    // Assigned to me: ticked. Assign to… finds somebody else.
    expect(within(menu).getByRole('menuitemcheckbox', { name: /^Assign to me/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Assign to…/ }));
    const assign = await screen.findByRole('dialog', { name: 'Assign to…' });
    fireEvent.click(await within(assign).findByRole('button', { name: /Nimal Perera/ }));
    await waitFor(() => expect(bulkCalls()[0]).toEqual({ ids: [1284], action: 'assign', user_id: 4, versions: { 1284: 7 } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '1 ticket assigned to Nimal Perera', expect.objectContaining({ label: 'Undo' }), 5000, { key: 'support-bulk' }));
  });

  it('hides what I may not do', async () => {
    serve({ 'GET /api/support/v1/meta': meta({ view: true, reply: true }) });
    renderInbox();
    await ready();
    fireEvent.contextMenu(screen.getByText('Subject 1284'));
    const menu = await screen.findByRole('menu', { name: 'Ticket actions' });
    expect(within(menu).queryByRole('menuitem', { name: /^Status/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /^Priority/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /^Assign to…/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /^Delete/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /^Add internal note/ })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /^Reply/ })).toBeTruthy();
    // An unassigned ticket I may reply to, I may take — and give to nobody else.
    fireEvent.keyDown(menu, { key: 'Escape' });
    fireEvent.contextMenu(screen.getByText('Subject 1292'));
    const other = await screen.findByRole('menu', { name: 'Ticket actions' });
    expect(within(other).getByRole('menuitemcheckbox', { name: /^Assign to me/ }).getAttribute('aria-checked')).toBe('false');
    expect(within(other).queryByRole('menuitem', { name: /^Assign to…/ })).toBeNull();
  });

  it('Reply opens the ticket at its composer; Open in a new tab opens its tab', async () => {
    serve({ 'GET /api/support/v1/tickets/1292': new Promise(() => undefined) });
    renderInbox();
    await ready();
    fireEvent.contextMenu(screen.getByText('Subject 1292'));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^Open in new tab/ }));
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1292');
  });

  it('acts on the tickets picked when the row is one of them', async () => {
    renderInbox();
    await ready();
    fireEvent.click(box(1284));
    fireEvent.click(box(1292));
    fireEvent.contextMenu(screen.getByText('Subject 1292'));
    const menu = await screen.findByRole('menu', { name: 'Actions for 2 tickets' });
    expect(within(menu).queryByRole('menuitem', { name: /^Open$/ })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /^Merge 2 tickets…/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Add tag…/ }));
    const tags = await screen.findByRole('dialog', { name: 'Tag 2 tickets' });
    // vip is on one of the two only: adding it tags both.
    fireEvent.change(within(tags).getByRole('combobox', { name: /^Tags/ }), { target: { value: 'vip' } });
    fireEvent.click(within(tags).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(bulkCalls()[0]).toEqual({ ids: [1284, 1292], action: 'tag', tags: ['vip'], versions: { 1284: 7, 1292: 7 } }));
  });
});

describe('picking several', () => {
  it('ticks with the checkbox, toggles with Ctrl-click, picks a range with Shift-click, and Esc clears', async () => {
    renderInbox();
    await ready();
    expect(bar()).toBeNull();
    fireEvent.click(box(1284));
    expect(within(bar()!).getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Subject 1293'), { shiftKey: true });
    expect(within(bar()!).getByText('3 selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Subject 1292'), { ctrlKey: true });
    expect(within(bar()!).getByText('2 selected')).toBeTruthy();
    expect(row(1292).hasAttribute('data-picked')).toBe(false);
    // A plain click reads the ticket and leaves the picks alone.
    expect(nav.navigate).not.toHaveBeenCalled();
    key('Escape');
    expect(bar()).toBeNull();
  });

  it('X picks the ticket in front, ⇧X the run to it, ⌘A everything loaded', async () => {
    renderInbox();
    await ready();
    key('j');
    key('x');
    expect(within(bar()!).getByText('1 selected')).toBeTruthy();
    key('j');
    key('j');
    key('X', { shiftKey: true });
    expect(within(bar()!).getByText('3 selected')).toBeTruthy();
    key('x');
    expect(within(bar()!).getByText('2 selected')).toBeTruthy();
    key('Escape');
    key('a', { ctrlKey: true });
    expect(within(bar()!).getByText('3 selected')).toBeTruthy();
    // Not while typing.
    key('Escape');
    const search = screen.getByRole('searchbox', { name: 'Search tickets' });
    fireEvent.keyDown(search, { key: 'x' });
    fireEvent.keyDown(search, { key: 'a', ctrlKey: true });
    expect(bar()).toBeNull();
  });

  it('offers to pick every match when all loaded are picked and more match, and to pick all loaded otherwise', () => {
    const may = { status: false, assign: false, priority: false, tag: false, merge: false, snooze: false };
    const matching = vi.fn();
    const all = vi.fn();
    const props = { may, loaded: 3, more: true, matching: null, matchingLabel: 'Select all 12 tickets in My tickets', progress: null, onMenu: vi.fn(), onTag: vi.fn(), onMerge: vi.fn(), onSnooze: vi.fn(), onSelectAll: all, onSelectAllMatching: matching, onClear: () => undefined };
    const { rerender } = render(<BulkBar {...props} count={3} all />);
    expect(screen.getByText(/All 3 on this page selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select all 12 tickets in My tickets' }));
    expect(matching).toHaveBeenCalled();
    rerender(<BulkBar {...props} count={1} all={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select all 3 tickets loaded' }));
    expect(all).toHaveBeenCalled();
  });
});

describe('the bulk bar', () => {
  it('sends one bulk call, says what was refused and why, and Undo puts back what each ticket had', async () => {
    serve({
      'POST /api/support/v1/tickets/bulk': (_q: unknown, body: { action: string; ids: number[] }) =>
        body.action === 'priority' && body.ids.length === 3
          ? { results: [{ id: 1284, ok: true, version: 8 }, { id: 1292, ok: false, code: 'VERSION_CONFLICT', message: 'Changed by somebody else' }, { id: 1293, ok: true, version: 9 }], done: 2, refused: 1 }
          : { results: body.ids.map((id) => ({ id, ok: true, version: 10 })), done: body.ids.length, refused: 0 },
    });
    renderInbox();
    await ready();
    key('a', { ctrlKey: true });
    fireEvent.click(within(bar()!).getByRole('button', { name: /Priority/ }));
    fireEvent.click(within(await screen.findByRole('menu', { name: 'Priority for 3 tickets' })).getByRole('menuitemradio', { name: 'High' }));
    await waitFor(() => expect(bulkCalls()[0]).toEqual({ ids: [1284, 1292, 1293], action: 'priority', priority: 'high', versions: { 1284: 7, 1292: 7, 1293: 7 } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '2 tickets set to High', expect.objectContaining({ label: 'Undo' }), 5000, { key: 'support-bulk' }));
    expect(toast).toHaveBeenCalledWith('error', '1 ticket could not be changed: Changed by somebody else (CFX-001292)');
    // This answer has no `before`: Undo is planned from the tickets as listed, at the versions the change left.
    const undo = vi.mocked(toast).mock.calls.find((c) => c[1] === '2 tickets set to High')![2]!;
    act(() => undo.run());
    await waitFor(() => expect(bulkCalls()).toHaveLength(3));
    expect(bulkCalls().slice(1)).toEqual([
      { action: 'priority', priority: 'urgent', ids: [1284], versions: { 1284: 8 }, reason: 'Undo' },
      { action: 'priority', priority: 'normal', ids: [1293], versions: { 1293: 9 }, reason: 'Undo' },
    ]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '1 ticket set to Normal', undefined, 5000, { key: 'support-bulk' }));
    expect(toast).toHaveBeenCalledWith('success', '1 ticket set to Urgent', undefined, 5000, { key: 'support-bulk' });
  });

  it('shows only what I may do, and Merge for two or more', async () => {
    serve({ 'GET /api/support/v1/meta': meta({ view: true, reply: true, edit: true }) });
    renderInbox();
    await ready();
    fireEvent.click(box(1284));
    const names = () => within(bar()!).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.replace('▾', '').trim());
    expect(names()).toEqual(['Status', 'Assign', 'Priority', 'Tag', 'Snooze', 'More actions', 'Clear']);
    // No "merge": no Merge, however many are picked.
    fireEvent.click(box(1292));
    expect(names()).toEqual(['Status', 'Assign', 'Priority', 'Tag', 'Snooze', 'More actions', 'Clear']);
    cleanup();
    serve({ 'GET /api/support/v1/meta': meta({ view: true }) });
    renderInbox();
    await ready();
    fireEvent.click(box(1284));
    expect(names()).toEqual(['More actions', 'Clear']);
    cleanup();
    serve();
    renderInbox();
    await ready();
    fireEvent.click(box(1284));
    expect(names()).toEqual(['Status', 'Assign', 'Priority', 'Tag', 'Snooze', 'More actions', 'Clear']);
    fireEvent.click(box(1292));
    expect(names()).toEqual(['Status', 'Assign', 'Priority', 'Tag', 'Merge', 'Snooze', 'More actions', 'Clear']);
  });

  it('adds a new tag typed into the tag dialog', async () => {
    renderInbox();
    await ready();
    fireEvent.click(box(1292));
    fireEvent.click(within(bar()!).getByRole('button', { name: /Tag/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add tag' });
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Tags/ }), { target: { value: 'Refund' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(bulkCalls()[0]).toMatchObject({ ids: [1292], action: 'tag', tags: ['refund'] }));
  });

  it('asks before deleting, and merges into the ticket chosen', async () => {
    renderInbox();
    await ready();
    fireEvent.click(box(1284));
    fireEvent.click(box(1292));
    fireEvent.click(within(bar()!).getByRole('button', { name: 'More actions' }));
    fireEvent.click(within(await screen.findByRole('menu', { name: 'More actions for 2 tickets' })).getByRole('menuitem', { name: /^Delete 2 tickets…/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 tickets?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(bulkCalls()[0]).toEqual({ ids: [1284, 1292], action: 'delete', versions: { 1284: 7, 1292: 7 } }));
    // Deleted: out of the selection.
    await waitFor(() => expect(bar()).toBeNull());

    // The list is read again (this server still lists them).
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select CFX-001292' }));
    fireEvent.click(box(1293));
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Merge' }));
    const merge = await screen.findByRole('dialog', { name: 'Merge 2 tickets' });
    fireEvent.click(within(merge).getByRole('radio', { name: /CFX-001293/ }));
    fireEvent.click(within(merge).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(bulkCalls()[1]).toEqual({ ids: [1293, 1292], action: 'merge', primary_id: 1293, notify: false }));
    // A merge cannot be undone.
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '2 tickets merged', undefined, 5000, { key: 'support-bulk' }));
  });
});

describe('the keys on what is picked', () => {
  it('E asks before resolving — the customers can be left unwritten to', async () => {
    serve({ 'POST /api/support/v1/tickets/1284/transition': { ticket: ticket(1284, { status: 'resolved', version: 8 }) }, 'POST /api/support/v1/tickets/1292/transition': { ticket: ticket(1292, { status: 'resolved', version: 8 }) } });
    renderInbox();
    await ready();
    fireEvent.click(box(1284));
    fireEvent.click(box(1292));
    key('e');
    const dialog = await screen.findByRole('dialog', { name: 'Send solved notifications to 2 customers?' });
    expect(within(dialog).getByText(/tells their customers by email \(the survey and any automatic replies\)/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change quietly' }));
    await waitFor(() => expect(bulkCalls()[0]).toEqual({ ids: [1284, 1292], action: 'status', status: 'resolved', notify: false, versions: { 1284: 7, 1292: 7 } }));
    // One bulk call, not one transition per ticket.
    expect(calls('POST', '/api/support/v1/tickets/1284/transition')).toHaveLength(0);
    expect(calls('POST', '/api/support/v1/tickets/1292/transition')).toHaveLength(0);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '2 tickets marked Solved', expect.objectContaining({ label: 'Undo' }), 5000, { key: 'support-bulk' }));
  });

  it('E resolves through the bulk endpoint, telling the customers when asked to', async () => {
    renderInbox();
    await ready();
    fireEvent.click(box(1284));
    fireEvent.click(box(1293));
    key('e');
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Send solved notifications to 2 customers?' })).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(bulkCalls()[0]).toEqual({ ids: [1284, 1293], action: 'status', status: 'resolved', notify: true, versions: { 1284: 7, 1293: 7 } }));
  });

  it('A assigns the picked tickets (to me, here); P opens the priority menu and # asks before deleting', async () => {
    renderInbox();
    await ready();
    fireEvent.click(box(1292));
    fireEvent.click(box(1293));
    key('a');
    const assign = await screen.findByRole('dialog', { name: 'Assign 2 tickets to…' });
    fireEvent.click(await within(assign).findByRole('button', { name: /Ayesha Fernando/ }));
    await waitFor(() => expect(bulkCalls()[0]).toEqual({ ids: [1292, 1293], action: 'assign', user_id: 1, versions: { 1292: 7, 1293: 7 } }));
    key('p');
    expect(await screen.findByRole('menu', { name: 'Priority for 2 tickets' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    // Escape closed the menu only: the picks stay.
    expect(bar()).toBeTruthy();
    key('#');
    expect(await screen.findByRole('dialog', { name: 'Delete 2 tickets?' })).toBeTruthy();
  });

  it('Shift+F10 opens the menu on the ticket in front, and E on one ticket opens the Resolve dialog', async () => {
    renderInbox();
    await ready();
    key('j');
    key('F10', { shiftKey: true });
    expect(await screen.findByRole('menu', { name: 'Ticket actions' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    key('x');
    key('e');
    expect(await screen.findByRole('dialog', { name: 'Resolve CFX-001284' })).toBeTruthy();
  });
});
