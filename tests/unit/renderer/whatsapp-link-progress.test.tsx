// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/** After the scan: one bar and three steps — signed in, WhatsApp loading, the chats coming in — then linked and synced. */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet, apiPost } from '../../../src/core/api';
import { LinkPhone, linkSteps } from '../../../src/modules/chat/channels/LinkPhone';

beforeEach(() => {
  vi.mocked(apiPost).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(apiGet).mockReset();
});
afterEach(() => cleanup());

describe('linking progress', () => {
  it('weighs the steps: scanned, WhatsApp loading, then the chats', () => {
    const loading = linkSteps('authenticated', false, { loading: { percent: 50, message: '' }, sync: null, engine: 'wwebjs' }, false);
    expect(loading.overall).toBe(30);
    expect(loading.steps.map((s) => s.state)).toEqual(['done', 'active', 'waiting']);
    expect(loading.steps[1]!.label).toBe('Loading WhatsApp · 50%');
    const syncing = linkSteps('ready', true, { loading: null, sync: { state: 'running', percent: null, chats_done: 10, chats_total: 40, messages: 200, error: null }, engine: 'wwebjs' }, false);
    expect(syncing.overall).toBe(63);
    expect(syncing.steps[2]!.label).toBe('Syncing chats · 10 of 40');
    const done = linkSteps('ready', true, { loading: null, sync: { state: 'done', percent: null, chats_done: 40, chats_total: 40, messages: 800, error: null }, engine: 'wwebjs' }, false);
    expect(done).toMatchObject({ overall: 100, done: true });
    expect(done.steps[2]!.label).toBe('40 chats synced · 800 messages');
    // baileys: WhatsApp's own percentage; and nothing to follow at all ends the bar after the wait.
    expect(linkSteps('ready', true, { loading: null, sync: { state: 'running', percent: 35, chats_done: 3, chats_total: null, messages: 30, error: null }, engine: 'baileys' }, false).steps[2]!.label).toBe('Syncing chats · 35%');
    expect(linkSteps('ready', true, { loading: null, sync: null, engine: 'wwebjs' }, true).done).toBe(true);
  });

  it('shows the bar after the scan and starts bringing the chats in once linked', async () => {
    const answers = [
      { ok: true, qr: null, state: 'authenticated', linked: false, status_note: null, error: null, progress: { loading: { percent: 63, message: 'Loading your chats' }, sync: null, engine: 'wwebjs' } },
      { ok: true, qr: null, state: 'ready', linked: true, status_note: 'Linked as 9477.', error: null, progress: { loading: null, sync: { state: 'running', percent: null, chats_done: 2, chats_total: 8, messages: 40, error: null }, engine: 'wwebjs' } },
    ];
    vi.mocked(apiGet).mockImplementation((async () => answers.length > 1 ? answers.shift() : answers[0]) as never);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LinkPhone accountId={4} onLinked={() => undefined} /></QueryClientProvider>);
    expect(await screen.findByText('Loading WhatsApp · 63%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Linking progress' }).getAttribute('aria-valuenow')).toBe('35');
    expect(await screen.findByText('Syncing chats · 2 of 8', undefined, { timeout: 4000 })).toBeTruthy();
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts/4/import', { background: true }));
    expect(screen.getByRole('button', { name: 'Continue in the background' })).toBeTruthy();
  });

  it('a login WhatsApp refused offers Scan again, which starts the link over for a fresh code', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ ok: true, qr: null, state: 'auth_failure', linked: false, status_note: null, error: null } as never)
      .mockResolvedValue({ ok: true, qr: '2@fresh', state: 'qr', linked: false, status_note: null, error: null } as never);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LinkPhone accountId={4} onLinked={() => undefined} /></QueryClientProvider>);
    expect(await screen.findByText('Phone unlinked this device')).toBeTruthy();
    expect(screen.queryByText(/Point the camera/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(vi.mocked(apiPost).mock.calls.filter((c) => String(c[0]).endsWith('/accounts/4/link'))).toHaveLength(2));
    // Scan again asks for a fresh link: the old login is cleared on the server, not offered again.
    expect(vi.mocked(apiPost).mock.calls.filter((c) => String(c[0]).endsWith('/accounts/4/link'))[1]![1]).toEqual({ fresh: true });
    expect(await screen.findByText(/New code in \d+s/)).toBeTruthy();
  });
});
