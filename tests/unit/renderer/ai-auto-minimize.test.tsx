// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';
import type * as Assistant from '../../../src/modules/ai/assistant';
import type { AskTurn, PendingAction } from '../../../src/modules/ai/assistant';
import type { SendOptions } from '../../../src/modules/ai/session';
import type { Tab } from '../../../src/core/tabs';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin' }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ enabled: true, reason: null, items: [], actions: [] })), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/modules/ai/assistant', async (orig) => ({ ...(await orig<typeof Assistant>()), ask: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn(), query: new URLSearchParams(), path: ['settings'] }), useTabTitle: () => undefined }));

const { call } = await import('../../../src/core/bridge');
const { ask } = await import('../../../src/modules/ai/assistant');
const { app } = await import('../../../src/core/app-state');
const { useStore } = await import('../../../src/core/store');
const { tabsStore } = await import('../../../src/core/tabs');
const { aiWidget, ui } = await import('../../../src/core/ui');
const { answerPreview, assistantSession } = await import('../../../src/modules/ai/session');
const { AiDock, aiNotice, useAssistantAlerts } = await import('../../../src/app/overlays/AiDock');
const { AiWidget } = await import('../../../src/app/overlays/AiWidget');
const { aiMinimized, mayAutoMinimize, useAutoMinimize } = await import('../../../src/app/overlays/aiMinimize');
const { AiSection } = await import('../../../src/modules/settings/SettingsPage');

const AI: Preferences['ai'] = { quickAsk: true, shortcut: 'Alt+Space', insert: true, dockAtStart: false, language: 'Sinhala', display: 'widget', sound: false, moduleAccess: { worksuite: {}, local: {} }, onlineFallback: true, autoMinimize: false, autoMinimizeWhenWorking: true };
const PREFS = { ai: AI, notificationsEnabled: true, notificationPrivacy: 'FULL', moduleNotifications: {}, dndEnabled: false, dndFrom: '22:00', dndTo: '07:00' } as unknown as Preferences;
const setAi = (ai: Partial<Preferences['ai']>, patch: Partial<Preferences> = {}) => app.set((s) => ({ prefs: { ...(s.prefs ?? PREFS), ...patch, ai: { ...AI, ...(s.prefs?.ai ?? {}), ...ai } } as Preferences }));

const ONLINE: SendOptions = { surface: 'assistant.panel', refs: [], local: false, online: true };
const turn = (reply: string, pending: PendingAction[] = []): AskTurn => ({ ok: true, reply, conversation_id: 4, tool_runs: [], sources: [], pending_actions: pending }) as unknown as AskTurn;
const card = (): PendingAction =>
  ({ id: 9, slug: 'invoice.create', name: 'Create invoice', risk: 'R1', status: 'awaiting_confirmation', version: 1, preview: { title: 'Invoice for Acme', lines: [], warnings: [] }, external_recipients: [], tainted: false, expires_at: new Date(Date.now() + 600_000).toISOString(), arguments: {} }) as PendingAction;

/** The server's answer, held until the test lets it go. */
function answerLater() {
  let answer: (t: AskTurn) => void = () => undefined;
  let fail: (e: Error) => void = () => undefined;
  vi.mocked(ask).mockImplementation(() => new Promise<AskTurn>((r, j) => ((answer = r), (fail = j))));
  return { answer: (t: AskTurn) => act(async () => answer(t)), fail: (e: Error) => act(async () => fail(e)) };
}

const tab = (id: string, appId: string): Tab => ({ id, route: `/${appId}`, title: appId, pinned: false, organizationId: null, app: appId, lastActive: 0, suspended: false, reloadKey: 0 }) as Tab;

