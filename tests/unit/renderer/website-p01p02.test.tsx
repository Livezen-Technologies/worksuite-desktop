// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences, WebchatRingState } from '../../../shared/types';

/**
 * P-02 "Desktop notifications & calls settings" (RING-UI-08; RING-10, RING-40, RING-42, RING-46…49), with the copy the
 * desktop shares with P-01 "My ringing settings" (RING-29): the device line, Ringtone with Test ring, Ring on, the call
 * window, Focus / Do not disturb, start at login and the tray, the shortcuts; the ringtone the server keeps, played on
 * the speakers too with a headset on.
 */

const bridge = vi.hoisted(() => ({ call: vi.fn(), ring: null as null | ((s: WebchatRingState) => void) }));
const api = vi.hoisted(() => ({
  apiGet: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ prefs: { ring_where: 'desktop_first', ring_during_dnd: 'card', ringtone: 'classic', ring_volume: 80 } })),
  request: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ data: {} })),
}));
const tones = vi.hoisted(() => ({ play: vi.fn((..._a: unknown[]) => ({ stop: vi.fn(), setVolume: vi.fn() })) }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  hasDesktop: () => true,
  on: (channel: string, fn: (s: WebchatRingState) => void) => {
    if (channel === 'ring:changed') bridge.ring = fn;
    return () => undefined;
  },
  isMac: true,
  errorMessage: (e: Error) => e.message,
}));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn() }), useTabTitle: () => {} }));
vi.mock('../../../src/core/api', async (importOriginal) => ({ ...(await importOriginal<object>()), apiGet: api.apiGet, request: api.request }));
vi.mock('../../../src/modules/calls/tones', async (importOriginal) => ({ ...(await importOriginal<object>()), playTone: tones.play, playOnce: vi.fn() }));

const { app } = await import('../../../src/core/app-state');
const { WebchatRingingPrefs } = await import('../../../src/modules/settings/SettingsPage');
const { useRingTone } = await import('../../../src/modules/chat/website/Ringing');
const { speakersBesides, ringtoneId, RINGTONES } = await import('../../../src/modules/calls/tones');

const ringState = (o: Partial<WebchatRingState> = {}): WebchatRingState => ({ chats: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false, ...o });

let prefs: Preferences;
beforeEach(() => {
  bridge.call.mockReset();
  api.request.mockClear();
  tones.play.mockClear();
  prefs = {
    startWithOs: true,
    minimizeToTray: true,
    webchatRinging: { window: true, duringDnd: 'card', shortcut: true, volume: 80 },
    webchatFollowUps: undefined,
  } as unknown as Preferences;
  app.set({ prefs, locks: [], bootstrap: null, lock: null });
  bridge.call.mockImplementation(async (channel: string, patch?: Partial<Preferences>) => {
    if (channel === 'ring:state') return ringState({ ringHere: true });
    return { preferences: { ...prefs, ...patch }, locks: [] };
  });
});
afterEach(cleanup);

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WebchatRingingPrefs prefs={prefs} /></QueryClientProvider>);

