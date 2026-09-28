// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteControlConsent, RemoteControlView } from '@shared/types';

/**
 * The shared computer's own windows (WS-MEET-ENH-01 RC03, RC04): the
 * request prompt, with what the controller may do and for how long, and the
 * bar that is up while control lasts. The main process decides whether a
 * click counts; these only ask.
 */

const bridge = vi.hoisted(() => ({ call: vi.fn(), listeners: new Map<string, (p: unknown) => void>() }));

vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: (ch: string, cb: (p: unknown) => void) => {
    bridge.listeners.set(ch, cb);
    return () => bridge.listeners.delete(ch);
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
}));
vi.mock('../../../src/core/api', () => ({ apiPost: vi.fn() }));

import { apiPost } from '../../../src/core/api';
import { RemoteControlWindow, chordLabel, mmss } from '../../../src/app/RemoteControlWindow';

const consent: RemoteControlConsent = { id: 21, kind: 'request', requester: 'Olivia Chen', reason: 'Fix the VPN', expiresIn: 58, share: 'Screen 1', current: null, clipboard: 'text', fileTransfer: true, locked: false };

const view = (session: Partial<NonNullable<RemoteControlView['session']>> | null): RemoteControlView => ({
  support: { available: true, method: 'sendinput', displayServer: 'win32', reason: null, accessibility: 'not_required', policyAllows: true },
  allowRequests: true,
  emergencyChord: 'Ctrl+Alt+Shift+Esc',
  chordRegistered: true,
  share: { uuid: 'u', shareId: 5, label: 'Screen 1', kind: 'screen', allowRequests: true, paused: false },
  requests: [],
  offers: [],
  canSendFiles: false,
  session: session ? { id: 9, status: 'CONTROL_ACTIVE', controller: 'Olivia Chen', capsLabel: 'Mouse and keyboard', pauseReason: null, pauseText: null, since: Date.now() - 65_000, expiresAt: null, waiting: null, type: 'meeting', ...session } : null,
});

