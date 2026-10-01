// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteControlSupport, RemoteControlView } from '@shared/types';

const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: () => () => undefined,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  hasDesktop: () => true,
  isMac: true,
  platform: 'darwin',
}));

import { queryClient } from '../../../src/core/query';
import { RemoteControlSection } from '../../../src/modules/settings/SettingsPage';

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

  it('when access still reads as off after System Settings, explains removing the old entry or reopening WorkSuite', async () => {
    bridge.call.mockImplementation(async (ch: string) => (ch === 'rc:state' || ch === 'rc:recheck' ? view({ ...DENIED, accessibilityHint: 'restart' }) : undefined));
    mount();
    expect((await screen.findByTestId('rc-accessibility-hint')).textContent).toMatch(/remove it with −, add it again with \+.*quit WorkSuite and open it again/);
    expect(screen.getByText(/Nobody controls this computer until you approve their request/)).toBeTruthy();
  });
});
