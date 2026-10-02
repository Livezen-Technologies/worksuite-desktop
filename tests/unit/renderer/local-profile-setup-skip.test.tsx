// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** #141: the Local Profile window never shows the required-picture screen or the setup wizard (where Local AI is set up). */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: Error) => e.message, isMac: false, platform: 'linux', registerDropped: vi.fn() }));
const { App } = await import('../../../src/app/App');
const { app } = await import('../../../src/core/app-state');

afterEach(() => { cleanup(); window.location.hash = ''; });
describe('Local Profile skips account setup', () => {
  it('opens the Local Profile even where an account would owe a picture and setup', async () => {
    bridge.call.mockImplementation(async (ch: string) => ch === 'local:status' ? { profile: null, locked: false, language: 'en' } : undefined);
    app.set({ ready: true, auth: { stage: 'ready', setupPending: true } as never, bootstrap: { offline: false, user: { id: '1', pictureRequired: true } } as never });
    window.location.hash = `#/window/meet?route=${encodeURIComponent('/guest-workspace')}`;
    render(<App />);
    expect(await screen.findByText('Set up your Local Profile')).toBeTruthy();
    expect(screen.queryByText('Add your profile picture')).toBeNull();
    expect(screen.queryByText(/Local AI|AI model/i)).toBeNull();
    expect(bridge.call.mock.calls.every(([ch]) => String(ch).startsWith('local:'))).toBe(true);
  });
});
