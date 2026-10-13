// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@shared/types';
import { ABC_ID, LIVEZEN_ID, PERSONAL_ID, abc, account, accountsState, auth, personal, run } from './accounts-fixtures';
import type * as Bridge from '../../../src/core/bridge';

/**
 * Screen 9 (Compatibility), screen 11 (the workspace chooser) and screen 16's dialog (a link to a server not added),
 * WP4.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

const { app } = await import('../../../src/core/app-state');
const { Compatibility, compatDetails } = await import('../../../src/app/connect/Compatibility');
const { WorkspaceChooser, chooserLine } = await import('../../../src/app/connect/WorkspaceChooser');
const { UnknownServerLink, UnknownLinkHost } = await import('../../../src/app/connect/UnknownServerLink');
const { toast } = await import('../../../src/core/toasts');

const COMPAT = { installed: '26.9.2', required: '26.10.0', serverVersion: '2026.4', supportedFrom: '2026.7' };
const update = (extra: Partial<UpdateStatus> = {}) => ({ state: 'IDLE', availableVersion: null, ...extra }) as UpdateStatus;

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string, input?: { always?: boolean }) => {
    if (channel === 'updates:check') return update({ state: 'CHECKING' });
    if (channel === 'updates:download') return update({ state: 'DOWNLOADING' });
    if (channel === 'accounts:rediscover') return run({ state: 'ok' });
    if (channel === 'accounts:startupChoice') return accountsState({ chooserPending: false });
    if (channel === 'accounts:setChooser') return accountsState({ chooserAlways: !!input?.always });
    if (channel === 'local:enter') return { language: 'en', profile: null, locked: false };
    return undefined;
  });
  app.set({ update: update(), accounts: accountsState(), unknownLink: null, session: { mode: 'account', signingIn: false, moveOffer: false, adding: null } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.resolve()) } });
});
afterEach(() => cleanup());

describe('Compatibility', () => {
  it('UPDATE_REQUIRED: the versions, and Update now goes through the updater', async () => {
    render(<Compatibility auth={auth('update-required', { account: abc({ organizationName: 'ABC Company' }), compat: COMPAT })} />);
    expect(screen.getByText('WorkSuite — Enterprise · ABC Company')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ABC Company requires WorkSuite Desktop 26.10.0 or later' })).toBeTruthy();
    expect(screen.getByText('26.9.2')).toBeTruthy();
    expect(screen.getByText(/Your other accounts keep working/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('updates:check');
  });

  it('downloads an update already on offer', async () => {
    app.set({ update: update({ state: 'AVAILABLE', availableVersion: '26.10.0' }) });
    render(<Compatibility auth={auth('update-required', { account: abc(), compat: COMPAT })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('updates:download');
  });

  it('SERVER_TOO_OLD: the versions, Copy details and Re-run discovery', async () => {
    render(<Compatibility auth={auth('server-too-old', { account: abc(), compat: COMPAT })} />);
    expect(screen.getByText('SERVER_TOO_OLD')).toBeTruthy();
    expect(screen.getByText(/Server 2026\.4 · Desktop supports 2026\.7 and later/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('SERVER_TOO_OLD'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Re-run discovery' }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:rediscover', { accountId: ABC_ID });
    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('supported'));
  });

  it('keeps the other accounts one click away', async () => {
    app.set({ accounts: accountsState({ accounts: [abc({ active: true }), personal()] }) });
    render(<Compatibility auth={auth('server-too-old', { account: abc({ active: true }), compat: COMPAT })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /WorkSuite Cloud/ }));
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:switch', { accountId: PERSONAL_ID });
  });

  it('writes the details for an administrator', () => {
    const text = compatDetails('UPDATE_REQUIRED', COMPAT, 'worksuite.abc.com');
    expect(text).toMatch(/code\s+UPDATE_REQUIRED/);
    expect(text).toMatch(/required\s+26\.10\.0/);
    expect(text).toMatch(/host\s+worksuite\.abc\.com/);
  });
});

describe('WorkspaceChooser', () => {
  const NOW = Date.parse('2026-10-13T10:00:00Z');
  const list = [personal({ lastUsedAt: '2026-10-13T08:00:00Z', active: true }), account({ reachability: 'offline' }), abc()];

  it('says each account’s state', () => {
    expect(chooserLine(list[0]!, NOW).text).toBe('Personal · WorkSuite Cloud · last used 2 h ago');
    expect(chooserLine(list[1]!, NOW).text).toBe('Enterprise · worksuite.livezentech.com · offline until reconnect');
    expect(chooserLine(list[2]!, NOW)).toEqual({ text: 'Enterprise · worksuite.abc.com · signed out', warn: true });
    expect(chooserLine(abc({ pendingChanges: 2 }), NOW).text).toContain('2 pending changes');
  });

  it('lists every account with Open or Sign in, and opens the one chosen', async () => {
    render(<WorkspaceChooser accounts={accountsState({ accounts: list, chooserPending: true })} />);
    expect(screen.getByRole('heading', { name: 'Choose WorkSuite workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Hasarinda' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Livezen Technologies' })).toBeTruthy();
    const signIn = screen.getByRole('button', { name: 'Sign in to ABC Client' });
    expect(signIn.textContent).toBe('Sign in');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Hasarinda' }));
    await act(async () => {
      fireEvent.click(signIn);
    });
    expect(bridge.call).toHaveBeenCalledWith('accounts:startupChoice', { accountId: ABC_ID });
    expect(app.get().accounts?.chooserPending).toBe(false);
  });

  it('moves between accounts with ↑ ↓', () => {
    render(<WorkspaceChooser accounts={accountsState({ accounts: list, chooserPending: true })} />);
    const first = screen.getByRole('button', { name: 'Open Hasarinda' });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Livezen Technologies' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in to ABC Client' }));
  });

  it('saves “Always show this at startup”, and offers + Add Account', () => {
    render(<WorkspaceChooser accounts={accountsState({ accounts: list, chooserPending: true })} />);
    const box = screen.getByRole('checkbox', { name: 'Always show this at startup' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(bridge.call).toHaveBeenCalledWith('accounts:setChooser', { always: true });
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '+ Add Account' }));
    expect(app.get().session.adding).toEqual({ step: 'choose' });
  });

  it('does not open an account blocked by the organization', () => {
    render(<WorkspaceChooser accounts={accountsState({ accounts: [personal({ blockedReason: 'Blocked by your organization' }), account({ id: LIVEZEN_ID })], chooserPending: true })} />);
    expect((screen.getByRole('button', { name: 'Open Hasarinda' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Blocked by your organization/)).toBeTruthy();
  });
});

describe('UnknownServerLink', () => {
  const LINK = { url: 'https://worksuite.company.example/tenders/123', host: 'worksuite.company.example', label: 'Tender #123' };

  it('names the host and what the link points at; Add Account starts at the address screen', () => {
    const onClose = vi.fn();
    render(<UnknownServerLink link={LINK} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'This link belongs to a WorkSuite server you haven’t added' });
    expect(within(dialog).getByText('worksuite.company.example · Tender #123')).toBeTruthy();
    expect(within(dialog).getByText(/never connects to a new server on its own/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Account' }));
    expect(onClose).toHaveBeenCalled();
    expect(app.get().session.adding).toEqual({ step: 'enterprise', prefill: 'https://worksuite.company.example' });
    // Nothing fetched from that host: no IPC at all but telling the desktop an account is being added.
    expect(bridge.call.mock.calls.map((c) => c[0])).toEqual(['accounts:addStart']);
  });

  it('shows for accounts:unknownLink and goes away on Cancel', () => {
    app.set({ unknownLink: LINK });
    render(<UnknownLinkHost />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(app.get().unknownLink).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cannot add a server when the organization locks this computer to its own', () => {
    app.set({ accounts: accountsState({ allowAddEnterprise: false }) });
    render(<UnknownServerLink link={LINK} onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Add Account' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
