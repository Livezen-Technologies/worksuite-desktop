// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import { legacyListQuery, legacyMeta } from '@shared/support';
import type * as CoreApi from '../../../src/core/api';
import { msg, READY, serveWith, show, ticket, type Call } from './support-fixtures';

/**
 * Tickets raised by hand (WS-SUPPORT-SRS-001 FR-CRT-01/02, worksuite-desktop#298): New ticket in the list's header and
 * C, the form — requester found or new, organization, subject, formatted description, files, priority, type, category,
 * assignee, team, tags, due, the channel (Manual, Phone, Walk-in) and the confirmation email — sent once with an
 * Idempotency-Key, the ticket opened and shown in the lists at once; ⌘K's Create ticket; the channel as a filter, on
 * every message of the thread, and the ticket's origin.
 */
Element.prototype.scrollIntoView ??= vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async (channel: string) => (channel === 'offline:pending' ? [] : undefined)), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), go: vi.fn(), tabsNavigate: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: '/support', active: true, path: ['support'], query: new URLSearchParams(), go: nav.go, navigate: nav.navigate, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
  openWebLink: vi.fn(),
}));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<object>()), navigate: nav.tabsNavigate }));

const { ApiError, request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { toast } = await import('../../../src/core/toasts');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { NEEDS_NEWER_SERVER, createTicket, listTickets, resetApiFamily } = await import('../../../src/modules/support/api');
const { NewTicketSheet } = await import('../../../src/modules/support/NewTicket');
const { descriptionText, emptyForm, fitsList, newTicketInput, validate } = await import('../../../src/modules/support/newTicketForm');
const { OriginLink, originRoute } = await import('../../../src/modules/support/parts');
const { mayCreateTicket } = await import('../../../src/modules/support/palette');
const { Thread, messageChannel } = await import('../../../src/modules/support/Thread');
const { SearchOverlay } = await import('../../../src/app/overlays/SearchOverlay');

const META = {
  statuses: [], priorities: [], types: ['question', 'incident'], sources: ['manual', 'email', 'chat', 'phone', 'walk_in'], views: [], sorts: ['updated'],
  organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: { create: true, assign: true } }],
  departments: [], teams: [{ id: 5, name: 'Tier 1', organization_id: 10, department_id: null, tier: 1 }], categories: [{ id: 3, name: 'Licensing', organization_id: 10 }],
  tags: [{ name: 'printer', organization_id: 10 }], can: { view: true, create: true },
};
const CREATED = ticket(1400, { reference: 'CFX-001400', subject: 'Printer jams on every page', status: 'new', source: 'phone', assignee: { id: 1, name: 'Ayesha Fernando' }, requester: { name: 'Saman Kumara', email: 'saman@acme.lk', phone: null, kind: 'contact', user_id: null, contact_id: 31, company_id: null } });

let log: Call[];
function serve(over: Record<string, unknown> = {}) {
  log = serveWith(request, {
    'GET /api/support/v1/meta': META,
    'GET /api/support/v1/views': { views: [{ key: 'mine', label: 'My tickets', count: 2 }], saved: [], badges: null },
    'GET /api/support/v1/tickets': { items: [ticket(1284), ticket(1292)], next_cursor: null, has_more: false, sort: 'updated', view: 'mine' },
    'GET /api/support/v1/tickets/1400': show(1400, { ticket: CREATED, messages: [msg(1, { channel: null, body: 'Printer jams on every page' })] }),
    'GET /api/support/v1/tickets/1400/presence': { present: [] },
    'POST /api/support/v1/tickets/1400/presence': { present: [] },
    'GET /api/chat/presence/me': new ApiError(403, 'No chat', null),
    'GET /api/support/v1/agents': { agents: [{ id: 1, name: 'Ayesha Fernando', presence: 'available', open: 3, capacity: 15, teams: [] }, { id: 4, name: 'Nimal Perera', presence: 'away', open: 8, capacity: 15, teams: [] }] },
    'GET /api/contacts/lookup': (q: Record<string, unknown>) => ({ results: String(q.q).startsWith('sam') ? [{ kind: 'contact', id: 31, name: 'Saman Kumara', email: 'saman@acme.lk', phone: '+94 77 123 4567', subtitle: 'Acme' }] : [] }),
    'POST /api/support/v1/attachments': { attachment: { id: 77, ticket_id: null, message_id: null, name: 'jam.png', mime: 'image/png', size: 2048, public: true, scan_status: 'clean', created_by: 1, created_at: null } },
    'POST /api/support/v1/tickets': { ticket: CREATED },
    ...over,
  });
}
const calls = (method: string, path: string) => log.filter((c) => c.method === method && c.path === path);
const posted = () => calls('POST', '/api/support/v1/tickets');

