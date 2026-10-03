// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: (...a: unknown[]) => apiGet(...a), apiPut: (...a: unknown[]) => apiPut(...a) }));
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });

const { app } = await import('../../../src/core/app-state');
const prefs = await import('../../../src/core/launcher-prefs');
const { commandForAccelerator } = await import('../../../src/core/commands');
const { pinApp } = await import('@shared/launcher');

const signIn = (id: string) => app.set({ auth: { stage: 'ready', user: { id } } as never, session: { mode: 'account', signingIn: false, moveOffer: false } });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  apiGet.mockReset();
  apiPut.mockReset();
  apiPut.mockResolvedValue({});
  prefs.resetLauncherPrefsForTests();
  app.set({ bootstrap: null });
  signIn('7');
});
afterEach(() => vi.useRealTimers());

describe('launcher preferences: this computer\'s copy', () => {
  it('opens with the copy kept here, before the server answers', () => {
    localStorage.setItem('ws.launcher.7', JSON.stringify({ prefs: { size: 'large', pinned: ['mail'], updatedAt: 5 }, dirty: false }));
    expect(prefs.currentLauncherPrefs()).toMatchObject({ size: 'large', pinned: ['mail'] });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('keeps each person\'s apart', () => {
    localStorage.setItem('ws.launcher.7', JSON.stringify({ prefs: { size: 'large' } }));
    localStorage.setItem('ws.launcher.8', JSON.stringify({ prefs: { size: 'comfortable' } }));
    expect(prefs.currentLauncherPrefs().size).toBe('large');
    signIn('8');
    expect(prefs.currentLauncherPrefs().size).toBe('comfortable');
  });

  it('saves here at once, marked unsent, and on the server a moment later', async () => {
    prefs.updateLauncherPrefs((p) => ({ ...p, size: 'comfortable' }));
    const kept = JSON.parse(localStorage.getItem('ws.launcher.7')!);
    expect(kept).toMatchObject({ dirty: true, prefs: { size: 'comfortable' } });
    expect(apiPut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(prefs.SEND_DELAY_MS + 10);
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(apiPut.mock.calls[0]![0]).toBe('/api/prefs/desktop.launcher');
    expect((apiPut.mock.calls[0]![1] as { prefs: { size: string } }).prefs.size).toBe('comfortable');
    expect(JSON.parse(localStorage.getItem('ws.launcher.7')!).dirty).toBe(false);
  });

  it('sends a few quick changes as one request', async () => {
    prefs.updateLauncherPrefs((p) => ({ ...p, size: 'large' }));
    prefs.updateLauncherPrefs((p) => ({ ...p, mode: 'fullscreen' }));
    prefs.updateLauncherPrefs((p) => ({ ...p, sort: 'az' }));
    await vi.advanceTimersByTimeAsync(prefs.SEND_DELAY_MS + 10);
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect((apiPut.mock.calls[0]![1] as { prefs: object }).prefs).toMatchObject({ size: 'large', mode: 'fullscreen', sort: 'az' });
  });

  it('refuses a ninth pin, changing nothing', () => {
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']) expect(prefs.updateLauncherPrefs((p) => pinApp(p, id))).toBe(true);
    expect(prefs.updateLauncherPrefs((p) => pinApp(p, 'a9'))).toBe(false);
    expect(prefs.currentLauncherPrefs().pinned).toHaveLength(8);
  });

  it('keeps an unsent change while offline, and sends it at the next sync', async () => {
    apiPut.mockRejectedValueOnce(new Error('offline'));
    prefs.updateLauncherPrefs((p) => ({ ...p, size: 'large' }));
    await vi.advanceTimersByTimeAsync(prefs.SEND_DELAY_MS + 10);
    expect(prefs.launcherPrefs.get().dirty).toBe(true);
    apiGet.mockResolvedValueOnce({ prefs: { size: 'compact', updatedAt: 1 } });
    await prefs.syncLauncherPrefs();
    expect(apiPut).toHaveBeenCalledTimes(2);
    expect(prefs.currentLauncherPrefs().size).toBe('large');
    expect(prefs.launcherPrefs.get().dirty).toBe(false);
  });
});

describe('launcher preferences: between devices', () => {
  it('takes the server\'s copy when it is newer: a change made on another computer', async () => {
    localStorage.setItem('ws.launcher.7', JSON.stringify({ prefs: { size: 'large', updatedAt: 10 }, dirty: false }));
    apiGet.mockResolvedValueOnce({ prefs: { size: 'comfortable', hidden: ['crm'], updatedAt: 20 } });
    await prefs.syncLauncherPrefs();
    expect(prefs.currentLauncherPrefs()).toMatchObject({ size: 'comfortable', hidden: ['crm'] });
    expect(JSON.parse(localStorage.getItem('ws.launcher.7')!).prefs.size).toBe('comfortable');
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('sends this computer\'s copy when its unsent change is newer', async () => {
    localStorage.setItem('ws.launcher.7', JSON.stringify({ prefs: { size: 'large', updatedAt: 30 }, dirty: true }));
    apiGet.mockResolvedValueOnce({ prefs: { size: 'comfortable', updatedAt: 20 } });
    await prefs.syncLauncherPrefs();
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(prefs.currentLauncherPrefs().size).toBe('large');
  });

  it('keeps the defaults — and the organization\'s — when nothing is stored anywhere', async () => {
    app.set({ bootstrap: { policy: { launcher_pinned: ['mail', 'chat'], launcher_order: ['chat'] } } as never });
    apiGet.mockResolvedValueOnce({ prefs: null });
    await prefs.syncLauncherPrefs();
    expect(prefs.currentLauncherPrefs()).toMatchObject({ pinned: ['mail', 'chat'], order: ['chat'], size: 'compact' });
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('Reset to default follows the organization again, and is synced', async () => {
    app.set({ bootstrap: { policy: { launcher_pinned: ['mail'] } } as never });
    prefs.updateLauncherPrefs((p) => ({ ...p, pinned: ['chat'], size: 'large' }));
    expect(prefs.currentLauncherPrefs().pinned).toEqual(['chat']);
    prefs.resetLauncherPrefs();
    expect(prefs.currentLauncherPrefs()).toMatchObject({ pinned: ['mail'], size: 'compact' });
    await vi.advanceTimersByTimeAsync(prefs.SEND_DELAY_MS + 10);
    expect((apiPut.mock.calls.at(-1)![1] as { prefs: { pinned: unknown } }).prefs.pinned).toBeNull();
  });

  it('never reaches a server in guest mode', async () => {
    app.set({ session: { mode: 'guest', signingIn: false, moveOffer: false }, auth: null });
    prefs.updateLauncherPrefs((p) => ({ ...p, size: 'large' }));
    await vi.advanceTimersByTimeAsync(prefs.SEND_DELAY_MS + 10);
    await prefs.syncLauncherPrefs();
    expect(apiPut).not.toHaveBeenCalled();
    expect(apiGet).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('ws.launcher.guest')!).prefs.size).toBe('large');
  });

  it('syncs when the launcher opens, at most every so often', async () => {
    apiGet.mockResolvedValue({ prefs: null });
    prefs.syncLauncherPrefsIfStale();
    await vi.advanceTimersByTimeAsync(0);
    prefs.syncLauncherPrefsIfStale();
    await vi.advanceTimersByTimeAsync(0);
    expect(apiGet).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 31_000);
    prefs.syncLauncherPrefsIfStale();
    await vi.advanceTimersByTimeAsync(0);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});

describe('the launcher\'s shortcut in the shell\'s keymap', () => {
  it('opens the launcher on ⌘⇧K and leaves ⌘K to Search', () => {
    const map = prefs.shellShortcuts({});
    expect(commandForAccelerator(map, 'Mod+Shift+K')).toBe('launcher');
    expect(commandForAccelerator(map, 'Mod+K')).toBe('search');
  });

  it('follows the person\'s choice', () => {
    prefs.updateLauncherPrefs((p) => ({ ...p, shortcut: 'Mod+Alt+L' }));
    const map = prefs.shellShortcuts({});
    expect(commandForAccelerator(map, 'Mod+Alt+L')).toBe('launcher');
    expect(commandForAccelerator(map, 'Mod+Shift+K')).toBeNull();
  });
});
