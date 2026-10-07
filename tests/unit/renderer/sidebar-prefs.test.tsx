// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUEST_APPS, visibleApps } from '@shared/apps';
import { applySidebarOp, type SidebarOp, type SidebarPrefRow, type SidebarPrefsData } from '@shared/sidebar-prefs';
import type * as CoreApi from '../../../src/core/api';

/**
 * Each person's own sidebar: the Pinned section, an item's menu (right-click, long press), removing and restoring,
 * dragging within a list, Settings › Sidebar, saving to `/api/sidebar/prefs` with the change taken back when that
 * fails, the older server's and guest mode's copy on this computer, and the launcher's old sidebar pins moving over.
 */

// jsdom has neither: the browser's own carry the pointer's type and where it is.
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? '';
    this.pointerId = init.pointerId ?? 1;
  }
}
class TestDragEvent extends MouseEvent {}
(window as unknown as { PointerEvent: unknown }).PointerEvent ??= TestPointerEvent;
(window as unknown as { DragEvent: unknown }).DragEvent ??= TestDragEvent;
Element.prototype.scrollIntoView ??= () => undefined;
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });

const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: api.get, apiPut: api.put, apiDelete: api.del }));
const tab = vi.hoisted(() => ({ path: ['settings', 'sidebar'] as string[] }));
vi.mock('../../../src/core/tab-context', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useTab: () => ({ navigate: vi.fn(), go: vi.fn(), query: new URLSearchParams(), path: tab.path, active: true }), useTabTitle: () => undefined }));

const { app } = await import('../../../src/core/app-state');
const { ApiError } = await import('../../../src/core/api');
const { toasts } = await import('../../../src/core/toasts');
const { resetTabs, tabsStore } = await import('../../../src/core/tabs');
const { openOverlay } = await import('../../../src/core/ui');
const { initSidebarPrefs, resetSidebar, resetSidebarPrefsForTests, sidebarPrefs, syncSidebarPrefs } = await import('../../../src/core/sidebar-prefs');
const { Sidebar, LONG_PRESS_MS } = await import('../../../src/layouts/Sidebar');
const { SIDEBAR_MENU_WIDTH } = await import('../../../src/layouts/SidebarMenu');
const { SidebarSettings } = await import('../../../src/modules/settings/SidebarSettings');
const SettingsPage = (await import('../../../src/modules/settings/SettingsPage')).default;
const { Launcher } = await import('../../../src/app/overlays/Launcher');

const PATH = '/api/sidebar/prefs';
const SERVER = 'https://ws.example.test';
const ALL = ['mail', 'chat', 'tasks', 'calendar', 'crm', 'billing', 'projects'];
const PERMS = ['crm.view', 'billing.view'];

/** The server, as the contract says it behaves: the whole state in every answer, one per organisation (`?org=`). */
let state: SidebarPrefsData;
let orgStates: Record<string, SidebarPrefsData>;
let missing = false;
let failWith: Error | null = null;
let stop: (() => void) | null = null;

const row = (key: string, patch: Partial<SidebarPrefRow> = {}): SidebarPrefRow => ({ key, parent: null, pinned: false, hidden: false, position: null, pinned_position: null, section: null, ...patch });
const notFound = () => new ApiError(404, 'Not found', null);

/** The path without its query, and the organisation it names. */
function split(path: string): { base: string; org: string | null } {
  const [base, qs] = path.split('?');
  return { base: base!, org: new URLSearchParams(qs ?? '').get('org') };
}
const stateOf = (org: string | null) => (org ? (orgStates[org] ??= { items: [], updated_at: null }) : state);
function save(org: string | null, d: SidebarPrefsData) {
  if (org) orgStates[org] = d;
  else state = d;
  return structuredClone(d);
}

function opOf(path: string, body: Record<string, unknown>): SidebarOp {
  if (path === `${PATH}/pin`) return { kind: 'pin', key: String(body.key), pinned: !!body.pinned };
  if (path === `${PATH}/hide`) return { kind: 'hide', key: String(body.key), hidden: !!body.hidden };
  if (path === `${PATH}/order`) return { kind: 'order', body: body as never };
  throw new Error(`unexpected ${path}`);
}

function signIn(apps = ALL, perms = PERMS, patch: Record<string, unknown> = {}) {
  app.set({
    ready: true,
    auth: { stage: 'ready', user: { id: '7', name: 'Asha' }, server: { origin: SERVER } } as never,
    session: { mode: 'account', signingIn: false, moveOffer: false },
    apps: visibleApps({ apps, permissions: perms }),
    prefs: { sidebarMode: 'expanded', pinnedApps: [], shortcuts: {}, language: 'en' } as never,
    status: null,
    organizationId: null,
    bootstrap: null,
    local: null,
    ...patch,
  } as never);
}

