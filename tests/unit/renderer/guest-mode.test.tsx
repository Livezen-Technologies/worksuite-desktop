// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUEST_APPS } from '@shared/apps';
import type { AuthState, Preferences } from '@shared/types';

/**
 * Guest mode in the main window (#149): the same shell, sidebar and module screens; the guest's apps on this device;
 * locked apps behind an in-app sign-in panel, by sidebar, route and ⌘K alike; the move question after signing in.
 */
Element.prototype.scrollIntoView ??= vi.fn();
const bridge = vi.hoisted(() => ({ call: vi.fn(), handlers: new Map<string, (payload: unknown) => void>() }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: (channel: string, fn: (payload: unknown) => void) => { bridge.handlers.set(channel, fn); return () => bridge.handlers.delete(channel); },
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/tab-context', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useTab: () => ({ navigate: vi.fn(), go: vi.fn(), query: new URLSearchParams(), path: ['settings', 'local-data'], active: true }), useTabTitle: () => undefined }));

const { app, initAppState } = await import('../../../src/core/app-state');
const session = await import('../../../src/core/session');
const { queryClient } = await import('../../../src/core/query');
const { ApiError, apiGet, request } = await import('../../../src/core/api');
const { navigate, openTab, tabsStore } = await import('../../../src/core/tabs');
const { createTask } = await import('../../../src/modules/tasks/actions');
const { Sidebar } = await import('../../../src/layouts/Sidebar');
const { SignInPanel } = await import('../../../src/modules/guest/SignInPanel');
const { GuestProfileMenu } = await import('../../../src/modules/guest/GuestProfileMenu');
const { MoveLocalData } = await import('../../../src/modules/guest/MoveLocalData');
const { SearchOverlay } = await import('../../../src/app/overlays/SearchOverlay');
const { Onboarding } = await import('../../../src/app/onboarding/Onboarding');
const { NoteEditor } = await import('../../../src/modules/notes/Editor');
const SettingsPage = (await import('../../../src/modules/settings/SettingsPage')).default;
const { App } = await import('../../../src/app/App');

const PROFILE = { name: 'Hasarinda', picture: null, hasPin: false, createdAt: '2026-10-02T09:00:00Z' };
const PREFS = { sidebarMode: 'expanded', pinnedApps: [], shortcuts: {}, language: 'en', theme: 'dark', density: 'comfortable', ai: { display: 'widget', dockAtStart: false } } as unknown as Preferences;
const auth = (stage: AuthState['stage'], id = 'u1'): AuthState => ({ stage, server: { origin: 'https://ws.example.test' } as AuthState['server'], user: stage === 'ready' ? ({ id, name: 'Asha' } as AuthState['user']) : null, message: null, setupPending: false });
let api: (method: string, path: string, body?: unknown) => { status: number; data: unknown; message: string | null };

function guest(profile: typeof PROFILE | null = PROFILE, locked = false) {
  app.set({ ready: true, prefs: PREFS, auth: auth('signed-out'), session: { mode: 'guest', signingIn: false, moveOffer: false }, local: { profile, locked, language: 'en' }, apps: GUEST_APPS, bootstrap: null, lock: null });
}
const wrap = (node: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
const channels = () => bridge.call.mock.calls.map(([channel]) => channel as string);

beforeEach(() => {
  api = () => ({ status: 403, data: null, message: 'This needs a WorkSuite account. Sign in to use it.' });
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string, input?: { method: string; path: string; body?: unknown }) => {
    if (channel === 'local:api') return api(input!.method, input!.path, input!.body);
    if (channel === 'local:enter') return { profile: PROFILE, locked: false, language: 'en' };
    if (channel === 'local:overview') return { notes: 2, tasks: 1, contacts: 3, events: 0, meetingInput: '', meetingServer: '' };
    if (channel === 'guest:pending') return null;
    if (channel === 'calls:list') return [];
    return undefined;
  });
  session.closeSignInPanel();
  tabsStore.set({ tabs: [], activeId: null, closed: [], sideId: null });
  guest();
});
afterEach(() => {
  cleanup();
  app.set({ session: { mode: 'account', signingIn: false, moveOffer: false }, local: null, apps: [] });
});

describe('choosing guest mode', () => {
  it('enters guest mode in this window: no second window, and the shell gets guest mode’s apps', async () => {
    app.set({ session: { mode: 'account', signingIn: false, moveOffer: false }, local: null, apps: [] });
    render(wrap(<Onboarding auth={auth('signed-out')} />));
    fireEvent.click(screen.getByRole('button', { name: 'Continue as Guest' }));
    await waitFor(() => expect(app.get().session.mode).toBe('guest'));
    expect(channels()).toContain('local:enter');
    expect(channels().some((c) => c === 'local:open' || c === 'windows:open')).toBe(false);
    expect(app.get().apps).toBe(GUEST_APPS);
    expect(session.startRoute()).toBe('/notes');
  });

  it('shows the Local Profile setup and then the same shell — sidebar, top bar and status bar — as an account', async () => {
    guest(null);
    const { unmount } = render(wrap(<App />));
    expect(await screen.findByText('Set up your Local Profile')).toBeTruthy();
    expect(screen.queryByText('Add your profile picture')).toBeNull();
    unmount();
    guest();
    render(wrap(<App />));
    const nav = await screen.findByRole('navigation', { name: 'Apps' });
    for (const name of ['Notes', 'Tasks', 'Contacts', 'Calendar', 'Meet']) expect(within(nav).getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account: Hasarinda' })).toBeTruthy();
    expect(screen.getByText(/Saved on this device/)).toBeTruthy();
    expect(channels().some((c) => c === 'local:open' || c === 'windows:open')).toBe(false);
  });

  it('asks for the PIN in the main window before anything is read', async () => {
    guest({ ...PROFILE, hasPin: true }, true);
    render(wrap(<App />));
    expect(await screen.findByText('Enter the PIN for this Local Profile.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Apps' })).toBeNull();
    expect(channels()).not.toContain('local:api');
  });
});

describe('locked modules', () => {
  it('stay in the sidebar with a lock, and open the in-app sign-in panel', async () => {
    render(wrap(<><Sidebar /><SignInPanel /></>));
    const locked = screen.getByRole('list', { name: 'Needs a WorkSuite account' });
    const mail = within(locked).getByRole('button', { name: 'Mail (needs a WorkSuite account)' });
    for (const label of ['Chat', 'Drive & Files', 'Company records', 'Shared workspaces', 'HR & People', 'CRM & Sales', 'AI Assistant']) expect(within(locked).getByRole('button', { name: `${label} (needs a WorkSuite account)` })).toBeTruthy();
    fireEvent.click(mail);
    expect(await screen.findByText('Sign in to use Mail')).toBeTruthy();
    expect(tabsStore.get().tabs).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in / Create account' }));
    expect(app.get().session).toMatchObject({ mode: 'guest', signingIn: true });
    expect(screen.queryByText('Sign in to use Mail')).toBeNull();
  });

  it('cannot be reached by route or deep link: the guard opens the sign-in panel instead', () => {
    navigate('/mail?compose=1');
    expect(session.signInPanel.get().app).toBe('mail');
    expect(openTab('/office/12')).toBeNull();
    expect(session.signInPanel.get().app).toBe('files');
    expect(openTab('/home')).toBeNull();
    expect(tabsStore.get().tabs).toEqual([]);
    navigate('/notes');
    expect(tabsStore.get().tabs.map((t) => t.app)).toEqual(['notes']);
  });

  it('are found in ⌘K, which opens the sign-in panel rather than the app; account-only commands are not offered', async () => {
    render(wrap(<><SearchOverlay mode="palette" /><SignInPanel /></>));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '>mail' } });
    const item = await screen.findByRole('option', { name: /Mail/ });
    expect(item.textContent).toContain('Needs a WorkSuite account');
    fireEvent.click(item);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(session.signInPanel.get().app).toBe('mail'));
    expect(tabsStore.get().tabs).toEqual([]);
    fireEvent.change(input, { target: { value: '>my account' } });
    await waitFor(() => expect(screen.queryByRole('option', { name: /My account/ })).toBeNull());
  });
});

