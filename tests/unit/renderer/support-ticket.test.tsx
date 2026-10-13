// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as imageTools from '../../../src/modules/mail/editor/images';
import type * as CoreApi from '../../../src/core/api';

/**
 * The ticket tab, D-02 (desktop T20): the conversation and its journal, links and files; the properties with the
 * version and the conflict review (FR-TKT-03/10); the SLA, requester, files, related and remote panels (FR-SLA-07,
 * FR-WSP-07/08); the composer — reply or note, "/" canned responses, @mentions, CC, status on send, files dropped,
 * pasted or chosen (FR-COM-01/04/05/08, FR-DSK-06) and the draft kept per ticket (FR-CRT-10); who else is here
 * (FR-COM-11); RustDesk (WF-13).
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
const nav = vi.hoisted(() => ({ navigate: vi.fn(), go: vi.fn(), openLink: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't2', route: '/support/ticket/1284', active: true, path: ['support', 'ticket', '1284'], query: new URLSearchParams(), go: nav.go, navigate: nav.navigate, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: nav.openLink }),
  useTabTitle: () => undefined,
}));

const { ApiError, request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const compose = await import('../../../src/modules/support/compose');
const { slaRows, groupedId, linkKind } = await import('../../../src/modules/support/TicketSide');
const { describe: describeChange, currentOf, tagOf, localInput } = await import('../../../src/modules/support/Properties');
const { eventWords, eventWho } = await import('../../../src/modules/support/Activity');

const ticket = (id: number, over: Record<string, unknown> = {}) => ({
  id, reference: `CFX-00${id}`, subject: 'Microsoft 365 licences not activating after renewal', status: 'open', status_category: 'open', priority: 'urgent', type: 'incident', source: 'email',
  organization: { id: 10, name: 'CreativeFX' }, requester: { name: 'Saman Kumara', email: 'saman@acmelanka.lk', phone: '+94 77 341 2290', kind: 'contact', user_id: null, contact_id: 77, company_id: 5 },
  assignee: { id: 1, name: 'Ayesha Fernando' }, team: { id: 2, name: 'Licensing — Tier 1' }, category: { id: 3, name: 'M365 · Activation' }, department: { id: 4, name: 'Licensing' }, tags: ['m365', 'renewal'],
  sla: { state: 'at_risk', target: 'next_response', due_at: '2026-10-04T10:00:00Z', policy_id: 1, paused_ms: 0 },
  due_at: '2026-10-05T11:30:00Z', confidential: false, unread: 1, conversation_id: null, version: 7, opened_at: '2026-10-04T03:42:00Z', first_response_at: '2026-10-04T03:56:00Z', last_customer_at: null, last_agent_at: null,
  resolved_at: null, closed_at: null, created_at: '2026-10-04T03:42:00Z', updated_at: '2026-10-04T04:12:00Z', deleted_at: null,
  rustdesk_id: '1482667019', rustdesk_uri: 'rustdesk://connect/1482667019', watchers: [], merged_into: null,
  sla_timers: [
    { target: 'first_response', due_at: '2026-10-04T04:42:00Z', state: 'met', at: '2026-10-04T03:56:00Z' },
    { target: 'next_response', due_at: '2026-10-04T10:00:00Z', state: 'running', at: null },
    { target: 'resolution', due_at: '2026-10-05T14:00:00Z', state: 'running', at: null },
  ],
  ...over,
});
const msg = (id: number, over: Record<string, unknown> = {}) => ({ id, body: `Message ${id}`, body_html: null, author: null, author_name: 'Saman Kumara', from: 'requester', internal: false, channel: 'email', delivery_channel: null, delivery_status: null, cc: [], mentions: [], client_id: null, edited_at: null, created_at: '2026-10-04T03:42:00Z', ...over });
const show = (over: Record<string, unknown> = {}) => ({
  ticket: ticket(1284),
  messages: [msg(1, { cc: ['it@acmelanka.lk'] }), msg(2, { author: { id: 1, name: 'Ayesha Fernando' }, author_name: 'Ayesha Fernando', from: 'staff', body: 'Could you send the three affected user emails?', delivery_status: 'delivered' }), msg(3, { author: { id: 4, name: 'Nimal Perera' }, author_name: 'Nimal Perera', from: 'staff', internal: true, body: '@Ayesha 22 of 25 assigned' }), msg(4, { body: 'Affected users are kumari@, dilan@ and roshan@' })],
  has_earlier: false,
  attachments: [
    { id: 50, ticket_id: 1284, message_id: 1, name: 'activation-error.png', mime: 'image/png', size: 186_368, public: true, scan_status: 'clean', created_by: null, created_at: '2026-10-04T03:42:00Z' },
    { id: 51, ticket_id: 1284, message_id: 4, name: 'roshan-mac.png', mime: 'image/png', size: 98_304, public: true, scan_status: 'clean', created_by: null, created_at: '2026-10-04T04:12:00Z' },
  ],
  events: [
    { id: 9, action: 'status', detail: 'open', field: 'status', old: 'new', new: 'open', source: 'agent', reason: 'Taken', user: { id: 1, name: 'Ayesha Fernando' }, created_at: '2026-10-04T03:50:00Z' },
    { id: 8, action: 'assigned', detail: 'user 1', field: 'assigned_to', old: null, new: '1', source: 'agent', reason: 'Taken', user: { id: 1, name: 'Ayesha Fernando' }, created_at: '2026-10-04T03:50:00Z' },
    { id: 7, action: 'opened', detail: 'email', field: null, old: null, new: null, source: 'customer', reason: null, user: null, created_at: '2026-10-04T03:42:00Z' },
  ],
  last_read_message_id: 3,
  can: { view: true, reply: true, notes: true, edit: true, assign: true, close: true, escalate: true },
  transitions: ['in_progress', 'pending_customer', 'pending_internal', 'escalated', 'resolved'],
  remote_desk: { id_server: 'rd.creativefx.lk', relay_server: 'rd.creativefx.lk', key: 'k', config_string: '=0nIxx' },
  ...over,
});
const META = {
  statuses: [], priorities: ['low', 'normal', 'high', 'urgent'], types: [], sources: [], views: [], sorts: [],
  organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: {} }],
  departments: [{ id: 4, name: 'Licensing', organization_id: 10 }, { id: 6, name: 'Finance', organization_id: 11 }],
  teams: [{ id: 2, name: 'Licensing — Tier 1', organization_id: 10, department_id: 4, tier: 1 }, { id: 8, name: 'Licensing — Tier 2', organization_id: null, department_id: 4, tier: 2 }],
  categories: [{ id: 3, name: 'M365 · Activation', organization_id: 10, parent_id: null }],
  tags: [{ name: 'vip', organization_id: 10 }, { name: 'm365', organization_id: 10 }],
  can: {},
};
const ATTACHMENT = (id: number, name: string) => ({ attachment: { id, ticket_id: 1284, message_id: null, name, mime: 'image/png', size: 420_000, public: true, scan_status: 'clean', created_by: 1, created_at: null } });

type Call = { method: string; path: string; query?: Record<string, unknown>; body?: unknown };
let served: Record<string, unknown>;
let log: Call[];
function serve(over: Record<string, unknown> = {}) {
  served = {
    'GET /api/support/v1/meta': META,
    'GET /api/support/v1/tickets/1284': show(),
    'GET /api/support/v1/tickets/1284/links': { links: [
      { id: 1, module: 'records', entity: 'invoice', entity_id: 412, relation: 'related', created_at: null, visible: true, label: 'INV-2026-0412', detail: 'LKR 486,000 · Paid', link: '/finance/invoices?open=412' },
      { id: 2, module: 'support', entity: 'ticket', entity_id: 1270, relation: 'follow_up', created_at: null, visible: true, label: 'CFX-001270 — Renewal quote', status: 'resolved', link: '/tickets?ticket=1270' },
      { id: 3, module: 'records', entity: 'crm_deal', entity_id: 9, relation: 'related', created_at: null, visible: false, label: null, link: null },
    ] },
    'GET /api/support/v1/tickets': { items: [ticket(1284), ticket(1270, { subject: 'Renewal quote', status: 'resolved' }), ticket(1290, { subject: 'Outlook keeps asking for a password', status: 'pending_customer' })], next_cursor: null, has_more: false, sort: 'updated', view: 'all' },
    'GET /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/read': {},
    'POST /api/support/v1/tickets/1284/messages': { message: msg(9), duplicate: false, ticket: ticket(1284), status_refused: null },
    'POST /api/support/v1/tickets/1284/transition': { ticket: ticket(1284, { status: 'pending_internal', version: 8 }) },
    'POST /api/support/v1/tickets/1284/assign': { ticket: ticket(1284, { assignee: { id: 5, name: 'Kavindi Silva' }, version: 8 }) },
    'PATCH /api/support/v1/tickets/1284': { ticket: ticket(1284, { priority: 'high', version: 8 }) },
    'POST /api/support/v1/tickets/1284/watchers': { added: [1], skipped: [] },
    'DELETE /api/support/v1/tickets/1284/watchers/1': {},
    'POST /api/support/v1/tickets/1284/attachments': ATTACHMENT(70, 'Screenshot.png'),
    'DELETE /api/support/v1/attachments/70': {},
    'GET /api/support/v1/agents': { organization_id: 10, agents: [{ id: 1, name: 'Ayesha Fernando', presence: 'available', open: 12, capacity: 15, teams: [] }, { id: 5, name: 'Kavindi Silva', presence: 'away', open: 3, capacity: null, teams: [] }] },
    'GET /api/support/v1/canned': { canned: [{ id: 5, title: 'Sign out and back in', shortcut: 'signout', body: 'Hi {{requester.first_name}}, please sign out of Office and back in.', scope: 'shared', organization_id: 10, category_id: null, uses: 12, mine: false }] },
    'POST /api/support/v1/canned/5/render': { body: 'Hi Saman, please sign out of Office and back in.' },
    ...over,
  };
  log = [];
  vi.mocked(request).mockImplementation((async (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}) => {
    log.push({ method, path, query: opts.query, body: opts.body });
    const hit = served[`${method} ${path}`];
    const data = await (typeof hit === 'function' ? (hit as (q: Record<string, unknown>, body: unknown) => unknown)(opts.query ?? {}, opts.body) : hit);
    if (data instanceof Error) throw data;
    if (data === undefined) return new Promise(() => undefined);
    return { data, offline: false, cachedAt: null, message: null };
  }) as never);
}
const calls = (method: string, path: string) => log.filter((c) => c.method === method && c.path === path);
const emit = (e: unknown) => act(() => realtime.slice().forEach((cb) => cb(e)));
let bridge: Array<{ channel: string; input: unknown }>;
let drafts: Record<string, unknown>;
let opened: boolean;

const renderTab = (route = '/support/ticket/1284') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><SupportPage tabId="t2" route={route} active /></QueryClientProvider>) };
};
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });
const composerBox = () => screen.getByRole('textbox', { name: /^(Internal note|Reply to Saman Kumara)$/ });
/** Chooses an option of one of the app's dropdowns. */
async function pick(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await within(await screen.findByRole('listbox', { name: label })).findByRole('option', { name: option }));
}

