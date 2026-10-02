// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import type * as AiDockModule from '../../../src/app/overlays/AiDock';
import type * as ChatDrawerModule from '../../../src/modules/chat/ChatDrawer';

/**
 * A screen that throws while it draws leaves the rest of the window working
 * (it used to leave an empty window: opening the AI dock, the Chat drawer or
 * the lock screen with a bad value in it unmounted everything).
 */

// The desktop bridge, answering every call with an empty value of any shape.
const empty = (): unknown => new Proxy([] as unknown[], { get: (t, k) => (k in t || typeof k === 'symbol' ? (t as never)[k] : k === 'then' ? undefined : empty()) });
const unlock = vi.fn(async () => ({ ok: false, message: 'That password is not right.' }));
window.worksuite = new Proxy(
  { platform: 'darwin', files: { registerDropped: async () => [] }, events: { on: () => () => undefined }, security: { unlockPassword: unlock } } as Record<string, unknown>,
  { get: (t, k: string) => (k in t ? t[k] : new Proxy({}, { get: () => async () => empty() })) },
) as never;
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;
Element.prototype.scrollIntoView ??= () => undefined;

const broken = vi.hoisted(() => ({ ai: false, chat: false }));
const Boom = (): never => {
  throw new Error('Cannot read properties of undefined (reading "length")');
};
vi.mock('../../../src/app/overlays/AiDock', async (orig) => {
  const real = await orig<typeof AiDockModule>();
  return { ...real, AiDock: () => (broken.ai ? <Boom /> : <real.AiDock />) };
});
vi.mock('../../../src/modules/chat/ChatDrawer', async (orig) => {
  const real = await orig<typeof ChatDrawerModule>();
  return { ...real, ChatDrawer: () => (broken.chat ? <Boom /> : <real.ChatDrawer />) };
});

const { app } = await import('../../../src/core/app-state');
const { queryClient } = await import('../../../src/core/query');
const { ui } = await import('../../../src/core/ui');
const { Shell } = await import('../../../src/layouts/Shell');
const { AppBoundary, LockBoundary } = await import('../../../src/app/Boundaries');

const signedIn = () =>
  app.set({
    ready: true,
    prefs: { pinnedApps: [], ai: { display: 'drawer' } } as never,
    apps: visibleApps({ apps: '*', permissions: ['*'] }),
    bootstrap: { permissions: ['*'], apps: ['*'], user: { id: '5', name: 'Hasarinda' } } as never,
    auth: { stage: 'ready', user: { id: '5', name: 'Hasarinda' } } as never,
  } as never);

const shell = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <AppBoundary>
        <Shell />
      </AppBoundary>
    </QueryClientProvider>,
  );

beforeEach(() => {
  broken.ai = false;
  broken.chat = false;
  ui.set({ dock: null, overlay: null } as never);
  signedIn();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a screen that fails to draw', () => {
  it('keeps the window when the AI dock fails, and closes the dock', async () => {
    broken.ai = true;
    shell();
    const ai = document.querySelector('button[aria-pressed]') as HTMLElement;
    await act(async () => fireEvent.click(ai));
    expect(screen.getByText('The AI Assistant stopped working')).toBeTruthy();
    expect(screen.getByText(/reading "length"/)).toBeTruthy();
    // The title bar and the rest are still there.
    expect(document.querySelector('button[title="Chat"]')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close' })));
    expect(ui.get().dock).toBeNull();
    expect(screen.queryByText('The AI Assistant stopped working')).toBeNull();
  });

  it('keeps the window when the Chat drawer fails', async () => {
    broken.chat = true;
    shell();
    await act(async () => fireEvent.click(document.querySelector('button[title="Chat"]') as HTMLElement));
    expect(screen.getByText('Chat stopped working')).toBeTruthy();
    expect(document.querySelector('button[aria-pressed]')).toBeTruthy();
  });

  it('says what went wrong for the whole window, instead of an empty one', async () => {
    render(
      <AppBoundary>
        <Boom />
      </AppBoundary>,
    );
    expect(screen.getByText('This screen stopped working')).toBeTruthy();
    expect(screen.getByText(/reading "length"/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reload window/ })).toBeTruthy();
  });

  it('stays locked when the lock screen fails, with a password to unlock', async () => {
    render(
      <LockBoundary>
        <Boom />
      </LockBoundary>,
    );
    expect(screen.getByText('WorkSuite is locked')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('WorkSuite password'), { target: { value: 'secret' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Unlock' })));
    expect(unlock).toHaveBeenCalledWith({ password: 'secret' });
    expect(screen.getByText('That password is not right.')).toBeTruthy();
  });
});
