import { app } from '../../core/app-state';
import { call, isMac } from '../../core/bridge';
import { createStore, useStore } from '../../core/store';
import { navigate, tabsStore } from '../../core/tabs';
import { openOverlay, toggleDock } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Button, cx, IconButton } from '../../components/ui';
import { Assist } from '../../modules/ai/Assist';
import { AskPanel } from '../../modules/ai/AskPanel';
import { Changes } from '../../modules/ai/Changes';
import { refForRoute } from '../../modules/ai/assistant';
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
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface" aria-label="AI Assistant">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[14.5px] font-bold text-ink">
          <Icon name="sparkles" size={17} className="text-teal" /> AI Assistant
        </div>
        <IconButton icon="x" label="Close AI Assistant" onClick={() => toggleDock('ai')} />
      </div>
      <div role="tablist" aria-label="What the assistant does" className="mx-4 mt-3 flex gap-1 rounded-[10px] bg-subtle p-1">
        {view('ask', 'Ask')}
        {view('write', 'Write')}
        {view('changes', 'Changes')}
      </div>
      {d.view === 'ask' ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <AskPanel surface="assistant.panel" tabRef={tabRef} tabTitle={active?.title ?? null} />
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
    </aside>
  );
}