const wrap = (node: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;

/** Takes up the person's sidebar as the shell does, and waits for the server's answer (and any move of old pins). */
async function start() {
  stop = initSidebarPrefs();
  await act(async () => {
    await syncSidebarPrefs();
  });
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

const keysIn = (list: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-list="${list}"] li[data-key]`)).map((li) => li.dataset.key!);
const itemButton = (key: string) => document.querySelector<HTMLElement>(`li[data-key="${key}"] > button`)!;
const menu = () => screen.queryByRole('menu');
const errors = () => toasts.get().items.filter((x) => x.kind === 'error').map((x) => x.text);
const puts = () => api.put.mock.calls.map(([path, body]) => [path, body]);
const rightClick = (key: string, x = 40, y = 120) => fireEvent.contextMenu(itemButton(key), { clientX: x, clientY: y });
const choose = (label: string) => fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }));

function dataTransfer() {
  const data = new Map<string, string>();
  return { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '', types: [] as string[] };
}
/** Drags `from` onto `to`, over its top half (`before`) or its bottom half; jsdom's boxes are 0×0, so y −1 is above the middle. */
function dragTo(from: string, to: string, place: 'before' | 'after') {
  const dt = dataTransfer();
  fireEvent.dragStart(itemButton(from), { dataTransfer: dt });
  const over = fireEvent.dragOver(itemButton(to), { dataTransfer: dt, clientY: place === 'before' ? -1 : 1 });
  const indicator = document.querySelector<HTMLElement>(`li[data-key="${to}"] [data-drop-indicator]`)?.dataset.dropIndicator ?? null;
  fireEvent.drop(itemButton(to), { dataTransfer: dt, clientY: place === 'before' ? -1 : 1 });
  fireEvent.dragEnd(itemButton(from), { dataTransfer: dt });
  // fireEvent answers false when the handler took the event (preventDefault): the drop is allowed.
  return { allowed: !over, indicator };
}

beforeEach(() => {
  localStorage.clear();
  resetSidebarPrefsForTests();
  resetTabs();
  toasts.set({ items: [] });
  state = { items: [], updated_at: null };
  orgStates = {};
  missing = false;
  failWith = null;
  tab.path = ['settings', 'sidebar'];
  bridge.call.mockReset();
  bridge.call.mockImplementation(async () => undefined);
  api.get.mockReset();
  api.put.mockReset();
  api.del.mockReset();
  api.get.mockImplementation(async (path: string) => {
    const { base, org } = split(path);
    if (base !== PATH) return { prefs: null };
    if (missing) throw notFound();
    return structuredClone(stateOf(org));
  });
  api.put.mockImplementation(async (path: string, body: Record<string, unknown>) => {
    const { base, org } = split(path);
    if (!base.startsWith(PATH)) return {};
    if (missing) throw notFound();
    if (failWith) throw failWith;
    return save(org, applySidebarOp(stateOf(org), opOf(base, body), '2026-10-07T09:00:00+00:00'));
  });
  api.del.mockImplementation(async (path: string) => {
    if (missing) throw notFound();
    if (failWith) throw failWith;
    return save(split(path).org, { items: [], updated_at: '2026-10-07T09:00:00+00:00' });
  });
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  signIn();
});
afterEach(() => {
  cleanup();
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('the Pinned section', () => {
  it('is not there while nothing is pinned', async () => {
    await start();
    render(wrap(<Sidebar />));
    expect(screen.queryByRole('list', { name: 'Pinned' })).toBeNull();
    expect(document.querySelector('[data-pinned-divider]')).toBeNull();
    expect(keysIn('work')).toEqual(['home', 'mail', 'chat', 'phone', 'calendar', 'tasks']);
  });

  it('shows the person’s pinned apps first, in their order, under a pin', async () => {
    state = { items: [row('crm', { pinned: true, pinned_position: 1 }), row('chat', { pinned: true, pinned_position: 0 })], updated_at: 'then' };
    await start();
    render(wrap(<Sidebar />));
    const pinned = screen.getByRole('list', { name: 'Pinned' });
    expect(keysIn('pinned')).toEqual(['chat', 'crm']);
    expect(within(pinned).getByRole('button', { name: /^Chat/ })).toBeTruthy();
    expect(keysIn('work')).not.toContain('chat');
    expect(keysIn('business')).not.toContain('crm');
    // Its heading, with the pin, above it.
    expect(screen.getByText('Pinned')).toBeTruthy();
  });

  it('draws the copy on this computer at once, before the server answers', async () => {
    localStorage.setItem(`ws.sidebar.7@${SERVER}#all`, JSON.stringify({ source: 'server', data: { items: [row('tasks', { pinned: true, pinned_position: 0 })], updated_at: 'then' } }));
    api.get.mockImplementation(() => new Promise(() => undefined));
    stop = initSidebarPrefs();
    render(wrap(<Sidebar />));
    expect(keysIn('pinned')).toEqual(['tasks']);
  });

  it('works collapsed: no heading, a thin divider, and a small pin on each icon', async () => {
    state = { items: [row('mail', { pinned: true, pinned_position: 0 })], updated_at: 'then' };
    app.set({ prefs: { ...app.get().prefs!, sidebarMode: 'collapsed' } });
    await start();
    render(wrap(<Sidebar />));
    expect(screen.getByRole('navigation', { name: 'Apps' }).className).toContain('w-[64px]');
    expect(screen.queryByText('Pinned')).toBeNull();
    expect(document.querySelector('[data-pinned-divider]')).toBeTruthy();
    expect(itemButton('mail').querySelector('[data-pin-marker]')).toBeTruthy();
    expect(itemButton('chat').querySelector('[data-pin-marker]')).toBeNull();
    expect(itemButton('mail').title).toBe('Mail');
    // The menu works collapsed too.
    rightClick('mail');
    expect(within(menu()!).getByRole('menuitem', { name: 'Unpin' })).toBeTruthy();
  });

  it('keeps auto-hide open while an item’s menu is', async () => {
    app.set({ prefs: { ...app.get().prefs!, sidebarMode: 'auto-hide' } });
    await start();
    render(wrap(<Sidebar />));
    const nav = screen.getByRole('navigation', { name: 'Apps' });
    expect(nav.className).toContain('w-[64px]');
    rightClick('mail');
    expect(nav.className).toContain('w-[220px]');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(nav.className).toContain('w-[64px]');
  });
});

