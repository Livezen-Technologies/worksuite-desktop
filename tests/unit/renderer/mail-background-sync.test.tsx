// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Mail keeps syncing while the server's sync service is not running: the app asks for background steps while
 * status says `background.step`, and asks nothing once the service runs.
 */
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: (...a: unknown[]) => apiGet(...a), apiPost: (...a: unknown[]) => apiPost(...a) }));

const { MailBackgroundSync } = await import('../../../src/modules/mail/BackgroundSync');

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MailBackgroundSync /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.useRealTimers(); apiGet.mockReset(); apiPost.mockReset(); });

describe('mail background sync', () => {
  it('takes a step while the service is not running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiGet.mockResolvedValue({ enabled: true, mailboxes: [], background: { worker: false, step: true } });
    apiPost.mockResolvedValue({ ran: true, mailbox: 3, status: 'partial', more: true });
    mount();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/mail/sync/status'));
    await vi.advanceTimersByTimeAsync(2_100);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/sync/step', {}));
    // More to do: the next step comes sooner than half a minute.
    await vi.advanceTimersByTimeAsync(12_100);
    await waitFor(() => expect(apiPost.mock.calls.filter((c) => c[0] === '/api/mail/sync/step').length).toBeGreaterThanOrEqual(2));
  });

  it('asks nothing while the service runs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiGet.mockResolvedValue({ enabled: true, mailboxes: [], background: { worker: true, step: false } });
    mount();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(35_000);
    expect(apiPost).not.toHaveBeenCalled();
  });
});
