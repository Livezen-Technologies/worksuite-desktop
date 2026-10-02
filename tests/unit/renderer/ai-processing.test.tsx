// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';
import type * as LocalAi from '../../../src/core/local-ai';
import type * as Assistant from '../../../src/modules/ai/assistant';
import type { AskTurn, PendingAction } from '../../../src/modules/ai/assistant';
import type { AskPhase, SendOptions } from '../../../src/modules/ai/session';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin' }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ enabled: true, reason: null, items: [], actions: [] })), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/local-ai', async (orig) => ({ ...(await orig<typeof LocalAi>()), askLocal: vi.fn() }));
vi.mock('../../../src/modules/ai/assistant', async (orig) => ({ ...(await orig<typeof Assistant>()), ask: vi.fn() }));

const { ask } = await import('../../../src/modules/ai/assistant');
const { askLocal } = await import('../../../src/core/local-ai');
const { app } = await import('../../../src/core/app-state');
const { aiWidget, ui } = await import('../../../src/core/ui');
const { assistantSession, createAskSession, nextPhase, phaseLabel } = await import('../../../src/modules/ai/session');
const { aiNotice, assistantMayNotify, useAssistantAlerts } = await import('../../../src/app/overlays/AiDock');
const { AiWidget } = await import('../../../src/app/overlays/AiWidget');

const AI: Preferences['ai'] = { quickAsk: true, shortcut: 'Alt+Space', insert: true, dockAtStart: false, language: 'Sinhala', display: 'widget', sound: false, moduleAccess: { worksuite: {}, local: {} }, onlineFallback: true, autoMinimize: false, autoMinimizeWhenWorking: true };
const PREFS = { ai: AI, notificationsEnabled: true, moduleNotifications: {}, dndEnabled: false, dndFrom: '22:00', dndTo: '07:00' } as unknown as Preferences;
const setPrefs = (patch: Partial<Preferences>, ai: Partial<Preferences['ai']> = {}) => app.set((s) => ({ prefs: { ...(s.prefs ?? PREFS), ...patch, ai: { ...AI, ...(s.prefs?.ai ?? {}), ...ai } } as Preferences }));

const ONLINE: SendOptions = { surface: 'assistant.panel', refs: [], local: false, online: true };
const LOCAL: SendOptions = { surface: 'assistant.panel', refs: [], local: true, online: false };
const turn = (reply: string, pending: PendingAction[] = []): AskTurn => ({ ok: true, reply, conversation_id: 4, tool_runs: [], sources: [], pending_actions: pending }) as unknown as AskTurn;
const card = (status: PendingAction['status'] = 'awaiting_confirmation'): PendingAction =>
  ({ id: 9, slug: 'invoice.create', name: 'Create invoice', risk: 'R1', status, version: 1, preview: { title: 'Invoice for Acme', lines: [], warnings: [] }, external_recipients: [], tainted: false, expires_at: new Date(Date.now() + 600_000).toISOString(), arguments: {} }) as PendingAction;

/** The server's answer, held until the test lets it go. */
function answerLater() {
  let answer: (t: AskTurn) => void = () => undefined;
  let fail: (e: Error) => void = () => undefined;
  vi.mocked(ask).mockImplementation(() => new Promise<AskTurn>((r, j) => ((answer = r), (fail = j))));
  return { answer: (t: AskTurn) => act(async () => answer(t)), fail: (e: Error) => act(async () => fail(e)) };
}
/** The model on this computer, streaming as the test says. */
function localLater() {
  let onText: (t: string) => void = () => undefined;
  let finish: (v: { text: string; cancelled: boolean; tokens: number; ms: number }) => void = () => undefined;
  const cancel = vi.fn();
  vi.mocked(askLocal).mockImplementation((_m, cb) => {
    onText = cb;
    return { id: 'x', done: new Promise((r) => (finish = r)), cancel } as unknown as ReturnType<typeof askLocal>;
  });
  return { stream: (t: string) => onText(t), done: (text: string) => finish({ text, cancelled: false, tokens: 1, ms: 1 }), cancel };
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
  vi.mocked(askLocal).mockReset();
  assistantSession.cancel();
  assistantSession.reset();
  aiWidget.set({ open: false, maximized: false });
  aiNotice.set({ kind: null });
  ui.set({ dock: null });
  app.set({ prefs: PREFS, status: null });
});
afterEach(cleanup);

