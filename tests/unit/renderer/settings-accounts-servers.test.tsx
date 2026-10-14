// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionHealth } from '@shared/accounts';
import { ABC_ID, LIVEZEN_ID, PERSONAL_ID, abc, account, accountsState, personal, run } from './accounts-fixtures';
import type * as Bridge from '../../../src/core/bridge';

/**
 * Settings › Accounts & Servers and Connection health (screen 15, WP4): every account with Open / Sign in, Sign out,
 * Remove or "Removal set by IT policy", "N pending changes kept"; the health panel with Re-run discovery and Export
 * diagnostics.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { app } = await import('../../../src/core/app-state');
const { toast } = await import('../../../src/core/toasts');
const { accountDialogs } = await import('../../../src/app/accounts/dialogs');
const { AccountsServers, accountLine } = await import('../../../src/modules/settings/AccountsServers');
const { healthText } = await import('../../../src/modules/settings/ConnectionHealth');

const HEALTH: ConnectionHealth = {
  accountId: PERSONAL_ID,
  checkedAt: '2026-10-13T10:00:00Z',
  components: {
    api: { state: 'healthy', detail: '' },
    auth: { state: 'healthy', detail: '' },
    realtime: { state: 'degraded', detail: 'polling 60 s' },
    files: { state: 'healthy', detail: '' },
    office: { state: 'healthy', detail: '' },
    sync: { state: 'healthy', detail: '0 pending' },
  },
};
const list = () => [
  personal({ active: true }),
  account({ managed: true, removable: false, removalReason: 'Removal set by IT policy' }),
  abc({ pendingChanges: 2 }),
];

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => {
    if (channel === 'accounts:health') return HEALTH;
    if (channel === 'accounts:rediscover') return run({ state: 'ok' });
    if (channel === 'diagnostics:saveBundle') return '/home/h/WorkSuite-diagnostics.zip';
    if (channel === 'accounts:switch') return { switched: true, ms: 700 };
    return undefined;
  });
  app.set({ accounts: accountsState({ accounts: list(), activeId: PERSONAL_ID }), session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
  accountDialogs.set({ signOut: null, remove: null });
});
afterEach(() => cleanup());

describe('accountLine', () => {
  it('says who, the state and what is kept', () => {
    expect(accountLine(list()[0]!).text).toBe('hasarinda@email.com · active now');
    expect(accountLine(list()[1]!).text).toBe('hasarinda@livezentech.com · managed by your organization');
    expect(accountLine(list()[2]!)).toEqual({ text: 'signed out · 2 pending changes kept', warn: true });
    expect(accountLine(account({ syncPaused: true })).text).toContain('Sync paused while another account is open');
  });

  it('words health', () => {
    expect(healthText({ state: 'degraded', detail: 'polling 60 s' })).toBe('Degraded · polling 60 s');
    expect(healthText({ state: 'healthy', detail: 'healthy' })).toBe('Healthy');
    expect(healthText(undefined)).toBe('Not checked');
  });
});

describe('AccountsServers', () => {
  it('lists every account with its actions', () => {
    render(wrap(<AccountsServers />));
    expect(screen.getByRole('heading', { name: 'Accounts & Servers' })).toBeTruthy();
    const cloud = screen.getByTestId(`account-row-${PERSONAL_ID}`);
    expect(within(cloud).getByText('Personal — WorkSuite Cloud')).toBeTruthy();
    expect((within(cloud).getByRole('button', { name: /is open/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(cloud).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(within(cloud).getByRole('button', { name: 'Remove from this device' })).toBeTruthy();
    const livezen = screen.getByTestId(`account-row-${LIVEZEN_ID}`);
    expect(within(livezen).getByText('Enterprise — Livezen Technologies')).toBeTruthy();
    expect(within(livezen).getByText('Removal set by IT policy')).toBeTruthy();
    expect(within(livezen).queryByRole('button', { name: 'Remove from this device' })).toBeNull();
    const abcRow = screen.getByTestId(`account-row-${ABC_ID}`);
    expect(within(abcRow).getByText('signed out · 2 pending changes kept')).toBeTruthy();
    expect(within(abcRow).getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(within(abcRow).queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('opens, signs out, removes and adds', async () => {
    render(wrap(<AccountsServers />));
    await act(async () => {
      fireEvent.click(within(screen.getByTestId(`account-row-${LIVEZEN_ID}`)).getByRole('button', { name: 'Open' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:switch', { accountId: LIVEZEN_ID });
    fireEvent.click(within(screen.getByTestId(`account-row-${LIVEZEN_ID}`)).getByRole('button', { name: 'Sign out' }));
    expect(accountDialogs.get().signOut).toBe(LIVEZEN_ID);
    fireEvent.click(within(screen.getByTestId(`account-row-${ABC_ID}`)).getByRole('button', { name: 'Remove from this device' }));
    expect(accountDialogs.get().remove).toBe(ABC_ID);
    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }));
    expect(app.get().session.adding).toEqual({ step: 'choose' });
  });

  it('shows the selected account’s connection health, with Re-run discovery and Export diagnostics', async () => {
    render(wrap(<AccountsServers />));
    const panel = screen.getByTestId('connection-health');
    await waitFor(() => expect(within(panel).getByText('Degraded · polling 60 s')).toBeTruthy());
    expect(bridge.call).toHaveBeenCalledWith('accounts:health', { accountId: PERSONAL_ID });
    for (const label of ['API', 'Authentication', 'Realtime', 'Files', 'Office', 'Sync']) expect(within(panel).getByText(label)).toBeTruthy();
    expect(within(panel).getByText('Healthy · 0 pending')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Re-run discovery' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:rediscover', { accountId: PERSONAL_ID });
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Export diagnostics' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('diagnostics:saveBundle');
    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('WorkSuite-diagnostics.zip'));
    fireEvent.click(screen.getByRole('button', { name: /Enterprise — ABC Client/ }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('accounts:health', { accountId: ABC_ID }));
  });

  it('says so on a desktop without accounts', () => {
    app.set({ accounts: null });
    render(wrap(<AccountsServers />));
    expect(screen.getByText('Accounts aren’t available in this version')).toBeTruthy();
  });
});
