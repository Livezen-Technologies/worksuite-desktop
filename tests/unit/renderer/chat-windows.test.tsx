// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Registry from '../../../src/modules/registry';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  const { visibleApps } = await import('../../../shared/apps');
  return { app: createStore({ apps: visibleApps({ apps: '*', permissions: ['*'] }) }) };
});
vi.mock('../../../src/modules/registry', async (orig) => {
  const real = await orig<typeof Registry>();
  const Page = ({ route }: { route: string }) => <p>page {route}</p>;
  return { ...real, moduleFor: (id: string) => ({ id, manifest: { name: id }, component: Page, always: true }) };
});

import { call } from '../../../src/core/bridge';
import { flushDrafts, hasPendingDrafts, useDraft } from '../../../src/core/drafts';
import { guardWindowClose, holdWhileSending } from '../../../src/core/closeGuard';
import { openChatWindow } from '../../../src/modules/chat/window';
import { WindowRoot } from '../../../src/app/WindowRoot';

/**
 * Chats in windows of their own (worksuite-desktop#103): what was typed goes
 * with the conversation, closing never loses a draft or a picture still going
 * up, and a chat window can go back to the main one.
 */
const mocked = vi.mocked(call);
const calls = (ch: string) => mocked.mock.calls.filter(([c]) => c === ch) as unknown as [string, unknown][];
const order = (ch: string) => mocked.mock.invocationCallOrder[mocked.mock.calls.findIndex(([c]) => c === ch)] ?? -1;

beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation((async (ch: string) => (ch === 'offline:getDraft' ? null : ch === 'windows:state' ? { alwaysOnTop: false, id: 3 } : undefined)) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a chat in its own window', () => {
  it('saves what was typed before the window opens, and opens an ordinary (not on-top) window', async () => {
    const { result } = renderHook(() => useDraft('chat', 'room:5', ''));
    await act(async () => undefined);
    act(() => result.current.setValue('Half a sentence'));
    expect(hasPendingDrafts()).toBe(true);

    await openChatWindow(5, 'Design team');

    const save = calls('offline:saveDraft');
    expect(save).toHaveLength(1);
    expect(save[0]?.[1]).toEqual({ module: 'chat', context: 'room:5', content: 'Half a sentence' });
    expect(calls('windows:open')[0]?.[1]).toEqual({ kind: 'chat-mini', route: '/chat?room=5', title: 'Design team', alwaysOnTop: false });
    expect(order('offline:saveDraft')).toBeLessThan(order('windows:open'));
    expect(hasPendingDrafts()).toBe(false);
  });

  it('a call keeps its chat on top, beside it', async () => {
    await openChatWindow('9', undefined, { onTop: true });
    expect(calls('windows:open')[0]?.[1]).toEqual({ kind: 'chat-mini', route: '/chat?room=9', title: 'Chat', alwaysOnTop: true });
  });

  it('flushing twice saves once', async () => {
    const { result } = renderHook(() => useDraft('chat', 'room:6', ''));
    await act(async () => undefined);
    act(() => result.current.setValue('x'));
    await flushDrafts();
    await flushDrafts();
    expect(calls('offline:saveDraft')).toHaveLength(1);
  });
});

describe('closing a chat window', () => {
  const unload = (target: EventTarget) => {
    const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    target.dispatchEvent(e);
    return e;
  };

  it('closes at once when nothing is waiting', () => {
    const target = new EventTarget();
    const stop = guardWindowClose(target as unknown as Window);
    expect(unload(target).defaultPrevented).toBe(false);
    stop();
  });

  it('holds the close until the draft is saved, then closes itself', async () => {
    const target = new EventTarget();
    const stop = guardWindowClose(target as unknown as Window);
    const { result } = renderHook(() => useDraft('chat', 'room:7', ''));
    await act(async () => undefined);
    act(() => result.current.setValue('Not lost'));

    expect(unload(target).defaultPrevented).toBe(true);
    await act(async () => undefined);
    await act(async () => undefined);

    expect(calls('offline:saveDraft')[0]?.[1]).toMatchObject({ content: 'Not lost' });
    expect(calls('windows:close')).toHaveLength(1);
    expect(calls('windows:minimize')).toHaveLength(0);
    // The close it asks for goes through.
    expect(unload(target).defaultPrevented).toBe(false);
    stop();
  });

  it('steps out of the way while a picture is still going up, and closes when it is sent', async () => {
    const target = new EventTarget();
    const stop = guardWindowClose(target as unknown as Window);
    let finish!: () => void;
    void holdWhileSending(new Promise<void>((r) => (finish = r)));

    expect(unload(target).defaultPrevented).toBe(true);
    expect(calls('windows:minimize')).toHaveLength(1);
    await act(async () => undefined);
    expect(calls('windows:close')).toHaveLength(0);

    await act(async () => finish());
    await act(async () => undefined);
    expect(calls('windows:close')).toHaveLength(1);
    stop();
  });
});

describe('the chat window title bar', () => {
  it('offers Open in main app, which saves the draft first', async () => {
    render(<WindowRoot hash="#/window/chat-mini?route=%2Fchat%3Froom%3D5" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in main app' }));
    await act(async () => undefined);
    expect(calls('windows:toMain')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Keep on top' })).toBeTruthy();
  });

  it('a record window has no Open in main app (it docks instead)', () => {
    render(<WindowRoot hash="#/window/record?route=%2Fmail" />);
    expect(screen.queryByRole('button', { name: 'Open in main app' })).toBeNull();
  });
});
