// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { READY, msg, serveWith, show, ticket, type Call } from './support-fixtures';

/**
 * The urgent ticket pop-up's card, D-07 (desktop T25, FR-DSK-03, FR-SLA-01/07, FR-ASN-02/03/05): the queue,
 * requester, subject and first lines, a live first-response countdown, Take it (↵), Assign… (A) with presence and
 * load, and Dismiss (Esc).
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux' }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playOnce: vi.fn(), ringVolume: () => 0.7 }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ setTitle: () => undefined }), useTabTitle: () => undefined }));

const { ApiError, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { playOnce } = await import('../../../src/modules/calls/tones');
const { app } = await import('../../../src/core/app-state');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const { ringCountdown } = await import('../../../src/modules/support/UrgentRing');
const { canonicalSupportRoute, parseSupportRoute, ringRoute } = await import('../../../shared/support');

const DUE = new Date(Date.now() + 12 * 60_000 + 30_000).toISOString();
const URGENT = show(1294, {
  ticket: ticket(1294, { priority: 'urgent', assignee: null, team: { id: 5, name: 'Licensing' }, created_at: new Date(Date.now() - 2 * 60_000).toISOString(), requester: { name: 'Fatima Al Mansoori', email: 'fatima@globaltraders.ae', phone: null, kind: 'customer', user_id: null, contact_id: null, company_id: null }, sla: { state: 'ok', target: 'first_response', due_at: DUE, policy_id: 1, paused_ms: 0 } }),
  messages: [msg(1, { body: 'Since this morning every designer is signed out of Creative Cloud' })],
  can: { view: true, reply: true, assign: true },
});

let log: Call[];
const bridge = () => vi.mocked(call).mock.calls.map((c) => c[0]);
function serve(over: Record<string, unknown> = {}) {
  log = serveWith(request, {
    'GET /api/support/v1/meta': { organizations: [] },
    'GET /api/support/v1/tickets/1294': URGENT,
    'GET /api/support/v1/agents': { agents: [{ id: 1, name: 'Ayesha Fernando', presence: 'available', open: 12, capacity: 15, teams: [] }, { id: 4, name: 'Nimal Perera', presence: 'away', open: 8, capacity: 15, teams: [] }] },
    'POST /api/support/v1/tickets/1294/take': { ticket: ticket(1294) },
    'POST /api/support/v1/tickets/1294/assign': { ticket: ticket(1294) },
    ...over,
  });
}
function renderRing() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SupportPage tabId="window-support-ring" route="/support/ring/1294" active /></QueryClientProvider>);
}

beforeEach(() => {
  resetApiFamily();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation((async () => undefined) as never);
  vi.mocked(toast).mockReset();
  app.set({ ...READY, prefs: { notificationSounds: true } } as never);
  serve();
});
afterEach(cleanup);

describe('the card', () => {
  it('is the ticket’s tab in the main window', () => {
    expect(ringRoute(1294)).toBe('/support/ring/1294');
    expect(parseSupportRoute('/support/ring/1294')).toEqual({ kind: 'ring', key: '1294' });
    expect(canonicalSupportRoute('/support/ring/1294')).toBe('/support/ticket/1294');
  });

  it('counts the first response down, and says when it was missed', () => {
    const now = Date.parse('2026-10-04T09:43:00Z');
    expect(ringCountdown({ sla: { state: 'ok', target: 'first_response', due_at: '2026-10-04T09:56:00Z', policy_id: 1, paused_ms: 0 } } as never, now)).toMatchObject({ label: 'First response', left: '13:00', overdue: false });
    expect(ringCountdown({ sla: { state: 'breached', target: 'first_response', due_at: '2026-10-04T09:40:00Z', policy_id: 1, paused_ms: 0 } } as never, now)).toMatchObject({ left: '3:00', overdue: true });
    expect(ringCountdown({ sla: { state: 'none', target: null, due_at: null, policy_id: null, paused_ms: 0 } } as never, now)).toBeNull();
  });

  it('shows the queue, requester, subject, first lines and the countdown, and chimes once', async () => {
    renderRing();
    const card = await screen.findByRole('article', { name: 'Urgent ticket CFX-001294' });
    expect(within(card).getByText('New urgent ticket in Licensing queue')).toBeTruthy();
    expect(within(card).getByText('Fatima Al Mansoori · Registered customer')).toBeTruthy();
    expect(within(card).getByText(/every designer is signed out/)).toBeTruthy();
    expect(within(card).getByRole('timer', { name: 'First response due' }).textContent).toMatch(/12:\d\d/);
    expect(await within(card).findByText(/1 online who can take it/)).toBeTruthy();
    expect(playOnce).toHaveBeenCalledTimes(1);
  });

  it('Take it (↵) makes it mine and opens its tab in the main window', async () => {
    renderRing();
    await screen.findByRole('article', { name: 'Urgent ticket CFX-001294' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(log.filter((c) => c.path === '/api/support/v1/tickets/1294/take')).toHaveLength(1));
    expect(log.find((c) => c.path === '/api/support/v1/tickets/1294/take')!.body).toEqual({ version: 7 });
    await waitFor(() => expect(bridge()).toContain('windows:toMain'));
  });

  it('taken meanwhile by somebody else: says so and closes', async () => {
    serve({ 'POST /api/support/v1/tickets/1294/take': new ApiError(409, 'Taken', 'ALREADY_ASSIGNED') });
    renderRing();
    fireEvent.click(await screen.findByRole('button', { name: /Take it/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'Somebody else has just taken CFX-001294.'));
    expect(bridge()).toContain('windows:close');
  });

  it('Assign… (A) lists who can take it with presence and load, and gives it to one', async () => {
    renderRing();
    await screen.findByRole('article', { name: 'Urgent ticket CFX-001294' });
    fireEvent.keyDown(window, { key: 'a' });
    const list = await screen.findByRole('list', { name: 'Assign to' });
    const nimal = await within(list).findByRole('button', { name: /Nimal Perera/ });
    expect(nimal.textContent).toContain('Away');
    expect(nimal.textContent).toContain('8 / 15');
    fireEvent.click(nimal);
    await waitFor(() => expect(log.find((c) => c.path === '/api/support/v1/tickets/1294/assign')?.body).toEqual({ user_id: 4, version: 7 }));
    await waitFor(() => expect(bridge()).toContain('windows:close'));
  });

  it('Dismiss (Esc) closes the card and leaves the ticket as it is', async () => {
    renderRing();
    await screen.findByRole('article', { name: 'Urgent ticket CFX-001294' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(bridge()).toContain('windows:close');
    expect(log.some((c) => c.method === 'POST')).toBe(false);
  });
});
