// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The support inbox, D-01 (desktop T19): the views rail with live counts and the saved views, compact rows a page at
 * a time, the reading pane with "New since you last viewed" and an inline reply, availability, the keyboard
 * (j/k, Enter, R, N, E, /) and the realtime hints that keep it current (FR-WSP-02/03/05/06, FR-NTF-04, FR-COM-10/11).
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
const realtime = vi.hoisted(() => [] as Array<(e: unknown) => void>);
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => undefined),
  on: (channel: string, cb: (e: unknown) => void) => {
    if (channel !== 'realtime:event') return () => undefined;
    realtime.push(cb);
    return () => realtime.splice(realtime.indexOf(cb), 1);
  },
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), go: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: '/support', active: true, path: ['support'], query: new URLSearchParams(), go: nav.go, navigate: nav.navigate, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

const { ApiError, request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { toast } = await import('../../../src/core/toasts');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const { presenceWords } = await import('../../../src/modules/support/presence');
const { newSinceIndex } = await import('../../../src/modules/support/Thread');

const ticket = (id: number, over: Record<string, unknown> = {}) => ({
  id, reference: `CFX-00${id}`, subject: `Subject ${id}`, status: 'open', status_category: 'open', priority: 'normal', type: 'incident', source: 'email',
  organization: { id: 10, name: 'CreativeFX' }, requester: { name: `Requester ${id}`, email: `r${id}@acme.lk`, phone: null, kind: 'guest', user_id: null, contact_id: null, company_id: null },
  assignee: { id: 1, name: 'Ayesha Fernando' }, team: null, category: { id: 3, name: 'Licensing' }, department: null, tags: [], sla: { state: null, target: null, due_at: null, policy_id: null, paused_ms: 0 },
  due_at: null, confidential: false, unread: 0, conversation_id: null, version: 7, opened_at: '2026-10-04T09:12:00+05:30', first_response_at: null, last_customer_at: null, last_agent_at: null,
  resolved_at: null, closed_at: null, created_at: '2026-10-04T09:12:00+05:30', updated_at: '2026-10-04T09:42:00+05:30', deleted_at: null, ...over,
});
const msg = (id: number, over: Record<string, unknown> = {}) => ({ id, body: `Message ${id}`, body_html: null, author: null, author_name: 'Requester', from: 'requester', internal: false, channel: 'email', delivery_channel: null, delivery_status: null, cc: [], mentions: [], client_id: null, edited_at: null, created_at: '2026-10-04T09:12:00+05:30', ...over });
const show = (id: number, over: Record<string, unknown> = {}) => ({
  ticket: ticket(id, { unread: 2 }),
  messages: [msg(1), msg(2, { author: { id: 4, name: 'Nimal Perera' }, author_name: 'Nimal Perera', from: 'staff', internal: true, body: '@Ayesha seats missing' }), msg(3, { body: 'Affected users are kumari@' })],
  has_earlier: false, attachments: [{ id: 50, ticket_id: id, message_id: 3, name: 'roshan-mac.png', mime: 'image/png', size: 98_304, public: true, scan_status: 'clean', created_by: null, created_at: null }],
  events: [], last_read_message_id: 2, can: { view: true, reply: true, notes: true, close: true, edit: true }, transitions: ['in_progress', 'pending_customer', 'resolved'], remote_desk: null,
  ...over,
});
const VIEWS = {
  views: [
    { key: 'mine', label: 'My tickets', count: 12 },
    { key: 'unassigned', label: 'Unassigned', count: 7 },
    { key: 'overdue', label: 'Overdue', count: 3 },
    { key: 'resolved', label: 'Resolved', count: 400 },
  ],
  saved: [{ id: 3, name: 'Licensing · urgent', scope: 'shared', organization_id: 10, filters: { view: 'live', priority: 'urgent', category: '3' }, sort: 'sla', mine: false, count: 4 }],
  badges: { assigned_open: 12, unassigned: 7, overdue: 3, at_risk: 1, unread: 2 },
};

type Call = { method: string; path: string; query?: Record<string, unknown>; body?: unknown };
let served: Record<string, unknown>;
let log: Call[];
function serve(over: Record<string, unknown> = {}) {
  served = {
    'GET /api/support/v1/meta': { statuses: [], priorities: [], types: [], sources: [], views: [], sorts: ['updated', 'created', 'sla', 'priority'], organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: {} }], departments: [], teams: [], categories: [], tags: [], can: {} },
    'GET /api/support/v1/views': VIEWS,
    'GET /api/support/v1/tickets': (q: Record<string, unknown>) => (q.cursor === 'p2' ? { items: [ticket(1300)], next_cursor: null, has_more: false, sort: 'updated', view: 'mine' } : { items: [ticket(1284, { unread: 2, priority: 'urgent' }), ticket(1292), ticket(1293)], next_cursor: 'p2', has_more: true, sort: 'updated', view: 'mine' }),
    'GET /api/support/v1/tickets/1284': show(1284),
    'GET /api/support/v1/tickets/1292': show(1292, { ticket: ticket(1292, { assignee: null }), last_read_message_id: 0 }),
    'GET /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/read': {},
    'POST /api/support/v1/tickets/1284/messages': { message: msg(9), duplicate: false, ticket: ticket(1284), status_refused: null },
    'POST /api/support/v1/tickets/1284/transition': { ticket: ticket(1284, { status: 'resolved' }) },
    'GET /api/chat/presence/me': { status: 'online', choice: 'available' },
    'POST /api/chat/presence': {},
    'GET /api/support/v1/agents': { organization_id: 10, agents: [{ id: 1, name: 'Ayesha Fernando', presence: 'available', open: 12, capacity: 15, teams: [] }] },
    ...over,
  };
  log = [];
  vi.mocked(request).mockImplementation((async (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}) => {
    log.push({ method, path, query: opts.query, body: opts.body });
    const hit = served[`${method} ${path}`];
    const data = typeof hit === 'function' ? (hit as (q: Record<string, unknown>) => unknown)(opts.query ?? {}) : hit;
    if (data instanceof Error) throw data;
    if (data === undefined) return new Promise(() => undefined);
    return { data, offline: false, cachedAt: null, message: null };
  }) as never);
}
const calls = (method: string, path: string) => log.filter((c) => c.method === method && c.path === path);
const emit = (e: unknown) => act(() => realtime.slice().forEach((cb) => cb(e)));

