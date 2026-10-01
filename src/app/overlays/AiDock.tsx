import { useEffect } from 'react';
import { app } from '../../core/app-state';
import { call, isMac } from '../../core/bridge';
import { t } from '../../core/i18n';
import { createStore, useStore } from '../../core/store';
import { navigate, tabsStore } from '../../core/tabs';
import { aiWidget, openOverlay, toggleDock, ui, useAiDisplay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Button, cx, IconButton } from '../../components/ui';
import { Assist } from '../../modules/ai/Assist';
import { AskPanel } from '../../modules/ai/AskPanel';
import { Changes } from '../../modules/ai/Changes';
import { refForRoute } from '../../modules/ai/assistant';
import { assistantSession } from '../../modules/ai/session';
import { shortcutLabel } from '../../modules/ai/writer';

export type AiDockView = 'ask' | 'write' | 'changes';

/** What Quick Ask handed over with "Open in WorkSuite": the text, its answer, and a counter so the dock starts afresh. */
export const aiDock = createStore<{ text: string; result: string | null; seq: number; view: AiDockView }>({ text: '', result: null, seq: 0, view: 'ask' });

export function openAiDockWith(text: string, result: string | null): void {
  aiDock.set((s) => ({ text, result, seq: s.seq + 1, view: 'write' }));
}

/** The changes the assistant proposed — where a notification about one, or Quick Ask, sends the person. */
export function openAiChanges(): void {
  aiDock.set({ view: 'changes' });
}

/** A task from the text: its first line as the title, in Tasks' new-task form. */
export function makeTask(text: string): void {
  const title = text.trim().split('\n')[0]!.slice(0, 200);
  navigate(`/tasks?new=1&title=${encodeURIComponent(title)}`);
}

export function askWorkSuite(text: string): void {
  openOverlay('search', text.trim().replace(/\s+/g, ' ').slice(0, 200));
}

/**
 * Switching the display mode moves an open assistant with it, conversation and all (it is one session);
 * Hidden puts it away.
 */
export function useAssistantFollowsDisplay(): void {
  const display = useAiDisplay();
  useEffect(() => {
    const docked = ui.get().dock === 'ai';
    const floating = aiWidget.get().open;
    if (display === 'widget') {
      if (docked) {
        ui.set({ dock: null });
        aiWidget.set({ open: true });
      }
    } else if (floating) {
      aiWidget.set({ open: false });
      if (display === 'drawer') ui.set({ dock: 'ai' });
    }
    if (display === 'hidden' && docked) ui.set({ dock: null });
  }, [display]);
}

/** A soft two-note chime, synthesised: an answer arrived while the assistant was closed or minimised. */
function chime(): void {
  try {
    const ctx = new AudioContext();
    const t0 = ctx.currentTime + 0.02;
    [
      [880, 0],
      [1320, 0.12],
    ].forEach(([hz, at]) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at!);
      g.gain.linearRampToValueAtTime(0.08, t0 + at! + 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + at! + 0.22);
      g.connect(ctx.destination);
      const o = ctx.createOscillator();
      o.frequency.value = hz!;
      o.connect(g);
      o.start(t0 + at!);
      o.stop(t0 + at! + 0.25);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 800);
  } catch {
    /* no audio here */
  }
}

/** Settings › AI Assistant › Sound: a chime for each answer that arrives while no panel shows the conversation. */
export function useAssistantAlerts(): void {
  useEffect(
    () =>
      assistantSession.onUnseen(() => {
        if (app.get().prefs?.ai?.sound) chime();
      }),
    [],
  );
}

/** The assistant is answering, and how many answers arrived unseen: for the header button and the launcher. */
export function useAssistantActivity(): { busy: boolean; unread: number } {
  const busy = useStore(assistantSession.store, (s) => s.busy);
  const unread = useStore(assistantSession.store, (s) => s.unread);
  return { busy, unread };
}

export function unreadLabel(n: number): string {
  return n === 1 ? t('ai.unreadOne') : t('ai.unreadMany', { n });
}

/**
 * The AI dock (Ctrl/Cmd+Shift+A; AI Assistant — Web + Desktop UIs; WS-AI-SRS-001
 * FR-DSK-AI-01): beside every tab.
 *
 *  · Ask — the server's assistant, given the record the active tab shows
 *    (and nothing from a tab that shows no one record), which the person can
 *    leave out; files from this computer only when they pick one.
 *  · Write — the writing assistant, on the text it is given and nothing else.
 *  · Changes — what the assistant proposed, waiting for a decision or done.
 */
export function AiDock() {
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface" aria-label={t('ai.title')}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[14.5px] font-bold text-ink">
          <Icon name="sparkles" size={17} className="text-teal" /> {t('ai.title')}
        </div>
        <IconButton icon="x" label={t('ai.close')} onClick={() => toggleDock('ai')} />
      </div>
      <AssistantBody />
    </aside>
  );
}

/** What the drawer and the widget both show: Ask, Write and Changes, on the one conversation. */
export function AssistantBody({ autoFocus }: { autoFocus?: boolean }) {
  const hasAi = useStore(app, (s) => s.apps.some((a) => a.id === 'ai'));
  const language = useStore(app, (s) => s.prefs?.ai?.language ?? 'English');
  const quickAsk = useStore(app, (s) => (s.prefs?.ai?.quickAsk ? s.prefs.ai.shortcut : null));
  const d = useStore(aiDock, (s) => s);
  const active = useStore(tabsStore, (s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const tabRef = refForRoute(active?.route);
  const view = (v: AiDockView, label: string) => (
    <button type="button" role="tab" aria-selected={d.view === v} onClick={() => aiDock.set({ view: v })}
      className={cx('flex-1 rounded-[8px] px-2 py-1.5 text-[12.5px] font-semibold', d.view === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
      {label}
    </button>
  );
  return (
    <>
      <div role="tablist" aria-label="What the assistant does" className="mx-4 mt-3 flex gap-1 rounded-[10px] bg-subtle p-1">
        {view('ask', 'Ask')}
        {view('write', 'Write')}
        {view('changes', 'Changes')}
      </div>
      {d.view === 'ask' ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <AskPanel surface="assistant.panel" session={assistantSession} tabRef={tabRef} tabTitle={active?.title ?? null} autoFocus={autoFocus} />
        </div>
      ) : d.view === 'changes' ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <Changes />
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 scroll-thin">
        <Assist
          key={d.seq}
          text={d.text}
          onText={(text) => aiDock.set({ text })}
          seed={d.result}
          language={language}
          label="TEXT"
          placeholder="Type or paste what to translate, rewrite or shorten"
          onTask={makeTask}
          onSearch={askWorkSuite}
        />
        {quickAsk ? (
          <p className="mt-4 rounded-[10px] bg-subtle px-3 py-2 text-[12px] text-ink-2">
            In any other app, select text and press <b>{shortcutLabel(quickAsk, isMac)}</b> for Quick Ask.
          </p>
        ) : null}
        {hasAi ? (
          <div className="mt-3">
            <Button variant="ghost" icon="external" onClick={() => void call('app:openInBrowser', { path: '/ai' })}>
              Assistants and knowledge in your browser
            </Button>
          </div>
        ) : null}
      </div>
      )}
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
        {d.view === 'write' ? 'Sees only what you give it. Never sends on its own.' : 'Reads only what you can open. Changes nothing until you confirm.'}
      </p>
    </>
  );
}
