// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as CoreBridge from '../../../src/core/bridge';

/**
 * Linking a WhatsApp Web number reliably (worksuite-desktop#323): Scan again starts a fresh link and a new code comes
 * up; a pairing code is offered instead of the QR; each failure is said once, with its cause and next step; nothing
 * reads "starting" for more than a minute; and each attempt is in Diagnostics.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof CoreBridge>()), call: vi.fn(async () => undefined) }));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { LinkPhone } from '../../../src/modules/chat/channels/LinkPhone';
import { actionLabel, linkError, linkErrorOf, linkView, pairingPhoneOk, qrCountdown, START_TIMEOUT_MS } from '../../../src/modules/chat/channels/linkFlow';
import { WhatsappLinkLog, attemptTone } from '../../../src/modules/diagnostics/WhatsappLinkLog';

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const answer = (over: Record<string, unknown>) => ({ ok: true, qr: null, state: null, linked: false, status_note: null, error: null, ...over });
const linkCalls = () => vi.mocked(apiPost).mock.calls.filter((c) => String(c[0]).endsWith('/link'));

beforeEach(() => {
  vi.mocked(apiPost).mockReset().mockResolvedValue({ ok: true, state: 'starting' } as never);
  vi.mocked(apiGet).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the link flow', () => {
  it('reads where a link stands: the server’s attempt first, an older server’s bare states the same way', () => {
    const t = 1_000_000;
    expect(linkView({ started: false, startedAt: t, now: t })).toEqual({ at: 'starting' });
    expect(linkView({ answer: answer({ state: 'qr', qr: '2@a' }), started: true, startedAt: t, now: t })).toEqual({ at: 'qr', qr: '2@a' });
    expect(linkView({ answer: answer({ state: 'pairing', pairing_code: 'ABCD-EFGH' }), started: true, startedAt: t, now: t })).toEqual({ at: 'pairing', code: 'ABCD-EFGH' });
    expect(linkView({ answer: answer({ state: 'authenticated' }), started: true, startedAt: t, now: t })).toEqual({ at: 'scanned' });
    expect(linkView({ answer: answer({ linked: true, state: 'ready' }), started: true, startedAt: t, now: t })).toEqual({ at: 'linked' });
    const server = linkError('browser_failed', 'libnss3.so missing');
    expect(linkView({ answer: answer({ state: 'starting', link_error: server }), started: true, startedAt: t, now: t })).toEqual({ at: 'error', error: server });
    // An older server says only the state.
    expect(linkView({ answer: answer({ state: 'auth_failure' }), started: true, startedAt: t, now: t })).toMatchObject({ at: 'error', error: { code: 'unlinked', action: 'scan_again' } });
    // A failed start wins over everything.
    expect(linkView({ startError: linkError('bridge_unreachable'), answer: answer({ qr: '2@a' }), started: false, startedAt: t, now: t })).toMatchObject({ at: 'error', error: { code: 'bridge_unreachable' } });
  });

  it('never says starting for more than a minute', () => {
    const t = 1_000_000;
    expect(linkView({ answer: answer({ state: 'starting' }), started: true, startedAt: t, now: t + START_TIMEOUT_MS - 1 })).toEqual({ at: 'starting' });
    expect(linkView({ answer: answer({ state: 'starting' }), started: true, startedAt: t, now: t + START_TIMEOUT_MS })).toMatchObject({ at: 'error', error: { code: 'timeout', action: 'retry' } });
    // Showing a code is not starting.
    expect(linkView({ answer: answer({ state: 'qr', qr: '2@a' }), started: true, startedAt: t, now: t + 5 * START_TIMEOUT_MS })).toEqual({ at: 'qr', qr: '2@a' });
  });

  it('counts down to the next code, names the next step, and takes the server’s error from a failed request', () => {
    expect(qrCountdown(0, 0)).toBe(20);
    expect(qrCountdown(0, 14_500)).toBe(6);
    expect(qrCountdown(0, 25_000)).toBe(0);
    expect([actionLabel('scan_again'), actionLabel('retry'), actionLabel('new_code'), actionLabel('open_existing'), actionLabel('none')]).toEqual(['Scan again', 'Retry', 'New code', null, null]);
    const dup = { code: 'duplicate_phone', title: 'This number is already linked as Support', message: 'x', action: 'open_existing', detail: null };
    expect(linkErrorOf(new ApiError(409, 'This number is already linked as Support', null, { link_error: dup }))).toEqual(dup);
    expect(linkErrorOf(new ApiError(0, 'offline', null))).toMatchObject({ code: 'bridge_unreachable', detail: 'offline' });
    expect(linkErrorOf(new Error('boom'), 'pairing_failed')).toMatchObject({ code: 'unknown', detail: 'boom' });
    expect(pairingPhoneOk('+94 76 913 6424')).toBe(true);
    expect(pairingPhoneOk('076 913 6424')).toBe(true);
    expect(pairingPhoneOk('123')).toBe(false);
  });
});

describe('linking a phone', () => {
  it('says a failure once, with its cause, the next step and the admin’s details', async () => {
    vi.mocked(apiGet).mockResolvedValue(answer({ state: 'start_failed', link_error: linkError('browser_failed', 'The browser would not start: libnss3.so: cannot open shared object file') }) as never);
    wrap(<LinkPhone accountId={4} onLinked={() => undefined} />);
    expect(await screen.findByText('Couldn’t start the WhatsApp connection on the server (browser failed)')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Details for admin')).toBeTruthy();
    expect(screen.getByText(/libnss3\.so/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // No instructions to scan a code that is not there.
    expect(screen.queryByText(/Point the camera/)).toBeNull();
  });

  it('a failed start says why, from the server, and Retry asks for a fresh link', async () => {
    const dup = { code: 'bridge_full', title: 'The server is holding as many numbers as it can', message: 'Unlink one.', action: 'none', detail: null };
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(502, dup.title, null, { link_error: dup }) as never);
    vi.mocked(apiGet).mockResolvedValue(answer({ state: 'qr', qr: '2@new' }) as never);
    wrap(<LinkPhone accountId={4} onLinked={() => undefined} />);
    expect(await screen.findByText('The server is holding as many numbers as it can')).toBeTruthy();
    // Nothing the screen can do itself, but there is a way to start over.
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(linkCalls()).toHaveLength(2));
    expect(linkCalls()[1]![1]).toEqual({ fresh: true });
    expect(await screen.findByRole('img', { name: 'QR code to link WhatsApp' })).toBeTruthy();
  });

  it('shows a fresh QR code that refreshes by itself as WhatsApp replaces it', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce(answer({ state: 'qr', qr: '2@first' }) as never).mockResolvedValue(answer({ state: 'qr', qr: '2@second' }) as never);
    wrap(<LinkPhone accountId={4} onLinked={() => undefined} />);
    expect(await screen.findByText(/New code in \d+s — it refreshes by itself\./)).toBeTruthy();
    expect(screen.getByText('2. Settings → Linked devices → Link a device.')).toBeTruthy();
    // The next poll brings the rotated code.
    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.length).toBeGreaterThan(1), { timeout: 5000 });
  });

  it('links with a phone number instead: asks for a pairing code and shows it with the steps', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce(answer({ state: 'qr', qr: '2@first' }) as never).mockResolvedValue(answer({ state: 'pairing', pairing_code: 'ABCD-EFGH' }) as never);
    vi.mocked(apiPost).mockImplementation((async (path: string) => (String(path).endsWith('/pair') ? { ok: true, code: 'ABCD-EFGH' } : { ok: true, state: 'starting' })) as never);
    wrap(<LinkPhone accountId={4} onLinked={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Link with phone number instead' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Phone number of this WhatsApp/ }), { target: { value: '+94 76 913 6424' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get code' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/whatsapp/accounts/4/pair', { phone: '+94 76 913 6424' }));
    expect((await screen.findByLabelText('Pairing code')).textContent).toBe('ABCD-EFGH');
    expect(screen.getByText('3. Choose Link with phone number instead, and enter the code above.')).toBeTruthy();
  });

  it('a pairing request that fails says so in the form, and the code on screen stays', async () => {
    vi.mocked(apiGet).mockResolvedValue(answer({ state: 'qr', qr: '2@first' }) as never);
    const dup = { code: 'duplicate_phone', title: 'This number is already linked as Support', message: 'Use that one instead.', action: 'open_existing', detail: null };
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (String(path).endsWith('/pair')) throw new ApiError(409, dup.title, null, { link_error: dup });
      return { ok: true };
    }) as never);
    wrap(<LinkPhone accountId={4} onLinked={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Link with phone number instead' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Phone number/ }), { target: { value: '0769136424' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get code' }));
    expect(await screen.findByText('This number is already linked as Support.')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'QR code to link WhatsApp' })).toBeTruthy();
  });

  it('a start that shows nothing for a minute ends in “Linking timed out” with Retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(apiGet).mockResolvedValue(answer({ state: 'starting', status_note: 'Opening the browser.' }) as never);
    wrap(<LinkPhone accountId={4} onLinked={() => undefined} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(screen.getByText('Linking timed out')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('once linked, says which number it is connected as', async () => {
    vi.mocked(apiGet).mockResolvedValue(answer({ state: 'ready', linked: true, attempt: { id: 1, state: 'connected', method: 'qr', error: null, started_at: null, timeout_at: null, elapsed_seconds: 30, phone: '94769136424' }, progress: { loading: null, sync: { state: 'running', percent: null, chats_done: 1, chats_total: 9, messages: 3, error: null }, engine: 'wwebjs' } }) as never);
    wrap(<LinkPhone accountId={4} onLinked={() => undefined} />);
    expect(await screen.findByText('Connected as +94 76 913 6424')).toBeTruthy();
  });
});

describe('Diagnostics', () => {
  it('lists each link attempt with its outcome and log, for whoever may link numbers', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      attempts: [
        { id: 2, account_id: 4, account_name: 'Support', state: 'failed', method: 'qr', started_at: '2026-10-10T10:00:00Z', ended_at: '2026-10-10T10:01:00Z', elapsed_seconds: 60, error: { code: 'timeout', title: 'Linking timed out', message: '', detail: 'No QR code within 60 seconds of starting.' }, events: [{ at: '2026-10-10T10:00:00Z', event: 'start', note: null }, { at: '2026-10-10T10:01:00Z', event: 'error', note: 'Linking timed out' }] },
        { id: 1, account_id: 4, account_name: 'Support', state: 'connected', method: 'pairing', started_at: '2026-10-09T10:00:00Z', ended_at: null, elapsed_seconds: 40, error: null, events: [] },
      ],
    } as never);
    wrap(<WhatsappLinkLog />);
    const section = await screen.findByRole('region', { name: 'WhatsApp linking' });
    expect(within(section).getByText('Error')).toBeTruthy();
    expect(within(section).getByText('Connected')).toBeTruthy();
    expect(within(section).getByText('Support · pairing code')).toBeTruthy();
    fireEvent.click(within(section).getAllByRole('button')[0]!);
    expect(within(section).getByText(/No QR code within 60 seconds/)).toBeTruthy();
    expect(within(section).queryByText(/QR code shown/)).toBeNull();
    expect(within(section).getByText('Started')).toBeTruthy();
    expect(vi.mocked(apiGet).mock.calls[0]![0]).toBe('/api/whatsapp/link-attempts');
    expect(attemptTone('failed')).toBe('danger');
  });

  it('is absent for somebody who may not link numbers', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(403, 'You do not have permission to do that', null) as never);
    const { container } = wrap(<WhatsappLinkLog />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