describe('an item’s menu', () => {
  it('opens on right-click with Pin, Remove from sidebar and Customize sidebar', async () => {
    await start();
    render(wrap(<Sidebar />));
    rightClick('mail');
    const m = screen.getByRole('menu', { name: 'Mail options' });
    expect(within(m).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Pin', 'Remove from sidebar', 'Customize sidebar']);
    expect(document.activeElement).toBe(within(m).getByRole('menuitem', { name: 'Pin' }));
  });

  it('closes on Esc, an outside click, scrolling, and after an action', async () => {
    await start();
    render(wrap(<Sidebar />));
    rightClick('mail');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(itemButton('mail'));

    rightClick('mail');
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();

    rightClick('mail');
    fireEvent.scroll(document.querySelector('nav [class*="overflow-y-auto"]')!);
    expect(menu()).toBeNull();

    rightClick('mail');
    fireEvent.mouseDown(within(menu()!).getByRole('menuitem', { name: 'Pin' }));
    expect(menu()).toBeTruthy();
    choose('Pin');
    expect(menu()).toBeNull();
  });

  it('stays inside the window', async () => {
    await start();
    render(wrap(<Sidebar />));
    rightClick('mail', 1270, 790);
    const m = menu()!;
    // Three actions and a separator, in its padding: moved back left and up, 8px clear of the window's edges.
    expect(m.style.left).toBe(`${1280 - SIDEBAR_MENU_WIDTH - 8}px`);
    expect(m.style.top).toBe(`${800 - 8 - (12 + 3 * 34 + 9)}px`);
    fireEvent.keyDown(window, { key: 'Escape' });
    rightClick('mail', -20, -20);
    expect(menu()!.style.left).toBe('8px');
    expect(menu()!.style.top).toBe('8px');
  });

  it('opens on a long press on a touch screen, without opening the app; a short tap or a moved finger does not', async () => {
    await start();
    render(wrap(<Sidebar />));
    vi.useFakeTimers();
    const mail = itemButton('mail');
    fireEvent.pointerDown(mail, { pointerType: 'touch', clientX: 30, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    });
    expect(menu()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole('menu', { name: 'Mail options' })).toBeTruthy();
    fireEvent.pointerUp(mail, { pointerType: 'touch' });
    fireEvent.click(mail);
    expect(tabsStore.get().tabs.some((t) => t.app === 'mail')).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });

    // A tap: no menu, the app opens.
    fireEvent.pointerDown(mail, { pointerType: 'touch', clientX: 30, clientY: 100 });
    fireEvent.pointerUp(mail, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(menu()).toBeNull();
    fireEvent.click(mail);
    expect(tabsStore.get().tabs.some((t) => t.app === 'mail')).toBe(true);

    // A finger that moves (scrolling the sidebar): no menu.
    fireEvent.pointerDown(mail, { pointerType: 'touch', clientX: 30, clientY: 100 });
    fireEvent.pointerMove(mail, { pointerType: 'touch', clientX: 30, clientY: 140 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(menu()).toBeNull();
    // A mouse held down is a click, not a long press.
    fireEvent.pointerDown(mail, { pointerType: 'mouse', clientX: 30, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(menu()).toBeNull();
  });

  it('pins: PUT …/pin, and the app moves to Pinned', async () => {
    await start();
    render(wrap(<Sidebar />));
    rightClick('crm');
    choose('Pin');
    expect(keysIn('pinned')).toEqual(['crm']);
    expect(keysIn('business')).not.toContain('crm');
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/pin`, { key: 'crm', pinned: true }]]));
    await settle();
    expect(sidebarPrefs.get().confirmed.items).toEqual([row('crm', { pinned: true, pinned_position: 0 })]);
    expect(errors()).toEqual([]);
  });

  it('unpins a pinned app back to its own place', async () => {
    state = { items: [row('calendar', { pinned: true, pinned_position: 0 })], updated_at: 'then' };
    await start();
    render(wrap(<Sidebar />));
    rightClick('calendar');
    choose('Unpin');
    expect(screen.queryByRole('list', { name: 'Pinned' })).toBeNull();
    expect(keysIn('work')).toEqual(['home', 'mail', 'chat', 'phone', 'calendar', 'tasks']);
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/pin`, { key: 'calendar', pinned: false }]]));
  });

  it('removes from the sidebar: PUT …/hide, for this person only — the app still opens', async () => {
    await start();
    render(wrap(<Sidebar />));
    rightClick('chat');
    choose('Remove from sidebar');
    expect(keysIn('work')).not.toContain('chat');
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/hide`, { key: 'chat', hidden: true }]]));
    await settle();
    expect(app.get().apps.some((a) => a.id === 'chat')).toBe(true);
    const info = toasts.get().items.find((x) => x.kind === 'info')!;
    expect(info.text).toBe('Chat is no longer in your sidebar. It still opens from the launcher.');
    // Undo brings it back.
    act(() => info.action!.run());
    await waitFor(() => expect(puts().at(-1)).toEqual([`${PATH}/hide`, { key: 'chat', hidden: false }]));
    expect(keysIn('work')).toContain('chat');
  });

  it('removes a pinned browser app by unpinning it: it is in the sidebar only while pinned', async () => {
    state = { items: [row('projects', { pinned: true, pinned_position: 0 })], updated_at: 'then' };
    await start();
    render(wrap(<Sidebar />));
    expect(keysIn('pinned')).toEqual(['projects']);
    rightClick('projects');
    choose('Remove from sidebar');
    expect(keysIn('pinned')).toEqual([]);
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/pin`, { key: 'projects', pinned: false }]]));
  });

  it('opens Settings › Sidebar from Customize sidebar, as the footer does', async () => {
    await start();
    render(wrap(<Sidebar />));
    rightClick('mail');
    choose('Customize sidebar');
    expect(tabsStore.get().tabs.some((t) => t.route === '/settings/sidebar')).toBe(true);
    resetTabs();
    fireEvent.click(screen.getByRole('button', { name: 'Customize sidebar' }));
    expect(tabsStore.get().tabs.some((t) => t.route === '/settings/sidebar')).toBe(true);
  });

  it('is not offered on More apps or Settings', async () => {
    await start();
    render(wrap(<Sidebar />));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'More apps' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Settings' }));
    expect(menu()).toBeNull();
  });
});