beforeEach(() => {
  resetApiFamily();
  // A wide window: the ticket details drawer opens by itself beside the conversation (#334).
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  for (const k of Object.keys(localStorage)) if (k === 'ws.support.drawer' || k.startsWith('ws.drawer.')) localStorage.removeItem(k);
  realtime.length = 0;
  nav.navigate.mockReset();
  nav.openLink.mockReset();
  vi.mocked(toast).mockReset();
  bridge = [];
  drafts = {};
  opened = true;
  vi.mocked(call).mockImplementation((async (channel: string, input: { module?: string; context?: string; content?: unknown }) => {
    bridge.push({ channel, input });
    if (channel === 'offline:getDraft') return drafts[`${input.module}:${input.context}`] ?? null;
    if (channel === 'offline:saveDraft') drafts[`${input.module}:${input.context}`] = { content: input.content };
    if (channel === 'offline:deleteDraft') delete drafts[`${input.module}:${input.context}`];
    if (channel === 'app:openExternal') return opened;
    return undefined;
  }) as never);
  serve();
  app.set({ auth: { stage: 'ready', server: null, user: { id: '1', name: 'Ayesha Fernando', email: 'a@x', avatar: null, timezone: null, locale: null, organizationId: null, organizationName: null, timeFormat: null, weekStart: null }, message: null, setupPending: false }, status: { network: 'ONLINE', realtime: 'connected', pendingChanges: 0, unread: { mail: 0, chat: 0, notifications: 0, tasks: 0 }, notificationsPausedUntil: null, services: {}, locked: false, safeMode: false } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 30, top: 100, left: 0, right: 300, bottom: 130, x: 0, y: 100, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the composer’s rules', () => {
  it('finds the "/word" at the start of a line and the "@word" anywhere', () => {
    expect(compose.slashQuery('/sig', 4)).toEqual({ start: 0, word: 'sig' });
    expect(compose.slashQuery('Hello\n/sig', 10)).toEqual({ start: 6, word: 'sig' });
    expect(compose.slashQuery('and/or', 6)).toBeNull();
    expect(compose.slashQuery('/sig nature', 11)).toBeNull();
    expect(compose.mentionQuery('ask @Ay', 7)).toEqual({ start: 4, word: 'Ay' });
    expect(compose.mentionQuery('mail a@b', 8)).toBeNull();
    expect(compose.spliceText('ask @Ay now', 4, 7, '@Ayesha Fernando ')).toEqual({ text: 'ask @Ayesha Fernando  now', caret: 21 });
  });

  it('names a pasted screenshot as a Mac does, and keeps a copied file’s own name', () => {
    const at = new Date(2026, 9, 4, 9, 47, 5);
    expect(compose.pastedName({ name: 'image.png', type: 'image/png' }, at)).toBe('Screenshot 2026-10-04 at 09.47.05.png');
    expect(compose.pastedName({ name: '', type: 'image/jpeg' }, at)).toBe('Screenshot 2026-10-04 at 09.47.05.jpg');
    expect(compose.pastedName({ name: 'Acme-M365-assignments.xlsx', type: '' }, at)).toBe('Acme-M365-assignments.xlsx');
  });

  it('takes a paste as files only when it is files: not cells copied with a picture of them', () => {
    expect(compose.pasteIsFiles([], 'text')).toBe(false);
    expect(compose.pasteIsFiles([{ name: 'image.png' }], '')).toBe(true);
    expect(compose.pasteIsFiles([{ name: 'image.png' }], 'Name\tSeats')).toBe(false);
    expect(compose.pasteIsFiles([{ name: 'invoice.pdf' }], 'invoice.pdf')).toBe(true);
  });

  it('reads CC addresses and what is no address, and the people a note still mentions', () => {
    expect(compose.parseCc('it@acme.lk, ops@acme.lk;IT@acme.lk  nobody')).toEqual({ emails: ['it@acme.lk', 'ops@acme.lk'], bad: ['nobody'] });
    expect(compose.mentionedIds('@Ayesha Fernando look', [{ id: 1, name: 'Ayesha Fernando' }, { id: 4, name: 'Nimal Perera' }])).toEqual([1]);
  });
});

describe('the side panels’ rules', () => {
  const now = Date.parse('2026-10-04T09:42:00Z');
  it('shows the SLA timers the server computed: met with how long it took, at risk, time left', () => {
    const t = ticket(1284) as never;
    expect(slaRows(t, now)).toEqual([
      { target: 'first_response', value: 'Met · 14m', tone: 'ok' },
      { target: 'next_response', value: '18m left', tone: 'risk' },
      { target: 'resolution', value: '1d 4h left', tone: 'ok' },
    ]);
    const late = ticket(1284, { sla: { state: 'breached', target: 'next_response', due_at: '2026-10-04T09:00:00Z', policy_id: 1, paused_ms: 0 }, sla_timers: [{ target: 'next_response', due_at: '2026-10-04T09:00:00Z', state: 'breached', at: null }, { target: 'resolution', due_at: null, state: 'paused', at: null }] }) as never;
    expect(slaRows(late, now).map((r) => [r.value, r.tone])).toEqual([['Met · 14m', 'ok'], ['42m overdue', 'breach'], ['Paused', 'paused']]);
  });

  it('falls back to the one target a server without timers gives, and guesses no others', () => {
    const t = ticket(1284, { sla_timers: undefined, first_response_at: null }) as never;
    expect(slaRows(t, now).map((r) => r.value)).toEqual(['—', '18m left', '—']);
    expect(slaRows(ticket(1284, { sla_timers: undefined, first_response_at: null, sla: { state: 'none', target: null, due_at: null, policy_id: null, paused_ms: 0 } }) as never, now).every((r) => r.tone === 'none')).toBe(true);
  });

  it('groups a RustDesk ID as RustDesk shows it, and names what a link points at', () => {
    expect(groupedId('1482667019')).toBe('1 482 667 019');
    expect(groupedId('acme-roshan')).toBe('acme-roshan');
    expect(linkKind({ module: 'records', entity: 'crm_deal' })).toBe('Deal');
    expect(linkKind({ module: 'communication', entity: 'conversation' })).toBe('Website chat');
  });

  it('says what a change is, mine and theirs', () => {
    const theirs = ticket(1284, { assignee: { id: 5, name: 'Kavindi Silva' }, team: { id: 8, name: 'Licensing — Tier 2' } }) as never;
    expect(describeChange({ kind: 'field', field: 'team_id', to: 2 }, META as never, 2)).toBe('Licensing — Tier 1');
    expect(describeChange({ kind: 'field', field: 'team_id', to: 2 }, META as never, currentOf({ kind: 'field', field: 'team_id', to: 2 }, theirs))).toBe('Licensing — Tier 2');
    expect(describeChange({ kind: 'assignee', to: 1, name: 'Ayesha Fernando' }, undefined, 1)).toBe('Ayesha Fernando');
    expect(describeChange({ kind: 'assignee', to: 1 }, undefined, 5, theirs)).toBe('Kavindi Silva');
    expect(describeChange({ kind: 'field', field: 'priority', to: 'high' }, undefined, 'high')).toBe('High');
    expect(describeChange({ kind: 'field', field: 'tags', to: [] }, undefined, [])).toBe('None');
    expect(tagOf('  VIP  Customer ')).toBe('vip customer');
    expect(localInput('not a date')).toBe('');
  });

  it('words the journal', () => {
    const e = show().events;
    expect(e.map((x) => `${eventWho(x as never)} ${eventWords(x as never)}`)).toEqual(['Ayesha Fernando set the status to Open', 'Ayesha Fernando took the ticket', 'The requester raised the ticket']);
    expect(eventWords({ ...e[0], action: 'edited', field: 'team_id' } as never)).toBe('changed the team');
  });
});

describe('the ticket tab', () => {
  it('shows the ticket: breadcrumb, reference, chips, the views with their counts, and the conversation', async () => {
    renderTab();
    expect(await screen.findByRole('heading', { name: 'Microsoft 365 licences not activating after renewal' })).toBeTruthy();
    expect(screen.getByText('CFX-001284').className).toContain('font-mono');
    expect(screen.getByText(/^Email · opened .+ · CreativeFX$/)).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Ticket' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Conversation4', 'Activity3', 'Linked0', 'Files2']);
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: /Linked/ }).textContent).toBe('Linked3'));
    const thread = screen.getByRole('list', { name: 'Conversation' });
    const items = Array.from(thread.children).filter((li) => !li.getAttribute('aria-hidden')).map((li) => (li.hasAttribute('data-new-since') ? 'divider' : li.getAttribute('data-message')));
    expect(items).toEqual(['1', '2', '3', 'divider', '4']);
    expect(within(thread).getByText('Internal note')).toBeTruthy();
    expect(within(thread).getByText(/Delivered/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Support' }));
    expect(nav.navigate).toHaveBeenCalledWith('/support');
    // Read once it has been shown for a moment, as in the inbox.
    expect(calls('GET', '/api/support/v1/tickets/1284')[0]!.query).toEqual({ peek: 1 });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/read')[0]?.body).toEqual({ message_id: 4 }), { timeout: 3000 });
  });

  it('shows the journal, the links and the files', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
    const journal = screen.getByRole('list', { name: 'Activity' });
    expect(within(journal).getAllByRole('listitem').map((li) => li.textContent?.replace(/^.*?(Ayesha|The requester)/, '$1'))).toEqual(['Ayesha Fernando set the status to Open', 'Ayesha Fernando took the ticket', 'The requester raised the ticket']);
    fireEvent.click(screen.getByRole('tab', { name: /Linked/ }));
    const linked = await screen.findByRole('list', { name: 'Linked' });
    fireEvent.click(within(linked).getByRole('button', { name: /CFX-001270/ }));
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1270');
    fireEvent.click(within(linked).getByRole('button', { name: /INV-2026-0412/ }));
    expect(nav.openLink).toHaveBeenCalledWith('/finance/invoices?open=412');
    expect(within(linked).getByText('Deal you cannot open')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Files/ }));
    expect(within(screen.getByRole('list', { name: 'Files' })).getAllByRole('button').map((b) => b.title)).toEqual(['Open activation-error.png', 'Open roshan-mac.png']);
  });

  it('has the side panels: properties, SLA, the requester and their other tickets, files, related, remote support', async () => {
    renderTab();
    const side = await screen.findByRole('complementary', { name: 'Ticket details' });
    expect(within(side).getByRole('combobox', { name: 'Status' }).textContent).toContain('Open');
    expect(within(side).getByRole('combobox', { name: 'Priority' }).textContent).toContain('Urgent');
    expect(within(side).getByRole('combobox', { name: 'Assignee' }).textContent).toContain('Ayesha Fernando');
    await waitFor(() => expect(within(side).getByRole('combobox', { name: 'Team' }).textContent).toContain('Licensing — Tier 1'));
    const sla = within(side).getByRole('region', { name: 'SLA' });
    expect(within(sla).getByText('First response')).toBeTruthy();
    const requester = within(side).getByRole('region', { name: 'Requester' });
    expect(within(requester).getByText('Saman Kumara')).toBeTruthy();
    expect(await within(requester).findByText('2 other tickets · 1 open')).toBeTruthy();
    fireEvent.click(within(requester).getByRole('button', { name: /CFX-001290/ }));
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1290');
    fireEvent.click(within(requester).getByRole('button', { name: 'Contact' }));
    expect(nav.openLink).toHaveBeenCalledWith('/contacts?open=77');
    expect(within(within(side).getByRole('region', { name: 'Files on this ticket' })).getAllByRole('button')).toHaveLength(2);
    expect(await within(side).findByRole('region', { name: 'Related' })).toBeTruthy();
    const remote = within(side).getByRole('region', { name: 'Remote support' });
    expect(within(remote).getByText('1 482 667 019')).toBeTruthy();
    expect(within(remote).getByText(/Through rd\.creativefx\.lk/)).toBeTruthy();
  });

  it('connects with RustDesk through its connect link, and says when RustDesk is not there', async () => {
    renderTab();
    const remote = await screen.findByRole('region', { name: 'Remote support' });
    fireEvent.click(within(remote).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(bridge.find((b) => b.channel === 'app:openExternal')?.input).toEqual({ url: 'rustdesk://connect/1482667019' }));
    opened = false;
    fireEvent.click(screen.getByRole('button', { name: 'Remote' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'RustDesk could not be opened. Is it installed on this computer?'));
  });

  it('follows the ticket, and stops', async () => {
    renderTab();
    const follow = await screen.findByRole('button', { name: 'Follow' });
    // Asked again once it is followed: the server lists me among its watchers.
    served['GET /api/support/v1/tickets/1284'] = show({ ticket: ticket(1284, { watchers: [{ id: 1, name: 'Ayesha Fernando' }] }) });
    fireEvent.click(follow);
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/watchers')[0]?.body).toEqual({}));
    const following = await screen.findByRole('button', { name: 'Following' });
    expect(following.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(following);
    await waitFor(() => expect(calls('DELETE', '/api/support/v1/tickets/1284/watchers/1')).toHaveLength(1));
  });

  it('is read-only when merged into another ticket, and opens that one', async () => {
    serve({ 'GET /api/support/v1/tickets/1284': show({ ticket: ticket(1284, { merged_into: { id: 1300, reference: 'CFX-001300' } }) }) });
    renderTab();
    expect(await screen.findByText(/Merged into CFX-001300/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Internal note' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open CFX-001300' }));
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1300');
    key('r');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('a ticket hint for it asks it again', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    const n = calls('GET', '/api/support/v1/tickets/1284').length;
    emit({ type: 'support.ticket', kind: 'message', ticket_id: 1284, reference: 'CFX-001284', version: 8 });
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets/1284').length).toBe(n + 1));
  });

  it('says so for a ticket that is not there', async () => {
    serve({ 'GET /api/support/v1/tickets/1284': new ApiError(404, 'Ticket not found', 'NOT_FOUND') });
    renderTab();
    expect(await screen.findByText('Ticket not found')).toBeTruthy();
  });
});

