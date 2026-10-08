// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The conversation's details drawer, laid out as the web chat's: a header with Close, the person with their presence,
 * quick actions (Call, Video, Mute), and one row of tabs with counts.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: vi.fn(), openLink: vi.fn(), query: new URLSearchParams(), path: [], active: true }) }));
const startCall = vi.fn(async () => undefined);
vi.mock('../../../src/modules/calls/start', () => ({ startCall: (...a: unknown[]) => startCall(...(a as [])) }));

import { apiGet, apiPost } from '../../../src/core/api';
import { forgetPresence } from '../../../src/modules/chat/presence';
import { Details } from '../../../src/modules/chat/Details';
import type { Room } from '../../../src/modules/chat/types';

const sarah: Room = { id: 7, type: 'direct', name: 'Sarah Fernando', avatar_name: 'Sarah Fernando', other_user_id: 12, last_message: null, unread: 0, updated_at: '2026-10-01 10:00:00', pinned: false, muted: false, mentions: 0, role: 'member' };

afterEach(() => { cleanup(); forgetPresence(); vi.clearAllMocks(); });

describe('chat details drawer', () => {
  it('shows the person with presence, quick actions, and tabs with counts', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/chat/presence') return { presence: { 12: 'away', 3: 'online' } } as never;
      if (path === '/api/chat/rooms/7') return { members: [{ id: 3, name: 'Hasarinda Manjula', role: 'member' }, { id: 12, name: 'Sarah Fernando', role: 'member' }], can: {} } as never;
      return {} as never;
    });
    const onClose = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Details room={sarah} onClose={onClose} /></QueryClientProvider>);
    const aside = screen.getByRole('complementary', { name: 'Conversation details' });
    expect(within(aside).getByRole('heading', { name: 'Contact info' })).toBeTruthy();
    await waitFor(() => expect(within(aside).getByText('Away · Direct message')).toBeTruthy());
    await waitFor(() => expect(within(aside).getByRole('tab', { name: /Members\s*2/ })).toBeTruthy());

    fireEvent.click(within(aside).getByRole('button', { name: 'Video' }));
    expect(startCall).toHaveBeenCalledWith(7, 'video', 'Sarah Fernando');
    fireEvent.click(within(aside).getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/rooms/7/flags', { muted: true }));
    fireEvent.click(within(aside).getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalled();
  });
});
