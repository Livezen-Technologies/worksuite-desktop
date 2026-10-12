// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as TextTools from '../../../src/modules/ai/textTools';

/**
 * The ticket details drawer (worksuite-desktop#334): Website chats' side panel in a ticket's tab — ⌘⇧I, kept width,
 * open by itself on a wide window and over the conversation on a narrow one — with the AI summary (key facts, next
 * step with Reply with this, urgency, Refresh, made again when a message arrives), the client edited in place with
 * checks and "Saved", details found in the conversation, the WorkSuite contact, the ticket's properties, related
 * orders with Resend licence, earlier tickets and chats, website activity, files, and the activity timeline.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn(), apiGet: vi.fn() }));
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
const nav = vi.hoisted(() => ({ navigate: vi.fn(), go: vi.fn(), openLink: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't2', route: '/support/ticket/1284', active: true, path: ['support', 'ticket', '1284'], query: new URLSearchParams(), go: nav.go, navigate: nav.navigate, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: nav.openLink }),
  useTabTitle: () => undefined,
}));
const ai = vi.hoisted(() => ({ engine: 'local' as 'local' | null, run: vi.fn() }));
vi.mock('../../../src/modules/ai/textTools', async (orig) => ({
  ...(await orig<typeof TextTools>()),
  useTextAi: () => ({ engine: ai.engine, why: ai.engine ? null : 'No AI', fallback: false, settled: true, run: ai.run }),
}));

const { ApiError, apiGet, request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { toast } = await import('../../../src/core/toasts');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const details = await import('../../../src/modules/support/details');

const BRIEF = `SUMMARY:
Zacky (order 46497) can't download or activate Microsoft Project 2024. The download shows an error. Waiting for the customer to confirm the new link.
FACTS:
- Order 46497
- Product: Microsoft Project 2024 Professional LTSC
- Error on download
NEXT:
Ask the customer if the new link works
URGENCY:
Wants it fixed today`;

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 1284, reference: 'TKT-000004', subject: 'Order 46497 – download error', status: 'open', status_category: 'open', priority: 'normal', type: 'question', source: 'chat',
  organization: { id: 10, name: 'CreativeFX' }, requester: { name: 'Visitor 12', email: 'zacky.hannan@gmail.com', phone: null, kind: 'guest', user_id: null, contact_id: null, company_id: null },
  assignee: { id: 1, name: 'Ayesha Fernando' }, team: null, category: null, department: null, tags: [], sla: { state: null, target: null, due_at: null, policy_id: null, paused_ms: 0 },
  due_at: null, confidential: false, unread: 0, conversation_id: 77, version: 7, opened_at: '2026-10-10T06:30:00Z', first_response_at: null, last_customer_at: null, last_agent_at: null,
  resolved_at: null, closed_at: null, created_at: '2026-10-10T06:30:00Z', updated_at: '2026-10-10T06:40:00Z', deleted_at: null, watchers: [], merged_into: null, sla_timers: [],
  ...over,
});
const msg = (id: number, body: string, over: Record<string, unknown> = {}) => ({ id, body, body_html: null, author: null, author_name: 'Zacky', from: 'requester', internal: false, channel: 'chat', delivery_channel: null, delivery_status: null, cc: [], mentions: [], client_id: null, edited_at: null, created_at: '2026-10-10T06:30:00Z', ...over });
const MESSAGES = [msg(1, 'Hi,'), msg(2, 'I cannot download Project 2024. My email address is zacky.hannan@gmail.com, call me on 0770584763'), msg(3, 'Order number 46497'), msg(4, 'Here is a new download link', { from: 'staff', author: { id: 1, name: 'Ayesha Fernando' }, author_name: 'Ayesha Fernando' })];
const show = (over: Record<string, unknown> = {}) => ({
  ticket: ticket(), messages: MESSAGES, has_earlier: false,
  attachments: [{ id: 50, ticket_id: 1284, message_id: 2, name: 'error.png', mime: 'image/png', size: 1000, public: true, scan_status: 'clean', created_by: null, created_at: null }],
  events: [{ id: 9, action: 'opened', detail: 'chat', field: null, old: null, new: null, source: 'agent', reason: null, user: { id: 1, name: 'Ayesha Fernando' }, created_at: '2026-10-10T06:30:00Z' }],
  last_read_message_id: 4, can: { view: true, reply: true, notes: true, edit: true, assign: true, close: true }, transitions: ['resolved'], remote_desk: null, ...over,
});
const CLIENT = (over: Record<string, unknown> = {}) => ({
  client: {
    requester: { name: 'Visitor 12', email: 'zacky.hannan@gmail.com', phone: null }, contact: null, contact_hidden: false,
    matches: [{ id: 31, name: 'Zacky Hannan', email: 'zacky.hannan@gmail.com', phone: null, company: null, tags: [], notes: null, link: '/contacts/31' }],
    visitor: { id: 12, language: 'en', timezone: 'Asia/Colombo', country: 'Sri Lanka', city: null, website: 'techubiz.com' },
    can: { edit: true, create_contact: true, link_contact: true, unlink_contact: false }, default_country: '94', ...over,
  },
});
const CONTACT = { id: 31, name: 'Zacky', email: 'zacky.hannan@gmail.com', phone: '+94770584763', company: 'Hannan Traders', tags: ['Customer'], notes: null, link: '/contacts/31' };
const RELATED = {
  orders: [{ id: 91, number: 'SO-0091', store_number: '46497', source: 'woocommerce', date: '2026-10-09', status: 'completed', total: 18500, currency: 'LKR', payment_status: 'paid', products: ['Microsoft Project 2024 Professional LTSC'], licence: 'active', can_resend: true, link: '/oms/orders/91' }],
  tickets: [{ id: 1201, reference: 'TKT-000001', subject: 'Earlier licence question', status: 'resolved', source: 'email', created_at: '2026-09-01T00:00:00Z' }],
  chats: [{ id: 70, status: 'closed', started_at: '2026-09-01T09:00:00Z', website: 'techubiz.com' }],
  pages: [{ url: 'https://techubiz.com/downloads', title: 'Downloads', at: '2026-10-10T06:29:00Z' }],
};

type Call = { method: string; path: string; query?: Record<string, unknown>; body?: unknown };
let served: Record<string, unknown>;
let log: Call[];
function serve(over: Record<string, unknown> = {}) {
  served = {
    'GET /api/support/v1/meta': { statuses: [], priorities: [], types: ['question', 'problem', 'request'], sources: [], views: [], sorts: [], organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: {} }], departments: [], teams: [], categories: [], tags: [], can: {} },
    'GET /api/support/v1/tickets/1284': show(),
    'GET /api/support/v1/tickets/1284/links': { links: [] },
    'GET /api/support/v1/tickets/1284/client': CLIENT(),
    'GET /api/support/v1/tickets/1284/related': RELATED,
    'GET /api/support/v1/tickets': { items: [], next_cursor: null, has_more: false, sort: 'updated', view: 'all' },
    'GET /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/read': {},
    'PATCH /api/support/v1/tickets/1284/client': (_q: unknown, body: Record<string, unknown>) => ({ client: CLIENT({ contact: { ...CONTACT, ...body } }).client, ticket: ticket({ version: 8 }), changed: Object.keys(body) }),
    'POST /api/support/v1/tickets/1284/contact': { client: CLIENT({ contact: CONTACT, matches: [], can: { edit: true, create_contact: false, link_contact: false, unlink_contact: true } }).client, ticket: ticket({ version: 8 }) },
    'POST /api/support/v1/tickets/1284/orders/91/resend-licence': { order: RELATED.orders[0] },
    'POST /api/support/v1/tickets/1284/ai/summary': { text: 'The desk’s own summary.', model: null, cached: false, at: '2026-10-10T07:00:00Z' },
    'GET /api/support/v1/agents': { agents: [] },
    'GET /api/chat/presence/me': { status: 'online', choice: 'available' },
    ...over,
  };
  log = [];
  const answer = async (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> } = {}) => {
    // The local copy (`X-WS-Local-Read`) is empty here: the server answers.
    if (opts.headers?.['X-WS-Local-Read']) throw new ApiError(404, 'No local copy', null);
    log.push({ method, path, query: opts.query, body: opts.body });
    const hit = served[`${method} ${path}`];
    const data = typeof hit === 'function' ? (hit as (q: unknown, b: unknown) => unknown)(opts.query ?? {}, opts.body) : hit;
    if (data instanceof Error) throw data;
    if (data === undefined) return new Promise(() => undefined);
    return { data, offline: false, cachedAt: null, message: null };
  };
  vi.mocked(request).mockImplementation(answer as never);
  vi.mocked(apiGet).mockImplementation((async (path: string, query?: Record<string, unknown>) => ((await answer('GET', path, { query })) as { data: unknown }).data) as never);
}
const calls = (method: string, path: string) => log.filter((c) => c.method === method && c.path === path);

const renderTab = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><SupportPage tabId="t2" route="/support/ticket/1284" active /></QueryClientProvider>) };
};
const wide = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
const drawer = () => screen.findByRole('complementary', { name: 'Ticket details' });

beforeEach(() => {
  resetApiFamily();
  localStorage.clear();
  wide(1440);
  nav.navigate.mockReset();
  nav.openLink.mockReset();
  vi.mocked(toast).mockReset();
  ai.engine = 'local';
  ai.run.mockReset();
  ai.run.mockImplementation(() => ({ done: Promise.resolve({ text: BRIEF, engine: 'local' }), cancel: () => undefined }));
  serve();
  app.set({ auth: { stage: 'ready', server: null, user: { id: '1', name: 'Ayesha Fernando', email: 'a@x', avatar: null, timezone: null, locale: null, organizationId: null, organizationName: null, timeFormat: null, weekStart: null }, message: null, setupPending: false }, status: { network: 'ONLINE', realtime: 'connected', pendingChanges: 0, unread: { mail: 0, chat: 0, notifications: 0, tasks: 0 }, notificationsPausedUntil: null, services: {}, locked: false, safeMode: false } });
});
afterEach(() => {
  cleanup();
});

describe('the drawer', () => {
  it('opens by itself on a wide window with its five sections, and ⌘⇧I (Ctrl+Shift+I) hides and shows it', async () => {
    renderTab();
    const side = await drawer();
    for (const name of ['Summary', 'Client', 'Ticket properties', 'Related', 'Activity']) expect(within(side).getByRole('region', { name })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'I', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Ticket details' })).toBeNull());
    // Closed on a wide window: remembered, and the panel's strip brings it back.
    expect(localStorage.getItem('ws.support.drawer')).toBe('closed');
    // The header's panel button and the panel's own strip both say it.
    expect(screen.getAllByRole('button', { name: 'Show the ticket details' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the ticket details' })[1]!);
    expect(await drawer()).toBeTruthy();
  });

  it('on a narrow window opens only on request, over the conversation', async () => {
    wide(1100);
    renderTab();
    await screen.findByRole('heading', { name: /Order 46497/ });
    expect(screen.queryByRole('complementary', { name: 'Ticket details' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the ticket details' }));
    await drawer();
    expect(document.querySelector('[data-support-scrim]')).toBeTruthy();
    fireEvent.mouseDown(document.querySelector('[data-support-scrim]')!);
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Ticket details' })).toBeNull());
  });

  it('keeps its width, as the splitter left it', async () => {
    renderTab();
    const side = await drawer();
    const divider = screen.getByRole('separator', { name: 'Resize the ticket details' });
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    await waitFor(() => expect(Number(side.style.width.replace('px', ''))).toBeGreaterThan(320));
    expect(Object.keys(localStorage).some((k) => k.includes('support.details'))).toBe(true);
  });
});

describe('A. the summary', () => {
  it('shows the AI brief — summary, key facts, next step, urgency — and Reply with this fills the composer', async () => {
    renderTab();
    const sum = within(await drawer()).getByRole('region', { name: 'Summary' });
    expect(await within(sum).findByText(/can't download or activate Microsoft Project 2024/)).toBeTruthy();
    expect(within(sum).getByText('AI summary · may be wrong')).toBeTruthy();
    expect(within(within(sum).getByRole('list', { name: 'Key facts' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Order 46497', 'Product: Microsoft Project 2024 Professional LTSC', 'Error on download']);
    expect(within(sum).getByText('Wants it fixed today')).toBeTruthy();
    expect(ai.run).toHaveBeenCalledWith('brief', expect.stringContaining('Order number 46497'));
    fireEvent.click(within(sum).getByRole('button', { name: 'Reply with this' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: /Reply to/ }) as HTMLElement).textContent ?? (screen.getByRole('textbox', { name: /Reply to/ }) as HTMLTextAreaElement).value).toContain('Ask the customer if the new link works'));
    // Kept on this computer: shown at once next time.
    expect(details.readBrief(1284)?.next).toBe('Ask the customer if the new link works');
  });

  it('is made again when a new message arrives, and on Refresh', async () => {
    const { qc } = renderTab();
    const sum = within(await drawer()).getByRole('region', { name: 'Summary' });
    await within(sum).findByText('Wants it fixed today');
    expect(ai.run).toHaveBeenCalledTimes(1);
    act(() => qc.setQueryData(['support', 'ticket', 1284], show({ messages: [...MESSAGES, msg(5, 'The new link works, thanks!')] })));
    await waitFor(() => expect(ai.run).toHaveBeenCalledTimes(2), { timeout: 3000 });
    fireEvent.click(within(sum).getByRole('button', { name: 'Refresh the summary' }));
    await waitFor(() => expect(ai.run).toHaveBeenCalledTimes(3));
  });

  it('without AI on this computer or online, uses the desk’s own summary', async () => {
    ai.engine = null;
    renderTab();
    const sum = within(await drawer()).getByRole('region', { name: 'Summary' });
    expect(await within(sum).findByText('The desk’s own summary.')).toBeTruthy();
    expect(calls('POST', '/api/support/v1/tickets/1284/ai/summary')).toHaveLength(1);
  });
});

describe('B. the client', () => {
  it('edits in place with checks and "Saved", and suggests what the conversation says', async () => {
    serve({ 'GET /api/support/v1/tickets/1284/client': CLIENT({ contact: CONTACT, matches: [], can: { edit: true, create_contact: false, link_contact: false, unlink_contact: true } }) });
    renderTab();
    const client = within(await drawer()).getByRole('region', { name: 'Client' });
    fireEvent.click(await within(client).findByRole('button', { name: /^Email: zacky\.hannan@gmail\.com — change/ }));
    const email = within(client).getByRole('textbox', { name: 'Email' });
    fireEvent.change(email, { target: { value: 'zacky@' } });
    fireEvent.keyDown(email, { key: 'Enter' });
    expect(within(client).getByRole('alert').textContent).toBe('Enter a valid email address, like name@example.com');
    expect(calls('PATCH', '/api/support/v1/tickets/1284/client')).toHaveLength(0);
    fireEvent.keyDown(email, { key: 'Escape' });
    fireEvent.click(within(client).getByRole('button', { name: /^Company: Hannan Traders — change/ }));
    const company = within(client).getByRole('textbox', { name: 'Company' });
    fireEvent.change(company, { target: { value: 'Hannan Traders (Pvt) Ltd' } });
    fireEvent.keyDown(company, { key: 'Enter' });
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284/client')[0]?.body).toEqual({ company: 'Hannan Traders (Pvt) Ltd', version: 7 }));
    expect(await within(client).findByText('Saved')).toBeTruthy();
    // The phone as people read it, with Call.
    expect(within(client).getByText('+94 77 058 4763')).toBeTruthy();
    expect(within(client).getByRole('button', { name: 'Call +94 77 058 4763' })).toBeTruthy();
  });

  it('adds a detail found in the conversation with one click', async () => {
    renderTab();
    const client = within(await drawer()).getByRole('region', { name: 'Client' });
    const found = await within(client).findByRole('list', { name: 'Found in conversation' });
    expect(within(found).getByText('+94 77 058 4763')).toBeTruthy();
    expect(within(found).queryByText('zacky.hannan@gmail.com')).toBeNull();
    fireEvent.click(within(found).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284/client')[0]?.body).toEqual({ phone: '+94770584763', version: 7 }));
  });

  it('creates the contact or links an existing one', async () => {
    renderTab();
    const client = within(await drawer()).getByRole('region', { name: 'Client' });
    fireEvent.click(await within(client).findByRole('button', { name: /Link to existing/ }));
    fireEvent.click(within(client).getByRole('button', { name: /Zacky Hannan/ }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/contact')[0]?.body).toEqual({ contact_id: 31 }));
    expect(await within(client).findByRole('button', { name: 'WorkSuite contact · Open' })).toBeTruthy();
    fireEvent.click(within(client).getByRole('button', { name: 'WorkSuite contact · Open' }));
    expect(nav.openLink).toHaveBeenCalledWith('/contacts/31');
  });

  it('is read-only without contact rights', async () => {
    serve({ 'GET /api/support/v1/tickets/1284/client': CLIENT({ matches: [], can: { edit: false, create_contact: false, link_contact: false, unlink_contact: false } }) });
    renderTab();
    const client = within(await drawer()).getByRole('region', { name: 'Client' });
    expect(await within(client).findByText('Read-only: changing the client needs the contacts edit permission.')).toBeTruthy();
    expect(within(client).queryByRole('button', { name: /— change/ })).toBeNull();
    expect(within(client).queryByRole('button', { name: 'Create contact' })).toBeNull();
  });
});

describe('C–E. properties, related and activity', () => {
  it('edits the type, says where it came from, and shows the SLA', async () => {
    serve({ 'PATCH /api/support/v1/tickets/1284': { ticket: ticket({ type: 'problem', version: 8 }) } });
    renderTab();
    const props = within(await drawer()).getByRole('region', { name: 'Ticket properties' });
    expect(await within(props).findByText('Website chat · techubiz.com')).toBeTruthy();
    fireEvent.click(within(props).getByRole('combobox', { name: 'Type' }));
    fireEvent.click(await within(await screen.findByRole('listbox', { name: 'Type' })).findByRole('option', { name: 'Problem' }));
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284')[0]?.body).toEqual({ type: 'problem', version: 7 }));
    expect(within(props).getByRole('region', { name: 'SLA' })).toBeTruthy();
  });

  it('shows the orders with Resend licence and Open order, earlier tickets and chats, website activity and the files', async () => {
    renderTab();
    const rel = within(await drawer()).getByRole('region', { name: 'Related' });
    expect(await within(rel).findByText('Order 46497')).toBeTruthy();
    expect(within(rel).getByText('Microsoft Project 2024 Professional LTSC')).toBeTruthy();
    expect(within(rel).getByText('Paid')).toBeTruthy();
    expect(within(rel).getByText('Licence sent')).toBeTruthy();
    fireEvent.click(within(rel).getByRole('button', { name: 'Resend licence email' }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/orders/91/resend-licence')).toHaveLength(1));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'The licence email for order 46497 is on its way.'));
    fireEvent.click(within(rel).getByRole('button', { name: 'Open order' }));
    expect(nav.openLink).toHaveBeenCalledWith('/oms/orders/91');
    fireEvent.click(within(rel).getByRole('button', { name: /TKT-000001/ }));
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1201');
    expect(within(rel).getByText('Previous chats · 1')).toBeTruthy();
    expect(within(rel).getByText('Downloads')).toBeTruthy();
    expect(within(within(rel).getByRole('region', { name: 'Files on this ticket' })).getAllByRole('button')).toHaveLength(1);
  });

  it('has the activity timeline', async () => {
    renderTab();
    const act2 = within(await drawer()).getByRole('region', { name: 'Activity' });
    fireEvent.click(within(act2).getByRole('button', { name: 'Activity' }));
    expect(within(act2).getByRole('list', { name: 'Activity timeline' }).textContent).toContain('Ayesha Fernando');
  });
});

describe('the parts', () => {
  it('reads a brief, with or without its headings', () => {
    expect(details.parseBrief(BRIEF)).toEqual({
      summary: expect.stringContaining('Zacky (order 46497)'),
      facts: ['Order 46497', 'Product: Microsoft Project 2024 Professional LTSC', 'Error on download'],
      next: 'Ask the customer if the new link works',
      urgency: 'Wants it fixed today',
    });
    expect(details.parseBrief('Just a plain summary.')).toEqual({ summary: 'Just a plain summary.', facts: [], next: null, urgency: null });
    expect(details.parseBrief('SUMMARY:\nA\nFACTS:\n- None\nNEXT:\nNone\nURGENCY:\nNone')).toEqual({ summary: 'A', facts: [], next: null, urgency: null });
  });

  it('checks and writes phone numbers with +94 as the default', () => {
    expect(details.normalizePhone('0770584763')).toBe('+94770584763');
    expect(details.normalizePhone('+94 77 058 4763')).toBe('+94770584763');
    expect(details.normalizePhone('call me')).toBeNull();
    expect(details.formatPhone('0770584763')).toBe('+94 77 058 4763');
    expect(details.fieldError('phone', '12')).toBe('Enter a valid phone number, like +94 77 123 4567');
    expect(details.fieldError('email', 'a@b.lk')).toBeNull();
  });

  it('finds details in what the customer wrote, not what the client has', () => {
    const m = (body: string, from = 'requester') => ({ body, from, internal: false }) as never;
    const found = details.foundInConversation([m('My name is Zacky. Email me at Zacky.H@Gmail.com or call 0770584763'), m('Order number 46497'), m('kumari@acme.lk', 'staff')], { requester: { name: 'Visitor 12', email: null, phone: '+94770584763' }, contact: null });
    expect(found.map((f) => [f.field, f.value])).toEqual([['email', 'zacky.h@gmail.com'], ['name', 'Zacky']]);
  });

  it('opens by itself only on a wide window', () => {
    expect(details.drawerState(1440, 1280, null, false)).toEqual({ open: true, overlay: false });
    expect(details.drawerState(1440, 1280, 'closed', false)).toEqual({ open: false, overlay: false });
    expect(details.drawerState(1100, 1280, 'open', false)).toEqual({ open: false, overlay: true });
    expect(details.drawerState(1100, 1280, null, true)).toEqual({ open: true, overlay: true });
  });
});
