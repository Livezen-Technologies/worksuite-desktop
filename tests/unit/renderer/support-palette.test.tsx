// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import type * as CoreApi from '../../../src/core/api';
import { serveWith, ticket, type Call } from './support-fixtures';

/**
 * Support in the command palette, D-08 (desktop T26, FR-SRC-01/04, FR-WSP-06, FR-DSK-05): ⌘K finds tickets by
 * reference ("tkt 128"), subject or requester, with status and priority; ↵ opens the ticket's tab, ⌘↵ a window,
 * ⌘⇧C copies its deep link; the ticket in front's actions — honouring what it allows — are offered beside it and as
 * commands.
 */
Element.prototype.scrollIntoView ??= vi.fn();
const apiGet = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn(), apiGet: (...a: unknown[]) => apiGet(...a) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tabs = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<object>()), navigate: tabs.navigate }));

const { request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { allCommands, DEFAULT_SHORTCUTS } = await import('../../../src/core/commands');
const { SearchOverlay, SUPPORT_GROUP, isLinkChord } = await import('../../../src/app/overlays/SearchOverlay');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const { ticketCommands, ticketDeepLink, ticketSubtitle, useTicketCommands, ticketInFront } = await import('../../../src/modules/support/palette');

let log: Call[];
const writeText = vi.fn(async () => undefined);
beforeEach(() => {
  resetApiFamily();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockClear();
  tabs.navigate.mockReset();
  apiGet.mockReset();
  apiGet.mockResolvedValue({ results: [{ group: 'Tickets', key: 'tickets', items: [{ id: 1284, title: 'M365 (server copy)', subtitle: null, route: '/tickets?ticket=1284', at: null }] }], terms: [], index: null, companies: [] });
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue([] as never);
  log = serveWith(request, {
    'GET /api/support/v1/tickets': { items: [ticket(1284, { subject: 'Microsoft 365 licences not activating', priority: 'urgent', assignee: { id: 1, name: 'Ayesha Fernando' } }), ticket(1281, { subject: 'Shared mailbox not syncing', assignee: null })], next_cursor: null, has_more: false, sort: 'updated', view: 'all' },
  });
  app.set({ auth: { stage: 'ready', user: { id: '1' } } as never, bootstrap: null, apps: visibleApps({ apps: ['notes', 'chat'], permissions: ['support.view'] }), status: { network: 'ONLINE' } as never });
});
afterEach(cleanup);

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SearchOverlay mode="search" /></QueryClientProvider>);
}
const type = (q: string) => fireEvent.change(screen.getByLabelText('Search WorkSuite'), { target: { value: q } });

describe('the pieces', () => {
  it('says a ticket in a line, and its deep link', () => {
    expect(ticketSubtitle(ticket(1284, { priority: 'urgent' }) as never, 1)).toBe('Open · Urgent · Requester 1284 · assigned to you');
    expect(ticketSubtitle(ticket(1281, { assignee: null }) as never, 1)).toBe('Open · Requester 1281 · Unassigned');
    expect(ticketDeepLink(1284)).toBe('worksuite://support/ticket/1284');
    expect(DEFAULT_SHORTCUTS['support-copy-link']).toBe('Mod+Shift+C');
    expect(isLinkChord({ key: 'C', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false }, false)).toBe(true);
    expect(isLinkChord({ key: 'c', ctrlKey: true, shiftKey: false, metaKey: false, altKey: false }, false)).toBe(false);
  });

  it('offers only what the ticket allows', () => {
    const all = ticketCommands({ id: 1284, reference: 'CFX-001284', take: { label: 'Assign CFX-001284 to me', run: vi.fn() }, resolve: vi.fn(), canned: vi.fn() });
    expect(all.map((c) => c.id)).toEqual(['support-take', 'support-resolve', 'support-canned', 'support-quick', 'support-copy-link']);
    const few = ticketCommands({ id: 1284, reference: 'CFX-001284', take: null, resolve: null, canned: null });
    expect(few.map((c) => c.label)).toEqual(['Quick reply window for CFX-001284', 'Copy link to CFX-001284']);
  });

  it('registers the ticket’s actions while its tab is in front, and takes them away after', () => {
    const resolve = vi.fn();
    const { rerender, unmount } = renderHook(({ active }) => useTicketCommands(active, { id: 1284, reference: 'CFX-001284', take: null, resolve, canned: null }), { initialProps: { active: true } });
    expect(allCommands().some((c) => c.label === 'Resolve CFX-001284')).toBe(true);
    expect(ticketInFront()?.id).toBe(1284);
    allCommands().find((c) => c.id === 'support-resolve')!.run();
    expect(resolve).toHaveBeenCalled();
    rerender({ active: false });
    expect(allCommands().some((c) => c.id.startsWith('support-'))).toBe(false);
    expect(ticketInFront()).toBeNull();
    unmount();
  });
});

