// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { READY, msg, serveWith, show, ticket, type Call } from './support-fixtures';

/**
 * The quick-reply mini window, D-04 (desktop T22, FR-DSK-03): the ticket's context — reference, subject, requester,
 * priority, SLA, status and its last three messages with notes among them — and the desk's composer (Reply or Note,
 * canned responses, the status on send); ⌘O / Ctrl+O opens the full ticket with the draft, Esc closes and keeps it.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => undefined),
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const titles = vi.hoisted(() => [] as string[]);
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 'window-support-quick', route: '/support/quick/1284', active: true, path: ['support'], query: new URLSearchParams(), go: vi.fn(), navigate: vi.fn(), openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: (t: string) => titles.push(t),
}));

const { request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const { quickKey, QUICK_CONTEXT } = await import('../../../src/modules/support/QuickReply');
const { canonicalSupportRoute, parseSupportRoute, quickRoute } = await import('../../../shared/support');

const LONG = show(1284, {
  ticket: ticket(1284, { unread: 1, priority: 'urgent', sla: { state: 'at_risk', target: 'next_response', due_at: new Date(Date.now() + 18 * 60_000).toISOString(), policy_id: 1, paused_ms: 0 } }),
  messages: [msg(1, { body: 'First words' }), msg(2), msg(3, { from: 'staff', author: { id: 1, name: 'Ayesha Fernando' }, author_name: 'Ayesha Fernando', body: 'Could you send the three emails?' }), msg(4, { from: 'staff', internal: true, author: { id: 4, name: 'Nimal Perera' }, author_name: 'Nimal Perera', body: '@Ayesha 25 seats, 22 assigned' }), msg(5, { body: 'kumari@, dilan@ and roshan@' })],
  last_read_message_id: 4,
});

let log: Call[];
const calls = (method: string, path: string) => log.filter((c) => c.method === method && c.path === path);
const bridge = () => vi.mocked(call).mock.calls.map((c) => c[0]);

function renderQuick(route = '/support/quick/1284') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupportPage tabId="window-support-quick" route={route} active />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetApiFamily();
  titles.length = 0;
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation((async () => undefined) as never);
  log = serveWith(request, {
    'GET /api/support/v1/meta': { statuses: [], organizations: [] },
    'GET /api/support/v1/tickets/1284': LONG,
    'GET /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/presence': { present: [{ user_id: 4, name: 'Nimal Perera', state: 'viewing', mode: null, since: null }] },
    'POST /api/support/v1/tickets/1284/read': {},
    'POST /api/support/v1/tickets/1284/messages': { message: msg(9), duplicate: false, ticket: ticket(1284), status_refused: null },
    'GET /api/support/v1/tickets': { items: [ticket(1284)], next_cursor: null, has_more: false, sort: 'updated', view: 'all' },
  });
  app.set(READY as never);
});
afterEach(() => {
  cleanup();
});

describe('the route', () => {
  it('is the ticket’s quick-reply window in a window, and the ticket’s tab in the main window', () => {
    expect(quickRoute(1284)).toBe('/support/quick/1284');
    expect(parseSupportRoute('/support/quick/1284')).toEqual({ kind: 'quick', key: '1284' });
    expect(parseSupportRoute('/support/quick/CFX-001284')).toEqual({ kind: 'quick', key: 'CFX-001284' });
    expect(parseSupportRoute('/support/quick/nope').kind).toBe('inbox');
    expect(canonicalSupportRoute('/support/quick/1284')).toBe('/support/ticket/1284');
  });

  it('knows its two keys, and leaves Esc to a picker that took it', () => {
    const k = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false };
    expect(quickKey({ ...k, key: 'Escape' }, false)).toBe('close');
    expect(quickKey({ ...k, key: 'Escape', defaultPrevented: true }, false)).toBeNull();
    expect(quickKey({ ...k, key: 'o', ctrlKey: true }, false)).toBe('open');
    expect(quickKey({ ...k, key: 'o', metaKey: true }, true)).toBe('open');
    expect(quickKey({ ...k, key: 'o', ctrlKey: true }, true)).toBeNull();
    expect(quickKey({ ...k, key: 'o' }, false)).toBeNull();
  });
});

describe('the window', () => {
  it('shows the ticket’s context: header, live SLA, and the last three messages with the note and what is new', async () => {
    renderQuick();
    const article = await screen.findByRole('article', { name: 'Quick reply to CFX-001284' });
    expect(within(article).getByRole('heading', { name: 'Subject 1284' })).toBeTruthy();
    expect(within(article).getByText('Requester 1284 · Guest')).toBeTruthy();
    expect(within(article).getByText('Urgent')).toBeTruthy();
    expect(within(article).getByText(/^Next 1[78]m$/)).toBeTruthy();
    expect(within(article).getByText(`Last ${QUICK_CONTEXT} of 5 messages`)).toBeTruthy();
    const thread = within(article).getByRole('list', { name: 'Conversation' });
    expect(thread.querySelectorAll('[data-message]')).toHaveLength(3);
    expect(within(thread).queryByText('First words')).toBeNull();
    expect(thread.querySelector('[data-internal]')?.textContent).toContain('25 seats, 22 assigned');
    expect(within(thread).getByText('New since you last viewed')).toBeTruthy();
    // Shown here is read, and the window title says which ticket it is.
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/read')).toHaveLength(1), { timeout: 3000 });
    expect(titles).toContain('CFX-001284 · Quick reply');
    expect(await screen.findByText(/Nimal is viewing/)).toBeTruthy();
  });

  it('sends a reply with the status chosen, then closes', async () => {
    renderQuick();
    await screen.findByRole('article', { name: 'Quick reply to CFX-001284' });
    fireEvent.click(screen.getByRole('radio', { name: /Reply to requester/ }));
    editReply(screen.getByRole('textbox'), 'Please sign out and in again.');
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(1));
    expect(calls('POST', '/api/support/v1/tickets/1284/messages')[0]!.body).toMatchObject({ body: 'Please sign out and in again.', internal: false });
    await waitFor(() => expect(bridge()).toContain('windows:close'));
  });

  it('opens the full ticket in the main window with ⌘O / Ctrl+O, and closes with Esc', async () => {
    renderQuick();
    await screen.findByRole('article', { name: 'Quick reply to CFX-001284' });
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    await waitFor(() => expect(bridge()).toContain('windows:toMain'));
    fireEvent.click(screen.getByRole('button', { name: /Open full ticket/ }));
    expect(bridge().filter((c) => c === 'windows:toMain').length).toBeGreaterThanOrEqual(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(bridge()).toContain('windows:close'));
  });

  it('opens a ticket named by its reference', async () => {
    renderQuick('/support/quick/CFX-001284');
    expect(await screen.findByRole('article', { name: 'Quick reply to CFX-001284' })).toBeTruthy();
    expect(calls('GET', '/api/support/v1/tickets')[0]!.query).toMatchObject({ view: 'all', q: 'CFX-001284' });
  });

  it('is read-only for a merged ticket', async () => {
    serveWith(request, { 'GET /api/support/v1/tickets/1284': show(1284, { ticket: ticket(1284, { merged_into: { id: 1200, reference: 'CFX-001200' } }) }), 'GET /api/support/v1/tickets/1284/presence': { present: [] }, 'POST /api/support/v1/tickets/1284/presence': { present: [] }, 'POST /api/support/v1/tickets/1284/read': {} });
    renderQuick();
    expect(await screen.findByText('Merged into CFX-001200: it is read-only.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

function editReply(element: HTMLElement, value: string) {
  element.textContent = value;
  element.focus();
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  fireEvent.input(element);
}
