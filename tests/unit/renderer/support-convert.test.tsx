// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { READY, serveWith, ticket, type Call } from './support-fixtures';

/**
 * Website chat → ticket, natively, D-06 (desktop T24, FR-DSK-08, FR-LCH-01…08): the sheet opens with the server's
 * prefill, offers the visitor's open ticket to append to, copies the transcript internal with chosen messages public,
 * raises once (Idempotency-Key), opens the ticket's tab here, and a chat already converted opens its ticket.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux' }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tabs = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<object>()), navigate: tabs.navigate }));

const { ApiError, request } = await import('../../../src/core/api');
const { toast } = await import('../../../src/core/toasts');
const { app } = await import('../../../src/core/app-state');
const { ConvertSheet, convertInput, initialForm } = await import('../../../src/modules/support/ConvertSheet');
const { resetApiFamily } = await import('../../../src/modules/support/api');

const PREVIEW = {
  conversation: { id: 77, status: 'open', website: 'creativefx.lk', widget: 'Main', offline: false, started_at: null },
  visitor: { id: 4471, name: 'Malsha Peiris', email: 'malsha@lotusinteriors.lk', phone: null, company: 'Lotus Interiors' },
  ticket: null,
  candidates: [ticket(1248, { subject: 'Acrobat Pro for 3 users' })],
  prefill: { subject: 'Acrobat Pro × 3 keys not received', organization_id: 10, priority: 'normal', source: 'chat' },
  details: 'Website chat #77 — visitor details',
  transcript: [
    { id: 1, from: 'visitor', name: 'Malsha Peiris', body: 'We paid for 3 licences yesterday', at: '2026-10-04T09:31:00+05:30', files: [] },
    { id: 2, from: 'agent', name: 'Ayesha Fernando', body: 'I will raise a ticket with licensing', at: '2026-10-04T09:35:00+05:30', files: [] },
  ],
};

let log: Call[];
const posts = () => log.filter((c) => c.method === 'POST' && c.path === '/api/support/v1/conversions');
function serve(over: Record<string, unknown> = {}) {
  log = serveWith(request, {
    'GET /api/support/v1/conversions/77': PREVIEW,
    'GET /api/support/v1/meta': { organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: {} }], departments: [{ id: 2, name: 'Sales', organization_id: 10 }], teams: [], categories: [{ id: 3, name: 'Licensing', organization_id: 10 }], tags: [], statuses: [], priorities: [], types: [], sources: [], views: [], sorts: [], can: {} },
    'GET /api/support/v1/agents': { agents: [{ id: 1, name: 'Ayesha Fernando', presence: 'available', open: 3, capacity: 15, teams: [] }, { id: 4, name: 'Nimal Perera', presence: 'away', open: 8, capacity: 15, teams: [] }] },
    'POST /api/support/v1/conversions': { ticket: ticket(1291, { reference: 'CFX-001291' }), appended: false, copied: 2, files: 0, files_refused: 0, notified: true },
    ...over,
  });
}
function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(<QueryClientProvider client={qc}><ConvertSheet conversationId={77} onClose={onClose} /></QueryClientProvider>);
  return { onClose };
}

beforeEach(() => {
  resetApiFamily();
  tabs.navigate.mockReset();
  vi.mocked(toast).mockReset();
  app.set(READY as never);
  serve();
});
afterEach(cleanup);

describe('the form', () => {
  it('starts from the preview: the open ticket offered, mine, at the proposed priority', () => {
    expect(initialForm(PREVIEW as never, 1)).toMatchObject({ target: 1248, subject: 'Acrobat Pro × 3 keys not received', organization: 10, priority: 'normal', assignee: 1, notify: true, publicIds: [] });
    expect(initialForm({ ...PREVIEW, candidates: [] } as never, 1).target).toBe('new');
  });

  it('sends a new ticket’s fields only for a new ticket', () => {
    const f = { ...initialForm(PREVIEW as never, 1), publicIds: [2] };
    expect(convertInput(77, f)).toEqual({ conversation_id: 77, target: 1248, public_message_ids: [2], notify_visitor: true });
    expect(convertInput(77, { ...f, target: 'new', category: 3 })).toMatchObject({ target: 'new', subject: 'Acrobat Pro × 3 keys not received', priority: 'normal', organization_id: 10, category_id: 3, assigned_to: 1 });
  });
});

describe('the sheet', () => {
  it('raises a new ticket with what was chosen, once, and opens its tab here', async () => {
    renderSheet();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Malsha Peiris · malsha@lotusinteriors.lk · Lotus Interiors')).toBeTruthy();
    // The visitor's open ticket is offered first; a new one is chosen instead.
    expect((within(dialog).getByRole('radio', { name: /Add to CFX-001248/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Create a new ticket' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'High' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make last reply public' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Tell the visitor the reference in the chat' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Raise ticket/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ conversation_id: 77, target: 'new', priority: 'high', public_message_ids: [2], notify_visitor: false, assigned_to: 1 });
    expect(posts()[0]!.headers?.['Idempotency-Key']).toMatch(/^chat:/);
    await waitFor(() => expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/1291'));
    expect(toast).toHaveBeenCalledWith('success', 'Raised as CFX-001291.');
  });

  it('appends to the visitor’s open ticket with Ctrl+Enter', async () => {
    serve({ 'POST /api/support/v1/conversions': { ticket: ticket(1248), appended: true, copied: 2, files: 0, files_refused: 0, notified: true } });
    renderSheet();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: /Add to ticket/ });
    fireEvent.keyDown(within(dialog).getByRole('radio', { name: 'Create a new ticket' }), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ conversation_id: 77, target: 1248, public_message_ids: [], notify_visitor: true });
    await waitFor(() => expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/1248'));
    expect(toast).toHaveBeenCalledWith('success', 'Added to CFX-001248.');
  });

  it('a chat already a ticket offers View ticket, which opens it', async () => {
    serve({ 'GET /api/support/v1/conversions/77': { ...PREVIEW, ticket: { id: 1279, reference: 'CFX-001279', status: 'new' }, candidates: [] } });
    renderSheet();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('CFX-001279')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'View ticket' }));
    expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/1279');
  });

  it('raised meanwhile by a colleague: opens theirs instead of failing', async () => {
    serve({ 'POST /api/support/v1/conversions': new ApiError(409, 'This chat is already ticket CFX-001279', 'ALREADY_CONVERTED', { ticket: { id: 1279, reference: 'CFX-001279', status: 'new' } }) });
    renderSheet();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /Add to ticket/ }));
    await waitFor(() => expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/1279'));
    expect(toast).toHaveBeenCalledWith('info', 'This chat is already CFX-001279.');
  });
});