describe('P-02 · Desktop › Notifications & calls', () => {
  it('draws the design copy, in its order', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Website chat ringing on this computer' })).toBeTruthy();
    expect(screen.getByText('A new website chat or visitor call rings here like a phone until someone joins.')).toBeTruthy();
    expect(await screen.findByText('This computer rings for you. Your browser tabs show the card silently.')).toBeTruthy();
    expect(await screen.findByRole('combobox', { name: 'Ringtone' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Ringtone' }).textContent).toContain('Classic phone');
    expect(screen.getByRole('button', { name: 'Test ring' })).toBeTruthy();
    expect(screen.getByText('Speakers too, so you hear it with the headset off.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Ring on' }).textContent).toContain('Speakers and headset');
    expect(screen.getByRole('switch', { name: 'Call window on top of other apps' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Bottom-right, even with WorkSuite closed to the tray.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'During Focus / Do not disturb' }).textContent).toContain('Show the window without ringing');
    expect(screen.getByText('The window still appears; this decides the sound.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Start at login and keep in the tray' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Join chat')).toBeTruthy();
    expect(screen.getByText('⌘⇧J')).toBeTruthy();
    expect(screen.getByText('Answer call')).toBeTruthy();
    expect(screen.getByText('⌘⇧A')).toBeTruthy();
    const labels = ['Ringtone', 'Ring on', 'Call window on top of other apps', 'During Focus / Do not disturb', 'Start at login and keep in the tray', 'Shortcuts'];
    const text = document.body.textContent ?? '';
    const at = labels.map((l) => text.indexOf(l));
    expect(at.every((x) => x >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Where to ring, as P-01 says it (RING-10).
    expect(screen.getByRole('combobox', { name: 'Where to ring' }).textContent).toContain('Desktop app when running, else browser');
  });

  it('says when another device rings instead', async () => {
    bridge.call.mockImplementation(async (channel: string) => (channel === 'ring:state' ? ringState({ ringHere: false }) : null));
    mount();
    expect(await screen.findByText('Another of your devices rings for you. This computer shows the chat without sound.')).toBeTruthy();
  });

  it('keeps the ringtone on the server, for every device, and tests it where it will ring', async () => {
    mount();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Ringtone' }));
    fireEvent.click(screen.getByRole('option', { name: 'Soft' }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('PUT', '/api/chat/ring/prefs', { body: { ringtone: 'soft' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Test ring' }));
    expect(tones.play).toHaveBeenCalledWith('webchat', 0.8, { ringtone: 'classic', ringOn: 'both' });
  });

  it('saves Ring on, the call window, Focus, the shortcuts and the Live shortcuts on this computer', async () => {
    mount();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Ring on' }));
    fireEvent.click(screen.getByRole('option', { name: 'System output only' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('settings:set', { webchatRinging: { ...prefs.webchatRinging, ringOn: 'default' } }));
    fireEvent.click(screen.getByRole('combobox', { name: 'During Focus / Do not disturb' }));
    fireEvent.click(screen.getByRole('option', { name: 'Ring only when a chat is at risk' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('settings:set', { webchatRinging: { ...prefs.webchatRinging, duringDnd: 'at_risk' } }));
    fireEvent.click(screen.getByRole('switch', { name: 'Call window on top of other apps' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('settings:set', { webchatRinging: { ...prefs.webchatRinging, window: false } }));
    fireEvent.click(screen.getByRole('switch', { name: 'Shortcuts' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('settings:set', { webchatRinging: { ...prefs.webchatRinging, shortcut: false } }));
    expect(screen.getByText('⌘⇧M')).toBeTruthy();
    expect(screen.getByText('⌘⇧D')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Live map and dashboard shortcuts' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('settings:set', { webchatRinging: { ...prefs.webchatRinging, liveShortcuts: false } }));
  });

  it('start at login and keep in the tray: on sets both, off stops only starting at login (RING-48)', async () => {
    prefs = { ...prefs, minimizeToTray: false };
    app.set({ prefs });
    mount();
    const sw = screen.getByRole('switch', { name: 'Start at login and keep in the tray' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('settings:set', { startWithOs: true, minimizeToTray: true }));
    cleanup();
    prefs = { ...prefs, minimizeToTray: true };
    app.set({ prefs });
    mount();
    fireEvent.click(screen.getByRole('switch', { name: 'Start at login and keep in the tray' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('settings:set', { startWithOs: false }));
  });
});

describe('the ring itself: my ringtone, on the speakers too (RING-29, RING-42)', () => {
  it('plays the tone in the ringtone and output the state carries', () => {
    const { rerender } = renderHook(({ s }) => useRingTone(s), { initialProps: { s: ringState({ tone: 'normal', ringtone: 'bright', ringOn: 'default' }) } });
    expect(tones.play).toHaveBeenLastCalledWith('webchat', 0.8, { ringtone: 'bright', ringOn: 'default' });
    act(() => rerender({ s: ringState({ tone: 'strong' }) }));
    expect(tones.play).toHaveBeenLastCalledWith('webchat-strong', 0.8, { ringtone: 'classic', ringOn: 'both' });
  });

  it('names the same three ringtones as the web app, and keeps Classic phone for a name it does not know', () => {
    expect(RINGTONES.map((t) => [t.id, t.label])).toEqual([['classic', 'Classic phone'], ['soft', 'Soft'], ['bright', 'Bright']]);
    expect(ringtoneId('soft')).toBe('soft');
    expect(ringtoneId('trumpet')).toBe('classic');
    expect(ringtoneId(null)).toBe('classic');
  });

  it('adds the computer’s speakers only when the output is something else, like a headset', () => {
    const d = (deviceId: string, label: string, groupId = deviceId) => ({ kind: 'audiooutput' as MediaDeviceKind, deviceId, label, groupId });
    expect(speakersBesides([d('default', 'Default - Jabra Evolve2 65', 'jabra'), d('jabra', 'Jabra Evolve2 65', 'jabra'), d('mac', 'MacBook Pro Speakers')])).toEqual(['mac']);
    expect(speakersBesides([d('default', 'Default - MacBook Pro Speakers', 'mac'), d('mac', 'MacBook Pro Speakers', 'mac'), d('jabra', 'Jabra Evolve2 65')])).toEqual([]);
    // Names withheld by the system: nothing to go on, so the system's output alone.
    expect(speakersBesides([d('default', ''), d('a', ''), d('b', '')])).toEqual([]);
    expect(speakersBesides([])).toEqual([]);
  });
});
