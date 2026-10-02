// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';
import type * as Assistant from '../../../src/modules/ai/assistant';
import type { AskTurn } from '../../../src/modules/ai/assistant';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin' }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ enabled: true, reason: null, items: [], actions: [] })), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/modules/ai/assistant', async (orig) => ({ ...(await orig<typeof Assistant>()), ask: vi.fn() }));

const { ask } = await import('../../../src/modules/ai/assistant');
const { app } = await import('../../../src/core/app-state');
const { aiWidget, openAssistant, toggleAssistant, ui } = await import('../../../src/core/ui');
const { assistantSession, createAskSession } = await import('../../../src/modules/ai/session');
const { AiDock, useAssistantAlerts, useAssistantFollowsDisplay } = await import('../../../src/app/overlays/AiDock');
const { AiWidget } = await import('../../../src/app/overlays/AiWidget');

const AI: Preferences['ai'] = { quickAsk: true, shortcut: 'Alt+Space', insert: true, dockAtStart: false, language: 'Sinhala', display: 'widget', sound: false, moduleAccess: { worksuite: {}, local: {} }, onlineFallback: true, autoMinimize: false, autoMinimizeWhenWorking: true };
const setAi = (patch: Partial<Preferences['ai']>) => app.set((s) => ({ prefs: { ...(s.prefs ?? {}), ai: { ...AI, ...(s.prefs?.ai ?? {}), ...patch } } as Preferences }));

