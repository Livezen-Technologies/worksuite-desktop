// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { NotificationPermission, RingTestStep } from '@shared/types';

/**
 * New website chats reach signed-in staff (worksuite-desktop#251), the window's side: "Taking chats" only while the
 * server counts me online — the status routing uses and the top bar shows; Settings says when desktop notifications
 * are off for WorkSuite and opens the system's page; and "Send a test chat notification" lists each step.
 */
vi.mock('../../../src/core/api', async (orig) => ({
  ...(await orig<typeof CoreApi>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(async () => ({})),
}));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tone = { stop: vi.fn(), setVolume: vi.fn() };
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => tone) }));

import { apiGet } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { shownPresence } from '../../../src/core/presence';
import { MyStatus, statusChoice } from '../../../src/modules/chat/MyStatus';
import { playTone } from '../../../src/modules/calls/tones';
import { NotificationsOffBanner, soundStep, TestChatNotification } from '../../../src/modules/settings/RingCheck';

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const calls = call as unknown as ReturnType<typeof vi.fn>;

class FakeAudio {
  state = 'suspended';
  async resume() {
    this.state = 'running';
  }
  async close() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudio;
});
afterEach(() => cleanup());

describe('one status everywhere (#251)', () => {
  it('says Taking chats only while the server counts me online, as routing does', async () => {
    (apiGet as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'busy', choice: 'available', busy_reason: 'meeting' });
    wrap(<MyStatus variant="website" open={2} />);
    // Available was chosen, but a meeting makes me busy: the top bar says Busy, and no chat is given to me by turn.
    expect(await screen.findByText('Busy · no new chats')).toBeTruthy();
    expect(screen.queryByText('Taking chats')).toBeNull();
  });

  it('shows Taking chats while online, and Away when idle, whatever was chosen', async () => {
    (apiGet as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'online', choice: 'available' });
    wrap(<MyStatus variant="website" />);
    expect(await screen.findByText('Taking chats')).toBeTruthy();
    expect(statusChoice(shownPresence({ status: 'away', choice: 'available' }, 'ONLINE'))?.taking).toBe('Away · no new chats');
    expect(statusChoice(shownPresence({ status: 'online', choice: 'available' }, 'OFFLINE'))?.taking).toBe('Not taking chats');
    expect(statusChoice(null)).toBeNull();
  });
});

describe('desktop notifications off for WorkSuite (#251)', () => {
  it('says so, and Open System Settings opens the system’s page', async () => {
    const blocked: NotificationPermission = { state: 'blocked', detail: 'The system refused', failure: 'denied' };
    calls.mockImplementation(async (ch: string) => (ch === 'notifications:permission' ? blocked : ch === 'notifications:openSettings' ? true : null));
    wrap(<NotificationsOffBanner />);
    expect(await screen.findByText('Desktop notifications are off for WorkSuite')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith('notifications:openSettings'));
  });

  it('says nothing when the system has not refused (it cannot be read)', async () => {
    calls.mockResolvedValue({ state: 'unknown', detail: 'x', failure: null } satisfies NotificationPermission);
    const { container } = wrap(<NotificationsOffBanner />);
    await waitFor(() => expect(calls).toHaveBeenCalled());
    expect(container.querySelector('[data-notifications-off]')).toBeNull();
  });
});

describe('Send a test chat notification (#251)', () => {
  const three: RingTestStep[] = [
    { id: 'routed', label: 'Routed to you', state: 'ok', detail: 'New chats on worksuite.lk ring for you.' },
    { id: 'received', label: 'Received by this computer', state: 'ok', detail: 'Over the live connection, at once.' },
    { id: 'notification', label: 'Desktop notification shown', state: 'ok', detail: null },
  ];

  it('lists routed · received · notification shown · sound played', async () => {
    calls.mockImplementation(async (ch: string) => (ch === 'ring:test' ? three : { state: 'unknown', detail: '', failure: null }));
    wrap(<TestChatNotification volume={80} muted={false} ringtone="classic" ringOn="both" />);
    fireEvent.click(screen.getByRole('button', { name: 'Send a test chat notification' }));
    await waitFor(() => expect(document.querySelector('[data-step="sound"]')?.getAttribute('data-state')).toBe('ok'));
    expect([...document.querySelectorAll('[data-step]')].map((li) => [li.getAttribute('data-step'), li.getAttribute('data-state')])).toEqual([
      ['routed', 'ok'],
      ['received', 'ok'],
      ['notification', 'ok'],
      ['sound', 'ok'],
    ]);
    expect(screen.getByText('Routed to you')).toBeTruthy();
    expect(playTone).toHaveBeenCalledWith('webchat', 0.8, { ringtone: 'classic', ringOn: 'both' });
  });

  it('says why a step failed', async () => {
    calls.mockImplementation(async (ch: string) => (ch === 'ring:test' ? [{ ...three[0]!, state: 'fail', detail: 'You are not on any widget\'s staff list, so no chat rings for you.' }, three[1], three[2]] : null));
    wrap(<TestChatNotification volume={0} muted={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send a test chat notification' }));
    expect(await screen.findByText(/not on any widget's staff list/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('The ringing volume is at 0. Turn it up above.')).toBeTruthy());
  });

  it('the sound step: muted, silent volume, or a sound output that will not start', async () => {
    expect((await soundStep(80, true)).state).toBe('fail');
    expect((await soundStep(0, false)).detail).toMatch(/volume is at 0/);
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
      state = 'suspended';
      async resume() {}
      async close() {}
    };
    expect((await soundStep(80, false)).detail).toMatch(/would not start the sound/);
  });
});
