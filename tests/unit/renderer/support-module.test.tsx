// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn(), toasts: { get: () => ({ items: [] }), set: () => undefined, subscribe: () => () => undefined } }));

const nav = vi.hoisted(() => ({ navigate: vi.fn(), go: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: '/support', active: true, path: ['support'], query: new URLSearchParams(), go: nav.go, navigate: nav.navigate, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

const { ApiError, request } = await import('../../../src/core/api');
const { moduleFor } = await import('../../../src/modules/registry');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');

/**
 * The Support module's scaffold (desktop T18, FR-DSK-01/05): registered with its manifest, native rather than the
 * browser, and a ticket in a tab of its own that a deep link brings forward rather than opening twice.
 */
const ticket = (id: number, over: Record<string, unknown> = {}) => ({
  id, reference: `CFX-00${id}`, subject: `Subject ${id}`, status: 'open', status_category: 'open', priority: 'urgent', type: 'incident', source: 'email',
  organization: { id: 10, name: 'CreativeFX' }, requester: { name: 'Saman Kumara', email: 'saman@acme.lk', phone: null, kind: 'guest', user_id: null, contact_id: null, company_id: null },
  assignee: { id: 1, name: 'Ayesha Fernando' }, team: null, category: null, department: null, tags: [], sla: { state: 'at_risk', target: 'next_response', due_at: null, policy_id: null, paused_ms: 0 },
  due_at: null, confidential: false, unread: 2, conversation_id: null, version: 7, opened_at: null, first_response_at: null, last_customer_at: null, last_agent_at: null,
  resolved_at: null, closed_at: null, created_at: '2026-10-04T09:12:00+05:30', updated_at: '2026-10-04T09:42:00+05:30', deleted_at: null, ...over,
});

function serve(gets: Record<string, unknown>) {
  vi.mocked(request).mockImplementation((async (method: string, path: string) => {
    const hit = gets[`${method} ${path}`];
    if (hit instanceof Error) throw hit;
    if (hit === undefined) return new Promise(() => undefined);
    return { data: hit, offline: false, cachedAt: null, message: null };
  }) as never);
}

const renderPage = (route: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupportPage tabId="t1" route={route} active />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  resetApiFamily();
  nav.navigate.mockReset();
  nav.go.mockReset();
});
afterEach(() => cleanup());

describe('the Support module', () => {
  it('is registered with its manifest: read cache offline, notifications and file drop, ticket deep links', () => {
    const m = moduleFor('support');
    expect(m).toBeTruthy();
    expect(m!.manifest).toMatchObject({ name: 'Support', icon: 'life-buoy', offline: { mode: 'READ_CACHE' }, native: ['notifications', 'file-drop'] });
    expect(m!.manifest.offline.cache).toContain('/api/support/v1/tickets');
    expect(m!.manifest.deepLinks).toEqual(['support', 'support/ticket/:id']);
    expect(m!.manifest.quickActions.map((q) => q.route)).toEqual(['/support', '/support?view=mine', '/support?view=unassigned']);
  });

  it('shows the views with their counts and the view’s tickets; a ticket opens in its own tab', async () => {
    // The list is drawn only where it shows: give it a size.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 720, top: 0, left: 0, right: 600, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    serve({
      'GET /api/support/v1/views': { views: [{ key: 'mine', label: 'My tickets', count: 12 }, { key: 'unassigned', label: 'Unassigned', count: 7 }], saved: [], badges: null },
      'GET /api/support/v1/tickets': { items: [ticket(1284), ticket(1292, { priority: 'normal', unread: 0 })], next_cursor: null, has_more: false, sort: 'updated', view: 'mine' },
    });
    renderPage('/support');
    const rail = await screen.findByRole('navigation', { name: 'Support views' });
    await waitFor(() => expect(within(rail).getByRole('button', { name: /My tickets/ }).getAttribute('aria-current')).toBe('page'));
    expect(within(rail).getByText('7')).toBeTruthy();
    fireEvent.click(within(rail).getByRole('button', { name: /Unassigned/ }));
    expect(nav.go).toHaveBeenCalledWith('/support?view=unassigned');
    const row = await screen.findByText('Subject 1284');
    expect(screen.getByText('CFX-001284')).toBeTruthy();
    // Unread is bold; only Urgent and High carry a priority chip in the list.
    expect(row.className).toContain('font-bold');
    expect(screen.getAllByText('Urgent')).toHaveLength(1);
    expect(screen.getAllByText('Saman Kumara · Guest').length).toBe(2);
    // A click reads it in the pane (D-01); a double-click gives it a tab of its own (D-02).
    fireEvent.doubleClick(row);
    expect(nav.navigate).toHaveBeenCalledWith('/support/ticket/1284');
  });

  it('shows a ticket in its tab: the subject, the status, and notes marked internal', async () => {
    serve({
      'GET /api/support/v1/tickets/1284': {
        ticket: ticket(1284),
        messages: [
          { id: 1, body: 'Licences not activating', body_html: null, author: null, author_name: 'Saman Kumara', from: 'requester', internal: false, channel: 'email', created_at: '2026-10-04T09:12:00+05:30' },
          { id: 2, body: '@Ayesha 22 of 25 seats assigned', body_html: null, author: { id: 4, name: 'Nimal Perera' }, author_name: 'Nimal Perera', from: 'staff', internal: true, channel: 'agent', created_at: '2026-10-04T09:41:00+05:30' },
        ],
        has_earlier: false, attachments: [], events: [], last_read_message_id: 1, can: {}, transitions: [], remote_desk: null,
      },
    });
    renderPage('/support/ticket/1284');
    expect(await screen.findByRole('heading', { name: 'Subject 1284' })).toBeTruthy();
    // The status, in its chip and in the properties beside the conversation (T20).
    expect(screen.getAllByText('Open')).toHaveLength(2);
    const thread = screen.getByRole('list', { name: 'Conversation' });
    expect(within(thread).getByText('Internal')).toBeTruthy();
    expect(vi.mocked(request)).toHaveBeenCalledWith('GET', '/api/support/v1/tickets/1284', expect.objectContaining({ query: { peek: 1 } }));
  });

  it('finds a ticket a deep link names by its reference', async () => {
    serve({
      'GET /api/support/v1/tickets': { items: [ticket(1284)], next_cursor: null, has_more: false, sort: 'updated', view: 'all' },
      'GET /api/support/v1/tickets/1284': { ticket: ticket(1284), messages: [], has_earlier: false, attachments: [], events: [], last_read_message_id: 0, can: {}, transitions: [], remote_desk: null },
    });
    renderPage('/support/ticket/CFX-001284');
    expect(await screen.findByRole('heading', { name: 'Subject 1284' })).toBeTruthy();
  });

  it('says so when the ticket is not there, or not the person’s', async () => {
    serve({ 'GET /api/support/v1/tickets/9': new ApiError(404, 'Ticket not found', null), 'GET /api/support/v1/meta': { statuses: [] } });
    renderPage('/support/ticket/9');
    expect(await screen.findByText('Ticket not found')).toBeTruthy();
  });
});
