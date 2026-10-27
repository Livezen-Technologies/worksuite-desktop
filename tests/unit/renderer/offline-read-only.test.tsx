// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Read-only offline (audit D-G14): a write to Finance, Expenses, Marketing, Cheque Manager or Recruitment is refused
 * before it is sent while offline, and the module's banner says what is shown and as of when.
 */
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String((e as Error)?.message ?? e), isMac: false, platform: 'linux' }));

const { app } = await import('../../../src/core/app-state');
const { apiPost, apiGet, ApiError } = await import('../../../src/core/api');
const { offlineWriteRefusal, noteServedFromCopy } = await import('../../../src/core/offline-read');
const { OfflineReadOnlyBanner } = await import('../../../src/components/OfflineReadOnly');

const setNetwork = (network: 'ONLINE' | 'OFFLINE') => app.set({ status: { ...(app.get().status ?? {}), network } as never, session: { ...app.get().session, mode: 'enterprise' } as never });

describe('read-only offline (D-G14)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    setNetwork('ONLINE');
    vi.unstubAllGlobals();
  });

  it('refuses a write offline before sending it, and only for those modules', async () => {
    setNetwork('OFFLINE');
    expect(offlineWriteRefusal('POST', '/api/finance/journals')).toMatch(/Finance is read-only/);
    expect(offlineWriteRefusal('GET', '/api/finance/journals')).toBeNull();
    expect(offlineWriteRefusal('POST', '/api/tasks')).toBeNull();
    const e = await apiPost('/api/expense/claims', { amount: 1 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as InstanceType<typeof ApiError>).code).toBe('OFFLINE_READ_ONLY');
    expect(fetchMock).not.toHaveBeenCalled();
    setNetwork('ONLINE');
    expect(offlineWriteRefusal('POST', '/api/finance/journals')).toBeNull();
  });

  it('shows the banner offline with the oldest copy served, nothing online', async () => {
    setNetwork('OFFLINE');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'success', data: [] }), { headers: { 'content-type': 'application/json', 'X-WS-Offline': '1', 'X-WS-Cached-At': '2026-10-20T08:30:00Z' } }));
    await apiGet('/api/recruitment/jobs');
    noteServedFromCopy('/api/recruitment/meta', '2026-10-21T08:30:00Z');
    render(<OfflineReadOnlyBanner module="recruitment" />);
    const s = screen.getByRole('status');
    expect(s.textContent).toMatch(/Offline · read-only\. Recruitment as of/);
    expect(s.textContent).toMatch(/20/);
    cleanup();
    setNetwork('ONLINE');
    render(<OfflineReadOnlyBanner module="recruitment" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