describe('the storage layer', () => {
  it('answers the module screens from this device in guest mode, never from a server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    api = (method, path) => ({ status: 200, data: method === 'GET' && path === '/api/notes' ? [{ id: 1, title: 'Local' }] : null, message: null });
    expect(await apiGet('/api/notes', { q: 'loc', archived: undefined })).toEqual([{ id: 1, title: 'Local' }]);
    expect(bridge.call).toHaveBeenCalledWith('local:api', { method: 'GET', path: '/api/notes', query: { q: 'loc' }, body: undefined });
    api = () => ({ status: 403, data: null, message: 'This needs a WorkSuite account. Sign in to use it.' });
    await expect(request('GET', '/api/mail/messages')).rejects.toMatchObject({ status: 403, message: 'This needs a WorkSuite account. Sign in to use it.' });
    await expect(request('POST', '/api/files', { body: new FormData() })).rejects.toBeInstanceOf(ApiError);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('creates tasks on this device at once, not through the offline queue', async () => {
    api = (method, path) => ({ status: 200, data: method === 'POST' && path === '/api/tasks' ? { id: 7 } : null, message: null });
    expect(await createTask({ title: 'Local task', due_date: '2026-11-01' })).toEqual({ queued: false, id: 7 });
    expect(channels()).not.toContain('offline:submit');
  });
});

describe('guest identity and settings', () => {
  it('shows “Name · Local profile · Saved on this device”, the online status, and the guest menu', () => {
    render(wrap(<GuestProfileMenu />));
    expect(screen.getByTestId('local-profile-chip').getAttribute('title')).toBe('Hasarinda · Local profile · Saved on this device');
    expect(screen.getByText(/Online · network available|Offline · local tools work/)).toBeTruthy();
    for (const name of ['Sign in / Create account', 'Backup & export data', 'Profile']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('keeps Backup & data and Profile in Settings, and hides what needs an account', async () => {
    render(wrap(<SettingsPage tabId="t" route="/settings/local-data" active />));
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Profile' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Backup & data' })).toBeTruthy();
    for (const name of ['Security', 'Devices', 'Files & Sync', 'Mail', 'AI Assistant', 'Monitoring']) expect(within(nav).queryByRole('button', { name })).toBeNull();
    expect(await screen.findByText('2 notes, 1 tasks, 3 contacts and 0 events on this device.')).toBeTruthy();
  });
});

describe('the note editor', () => {
  it('has a Save button in the normal primary style, enabled, that saves at once; sharing is not offered to a guest', async () => {
    const note = { id: 3, notebook_id: null, section_id: null, title: 'Ideas', excerpt: null, tags: [], color: null, is_pinned: false, is_favorite: false, is_archived: false, updated_at: '2026-10-02 09:00:00', body: '<p>Hi</p>', created_at: '2026-10-02 09:00:00', my_role: 'owner', shares: [] };
    api = (method) => ({ status: 200, data: method === 'GET' ? note : note, message: null });
    render(wrap(<NoteEditor id={3} notebooks={[]} sections={[]} onGone={vi.fn()} onOpen={vi.fn()} />));
    const save = (await screen.findByRole('button', { name: 'Save note' })) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(save.className).toContain('bg-primary');
    expect(save.className).toContain('text-white');
    expect(save.className).not.toMatch(/(^|\s)opacity-/);
    expect(screen.queryByRole('button', { name: /^Share/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Ideas 2' } });
    fireEvent.click(save);
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('local:api', expect.objectContaining({ method: 'PUT', path: '/api/notes/3', body: expect.objectContaining({ title: 'Ideas 2' }) })));
  });
});

describe('signing in from guest mode', () => {
  beforeEach(() => app.set({ auth: auth('ready'), session: { mode: 'account', signingIn: false, moveOffer: true }, local: null }));

  it('asks to move the local data; a partial failure names each item and Try again finishes it', async () => {
    let attempt = 0;
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'local:moveOffer') return { notes: 2, tasks: 1, contacts: 1, events: 1, total: 5 };
      if (channel === 'local:move') return ++attempt === 1 ? { moved: 4, failures: [{ kind: 'task', title: 'Pay rent', message: 'The server is busy.' }], remaining: 1, backupKept: true } : { moved: 1, failures: [], remaining: 0, backupKept: false };
      return undefined;
    });
    render(wrap(<MoveLocalData />));
    expect(await screen.findByText('Move your local notes, tasks, contacts and calendar events to your WorkSuite account?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move data' }));
    expect(await screen.findByText('Pay rent')).toBeTruthy();
    expect(screen.getByText('The server is busy.')).toBeTruthy();
    expect(screen.getByText(/a backup kept until your account confirms every item/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(app.get().session.moveOffer).toBe(false));
    expect(channels().filter((c) => c === 'local:move')).toHaveLength(2);
  });

  it('keeps the data on this device when asked to', async () => {
    bridge.call.mockImplementation(async (channel: string) => (channel === 'local:moveOffer' ? { notes: 1, tasks: 0, contacts: 0, events: 0, total: 1 } : undefined));
    render(wrap(<MoveLocalData />));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep on this device only' }));
    await waitFor(() => expect(channels()).toContain('local:keep'));
    expect(channels()).not.toContain('local:move');
    expect(app.get().session.moveOffer).toBe(false);
  });

  it('asks nothing when the main process offers no move (another window, another account, nothing left)', async () => {
    render(wrap(<MoveLocalData />));
    await waitFor(() => expect(app.get().session.moveOffer).toBe(false));
    expect(screen.queryByText(/Move your local/)).toBeNull();
  });
});