function renderInbox(route = '/support') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><SupportPage tabId="t1" route={route} active /></QueryClientProvider>) };
}
function renderSheet(meta: unknown = META) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<QueryClientProvider client={qc}><NewTicketSheet meta={meta as never} onClose={onClose} onCreated={onCreated} /></QueryClientProvider>);
  return { onClose, onCreated };
}
const dialog = () => screen.getByRole('dialog', { name: 'New ticket' });
async function findContact(who = 'sam') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Find the requester' }), { target: { value: who } });
  fireEvent.click(await screen.findByRole('option', { name: /Saman Kumara/ }));
}
function describeIt(words: string) {
  const box = screen.getByRole('textbox', { name: 'Description' });
  box.innerHTML = words;
  fireEvent.input(box);
}
const subject = (v: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Subject' }), { target: { value: v } });
const createButton = () => within(dialog()).getByRole('button', { name: /Create ticket/ });

beforeEach(() => {
  resetApiFamily();
  for (const f of Object.values(nav)) f.mockReset();
  vi.mocked(toast).mockReset();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
  app.set({ ...(READY as object), apps: visibleApps({ apps: ['notes', 'mail', 'chat'], permissions: ['support.view'] }), bootstrap: null } as never);
  serve();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 720, top: 0, left: 0, right: 600, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('New ticket in the inbox', () => {
  it('is a button beside the filters and the C key — not while typing', async () => {
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'New ticket' }));
    expect(dialog()).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'c' });
    expect(await screen.findByRole('dialog', { name: 'New ticket' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Typed into the search box, c is a letter.
    const search = screen.getByRole('searchbox', { name: 'Search tickets' });
    search.focus();
    fireEvent.keyDown(search, { key: 'c' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is not offered without the right to create', async () => {
    serve({ 'GET /api/support/v1/meta': { ...META, can: { view: true, create: false } } });
    renderInbox();
    await screen.findByText('Subject 1284');
    await waitFor(() => expect(calls('GET', '/api/support/v1/meta').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'New ticket' })).toBeNull();
    fireEvent.keyDown(window, { key: 'c' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mayCreateTicket({ can: { create: false } })).toBe(false);
  });

  it('is offered by a server that says nothing of it (an older one), which then answers for itself', async () => {
    const { can: _none, ...older } = META;
    serve({ 'GET /api/support/v1/meta': older });
    renderInbox();
    expect(await screen.findByRole('button', { name: 'New ticket' })).toBeTruthy();
    expect(mayCreateTicket(undefined)).toBe(true);
    expect(mayCreateTicket(legacyMeta())).toBe(true);
  });

  it('opens from ?new=1 (⌘K, ⌘N) and takes it off the route', async () => {
    renderInbox('/support?view=mine&new=1');
    expect(await screen.findByRole('dialog', { name: 'New ticket' })).toBeTruthy();
    expect(nav.go).toHaveBeenCalledWith('/support?view=mine');
  });

  it('opens the ticket raised in the reading pane and shows it in the list at once, without asking the list again', async () => {
    renderInbox();
    const list = await screen.findByRole('listbox', { name: 'My tickets' });
    await within(list).findByText('Subject 1284');
    const asked = calls('GET', '/api/support/v1/tickets').length;
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    await findContact();
    subject('Printer jams on every page');
    fireEvent.click(createButton());
    expect(await screen.findByRole('article', { name: 'Ticket CFX-001400' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    const rows = within(list).getAllByRole('option');
    expect(rows[0]!.textContent).toContain('Printer jams on every page');
    expect(calls('GET', '/api/support/v1/tickets')).toHaveLength(asked);
    expect(toast).toHaveBeenCalledWith('success', 'CFX-001400 created.');
  });
});

describe('the form', () => {
  it('asks for a subject and a requester, and checks an email address', async () => {
    renderSheet();
    fireEvent.click(createButton());
    expect(await within(dialog()).findByText('Give the ticket a subject.')).toBeTruthy();
    expect(within(dialog()).getByText('Find the requester among your contacts, or add a new one.')).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'New requester' }));
    expect(within(dialog()).getByText('Give the requester a name, an email address or a phone number.')).toBeTruthy();
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Email' }), { target: { value: 'saman@acme' } });
    expect(within(dialog()).getByText('That is not an email address.')).toBeTruthy();
    expect(posted()).toHaveLength(0);
    expect(validate(emptyForm(null, 1), { organizations: 2 })).toMatchObject({ subject: expect.any(String), requester: expect.any(String), organization: 'Choose the company.' });
  });

  it('names each list above it, the company picker beside Subject in line with its box', () => {
    renderSheet({ ...META, organizations: [...META.organizations, { id: 11, name: 'Livezen Technologies Pvt Ltd', prefix: 'LZT', can: { create: true, assign: true } }] });
    const d = within(dialog());
    for (const name of ['Company', 'Type', 'Category', 'Assignee', 'Team']) {
      const picker = d.getByRole('combobox', { name });
      // The visible name sits right above the picker, as Subject's sits above its box.
      expect(picker.parentElement?.firstElementChild?.textContent).toBe(name);
    }
  });

  it('sends a contact found as the requester, with an Idempotency-Key, mine, by hand, confirming by email', async () => {
    const { onCreated, onClose } = renderSheet();
    await findContact();
    expect(within(dialog()).getByText(/Contact · saman@acme.lk/)).toBeTruthy();
    subject('Printer jams on every page');
    fireEvent.click(createButton());
    await waitFor(() => expect(posted()).toHaveLength(1));
    const call = posted()[0]!;
    expect(call.body).toEqual({
      subject: 'Printer jams on every page',
      requester: { name: 'Saman Kumara', email: 'saman@acme.lk', phone: '+94 77 123 4567', contact_id: 31 },
      organization_id: 10,
      source: 'manual',
      priority: 'normal',
      assigned_to: 1,
      notify_requester: true,
    });
    expect(call.headers?.['Idempotency-Key']).toMatch(/^ticket:/);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 1400, reference: 'CFX-001400' })));
    expect(onClose).toHaveBeenCalled();
    expect(calls('GET', '/api/contacts/lookup')[0]!.query).toMatchObject({ q: 'sam', kinds: 'contact,customer,employee' });
  });

  it('sends a new requester by name, email and phone; Phone or Walk-in as the channel; the confirmation only with an address', async () => {
    renderSheet();
    fireEvent.change(screen.getByRole('combobox', { name: 'Find the requester' }), { target: { value: 'kumari@lotus.lk' } });
    fireEvent.click(await screen.findByRole('option', { name: /Add “kumari@lotus.lk” as a new requester/ }));
    expect((within(dialog()).getByRole('textbox', { name: 'Email' }) as HTMLInputElement).value).toBe('kumari@lotus.lk');
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Kumari Silva' } });
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Phone' }), { target: { value: '0771234567' } });
    subject('Laptop will not start');
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Walk-in' }));
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'High' }));
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: /Send the requester a confirmation email/ }));
    fireEvent.click(createButton());
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]!.body).toMatchObject({ requester: { name: 'Kumari Silva', email: 'kumari@lotus.lk', phone: '0771234567' }, source: 'walk_in', priority: 'high', notify_requester: false });
    expect((posted()[0]!.body as { requester: Record<string, unknown> }).requester).not.toHaveProperty('contact_id');
  });

  it('has no confirmation to send to a requester without an email address', async () => {
    renderSheet();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'New requester' }));
    fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Walk-in visitor' } });
    const box = within(dialog()).getByRole('checkbox', { name: /Send the requester a confirmation email/ }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    subject('Lost access card');
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Phone' }));
    fireEvent.click(createButton());
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]!.body).toMatchObject({ requester: { name: 'Walk-in visitor', email: null, phone: null }, source: 'phone', notify_requester: false });
  });

  it('uploads files first and sends their ids with the description', async () => {
    renderSheet();
    await findContact();
    subject('Printer jams');
    const file = new File(['png'], 'jam.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Files to attach'), { target: { files: [file] } });
    expect(await within(dialog()).findByRole('button', { name: 'Remove jam.png' })).toBeTruthy();
    const upload = calls('POST', '/api/support/v1/attachments')[0]!;
    expect(upload.body).toBeInstanceOf(FormData);
    // The files go with the description: one is needed.
    fireEvent.click(createButton());
    expect(await within(dialog()).findByText('Describe the problem: the files go with the description.')).toBeTruthy();
    expect(posted()).toHaveLength(0);
    describeIt('<div>It jams on <b>every</b> page</div><ul><li>Tray 1</li><li>Tray 2</li></ul>');
    fireEvent.click(createButton());
    await waitFor(() => expect(posted()).toHaveLength(1));
    const body = posted()[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ description: 'It jams on every page\n• Tray 1\n• Tray 2', attachment_ids: [77], attachments: [77] });
    expect(String(body.description_html)).toContain('<b>every</b>');
  });

  it('sends the category, type, team, tags and due date chosen', () => {
    const f = { ...emptyForm(10, 1), subject: ' VPN ', requester: { mode: 'new' as const, found: null, name: 'Dilan', email: '', phone: '' }, type: 'incident' as const, category: 3, team: 5, assignee: null, tags: ['vpn'], due: '2026-10-09T17:00' };
    const input = newTicketInput(f);
    expect(input).toMatchObject({ subject: 'VPN', organization_id: 10, type: 'incident', category_id: 3, team_id: 5, assigned_to: null, tags: ['vpn'], notify_requester: false });
    expect(input.due_at).toBe(new Date('2026-10-09T17:00').toISOString());
    expect(descriptionText('<ol><li>One</li><li>Two</li></ol>')).toBe('1. One\n2. Two');
  });

  it('says the server’s refusal in the form, and Create again is the same request', async () => {
    serve({ 'POST /api/support/v1/tickets': new ApiError(403, 'You may not create tickets in CreativeFX.', 'FORBIDDEN') });
    renderSheet();
    await findContact();
    subject('Printer jams');
    fireEvent.click(createButton());
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('You may not create tickets in CreativeFX.');
    fireEvent.click(createButton());
    await waitFor(() => expect(posted()).toHaveLength(2));
    expect(posted()[1]!.headers?.['Idempotency-Key']).toBe(posted()[0]!.headers?.['Idempotency-Key']);
  });

  it('keeps what was typed when offline, and says so', async () => {
    serve({ 'POST /api/support/v1/tickets': new ApiError(0, 'Offline', 'NETWORK_UNREACHABLE') });
    renderSheet();
    await findContact();
    subject('Printer jams');
    fireEvent.click(createButton());
    expect((await within(dialog()).findByRole('alert')).textContent).toContain('You are offline');
    expect((screen.getByRole('textbox', { name: 'Subject' }) as HTMLInputElement).value).toBe('Printer jams');
  });

  it('on a server without the v1 API, says it needs a newer one', async () => {
    serve({ 'POST /api/support/v1/tickets': new ApiError(404, 'Not found', null), 'GET /api/support/v1/meta': new ApiError(404, 'Not found', null) });
    renderSheet(legacyMeta());
    await findContact();
    subject('Printer jams');
    fireEvent.click(createButton());
    expect((await within(dialog()).findByRole('alert')).textContent).toBe(NEEDS_NEWER_SERVER);
    await expect(createTicket({ subject: 'x', requester: {}, source: 'manual', priority: 'normal', notify_requester: false }, 'k')).rejects.toThrow(NEEDS_NEWER_SERVER);
  });
});