const renderInbox = (route = '/support') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><SupportPage tabId="t1" route={route} active /></QueryClientProvider>) };
};
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });

beforeEach(() => {
  resetApiFamily();
  realtime.length = 0;
  nav.navigate.mockReset();
  nav.go.mockReset();
  vi.mocked(toast).mockReset();
  serve();
  app.set({ auth: { stage: 'ready', server: null, user: { id: '1', name: 'Ayesha Fernando', email: 'a@x', avatar: null, timezone: null, locale: null, organizationId: null, organizationName: null, timeFormat: null, weekStart: null }, message: null, setupPending: false }, status: { network: 'ONLINE', realtime: 'connected', pendingChanges: 0, unread: { mail: 0, chat: 0, notifications: 0, tasks: 0 }, notificationsPausedUntil: null, services: {}, locked: false, safeMode: false } });
  // The list is drawn only where it shows: give it a size.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 720, top: 0, left: 0, right: 600, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the rail', () => {
  it('lists the views with their live counts — overdue red, unassigned amber, history none — and the saved views', async () => {
    renderInbox();
    const rail = await screen.findByRole('navigation', { name: 'Support views' });
    await within(rail).findByText('My tickets');
    const count = (name: RegExp) => within(within(rail).getByRole('button', { name }) as HTMLElement).queryByText(/^\d+$/);
    expect(count(/My tickets/)?.textContent).toBe('12');
    expect(count(/Overdue/)?.className).toContain('bg-badge');
    expect(count(/Unassigned/)?.className).toContain('bg-warning-bg');
    expect(count(/Resolved/)).toBeNull();
    // All tickets is there too, without a count.
    expect(within(rail).getByRole('button', { name: /All tickets/ })).toBeTruthy();
    fireEvent.click(within(rail).getByRole('button', { name: /Unassigned/ }));
    expect(nav.go).toHaveBeenCalledWith('/support?view=unassigned');
    fireEvent.click(within(rail).getByRole('button', { name: /Licensing · urgent/ }));
    expect(nav.go).toHaveBeenCalledWith('/support?saved=3');
  });

  it('opens a saved view with its filters and sort', async () => {
    renderInbox('/support?saved=3');
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets').length).toBeGreaterThan(0));
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets').at(-1)!.query).toMatchObject({ view: 'live', priority: 'urgent', category: '3', sort: 'sla' }));
    expect(await screen.findByRole('heading', { name: 'Licensing · urgent' })).toBeTruthy();
  });

  it('shows my availability and capacity, and switches it — also with ⌥⌘A (Ctrl+Alt+A here)', async () => {
    renderInbox();
    const group = await screen.findByRole('radiogroup', { name: 'Availability' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: /Online/ }).getAttribute('aria-checked')).toBe('true'));
    expect(await screen.findByText('12 / 15 capacity')).toBeTruthy();
    fireEvent.click(within(group).getByRole('radio', { name: /Away/ }));
    await waitFor(() => expect(calls('POST', '/api/chat/presence')[0]?.body).toEqual({ status: 'away', active: true }));
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA', ctrlKey: true, altKey: true });
    await waitFor(() => expect(calls('POST', '/api/chat/presence')).toHaveLength(2));
  });

  it('has no availability for somebody without Chat’s presence', async () => {
    serve({ 'GET /api/chat/presence/me': new ApiError(403, 'No chat', null) });
    renderInbox();
    await screen.findByText('Subject 1284');
    expect(screen.queryByRole('radiogroup', { name: 'Availability' })).toBeNull();
  });
});

