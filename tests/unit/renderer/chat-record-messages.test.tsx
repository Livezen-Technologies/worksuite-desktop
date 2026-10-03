// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: Error) => e.message,
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/access', () => ({ useCanOpen: () => true, useVisibleIds: () => new Set(['chat', 'tasks', 'drive', 'notes', 'meet']) }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ openLink: vi.fn() }), openWebLink: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: ({ reply }: { reply?: { sender_name: string } | null }) => reply ? <div>Replying to {reply.sender_name}</div> : null }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
import { apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { Thread } from '../../../src/modules/chat/Thread';
import { ModuleCard } from '../../../src/modules/chat/cards/ModuleCards';
import type { ChatMessage } from '../../../src/modules/chat/types';
const message = (id: number, kind = 'task', text: string | null = null, sender_id = 7) => ({
  id,
  room_id: 1,
  sender_id,
  sender_name: 'Asha',
  type: 'text',
  message: text,
  file: null,
  reactions: [],
  reply_preview: null,
  edited: false,
  deleted: false,
  receipt: { status: 'read' as const, read: 1, total: 1 },
  client_message_id: null,
  created_at: '2026-10-03 02:24:00',
  card: { kind, name: `Record ${id}`, available: true },
});
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  app.set({ auth: { user: { id: '7' }, server: { origin: 'https://example.test' } } as never });
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  app.set({ auth: null });
});
function show(messages: ChatMessage[], drawer = false) {
  vi.mocked(apiGet).mockImplementation(async (path) => (path === '/api/chat/messages' ? ({ messages } as never) : ({ messages: [] } as never)));
  return wrap(<Thread roomId="1" room={undefined} mini bare drawer={drawer} rooms={[]} />);
}

describe('record-card messages in both conversation surfaces', () => {
  it.each([false, true])('keeps card, caption and receipt outside a coloured bubble (drawer=%s)', async (drawer) => {
    const view = show([message(1, 'expense', 'Shared an expense')], drawer);
    await screen.findByText('Record 1');
    const cardMessage = view.container.querySelector('[data-record-message]')!;
    expect(cardMessage.querySelector('[data-record-caption]')?.textContent).toBe('Shared an expense');
    expect(cardMessage.querySelector('[data-record-text]')).toBeNull();
    for (let el: Element | null = cardMessage; el && !el.hasAttribute('data-bubble'); el = el.parentElement) {
      expect(el.className).not.toMatch(/bg-primary|bg-\[#DCE3FB\]|dark:bg-\[#26366E\]/);
    }
    expect(cardMessage.querySelector('[data-record-footer] [aria-label="Read by 1"]')).toBeTruthy();
    expect(cardMessage.querySelector('[data-record-content] [aria-label="Message actions"]')).toBeTruthy();
  });

  it.each([false, true])('groups consecutive cards and puts long text above the card (drawer=%s)', async (drawer) => {
    const long = 'Please review this record before our next planning meeting. '.repeat(4);
    const view = show([message(1), message(2, 'tender', long), message(3, 'invoice', null, 8)], drawer);
    await screen.findByText('Record 3');
    const cards = [...view.container.querySelectorAll('[data-record-message]')];
    expect(cards).toHaveLength(3);
    expect(cards[0]!.querySelector('[data-record-footer]')).toBeNull();
    expect(cards[1]!.querySelector('[data-record-footer]')).toBeTruthy();
    expect(cards[1]!.querySelector('[data-record-text]')?.textContent).toBe(long);
    expect(cards[1]!.firstElementChild?.hasAttribute('data-record-text')).toBe(true);
    expect(cards[1]!.closest('[data-bubble]')?.className).toContain('items-end');
    expect(cards[2]!.closest('[data-bubble]')?.className).toContain('items-start');
    expect(cards[1]!.closest('[data-bubble]')?.parentElement?.className).toContain('mt-1.5');
  });

  it.each([false, true])('preserves an uploaded file accompanying a record (drawer=%s)', async (drawer) => {
    const m = message(1);
    const file = { id: 9, kind: 'file', filename: 'Report.txt', mime: 'text/plain', size: 200, is_image: false, duration_ms: null, width: null, height: null, preview: 'file', status: 'ready', url: null, download_url: null, thumb_url: null, poster_url: null };
    const view = show([{ ...m, file }], drawer);
    await screen.findByText('Report.txt');
    expect(view.container.querySelector('[data-record-content]')?.textContent).toContain('Report.txt');
    expect(view.container.querySelector('[data-record-footer]')).toBeTruthy();
  });

  it('keeps reply, star and reaction actions working on a drawer card', async () => {
    const view = show([message(1)], true);
    await screen.findByText('Record 1');
    fireEvent.click(screen.getByRole('button', { name: 'Star message' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/chat/messages/1/star', { starred: true }));
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    fireEvent.click(screen.getByRole('button', { name: 'React 👍' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/messages/1/react', { emoji: '👍' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(view.container.querySelector('[data-record-message]')).toBeTruthy();
    expect(screen.getByText('Replying to Asha')).toBeTruthy();
  });
});

describe('completed task card labels', () => {
  it.each(['done', 'completed', 'open'])('uses neutral urgency labels only when %s is completed', async (status) => {
    vi.mocked(apiGet).mockResolvedValue({ title: 'Finished task', status, priority: 'high', due_date: '2026-08-24' });
    wrap(<ModuleCard r={{ kind: 'task', id: 1 }} />);
    const priority = await screen.findByText('High');
    const due = screen.getByText(/Due /);
    expect(priority.className.includes('text-[#B42318]')).toBe(status === 'open');
    expect(due.className.includes('text-[#9A4A06]')).toBe(status === 'open');
  });
});