describe('⌘K', () => {
  it('finds tickets by reference with their status and priority, once each, and opens one in its tab', async () => {
    show();
    type('tkt 128');
    const list = await screen.findByRole('listbox', { name: 'Results' });
    const hit = await within(list).findByRole('option', { name: /CFX-001284 · Microsoft 365 licences not activating/ });
    expect(hit.textContent).toContain('Urgent');
    expect(hit.textContent).toContain('assigned to you');
    expect(log.find((c) => c.path === '/api/support/v1/tickets')!.query).toMatchObject({ view: 'all', q: 'tkt 128', limit: 6 });
    // The server's global search found it too: listed once, the desk's way.
    expect(within(list).queryByText('M365 (server copy)')).toBeNull();
    expect(screen.getByRole('tab', { name: new RegExp(SUPPORT_GROUP) })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('Search WorkSuite'), { key: 'Enter' });
    expect(tabs.navigate).toHaveBeenCalledWith('/support/ticket/1284');
  });

  it('⌘⇧C copies the selected ticket’s deep link; ⌘↵ opens it in a window', async () => {
    show();
    type('tkt 128');
    await screen.findByRole('option', { name: /CFX-001284/ });
    fireEvent.keyDown(screen.getByLabelText('Search WorkSuite'), { key: 'C', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('worksuite://support/ticket/1284'));
    fireEvent.keyDown(screen.getByLabelText('Search WorkSuite'), { key: 'Enter', ctrlKey: true });
    expect(vi.mocked(call)).toHaveBeenCalledWith('windows:open', { kind: 'record', route: '/support/ticket/1284', title: 'CFX-001284' });
  });

  it('lists the actions on the ticket in front beside its result', async () => {
    const { unmount } = renderHook(() => useTicketCommands(true, { id: 1284, reference: 'CFX-001284', take: { label: 'Reassign CFX-001284 to me (from Nimal Perera)', run: vi.fn() }, resolve: vi.fn(), canned: vi.fn() }));
    show();
    type('tkt 128');
    expect((await screen.findAllByText('Actions on CFX-001284')).length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: /Reassign CFX-001284 to me/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Insert canned response/ })).toBeTruthy();
    unmount();
  });

  it('finds knowledge articles for the ticket in front and puts one into its composer (D-10)', async () => {
    serveWith(request, {
      'GET /api/support/v1/tickets': { items: [], next_cursor: null, has_more: false, sort: 'updated', view: 'all' },
      'GET /api/support/v1/tickets/1284/kb': { articles: [{ id: 31, title: 'Fix 0xC004C003 after renewal', excerpt: 'Seats stay unassigned.', visibility: 'public', language: 'en', url: 'https://help/kb/31', score: 0.9 }] },
    });
    const insertArticle = vi.fn();
    const { unmount } = renderHook(() => useTicketCommands(true, { id: 1284, reference: 'CFX-001284', take: null, resolve: null, canned: null, insertArticle }));
    show();
    type('renewal');
    const hit = await screen.findByRole('option', { name: /Fix 0xC004C003 after renewal/ });
    expect(hit.textContent).toContain('Insert link into CFX-001284');
    fireEvent.click(hit);
    fireEvent.keyDown(screen.getByLabelText('Search WorkSuite'), { key: 'Enter' });
    expect(insertArticle).toHaveBeenCalledWith(expect.objectContaining({ id: 31 }), 'link');
    unmount();
  });

  it('asks the desk nothing for somebody without Support', async () => {
    app.set({ apps: visibleApps({ apps: ['notes'], permissions: [] }) } as never);
    show();
    type('tkt 128');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(log.some((c) => c.path === '/api/support/v1/tickets')).toBe(false);
  });
});
