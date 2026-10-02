// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Preferences } from '../../../shared/types';
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, hasDesktop: () => true, on: () => () => {}, isMac: false, errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn() }), useTabTitle: () => {} }));
const { app } = await import('../../../src/core/app-state');
const { SecuritySection } = await import('../../../src/modules/settings/SettingsPage');
let prefs: Preferences;
beforeEach(() => {
  bridge.call.mockReset();
  prefs = { appLockEnabled: true, appLockMinutes: 15, lockOnSystemLock: true, lockOnSleep: true, lockedChatNotifications: true, lockedCallNotifications: true, lockedNotificationSounds: true, lockedAnswerCalls: true, lockedAllowChat: false } as Preferences;
  app.set({ prefs, locks: [], bootstrap: null, lock: null });
  bridge.call.mockImplementation(async (_: string, patch?: Partial<Preferences>) => ({ preferences: { ...prefs, ...patch }, locks: [] }));
});
afterEach(cleanup);
it('requires explicit identity verification before disabling locking and keeps the dialog open on failure', async () => {
  render(<SecuritySection prefs={prefs} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Enable Lock Screen' }));
  expect(bridge.call).not.toHaveBeenCalled();
  const verify = screen.getByRole('button', { name: 'Verify and continue' }); expect(verify).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText(/WorkSuite password/), { target: { value: 'wrong' } });
  bridge.call.mockRejectedValueOnce(new Error('Incorrect password'));
  fireEvent.click(verify); await screen.findByRole('alert');
  expect(app.get().prefs?.appLockEnabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/WorkSuite password/), { target: { value: 'correct' } }); fireEvent.click(verify);
  await waitFor(() => expect(app.get().prefs?.appLockEnabled).toBe(false));
  expect(bridge.call).toHaveBeenLastCalledWith('settings:set', { appLockEnabled: false, verificationPassword: 'correct' });
});
it('explains the app-lock scope and exposes separate notification, sleep, call and chat controls', () => {
  render(<SecuritySection prefs={prefs} />);
  for (const name of ['Chat notifications', 'Incoming calls and ringing', 'Notification sounds while locked', 'Lock after computer sleep', 'Lock after operating-system lock', 'Answer Calls While Locked', 'Allow Chat While Locked']) expect(screen.getByRole('switch', { name })).toBeTruthy();
  expect(screen.getByText(/do not change or bypass/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Lock now' })).toBeTruthy();
});
it('explains and disables the organization-required enable toggle', () => {
  app.set({ locks: [{ key: 'appLockEnabled', reason: 'Your organization requires app locking.' }] });
  render(<SecuritySection prefs={prefs} />);
  expect(screen.getByRole('switch', { name: 'Enable Lock Screen' })).toHaveProperty('disabled', true);
  expect(screen.getByText('Your organization requires app locking.')).toBeTruthy();
});