describe('a change the server refuses', () => {
  it('is taken back off the screen, and an error says so', async () => {
    await start();
    render(wrap(<Sidebar />));
    failWith = new ApiError(500, 'Server error', null);
    rightClick('crm');
    choose('Pin');
    expect(keysIn('pinned')).toEqual(['crm']);
    await waitFor(() => expect(keysIn('pinned')).toEqual([]));
    expect(keysIn('business')).toContain('crm');
    expect(errors()).toEqual(["Couldn't save your sidebar. Your change was undone."]);
  });

  it('cannot reach it either: the same', async () => {
    await start();
    render(wrap(<Sidebar />));
    failWith = new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'INTERNAL');
    rightClick('chat');
    choose('Remove from sidebar');
    expect(keysIn('work')).not.toContain('chat');
    await waitFor(() => expect(keysIn('work')).toContain('chat'));
    expect(errors()).toHaveLength(1);
  });

  it('a transaction the server could not finish (409) is taken back too', async () => {
    await start();
    render(wrap(<Sidebar />));
    failWith = new ApiError(409, 'That order could not be saved. Try again.', null);
    dragTo('crm', 'billing', 'after');
    await waitFor(() => expect(keysIn('business').slice(0, 2)).toEqual(['crm', 'billing']));
    expect(errors()).toHaveLength(1);
  });

  it('offline (the desktop’s own 503): taken back, not kept here', async () => {
    await start();
    render(wrap(<Sidebar />));
    failWith = new ApiError(503, 'WorkSuite is offline.', 'NETWORK_UNREACHABLE');
    rightClick('crm');
    choose('Pin');
    await waitFor(() => expect(keysIn('pinned')).toEqual([]));
    expect(sidebarPrefs.get().source).toBe('server');
    expect(errors()).toHaveLength(1);
  });

  it('a reorder that fails goes back to the order before', async () => {
    await start();
    render(wrap(<Sidebar />));
    failWith = new ApiError(422, 'No', null);
    dragTo('tasks', 'home', 'before');
    expect(keysIn('work')[0]).toBe('tasks');
    await waitFor(() => expect(keysIn('work')).toEqual(['home', 'mail', 'chat', 'phone', 'calendar', 'tasks']));
    expect(errors()).toHaveLength(1);
  });
});

