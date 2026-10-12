// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The ticket list's right-click menu and multi-select bulk actions (worksuite-desktop#333): the grouped menu, filtered
 * by permission with the current values ticked; picking with ⌘, ⇧, X and ⌘A and "Select all matching"; the bulk bar;
 * bulk changes with Undo, asking before customers are emailed, in batches past 50; the keyboard and its `?` popover;
 * the count in the view's terms; the green dot's tooltip; and a meaningful subject for a chat's ticket.
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
const nav = vi.hoisted(() => ({ navigate: vi.fn(), go: vi.fn(), openInWindow: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: '/support', active: true, path: ['support'], query: new URLSearchParams(), go: nav.go, navigate: nav.navigate, openInNewTab: () => undefined, openInWindow: nav.openInWindow, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

const { request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { toast } = await import('../../../src/core/toasts');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const bulkLib = await import('../../../src/modules/support/bulk');
const { countWords } = await import('../../../src/modules/support/TicketList');
const { plainSubject, meaningful } = await import('../../../src/modules/support/Subject');
const { statusDotTitle } = await import('../../../src/modules/support/parts');

const ALL_CAPS = { view: true, reply: true, notes: true, assign: true, edit: true, close: true, reopen: true, escalate: true, merge: true, delete: true };
const ticket = (id: number, over: Record<string, unknown> = {}) => ({
  id, reference: `CFX-00${id}`, subject: `Subject ${id}`, status: 'open', status_category: 'open', priority: 'normal', type: 'incident', source: 'email',
  organization: { id: 10, name: 'CreativeFX' }, requester: { name: `Requester ${id}`, email: `r${id}@acme.lk`, phone: null, kind: 'guest', user_id: null, contact_id: null, company_id: null },
  assignee: { id: 1, name: 'Ayesha Fernando' }, team: null, category: null, department: null, tags: [], sla: { state: null, target: null, due_at: null, policy_id: null, paused_ms: 0 },
  due_at: null, confidential: false, unread: 0, conversation_id: null, version: 7, opened_at: null, first_response_at: null, last_customer_at: null, last_agent_at: null,
  resolved_at: null, closed_at: null, created_at: '2026-10-04T09:12:00+05:30', updated_at: '2026-10-04T09:42:00+05:30', deleted_at: null, watching: false, snoozed_until: null, ...over,
});
const before = (over: Record<string, unknown> = {}) => ({ status: 'open', priority: 'normal', assignee_id: 1, team_id: null, tags: [], snoozed_until: null, deleted: false, ...over });

type Call = { method: string; path: string; query?: Record<string, unknown>; body?: unknown };
let served: Record<string, unknown>;
let log: Call[];
function serve(over: Record<string, unknown> = {}, caps: Record<string, boolean> = ALL_CAPS) {
  served = {
    'GET /api/support/v1/meta': { statuses: [], priorities: [], types: [], sources: [], views: [], sorts: ['updated'], organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: caps }], departments: [], teams: [{ id: 4, name: 'Licensing desk', organization_id: 10, department_id: null, tier: 1 }], categories: [], tags: [{ name: 'vip', organization_id: null }], can: caps },
    'GET /api/support/v1/views': { views: [{ key: 'mine', label: 'My tickets', count: 120 }, { key: 'resolved', label: 'Resolved', count: 1 }], saved: [], badges: null },
    'GET /api/support/v1/tickets': { items: [ticket(1284, { unread: 2, priority: 'urgent' }), ticket(1292, { requester: { name: 'No mail', email: null, phone: null, kind: 'guest', user_id: null, contact_id: null, company_id: null } }), ticket(1293)], next_cursor: 'p2', has_more: false, sort: 'updated', view: 'mine' },
    'GET /api/support/v1/tickets/ids': { ids: [1284, 1292, 1293, 1300, 1301], total: 120, view: 'mine' },
    'POST /api/support/v1/tickets/bulk': (q: unknown, body: { ids: number[]; action: string }) => ({ results: body.ids.map((id) => ({ id, ok: true, version: 8, before: before() })), done: body.ids.length, refused: 0 }),
    'GET /api/support/v1/agents': { agents: [{ id: 5, name: 'Ruwan Bandara', presence: 'available', open: 3, capacity: 10, teams: [] }] },
    'GET /api/chat/presence/me': { status: 'online', choice: 'available' },
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
const bulkBodies = () => calls('POST', '/api/support/v1/tickets/bulk').map((c) => c.body as Record<string, unknown>);

const renderInbox = (route = '/support') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupportPage tabId="t1" route={route} active />
    </QueryClientProvider>,
  );
};
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });
/** A menu item by its name, whichever kind of item it is (plain, checkbox or radio). */
const itemIn = (menu: HTMLElement, name: RegExp) => [...within(menu).queryAllByRole('menuitem', { name }), ...within(menu).queryAllByRole('menuitemcheckbox', { name }), ...within(menu).queryAllByRole('menuitemradio', { name })][0] ?? null;
const rowOf = (subject: string) => screen.getByText(subject).closest('[role="option"]') as HTMLElement;

