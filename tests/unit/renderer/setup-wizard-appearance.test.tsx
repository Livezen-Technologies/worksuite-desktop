// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Bridge from '../../../src/core/bridge';

/** First-run setup: the Appearance and language step, and the apps on the last step. */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: bridge.call, on: () => () => undefined, hasDesktop: () => true }));

const { app } = await import('../../../src/core/app-state');
const { SetupWizard } = await import('../../../src/app/onboarding/Onboarding');

describe('SetupWizard', () => {
  beforeEach(() => {
    bridge.call.mockReset();
    bridge.call.mockImplementation(async (ch: string, patch: Record<string, unknown>) => (ch === 'settings:set' ? { preferences: { ...app.get().prefs, ...patch }, locks: {} } : {}));
    app.set({
      bootstrap: { organizations: [] } as never,
      prefs: { theme: 'system', language: 'en', notificationPrivacy: 'SENDER_ONLY', startWithOs: true, startMinimized: false, minimizeToTray: true } as never,
      apps: [{ id: 'drive', label: 'Drive' }, { id: 'calendar', label: 'Calendar' }] as never,
      auth: { stage: 'ready', account: { kind: 'personal' } } as never,
    });
  });
  afterEach(cleanup);

  it('starts on Appearance, saves the theme, and lists the apps at the end', async () => {
    render(<SetupWizard />);
    expect(screen.getByText('Appearance and language')).toBeTruthy();
    fireEvent.click(screen.getByText('Dark'));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('settings:set', { theme: 'dark' }));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText("You're all set")).toBeTruthy();
    expect(screen.getByText('Your personal workspace is ready.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Your apps' }).textContent).toContain('Drive');
  });
});