describe('⌘K', () => {
  function showSearch(q?: string) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><SearchOverlay mode="search" /></QueryClientProvider>);
    if (q !== undefined) fireEvent.change(screen.getByLabelText('Search WorkSuite'), { target: { value: q } });
  }

  it('offers Create ticket to whoever may raise one, opening Support’s New ticket form', async () => {
    showSearch();
    fireEvent.click(await screen.findByRole('button', { name: 'Create ticket' }));
    expect(nav.tabsNavigate).toHaveBeenCalledWith('/support?new=1');
    cleanup();
    showSearch('>ticket');
    expect(await screen.findByRole('option', { name: /Create ticket/ })).toBeTruthy();
  });

  it('does not offer it without the right, nor without Support', async () => {
    serve({ 'GET /api/support/v1/meta': { ...META, can: { view: true, create: false } } });
    showSearch('>ticket');
    await waitFor(() => expect(calls('GET', '/api/support/v1/meta').length).toBeGreaterThan(0));
    await act(async () => undefined);
    expect(screen.queryByRole('option', { name: /Create ticket/ })).toBeNull();
    cleanup();
    serve();
    app.set({ apps: visibleApps({ apps: ['notes'], permissions: [] }) } as never);
    showSearch();
    await screen.findByRole('button', { name: 'New note' });
    expect(screen.queryByRole('button', { name: 'Create ticket' })).toBeNull();
  });
});