describe('one state machine for where a question is (#110)', () => {
  it('moves thinking → working → complete, needs input, failed, and stops; other events change nothing', () => {
    const walk = (from: AskPhase, ...events: Parameters<typeof nextPhase>[1][]) => events.reduce(nextPhase, from);
    expect(walk('idle', 'send')).toBe('thinking');
    expect(walk('idle', 'send', 'progress')).toBe('working');
    expect(walk('idle', 'send', 'progress', 'answer')).toBe('complete');
    expect(walk('idle', 'send', 'answer')).toBe('complete');
    expect(walk('idle', 'send', 'progress', 'ask')).toBe('needsInput');
    expect(walk('idle', 'send', 'ask', 'settled')).toBe('complete');
    expect(walk('idle', 'send', 'fail')).toBe('failed');
    expect(walk('idle', 'send', 'progress', 'stop')).toBe('idle');
    // Try again from a failure, or a new question after an answer, thinks again.
    expect(walk('failed', 'send')).toBe('thinking');
    expect(walk('complete', 'send')).toBe('thinking');
    // Nothing on its way: no progress, answer or stop to have.
    expect(walk('idle', 'progress', 'answer', 'stop')).toBe('idle');
    expect(walk('complete', 'fail')).toBe('complete');
    // A second send while thinking does not start over, and a reset waits for the answer.
    expect(walk('working', 'send', 'reset')).toBe('working');
    expect(walk('needsInput', 'reset')).toBe('idle');
  });

  it('says where the answer comes from, idle and active, instead of a fixed "Processing locally"', () => {
    expect(phaseLabel('idle', 'local')).toBe('On this computer · Ready');
    expect(phaseLabel('idle', 'online')).toBe('Online AI · Ready');
    expect(phaseLabel('thinking', 'local')).toBe('Thinking on this computer…');
    expect(phaseLabel('thinking', 'online')).toBe('Thinking with online AI…');
    expect(phaseLabel('thinking', null)).toBe('Thinking…');
    expect(phaseLabel('working', 'local')).toBe('Working on this computer…');
    expect(phaseLabel('needsInput', 'online')).toBe('Needs your input');
    expect(phaseLabel('complete', 'online')).toBe('Your answer is ready');
    expect(phaseLabel('failed', 'online')).toBe('The assistant could not answer');
  });

  it('thinks, works while the local answer streams, and completes', async () => {
    const session = createAskSession();
    const m = localLater();
    session.store.set({ text: 'What is 2+2?' });
    const sent = session.send(LOCAL);
    expect(session.store.get()).toMatchObject({ phase: 'thinking', busy: true, engine: 'local' });
    m.stream('Fo');
    expect(session.store.get()).toMatchObject({ phase: 'working', busy: true, streaming: 'Fo' });
    m.done('Four.');
    await sent;
    expect(session.store.get()).toMatchObject({ phase: 'complete', busy: false, streaming: null });
    expect(session.store.get().entries.at(-1)).toMatchObject({ text: 'Four.', local: true });
  });

  it('needs input when a change waits for confirmation, and completes only once it is confirmed or cancelled', async () => {
    const session = createAskSession();
    vi.mocked(ask).mockResolvedValueOnce(turn('I prepared the invoice.', [card()]));
    session.store.set({ text: 'Invoice Acme' });
    await session.send(ONLINE);
    expect(session.store.get().phase).toBe('needsInput');
    // Nothing was applied: the card is still waiting, as the server sent it.
    expect(session.store.get().entries.at(-1)!.turn!.pending_actions![0]!.status).toBe('awaiting_confirmation');
    session.settle(card('succeeded'));
    expect(session.store.get().phase).toBe('complete');
    // The card's new state is kept with the conversation, for when it is opened again.
    expect(session.store.get().entries.at(-1)!.turn!.pending_actions![0]!.status).toBe('succeeded');
  });

  it('fails, and Try again thinks again and completes', async () => {
    const session = createAskSession();
    vi.mocked(ask).mockRejectedValueOnce(new Error('The server answered 502.'));
    session.store.set({ text: 'What is due?' });
    await session.send(ONLINE);
    expect(session.store.get().phase).toBe('failed');
    const later = answerLater();
    const again = session.retry();
    expect(session.store.get().phase).toBe('thinking');
    await later.answer(turn('Two tasks.'));
    await again;
    expect(session.store.get().phase).toBe('complete');
  });

  it('Stop processing stops a local answer where it is, keeps what arrived, and offers Try again', async () => {
    const session = createAskSession();
    const m = localLater();
    session.store.set({ text: 'Write a poem' });
    const sent = session.send(LOCAL);
    m.stream('Roses are');
    session.cancel();
    expect(m.cancel).toHaveBeenCalled();
    expect(session.store.get()).toMatchObject({ phase: 'idle', busy: false, streaming: null, unread: 0 });
    // Late text after Stop changes nothing.
    m.stream('Roses are red');
    m.done('Roses are red');
    await sent;
    const last = session.store.get().entries.at(-1)!;
    expect(last).toMatchObject({ text: 'Roses are', stopped: true });
    expect(last.retry).toBeTruthy();
    expect(session.store.get().entries).toHaveLength(2);
  });

  it('Stop processing stops waiting for online AI, and an answer that comes after is not shown', async () => {
    const session = createAskSession();
    const later = answerLater();
    session.store.set({ text: 'What is due?' });
    const sent = session.send(ONLINE);
    expect(session.store.get()).toMatchObject({ phase: 'thinking', engine: 'online' });
    session.cancel();
    await sent;
    expect(session.store.get().phase).toBe('idle');
    await later.answer(turn('Two tasks.'));
    expect(session.store.get().entries.map((e) => e.text)).toEqual(['What is due?', 'Stopped.']);
    expect(session.store.get().unread).toBe(0);
    // Try again asks the same question in place of the stopped one.
    vi.mocked(ask).mockResolvedValueOnce(turn('Two tasks.'));
    await session.retry();
    expect(session.store.get().entries.map((e) => e.text)).toEqual(['What is due?', 'Two tasks.']);
    expect(session.store.get().phase).toBe('complete');
  });
});