describe('the list', () => {
  it('shows compact rows — status, channel, reference, priority, requester — unread in bold, and pages with the cursor', async () => {
    renderInbox();
    const list = await screen.findByRole('listbox', { name: 'My tickets' });
    const first = await within(list).findByText('Subject 1284');
    expect(first.className).toContain('font-bold');
    expect(within(list).getByText('Subject 1292').className).not.toContain('font-bold');
    const row = first.closest('[role="option"]') as HTMLElement;
    expect(within(row).getByRole('img', { name: 'Open' })).toBeTruthy();
    expect(within(row).getByRole('img', { name: 'Email' })).toBeTruthy();
    expect(within(row).getByText('CFX-001284').className).toContain('font-mono');
    expect(within(row).getByText('Urgent')).toBeTruthy();
    expect(within(row).getByText('Requester 1284 · Guest')).toBeTruthy();
    expect(screen.getByText('12 open')).toBeTruthy();
    expect(screen.getByText('live')).toBeTruthy();
    // Near the end of the page: the next one, with the server's cursor.
    expect(await within(list).findByText('Subject 1300')).toBeTruthy();
    expect(calls('GET', '/api/support/v1/tickets').map((c) => c.query?.cursor)).toEqual([undefined, 'p2']);
  });

  it('searches as I type, and filters by status and priority', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), { target: { value: 'licence' } });
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets').at(-1)!.query).toMatchObject({ q: 'licence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Pending customer/ }));
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets').at(-1)!.query).toMatchObject({ status: 'pending_customer', q: 'licence' }));
    expect(screen.getByRole('button', { name: 'Filters (1 on)' })).toBeTruthy();
  });

  it('opens a ticket in its own tab with a double-click', async () => {
    renderInbox();
    fireEvent.doubleClick(await screen.findByText('Subject 1292'));
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1292');
  });
});