describe('dragging', () => {
  it('reorders a section, with a line where it will go, and saves the section’s whole order on drop', async () => {
    await start();
    render(wrap(<Sidebar />));
    const { allowed, indicator } = dragTo('tasks', 'mail', 'before');
    expect(allowed).toBe(true);
    expect(indicator).toBe('before');
    expect(keysIn('work')).toEqual(['home', 'tasks', 'mail', 'chat', 'phone', 'calendar']);
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/order`, { scope: 'section', section: 'work', keys: ['home', 'tasks', 'mail', 'chat', 'phone', 'calendar'] }]]));
    expect(document.querySelector('[data-drop-indicator]')).toBeNull();
  });

  it('reorders the business section on its own', async () => {
    await start();
    render(wrap(<Sidebar />));
    const before = keysIn('business');
    expect(before.slice(0, 2)).toEqual(['crm', 'billing']);
    dragTo('crm', 'billing', 'after');
    const after = ['billing', 'crm', ...before.slice(2)];
    expect(keysIn('business')).toEqual(after);
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/order`, { scope: 'section', section: 'business', keys: after }]]));
  });

  it('reorders Pinned within Pinned', async () => {
    state = { items: [row('mail', { pinned: true, pinned_position: 0 }), row('crm', { pinned: true, pinned_position: 1 }), row('projects', { pinned: true, pinned_position: 2 })], updated_at: 'then' };
    await start();
    render(wrap(<Sidebar />));
    dragTo('projects', 'mail', 'before');
    expect(keysIn('pinned')).toEqual(['projects', 'mail', 'crm']);
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/order`, { scope: 'pinned', keys: ['projects', 'mail', 'crm'] }]]));
  });

  it('refuses a drop into another list: no line, nothing sent', async () => {
    state = { items: [row('mail', { pinned: true, pinned_position: 0 })], updated_at: 'then' };
    await start();
    render(wrap(<Sidebar />));
    const across = dragTo('tasks', 'crm', 'before');
    expect(across).toEqual({ allowed: false, indicator: null });
    const intoPinned = dragTo('chat', 'mail', 'after');
    expect(intoPinned).toEqual({ allowed: false, indicator: null });
    const outOfPinned = dragTo('mail', 'home', 'before');
    expect(outOfPinned.allowed).toBe(false);
    await settle();
    expect(api.put).not.toHaveBeenCalled();
    expect(keysIn('work')).toContain('tasks');
    expect(keysIn('pinned')).toEqual(['mail']);
  });

  it('sends nothing when an item is dropped where it was', async () => {
    await start();
    render(wrap(<Sidebar />));
    dragTo('mail', 'chat', 'before');
    dragTo('mail', 'mail', 'after');
    await settle();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('moves with Alt+↑↓ from the keyboard too', async () => {
    await start();
    render(wrap(<Sidebar />));
    fireEvent.keyDown(itemButton('home'), { key: 'ArrowDown', altKey: true });
    expect(keysIn('work').slice(0, 2)).toEqual(['mail', 'home']);
    fireEvent.keyDown(itemButton('home'), { key: 'ArrowDown' });
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/order`, { scope: 'section', section: 'work', keys: ['mail', 'home', 'chat', 'phone', 'calendar', 'tasks'] }]]));
  });
});

