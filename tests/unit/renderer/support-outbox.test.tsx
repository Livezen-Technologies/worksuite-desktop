// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { READY, serveWith, ticket, type Call } from './support-fixtures';

/**
 * Offline mode on the desk, D-09 (desktop T27, FR-DSK-07, FR-TKT-10): offline writes go to the queue — a message with
 * its client_id (a replay is stored once), a property change with its version — and the outbox shows them in order,
 * edits a waiting message, discards, and reviews a conflict field by field (keep the server's, or mine on top, tags
 * merged without asking).
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux' }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { ApiError, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { app } = await import('../../../src/core/app-state');
const api = await import('../../../src/modules/support/api');
const { OutboxBar, outboxWords } = await import('../../../src/modules/support/Outbox');
const { changesOf, mergeTags, outboxItem, outboxItems, theirsOf } = await import('../../../src/modules/support/queued');

const OFFLINE = new ApiError(0, 'Cannot reach WorkSuite server.', 'NETWORK_UNREACHABLE');
const mutation = (id: string, over: Record<string, unknown> = {}) => ({ id, idempotencyKey: `k${id}`, module: 'support', entity: 'ticket', entityId: '1284', label: 'Reply to requester · CFX-001284', method: 'POST', path: '/api/support/v1/tickets/1284/messages', state: 'PENDING', attempts: 0, error: null, createdAt: '2026-10-04T09:47:00+05:30', ...over });
const THEIRS = ticket(1276, { reference: 'CFX-001276', priority: 'high', version: 15, tags: ['oem'] });

let log: Call[];
let pending: unknown[];
let details: Record<string, unknown>;
function bridge() {
  vi.mocked(call).mockImplementation((async (channel: string, input: { id?: string }) => {
    if (channel === 'offline:pending') return pending;
    if (channel === 'offline:detail') return details[input.id!] ?? null;
    if (channel === 'offline:submit') return { delivered: false, queued: true, id: 'q1', status: null, data: null, error: null, code: null };
    return undefined;
  }) as never);
}
const sent = (channel: string) => vi.mocked(call).mock.calls.filter((c) => c[0] === channel).map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  api.resetApiFamily();
  vi.mocked(call).mockReset();
  vi.mocked(toast).mockReset();
  pending = [];
  details = {};
  bridge();
  app.set(READY as never);
  log = serveWith(request, { 'GET /api/support/v1/meta': { statuses: [], organizations: [], teams: [], categories: [], departments: [], tags: [] } });
});
afterEach(cleanup);

describe('writes while offline', () => {
  it('queue a message with its client_id, and answer the screen meanwhile', async () => {
    serveWith(request, { 'POST /api/support/v1/tickets/1284/messages': OFFLINE });
    const r = await api.addMessage(1284, { body: 'Hi Saman', internal: false, client_id: 'desk:abc', status: 'pending_customer' });
    expect(r.queued).toBe(true);
    expect(sent('offline:submit')[0]).toEqual({ module: 'support', entity: 'ticket', entityId: '1284', label: 'Reply to requester · #1284', method: 'POST', path: '/api/support/v1/tickets/1284/messages', body: { body: 'Hi Saman', internal: false, client_id: 'desk:abc', status: 'pending_customer' }, queueIfOffline: true });
    expect(toast).toHaveBeenCalledWith('info', 'You are offline: Reply to requester · #1284 is in the outbox and goes when WorkSuite is back.');
  });

  it('queue a property change and a status move with the version they were made at', async () => {
    serveWith(request, { 'PATCH /api/support/v1/tickets/1276': OFFLINE, 'POST /api/support/v1/tickets/1276/transition': OFFLINE, 'GET /api/support/v1/tickets/1276': { ticket: THEIRS, messages: [], attachments: [], events: [], can: {}, transitions: [] } });
    await api.getTicket(1276);
    expect(await api.updateTicket(1276, 14, { priority: 'urgent' })).toBeNull();
    expect(await api.transition(1276, { status: 'resolved', version: 14 })).toBeNull();
    expect(sent('offline:submit').map((s) => [s.label, s.method, s.body])).toEqual([
      ['Property change · CFX-001276', 'PATCH', { priority: 'urgent', version: 14 }],
      ['Status change · CFX-001276', 'POST', { status: 'resolved', version: 14 }],
    ]);
  });

  it('leave a refusal that is not about the connection as it is', async () => {
    serveWith(request, { 'POST /api/support/v1/tickets/1284/messages': new ApiError(403, 'No', 'FORBIDDEN') });
    await expect(api.addMessage(1284, { body: 'x', internal: true })).rejects.toMatchObject({ status: 403 });
    expect(sent('offline:submit')).toEqual([]);
  });
});

describe('reading the queue', () => {
  it('knows each change and the ticket it is on', () => {
    expect(outboxItem(mutation('1') as never)).toMatchObject({ kind: 'reply', ticketId: 1284, reference: 'CFX-001284' });
    expect(outboxItem(mutation('2', { label: 'Internal note · CFX-001283' }) as never).kind).toBe('note');
    expect(outboxItem(mutation('3', { path: '/api/support/v1/tickets/1279/transition', entityId: '1279', label: 'Status change · CFX-001279' }) as never)).toMatchObject({ kind: 'status', ticketId: 1279 });
    expect(outboxItem(mutation('4', { method: 'PATCH', path: '/api/support/v1/tickets/1276', label: 'Property change · #1276' }) as never)).toMatchObject({ kind: 'fields', reference: '#1276' });
    expect(outboxItems([mutation('1'), { ...mutation('5'), module: 'mail' }] as never)).toHaveLength(1);
    expect(changesOf('fields', { priority: 'urgent', tags: ['a'], version: 14 })).toEqual([{ kind: 'field', field: 'priority', to: 'urgent' }, { kind: 'field', field: 'tags', to: ['a'] }]);
    expect(changesOf('status', { status: 'resolved', version: 3 })).toEqual([{ kind: 'status', to: 'resolved' }]);
    expect(theirsOf({ status: 'error', code: 'VERSION_CONFLICT', errors: { ticket: THEIRS } })?.version).toBe(15);
    expect(theirsOf({ status: 'error' })).toBeNull();
    expect(mergeTags(['oem', 'x'], ['x', 'reissue'])).toEqual({ tags: ['oem', 'x', 'reissue'], added: ['reissue'] });
    expect(outboxWords(outboxItems([mutation('1'), mutation('2', { state: 'CONFLICT' }), mutation('3', { state: 'SYNCING' })] as never))).toBe('2 queued · 1 conflict');
  });
});

function renderBar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><OutboxBar /></QueryClientProvider>);
}

describe('the outbox', () => {
  it('says the desk is offline, and Retry now sends the queue', async () => {
    app.set({ ...READY, status: { ...READY.status, network: 'OFFLINE' } } as never);
    renderBar();
    expect(await screen.findByText(/Offline — showing the tickets kept on this computer/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    await waitFor(() => expect(sent('offline:replay')).toHaveLength(1));
  });

  it('shows nothing online with nothing queued', async () => {
    renderBar();
    await waitFor(() => expect(sent('offline:pending' as never)).toBeDefined());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lists what is queued in order; a waiting message is edited or discarded', async () => {
    pending = [mutation('1'), mutation('2', { label: 'Internal note · CFX-001283', path: '/api/support/v1/tickets/1283/messages', entityId: '1283' })];
    details = { '1': { body: { body: 'Hi Saman, 3 seats were not re-assigned.', internal: false, client_id: 'desk:1', status: 'pending_customer' }, response: null }, '2': { body: { body: '@Kasun seat moved', internal: true, client_id: 'desk:2' }, response: null } };
    renderBar();
    fireEvent.click(await screen.findByRole('button', { name: /Outbox · 2 queued/ }));
    const list = await screen.findByRole('list', { name: 'Queued changes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('Reply to requester');
    expect(rows[0]!.textContent).toContain('Waiting for connection');
    expect(await within(rows[0]!).findByText('Hi Saman, 3 seats were not re-assigned.')).toBeTruthy();
    expect(within(rows[0]!).getByText(/Then: Pending customer/)).toBeTruthy();
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(rows[0]!).getByRole('textbox', { name: 'Edit the queued message' }), { target: { value: 'Hi Saman, all three seats are fixed.' } });
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('offline:edit')[0]).toEqual({ id: '1', body: { body: 'Hi Saman, all three seats are fixed.', internal: false, client_id: 'desk:1', status: 'pending_customer' } }));
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(sent('offline:discard')[0]).toEqual({ id: '2' }));
  });

  it('reviews a conflict: mine against the server’s, keep mine on top with the server’s version', async () => {
    pending = [mutation('7', { state: 'CONFLICT', method: 'PATCH', path: '/api/support/v1/tickets/1276', entityId: '1276', label: 'Property change · CFX-001276', error: 'Changed' })];
    details = { '7': { body: { priority: 'urgent', version: 14 }, response: { status: 'error', code: 'VERSION_CONFLICT', errors: { ticket: THEIRS } } } };
    log = serveWith(request, { 'GET /api/support/v1/meta': { organizations: [] }, 'PATCH /api/support/v1/tickets/1276': { ticket: { ...THEIRS, priority: 'urgent', version: 16 } } });
    renderBar();
    fireEvent.click(await screen.findByRole('button', { name: /Outbox · 1 conflict/ }));
    const row = (await screen.findByRole('list', { name: 'Queued changes' })).querySelector('li')!;
    expect(await within(row).findByText(/version 14 → 15/)).toBeTruthy();
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['Priority', 'Urgent', 'High']);
    fireEvent.click(within(row).getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(log.find((c) => c.method === 'PATCH')?.body).toEqual({ priority: 'urgent', version: 15 }));
    await waitFor(() => expect(sent('offline:discard')).toEqual([{ id: '7' }]));
    expect(sent('offline:replay').length).toBeGreaterThan(0);
  });

  it('Keep server drops mine', async () => {
    pending = [mutation('8', { state: 'CONFLICT', path: '/api/support/v1/tickets/1276/transition', entityId: '1276', label: 'Status change · CFX-001276' })];
    details = { '8': { body: { status: 'resolved', version: 14 }, response: { errors: { ticket: THEIRS } } } };
    renderBar();
    fireEvent.click(await screen.findByRole('button', { name: /Outbox/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep server' }));
    await waitFor(() => expect(sent('offline:discard')).toEqual([{ id: '8' }]));
    expect(log.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('merges tags added on both sides without asking', async () => {
    pending = [mutation('9', { state: 'CONFLICT', method: 'PATCH', path: '/api/support/v1/tickets/1276', entityId: '1276', label: 'Property change · CFX-001276' })];
    details = { '9': { body: { tags: ['reissue'], version: 14 }, response: { errors: { ticket: THEIRS } } } };
    log = serveWith(request, { 'GET /api/support/v1/meta': { organizations: [] }, 'PATCH /api/support/v1/tickets/1276': { ticket: { ...THEIRS, tags: ['oem', 'reissue'], version: 16 } } });
    renderBar();
    fireEvent.click(await screen.findByRole('button', { name: /Outbox/ }));
    await waitFor(() => expect(log.find((c) => c.method === 'PATCH')?.body).toEqual({ tags: ['oem', 'reissue'], version: 15 }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('info', 'Tags merged automatically: +reissue'));
    expect(sent('offline:discard')).toEqual([{ id: '9' }]);
  });

  it('a change the server refused says why, and can be tried again', async () => {
    pending = [mutation('10', { state: 'FAILED', error: 'Open it first', path: '/api/support/v1/tickets/1279/transition', label: 'Status change · CFX-001279' })];
    details = { '10': { body: { status: 'closed' }, response: null } };
    renderBar();
    fireEvent.click(await screen.findByRole('button', { name: /Outbox · 1 not sent/ }));
    expect(await screen.findByText('Open it first')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(sent('offline:retry')).toEqual([{ id: '10' }]));
  });
});


