// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticCheck, RemoteControlView } from '@shared/types';

/**
 * Settings › Remote control: the checks, the two policy rows and the list of
 * apps nobody can control (WS-MEET-ENH-01 RC09).
 *
 * The things worth protecting here: the hold and the clipboard are the
 * organisation's to set, so they are shown as read-only facts with the reason
 * — a switch would imply they could be changed; and the protected-apps list is
 * the one in the service, not a second copy written for the screen.
 */

const bridge = vi.hoisted(() => ({ call: vi.fn(), listeners: new Map<string, (p: unknown) => void>() }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: (channel: string, cb: (p: unknown) => void) => {
    bridge.listeners.set(channel, cb);
    return () => bridge.listeners.delete(channel);
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  hasDesktop: () => true,
  isMac: true,
  platform: 'darwin',
}));

import { app } from '../../../src/core/app-state';
import { queryClient } from '../../../src/core/query';
import { RemoteControlSection, clipboardLabel, holdLabel } from '../../../src/modules/settings/SettingsPage';

const view: RemoteControlView = {
  support: { available: true, method: 'cgevent', displayServer: 'quartz', reason: null, accessibility: 'granted', accessibilityHint: null, policyAllows: true },
  allowRequests: true,
  emergencyChord: 'Ctrl+Alt+Shift+Esc',
  chordRegistered: true,
  share: null,
  requests: [],
  offers: [],
  canSendFiles: false,
  session: null,
};

const checks: DiagnosticCheck[] = [
  { id: 'meet-screen', label: 'Screen sharing', status: 'pass', detail: '2 screens can be captured.' },
  { id: 'meet-input', label: 'Remote input', status: 'warn', detail: 'Accessibility is off, so your screen can be seen but not controlled.' },
  // The main process no longer answers for the media path: the probe does.
  { id: 'meet-clipboard', label: 'Clipboard while controlled', status: 'pass', detail: 'Text only, by your organisation’s policy.' },
];

let served: DiagnosticCheck[] = checks;

function mount(policy: Record<string, unknown> = { remote_local_priority_hold_ms: 1500, remote_clipboard: 'text_only' }) {
  app.set({ bootstrap: { policy } } as never);
  render(
    <QueryClientProvider client={queryClient}>
      <RemoteControlSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  served = checks;
  bridge.call.mockReset().mockImplementation(async (ch: string) => (ch === 'rc:checks' ? { checks: served } : view));
});
afterEach(cleanup);

describe('the checks', () => {
  it('lists each check with its own state, and the worst of them at the top', async () => {
    mount();

    const list = await screen.findByTestId('rc-checks');

    await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(4));
    // The two from the main process, then the media row the probe owns.
    expect([...list.querySelectorAll('li')].map((li) => li.querySelector('b')!.textContent)).toEqual([
      'Screen sharing',
      'Remote input',
      'Clipboard while controlled',
      'Media path (UDP and TURN)',
    ]);
    // One warning among them: works, with limits — not "nothing in the way".
    expect(screen.getByText('Works, with limits')).toBeTruthy();
  });

  it('Run checks again asks for a fresh answer', async () => {
    mount();
    await screen.findByText('2 screens can be captured.');
    served = [{ id: 'meet-screen', label: 'Screen sharing', status: 'pass', detail: 'One screen can be captured.' }];
    fireEvent.click(screen.getByRole('button', { name: /Run checks again/ }));

    await waitFor(() => expect(screen.getByText('One screen can be captured.')).toBeTruthy());
    expect(screen.getByText('Nothing in the way')).toBeTruthy();
  });

  it('says nothing about the worst of them before any answer has arrived', async () => {
    served = [];
    mount();

    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('rc:checks'));
    expect(screen.queryByText('Nothing in the way')).toBeNull();
  });
});

describe('the two rows the organisation decides', () => {
  it('names the hold in seconds, and marks it as the organisation’s', async () => {
    mount();

    expect(await screen.findByText('Their input waits 1.5 seconds')).toBeTruthy();
    expect(screen.getAllByText('Set by your organization').length).toBeGreaterThan(0);
  });

  it('says what the clipboard policy allows', async () => {
    mount();
    expect(await screen.findByText('Text only')).toBeTruthy();
  });

  it('does not invent a number or a policy it was not given', async () => {
    mount({});
    // Both rows: the hold and the clipboard. Neither guesses a value.
    expect(await screen.findAllByText('As your organisation’s policy says')).toHaveLength(2);
  });
});

describe('the labels themselves', () => {
  it('reads whole tenths of a second, and milliseconds below one', () => {
    expect(holdLabel(1500)).toBe('Their input waits 1.5 seconds');
    expect(holdLabel(2000)).toBe('Their input waits 2 seconds');
    expect(holdLabel(800)).toBe('Their input waits 800 ms');
    expect(holdLabel(null)).toBe('As your organisation’s policy says');
  });

  it('says each clipboard policy in terms of what it permits', () => {
    expect(clipboardLabel('off')).toBe('Nothing can be put on your clipboard');
    expect(clipboardLabel('text_only')).toBe('Text only');
    expect(clipboardLabel('text_and_files')).toBe('Text, and files you accept');
    expect(clipboardLabel(null)).toBe('As your organisation’s policy says');
  });
});

describe('the emergency stop', () => {
  it('can be changed on this computer while the organisation has not set one', async () => {
    mount();

    const picker = await screen.findByRole('combobox', { name: 'Emergency stop' });

    expect(picker).toBeTruthy();
    // The note under it says what that chord costs on this keyboard.
    expect(screen.getByText(/Windows and Linux reach it easily/)).toBeTruthy();
  });

  it('stays the organisation’s where they have set one', async () => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:checks' ? { checks: served } : { ...view, emergencyChord: 'Ctrl+Alt+F9', chordSetByOrganisation: true }));
    mount();

    expect(await screen.findByText('Ctrl+Alt+F9')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Emergency stop' })).toBeNull();
    expect(screen.getAllByText('Set by your organization').length).toBeGreaterThan(0);
  });

  it('says it cannot be turned off, only changed', async () => {
    mount();
    expect(await screen.findByText(/cannot be turned off — only changed/)).toBeTruthy();
  });
});

describe('the media path', () => {
  it('is not measured until asked, and says so', async () => {
    mount();

    expect(await screen.findByText(/not checked until you ask/)).toBeTruthy();
    // Nothing has gathered: the row says it has not been measured.
    expect(screen.getByText(/Not measured yet/)).toBeTruthy();
  });
});

describe('apps nobody can control', () => {
  it('lists them, and says the pause is this computer’s own decision', async () => {
    mount();
    fireEvent.click(await screen.findByText('Apps nobody can control'));

    expect(await screen.findByText(/Password managers/)).toBeTruthy();
    expect(screen.getByText(/1Password, Bitwarden, KeePass/)).toBeTruthy();
    // The distinction that matters: control pauses, the share does not stop.
    expect(screen.getByText(/Your screen is still shared while control is paused/)).toBeTruthy();
  });
});
