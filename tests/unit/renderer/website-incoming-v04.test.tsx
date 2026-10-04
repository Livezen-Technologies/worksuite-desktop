// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatCall, WebchatRingState } from '@shared/types';

vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: true,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));

import { call } from '../../../src/core/bridge';
import { RingingBar, WebchatRingWindow, callWhere, deviceLine } from '../../../src/modules/chat/website/Ringing';
import { micName, pickMic, watchMicrophone } from '../../../src/modules/chat/website/mic';

/**
 * V-04 "Desktop — incoming voice call" (VOICE-UI-03; VOICE-10, VOICE-11, VOICE-14, UX-WGT-10): the native call window
 * as designed — the window's title, the phone in its ring, INCOMING VOICE CALL · 0:09, Visitor 4F2A, "techubiz.com · in
 * chat with Nuwan", Last message, Answer and Decline, and the device line "Headset: Jabra Evolve2 · mic ready" with ⌘⇧A.
 */

const voice = (over: Partial<WebchatCall> = {}): WebchatCall => ({
  id: 41, conversationId: 4, visitor: 'Visitor 4F2A', site: 'techubiz.com', page: 'Adobe Creative Cloud', place: 'Colombo, Sri Lanka',
  preview: 'With the education discount, please?', owner: 'Nuwan Perera', stage: 'first', requestedAt: new Date(Date.now() - 9_000).toISOString(), ...over,
});
const state = (over: Partial<WebchatRingState>): WebchatRingState => ({
  chats: [], calls: [voice()], tone: 'strong', volume: 80, outcome: null, hidden: false, shortcut: false, answerShortcut: true,
  mic: { ready: true, label: 'Jabra Evolve2', headset: true }, ...over,
});
const show = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue(state({}) as never);
});
afterEach(() => cleanup());

describe('the incoming voice call window (V-04)', () => {
  it('shows every region of the design, with its copy', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    expect(screen.getByRole('region', { name: 'Incoming voice call' })).toBeTruthy();
    expect(screen.getByText('WorkSuite · Website voice call')).toBeTruthy();
    expect(screen.getByText('Incoming voice call')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toMatch(/^0:(09|1\d)$/);
    expect(screen.getByText('techubiz.com · in chat with Nuwan')).toBeTruthy();
    expect(screen.getByText(/Last message:/).textContent).toBe('Last message: “With the education discount, please?”');
    expect(screen.getByText('Reading Adobe Creative Cloud')).toBeTruthy();
    expect(screen.getByText('Headset: Jabra Evolve2 · mic ready')).toBeTruthy();
    expect(screen.getByText('⌘⇧A')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Voice call: Visitor 4F2A on techubiz.com is calling.');
  });

  it('Answer mints the token and joins; Decline declines (VOICE-12)', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(call).toHaveBeenCalledWith('ring:call', { id: 41, accept: true });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(call).toHaveBeenCalledWith('ring:call', { id: 41, accept: false });
  });

  it('shows the details the visitor gave before calling (UX-WGT-10)', async () => {
    vi.mocked(call).mockResolvedValue(state({ calls: [voice({ phone: '+94 77 123 4567', email: 'kamal@techubiz.com' })] }) as never);
    show(<WebchatRingWindow />);
    expect(await screen.findByText('+94 77 123 4567 · kamal@techubiz.com')).toBeTruthy();
  });

  it('without a microphone, says so and cannot answer — but can still decline (VOICE-11)', async () => {
    vi.mocked(call).mockResolvedValue(state({ mic: { ready: false, label: null, headset: false } }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('No microphone — plug one in to answer');
    expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(call).toHaveBeenCalledWith('ring:call', { id: 41, accept: false });
  });

  it('locked: a website visitor is calling, nothing about who, no contact details, no Answer', async () => {
    vi.mocked(call).mockResolvedValue(state({ hidden: true, calls: [voice({ visitor: 'A visitor', page: null, place: null, preview: null, owner: null, phone: null, email: null })] }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('A website visitor');
    expect(screen.getByText('Unlock WorkSuite to see who.')).toBeTruthy();
    expect(screen.queryByText(/Last message/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('A website visitor is calling.');
  });

  it('no shortcut hint while Ctrl/Cmd+Shift+A is not held; another device ringing is said', async () => {
    vi.mocked(call).mockResolvedValue(state({ answerShortcut: false, elsewhere: true }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    expect(screen.queryByText('⌘⇧A')).toBeNull();
    expect(screen.getByText('Ringing on your other device — shown here without sound')).toBeTruthy();
  });

  it('the bar under the tabs cannot answer without a microphone either', async () => {
    vi.mocked(call).mockResolvedValue(state({ mic: { ready: false, label: null, headset: false } }) as never);
    show(<RingingBar tone={false} />);
    await screen.findByText('No microphone');
    expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the device line and the microphone it names (V-04, VOICE-14)', () => {
  it('words', () => {
    expect(deviceLine({ ready: true, label: 'Jabra Evolve2', headset: true })).toBe('Headset: Jabra Evolve2 · mic ready');
    expect(deviceLine({ ready: true, label: 'MacBook Pro Microphone', headset: false })).toBe('Microphone: MacBook Pro Microphone · mic ready');
    expect(deviceLine({ ready: true, label: null, headset: false })).toBe('Microphone ready');
    expect(deviceLine({ ready: false, label: null, headset: false })).toBe('No microphone — plug one in to answer');
    expect(deviceLine(null)).toBe('Audio only, in WorkSuite');
    expect(callWhere({ site: null, owner: null })).toBe('Website voice call');
    expect(callWhere({ site: 'techubiz.com', owner: null })).toBe('techubiz.com');
  });

  const dev = (kind: string, deviceId: string, label: string, groupId: string) => ({ kind, deviceId, label, groupId }) as MediaDeviceInfo;

  it('names the chosen microphone, else the default; a headset has its own speaker', () => {
    const all = [
      dev('audioinput', 'default', 'Default - Jabra Evolve2 (0b0e:24c8)', 'g1'),
      dev('audioinput', 'j', 'Jabra Evolve2 (0b0e:24c8)', 'g1'),
      dev('audioinput', 'm', 'MacBook Pro Microphone', 'g2'),
      dev('audiooutput', 'jo', 'Jabra Evolve2', 'g1'),
      dev('audiooutput', 'mo', 'MacBook Pro Speakers', 'g3'),
    ];
    expect(pickMic(all, '')).toEqual({ has: true, label: 'Jabra Evolve2', headset: true });
    expect(pickMic(all, 'm')).toEqual({ has: true, label: 'MacBook Pro Microphone', headset: false });
    expect(pickMic(all, 'gone')).toEqual({ has: true, label: 'Jabra Evolve2', headset: true });
    expect(pickMic([all[4]!], '')).toEqual({ has: false, label: null, headset: false });
    expect(micName('')).toBeNull();
    expect(micName('Communications - Poly Voyager')).toBe('Poly Voyager');
  });

  it('tells the main process the microphone by name', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: vi.fn(async () => [dev('audioinput', 'default', 'Default - Jabra Evolve2', 'g1'), dev('audiooutput', 'o', 'Jabra Evolve2', 'g1')]), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    const stop = watchMicrophone();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:mic', { has: true, label: 'Jabra Evolve2', headset: true }));
    stop();
  });
});