describe('guest mode and accounts never see each other’s data', () => {
  it('switches to the account’s full apps on sign-in, and back to nobody — not guest mode — on sign-out, clearing the cache each time', async () => {
    bridge.call.mockImplementation(async (channel: string) => {
      if (channel === 'app:info') return { platform: 'linux', version: '0.0.0' };
      if (channel === 'local:enter') return { profile: PROFILE, locked: false, language: 'en' };
      if (channel === 'auth:state') return auth('signed-out');
      if (channel === 'settings:get') return { preferences: PREFS, locks: [] };
      if (channel === 'session:bootstrap') return { user: { id: 'u1', timezone: 'UTC' }, organizations: [], apps: '*', permissions: ['*'] };
      return null;
    });
    app.set({ session: { mode: 'account', signingIn: false, moveOffer: false }, local: null, apps: [] });
    await initAppState();
    const off = session.wireSessionCache();
    await session.enterGuestMode();
    queryClient.setQueryData(['notes', 'list'], [{ title: 'Guest note' }]);
    await act(async () => bridge.handlers.get('auth:changed')!(auth('ready')));
    await waitFor(() => expect(app.get().apps.some((a) => a.id === 'mail')).toBe(true));
    expect(app.get().session).toEqual({ mode: 'account', signingIn: false, moveOffer: true });
    expect(queryClient.getQueryData(['notes', 'list'])).toBeUndefined();
    queryClient.setQueryData(['notes', 'list'], [{ title: 'Account note' }]);
    await act(async () => bridge.handlers.get('auth:changed')!(auth('signed-out')));
    expect(app.get().session.mode).toBe('account');
    expect(app.get().local).toBeNull();
    expect(app.get().apps).toEqual([]);
    expect(queryClient.getQueryData(['notes', 'list'])).toBeUndefined();
    off();
  });
});
