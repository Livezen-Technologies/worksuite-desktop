// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as CoreItemLinks from '../../../src/core/item-links';

/**
 * Shared WorkSuite pages and records in Chat (worksuite-desktop#266): sharing sends a full item link, the chat draws a
 * page as a card (title, a line about it, Open) with "You don't have access to this page · Request access" for a reader
 * without its app, and a message's actions sit in its top-right corner on hover instead of a round ⌄ beside it.
 */
const visible = vi.hoisted(() => ({ ids: new Set(['chat', 'hr', 'tasks']) }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/access', () => ({ useVisibleIds: () => visible.ids, useCanOpen: () => true, canOpen: () => true }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ openLink: vi.fn() }), openWebLink: vi.fn(), TabProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../../../src/core/item-links', async (orig) => ({ ...(await orig<typeof CoreItemLinks>()), openItemLink: vi.fn() }));
// The drawer's conversation is Chat's; here only the chip it is handed matters.
vi.mock('../../../src/modules/chat/Thread', () => ({ Thread: ({ boxChip }: { boxChip?: ReactNode }) => <div data-testid="thread">{boxChip}</div> }));
vi.mock('../../../src/modules/chat/window', () => ({ openChatWindow: vi.fn(() => Promise.resolve()) }));

import { apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { openItemLink } from '../../../src/core/item-links';
import { tabsStore } from '../../../src/core/tabs';
import { ui } from '../../../src/core/ui';
import { RecordCards } from '../../../src/modules/chat/cards/RecordCards';
import { ChatDrawer } from '../../../src/modules/chat/ChatDrawer';
import { TEAM_CAPS } from '../../../src/modules/chat/kit/caps';
import { MessageList } from '../../../src/modules/chat/kit/MessageList';
import { fromChatMessage } from '../../../src/modules/chat/kit/model';
import type { ChatMessage } from '../../../src/modules/chat/types';

const origin = 'https://app.worksuite.lk';
const shared = 'HR · Announcements\nhttps://app.worksuite.lk/o/7/hr/announcements';
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const from = { roomId: 1, messageId: 44, sender: 'Samali', own: false };

beforeEach(() => {
  vi.clearAllMocks();
  visible.ids = new Set(['chat', 'hr', 'tasks']);
  app.set({ auth: { user: { id: '3' }, server: { origin } }, organizationId: '7', bootstrap: { organizations: [{ id: '7', name: 'Acme' }, { id: '8', name: 'Beta Ltd' }] } } as never);
  vi.mocked(apiGet).mockImplementation((async (path: string) =>
    path === '/api/hr/announcements/mine' ? { items: [{ id: 1, read: true }, { id: 2, read: false }, { id: 3, read: true }] } : {}) as typeof apiGet);
});
afterEach(() => {
  cleanup();
  app.set({ auth: null, bootstrap: null, organizationId: null } as never);
});

describe('sharing a page or record from the chat drawer', () => {
  const open = (route: string, title: string) => {
    tabsStore.set({ ...tabsStore.get(), tabs: [{ id: 't1', route, title, app: route.slice(1).split(/[/?]/)[0], pinned: false, organizationId: '7' }], activeId: 't1' } as never);
    ui.set({ dock: 'chat', chatRoom: '5' } as never);
    vi.mocked(apiGetMeta).mockResolvedValue({ data: { rooms: [{ id: 5, type: 'direct', name: 'Samali', unread: 0, mentions: 0 }] }, offline: false } as never);
    return wrap(<ChatDrawer />);
  };

  it('sends the tab title and a full item link with its organisation, type and id — not a relative path', async () => {
    open('/hr?tab=announcements', 'HR · Announcements');
    fireEvent.click(await screen.findByRole('button', { name: /Attach page/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/messages', expect.objectContaining({ room_id: 5, message: 'HR · Announcements\nhttps://app.worksuite.lk/o/7/hr/announcements' })));
  });

  it('sends a record the same way', async () => {
    open('/tasks?task=12', 'Send revised proposal');
    fireEvent.click(await screen.findByRole('button', { name: /Attach record/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/messages', expect.objectContaining({ message: 'Send revised proposal\nhttps://app.worksuite.lk/o/7/task/12' })));
  });
});

describe('a shared page as a card', () => {
  it('shows the app, the title once, what the reader may see of it, and Open in a new tab', async () => {
    const view = wrap(<RecordCards text={shared} from={from} />);
    const card = view.container.querySelector('[data-card="page"]') as HTMLElement;
    expect(within(card).getByText('HR')).toBeTruthy();
    expect(within(card).getAllByText('HR · Announcements')).toHaveLength(1);
    await waitFor(() => expect(card.querySelector('[data-page-summary]')?.textContent).toBe('3 announcements · 1 unread'));
    fireEvent.click(within(card).getByRole('button', { name: 'Open' }));
    expect(openItemLink).toHaveBeenCalledWith(expect.objectContaining({ org: '7', type: 'hr', id: 'announcements' }), { source: 'chat', place: 'new-tab' });
  });

  it('draws an older message’s relative path as the same card, opening in the organisation open now', async () => {
    const view = wrap(<RecordCards text={'HR · Announcements\n/hr?tab=announcements'} from={from} />);
    const card = view.container.querySelector('[data-card="page"]') as HTMLElement;
    expect(within(card).getByText('HR · Announcements')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Open' }));
    expect(openItemLink).toHaveBeenCalledWith(expect.objectContaining({ org: '7', type: 'hr', id: 'announcements' }), { source: 'chat', place: 'new-tab' });
  });

  it('names another organisation’s page, and reads nothing of it here', () => {
    const view = wrap(<RecordCards text="https://app.worksuite.lk/o/8/hr/announcements" from={from} />);
    const card = view.container.querySelector('[data-card="page"]') as HTMLElement;
    expect(within(card).getByText('Beta Ltd')).toBeTruthy();
    expect(card.querySelector('[data-page-summary]')?.textContent).toBe('A page in HR');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('tells a reader without the app they have no access, and asks the sender for it as a reply', async () => {
    visible.ids = new Set(['chat']);
    const view = wrap(<RecordCards text={shared} from={from} />);
    expect(screen.getByText('You don’t have access to this page')).toBeTruthy();
    expect(apiGet).not.toHaveBeenCalled();
    fireEvent.click(within(view.container.querySelector('[data-card="page"]') as HTMLElement).getByRole('button', { name: 'Request access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/chat/messages', expect.objectContaining({ room_id: 1, reply_to: 44, message: 'I don’t have access to HR · Announcements. Could you give me access, or ask an administrator to?' })),
    );
  });

  it('offers no Request access on a page I shared myself', () => {
    visible.ids = new Set(['chat']);
    wrap(<RecordCards text={shared} from={{ ...from, own: true }} />);
    expect(screen.getByText('You don’t have access to this page')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull();
  });
});

describe('a message’s actions in a conversation tab', () => {
  const chat = (o: Partial<ChatMessage> & { id: number }): ChatMessage => ({
    room_id: 1, sender_id: 7, sender_name: 'Samali', type: 'text', message: 'Hi', file: null, reactions: [], reply_preview: null, edited: false, deleted: false, receipt: null, client_message_id: null, created_at: '2026-10-05 10:00:00', ...o,
  });
  const list = (m: ChatMessage, onReact = vi.fn()) => wrap(<MessageList items={[fromChatMessage(m, '3')]} caps={TEAM_CAPS} look="page" handlers={{ onReply: vi.fn(), onReact, onStar: vi.fn() }} />);

  it('sit in the top-right corner of the message, on hover — react, reply, star and more — with no round ⌄ beside it', () => {
    const onReact = vi.fn();
    const view = list(chat({ id: 1, can: { reply: true, react: true } }), onReact);
    // Inside the message's own column (not beside it), at its top edge.
    const corner = view.container.querySelector('[data-bubble] [data-message-toolbar]') as HTMLElement;
    expect(corner.className).toMatch(/\babsolute\b/);
    expect(corner.className).toMatch(/-top-\[15px\]/);
    // Someone else's short message: the bar keeps to its corner but never runs off the left edge.
    expect(corner.className).toMatch(/\bjustify-end-safe\b/);
    const bar = within(corner).getByRole('toolbar', { name: 'Message actions' });
    expect(bar.className).toMatch(/invisible group-hover:visible/);
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['React', 'Reply', 'Star message', 'More actions']);
    expect(view.container.querySelector('button[aria-label="Message actions"]')).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: 'React' }));
    fireEvent.click(screen.getByRole('button', { name: 'React 🎉' }));
    expect(onReact).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), '🎉');
  });

  it('my own message keeps the bar at its right edge too', () => {
    const view = list(chat({ id: 2, sender_id: 3, can: { reply: true, react: true } }));
    const corner = view.container.querySelector('[data-message-toolbar]') as HTMLElement;
    expect(corner.className).toMatch(/\bjustify-end\b/);
    expect(corner.className).not.toMatch(/justify-end-safe/);
  });
});
