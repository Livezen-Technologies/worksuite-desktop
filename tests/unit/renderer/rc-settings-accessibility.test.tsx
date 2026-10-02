// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteControlSupport, RemoteControlView } from '@shared/types';

const bridge = vi.hoisted(() => ({ call: vi.fn(), listeners: new Map<string, (payload: unknown) => void>() }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: (channel: string, cb: (payload: unknown) => void) => {
    bridge.listeners.set(channel, cb);
    return () => bridge.listeners.delete(channel);
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  hasDesktop: () => true,
  isMac: true,
  platform: 'darwin',
}));

import { queryClient } from '../../../src/core/query';
import { RC_RECHECK_MS, RemoteControlSection } from '../../../src/modules/settings/SettingsPage';

const view = (support: Partial<RemoteControlSupport>): RemoteControlView => ({
  support: { available: true, method: 'cgevent', displayServer: 'quartz', reason: null, accessibility: 'granted', accessibilityHint: null, policyAllows: true, ...support },
  allowRequests: true,
  emergencyChord: 'Ctrl+Alt+Shift+Esc',
  chordRegistered: true,
  share: null,
  requests: [],
  offers: [],
  canSendFiles: false,
  session: null,
});
const DENIED = { available: false, accessibility: 'denied' as const, reason: 'Allow WorkSuite under Privacy & Security › Accessibility to let others control this Mac.' };

function mount() {
  render(
    <QueryClientProvider client={queryClient}>
      <RemoteControlSection />
    </QueryClientProvider>,
  );
}

