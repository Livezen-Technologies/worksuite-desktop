// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/** WhatsApp Channels in the desktop app: the list, a channel's posts, and posting to one this number runs. */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({ ok: true })), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet, apiPost } from '../../../src/core/api';
import { WaChannels } from '../../../src/modules/chat/channels/WaChannels';
import type { WaAccount } from '../../../src/modules/chat/channels/whatsapp';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('WhatsApp channels', () => {
  it('lists channels, reads one and posts to it', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/whatsapp/channels') return { channels: [{ id: 3, account_id: 1, account_name: 'Sales', name: 'Offers', description: 'Weekly offers', invite: null, role: 'owner', can_post: true, subscribers: 120, unread: 0 }] } as never;
      if (path === '/api/whatsapp/channels/3/messages') return { messages: [{ id: 'p1', kind: 'text', body: 'Ten percent off', timestamp: 1700000000, has_media: false }], partial: false } as never;
      return {} as never;
    });
    const account = { id: 1, name: 'Sales', provider: 'web_js', status: 'connected' } as WaAccount;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WaChannels accounts={[account]} onClose={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByText('Offers'));
    expect(await screen.findByText('Ten percent off')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Post to the channel'), { target: { value: 'New stock in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/channels/3/messages', { text: 'New stock in' }));
  });
});