describe('what the preferences may not do', () => {
  it('never draws an app the person cannot open, whatever was saved', async () => {
    state = { items: [row('finance', { pinned: true, pinned_position: 0 }), row('admin', { pinned: true, pinned_position: 1 }), row('crm', { position: 0 }), row('payroll', { position: 1 })], updated_at: 'then' };
    signIn(['mail', 'chat', 'tasks', 'calendar', 'billing'], ['billing.view']);
    await start();
    render(wrap(<Sidebar />));
    const shown = [...keysIn('pinned'), ...keysIn('work'), ...keysIn('business')];
    for (const id of ['finance', 'admin', 'crm', 'payroll']) expect(shown).not.toContain(id);
    expect(screen.queryByRole('list', { name: 'Pinned' })).toBeNull();
  });

  it('does not use a position saved in another section (the web’s blocks are not the desktop’s)', async () => {
    state = { items: [row('crm', { position: 3, section: 'core' }), row('billing', { position: 0, section: 'business' }), row('hr', { position: 1, section: 'business' })], updated_at: 'then' };
    await start();
    render(wrap(<Sidebar />));
    expect(keysIn('business').slice(0, 3)).toEqual(['crm', 'billing', 'hr']);
  });

  it('shows an app newly given to the person in its default place, among their saved order', async () => {
    // Saved while the person had Billing and not CRM.
    state = { items: [row('billing', { position: 0 }), row('hr', { position: 1 })], updated_at: 'then' };
    signIn(['mail', 'billing'], ['billing.view']);
    await start();
    const { unmount } = render(wrap(<Sidebar />));
    expect(keysIn('business').slice(0, 2)).toEqual(['billing', 'hr']);
    unmount();
    act(() => signIn(['mail', 'billing', 'crm'], ['billing.view', 'crm.view']));
    render(wrap(<Sidebar />));
    // CRM is first by default: first.
    expect(keysIn('business').slice(0, 3)).toEqual(['crm', 'billing', 'hr']);
  });
});

describe('Settings › Sidebar', () => {
  it('is in Settings, beside App launcher', async () => {
    await start();
    render(wrap(<SettingsPage tabId="t" route="/settings/sidebar" active />));
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const names = within(nav).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(names[names.indexOf('App launcher') + 1]).toBe('Sidebar');
    expect(screen.getByRole('heading', { name: 'Sidebar' })).toBeTruthy();
  });

  it('lists the apps removed from the sidebar, and restores one', async () => {
    state = { items: [row('chat', { hidden: true }), row('crm', { hidden: true }), row('finance', { hidden: true })], updated_at: 'then' };
    await start();
    render(wrap(<><Sidebar /><SidebarSettings /></>));
    const removed = screen.getByRole('list', { name: 'Removed from the sidebar' });
    expect(within(removed).getAllByRole('listitem').map((li) => li.textContent?.replace('Restore', ''))).toEqual(['Chat', 'CRM']);
    expect(keysIn('work')).not.toContain('chat');
    fireEvent.click(within(removed).getAllByRole('button', { name: 'Restore' })[0]!);
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/hide`, { key: 'chat', hidden: false }]]));
    expect(keysIn('work')).toContain('chat');
    expect(within(screen.getByRole('list', { name: 'Removed from the sidebar' })).getAllByRole('listitem')).toHaveLength(1);
    await waitFor(() => expect(toasts.get().items.some((x) => x.text === 'Chat is back in your sidebar.')).toBe(true));
  });

  it('says when nothing is removed or pinned', async () => {
    await start();
    render(wrap(<SidebarSettings />));
    expect(screen.getByText('Nothing removed. Right-click an app in the sidebar and choose Remove from sidebar.')).toBeTruthy();
    expect(screen.getByText('Nothing pinned. Right-click an app in the sidebar and choose Pin.')).toBeTruthy();
    expect(screen.getByText('Saved to your account for this organization.')).toBeTruthy();
  });

  it('resets to default after asking: DELETE, and the default sidebar', async () => {
    state = { items: [row('chat', { hidden: true }), row('crm', { pinned: true, pinned_position: 0 }), row('tasks', { position: 0 })], updated_at: 'then' };
    await start();
    render(wrap(<><Sidebar /><SidebarSettings /></>));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Pinned apps, removed apps and your order go back to the defaults.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset to default' }));
    expect(keysIn('pinned')).toEqual([]);
    expect(keysIn('work')).toEqual(['home', 'mail', 'chat', 'phone', 'calendar', 'tasks']);
    await waitFor(() => expect(api.del).toHaveBeenCalledWith(PATH));
    await waitFor(() => expect(toasts.get().items.some((x) => x.text === 'Your sidebar is back to its defaults.')).toBe(true));
  });

  it('unpins from its Pinned list', async () => {
    state = { items: [row('crm', { pinned: true, pinned_position: 0 })], updated_at: 'then' };
    await start();
    render(wrap(<SidebarSettings />));
    fireEvent.click(within(screen.getByRole('list', { name: 'Pinned' })).getByRole('button', { name: 'Unpin' }));
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/pin`, { key: 'crm', pinned: false }]]));
  });
});

