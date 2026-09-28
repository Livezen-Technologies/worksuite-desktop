import { app } from '../../core/app-state';
import { call, isMac } from '../../core/bridge';
import { createStore, useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { openOverlay, toggleDock } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Button, IconButton } from '../../components/ui';
import { Assist } from '../../modules/ai/Assist';
import { shortcutLabel } from '../../modules/ai/writer';

/** What Quick Ask handed over with "Open in WorkSuite": the text, its answer, and a counter so the dock starts afresh. */
export const aiDock = createStore<{ text: string; result: string | null; seq: number }>({ text: '', result: null, seq: 0 });

export function openAiDockWith(text: string, result: string | null): void {
  aiDock.set((s) => ({ text, result, seq: s.seq + 1 }));
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
 * The AI dock (Ctrl/Cmd+Shift+A; AI Assistant — Web + Desktop UIs): the
 * writing assistant beside every tab. It works on the text it is given — typed,
 * pasted, or handed over from Quick Ask — and nothing else: it does not read
 * the tab next to it, and it never sends anything on its own.
 */
export function AiDock() {
  const hasAi = useStore(app, (s) => s.apps.some((a) => a.id === 'ai'));
  const language = useStore(app, (s) => s.prefs?.ai?.language ?? 'English');
  const quickAsk = useStore(app, (s) => (s.prefs?.ai?.quickAsk ? s.prefs.ai.shortcut : null));
  const d = useStore(aiDock, (s) => s);
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface" aria-label="AI Assistant">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[14.5px] font-bold text-ink">
          <Icon name="sparkles" size={17} className="text-teal" /> AI Assistant
        </div>
        <IconButton icon="x" label="Close AI Assistant" onClick={() => toggleDock('ai')} />
      </div>
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
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">Sees only what you give it. Never sends on its own.</p>
    </aside>
  );
}
