// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
// The conversation itself is Chat's; here only the drawer around it matters.
vi.mock('../../../src/modules/chat/Thread', () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock('../../../src/modules/chat/window', () => ({ openChatWindow: vi.fn(() => Promise.resolve()) }));

import { apiGetMeta } from '../../../src/core/api';
import { ui } from '../../../src/core/ui';
import { ChatDrawer, DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN, savedWidth } from '../../../src/modules/chat/ChatDrawer';
import { openChatWindow } from '../../../src/modules/chat/window';

const room = { id: 5, type: 'direct', name: 'Dimuthu Abeysinghe Wickramasinghe', other_user_id: 9, unread: 0, mentions: 0, pinned: false, archived: false, muted: false };

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChatDrawer />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/rooms') return { data: { rooms: [room] }, offline: false };
    return { data: {}, offline: false };
  }) as typeof apiGetMeta);
  ui.set({ dock: 'chat', chatRoom: '5' } as never);
});
afterEach(() => cleanup());

describe('the chat drawer (#211)', () => {
  it('has a visible left edge and a soft shadow, one container for header and messages', async () => {
    show();
    const drawer = screen.getByRole('complementary', { name: 'Chat drawer' });
    expect(drawer.className).toMatch(/\bborder-l\b/);
    expect(drawer.className).toMatch(/\bborder-line\b/);
    expect(drawer.className).toMatch(/shadow-\[-12px_0_32px_-16px/);
    expect(drawer.className).toMatch(/overflow-hidden/);
    expect(within(drawer).getByTestId('thread')).toBeTruthy();
  });

  it('keeps the name readable: Pop out and Minimise move into More, Close stays', async () => {
    show();
    const name = await screen.findByText(room.name);
    expect(name.getAttribute('title')).toBe(room.name);
    expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Minimise' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Minimise to the corner/ })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Open in new window/ }));
    expect(openChatWindow).toHaveBeenCalledWith('5', room.name);
  });

  it(`remembers a width between ${DRAWER_MIN} and ${DRAWER_MAX}px, ${DRAWER_DEFAULT}px otherwise`, () => {
    expect(savedWidth()).toBe(DRAWER_DEFAULT);
    localStorage.setItem('ws.chatDrawer.width', '500');
    expect(savedWidth()).toBe(500);
    localStorage.setItem('ws.chatDrawer.width', '900');
    expect(savedWidth()).toBe(DRAWER_DEFAULT);
    localStorage.setItem('ws.chatDrawer.width', '200');
    expect(savedWidth()).toBe(DRAWER_DEFAULT);
  });
});