beforeEach(() => {
  resetApiFamily();
  nav.navigate.mockReset();
  vi.mocked(toast).mockReset();
  serve();
  app.set({ auth: { stage: 'ready', server: null, user: { id: '1', name: 'Ayesha Fernando', email: 'a@x', avatar: null, timezone: null, locale: null, organizationId: null, organizationName: null, timeFormat: null, weekStart: null }, message: null, setupPending: false }, status: { network: 'ONLINE', realtime: 'connected', pendingChanges: 0, unread: { mail: 0, chat: 0, notifications: 0, tasks: 0 }, notificationsPausedUntil: null, services: {}, locked: false, safeMode: false } });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 720, top: 0, left: 0, right: 600, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the right-click menu', () => {
  it('opens on a ticket with every group, the current values ticked', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    fireEvent.contextMenu(rowOf('Subject 1284'), { clientX: 40, clientY: 50 });
    const menu = await screen.findByRole('menu', { name: 'Ticket actions' });
    for (const item of ['Open', 'Open in new tab', 'Open in new window', 'Status', 'Assign to me', 'Assign to…', 'Unassign', 'Priority', 'Add tag…', 'Move to queue / group…', 'Follow', 'Mark as read', 'Snooze until…', 'Merge into another ticket…', 'Link to…', 'Create task from ticket', 'Reply', 'Add internal note', 'Apply macro / saved reply…', 'Copy ticket ID', 'Copy link', 'Print', 'Export (PDF)', 'Mark as spam', 'Delete…'])
      expect(itemIn(menu, new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)), item).toBeTruthy();
    // Assigned to me already: ticked.
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Assign to me/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Priority/ }));
    expect((await screen.findByRole('menuitemradio', { name: 'Urgent' })).getAttribute('aria-checked')).toBe('true');
  });

  it('hides what I may not do', async () => {
    serve({}, { view: true, reply: true, notes: true });
    renderInbox();
    await screen.findByText('Subject 1284');
    fireEvent.contextMenu(rowOf('Subject 1284'));
    const menu = await screen.findByRole('menu', { name: 'Ticket actions' });
    expect(within(menu).queryByRole('menuitem', { name: /^Delete/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Mark as spam/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /^Priority/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Assign to…/ })).toBeNull();
    expect(itemIn(menu, /Assign to me/)).toBeTruthy();
  });

  it('acts on the whole selection when the row is one of it, with Undo', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    fireEvent.click(rowOf('Subject 1284'), { ctrlKey: true });
    fireEvent.click(rowOf('Subject 1293'), { ctrlKey: true });
    fireEvent.contextMenu(rowOf('Subject 1293'));
    const menu = await screen.findByRole('menu', { name: 'Actions for 2 tickets' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Priority/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'High' }));
    await waitFor(() => expect(bulkBodies()[0]).toMatchObject({ action: 'priority', priority: 'high', ids: [1284, 1293] }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '2 tickets set to High', expect.objectContaining({ label: 'Undo' }), 5000, { key: 'support-bulk' }));
    const undo = vi.mocked(toast).mock.calls.find((c) => c[1] === '2 tickets set to High')![2]!;
    act(() => undo.run());
    await waitFor(() => expect(bulkBodies()[1]).toMatchObject({ action: 'priority', priority: 'normal', ids: [1284, 1293], reason: 'Undo' }));
  });
});