describe('Settings › Remote control: Accessibility on a Mac (worksuite-desktop#47)', () => {
  beforeEach(() => {
    queryClient.clear();
    bridge.call.mockReset();
  });
  afterEach(cleanup);

  it('shows a failed probe separately from denied permission and recovers on retry', async () => {
    let failed = true;
    bridge.call.mockImplementation(async (ch: string) => {
      if (ch === 'rc:recheck' && failed) throw new Error('IPC unavailable');
      return view({});
    });
    mount();
    expect(await screen.findByText('Unable to verify Accessibility access')).toBeTruthy();
    expect(screen.queryByText('This computer can be shared, but not controlled')).toBeNull();
    expect(screen.queryByText('Accessibility access enabled')).toBeNull();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Accessibility access enabled')).toBeTruthy();
  });

  it('checks again on opening the screen, and drops the warning once access is confirmed', async () => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' ? view(DENIED) : ch === 'rc:recheck' ? view({}) : undefined));
    mount();
    expect(await screen.findByText('Accessibility access enabled')).toBeTruthy();
    expect(screen.getByText('This computer can be controlled when you allow it')).toBeTruthy();
    expect(screen.queryByText('This computer can be shared, but not controlled')).toBeNull();
    expect(bridge.call).toHaveBeenCalledWith('rc:recheck');
  });

  it('checks again when WorkSuite comes back from System Settings, and on Check again', async () => {
    let next = view(DENIED);
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' || ch === 'rc:recheck' ? next : undefined));
    mount();
    expect(await screen.findByText('This computer can be shared, but not controlled')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Accessibility settings' }));
    expect(bridge.call).toHaveBeenCalledWith('media:privacySettings', { pane: 'accessibility' });

    next = view({});
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByText('Accessibility access enabled')).toBeTruthy();

    next = view(DENIED);
    const before = bridge.call.mock.calls.filter(([c]) => c === 'rc:recheck').length;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByText('This computer can be shared, but not controlled')).toBeTruthy());
    expect(bridge.call.mock.calls.filter(([c]) => c === 'rc:recheck').length).toBe(before + 1);
  });

  it('when access is granted but needs a restart, says so with a Restart WorkSuite button instead of Denied (worksuite-desktop#147)', async () => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' || ch === 'rc:recheck' ? view({ ...DENIED, accessibilityHint: 'restart', accessibilityDetails: details({ appTrusted: true, helperAccessibility: true, helperTrusted: false }) }) : undefined));
    mount();
    expect(await screen.findByText('Access granted — restart WorkSuite to finish')).toBeTruthy();
    expect((await screen.findByTestId('rc-accessibility-hint')).textContent).toMatch(/restart WorkSuite once to finish/);
    expect(screen.queryByText('This computer can be shared, but not controlled')).toBeNull();
    expect(screen.queryByText('Permission required')).toBeNull();
    expect(screen.getByText(/Nobody controls this computer until you approve their request/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart WorkSuite' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('rc:restart'));
  });

  it('when a restart did not help, gives steps for the helper and still offers a restart', async () => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' || ch === 'rc:recheck' ? view({ ...DENIED, accessibilityHint: 'helper', accessibilityDetails: details({ appTrusted: true }) }) : undefined));
    mount();
    expect(await screen.findByText('WorkSuite has access, but its input helper does not')).toBeTruthy();
    const hint = screen.getByTestId('rc-accessibility-hint').textContent ?? '';
    expect(hint).toContain('/usr/bin/osascript');
    expect(hint).toMatch(/open it from the Applications folder in Finder.*click − to remove it.*Restart WorkSuite, then check again/);
    expect(screen.getByRole('button', { name: 'Restart WorkSuite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Accessibility settings' })).toBeTruthy();
  });

  it('shows the running copy’s path, bundle ID, Team ID and signing identity, and why the entry may not apply', async () => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' || ch === 'rc:recheck'
      ? view({ ...DENIED, accessibilityDetails: details({ identity: { executable: '~/Downloads/WorkSuite.app/Contents/MacOS/WorkSuite', bundle: '~/Downloads/WorkSuite.app', bundleId: 'lk.worksuite.desktop', teamId: null, authority: null, adhoc: true, translocated: true, otherInstalledCopy: true, development: false, signingUnavailable: false } }) })
      : undefined));
    mount();
    const warnings = (await screen.findByTestId('rc-identity-warnings')).textContent ?? '';
    expect(warnings).toMatch(/temporary location/);
    expect(warnings).toMatch(/Another copy of WorkSuite is in Applications/);
    expect(warnings).toMatch(/not signed with a Developer ID/);
    const det = screen.getByTestId('rc-details').textContent ?? '';
    expect(det).toContain('Running copy: ~/Downloads/WorkSuite.app');
    expect(det).toContain('Bundle ID: lk.worksuite.desktop');
    expect(det).toContain('Team ID: not set');
    expect(det).toContain('Signed by: ad-hoc (no Developer ID)');
    expect(det).toContain('App Accessibility: Denied.');
    const help = screen.getByTestId('rc-still-denied').textContent ?? '';
    expect(help).toMatch(/click − to remove it, then click \+/);
    expect(help).toContain('tccutil reset Accessibility lk.worksuite.desktop');
  });

  it('checks again every 2 seconds while the banner is shown, and stops once access is granted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let next = view(DENIED);
      bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' || ch === 'rc:recheck' ? next : undefined));
      mount();
      expect(await screen.findByText('This computer can be shared, but not controlled')).toBeTruthy();
      expect(screen.getByTestId('rc-auto-check')).toBeTruthy();
      const rechecks = () => bridge.call.mock.calls.filter(([c]) => c === 'rc:recheck').length;
      const start = rechecks();
      await act(async () => { await vi.advanceTimersByTimeAsync(RC_RECHECK_MS); });
      expect(rechecks()).toBe(start + 1);
      // The periodic check keeps the last answer on screen meanwhile: no flicker to "Checking…".
      expect(screen.queryByText('Checking Accessibility access…')).toBeNull();
      next = view({});
      await act(async () => { await vi.advanceTimersByTimeAsync(RC_RECHECK_MS); });
      expect(await screen.findByText('Accessibility access enabled')).toBeTruthy();
      const after = rechecks();
      await act(async () => { await vi.advanceTimersByTimeAsync(RC_RECHECK_MS * 3); });
      expect(rechecks()).toBe(after);
      expect(screen.queryByTestId('rc-auto-check')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not poll while the window is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    try {
      bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' || ch === 'rc:recheck' ? view(DENIED) : undefined));
      mount();
      expect(await screen.findByText('This computer can be shared, but not controlled')).toBeTruthy();
      visibility.mockReturnValue('hidden');
      const before = bridge.call.mock.calls.filter(([c]) => c === 'rc:recheck').length;
      await act(async () => { await vi.advanceTimersByTimeAsync(RC_RECHECK_MS * 3); });
      expect(bridge.call.mock.calls.filter(([c]) => c === 'rc:recheck').length).toBe(before);
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it('updates when the main process re-checks on WorkSuite becoming active', async () => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' || ch === 'rc:recheck' ? view(DENIED) : undefined));
    mount();
    expect(await screen.findByText('This computer can be shared, but not controlled')).toBeTruthy();
    await waitFor(() => expect(bridge.listeners.has('rc:changed')).toBe(true));
    await act(async () => { bridge.listeners.get('rc:changed')!(view({})); });
    expect(await screen.findByText('Accessibility access enabled')).toBeTruthy();
  });
});

function details(over: Partial<NonNullable<RemoteControlSupport['accessibilityDetails']>> = {}): NonNullable<RemoteControlSupport['accessibilityDetails']> {
  return { appTrusted: false, helperTrusted: false, helperAccessibility: false, problem: null, checkedAt: 1, runningApp: '/Applications/WorkSuite.app/Contents/MacOS/WorkSuite', helperPath: '/usr/bin/osascript', helperSource: 'probe', identity: null, ...over };
}