describe('processing in the background (#110)', () => {
  it('carries on with the widget minimised and then gone altogether, and the answer waits, counted', async () => {
    const later = answerLater();
    const r = wrap(<AiWidget />);
    fireEvent.click(launcher());
    await askIt('What is due today?');
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    // Changing modules can take the whole tree away; the question is the session's, not the panel's.
    r.unmount();
    expect(assistantSession.store.get().busy).toBe(true);
    await later.answer(turn('Two tasks are due.'));
    expect(assistantSession.store.get()).toMatchObject({ phase: 'complete', unread: 1 });
    wrap(<AiWidget />);
    expect(launcher().getAttribute('aria-label')).toBe('Ask AI — 1 new answer');
    expect(screen.queryByTestId('ai-launcher-busy')).toBeNull();
  });

  it('offers Minimize while working and Stop processing while it works, and says Thinking… at once', async () => {
    answerLater();
    wrap(<AiWidget />);
    fireEvent.click(launcher());
    await askIt('What is due today?');
    expect(screen.getByTestId('ai-thinking').textContent).toBe('Thinking…');
    expect(screen.getByTestId('ai-mode').textContent).toBe('Thinking with online AI…');
    expect(screen.getByRole('button', { name: 'Stop processing' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize while working' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // The launcher turns, with a still mark for reduced motion; its tooltip says Thinking… and its name where it is (#126).
    const ring = screen.getByTestId('ai-launcher-busy');
    expect(ring.getAttribute('class')).toContain('motion-safe:animate-spin');
    expect(screen.getByTestId('ai-launcher-still').getAttribute('class')).toContain('motion-reduce:block');
    expect(launcher().getAttribute('title')).toBe('Thinking…');
    expect(launcher().getAttribute('aria-label')).toBe('Ask AI — Thinking with online AI…');
  });

  it('auto-minimizes after sending only when that setting is on', async () => {
    answerLater();
    wrap(<AiWidget />);
    fireEvent.click(launcher());
    await askIt('First?');
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => assistantSession.cancel());
    act(() => setPrefs({}, { autoMinimize: true }));
    await askIt('Second?');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('ai-launcher-busy')).toBeTruthy();
  });

  it('brings back the conversation, the question being written, the files and the answer on its way', async () => {
    const m = localLater();
    wrap(<AiWidget />);
    fireEvent.click(launcher());
    act(() => assistantSession.store.set({ files: [{ ref: 'upload:3', name: 'Budget.xlsx', via: 'upload' }] }));
    let sent: Promise<void> = Promise.resolve();
    act(() => {
      sent = assistantSession.send(LOCAL, 'Summarise it');
    });
    act(() => m.stream('The budget is'));
    fireEvent.change(question(), { target: { value: 'And next year?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(screen.queryByText('The budget is')).toBeNull();
    fireEvent.click(launcher());
    expect(screen.getByText('Summarise it')).toBeTruthy();
    expect(screen.getByText('The budget is')).toBeTruthy();
    expect(question().value).toBe('And next year?');
    expect(screen.getByText('Budget.xlsx')).toBeTruthy();
    await act(async () => {
      m.done('The budget is fine.');
      await sent;
    });
  });
});

describe('the notice when an answer is ready (#110)', () => {
  async function answerUnseen(t: AskTurn | Error) {
    if (t instanceof Error) vi.mocked(ask).mockRejectedValueOnce(t);
    else vi.mocked(ask).mockResolvedValueOnce(t);
    assistantSession.store.set({ text: 'Anything due?' });
    await act(() => assistantSession.send(ONLINE));
  }

  it('says Your answer is ready with View Result, without taking the focus or opening the assistant', async () => {
    renderHook(() => useAssistantAlerts());
    wrap(
      <>
        <input aria-label="Elsewhere" />
        <AiWidget />
      </>,
    );
    const elsewhere = screen.getByLabelText('Elsewhere');
    elsewhere.focus();
    await answerUnseen(turn('Two tasks.'));
    const notice = screen.getByTestId('ai-notice');
    expect(notice.textContent).toContain('Your answer is ready');
    expect(notice.closest('[role="status"]')!.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    expect(aiWidget.get().open).toBe(false);
    // Fades in only where motion is welcome.
    expect(notice.getAttribute('class')).toContain('motion-safe:animate-');
    // The badge counts it too.
    expect(launcher().getAttribute('aria-label')).toBe('Ask AI — 1 new answer');
    fireEvent.click(screen.getByRole('button', { name: 'View Result' }));
    expect(aiWidget.get().open).toBe(true);
    expect(screen.queryByTestId('ai-notice')).toBeNull();
    expect(screen.getByText('Two tasks.')).toBeTruthy();
  });

  it('says Needs your input with Open Assistant when a change waits for confirmation', async () => {
    renderHook(() => useAssistantAlerts());
    wrap(<AiWidget />);
    await answerUnseen(turn('I prepared the invoice.', [card()]));
    expect(screen.getByTestId('ai-notice').textContent).toContain('Needs your input');
    expect(launcher().getAttribute('aria-label')).toBe('Ask AI — Needs your input');
    expect(screen.getByTestId('ai-launcher-input')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Assistant' }));
    expect(aiWidget.get().open).toBe(true);
    // Confirming stays on the card, as before.
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('says so when it failed, and can be put away', async () => {
    renderHook(() => useAssistantAlerts());
    wrap(<AiWidget />);
    await answerUnseen(new Error('The server answered 502.'));
    expect(screen.getByTestId('ai-notice').textContent).toContain('The assistant could not answer');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('ai-notice')).toBeNull();
  });

  it('shows in the drawer mode too, in the corner, while the drawer is closed', async () => {
    setPrefs({}, { display: 'drawer' });
    renderHook(() => useAssistantAlerts());
    wrap(<AiWidget />);
    await answerUnseen(turn('Two tasks.'));
    expect(screen.getByTestId('ai-notice')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View Result' }));
    expect(ui.get().dock).toBe('ai');
  });

  it('stays quiet — no notice, no sound — with notifications off, the AI Assistant muted, paused or in Do not disturb; the badge still counts', async () => {
    const made = vi.fn();
    vi.stubGlobal(
      'AudioContext',
      class {
        currentTime = 0;
        destination = {};
        constructor() {
          made();
        }
        createGain = () => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() });
        createOscillator = () => ({ frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() });
        close = () => Promise.resolve();
      },
    );
    setPrefs({ notificationsEnabled: false }, { sound: true });
    renderHook(() => useAssistantAlerts());
    wrap(<AiWidget />);
    await answerUnseen(turn('Two tasks.'));
    expect(screen.queryByTestId('ai-notice')).toBeNull();
    expect(made).not.toHaveBeenCalled();
    expect(launcher().getAttribute('aria-label')).toBe('Ask AI — 1 new answer');
    // On again: the notice and the chime.
    act(() => setPrefs({ notificationsEnabled: true }));
    await answerUnseen(turn('Still two.'));
    expect(screen.getByTestId('ai-notice')).toBeTruthy();
    expect(made).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('follows the notification settings', () => {
    const at = new Date(2026, 9, 2, 23, 0);
    expect(assistantMayNotify(PREFS, null, at)).toBe(true);
    expect(assistantMayNotify({ ...PREFS, notificationsEnabled: false }, null, at)).toBe(false);
    expect(assistantMayNotify({ ...PREFS, moduleNotifications: { ai: false } }, null, at)).toBe(false);
    expect(assistantMayNotify({ ...PREFS, moduleNotifications: { 'cat:ai': false } }, null, at)).toBe(false);
    expect(assistantMayNotify({ ...PREFS, dndEnabled: true }, null, at)).toBe(false);
    expect(assistantMayNotify({ ...PREFS, dndEnabled: true }, null, new Date(2026, 9, 2, 12, 0))).toBe(true);
    expect(assistantMayNotify(PREFS, new Date(at.getTime() + 60_000).toISOString(), at)).toBe(false);
    expect(assistantMayNotify(PREFS, new Date(at.getTime() - 60_000).toISOString(), at)).toBe(true);
  });
});