describe('picking several tickets and the bulk bar', () => {
  it('⌘/Ctrl toggles, ⇧ picks a range, the bar replaces the title, Esc clears', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    expect(screen.getByText('· 120 tickets')).toBeTruthy();
    fireEvent.click(rowOf('Subject 1284'), { ctrlKey: true });
    fireEvent.click(rowOf('Subject 1293'), { shiftKey: true });
    const bar = await screen.findByRole('toolbar', { name: 'Bulk actions' });
    expect(within(bar).getByText('3 selected')).toBeTruthy();
    for (const b of ['Status', 'Assign', 'Priority', 'Tag', 'Merge', 'Snooze', 'More actions', 'Clear']) expect(within(bar).getByRole('button', { name: new RegExp(b) })).toBeTruthy();
    expect(within(rowOf('Subject 1292')).getByRole('checkbox', { name: 'Select CFX-001292' })).toBeTruthy();
    key('Escape');
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());
  });

  it('⌘A picks the view, and "Select all matching" every ticket the list matches', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    key('a', { ctrlKey: true });
    const bar = await screen.findByRole('toolbar', { name: 'Bulk actions' });
    expect(within(bar).getByText('3 selected')).toBeTruthy();
    expect(screen.getByText('All 3 on this page selected.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select all 120 tickets in My tickets' }));
    await waitFor(() => expect(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByText('5 selected')).toBeTruthy());
    expect(calls('GET', '/api/support/v1/tickets/ids')[0]?.query).toMatchObject({ view: 'mine' });
  });

  it('a bulk Solve asks before emailing customers — Change quietly sends notify false', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    key('a', { ctrlKey: true });
    fireEvent.click(within(await screen.findByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: /Status/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Solved' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send solved notifications to 2 customers?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change quietly' }));
    await waitFor(() => expect(bulkBodies()[0]).toMatchObject({ action: 'status', status: 'resolved', notify: false, ids: [1284, 1292, 1293] }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '3 tickets marked Solved', expect.objectContaining({ label: 'Undo' }), 5000, expect.anything()));
  });

  it('merges into the main ticket chosen, telling the requesters when asked', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    fireEvent.click(rowOf('Subject 1284'), { ctrlKey: true });
    fireEvent.click(rowOf('Subject 1292'), { ctrlKey: true });
    fireEvent.click(within(await screen.findByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Merge' }));
    const dialog = await screen.findByRole('dialog', { name: 'Merge 2 tickets' });
    fireEvent.click(within(dialog).getAllByRole('radio')[1]!);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(bulkBodies()[0]).toMatchObject({ action: 'merge', primary_id: 1292, notify: true, ids: [1292, 1284] }));
  });

  it('runs a change of more than 50 tickets in batches, with progress', async () => {
    const results: number[][] = [];
    const sent: Array<{ ids: number[]; of?: number }> = [];
    const send = vi.fn(async (_a: string, ids: number[], _f: unknown, of?: number) => {
      sent.push({ ids, of });
      return { results: ids.map((id) => ({ id, ok: true })), done: ids.length, refused: 0 };
    });
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const progress: number[] = [];
    const out = await bulkLib.bulkInBatches('status', ids, { status: 'resolved' }, (p) => progress.push(p.done), send as never);
    results.push(out.map((r) => r.id));
    expect(sent.map((s) => s.ids.length)).toEqual([50, 50, 20]);
    expect(sent.every((s) => s.of === 120)).toBe(true);
    expect(progress).toEqual([50, 100, 120]);
    expect(results[0]).toHaveLength(120);
  });
});

describe('the keyboard', () => {
  it('X picks, ⇧X the range, A assigns, P the priority, # deletes after asking, ? shows the keys', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    key('j');
    key('x');
    key('j');
    key('j');
    key('X', { shiftKey: true });
    expect(within(await screen.findByRole('toolbar', { name: 'Bulk actions' })).getByText('3 selected')).toBeTruthy();
    key('a');
    const assign = await screen.findByRole('dialog', { name: 'Assign 3 tickets to…' });
    fireEvent.click(await within(assign).findByRole('button', { name: /Ruwan Bandara/ }));
    await waitFor(() => expect(bulkBodies()[0]).toMatchObject({ action: 'assign', user_id: 5, ids: [1284, 1292, 1293] }));
    key('p');
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Low' }));
    await waitFor(() => expect(bulkBodies()[1]).toMatchObject({ action: 'priority', priority: 'low' }));
    key('#');
    const del = await screen.findByRole('dialog', { name: 'Delete 3 tickets?' });
    fireEvent.click(within(del).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(bulkBodies()[2]).toMatchObject({ action: 'delete' }));
    key('?');
    const keys = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const what of ['Move down and up the list', 'Select the ticket', 'Select the range from the last one picked', 'Solve', 'Assign', 'Priority', 'Delete (asks first)', 'Clear the selection']) expect(within(keys).getByText(what)).toBeTruthy();
  });
});