describe('an older server, without /api/sidebar/prefs', () => {
  it('keeps the sidebar on this computer, per person, server and organisation, and still works', async () => {
    missing = true;
    await start();
    expect(sidebarPrefs.get().source).toBe('local');
    render(wrap(<><Sidebar /><SidebarSettings /></>));
    rightClick('crm');
    choose('Pin');
    rightClick('chat');
    choose('Remove from sidebar');
    dragTo('tasks', 'home', 'before');
    expect(keysIn('pinned')).toEqual(['crm']);
    expect(keysIn('work')).toEqual(['tasks', 'home', 'mail', 'phone', 'calendar']);
    await settle();
    expect(api.put).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
    expect(screen.getByText('Saved on this computer.')).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem(`ws.sidebar.7@${SERVER}#all`)!);
    expect(saved.source).toBe('local');
    expect(saved.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'crm', pinned: true }), expect.objectContaining({ key: 'chat', hidden: true })]));

    // The next start: the same sidebar, from this computer.
    cleanup();
    resetSidebarPrefsForTests();
    stop?.();
    await start();
    render(wrap(<Sidebar />));
    expect(keysIn('pinned')).toEqual(['crm']);
    expect(keysIn('work')).not.toContain('chat');
  });

  it('a server whose tables are not made yet (its own 503 on a change): kept here, quietly', async () => {
    await start();
    expect(sidebarPrefs.get().source).toBe('server');
    render(wrap(<Sidebar />));
    failWith = new ApiError(503, 'Sidebar preferences are not set up on this server yet.', null);
    rightClick('crm');
    choose('Pin');
    await settle();
    expect(keysIn('pinned')).toEqual(['crm']);
    expect(sidebarPrefs.get().source).toBe('local');
    expect(errors()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(`ws.sidebar.7@${SERVER}#all`)!).source).toBe('local');
    // And reading it answers 503 too: the same.
    cleanup();
    stop?.();
    resetSidebarPrefsForTests();
    api.get.mockImplementation(async () => {
      throw new ApiError(503, 'Not set up yet.', null);
    });
    await start();
    expect(sidebarPrefs.get().source).toBe('local');
    render(wrap(<Sidebar />));
    expect(keysIn('pinned')).toEqual(['crm']);
  });

  it('a change made before the server answered, refused with 404, is kept here instead of failing', async () => {
    missing = true;
    api.get.mockImplementation(() => new Promise(() => undefined));
    stop = initSidebarPrefs();
    render(wrap(<Sidebar />));
    rightClick('crm');
    choose('Pin');
    await settle();
    expect(keysIn('pinned')).toEqual(['crm']);
    expect(sidebarPrefs.get().source).toBe('local');
    expect(errors()).toEqual([]);
  });
});

describe('the person, server and organisation', () => {
  it('names the organisation open now in every call, reads again when it changes, and keeps each one’s apart', async () => {
    state = { items: [row('mail', { pinned: true, pinned_position: 0 })], updated_at: 'then' };
    await start();
    render(wrap(<Sidebar />));
    expect(keysIn('pinned')).toEqual(['mail']);
    // All organizations: no `org`.
    expect(api.get.mock.calls.map(([p]) => p)).toEqual([PATH]);
    await act(async () => {
      app.set({ organizationId: '2' });
      await syncSidebarPrefs();
    });
    expect(api.get.mock.calls.map(([p]) => p)).toEqual([PATH, `${PATH}?org=2`]);
    expect(keysIn('pinned')).toEqual([]);
    rightClick('crm');
    choose('Pin');
    rightClick('chat');
    choose('Remove from sidebar');
    dragTo('tasks', 'home', 'before');
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(3));
    expect(puts().map(([p]) => p)).toEqual([`${PATH}/pin?org=2`, `${PATH}/hide?org=2`, `${PATH}/order?org=2`]);
    expect(orgStates['2']!.items.map((r) => r.key)).toEqual(['crm', 'chat', 'tasks', 'home', 'mail', 'phone', 'calendar']);
    expect(state.items).toEqual([row('mail', { pinned: true, pinned_position: 0 })]);
    // Reset is the organisation's too.
    await act(async () => {
      await resetSidebar();
    });
    expect(api.del).toHaveBeenCalledWith(`${PATH}?org=2`);
    expect(localStorage.getItem(`ws.sidebar.7@${SERVER}#all`)).toContain('"mail"');
    expect(localStorage.getItem(`ws.sidebar.7@${SERVER}#2`)).not.toContain('"mail"');
    // Back to All organizations: that sidebar again.
    await act(async () => {
      app.set({ organizationId: null });
      await syncSidebarPrefs();
    });
    expect(keysIn('pinned')).toEqual(['mail']);
  });

  it('guest mode keeps the sidebar on this computer: nothing is sent', async () => {
    app.set({ session: { mode: 'guest', signingIn: false, moveOffer: false }, auth: { stage: 'signed-out', user: null, server: null } as never, apps: GUEST_APPS });
    await start();
    render(wrap(<Sidebar />));
    expect(keysIn('work')).toEqual(GUEST_APPS.map((a) => a.id));
    rightClick('tasks');
    choose('Pin');
    expect(keysIn('pinned')).toEqual(['tasks']);
    await settle();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('ws.sidebar.guest')!).source).toBe('local');
    // The locked apps have no menu.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Mail (needs a WorkSuite account)' }));
    expect(menu()).toBeNull();
  });
});