describe('the properties', () => {
  it('changes the priority, team, assignee and status with the version the screen showed', async () => {
    renderTab();
    await screen.findByRole('complementary', { name: 'Ticket details' });
    await pick('Priority', 'High');
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284')[0]?.body).toEqual({ priority: 'high', version: 7 }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Team' }).hasAttribute('disabled')).toBe(false));
    await pick('Team', 'Licensing — Tier 2');
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284')[1]?.body).toMatchObject({ team_id: 8 }));
    await pick('Assignee', /Kavindi Silva/);
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/assign')[0]?.body).toMatchObject({ user_id: 5 }));
    await pick('Status', 'Pending internal');
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/transition')[0]?.body).toMatchObject({ status: 'pending_internal' }));
  });

  it('offers only the moves the state machine allows, and Resolved asks what fixed it', async () => {
    renderTab();
    await screen.findByRole('complementary', { name: 'Ticket details' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    const list = await screen.findByRole('listbox', { name: 'Status' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Open', 'In progress', 'Pending customer', 'Pending internal', 'Escalated', 'Resolved']);
    fireEvent.click(within(list).getByRole('option', { name: 'Resolved' }));
    expect(await screen.findByRole('dialog', { name: 'Resolve CFX-001284' })).toBeTruthy();
    expect(calls('POST', '/api/support/v1/tickets/1284/transition')).toHaveLength(0);
  });

  it('adds and removes tags', async () => {
    renderTab();
    await screen.findByRole('complementary', { name: 'Ticket details' });
    // Typed, or chosen from the desk's tags (a combobox with the suggestions).
    fireEvent.change(screen.getByRole('combobox', { name: 'Add a tag' }), { target: { value: 'VIP' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Add a tag' }), { key: 'Enter' });
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284')[0]?.body).toEqual({ tags: ['m365', 'renewal', 'vip'], version: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the tag renewal' }));
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284')[1]?.body).toEqual({ tags: ['m365'], version: 7 }));
  });

  it('reviews a conflict: what it is now, what I chose — keep theirs, or set mine on top of theirs', async () => {
    let n = 0;
    serve({
      'PATCH /api/support/v1/tickets/1284': () => {
        n += 1;
        if (n === 1) throw new ApiError(409, 'Changed', 'VERSION_CONFLICT', { ticket: ticket(1284, { team: { id: 8, name: 'Licensing — Tier 2' }, version: 9 }) });
        return { ticket: ticket(1284, { version: 10 }) };
      },
    });
    renderTab();
    await screen.findByRole('complementary', { name: 'Ticket details' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Department' })).toBeTruthy());
    await pick('Team', 'Licensing — Tier 2');
    // Mine was Tier 1 → Tier 2 at version 7; somebody set Tier 2 first. Choose the other to see both.
    const dialog = await screen.findByRole('dialog', { name: 'CFX-001284 was changed by somebody else' });
    expect(within(dialog).getByText('Team')).toBeTruthy();
    expect(within(dialog).getAllByText('Licensing — Tier 2')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use mine' }));
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284')[1]?.body).toEqual({ team_id: 8, version: 9 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps theirs', async () => {
    serve({ 'PATCH /api/support/v1/tickets/1284': new ApiError(409, 'Changed', 'VERSION_CONFLICT', { ticket: ticket(1284, { priority: 'normal', version: 9 }) }) });
    renderTab();
    await screen.findByRole('complementary', { name: 'Ticket details' });
    await pick('Priority', 'High');
    const dialog = await screen.findByRole('dialog', { name: /changed by somebody else/ });
    expect(within(dialog).getByText('Normal')).toBeTruthy();
    expect(within(dialog).getByText('High')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep theirs' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('PATCH', '/api/support/v1/tickets/1284')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Priority' }).textContent).toContain('Normal');
  });
});

describe('the composer', () => {
  it('is a note unless I choose a reply; a reply goes to the requester with CC and the status after it', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    expect(screen.getByRole('radio', { name: 'Internal note' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Reply to requester' }));
    expect(screen.getByText('To Saman Kumara <saman@acmelanka.lk>')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CC' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'CC addresses' }), { target: { value: 'it@acmelanka.lk, not-an-address' } });
    expect(screen.getByText('Not an address: not-an-address')).toBeTruthy();
    fireEvent.blur(screen.getByRole('textbox', { name: 'CC addresses' }));
    expect(screen.getByRole('button', { name: 'Remove it@acmelanka.lk' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'CC addresses' }), { target: { value: '' } });
    await pick('Status after sending', 'Then: Pending customer');
    editReply(composerBox(), 'Three seats were not re-assigned; done now.');
    fireEvent.keyDown(composerBox(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(1));
    const body = calls('POST', '/api/support/v1/tickets/1284/messages')[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ body: 'Three seats were not re-assigned; done now.', internal: false, cc: ['it@acmelanka.lk'], status: 'pending_customer' });
    expect(String(body.client_id)).toMatch(/^desk:/);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Reply sent on CFX-001284.'));
    // Sent: nothing of it is kept on this computer.
    await waitFor(() => expect(drafts['support:ticket:1284']).toBeUndefined());
  });

  it('sends "Track this email" off for one reply, and says nothing when it stays on (#335)', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    fireEvent.click(screen.getByRole('radio', { name: 'Reply to requester' }));
    const track = screen.getByRole('checkbox', { name: 'Track this email' }) as HTMLInputElement;
    expect(track.checked).toBe(true);
    fireEvent.click(track);
    editReply(composerBox(), 'Here is the installer.');
    fireEvent.keyDown(composerBox(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(1));
    expect(calls('POST', '/api/support/v1/tickets/1284/messages')[0]!.body).toMatchObject({ internal: false, track: false });
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Track this email' }) as HTMLInputElement).checked).toBe(true));
    editReply(composerBox(), 'And the guide.');
    fireEvent.keyDown(composerBox(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(2));
    expect(calls('POST', '/api/support/v1/tickets/1284/messages')[1]!.body).not.toHaveProperty('track');
  });

  it('shows a pending message and preserves edits made before its send finishes', async () => {
    let finish!: (value: unknown) => void;
    served['POST /api/support/v1/tickets/1284/messages'] = () => new Promise((resolve) => { finish = resolve; });
    renderTab(); await screen.findByRole('heading', { name: /Microsoft 365/ });
    editReply(composerBox(), 'First answer');
    fireEvent.click(screen.getByRole('button', { name: /^Add note/ }));
    await screen.findByText(/Sending…/);
    editReply(composerBox(), 'Next answer');
    await act(async () => finish({ message: msg(90, { body: 'First answer' }), duplicate: false, ticket: ticket(1284), status_refused: null }));
    await waitFor(() => expect(screen.queryByText(/Sending…/)).toBeNull());
    expect(composerBox().textContent).toBe('Next answer');
  });

  it('retries a failed message with its original idempotency key', async () => {
    served['POST /api/support/v1/tickets/1284/messages'] = new Error('Temporary failure');
    renderTab(); await screen.findByRole('heading', { name: /Microsoft 365/ });
    editReply(composerBox(), 'Retry this answer');
    fireEvent.click(screen.getByRole('button', { name: /^Add note/ }));
    await screen.findByText(/Not sent/);
    const first = calls('POST', '/api/support/v1/tickets/1284/messages')[0]!.body;
    served['POST /api/support/v1/tickets/1284/messages'] = { message: msg(91), duplicate: false, ticket: ticket(1284), status_refused: null };
    fireEvent.click(within(screen.getByRole('list', { name: 'Conversation' })).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(2));
    expect(calls('POST', '/api/support/v1/tickets/1284/messages')[1]!.body).toEqual(first);
  });

  it('keeps separate reply and internal note drafts, including formatting', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    const box = composerBox();
    box.innerHTML = '<p><strong>Private finding</strong></p>';
    fireEvent.input(box);
    fireEvent.click(screen.getByRole('radio', { name: 'Reply to requester' }));
    expect(composerBox().textContent).toBe('');
    editReply(composerBox(), 'Public answer');
    fireEvent.click(screen.getByRole('radio', { name: 'Internal note' }));
    expect(composerBox().innerHTML).toContain('<strong>Private finding</strong>');
    fireEvent.click(screen.getByRole('radio', { name: 'Reply to requester' }));
    expect(composerBox().textContent).toBe('Public answer');
  });

  it('says when the message went but the status could not move', async () => {
    serve({ 'POST /api/support/v1/tickets/1284/messages': { message: msg(9), duplicate: false, ticket: ticket(1284), status_refused: { code: 'TRANSITION_REFUSED', message: 'Open it first' } } });
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    editReply(composerBox(), 'Noted');
    fireEvent.click(screen.getByRole('button', { name: /^Add note/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('warning', 'Sent, but the status did not change: Open it first'));
  });

  it('"/" offers the canned responses, filled in for this ticket by the server', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    editReply(composerBox(), '/sign');
    const picker = await screen.findByRole('listbox', { name: 'Canned responses' });
    expect(await within(picker).findByRole('option', { name: /Sign out and back in/ })).toBeTruthy();
    expect(calls('GET', '/api/support/v1/canned')[0]?.query).toEqual({ q: 'sign' });
    fireEvent.keyDown(composerBox(), { key: 'Enter' });
    await waitFor(() => expect(composerBox().textContent).toBe('Hi Saman, please sign out of Office and back in.'));
    expect(calls('POST', '/api/support/v1/canned/5/render')[0]?.body).toEqual({ ticket_id: 1284 });
    expect(screen.queryByRole('listbox', { name: 'Canned responses' })).toBeNull();
  });

  it('⌘K’s actions on the ticket in front: Insert canned response… opens the "/" picker in a reply', async () => {
    const { allCommands } = await import('../../../src/core/commands');
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    const ids = allCommands().filter((c) => c.id.startsWith('support-')).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['support-canned', 'support-quick', 'support-copy-link']));
    act(() => allCommands().find((c) => c.id === 'support-canned')!.run());
    expect(await screen.findByRole('listbox', { name: 'Canned responses' })).toBeTruthy();
    expect(composerBox().textContent).toBe('/');
    expect(screen.getByRole('radio', { name: /Reply to requester/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('Escape closes the canned list and leaves the text as typed', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    editReply(composerBox(), '/');
    await screen.findByRole('listbox', { name: 'Canned responses' });
    fireEvent.keyDown(composerBox(), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Canned responses' })).toBeNull();
    expect(composerBox().textContent).toBe('/');
  });

  it('"@" in a note mentions somebody who works the ticket', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    editReply(composerBox(), 'Can you check, @Kav');
    const picker = await screen.findByRole('listbox', { name: 'People to mention' });
    fireEvent.click(await within(picker).findByRole('option', { name: /Kavindi Silva/ }));
    await waitFor(() => expect(composerBox().textContent).toBe('Can you check, @Kavindi Silva '));
    fireEvent.click(screen.getByRole('button', { name: /^Add note/ }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')[0]?.body).toMatchObject({ internal: true, mentions: [5] }));
  });

  it('attaches chosen files: each goes up at once, waits, goes with the message — and × takes one back', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    const file = new File(['x'.repeat(10)], 'Acme-M365-assignments.xlsx', { type: 'application/vnd.ms-excel' });
    fireEvent.change(screen.getByLabelText('Files to attach'), { target: { files: [file] } });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/attachments')).toHaveLength(1));
    const form = calls('POST', '/api/support/v1/tickets/1284/attachments')[0]!.body as FormData;
    expect((form.get('file') as File).name).toBe('Acme-M365-assignments.xlsx');
    const files = await screen.findByRole('list', { name: 'Files to send' });
    expect(within(files).getByText('Screenshot.png')).toBeTruthy();
    expect(screen.getByText(/1 files · .* · max 25 MB each · scanned before sending/)).toBeTruthy();
    editReply(composerBox(), 'The list is attached');
    fireEvent.click(screen.getByRole('button', { name: /^Add note/ }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')[0]?.body).toMatchObject({ attachments: [70] }));
  });

  it('takes back a file not sent', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    fireEvent.change(screen.getByLabelText('Files to attach'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Screenshot.png' }));
    await waitFor(() => expect(calls('DELETE', '/api/support/v1/attachments/70')).toHaveLength(1));
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
  });

  it('pastes a readable image inline and sends its HTML with a plain fallback', async () => {
    const prepare = vi.spyOn(imageTools, 'prepareImage').mockResolvedValue({ src: 'data:image/png;base64,AAAA', width: 100, height: 100, bytes: 3, shrunk: false });
    const previous = document.execCommand;
    document.execCommand = vi.fn((command, _show, value) => {
      if (command === 'insertHTML') { const box = composerBox(); box.insertAdjacentHTML('beforeend', value ?? ''); }
      return true;
    });
    try {
      renderTab(); await screen.findByRole('heading', { name: /Microsoft 365/ });
      fireEvent.paste(composerBox(), { clipboardData: { files: [new File(['png'], 'screen.png', { type: 'image/png' })], getData: () => '' } });
      await waitFor(() => expect(composerBox().querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA'));
      expect(calls('POST', '/api/support/v1/tickets/1284/attachments')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: /^Add note/ }));
      await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')[0]?.body).toMatchObject({ body: '[screen]', body_html: expect.stringContaining('data:image/png;base64,AAAA') }));
    } finally { prepare.mockRestore(); document.execCommand = previous; }
  });

  it('warns about a mentioned but missing attachment before sending', async () => {
    renderTab(); await screen.findByRole('heading', { name: /Microsoft 365/ });
    editReply(composerBox(), 'Please see the attached document');
    fireEvent.click(screen.getByRole('button', { name: /^Add note/ }));
    expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Send anyway' }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(1));
  });

  it('attaches an unreadable pasted image rather than losing it', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    const shot = new File(['png'], 'image.png', { type: 'image/png' });
    fireEvent.paste(composerBox(), { clipboardData: { files: [shot], getData: () => '' } });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/attachments')).toHaveLength(1));
    const form = calls('POST', '/api/support/v1/tickets/1284/attachments')[0]!.body as FormData;
    expect((form.get('file') as File).name).toBe('image.png');
  });

  it('shows a drop target naming the ticket while files are dragged over it, and attaches what is dropped', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    const zone = document.querySelector('[data-support-composer]:not([hidden])') as HTMLElement;
    const file = new File(['pdf'], 'INV-2026-0412.pdf', { type: 'application/pdf' });
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.getByText('Drop files to attach to CFX-001284')).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.queryByText('Drop files to attach to CFX-001284')).toBeNull();
    await waitFor(() => expect((calls('POST', '/api/support/v1/tickets/1284/attachments')[0]?.body as FormData).get('file')).toBeTruthy());
  });

  it('refuses a file over 25 MB, and more than ten files', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    const big = new File(['x'], 'huge.mov', { type: 'video/quicktime' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Files to attach'), { target: { files: [big] } });
    expect(toast).toHaveBeenCalledWith('error', 'huge.mov is larger than 25 MB.');
    const many = Array.from({ length: 11 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }));
    fireEvent.change(screen.getByLabelText('Files to attach'), { target: { files: many } });
    expect(toast).toHaveBeenCalledWith('warning', 'At most 10 files a message.');
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/attachments')).toHaveLength(10));
  });

  it('keeps the draft on this computer per ticket, and brings it back', async () => {
    drafts['support:ticket:1284'] = { content: { body: 'Half-written reply', mode: 'reply', status: 'pending_customer', cc: ['it@acmelanka.lk'] } };
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply to Saman Kumara' }).textContent).toBe('Half-written reply'));
    expect(screen.getByRole('combobox', { name: 'Status after sending' }).textContent).toContain('Then: Pending customer');
    expect(screen.getByRole('button', { name: 'Remove it@acmelanka.lk' })).toBeTruthy();
    editReply(composerBox(), 'Half-written reply, now longer');
    await waitFor(() => expect((drafts['support:ticket:1284'] as { content: { body: string } }).content.body).toBe('Half-written reply, now longer'), { timeout: 3000 });
    expect(await screen.findByText(/^Draft saved /)).toBeTruthy();
  });

  it('R and N start a reply or a note; E resolves', async () => {
    renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
    key('r');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Reply to requester' }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByRole('tab', { name: /Conversation/ }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement?.getAttribute('contenteditable')).toBe('true');
    // Typed into the composer, the letters are letters.
    fireEvent.keyDown(document.activeElement!, { key: 'e' });
    expect(screen.queryByRole('dialog')).toBeNull();
    (document.activeElement as HTMLElement).blur();
    key('n');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Internal note' }).getAttribute('aria-checked')).toBe('true'));
    (document.activeElement as HTMLElement).blur();
    key('e');
    expect(await screen.findByRole('dialog', { name: 'Resolve CFX-001284' })).toBeTruthy();
  });
});

describe('who else is here (FR-COM-11)', () => {
  it('says I am here on opening, every 30 seconds, when I type a note, and that I left when the tab closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = renderTab();
    await screen.findByRole('heading', { name: /Microsoft 365/ });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/presence').map((c) => c.body)).toEqual([{ state: 'viewing' }]));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/presence')).toHaveLength(2));
    editReply(composerBox(), 'Checking');
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/presence').at(-1)?.body).toEqual({ state: 'typing', mode: 'note' }));
    view.unmount();
    expect(calls('POST', '/api/support/v1/tickets/1284/presence').at(-1)?.body).toEqual({ state: 'left' });
  });

  it('shows who else is on it', async () => {
    serve({ 'GET /api/support/v1/tickets/1284/presence': { present: [{ user_id: 4, name: 'Nimal Perera', state: 'viewing', mode: null, since: null }] } });
    renderTab();
    expect(await screen.findByText('Nimal is viewing')).toBeTruthy();
  });
});

describe('an older server', () => {
  it('reads the ticket from the as-built API and offers only what it can do', async () => {
    serve({
      'GET /api/support/v1/tickets/1284': new ApiError(404, 'Not found', null),
      'GET /api/support/v1/meta': new ApiError(404, 'Not found', null),
      'GET /api/tickets/1284': {
        ticket: { id: 1284, reference: 'TKT-001284', subject: 'Old server ticket', status: 'open', priority: 'high', requester_name: 'Saman Kumara', requester_email: 'saman@acmelanka.lk', assigned_to: 1, assignee_name: 'Ayesha Fernando', source: 'email', created_at: '2026-10-04 09:12:00' },
        messages: [{ id: 1, body: 'Hello', is_internal: 0, from: 'customer', created_at: '2026-10-04 09:12:00' }],
        events: [],
        can: { reply: true, notes: true, close: true, assign: true, edit: true },
      },
    });
    renderTab();
    expect(await screen.findByRole('heading', { name: 'Old server ticket' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Linked/ })).toBeNull();
    expect(screen.queryByLabelText('Files to attach')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Reply to requester' }));
    expect(screen.queryByRole('button', { name: 'CC' })).toBeNull();
    expect(screen.getByText(/Your WorkSuite server is older/)).toBeTruthy();
  });
});

function editReply(element: HTMLElement, value: string) {
  element.textContent = value;
  element.focus();
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  fireEvent.input(element);
}
