// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Access from '../../../src/core/access';

/**
 * worksuite-desktop#236 in Chat's lists: Team Chat, WhatsApp and Website chats share Mail's pull to refresh, its
 * "Checked…" line, ⌘R/F5 and the "↑ 3 new conversations" pill, each checking its own list in its own words.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), request: vi.fn(async () => ({ data: {}, offline: false, cachedAt: null })) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/access', async (orig) => ({ ...(await orig<typeof Access>()), useCanOpen: (id: string) => id === 'chat', canOpenWeb: () => false }));
const tab = { route: '/chat', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: true, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiGetMeta } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { pullPrefs } from '../../../src/components/listRefresh';
import ChatPage from '../../../src/modules/chat/ChatPage';
import type { WaAccount } from '../../../src/modules/chat/channels/whatsapp';
import { WhatsappChannel } from '../../../src/modules/chat/channels/WhatsappChannel';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';
import type { Room } from '../../../src/modules/chat/types';

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const indicator = () => document.querySelector('[data-pull-indicator]') as HTMLElement;
const room = (o: Partial<Room>): Room => ({ id: 1, type: 'direct', name: 'Kasun', avatar_name: 'Kasun', last_message: null, unread: 0, updated_at: '2026-10-01 10:00:00', pinned: false, muted: false, mentions: 0, role: 'member', ...o });

beforeEach(() => {
  localStorage.clear();
  pullPrefs.set({ off: {} });
  tab.route = '/chat';
  tab.go.mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGetMeta).mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
});
afterEach(() => {
  cleanup();
  app.set({ auth: undefined } as never);
});

describe('Team Chat', () => {
  it('F5 on the list asks for the conversations again; one with a new message comes in lit, with "Checked just now"', async () => {
    let rooms = [room({ id: 1, name: 'Kasun' }), room({ id: 2, name: 'Nimal', updated_at: '2026-10-01 09:00:00' })];
    vi.mocked(apiGetMeta).mockImplementation(async () => ({ data: { rooms: rooms.map((r) => ({ ...r })) }, offline: false, cachedAt: null }) as never);
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/chat/presence' ? { presence: {} } : path === '/api/chat/presence/me' ? { status: 'online', choice: 'available' } : path === '/api/chat/calls/history' ? [] : {}) as never);
    wrap(<ChatPage tabId="t1" route="/chat" active />);
    await screen.findByText('Nimal');
    const calls = () => vi.mocked(apiGetMeta).mock.calls.filter(([p]) => p === '/api/chat/rooms').length;
    const before = calls();
    // Nimal writes: the conversation moves on.
    rooms = [room({ id: 2, name: 'Nimal', updated_at: '2026-10-01 11:00:00', last_message: { text: 'Hi', sender_id: 9, created_at: '2026-10-01 11:00:00', type: 'text' } }), room({ id: 1, name: 'Kasun' })];
    fireEvent.keyDown(document.querySelector('[data-room-row="1"]')!, { key: 'F5' });
    await waitFor(() => expect(indicator().textContent).toContain('1 new'));
    expect(calls()).toBe(before + 1);
    expect(document.querySelector('[data-fresh]')!.getAttribute('data-refresh-key')).toBe('2');
    expect(screen.getByRole('button', { name: 'Checked just now' })).toBeTruthy();
  });
});

describe('WhatsApp', () => {
  it('pull, F5 and "Checked…" ask for the chats again, with WhatsApp’s words', async () => {
    tab.route = '/chat?channel=whatsapp';
    const wa = { id: 7, account_id: 1, kind: 'direct', name: 'Nimal Perera', phone: '94770000007', status: 'open', unread: 0, is_pinned: 0, is_muted: 0, last_message: 'Hi', last_message_at: '2026-10-01 09:00:00', last_direction: 'in', awaiting_since: null, waiting_minutes: null, overdue: false, account_name: 'Sales', assigned_name: null };
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/whatsapp/chats' ? { chats: [wa] } : {}) as never);
    const account = { id: 1, name: 'Sales', provider: 'web_js', phone: '94771234567', status: 'connected', status_note: null, is_default: true, can_send: true, can_connect: true, unread: 0 } as WaAccount;
    wrap(<WhatsappChannel accounts={[account]} loading={false} error={null} retry={() => undefined} onConnect={null} />);
    await screen.findByText('Nimal Perera');
    const asks = () => vi.mocked(apiGet).mock.calls.filter(([p]) => p === '/api/whatsapp/chats').length;
    const before = asks();
    const scroller = document.querySelector('[data-refresh-key="7"]')!.parentElement!;
    fireEvent.wheel(scroller, { deltaY: -60 });
    expect(indicator().textContent).toContain('Pull to check for new messages');
    fireEvent.click(screen.getByRole('button', { name: /^Check(ed| now)/ }));
    await waitFor(() => expect(asks()).toBe(before + 1));
    await waitFor(() => expect(indicator().textContent).toContain('Up to date'));
  });
});

describe('Website chats', () => {
  it('the conversation list checks on F5, and its rows carry the shared marks', async () => {
    tab.route = '/chat?view=website';
    const row = { id: 12, widget_id: 1, label: 'Visitor 12', visitor_name: 'Amaya', email: null, site: 'shop', status: 'open', assigned_to: null, agent: null, online: true, current_url: null, awaiting_reply: true, at_risk: false, priority: 'normal', waiting_since: null, last_visitor_at: '2026-10-01 09:00:00', updated_at: '2026-10-01 09:00:00' };
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path === '/api/chat/widget-admin/conversations' ? { conversations: [row], can: { view: true, reply: true } } : path.endsWith('/agents') ? { agents: [] } : path.endsWith('/visitors') ? { visitors: [] } : path.endsWith('/missed/count') ? { count: 0 } : {}) as never);
    app.set({ auth: { stage: 'ready', user: { id: '7' } } } as never);
    vi.mocked(call).mockImplementation((async (ch: string) => (ch === 'ring:state' ? { chats: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false } : null)) as never);
    wrap(<WebsiteWorkspace />);
    await screen.findByText('Amaya');
    const asks = () => vi.mocked(apiGet).mock.calls.filter(([p]) => p === '/api/chat/widget-admin/conversations').length;
    const before = asks();
    const mark = document.querySelector('[data-refresh-key="12"]') as HTMLElement;
    expect(mark).toBeTruthy();
    fireEvent.keyDown(mark, { key: 'F5' });
    await waitFor(() => expect(asks()).toBeGreaterThan(before));
    await waitFor(() => expect(indicator().textContent).toContain('Up to date'));
    expect(screen.getByRole('button', { name: 'Checked just now' })).toBeTruthy();
  });
});