beforeEach(() => {
  bridge.call.mockReset();
  bridge.listeners.clear();
  vi.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(cleanup);

describe('the request prompt (RC03)', () => {
  beforeEach(() => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:consent' ? consent : ch === 'rc:state' ? view(null) : { status: 'approved' }));
  });

  it('says who asks, why, on what, and how to stop it', async () => {
    render(<RemoteControlWindow hash="#/rc/consent?request=21" />);
    expect(await screen.findByRole('heading', { name: 'Olivia Chen wants to control your computer' })).toBeTruthy();
    expect(screen.getByText('“Fix the VPN”')).toBeTruthy();
    expect(screen.getByText('Screen 1')).toBeTruthy();
    expect(screen.getByText('Ctrl+Alt+Shift+Esc')).toBeTruthy();
    expect(screen.getByLabelText('Put text on my clipboard')).toBeTruthy();
  });

  it('sends what was ticked and for how long', async () => {
    render(<RemoteControlWindow hash="#/rc/consent?request=21" />);
    fireEvent.click(await screen.findByLabelText('Use the keyboard'));
    fireEvent.click(screen.getByLabelText('Put text on my clipboard'));
    fireEvent.click(screen.getByRole('button', { name: 'Allow control' }));
    await waitFor(() =>
      expect(bridge.call).toHaveBeenCalledWith('rc:answer', { decision: 'allow', caps: { mouse: true, keyboard: false, clipboard: 'text', file_transfer: false, monitor_switch: false }, duration: 'until_stopped' }),
    );
    expect(window.close).toHaveBeenCalled();
  });

  it('shows why a click did not count, and asks for the code when policy wants one', async () => {
    bridge.call.mockImplementation(async (ch: string) => {
      if (ch === 'rc:consent') return consent;
      if (ch === 'rc:state') return view(null);
      return { status: 'step_up', stepUp: true, message: 'Confirm it’s you first.' };
    });
    render(<RemoteControlWindow hash="#/rc/consent?request=21" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow for 5 minutes' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Confirm it’s you first.');
    fireEvent.change(screen.getByLabelText('Code from your authenticator app'), { target: { value: '123456' } });
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:answer' ? { status: 'approved' } : consent));
    fireEvent.click(screen.getByRole('button', { name: 'Allow for 5 minutes' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/meet/control/step-up', { code: '123456' }));
    await waitFor(() => expect(bridge.call).toHaveBeenLastCalledWith('rc:answer', expect.objectContaining({ decision: 'allow_5', duration: '5' })));
  });

  it('asks to hand over when somebody else has control', async () => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:consent' ? { ...consent, kind: 'handover', current: 'Ravi' } : view(null)));
    render(<RemoteControlWindow hash="#/rc/consent?request=21" />);
    expect(await screen.findByRole('heading', { name: 'Olivia Chen wants to take over control of your computer' })).toBeTruthy();
    expect(screen.getByText(/Ravi has control now and will lose it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow for 5 minutes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hand over control' })).toBeTruthy();
  });
});

describe('the control bar (RC04)', () => {
  it('says who is in control and for how long, with Pause and Stop', async () => {
    bridge.call.mockResolvedValue(view({}));
    render(<RemoteControlWindow hash="#/rc/indicator" />);
    expect(await screen.findByText('Olivia Chen is controlling your screen · Mouse and keyboard')).toBeTruthy();
    expect(screen.getByText(/^1:0\d$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('rc:pause', { sessionId: 9 }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('rc:stop', { sessionId: 9 }));
  });

  it('offers Resume when paused, and says why it paused', async () => {
    bridge.call.mockResolvedValue(view({ status: 'CONTROL_PAUSED', pauseReason: 'lock_screen', pauseText: 'Paused while the screen is locked.' }));
    render(<RemoteControlWindow hash="#/rc/indicator" />);
    expect(await screen.findByText('Olivia Chen — Paused while the screen is locked.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('rc:resume', { sessionId: 9 }));
  });

  it('says so when the person here is using the mouse', async () => {
    bridge.call.mockResolvedValue(view(null));
    render(<RemoteControlWindow hash="#/rc/indicator" />);
    await waitFor(() => expect(bridge.listeners.has('rc:changed')).toBe(true));
    bridge.listeners.get('rc:changed')!(view({ waiting: 'local' }));
    expect(await screen.findByText('You’re using the mouse — Olivia Chen waits'.replace('’', "'"))).toBeTruthy();
  });
});

describe('files offered on the bar (RC06)', () => {
  it('asks before taking a program, and says what each file is', async () => {
    const offer = { id: 31, sessionId: 9, name: 'fix.exe', size: 2_048, from: 'Olivia Chen', executable: true, scan: 'not_scanned' as const };
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' ? { ...view({}), offers: [offer], canSendFiles: true } : ch === 'rc:fileAnswer' ? { status: 'confirm', confirmExecutable: true } : undefined));
    render(<RemoteControlWindow hash="#/rc/indicator" />);
    const list = await screen.findByRole('list', { name: 'Files offered to you' });
    expect(list.textContent).toMatch(/Olivia Chen sends fix.exe · 2(.0)? KB · a program/);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('rc:fileAnswer', { id: 31, accept: true, confirmExecutable: false }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept the program' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('rc:fileAnswer', { id: 31, accept: true, confirmExecutable: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Send a file' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('rc:sendFile', { sessionId: 9 }));
  });
});

describe('words', () => {
  it('write chords the way the keyboard does, and time as m:ss', () => {
    expect(chordLabel('Ctrl+Alt+Shift+Esc', true)).toBe('⌃⌥⇧esc');
    expect(chordLabel('Ctrl+Alt+Shift+Esc', false)).toBe('Ctrl+Alt+Shift+Esc');
    expect(mmss(65_000)).toBe('1:05');
  });
});