describe('the reading pane', () => {
  it('shows the ticket with notes marked internal, its files, and "New since you last viewed" after my marker', async () => {
    renderInbox();
    fireEvent.click(await screen.findByText('Subject 1284'));
    const pane = await screen.findByRole('article', { name: 'Ticket CFX-001284' });
    expect(within(pane).getByRole('heading', { name: 'Subject 1284' })).toBeTruthy();
    expect(within(pane).getByText(/^Email · opened .+ · Licensing$/)).toBeTruthy();
    const thread = within(pane).getByRole('list', { name: 'Conversation' });
    const items = Array.from(thread.children).map((li) => (li.hasAttribute('data-new-since') ? 'divider' : li.getAttribute('data-message')));
    expect(items).toEqual(['1', '2', 'divider', '3']);
    expect(within(thread).getByText('Internal note')).toBeTruthy();
    expect(within(thread).getByText('roshan-mac.png')).toBeTruthy();
    // Peeked: reading it is said once it has been shown for a moment.
    expect(calls('GET', '/api/support/v1/tickets/1284')[0]!.query).toEqual({ peek: 1 });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/read')[0]?.body).toEqual({ message_id: 3 }), { timeout: 3000 });
    // And that I am here (FR-COM-11).
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/presence')[0]?.body).toEqual({ state: 'viewing' }), { timeout: 3000 });
  });

  it('replies inline: a note unless I choose a reply, sent with ⌘↵ (Ctrl+Enter) and a retry key', async () => {
    renderInbox();
    fireEvent.click(await screen.findByText('Subject 1284'));
    const pane = await screen.findByRole('article', { name: 'Ticket CFX-001284' });
    expect(within(pane).getByRole('radio', { name: 'Internal note' }).getAttribute('aria-checked')).toBe('true');
    editReply(within(pane).getByRole('textbox', { name: 'Internal note' }), 'Checked the partner centre');
    fireEvent.keyDown(within(pane).getByRole('textbox', { name: 'Internal note' }), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(1));
    const body = calls('POST', '/api/support/v1/tickets/1284/messages')[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ body: 'Checked the partner centre', internal: true });
    expect(String(body.client_id)).toMatch(/^desk:/);
    fireEvent.click(within(pane).getByRole('radio', { name: 'Reply to requester' }));
    editReply(within(pane).getByRole('textbox', { name: /Reply to Requester 1284/ }), 'Thanks');
    fireEvent.click(within(pane).getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(2));
    expect(calls('POST', '/api/support/v1/tickets/1284/messages')[1]!.body).toMatchObject({ body: 'Thanks', internal: false });
  });

  it('takes an unassigned ticket', async () => {
    serve({ 'POST /api/support/v1/tickets/1292/take': { ticket: ticket(1292) } });
    renderInbox();
    fireEvent.click(await screen.findByText('Subject 1292'));
    fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1292/take')[0]?.body).toEqual({ version: 7 }));
  });
});

describe('the keyboard (FR-WSP-06)', () => {
  it('j and k move, Enter opens the tab, / searches', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    key('j');
    expect(await screen.findByRole('article', { name: 'Ticket CFX-001284' })).toBeTruthy();
    key('j');
    expect(await screen.findByRole('article', { name: 'Ticket CFX-001292' })).toBeTruthy();
    key('k');
    expect(await screen.findByRole('article', { name: 'Ticket CFX-001284' })).toBeTruthy();
    key('Enter');
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1284');
    key('/');
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search tickets' }));
    // Typed into the search box, j is a letter, not a move.
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    expect(screen.getByRole('article', { name: 'Ticket CFX-001284' })).toBeTruthy();
  });

  it('R and N start a reply or a note in the reading pane', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    key('j');
    const pane = await screen.findByRole('article', { name: 'Ticket CFX-001284' });
    key('r');
    await waitFor(() => expect(within(pane).getByRole('radio', { name: 'Reply to requester' }).getAttribute('aria-checked')).toBe('true'));
    expect(document.activeElement?.getAttribute('contenteditable')).toBe('true');
    (document.activeElement as HTMLElement).blur();
    key('n');
    await waitFor(() => expect(within(pane).getByRole('radio', { name: 'Internal note' }).getAttribute('aria-checked')).toBe('true'));
  });

  it('E resolves, with the version the screen showed', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    key('j');
    await screen.findByRole('article', { name: 'Ticket CFX-001284' });
    key('e');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Seats reassigned' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/transition')[0]?.body).toEqual({ status: 'resolved', version: 7, resolution_summary: 'Seats reassigned' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'CFX-001284 resolved.'));
  });

  it('says so when somebody changed the ticket first', async () => {
    serve({ 'POST /api/support/v1/tickets/1284/transition': new ApiError(409, 'Changed', 'VERSION_CONFLICT', { ticket: ticket(1284, { version: 9 }) }) });
    renderInbox();
    await screen.findByText('Subject 1284');
    key('j');
    await screen.findByRole('article', { name: 'Ticket CFX-001284' });
    key('e');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('warning', expect.stringContaining('changed by somebody else')));
  });
});