describe('the channel', () => {
  it('filters the list by channel (source=)', async () => {
    renderInbox();
    await screen.findByText('Subject 1284');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Walk-in/ }));
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets').at(-1)!.query).toMatchObject({ source: 'walk_in' }));
    expect(screen.getByRole('button', { name: 'Filters (1 on)' })).toBeTruthy();
    await listTickets({ view: 'all', source: ['phone', 'walk_in'] });
    expect(calls('GET', '/api/support/v1/tickets').at(-1)!.query).toMatchObject({ source: 'phone,walk_in' });
    const { keep } = legacyListQuery({ view: 'all', source: ['phone'] });
    expect(keep(ticket(1, { source: 'phone' }) as never)).toBe(true);
    expect(keep(ticket(2, { source: 'email' }) as never)).toBe(false);
  });

  it('labels each message with its channel: the first falls back to the ticket’s source, a note is an internal note', () => {
    const messages = [
      msg(1, { channel: null }),
      msg(2, { channel: 'note', internal: true, from: 'staff', author_name: 'Nimal Perera' }),
      msg(3, { channel: 'reply', from: 'staff', author_name: 'Ayesha Fernando' }),
      msg(4, { channel: 'email' }),
      msg(5, { channel: 'phone' }),
    ];
    render(<Thread messages={messages as never} source="walk_in" />);
    const labels = Array.from(document.querySelectorAll('[data-message]')).map((li) => li.querySelector('[data-channel]')?.textContent ?? null);
    expect(labels).toEqual(['Walk-in', 'Internal note', null, 'Email', 'Phone']);
    expect(screen.getByText('Replied to requester')).toBeTruthy();
    expect(messageChannel(msg(1, { channel: null }) as never, true, null)).toBeNull();
    expect(messageChannel(msg(1, { channel: 'agent', from: 'staff', delivery_channel: 'email' }) as never, false)).toBe('email');
  });

  it('shows where the ticket came from: the email in Mail, the website chat', async () => {
    const open = vi.fn();
    render(<OriginLink origin={{ type: 'email', mail_message_id: 55 }} onOpen={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'From email' }));
    expect(open).toHaveBeenCalledWith('/mail?msg=55');
    expect(originRoute({ type: 'chat', conversation_id: 9 })).toBe('/chat?view=website&website=9');
    expect(originRoute({ type: 'email', mail_message_id: null })).toBeNull();
    // The server says which mailbox and folder the uid is in: Mail opens that message, not a guess.
    expect(originRoute({ type: 'email', mail_message_id: 55, mailbox_id: 4, folder: 'INBOX/Support' })).toBe('/mail?msg=55&mbx=4&mf=INBOX%2FSupport');
    expect(originRoute({ type: 'email', mail_message_id: 55 })).toBe('/mail?msg=55');
    cleanup();
    render(<OriginLink origin={{ type: 'email', mail_message_id: null }} />);
    expect(screen.getByText('From email')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    // In the reading pane, opened in Chat.
    serve({ 'GET /api/support/v1/tickets/1284': show(1284, { ticket: ticket(1284, { origin: { type: 'chat', conversation_id: 9 } }) }) });
    renderInbox();
    fireEvent.click(await screen.findByText('Subject 1284'));
    const pane = await screen.findByRole('article', { name: 'Ticket CFX-001284' });
    fireEvent.click(within(pane).getByRole('button', { name: 'From web chat' }));
    expect(nav.tabsNavigate).toHaveBeenCalledWith('/chat?view=website&website=9');
  });

  it('puts a ticket raised in the lists it belongs in, as far as the desktop can tell', () => {
    const t = ticket(1, { status: 'new', assignee: { id: 1, name: 'Ayesha' }, source: 'phone' }) as never;
    expect(fitsList(t, { view: 'mine' }, 1)).toBe(true);
    expect(fitsList(t, { view: 'mine' }, 2)).toBe(false);
    expect(fitsList(t, { view: 'unassigned' }, 1)).toBe(false);
    expect(fitsList(t, { view: 'all', source: ['email'] }, 1)).toBe(false);
    expect(fitsList(t, { view: 'all', organization: ['10'] }, 1)).toBe(true);
    expect(fitsList(t, { view: 'all', organization: ['11'] }, 1)).toBe(false);
    expect(fitsList(t, { view: 'all', q: 'printer' }, 1)).toBe(false);
    expect(fitsList(t, { view: 'live', saved: 3 }, 1)).toBe(false);
  });
});
