import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toggleDock } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Button, IconButton } from '../../components/ui';

/**
 * The AI dock (Ctrl/Cmd+Shift+A). The desktop's own AI assistant —
 * CoreAIService in a dock, window or tab with permitted record context — is
 * Phase 2 (FR-COM-07/08). Until then the dock says so plainly and offers the
 * assistant the user already has in WorkSuite on the web.
 */
export function AiDock() {
  const hasAi = useStore(app, (s) => s.apps.some((a) => a.id === 'ai'));
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-surface" aria-label="AI Assistant">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[14.5px] font-bold text-ink">
          <Icon name="sparkles" size={17} className="text-teal" /> AI Assistant
        </div>
        <IconButton icon="x" label="Close AI Assistant" onClick={() => toggleDock('ai')} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4 text-[13px] text-ink-2">
        <div className="rounded-[12px] bg-navy p-4 text-navy-ink">
          <div className="mb-1 font-semibold text-white">Coming to the desktop</div>
          Drafting replies, summarising threads and answering questions about the record you have open arrive with the desktop AI assistant in the next phase. It will only ever see what you are allowed to see, and it never sends anything on its own.
        </div>
        {hasAi ? (
          <Button variant="teal" icon="external" onClick={() => void call('app:openInBrowser', { path: '/ai' })}>
            Open AI Assistant in your browser
          </Button>
        ) : (
          <p className="text-[12.5px] text-ink-3">The AI Assistant is not enabled for your account.</p>
        )}
      </div>
    </aside>
  );
}