describe('realtime (FR-NTF-04, §12.2)', () => {
  it('a desk hint asks the list, the counts and the badges again — once for a burst', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    const before = { list: calls('GET', '/api/support/v1/tickets').length, views: calls('GET', '/api/support/v1/views').length };
    emit({ type: 'support.changed', organization_id: 10, kind: 'message' });
    emit({ type: 'support.changed', organization_id: 10, kind: 'status' });
    emit({ type: 'support.changed', organization_id: 10, kind: 'assigned' });
    await waitFor(() => expect(calls('GET', '/api/support/v1/views').length).toBe(before.views + 1));
    // The list's pages are asked again (two pages loaded: two requests), once.
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets').length).toBe(before.list + 2));
  });

  it('a ticket hint asks that ticket again; a presence hint shows who else is on it', async () => {
    renderInbox();
    fireEvent.click(await screen.findByText('Subject 1284'));
    const pane = await screen.findByRole('article', { name: 'Ticket CFX-001284' });
    const n = calls('GET', '/api/support/v1/tickets/1284').length;
    emit({ type: 'support.ticket', kind: 'message', ticket_id: 1284, reference: 'CFX-001284', version: 8, message_id: 10, internal: false, from: 'requester', mentioned: false });
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets/1284').length).toBe(n + 1));
    emit({ type: 'support.presence', ticket_id: 1284, present: [{ user_id: 4, name: 'Nimal Perera', state: 'typing', mode: 'note', since: null }] });
    expect(await within(pane).findByText('Nimal is typing a note…')).toBeTruthy();
  });

  it('polls without the gateway, and says "live" only with it', async () => {
    app.set({ status: { ...app.get().status!, realtime: 'down' } });
    renderInbox();
    await screen.findByText('Subject 1284');
    expect(screen.queryByText('live')).toBeNull();
  });
});

describe('the parts', () => {
  it('words who else is on a ticket', () => {
    expect(presenceWords([])).toBeNull();
    expect(presenceWords([{ user_id: 4, name: 'Nimal Perera', state: 'viewing', mode: null, since: null }])).toBe('Nimal is viewing');
    expect(presenceWords([{ user_id: 4, name: 'Nimal Perera', state: 'viewing', mode: null, since: null }, { user_id: 5, name: 'Kavindi S', state: 'viewing', mode: null, since: null }])).toBe('Nimal and 1 more are viewing');
    expect(presenceWords([{ user_id: 5, name: 'Kavindi S', state: 'typing', mode: 'reply', since: null }])).toBe('Kavindi is typing a reply…');
  });

  it('puts "New since you last viewed" above the first message somebody else wrote after my marker', () => {
    const ms = [msg(1), msg(2, { author: { id: 1, name: 'Me' }, from: 'staff' }), msg(3)] as never[];
    expect(newSinceIndex(ms, 1, 1)).toBe(2);
    expect(newSinceIndex(ms, 1, null)).toBe(1);
    expect(newSinceIndex(ms, 0, 1)).toBe(-1);
    expect(newSinceIndex(ms, 3, 1)).toBe(-1);
  });
});

function editReply(box: HTMLElement, value: string): void {
  box.textContent = value; box.focus();
  const range = document.createRange(); range.selectNodeContents(box); range.collapse(false);
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  fireEvent.input(box);
}
