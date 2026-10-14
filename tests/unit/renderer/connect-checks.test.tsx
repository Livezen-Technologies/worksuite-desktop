// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult, ConnectFailure, DiscoveredServer } from '@shared/discovery';
import { accountsState, abc, run } from './accounts-fixtures';
import type * as Bridge from '../../../src/core/bridge';

/**
 * Screen 7 — the server checks (WP4): live steps from `connect:progress`, the failure panel with Details for IT and
 * Copy details, Change address and Try again, never "proceed anyway"; Continue adds a verified server.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn(), events: new Map<string, (p: unknown) => void>() }));
vi.mock('../../../src/core/bridge', async (orig) => ({
  ...(await orig<typeof Bridge>()),
  call: bridge.call,
  on: (channel: string, cb: (p: unknown) => void) => {
    bridge.events.set(channel, cb);
    return () => bridge.events.delete(channel);
  },
  hasDesktop: () => true,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { app, acceptsRun } = await import('../../../src/core/app-state');
const { ChecksScreen, detailsForIt, failureText } = await import('../../../src/app/connect/ChecksScreen');
const { toast } = await import('../../../src/core/toasts');

const steps = (...s: Array<[CheckResult['id'], CheckResult['status'], number | null, string | null]>): CheckResult[] => s.map(([id, status, ms, note]) => ({ id, status, ms, note }));
const TLS_FAILURE: ConnectFailure = {
  code: 'TLS_UNTRUSTED',
  message: 'The certificate is not trusted.',
  step: 'tls',
  host: 'worksuite.abc.com',
  requestId: '01927f3c-8a1e-7000-8000-000000000000',
  at: '2026-10-02T18:41:07+05:30',
  tls: { host: 'worksuite.abc.com', port: 443, issuer: 'CN=ABC-Internal-CA', subject: 'CN=worksuite.abc.com', validFrom: '2025-03-14T00:00:00Z', validTo: '2027-03-14T00:00:00Z', spki: 'sha256/Lk3uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9wQ=', trustStore: 'macOS', reason: '' },
};
const failed = run({
  state: 'failed',
  steps: steps(['dns', 'ok', 42, null], ['tls', 'failed', null, null], ['document', 'waiting', null, null], ['signature', 'waiting', null, null], ['product', 'waiting', null, null], ['version', 'waiting', null, null], ['health', 'waiting', null, null]),
  failure: TLS_FAILURE,
});
const SERVER = { origin: 'https://worksuite.abc.com', name: 'ABC Company', signed: true } as DiscoveredServer;

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => {
    if (channel === 'connect:start') return { runId: 'run_retry000' };
    if (channel === 'connect:copyDetails') return true;
    if (channel === 'connect:confirm') return abc();
    if (channel === 'connect:get') throw new Error('gone');
    return undefined;
  });
  app.set({ connect: null, accounts: accountsState(), session: { mode: 'account', signingIn: false, moveOffer: false, adding: { step: 'enterprise' } } });
});
afterEach(() => cleanup());

describe('ChecksScreen', () => {
  it('lists every check with its progress while running, and Cancel', () => {
    render(<ChecksScreen run={run({ steps: steps(['dns', 'ok', 42, null], ['tls', 'running', null, null]) })} />);
    expect(screen.getByRole('heading', { name: 'Checking worksuite.abc.com' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Server checks' });
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(7);
    expect(items[0]!.textContent).toContain('Address found (DNS)');
    expect(items[0]!.textContent).toContain('42 ms');
    expect(items[1]!.getAttribute('data-status')).toBe('running');
    expect(items[6]!.getAttribute('data-status')).toBe('waiting');
    expect(list.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bridge.call).toHaveBeenCalledWith('connect:cancel', { runId: 'run_12345678' });
    expect(app.get().session.adding).toEqual({ step: 'enterprise', prefill: 'worksuite.abc.com' });
  });

  it('shows signature “not configured” and an unreported version as notes, not failures', () => {
    render(<ChecksScreen run={run({ steps: steps(['signature', 'skipped', 3, 'Not configured'], ['version', 'warning', 1, 'version not reported']) })} />);
    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(screen.getByText('version not reported')).toBeTruthy();
  });

  it('follows connect:progress through the store', () => {
    const r = run();
    expect(acceptsRun(null, r)).toBe(true);
    expect(acceptsRun(r, { ...r, state: 'failed' })).toBe(true);
    expect(acceptsRun(r, { ...r, runId: 'run_other000' })).toBe(false);
  });

  it('explains a failure, with Details for IT and no way to proceed anyway', () => {
    render(<ChecksScreen run={failed} />);
    expect(screen.getByRole('alert').textContent).toContain('The server’s security certificate is not trusted.');
    const details = screen.getByTestId('details-for-it').textContent!;
    expect(details).toMatch(/code\s+TLS_UNTRUSTED/);
    expect(details).toMatch(/host\s+worksuite\.abc\.com:443/);
    expect(details).toMatch(/issuer\s+CN=ABC-Internal-CA/);
    expect(details).toMatch(/expires\s+2027-03-14/);
    expect(details).toMatch(/chain\s+not in macOS trust store/);
    expect(details).toMatch(/spki\s+sha256\//);
    expect(details).toMatch(/request\s+01927f3c/);
    expect(screen.getByRole('button', { name: 'Change address' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /proceed|continue anyway|connect anyway/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('copies the details through the desktop', async () => {
    render(<ChecksScreen run={failed} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('connect:copyDetails', { runId: 'run_12345678' });
    expect(toast).toHaveBeenCalledWith('success', 'Details copied.');
  });

  it('tries again with the same input, and changes the address back on screen 6', async () => {
    render(<ChecksScreen run={failed} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('connect:start', { input: 'worksuite.abc.com', target: 'enterprise' });
    expect(app.get().connect?.runId).toBe('run_retry000');
    fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
    expect(app.get().session.adding).toEqual({ step: 'enterprise', prefill: 'worksuite.abc.com' });
    expect(app.get().connect).toBeNull();
  });

  it('names a verified server, and Continue adds it', async () => {
    app.set({ connect: run({ state: 'ok', server: SERVER }) });
    render(<ChecksScreen run={run({ state: 'ok', server: SERVER, steps: steps(['dns', 'ok', 1, null], ['tls', 'ok', 2, null], ['document', 'ok', 3, null], ['signature', 'ok', 4, null], ['product', 'ok', 1, null], ['version', 'ok', 1, null], ['health', 'ok', 9, null]) })} />);
    expect(screen.getByRole('status').textContent).toContain('ABC Company');
    expect(screen.getByRole('status').textContent).toContain('verified');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('connect:confirm', { runId: 'run_12345678' });
    expect(app.get().session.adding).toBeNull();
    expect(app.get().connect).toBeNull();
  });

  it('offers Open for an account already on this computer', async () => {
    app.set({ accounts: accountsState({ accounts: [abc()] }) });
    render(<ChecksScreen run={{ ...failed, failure: { ...TLS_FAILURE, code: 'ACCOUNT_EXISTS', tls: undefined } }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:switch', { accountId: abc().id });
  });

  it('shows the version cards for UPDATE_REQUIRED found while connecting', () => {
    render(<ChecksScreen run={{ ...failed, failure: { ...TLS_FAILURE, code: 'UPDATE_REQUIRED', tls: undefined, compat: { installed: '26.9.2', required: '26.10.0', serverVersion: '2026.10', supportedFrom: '2026.7' } } }} />);
    expect(screen.getByText('UPDATE_REQUIRED')).toBeTruthy();
    expect(screen.getByText('26.10.0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change address' })).toBeTruthy();
  });

  it('has words for every failure', () => {
    expect(failureText({ ...TLS_FAILURE, code: 'DNS_FAILED' }).title).toMatch(/wasn’t found/);
    expect(failureText({ ...TLS_FAILURE, code: 'NOPE' as never, message: 'Raw message' }).title).toBe('Raw message');
    expect(detailsForIt(run())).toBe('');
  });
});