describe('the parts', () => {
  it('builds the menu from the caps, ticking the current values', () => {
    const t = ticket(1, { status: 'resolved', priority: 'high', watching: true }) as never;
    const meta = { organizations: [{ id: 10, name: 'C', prefix: 'C', can: { reply: true, close: true, reopen: true } }], can: {}, teams: [] } as never;
    const h = new Proxy({}, { get: () => vi.fn() }) as never;
    const sections = bulkLib.ticketMenu([t], { meta, me: 1 }, h);
    const ids = sections.map((s) => s.id);
    expect(ids).toEqual(['open', 'status', 'assign', 'organise', 'link', 'respond', 'other']);
    const status = sections.find((s) => s.id === 'status')!.items[0]!.submenu![0]!.items;
    expect(status.map((i) => i.label)).toEqual(['Open', 'Solved', 'Closed']);
    expect(status.find((i) => i.label === 'Solved')!.checked).toBe(true);
    expect(sections.find((s) => s.id === 'organise')!.items.find((i) => i.id === 'follow')!.label).toBe('Unfollow');
  });

  it('plans Undo from what each ticket was, as far as the state machine allows', () => {
    const r = (id: number, b: Record<string, unknown>) => ({ id, ok: true, before: before(b) as never });
    // From Solved only Open (or Closed) is a move: each comes back Open, in one call.
    expect(bulkLib.undoCalls('status', { status: 'resolved' }, [r(1, { status: 'open' }), r(2, { status: 'new' }), r(3, { status: 'pending_customer' })])).toEqual([
      { action: 'status', ids: [1, 2, 3], fields: { reason: 'Undo', status: 'open', notify: false } },
    ]);
    expect(bulkLib.undoCalls('status', { status: 'pending_customer' }, [r(1, { status: 'open' }), r(2, { status: 'in_progress' })])).toEqual([
      { action: 'status', ids: [1], fields: { reason: 'Undo', status: 'open', notify: false } },
      { action: 'status', ids: [2], fields: { reason: 'Undo', status: 'in_progress', notify: false } },
    ]);
    expect(bulkLib.undoCalls('assign', { user_id: 5 }, [r(1, { assignee_id: null }), r(2, { assignee_id: 1 })])).toEqual([
      { action: 'assign', ids: [1], fields: { reason: 'Undo', user_id: null } },
      { action: 'assign', ids: [2], fields: { reason: 'Undo', user_id: 1 } },
    ]);
    expect(bulkLib.undoCalls('tag', { tags: ['vip'] }, [r(1, { tags: [] }), r(2, { tags: ['vip'] })])).toEqual([{ action: 'untag', ids: [1], fields: { reason: 'Undo', tags: ['vip'] } }]);
    expect(bulkLib.undoCalls('delete', {}, [r(1, {})])).toEqual([{ action: 'restore', ids: [1], fields: { reason: 'Undo' } }]);
    expect(bulkLib.undoCalls('merge', {}, [r(1, {})])).toEqual([]);
    expect(bulkLib.undoStatus('closed', 'open')).toEqual({ status: 'open', override: true });
  });

  it('counts customers to tell, words the count by the view, and explains the dot', () => {
    expect(bulkLib.notifyCount([ticket(1) as never, ticket(2, { requester: { email: null } }) as never, ticket(3, { status: 'resolved' }) as never], 'resolved')).toBe(1);
    expect(bulkLib.notifyCount([ticket(1) as never], 'pending_customer')).toBe(0);
    expect(countWords(1, false, 1, false)).toBe('1 ticket');
    expect(countWords(128, false, 50, true)).toBe('128 tickets');
    expect(countWords(128, true, 12, true)).toBe('12+ listed');
    expect(statusDotTitle('resolved')).toBe('Status: Resolved — Solved: waiting for the customer to confirm, or to close by itself');
  });

  it('suggests a subject from the first meaningful thing the customer said', () => {
    const m = (body: string, from = 'requester') => ({ body, from, internal: false }) as never;
    expect(plainSubject([m('Hi,'), m('Are you there?'), m('I can’t download Microsoft Project 2024. It shows an error.'), m('Order number 46497')])).toBe('Order 46497 – I can’t download Microsoft Project 2024');
    expect(plainSubject([m('Hi,')])).toBeNull();
    expect(meaningful('Hello, my licence key fails')).toBe(true);
    expect(meaningful('Good morning')).toBe(false);
  });
});
