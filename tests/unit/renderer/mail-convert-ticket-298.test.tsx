// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';
import { serveWith, ticket, type Call } from './support-fixtures';

/**
 * worksuite-desktop#298, the Mail side: any message can be converted to a Support ticket — from the header's ⋯, the
 * reader's More, the list's right-click menu and the Apps pane — where the server converts email (`GET meta`'s
 * `capabilities.convert_email` and `can.convert_email`); a linked message shows its ticket's chip and a marker on its
 * row; an email converted twice is one ticket ("Already ticket … · View ticket"); and the Apps pane's helpdesk ticket
 * and the Quick Step use the conversion, keeping the as-built copy for an older server.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn(), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true, platform: 'linux' }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

const { ApiError, apiGet, apiGetMeta, apiPost, request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { call } = await import('../../../src/core/bridge');
const { TabProvider } = await import('../../../src/core/tab-context');
const { setRegional } = await import('../../../src/core/time');
const { toast } = await import('../../../src/core/toasts');
const { conversionOffer, resetApiFamily } = await import('../../../src/modules/support/api');
const { suggestedOrganization } = await import('../../../src/modules/support/ConvertEmailSheet');
const { MessageView } = await import('../../../src/modules/mail/MessageView');
const { AppsPane } = await import('../../../src/modules/mail/AppsPane');
const { MessageList } = await import('../../../src/modules/mail/MessageList');
const { listMenuSections } = await import('../../../src/modules/mail/listActions');
const { runQuickStep } = await import('../../../src/modules/mail/quickSteps');
import type { MessageListProps, ListRow } from '../../../src/modules/mail/MessageList';
import type { Runner, QuickStep } from '../../../src/modules/mail/quickSteps';
import type { Target } from '../../../src/modules/mail/MessageMenus';
import type { MessageDetail, MessageRef, MessageRow } from '../../../src/modules/mail/types';

const REF: MessageRef = { uid: '102', folder: 'inbox', mailbox: '2' };
const ACCOUNT = { id: 2, email: 'desk@creativefx.example', display_name: 'Desk', shared: false, unread: 0, provider: 'imap' };
const CAN = { capabilities: { convert_chat: true, convert_email: true, mail_intake: true }, can: { create: true, convert_chat: true, convert_email: true } };
const META = { statuses: [], priorities: [], types: [], sources: [], views: [], sorts: [], departments: [], teams: [], categories: [], tags: [], organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: {} }, { id: 20, name: 'Lotus Interiors', prefix: 'LOT', can: {} }] };

let message: Record<string, unknown>;
let log: Call[];
const conversions = () => log.filter((c) => c.method === 'POST' && c.path === '/api/support/v1/conversions/email');
function serve(over: Record<string, unknown> = {}) {
  log = serveWith(request, {
    'GET /api/support/v1/meta': { ...META, ...CAN },
    'GET /api/support/v1/tickets': (q: Record<string, unknown>) => ({ items: q.q === 'acrobat' ? [ticket(1248, { subject: 'Acrobat Pro for 3 users' }), ticket(1250, { subject: 'Acrobat (old)', status: 'closed' })] : [ticket(1240)], next_cursor: null, has_more: false, sort: 'updated', view: 'all' }),
    'POST /api/support/v1/conversions/email': { ticket: ticket(1300, { reference: 'CFX-001300', status: 'new' }), appended: false, existing: false, note: false },
    ...over,
  });
}

function Reader() {
  return (
    <TabProvider tabId="t" route="/mail" active>
      <MessageView
        msgRef={REF}
        backLabel="Inbox"
        onBack={() => undefined}
        onReply={() => undefined}
        onGone={() => undefined}
        onPrev={null}
        onNext={null}
        prefs={{}}
        onPrefs={() => undefined}
        focus={false}
        onFocus={() => undefined}
        boxes={[ACCOUNT]}
        localStore={false}
        offline={false}
        account={ACCOUNT}
      />
    </TabProvider>
  );
}
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const header = () =>
  waitFor(() => {
    const h = document.querySelector('[data-message-header]');
    if (!h) throw new Error('no header yet');
    return h as HTMLElement;
  });
async function moreMenu(): Promise<HTMLElement> {
  fireEvent.click(within(await header()).getByRole('button', { name: 'More actions for this email' }));
  return screen.findByRole('menu', { name: 'More actions for this email' });
}
const items = (menu: HTMLElement) => [...menu.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent ?? '');
const metaRead = () => waitFor(() => expect(log.some((c) => c.path === '/api/support/v1/meta')).toBe(true));

beforeEach(() => {
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  resetApiFamily();
  nav.navigate.mockReset();
  vi.mocked(toast).mockReset();
  message = { id: 102, message_id: '<licence-1@lotus.example>', from_name: 'Malsha Peiris', from_email: 'malsha@lotus.example', subject: 'Acrobat keys not received', to: ['desk@creativefx.example'], cc: [], body_html: '<p>We paid for 3 licences</p>', is_starred: false, is_read: true, attachments: [], created_at: '2026-10-05 09:00:00' };
  app.set({ status: { network: 'ONLINE' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'desk@creativefx.example' } } as never, auth: { server: { origin: 'https://ws.example' } } as never, apps: [{ id: 'support' }, { id: 'tasks' }] as never });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/messages/102/context') return { sender: { email: 'malsha@lotus.example', name: 'Malsha Peiris', contact_id: 5, user_id: null, is_colleague: false, company: 'Lotus Interiors' }, security: { available: false } };
    if (path === '/api/crm/leads') return { leads: [] };
    if (path === '/api/crm/accounts') return { accounts: [] };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/messages/102') return { data: message, offline: false, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : null)) as never);
  serve();
});
afterEach(() => cleanup());

describe('what the server offers', () => {
  it('converts only where Support takes email and it is mine to do; an older server says nothing', () => {
    expect(conversionOffer(META, 'email')).toBe('unknown');
    expect(conversionOffer(null, 'email')).toBe('unknown');
    expect(conversionOffer(CAN, 'email')).toBe('yes');
    expect(conversionOffer({ ...CAN, capabilities: { ...CAN.capabilities, convert_email: false } }, 'email')).toBe('no');
    expect(conversionOffer({ ...CAN, can: { create: true, convert_email: false } }, 'email')).toBe('no');
    // No separate right named: creating tickets is the right.
    expect(conversionOffer({ capabilities: CAN.capabilities, can: { create: false } }, 'chat')).toBe('no');
    expect(conversionOffer({ capabilities: CAN.capabilities, can: {} }, 'chat')).toBe('yes');
  });

  it('suggests my only organization, else the sender’s company, else none (Needs organization)', () => {
    expect(suggestedOrganization(META.organizations, 'lotus interiors ')).toBe(20);
    expect(suggestedOrganization(META.organizations, 'Somebody Else')).toBeNull();
    expect(suggestedOrganization([META.organizations[0]!], null)).toBe(10);
    expect(suggestedOrganization([], 'Lotus Interiors')).toBeNull();
  });
});

describe('Convert to ticket in the reader', { timeout: 20_000 }, () => {
  it('makes a new ticket with the subject and the sender’s organization, toasts its reference with Open, and shows its chip', async () => {
    wrap(<Reader />);
    await metaRead();
    const menu = await moreMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Convert to ticket/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Malsha Peiris · malsha@lotus.example')).toBeTruthy();
    const subject = within(dialog).getByLabelText('Subject') as HTMLInputElement;
    expect(subject.value).toBe('Acrobat keys not received');
    fireEvent.change(subject, { target: { value: 'Acrobat keys missing' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Convert to ticket/ }));
    await waitFor(() => expect(conversions()).toHaveLength(1));
    expect(conversions()[0]!.body).toEqual({ mail_message_id: 102, folder: 'inbox', mailbox: '2', target: 'new', subject: 'Acrobat keys missing', organization_id: 20 });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Converted to CFX-001300.', expect.objectContaining({ label: 'Open' })));
    const action = vi.mocked(toast).mock.calls.find((c) => c[0] === 'success')![2] as { run: () => void };
    action.run();
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1300');
    // The message now shows its ticket, and the menu offers View ticket instead.
    const chip = await within(await header()).findByRole('button', { name: 'Open ticket CFX-001300' });
    fireEvent.click(chip);
    expect(nav.navigate).toHaveBeenLastCalledWith('/support/ticket/1300');
    expect(screen.queryByRole('dialog')).toBeNull();
    const again = await moreMenu();
    expect(items(again).some((t) => t.startsWith('View ticket CFX-001300'))).toBe(true);
    expect(items(again).some((t) => t.startsWith('Convert to ticket'))).toBe(false);
  });

  it('adds the email to an existing ticket found by reference or subject, never a closed one', async () => {
    serve({ 'POST /api/support/v1/conversions/email': { ticket: ticket(1248, { status: 'open' }), appended: true, existing: false, note: false } });
    wrap(<Reader />);
    await metaRead();
    fireEvent.click(within(await moreMenu()).getByRole('menuitem', { name: /Convert to ticket/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Add to an existing ticket' }));
    expect(await within(dialog).findByText('CFX-001240')).toBeTruthy();
    // Nothing chosen yet: nothing to add to.
    expect((within(dialog).getByRole('button', { name: /^Add to ticket/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Find a ticket'), { target: { value: 'acrobat' } });
    fireEvent.click(await within(dialog).findByRole('radio', { name: /CFX-001248/ }));
    expect(within(dialog).queryByText('CFX-001250')).toBeNull();
    expect(log.some((c) => c.path === '/api/support/v1/tickets' && c.query?.q === 'acrobat' && c.query?.view === 'all')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add to ticket/ }));
    await waitFor(() => expect(conversions()).toHaveLength(1));
    expect(conversions()[0]!.body).toEqual({ mail_message_id: 102, folder: 'inbox', mailbox: '2', target: 1248 });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Added to CFX-001248.', expect.objectContaining({ label: 'Open' })));
  });

  it('an email that is a ticket already: "Already ticket …" with View ticket, and the message shows it', async () => {
    serve({ 'POST /api/support/v1/conversions/email': new ApiError(409, 'That email is already a ticket', 'already_converted', { ticket: { id: 1042, reference: 'CFX-001042', status: 'open' } }) });
    wrap(<Reader />);
    await metaRead();
    fireEvent.click(within(await moreMenu()).getByRole('menuitem', { name: /Convert to ticket/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Convert to ticket/ }));
    const status = await within(dialog).findByRole('status');
    expect(status.textContent).toContain('Already ticket');
    expect(status.textContent).toContain('CFX-001042');
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything());
    expect(await within(await header()).findByRole('button', { name: 'Open ticket CFX-001042' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'View ticket' }));
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1042');
  });

  it('is not offered without the Support app, where Support takes no email, without the right, or by an older server', async () => {
    const offered = async () => {
      wrap(<Reader />);
      await header();
      const has = items(await moreMenu()).some((t) => t.startsWith('Convert to ticket'));
      cleanup();
      return has;
    };
    app.set((s) => ({ ...s, apps: [{ id: 'tasks' }] as never }));
    expect(await offered()).toBe(false);
    app.set((s) => ({ ...s, apps: [{ id: 'support' }, { id: 'tasks' }] as never }));
    serve({ 'GET /api/support/v1/meta': { ...META, capabilities: { convert_chat: true, convert_email: false, mail_intake: false }, can: CAN.can } });
    wrap(<Reader />);
    await metaRead();
    expect(items(await moreMenu()).some((t) => t.startsWith('Convert to ticket'))).toBe(false);
    cleanup();
    resetApiFamily();
    serve({ 'GET /api/support/v1/meta': { ...META, ...CAN, can: { create: true, convert_email: false } } });
    wrap(<Reader />);
    await metaRead();
    expect(items(await moreMenu()).some((t) => t.startsWith('Convert to ticket'))).toBe(false);
    cleanup();
    resetApiFamily();
    serve({ 'GET /api/support/v1/meta': META });
    wrap(<Reader />);
    await metaRead();
    expect(items(await moreMenu()).some((t) => t.startsWith('Convert to ticket'))).toBe(false);
  });

  it('a linked message shows "CFX-001042 · Open" in its header, which opens the ticket', async () => {
    message = { ...message, support_ticket: { id: 1042, reference: 'CFX-001042', status: 'open' } };
    wrap(<Reader />);
    const h = await header();
    const chip = await within(h).findByRole('button', { name: 'Open ticket CFX-001042' });
    expect(chip.textContent).toContain('CFX-001042');
    expect(chip.textContent).toContain('Open');
    fireEvent.click(chip);
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1042');
    await metaRead();
    const menu = await moreMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /View ticket CFX-001042/ }));
    expect(nav.navigate).toHaveBeenCalledTimes(2);
  });
});

describe('the list', () => {
  const row = (over: Partial<MessageRow> = {}): MessageRow => ({ id: 12, from_name: 'Malsha Peiris', from_email: 'malsha@lotus.example', subject: 'Acrobat keys', preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-05 09:00:00', folder_slug: 'inbox', ...over });

  it('marks a row whose message is a ticket', () => {
    const rows: ListRow[] = [row({ id: 12, support_ticket: { id: 1042, reference: 'CFX-001042', status: 'open' } }), row({ id: 13, subject: 'Other' })].map((r) => ({ row: r, key: String(r.id), queued: null }));
    const noop = () => undefined;
    const props: MessageListProps = {
      title: 'Inbox', groups: [{ key: 'all', label: '', rows: rows.map((i) => i.row), items: rows }], total: 2, loading: false, error: null, onRetry: noop,
      selectedKey: null, onOpen: noop, onStar: noop, prefs: { view: 'compact' }, onPrefs: noop, conversations: null, onConversations: noop, chips: [], onChips: noop,
      search: '', onSearch: noop, onSearchAll: noop, unified: false, boxes: [], offline: false, offlineDays: 0, refreshing: false, onRefresh: noop, hasMore: false, loadingMore: false, onMore: noop,
    };
    wrap(<MessageList {...props} />);
    const linked = screen.getByText('Acrobat keys').closest('[role="option"]') as HTMLElement;
    expect(within(linked).getByRole('img', { name: 'Ticket CFX-001042' })).toBeTruthy();
    expect(linked.querySelector('[data-ticket-marker]')?.textContent).toBe('CFX-001042');
    expect((screen.getByText('Other').closest('[role="option"]') as HTMLElement).querySelector('[data-ticket-marker]')).toBeNull();
  });

  it('right-click: Convert to ticket… for one message where offered, View ticket for a linked one', () => {
    const base = { run: vi.fn(), keyFor: () => undefined, offline: false, state: [], quickSteps: [] };
    const target = (r: MessageRow): Target => ({ row: r, mailbox: '4', folder: 'inbox' });
    const find = (sections: ReturnType<typeof listMenuSections>) => sections.flatMap((s) => s.items).find((i) => i.id === 'ticket');
    const convert = vi.fn();
    const view = vi.fn();
    const one = find(listMenuSections([target(row())], { ...base, ticket: convert, viewTicket: view }))!;
    expect(one.label).toBe('Convert to ticket…');
    one.onSelect!();
    expect(convert).toHaveBeenCalledWith(target(row()));
    const linked = find(listMenuSections([target(row({ support_ticket: { id: 1042, reference: 'CFX-001042', status: 'open' } }))], { ...base, ticket: convert, viewTicket: view }))!;
    expect(linked.label).toBe('View ticket CFX-001042');
    linked.onSelect!();
    expect(view).toHaveBeenCalledWith(1042);
    // Not offered (no Support, or no conversion here), and never for several messages at once.
    expect(find(listMenuSections([target(row())], base))).toBeUndefined();
    expect(find(listMenuSections([target(row()), target(row({ id: 13 }))], { ...base, ticket: convert }))).toBeUndefined();
  });
});

describe('the Apps pane’s helpdesk ticket', () => {
  const detail = (over: Partial<MessageDetail> = {}): MessageDetail => ({ id: 102, message_id: '<a@x>', from_name: 'Malsha Peiris', from_email: 'malsha@lotus.example', subject: 'Acrobat keys', to: [], cc: [], body_html: '<p>We paid</p>', is_starred: false, attachments: [], created_at: '2026-10-05 09:00:00', ...over });
  const pane = (m: MessageDetail, onConvertTicket = vi.fn()) => {
    wrap(<AppsPane m={m} link="https://ws.example/mail?msg=102" context={null} offline={false} navigate={nav.navigate} onCreateTask={vi.fn()} onSaveNote={vi.fn()} onConvertTicket={onConvertTicket} onClose={vi.fn()} />);
    return { onConvertTicket, aside: screen.getByRole('complementary', { name: 'Apps' }) };
  };

  it('converts the email where the server does, and copies it into a ticket of its own on an older server', async () => {
    const a = pane(detail());
    fireEvent.click(await within(a.aside).findByRole('button', { name: 'Convert to ticket…' }));
    expect(a.onConvertTicket).toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    cleanup();
    resetApiFamily();
    serve({ 'GET /api/support/v1/meta': META });
    const b = pane(detail());
    await metaRead();
    fireEvent.click(within(b.aside).getByRole('button', { name: 'Create a helpdesk ticket' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tickets', expect.objectContaining({ subject: 'Acrobat keys', requester_email: 'malsha@lotus.example' })));
    expect(b.onConvertTicket).not.toHaveBeenCalled();
  });

  it('shows the ticket a linked email became, and nothing where Support takes no email or is not mine', async () => {
    const a = pane(detail({ support_ticket: { id: 1042, reference: 'CFX-001042', status: 'open' } }));
    fireEvent.click(within(a.aside).getByRole('button', { name: 'Open ticket CFX-001042' }));
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1042');
    cleanup();
    serve({ 'GET /api/support/v1/meta': { ...META, capabilities: { convert_email: false } } });
    const b = pane(detail());
    await metaRead();
    await waitFor(() => expect(within(b.aside).queryByRole('region', { name: 'Helpdesk' })).toBeNull());
    cleanup();
    app.set((s) => ({ ...s, apps: [] as never }));
    const c = pane(detail());
    expect(within(c.aside).queryByRole('region', { name: 'Helpdesk' })).toBeNull();
  });
});

describe('the Create a helpdesk ticket Quick Step', () => {
  const step: QuickStep = { id: 1, name: 'To the desk', icon: 'zap', shortcut: null, tooltip: null, actions: [{ type: 'create_ticket' }], ask_fields: [], org: false, position: 0 };
  const row = (id: number): MessageRow => ({ id, from_name: 'Malsha', from_email: 'malsha@lotus.example', subject: `S${id}`, preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-05 09:00:00' });
  const runner = (meta: unknown, post: (path: string, body: unknown) => unknown = () => ({})) => {
    const posts: Array<[string, unknown]> = [];
    const gets: string[] = [];
    const r: Runner = {
      action: vi.fn(async () => 'done' as const),
      move: vi.fn(async () => 'done' as const),
      state: vi.fn(async () => 'done' as const),
      post: vi.fn(async (path: string, body: unknown) => (posts.push([path, body]), post(path, body))) as unknown as Runner['post'],
      get: vi.fn(async (path: string) => {
        gets.push(path);
        if (path === '/api/support/v1/meta') {
          if (meta instanceof Error) throw meta;
          return meta;
        }
        return { body_html: '<p>We paid</p>', attachments: [] };
      }) as unknown as Runner['get'],
    };
    return { r, posts, gets };
  };
  const targets = [{ row: row(12), mailbox: '4', folder: 'inbox' }, { row: row(13), mailbox: null, folder: 'label:Clients' }];

  it('converts each message where the server does, asking it once a run', async () => {
    const { r, posts, gets } = runner(CAN);
    const report = await runQuickStep(step, targets, r);
    expect(report).toMatchObject({ done: 2, failed: 0 });
    expect(posts).toEqual([
      ['/api/support/v1/conversions/email', { mail_message_id: 12, folder: 'inbox', mailbox: '4', target: 'new' }],
      ['/api/support/v1/conversions/email', { mail_message_id: 13, folder: 'label:Clients', target: 'new' }],
    ]);
    expect(gets.filter((g) => g === '/api/support/v1/meta')).toHaveLength(1);
  });

  it('an email that is a ticket already is done; Support taking no email is said; an older server copies the text', async () => {
    const twice = runner(CAN, () => {
      throw new ApiError(409, 'Already', 'already_converted', { ticket: { id: 1042, reference: 'CFX-001042', status: 'open' } });
    });
    expect(await runQuickStep(step, [targets[0]!], twice.r)).toMatchObject({ done: 1, failed: 0 });
    const off = runner({ ...CAN, capabilities: { convert_email: false } });
    const report = await runQuickStep(step, [targets[0]!], off.r);
    expect(report.errors).toEqual(['S12: Making tickets from email is not available to you.']);
    expect(off.posts).toEqual([]);
    const older = runner(new ApiError(404, 'Not found', null));
    await runQuickStep(step, [targets[0]!], older.r);
    expect(older.posts).toEqual([['/api/tickets', expect.objectContaining({ subject: 'S12', requester_email: 'malsha@lotus.example' })]]);
  });
});
