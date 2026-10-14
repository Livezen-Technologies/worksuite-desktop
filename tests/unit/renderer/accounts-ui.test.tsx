// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ABC_ID, LIVEZEN_ID, PERSONAL_ID, abc, account, accountsState, auth, personal, snapshot, unsynced } from './accounts-fixtures';
import type * as Bridge from '../../../src/core/bridge';
import type * as Tabs from '../../../src/core/tabs';

/**
 * The in-app account UI (WP4): the switcher in the account menu (screen 10), Sign out with unsynced changes (screen 14),
 * Remove from this device, and the service banner (screen 16).
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: vi.fn() }));

const { DesktopError } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { navigate } = await import('../../../src/core/tabs');
const { toast } = await import('../../../src/core/toasts');
const { AccountSwitcher, groupAccounts } = await import('../../../src/app/accounts/AccountSwitcher');
const { SignOutDialog, unsyncedCount } = await import('../../../src/app/accounts/SignOutDialog');
const { RemoveAccountDialog } = await import('../../../src/app/accounts/RemoveAccountDialog');
const { ServiceBanner, serviceHeadline, retryIn } = await import('../../../src/app/accounts/ServiceBanner');
const { AccountDialogsHost, openSignOut, openRemove, closeAccountDialogs } = await import('../../../src/app/accounts/dialogs');

const three = () => [personal({ active: true }), account({ unread: 3 }), abc()];

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => {
    if (channel === 'accounts:unsynced') return unsynced();
    if (channel === 'accounts:syncNow') return unsynced({ items: [] });
    if (channel === 'accounts:exportUnsynced') return { path: '/home/h/Unsynced.zip' };
    if (channel === 'accounts:signOut' || channel === 'accounts:remove') return accountsState();
    if (channel === 'accounts:switch') return { switched: true, ms: 800 };
    return undefined;
  });
  app.set({ accounts: accountsState({ accounts: three(), activeId: PERSONAL_ID }), status: snapshot(), auth: auth('ready', { account: personal({ active: true }) }), session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
  closeAccountDialogs();
});
afterEach(() => cleanup());

describe('AccountSwitcher', () => {
  it('groups PERSONAL and ENTERPRISE with the open account, unread and Signed out', () => {
    expect(groupAccounts(three()).enterprise.map((a) => a.id)).toEqual([LIVEZEN_ID, ABC_ID]);
    render(<AccountSwitcher accounts={accountsState({ accounts: three(), activeId: PERSONAL_ID })} />);
    const menu = screen.getByRole('menu', { name: 'Switch account' });
    const personalGroup = within(menu).getByRole('group', { name: 'Personal' });
    const open = within(personalGroup).getByRole('menuitemradio', { name: /Hasarinda · WorkSuite Cloud/ });
    expect(open.getAttribute('aria-checked')).toBe('true');
    expect(within(open).getByLabelText('Open now')).toBeTruthy();
    const enterprise = within(menu).getByRole('group', { name: 'Enterprise' });
    expect(within(enterprise).getByRole('menuitemradio', { name: /Livezen Technologies/ }).textContent).toContain('3 new');
    expect(within(enterprise).getByRole('menuitemradio', { name: /ABC Client/ }).textContent).toContain('Signed out');
    expect(within(enterprise).getByRole('menuitemradio', { name: /ABC Client/ }).textContent).toContain('worksuite.abc.com');
  });

  it('switches to another account', async () => {
    render(<AccountSwitcher accounts={accountsState({ accounts: three(), activeId: PERSONAL_ID })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Livezen/ }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:switch', { accountId: LIVEZEN_ID });
  });

  it('says why a switch was refused', async () => {
    bridge.call.mockImplementation(async () => {
      throw new DesktopError('SWITCH_BLOCKED', 'End the call first.');
    });
    render(<AccountSwitcher accounts={accountsState({ accounts: three(), activeId: PERSONAL_ID })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Livezen/ }));
    });
    expect(toast).toHaveBeenCalledWith('error', 'End the call first.');
  });

  it('does nothing for the open account, and + Add Account starts the selector', () => {
    render(<AccountSwitcher accounts={accountsState({ accounts: three(), activeId: PERSONAL_ID })} />);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Hasarinda/ }));
    expect(bridge.call).not.toHaveBeenCalledWith('accounts:switch', expect.anything());
    fireEvent.click(screen.getByRole('menuitem', { name: '+ Add Account' }));
    expect(app.get().session.adding).toEqual({ step: 'choose' });
  });
});

describe('SignOutDialog', () => {
  it('lists the unsynced changes, counting items that hold several', async () => {
    expect(unsyncedCount(unsynced().items)).toBe(6);
    render(<SignOutDialog account={account()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'You have 6 unsynced changes' })).toBeTruthy());
    const list = screen.getByRole('list', { name: 'Unsynced changes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getByText('Proposal.docx — 1 local version')).toBeTruthy();
    expect(within(list).getByText('DOC')).toBeTruthy();
    expect(screen.getByText(/Livezen Technologies/, { selector: 'b' })).toBeTruthy();
  });

  it('syncs now and exports', async () => {
    render(<SignOutDialog account={account()} onClose={vi.fn()} />);
    await waitFor(() => screen.getByRole('button', { name: 'Export unsynced…' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export unsynced…' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:exportUnsynced', { accountId: LIVEZEN_ID });
    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('/home/h/Unsynced.zip'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:syncNow', { accountId: LIVEZEN_ID });
    expect(screen.queryByRole('heading', { name: /unsynced/ })).toBeNull();
  });

  it('signs out with the chosen options, keeping what has not synced', async () => {
    const onClose = vi.fn();
    render(<SignOutDialog account={account()} onClose={onClose} />);
    await waitFor(() => screen.getByRole('heading', { name: /unsynced/ }));
    const cached = screen.getByRole('checkbox', { name: 'Remove cached account data from this device' }) as HTMLInputElement;
    const offline = screen.getByRole('checkbox', { name: 'Keep offline files' }) as HTMLInputElement;
    expect(cached.checked).toBe(true);
    expect(offline.checked).toBe(false);
    fireEvent.click(offline);
    expect(screen.getByText(/never deleted by signing out/).textContent).toMatch(/6 changes not on the server yet stay on this computer/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:signOut', { accountId: LIVEZEN_ID, removeCachedData: true, keepOfflineFiles: true, discardUnsynced: false });
    expect(onClose).toHaveBeenCalled();
  });

  it('separates Remove from this device from Delete WorkSuite account', async () => {
    const onClose = vi.fn();
    render(<SignOutDialog account={personal()} onClose={onClose} />);
    await waitFor(() => screen.getByRole('heading', { name: 'Sign out of WorkSuite Cloud' }));
    expect(screen.getByText('Different actions, different places:')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete WorkSuite account' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('cloud:openWeb', { page: 'privacy' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove from this device' }));
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/settings/accounts');
  });

  it('goes on without the list on a desktop that cannot give one, and Escape closes', async () => {
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'accounts:unsynced') throw new DesktopError('UNSUPPORTED', 'no');
      return undefined;
    });
    const onClose = vi.fn();
    render(<SignOutDialog account={account()} onClose={onClose} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('heading', { name: /unsynced/ })).toBeNull();
    expect(screen.getByText(/your organization manages Livezen Technologies accounts/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('RemoveAccountDialog', () => {
  it('removes the account from this computer, not the server', async () => {
    const onClose = vi.fn();
    render(<RemoveAccountDialog account={account()} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Remove Livezen Technologies from this device?' })).toBeTruthy();
    expect(screen.getByText(/not deleted/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep offline files on this computer' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove from this device' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:remove', { accountId: LIVEZEN_ID, keepOfflineFiles: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('asks before pending changes go with it', () => {
    render(<RemoveAccountDialog account={account({ pendingChanges: 2 })} onClose={vi.fn()} />);
    const remove = screen.getByRole('button', { name: 'Remove from this device' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(screen.getByText(/2 changes on this computer haven’t reached the server/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remove them with the account' }));
    expect(remove.disabled).toBe(false);
  });

  it('is not offered for an account IT set up', () => {
    render(<RemoveAccountDialog account={account({ removable: false, managed: true, removalReason: 'Removal set by IT policy' })} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove from this device' })).toBeNull();
    expect(screen.getByText('Removal set by IT policy')).toBeTruthy();
  });

  it('opens from anywhere through the dialogs host', () => {
    render(<AccountDialogsHost />);
    act(() => openRemove(LIVEZEN_ID));
    expect(screen.getByRole('dialog', { name: /Remove Livezen Technologies/ })).toBeTruthy();
    act(() => openSignOut(ABC_ID));
    expect(screen.queryByRole('dialog', { name: /Remove/ })).toBeNull();
    act(() => closeAccountDialogs());
  });
});

describe('ServiceBanner', () => {
  const NOW = Date.parse('2026-10-13T10:00:00Z');
  it('words the states', () => {
    expect(serviceHeadline({ state: 'unavailable', label: '', since: null, nextRetryAt: null, workOffline: false }, true)).toBe('WorkSuite Cloud is temporarily unavailable.');
    expect(serviceHeadline({ state: 'unreachable', label: 'worksuite.abc.com', since: null, nextRetryAt: null, workOffline: false }, false)).toBe('Can’t reach worksuite.abc.com.');
    expect(serviceHeadline({ state: 'ok', label: '', since: null, nextRetryAt: null, workOffline: false }, true)).toBeNull();
    expect(serviceHeadline({ state: 'offline', label: '', since: null, nextRetryAt: null, workOffline: false }, true)).toBeNull();
    expect(retryIn('2026-10-13T10:02:00Z', NOW)).toBe('Retrying in 2 min.');
    expect(retryIn('2026-10-13T10:00:40Z', NOW)).toBe('Retrying in 40 s.');
    expect(retryIn(null, NOW)).toBeNull();
  });

  it('shows Cloud unavailable with the changes waiting; Retry and Work Offline', async () => {
    app.set({ status: snapshot({ pendingChanges: 4, service: { state: 'unavailable', label: 'WorkSuite Cloud', since: '2026-10-13T09:58:00Z', nextRetryAt: null, workOffline: false } }) });
    render(<ServiceBanner />);
    const banner = screen.getByTestId('service-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toContain('WorkSuite Cloud is temporarily unavailable.');
    expect(banner.textContent).toContain('Offline-capable apps remain available.');
    expect(banner.textContent).toContain('4 changes waiting to sync.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('connection:reconnect');
    // Work Offline turns the desktop's Work Offline on; the banner gives way to the strip that turns it off.
    const unavailable = { state: 'unavailable', label: 'WorkSuite Cloud', since: '2026-10-13T09:58:00Z', nextRetryAt: null } as const;
    bridge.call.mockImplementation(async (channel: string, input?: { on: boolean }) => (channel === 'connection:workOffline' ? { ...unavailable, workOffline: !!input?.on } : undefined));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Work Offline' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('connection:workOffline', { on: true });
    expect(screen.queryByTestId('service-banner')).toBeNull();
    expect(screen.getByTestId('work-offline-strip').textContent).toContain('Working offline.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Go online' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('connection:workOffline', { on: false });
    expect(screen.getByTestId('service-banner')).toBeTruthy();
    // Another outage shows its own words.
    act(() => app.set({ status: snapshot({ service: { state: 'unreachable', label: 'worksuite.abc.com', since: '2026-10-13T10:30:00Z', nextRetryAt: null, workOffline: false } }) }));
    expect(screen.getByTestId('service-banner').textContent).toContain('Can’t reach worksuite.abc.com.');
  });

  it('stays away while healthy or with no service state; working offline shows only the strip', () => {
    app.set({ status: snapshot() });
    const { rerender } = render(<ServiceBanner />);
    expect(screen.queryByTestId('service-banner')).toBeNull();
    expect(screen.queryByTestId('work-offline-strip')).toBeNull();
    act(() => app.set({ status: snapshot({ service: { state: 'unavailable', label: 'WorkSuite Cloud', since: null, nextRetryAt: null, workOffline: true } }) }));
    rerender(<ServiceBanner />);
    expect(screen.queryByTestId('service-banner')).toBeNull();
    expect(screen.getByTestId('work-offline-strip')).toBeTruthy();
  });
});
