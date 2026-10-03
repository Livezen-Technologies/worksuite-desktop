// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Live typing, delivered and read in a website chat on the desktop (WS-WCHAT ENH-WCHAT-04, LIVE-02…08, LIVE-12):
 * ticks on the team's messages, "Read by" under the visitor's, receipts sent while the thread is in front, and typing
 * frames shown at once and gone at once.
 */
let listeners: Array<(e: unknown) => void> = [];
const frame = (e: unknown) => listeners.forEach((cb) => cb(e));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => []),
  on: (channel: string, cb: (e: unknown) => void) => {
    if (channel !== 'realtime:event') return () => undefined;
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((x) => x !== cb);
    };
  },
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div> }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/modules/chat/AttachmentViewer', () => ({ openChatAttachment: vi.fn() }));
const tab = { active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: tab.active, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { readBy, typingWords, visitorHas, type WebsiteConversation, type WebsiteMarks } from '../../../src/modules/chat/website/api';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
let marks: WebsiteMarks = {
  visitor: { delivered: 4, read: 3, delivered_at: ago(30_000), read_at: '2026-10-03 10:43:00' },
  staff: [{ user_id: 7, name: 'Nimal Silva', delivered: 5, read: 5, read_at: ago(10_000) }, { user_id: 3, name: 'Samali Perera', delivered: 5, read: 1, read_at: ago(60_000) }],
};
const conversation = (): WebsiteConversation => ({
  conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: 3, visitor_typing: false, started_at: ago(600_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: null,
  messages: [
    { id: 1, body: 'Is the licence yearly?', from: 'visitor', agent: null, at: ago(300_000), file: null },
    { id: 3, body: 'It is yearly.', from: 'agent', agent: 'Samali Perera', agent_id: 3, at: ago(200_000), file: null, visibility: 'public' },
    { id: 4, body: 'Renewals are 20% off.', from: 'agent', agent: 'Samali Perera', agent_id: 3, at: ago(100_000), file: null, visibility: 'public' },
    { id: 5, body: 'Great, thanks!', from: 'visitor', agent: null, at: ago(50_000), file: null },
  ],
  journey: [],
  history: [],
  marks,
  agents_typing: [],
  team: null,
  can: { view: true, reply: true, manage: false },
});

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  listeners = [];
  tab.active = true;
  marks = { ...marks };
  app.set({ auth: { stage: 'ready', user: { id: '3' } } as never });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations/41') return conversation();
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/widget-admin/agents') return { agents: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPost).mockClear();
});
afterEach(() => cleanup());

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WebsiteThread id="41" />
    </QueryClientProvider>,
  );

describe('delivered and read in the thread (LIVE-08)', () => {
  it('ticks each team message, says how far the visitor has the latest, and who read the visitor\'s', async () => {
    mount();
    await screen.findByText('It is yearly.');
    expect(screen.getByRole('img', { name: 'Read by the visitor' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Delivered to the visitor' })).toBeTruthy();
    expect(screen.getByText('Delivered')).toBeTruthy();
    expect(screen.getByText('Read by Nimal Silva')).toBeTruthy();
  });

  it('reports the visitor\'s messages delivered and read while the thread is in front', async () => {
    mount();
    await screen.findByText('It is yearly.');
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/receipts', { delivered: 5, read: 5 }));
  });

  it('a tab behind reports them delivered, not read', async () => {
    tab.active = false;
    mount();
    await screen.findByText('It is yearly.');
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/receipts', { delivered: 5 }));
  });
});

describe('typing, live (LIVE-02, LIVE-03, LIVE-04)', () => {
  it('shows the visitor typing the moment the frame arrives, and stops at once', async () => {
    mount();
    await screen.findByText('It is yearly.');
    act(() => frame({ type: 'chat.widget.typing', conversation_id: 41, who: 'visitor', state: 'start' }));
    expect(screen.getByText('Typing…')).toBeTruthy();
    act(() => frame({ type: 'chat.widget.typing', conversation_id: 41, who: 'visitor', state: 'stop' }));
    expect(screen.queryByText('Typing…')).toBeNull();
  });

  it('names colleagues typing, and one writing a note says so', async () => {
    mount();
    await screen.findByText('It is yearly.');
    act(() => frame({ type: 'chat.widget.typing', conversation_id: 41, who: 'agent', user_id: 7, name: 'Nimal Silva', state: 'start' }));
    act(() => frame({ type: 'chat.widget.typing', conversation_id: 41, who: 'agent', user_id: 9, name: 'Dilini', state: 'start', internal: true }));
    expect(screen.getByText('Nimal Silva and Dilini (a note) are typing…')).toBeTruthy();
    // My own typing is not news to me.
    act(() => frame({ type: 'chat.widget.typing', conversation_id: 41, who: 'agent', user_id: 3, name: 'Me', state: 'start' }));
    expect(screen.queryByText(/Me/)).toBeNull();
  });

  it('a read frame asks for the thread again', async () => {
    mount();
    await screen.findByText('It is yearly.');
    const before = vi.mocked(apiGet).mock.calls.filter(([p]) => p === '/api/chat/widget-admin/conversations/41').length;
    act(() => frame({ type: 'chat.widget.read', conversation_id: 41, by: 'visitor', message_id: 4 }));
    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.filter(([p]) => p === '/api/chat/widget-admin/conversations/41').length).toBeGreaterThan(before));
  });
});

describe('the helpers', () => {
  it('say where a message is, who read it, and who is typing', () => {
    expect([visitorHas(3, marks), visitorHas(4, marks), visitorHas(6, marks)]).toEqual(['read', 'delivered', 'sent']);
    expect(readBy(5, marks, 7)).toEqual(['you']);
    expect(readBy(1, marks, 3)).toEqual(['you', 'Nimal Silva']);
    expect(typingWords(['A', 'B', 'C', 'D'])).toBe('A, B and 2 more are typing…');
  });
});