describe('the launcher’s sidebar pins from before', () => {
  it('are pinned, in order, the first time the server has no rows — and once only', async () => {
    app.set({ prefs: { ...app.get().prefs!, pinnedApps: ['projects', 'whatsapp', 'nope', 'crm'] } });
    await start();
    await waitFor(() => expect(puts()).toEqual([
      [`${PATH}/pin`, { key: 'projects', pinned: true }],
      [`${PATH}/pin`, { key: 'whatsapp', pinned: true }],
      [`${PATH}/pin`, { key: 'crm', pinned: true }],
    ]));
    render(wrap(<Sidebar />));
    // WhatsApp is not the person's (they have Chat): never drawn.
    expect(keysIn('pinned')).toEqual(['projects', 'crm']);

    // Unpinned everything and reset since: not moved again.
    state = { items: [], updated_at: 'now' };
    cleanup();
    stop?.();
    resetSidebarPrefsForTests();
    api.put.mockClear();
    await start();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('are not moved when the person already has preferences', async () => {
    state = { items: [row('mail', { hidden: true })], updated_at: 'then' };
    app.set({ prefs: { ...app.get().prefs!, pinnedApps: ['projects'] } });
    await start();
    await settle();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('are kept on this computer with an older server', async () => {
    missing = true;
    app.set({ prefs: { ...app.get().prefs!, pinnedApps: ['projects'] } });
    await start();
    render(wrap(<Sidebar />));
    expect(keysIn('pinned')).toEqual(['projects']);
    expect(api.put).toHaveBeenCalledTimes(0);
  });

  it('kept here while the server is not ready (503), and moved to it once it is', async () => {
    app.set({ prefs: { ...app.get().prefs!, pinnedApps: ['projects'] } });
    failWith = new ApiError(503, 'Not set up yet.', null);
    await start();
    expect(sidebarPrefs.get().source).toBe('local');
    expect(sidebarPrefs.get().data.items).toEqual([row('projects', { pinned: true, pinned_position: 0 })]);
    // The next start, the server ready and still empty: the pins go to it, once.
    failWith = null;
    stop?.();
    resetSidebarPrefsForTests();
    api.put.mockClear();
    await start();
    expect(sidebarPrefs.get().source).toBe('server');
    expect(puts()).toEqual([[`${PATH}/pin`, { key: 'projects', pinned: true }]]);
  });

  it('the launcher’s Pin to the sidebar is the sidebar’s Pin now', async () => {
    await start();
    openOverlay('launcher');
    render(wrap(<><Sidebar /><Launcher /></>));
    const grid = screen.getByRole('listbox', { name: 'Apps' });
    fireEvent.contextMenu(within(grid).getByRole('option', { name: 'Projects' }), { clientX: 10, clientY: 10 });
    fireEvent.click(within(screen.getByRole('menu', { name: 'Projects options' })).getByText('Pin to the sidebar'));
    expect(keysIn('pinned')).toEqual(['projects']);
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/pin`, { key: 'projects', pinned: true }]]));
    expect(bridge.call.mock.calls.some(([channel]) => channel === 'settings:set')).toBe(false);
    fireEvent.contextMenu(within(grid).getByRole('option', { name: 'Projects' }), { clientX: 10, clientY: 10 });
    fireEvent.click(within(screen.getByRole('menu', { name: 'Projects options' })).getByText('Unpin from the sidebar'));
    expect(keysIn('pinned')).toEqual([]);
    await waitFor(() => expect(puts().at(-1)).toEqual([`${PATH}/pin`, { key: 'projects', pinned: false }]));
  });

  it('pinning an app removed from the sidebar shows it again: one pin, as the server un-hides on pin', async () => {
    state = { items: [row('crm', { hidden: true })], updated_at: 'then' };
    await start();
    openOverlay('launcher');
    render(wrap(<><Sidebar /><Launcher /></>));
    fireEvent.contextMenu(within(screen.getByRole('listbox', { name: 'Apps' })).getByRole('option', { name: 'CRM' }), { clientX: 10, clientY: 10 });
    fireEvent.click(within(screen.getByRole('menu', { name: 'CRM options' })).getByText('Pin to the sidebar'));
    expect(keysIn('pinned')).toEqual(['crm']);
    await waitFor(() => expect(puts()).toEqual([[`${PATH}/pin`, { key: 'crm', pinned: true }]]));
    await settle();
    expect(sidebarPrefs.get().confirmed.items).toEqual([row('crm', { pinned: true, pinned_position: 0 })]);
  });
});