/** The shell, in small: the workspace with the widget in it, and the drawer beside it. */
function Harness() {
  const dock = useStore(ui, (s) => s.dock);
  useAutoMinimize();
  useAssistantAlerts();
  return (
    <>
      <div data-ai-workspace="">
        <input aria-label="My work" />
        <AiWidget />
      </div>
      {dock === 'ai' ? <AiDock /> : null}
    </>
  );
}
const wrap = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const question = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
const bubble = () => screen.getByTestId('ai-bubble');
const work = () => screen.getByLabelText('My work') as HTMLInputElement;
async function askIt(q: string) {
  fireEvent.change(question(), { target: { value: q } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
}
/** A press (down and up) on an element, and what runs once it is over. */
async function press(el: Element) {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const switchTab = (id: string, appId: string) => act(() => tabsStore.set((s) => ({ tabs: [...s.tabs.filter((x) => x.id !== id), tab(id, appId)], activeId: id })));

beforeEach(() => {
  vi.mocked(ask).mockReset();
  vi.mocked(call).mockClear();
  assistantSession.cancel();
  assistantSession.reset();
  aiWidget.set({ open: false, maximized: false });
  aiNotice.set({ kind: null });
  aiMinimized.set({ on: false });
  ui.set({ dock: null });
  tabsStore.set({ tabs: [tab('t1', 'tasks')], activeId: 't1' });
  app.set({ prefs: PREFS, status: null, lock: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('auto-minimize when I continue working (#126)', () => {
  it('goes down to the floating button when the person clicks the workspace while it thinks, and keeps the conversation', async () => {
    answerLater();
    wrap(<Harness />);
    fireEvent.click(bubble());
    await askIt('What is due today?');
    // Thinking… at once.
    expect(screen.getByTestId('ai-thinking').textContent).toBe('Thinking…');
    // A draft and an attachment for the next question stay with the conversation.
    act(() => assistantSession.store.set({ files: [{ ref: 'upload:3', name: 'Budget.xlsx', via: 'upload' }] }));
    fireEvent.change(question(), { target: { value: 'And next week?' } });
    await press(work());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(assistantSession.store.get()).toMatchObject({ busy: true, text: 'And next week?' });
    expect(assistantSession.store.get().files).toHaveLength(1);
    expect(bubble().getAttribute('data-state')).toBe('thinking');
  });

  it('goes down when the person switches tabs, or opens another module in the same tab', async () => {
    answerLater();
    wrap(<Harness />);
    fireEvent.click(bubble());
    await askIt('What is due today?');
    work().focus();
    switchTab('t2', 'mail');
    expect(aiWidget.get().open).toBe(false);
    // Opened again, and another module in the same tab.
    fireEvent.click(bubble());
    work().focus();
    switchTab('t2', 'crm');
    expect(aiWidget.get().open).toBe(false);
  });

  it('stays open while the person is using it: typing in it, clicking in it, a shortcut pressed while typing', async () => {
    answerLater();
    wrap(<Harness />);
    fireEvent.click(bubble());
    await askIt('What is due today?');
    // Clicking inside the assistant is using it.
    await press(question());
    expect(aiWidget.get().open).toBe(true);
    // A tab shortcut pressed while typing in it, or a link in its answer, leaves it open.
    question().focus();
    switchTab('t2', 'mail');
    expect(aiWidget.get().open).toBe(true);
    // But a press outside it that switches the tab (the tab strip) puts it down, even with the focus still in it.
    const strip = document.createElement('button');
    document.body.appendChild(strip);
    fireEvent.pointerDown(strip);
    switchTab('t3', 'files');
    expect(aiWidget.get().open).toBe(false);
    strip.remove();
  });

  it('only while a question is on its way', async () => {
    vi.mocked(ask).mockResolvedValueOnce(turn('Two tasks.'));
    wrap(<Harness />);
    fireEvent.click(bubble());
    await askIt('What is due today?');
    expect(assistantSession.store.get().busy).toBe(false);
    await press(work());
    switchTab('t2', 'mail');
    expect(aiWidget.get().open).toBe(true);
  });

  it('not at all when Auto-minimize when I continue working is off', async () => {
    setAi({ autoMinimizeWhenWorking: false });
    answerLater();
    wrap(<Harness />);
    fireEvent.click(bubble());
    await askIt('What is due today?');
    expect(mayAutoMinimize()).toBe(false);
    await press(work());
    switchTab('t2', 'mail');
    expect(aiWidget.get().open).toBe(true);
  });

  it('never takes the focus: not when it goes down, and not when the answer arrives', async () => {
    const later = answerLater();
    wrap(<Harness />);
    fireEvent.click(bubble());
    await askIt('What is due today?');
    work().focus();
    await press(work());
    expect(document.activeElement).toBe(work());
    fireEvent.change(work(), { target: { value: 'typing on' } });
    await later.answer(turn('Two tasks are due.'));
    // Not opened again, and the typing carries on where it was.
    expect(aiWidget.get().open).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(work());
  });

  it('with the drawer: closes it to a floating button, and the button or View Result brings back the conversation', async () => {
    setAi({ display: 'drawer' });
    const later = answerLater();
    ui.set({ dock: 'ai' });
    wrap(<Harness />);
    await askIt('What is due today?');
    expect(screen.queryByTestId('ai-bubble')).toBeNull();
    await press(work());
    expect(ui.get().dock).toBeNull();
    expect(aiMinimized.get().on).toBe(true);
    expect(bubble().getAttribute('title')).toBe('Thinking…');
    await later.answer(turn('Two tasks are due.\nOne is overdue.\nThe other is today.\nAnd more.'));
    expect(bubble().getAttribute('data-state')).toBe('ready');
    expect(screen.getByTestId('ai-notice-preview').textContent).toBe('Two tasks are due. One is overdue. The other is today.');
    fireEvent.click(screen.getByRole('button', { name: 'View Result' }));
    expect(ui.get().dock).toBe('ai');
    expect(aiMinimized.get().on).toBe(false);
    expect(screen.getByText(/One is overdue/)).toBeTruthy();
    expect(screen.queryByTestId('ai-bubble')).toBeNull();
  });

  it('with the drawer: Minimize while working puts it down to the button; after Dismiss the answer still waits there until seen', async () => {
    setAi({ display: 'drawer' });
    const later = answerLater();
    ui.set({ dock: 'ai' });
    wrap(<Harness />);
    await askIt('What is due today?');
    fireEvent.click(screen.getByRole('button', { name: 'Minimize while working' }));
    expect(ui.get().dock).toBeNull();
    expect(bubble()).toBeTruthy();
    await later.answer(turn('Two tasks.'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('ai-notice')).toBeNull();
    expect(bubble().getAttribute('aria-label')).toBe('Ask AI — 1 new answer');
    fireEvent.click(bubble());
    expect(ui.get().dock).toBe('ai');
    expect(screen.getByText('Two tasks.')).toBeTruthy();
    // Seen: the drawer's floating button has nothing more to wait for.
    act(() => ui.set({ dock: null }));
    expect(screen.queryByTestId('ai-bubble')).toBeNull();
  });
});

describe('the floating button and its preview (#126)', () => {
  async function minimisedAsking() {
    const later = answerLater();
    wrap(<Harness />);
    fireEvent.click(bubble());
    await askIt('What is due today?');
    await press(work());
    return later;
  }

  it('animates with a Thinking… tooltip, a still dot under reduced motion, and says where it is politely', async () => {
    await minimisedAsking();
    expect(bubble().getAttribute('title')).toBe('Thinking…');
    expect(bubble().tagName).toBe('BUTTON');
    expect(screen.getByTestId('ai-launcher-busy').getAttribute('class')).toContain('motion-safe:animate-spin');
    expect(screen.getByTestId('ai-launcher-still').getAttribute('class')).toContain('motion-reduce:block');
    expect(screen.getByTestId('ai-launcher-still').getAttribute('class')).toContain('motion-safe:hidden');
    const status = screen.getAllByRole('status').find((s) => s.textContent === 'Thinking with online AI…');
    expect(status).toBeTruthy();
  });

  it('stops animating when done and shows a compact preview with View Result and Dismiss', async () => {
    const later = await minimisedAsking();
    await later.answer(turn('Two tasks are due today.'));
    expect(screen.queryByTestId('ai-launcher-busy')).toBeNull();
    expect(bubble().getAttribute('data-state')).toBe('ready');
    const notice = screen.getByTestId('ai-notice');
    expect(notice.textContent).toContain('Your answer is ready');
    expect(screen.getByTestId('ai-notice-preview').textContent).toBe('Two tasks are due today.');
    expect(notice.getAttribute('class')).toContain('motion-safe:');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('ai-notice')).toBeNull();
    // The answer still waits, counted; the button brings back the conversation and the answer.
    fireEvent.click(bubble());
    expect(screen.getByText('What is due today?')).toBeTruthy();
    expect(screen.getByText('Two tasks are due today.')).toBeTruthy();
  });

  it('View Result brings back the conversation and its latest answer', async () => {
    const later = await minimisedAsking();
    await later.answer(turn('Two tasks are due today.'));
    fireEvent.click(screen.getByRole('button', { name: 'View Result' }));
    expect(aiWidget.get().open).toBe(true);
    expect(screen.getByText('Two tasks are due today.')).toBeTruthy();
  });

  it('says Needs your input, with what waits, when a change needs approval — and nothing more runs until it is answered', async () => {
    const later = await minimisedAsking();
    await later.answer(turn('', [card()]));
    expect(bubble().getAttribute('data-state')).toBe('needsInput');
    expect(screen.getByTestId('ai-launcher-input')).toBeTruthy();
    expect(screen.getByTestId('ai-notice').textContent).toContain('Needs your input');
    expect(screen.getByTestId('ai-notice-preview').textContent).toBe('Invoice for Acme');
    expect(assistantSession.store.get()).toMatchObject({ phase: 'needsInput', busy: false });
    expect(ask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open Assistant' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('shows a failure clearly, and Try again sends the same request again', async () => {
    const later = await minimisedAsking();
    await later.fail(new Error('The server answered 502.'));
    expect(bubble().getAttribute('data-state')).toBe('failed');
    expect(screen.getByTestId('ai-launcher-failed')).toBeTruthy();
    expect(screen.getByTestId('ai-notice').textContent).toContain('The assistant could not answer');
    const again = answerLater();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ask).mock.calls[1]![0]).toBe(vi.mocked(ask).mock.calls[0]![0]);
    expect(bubble().getAttribute('data-state')).toBe('thinking');
    await again.answer(turn('Two tasks.'));
    expect(bubble().getAttribute('data-state')).toBe('ready');
  });

  it('offers Stop processing beside the button while it works', async () => {
    await minimisedAsking();
    fireEvent.click(screen.getByRole('button', { name: 'Stop processing' }));
    expect(assistantSession.store.get()).toMatchObject({ busy: false, phase: 'idle' });
    expect(screen.queryByRole('button', { name: 'Stop processing' })).toBeNull();
    expect(assistantSession.store.get().entries.at(-1)).toMatchObject({ stopped: true });
  });
});

describe('privacy and notifications (#126)', () => {
  it('says nothing of the answer while WorkSuite is locked', async () => {
    const entries = [{ role: 'user' as const, text: 'Salary of Asha?' }, { role: 'assistant' as const, text: 'Asha earns 200,000.' }];
    expect(answerPreview(entries, false)).toBe('Asha earns 200,000.');
    expect(answerPreview(entries, true)).toBe('');
    const later = answerLater();
    wrap(<Harness />);
    fireEvent.click(bubble());
    await askIt('Salary of Asha?');
    await press(work());
    act(() => app.set({ lock: { locked: true } as never }));
    await later.answer(turn('Asha earns 200,000.'));
    expect(screen.getByTestId('ai-notice')).toBeTruthy();
    expect(screen.queryByTestId('ai-notice-preview')).toBeNull();
    expect(screen.queryByText(/200,000/)).toBeNull();
  });

  it('asks for a desktop banner only while the window is not in front, and only as the notification settings allow', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    renderHook(() => useAssistantAlerts());
    const unseen = async (reply: string) => {
      vi.mocked(ask).mockResolvedValueOnce(turn(reply));
      assistantSession.store.set({ text: 'Anything due?' });
      await act(() => assistantSession.send(ONLINE));
    };
    await unseen('Two tasks.');
    expect(call).not.toHaveBeenCalledWith('ai:answerReady', expect.anything());
    focus.mockReturnValue(false);
    await unseen('Three tasks.');
    expect(call).toHaveBeenCalledWith('ai:answerReady', { kind: 'ready', preview: 'Three tasks.' });
    vi.mocked(call).mockClear();
    setAi({}, { notificationsEnabled: false });
    await unseen('Four tasks.');
    expect(call).not.toHaveBeenCalledWith('ai:answerReady', expect.anything());
  });
});

describe('Settings › AI Assistant (#126)', () => {
  it('has Auto-minimize when I continue working, on by default, and switches it', async () => {
    vi.mocked(call).mockImplementation(async (channel: string, input?: unknown) => (channel === 'settings:set' ? { preferences: { ...PREFS, ...(input as object) }, locks: [] } : null) as never);
    const prefs = { ...PREFS, ai: { ...AI, display: 'drawer' } } as Preferences;
    wrap(<AiSection prefs={prefs} />);
    const toggle = screen.getByRole('switch', { name: 'Auto-minimize when I continue working' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => fireEvent.click(toggle));
    expect(call).toHaveBeenCalledWith('settings:set', { ai: expect.objectContaining({ autoMinimizeWhenWorking: false }) });
  });

  it('is not offered while the assistant is hidden', () => {
    wrap(<AiSection prefs={{ ...PREFS, ai: { ...AI, display: 'hidden' } } as Preferences} />);
    expect(screen.queryByRole('switch', { name: 'Auto-minimize when I continue working' })).toBeNull();
  });
});