const turn = (reply: string): AskTurn => ({ ok: true, reply, conversation_id: 4, tool_runs: [], sources: [], pending_actions: [] }) as unknown as AskTurn;
/** The server's answer, held until the test lets it go. */
function answerLater() {
  let answer: (t: AskTurn) => void = () => undefined;
  vi.mocked(ask).mockImplementation(() => new Promise<AskTurn>((r) => (answer = r)));
  return (reply: string) => act(async () => answer(turn(reply)));
}
const wrap = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const question = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
const launcher = () => screen.getByRole('button', { name: /^Ask AI/ });
async function askIt(q: string) {
  fireEvent.change(question(), { target: { value: q } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
}

beforeEach(() => {
  vi.mocked(ask).mockReset();
  assistantSession.reset();
  aiWidget.set({ open: false, maximized: false });
  ui.set({ dock: null });
  app.set({ prefs: { ai: AI } as Preferences });
});
afterEach(cleanup);

describe('one conversation, kept outside the panels (#61)', () => {
  it('counts an answer that arrives while no panel shows it, tells whoever listens, and clears when shown', async () => {
    const session = createAskSession();
    const heard = vi.fn();
    session.onUnseen(heard);
    vi.mocked(ask).mockResolvedValueOnce(turn('Two tasks are due.'));
    session.store.set({ text: 'What is due?' });
    await session.send({ surface: 'assistant.panel', refs: [], local: false, online: true });
    expect(session.store.get().unread).toBe(1);
    expect(heard).toHaveBeenCalledTimes(1);
    const close = session.view();
    expect(session.store.get().unread).toBe(0);
    vi.mocked(ask).mockResolvedValueOnce(turn('And one meeting.'));
    session.store.set({ text: 'Anything else?' });
    await session.send({ surface: 'assistant.panel', refs: [], local: false, online: true });
    expect(session.store.get().unread).toBe(0);
    expect(heard).toHaveBeenCalledTimes(1);
    close();
    expect(session.store.get().viewers).toBe(0);
  });

  it('starts a new conversation only between answers', async () => {
    const session = createAskSession();
    let answer: (t: AskTurn) => void = () => undefined;
    vi.mocked(ask).mockImplementationOnce(() => new Promise<AskTurn>((r) => (answer = r)));
    session.store.set({ text: 'What is due?' });
    const sent = session.send({ surface: 'assistant.panel', refs: [], local: false, online: true });
    session.reset();
    expect(session.store.get().entries).toHaveLength(1);
    answer(turn('Two tasks.'));
    await sent;
    session.reset();
    expect(session.store.get().entries).toHaveLength(0);
    expect(session.store.get().conversationId).toBeNull();
  });
});

describe('the floating widget (#61)', () => {
  it('is a launcher in widget mode only', () => {
    setAi({ display: 'drawer' });
    const r = wrap(<AiWidget />);
    expect(screen.queryByRole('button', { name: /^Ask AI/ })).toBeNull();
    setAi({ display: 'hidden' });
    r.rerender(<QueryClientProvider client={new QueryClient()}><AiWidget /></QueryClientProvider>);
    expect(screen.queryByRole('button', { name: /^Ask AI/ })).toBeNull();
    setAi({ display: 'widget' });
    r.rerender(<QueryClientProvider client={new QueryClient()}><AiWidget /></QueryClientProvider>);
    expect(launcher()).toBeTruthy();
  });

  it('opens with the question box focused, minimises mid-answer without losing it, turns while it works, and counts the answer', async () => {
    const answer = answerLater();
    wrap(<AiWidget />);
    fireEvent.click(launcher());
    expect(screen.getByRole('dialog', { name: 'AI Assistant' })).toBeTruthy();
    expect(document.activeElement).toBe(question());
    await askIt('What is due today?');
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    // Down to the launcher: it turns while the answer is coming, and says so.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('ai-launcher-busy')).toBeTruthy();
    expect(launcher().getAttribute('aria-label')).toBe('Ask AI — Thinking with online AI…');
    expect(document.activeElement).toBe(launcher());
    await answer('Two tasks are due.');
    // It stopped turning, and the answer waits, counted.
    expect(screen.queryByTestId('ai-launcher-busy')).toBeNull();
    expect(launcher().getAttribute('aria-label')).toBe('Ask AI — 1 new answer');
    fireEvent.click(launcher());
    expect(screen.getByText('What is due today?')).toBeTruthy();
    expect(screen.getByText('Two tasks are due.')).toBeTruthy();
    expect(assistantSession.store.get().unread).toBe(0);
  });

  it('stops turning when an answer fails, too', async () => {
    vi.mocked(ask).mockRejectedValueOnce(new Error('The server answered 502.'));
    wrap(<AiWidget />);
    fireEvent.click(launcher());
    await askIt('What is due today?');
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(screen.queryByTestId('ai-launcher-busy')).toBeNull();
  });

  it('keeps the question being written, maximises and restores, and minimises on Escape', () => {
    wrap(<AiWidget />);
    fireEvent.click(launcher());
    fireEvent.change(question(), { target: { value: 'Draft a reply to' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(dialog.className).toContain('inset-3');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(dialog.className).not.toContain('inset-3');
    fireEvent.keyDown(question(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(launcher());
    fireEvent.click(launcher());
    expect(question().value).toBe('Draft a reply to');
    fireEvent.click(screen.getByRole('button', { name: 'Close AI Assistant' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(launcher());
    expect(question().value).toBe('Draft a reply to');
  });
});

describe('switching the display mode (#61)', () => {
  it('carries the same conversation from the drawer to the widget, open', async () => {
    setAi({ display: 'drawer' });
    vi.mocked(ask).mockResolvedValueOnce(turn('Two tasks are due.'));
    const follow = renderHook(() => useAssistantFollowsDisplay());
    openAssistant();
    expect(ui.get().dock).toBe('ai');
    const dock = wrap(<AiDock />);
    await askIt('What is due today?');
    dock.unmount();
    act(() => setAi({ display: 'widget' }));
    follow.rerender();
    expect(ui.get().dock).toBeNull();
    expect(aiWidget.get().open).toBe(true);
    wrap(<AiWidget />);
    expect(screen.getByText('What is due today?')).toBeTruthy();
    expect(screen.getByText('Two tasks are due.')).toBeTruthy();
  });

  it('opens where the person keeps it: the shortcut toggles the widget in widget mode, the drawer otherwise', () => {
    toggleAssistant();
    expect(aiWidget.get().open).toBe(true);
    expect(ui.get().dock).toBeNull();
    toggleAssistant();
    expect(aiWidget.get().open).toBe(false);
    setAi({ display: 'hidden' });
    openAssistant();
    expect(ui.get().dock).toBe('ai');
  });
});

describe('the sound for new answers (#61)', () => {
  it('plays for an answer that arrives unseen, only when it is on', async () => {
    const made = vi.fn();
    class FakeAudio {
      currentTime = 0;
      destination = {};
      constructor() {
        made();
      }
      createGain = () => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() });
      createOscillator = () => ({ frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() });
      close = () => Promise.resolve();
    }
    vi.stubGlobal('AudioContext', FakeAudio);
    renderHook(() => useAssistantAlerts());
    const unseen = async (reply: string) => {
      vi.mocked(ask).mockResolvedValueOnce(turn(reply));
      assistantSession.store.set({ text: 'Anything due?' });
      await act(() => assistantSession.send({ surface: 'assistant.panel', refs: [], local: false, online: true }));
    };
    await unseen('Nothing.');
    expect(made).not.toHaveBeenCalled();
    setAi({ sound: true });
    await unseen('Still nothing.');
    expect(made).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

it('uses a minimized launcher when no display preference was saved (#127)', () => {
  app.set({ prefs: { ai: { ...AI, display: undefined } } as unknown as Preferences });
  wrap(<AiWidget />);
  expect(launcher().getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => openAssistant());
  expect(aiWidget.get().open).toBe(true);
  expect(ui.get().dock).toBeNull();
});
