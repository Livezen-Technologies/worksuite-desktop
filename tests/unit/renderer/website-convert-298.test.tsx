// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';
import { READY, serveWith, type Call } from './support-fixtures';

/**
 * worksuite-desktop#298, a website chat → ticket: the visitor without an email address is asked for one in the sheet
 * before converting (sent as `requester_email`; a `422 requester_email_required` focuses the field with the reason),
 * the chat's files are listed and copied, and a chat that is a ticket shows its reference chip and View ticket
 * instead of Convert to ticket — which the server can switch off (`capabilities.convert_chat`, `can.convert_chat`).
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn(), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tabs = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: tabs.navigate }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div> }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=77'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

const { ApiError, apiGet, request } = await import('../../../src/core/api');
const { toast } = await import('../../../src/core/toasts');
const { app } = await import('../../../src/core/app-state');
const { ConvertSheet, convertInput, initialForm } = await import('../../../src/modules/support/ConvertSheet');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const { WebsiteThread } = await import('../../../src/modules/chat/website/WebsiteThread');

const CAN = { capabilities: { convert_chat: true, convert_email: true, mail_intake: true }, can: { create: true, convert_chat: true, convert_email: true } };
const META = { organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: {} }], departments: [], teams: [], categories: [], tags: [], statuses: [], priorities: [], types: [], sources: [], views: [], sorts: [], can: {} };
const PREVIEW = {
  conversation: { id: 77, status: 'open', website: 'creativefx.lk', widget: 'Main', offline: false, started_at: null },
  visitor: { id: 4471, name: 'Malsha Peiris', email: null, phone: null, company: null },
  ticket: null,
  candidates: [],
  prefill: { subject: 'Acrobat Pro × 3 keys not received', organization_id: 10, priority: 'normal', source: 'chat' },
  details: 'Website chat #77 — visitor details',
  transcript: [
    { id: 1, from: 'visitor', name: 'Malsha Peiris', body: 'We paid for 3 licences yesterday', at: '2026-10-04T09:31:00+05:30', files: [{ name: 'receipt.pdf', mime: 'application/pdf', size: 18_000 }] },
    { id: 2, from: 'agent', name: 'Ayesha Fernando', body: 'I will raise a ticket with licensing', at: '2026-10-04T09:35:00+05:30', files: [] },
  ],
};
const ANSWER = { ticket: { id: 1291, reference: 'CFX-001291', status: 'new' }, appended: false, copied: 2, files: 1, files_refused: 0, notified: true };

let log: Call[];
const posts = () => log.filter((c) => c.method === 'POST' && c.path === '/api/support/v1/conversions');
function serve(over: Record<string, unknown> = {}) {
  log = serveWith(request, {
    'GET /api/support/v1/conversions/77': PREVIEW,
    'GET /api/support/v1/meta': { ...META, ...CAN },
    'GET /api/support/v1/agents': { agents: [] },
    'POST /api/support/v1/conversions': ANSWER,
    ...over,
  });
}
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function sheet() {
  render(<QueryClientProvider client={client()}><ConvertSheet conversationId={77} onClose={vi.fn()} /></QueryClientProvider>);
  return screen.findByRole('dialog');
}

beforeEach(() => {
  resetApiFamily();
  tabs.navigate.mockReset();
  vi.mocked(toast).mockReset();
  app.set({ ...READY, apps: [{ id: 'support' }, { id: 'chat' }] } as never);
  Element.prototype.scrollTo = vi.fn();
  serve();
});
afterEach(cleanup);

describe('the conversion sheet', () => {
  it('sends the visitor’s address when it was asked for, for a new ticket or one appended to', () => {
    const f = { ...initialForm(PREVIEW as never, 1), requesterEmail: ' malsha@lotus.example ' };
    expect(convertInput(77, f)).toMatchObject({ target: 'new', requester_email: 'malsha@lotus.example', subject: 'Acrobat Pro × 3 keys not received' });
    expect(convertInput(77, { ...f, target: 1248 })).toEqual({ conversation_id: 77, target: 1248, public_message_ids: [], notify_visitor: true, requester_email: 'malsha@lotus.example' });
    expect(convertInput(77, { ...f, requesterEmail: '' })).not.toHaveProperty('requester_email');
  });

  it('asks for an email address when the visitor gave none, before converting, and sends it', async () => {
    const dialog = await sheet();
    const email = (await within(dialog).findByLabelText('Visitor’s email address')) as HTMLInputElement;
    expect(email.required).toBe(true);
    expect(within(dialog).getByText('The visitor gave no email address. Ask for one so follow-ups can reach them.')).toBeTruthy();
    const raise = within(dialog).getByRole('button', { name: /Raise ticket/ }) as HTMLButtonElement;
    expect(raise.disabled).toBe(true);
    fireEvent.change(email, { target: { value: 'malsha@' } });
    expect(raise.disabled).toBe(true);
    // ⌘↵ cannot get round it: the field says why, and has the focus.
    fireEvent.keyDown(email, { key: 'Enter', ctrlKey: true });
    expect(await within(dialog).findByText('Ask the visitor for an email address so follow-ups can reach them.')).toBeTruthy();
    expect(posts()).toHaveLength(0);
    fireEvent.change(email, { target: { value: 'malsha@lotus.example' } });
    expect(raise.disabled).toBe(false);
    fireEvent.click(raise);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ conversation_id: 77, target: 'new', requester_email: 'malsha@lotus.example', subject: 'Acrobat Pro × 3 keys not received' });
    await waitFor(() => expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/1291'));
  });

  it('a server that still needs an address (422 requester_email_required) has the field focused with the reason', async () => {
    serve({
      'GET /api/support/v1/conversions/77': { ...PREVIEW, visitor: { ...PREVIEW.visitor, email: 'old@lotus.example' } },
      'POST /api/support/v1/conversions': new ApiError(422, 'The visitor has no email address', 'requester_email_required'),
    });
    const dialog = await sheet();
    expect(within(dialog).queryByLabelText('Visitor’s email address')).toBeNull();
    fireEvent.click(await within(dialog).findByRole('button', { name: /Raise ticket/ }));
    const email = (await within(dialog).findByLabelText('Visitor’s email address')) as HTMLInputElement;
    expect(within(dialog).getByText('Ask the visitor for an email address so follow-ups can reach them.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything());
    // Answered: sent again with it.
    serve({ 'GET /api/support/v1/conversions/77': { ...PREVIEW, visitor: { ...PREVIEW.visitor, email: 'old@lotus.example' } } });
    fireEvent.change(email, { target: { value: 'malsha@lotus.example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Raise ticket/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ requester_email: 'malsha@lotus.example' });
  });

  it('lists the chat’s files with the transcript, and says when one could not be copied', async () => {
    serve({ 'POST /api/support/v1/conversions': { ...ANSWER, files: 0, files_refused: 1 } });
    const dialog = await sheet();
    const file = await within(dialog).findByText('receipt.pdf');
    expect(file.closest('[data-convert-file]')).toBeTruthy();
    expect(within(dialog).getByText(/and the files shared in the chat/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Visitor’s email address'), { target: { value: 'malsha@lotus.example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Raise ticket/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', '1 file from the chat could not be copied to the ticket.'));
    expect(toast).toHaveBeenCalledWith('success', 'Raised as CFX-001291.');
  });
});

describe('the website chat', () => {
  const conversation = () => ({
    conversation: { id: 77, widget: 'Main', website: 'creativefx.lk', status: 'open', is_offline: false, inactive: false, assigned_to: 1, visitor_typing: false, started_at: new Date().toISOString(), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
    visitor: { id: 4471, label: 'Visitor 4F2A', name: 'Malsha Peiris', email: null, phone: null, company: null, browser: 'Chrome', os: 'Windows', device: 'desktop', language: null, timezone: null, country: 'LK', city: 'Colombo', landing_page: null, current_url: null, current_title: null, referrer: null, utm_source: null, utm_campaign: null, visits: 1, first_seen: null, last_seen: new Date().toISOString(), is_blocked: false },
    messages: [{ id: 1, body: 'We paid for 3 licences yesterday', from: 'visitor', agent: null, at: new Date().toISOString(), file: null }],
    journey: [],
    history: [],
    can: { view: true, reply: true, manage: false },
  });
  const mount = () => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/chat/widget-admin/conversations/77') return conversation();
      if (path === '/api/chat/widget-admin/canned') return { responses: [] };
      if (path === '/api/chat/widget-admin/agents') return { agents: [] };
      throw new Error(`unexpected ${path}`);
    }) as never);
    render(<QueryClientProvider client={client()}><WebsiteThread id="77" /></QueryClientProvider>);
    return screen.findByRole('complementary', { name: 'Visitor details' });
  };
  const metaRead = () => waitFor(() => expect(log.some((c) => c.path === '/api/support/v1/meta')).toBe(true));

  it('offers Convert to ticket, which opens the sheet here', async () => {
    const panel = await mount();
    fireEvent.click(await within(panel).findByRole('button', { name: 'Convert to ticket' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'View ticket' })).toBeNull();
  });

  it('a chat that is a ticket shows its reference chip and View ticket, never Convert again', async () => {
    serve({ 'GET /api/support/v1/conversions/77': { ...PREVIEW, ticket: { id: 1279, reference: 'CFX-001279', status: 'open' } } });
    const panel = await mount();
    const view = await within(panel).findByRole('button', { name: 'View ticket' });
    expect(within(panel).queryByRole('button', { name: 'Convert to ticket' })).toBeNull();
    expect(panel.querySelector('[data-ticket-chip]')?.textContent).toContain('CFX-001279');
    fireEvent.click(view);
    expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/1279');
    // The header links to it too, beside the chat's own actions.
    const chip = screen.getAllByRole('button', { name: 'Open ticket CFX-001279' }).find((b) => !panel.contains(b))!;
    expect(chip.textContent).toContain('Open');
    fireEvent.click(chip);
    expect(tabs.navigate).toHaveBeenCalledTimes(2);
  });

  it('has no Convert where the server switches chat conversion off or it is not mine; an older server keeps it', async () => {
    serve({ 'GET /api/support/v1/meta': { ...META, ...CAN, capabilities: { ...CAN.capabilities, convert_chat: false } } });
    let panel = await mount();
    await metaRead();
    await waitFor(() => expect(within(panel).queryByRole('button', { name: 'Convert to ticket' })).toBeNull());
    cleanup();
    resetApiFamily();
    serve({ 'GET /api/support/v1/meta': { ...META, ...CAN, can: { create: true, convert_chat: false } } });
    panel = await mount();
    await metaRead();
    await waitFor(() => expect(within(panel).queryByRole('button', { name: 'Convert to ticket' })).toBeNull());
    cleanup();
    resetApiFamily();
    serve({ 'GET /api/support/v1/meta': META });
    panel = await mount();
    await metaRead();
    expect(await within(panel).findByRole('button', { name: 'Convert to ticket' })).toBeTruthy();
    cleanup();
    // Without the Support app, neither.
    app.set((s) => ({ ...s, apps: [{ id: 'chat' }] as never }));
    const asked = log.length;
    panel = await mount();
    expect(within(panel).queryByRole('button', { name: 'Convert to ticket' })).toBeNull();
    expect(log.slice(asked).some((c) => c.path.startsWith('/api/support/'))).toBe(false);
  });
});
