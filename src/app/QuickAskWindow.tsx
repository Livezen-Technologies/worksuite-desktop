import { useEffect, useState } from 'react';
import type { QuickAskContext } from '@shared/types';
import { app } from '../core/app-state';
import { call, isMac, on } from '../core/bridge';
import { useStore } from '../core/store';
import { Assist } from '../modules/ai/Assist';
import { AskPanel } from '../modules/ai/AskPanel';
import { shortcutLabel } from '../modules/ai/writer';
import { cx } from '../components/ui';

type Ctx = QuickAskContext & { shortcut: string | null };

/**
 * Quick Ask (AI Assistant — Web + Desktop UIs, page 2): over whatever app was
 * in front, with the text that was selected there. Esc closes it; so does
 * clicking anywhere else.
 */
export function QuickAskWindow() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [text, setText] = useState('');
  const [round, setRound] = useState(0);
  // Ask the assistant about the selection, or have the writing assistant rework it.
  const [mode, setMode] = useState<'ask' | 'write'>('ask');
  const org = useStore(app, (s) => s.bootstrap?.organizations.find((o) => o.id === s.organizationId)?.name ?? null);
  const language = useStore(app, (s) => s.prefs?.ai?.language ?? 'English');

  useEffect(() => {
    const load = () =>
      void call('quickask:context').then((c) => {
        setCtx(c);
        setText(c.text);
        // A new selection starts a new ask: the old answer goes.
        setRound((n) => n + 1);
      }, () => undefined);
    load();
    const off = on('quickask:changed', load);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void call('quickask:close');
    };
    window.addEventListener('keydown', esc);
    return () => {
      off();
      window.removeEventListener('keydown', esc);
    };
  }, []);

  const key = ctx?.shortcut ? shortcutLabel(ctx.shortcut, isMac) : null;
  const handoff = (to: 'dock' | 'task' | 'search' | 'changes', t: string, result: string | null = null) => void call('quickask:handoff', { to, text: t.slice(0, 8000), result });
  const insert = ctx?.canInsert ? { label: `Insert into ${ctx.app ?? 'the app'}`, run: (r: string) => void call('quickask:insert', { text: r }) } : undefined;
  const tab = (m: 'ask' | 'write', label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
      className={cx('rounded-[7px] px-2.5 py-1 text-[12px] font-semibold', mode === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
      {label}
    </button>
  );
  return (
      <div className="flex h-full flex-col overflow-hidden border border-line bg-surface">
        <div className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 text-[13px]">
          <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-navy text-[12px] font-extrabold text-white">W</span>
          <b className="text-ink">Quick Ask</b>
          {org ? <span className="truncate text-ink-3">· {org}</span> : null}
          <span className="flex-1" />
          <button type="button" onClick={() => void call('quickask:close')} className="no-drag rounded-[6px] px-2 py-0.5 text-[12px] text-ink-3 hover:bg-subtle">
            Esc to close
          </button>
        </div>
        {/* Ask scrolls its own conversation and keeps its box in place (worksuite-desktop#50); Rewrite scrolls as a page. */}
        <div className={cx('flex min-h-0 flex-1 flex-col p-4', !(ctx && mode === 'ask') && 'overflow-y-auto scroll-thin')}>
          {ctx ? (
            <div role="tablist" aria-label="What Quick Ask does" className="mb-3 flex w-fit gap-1 rounded-[9px] bg-subtle p-1">
              {tab('ask', 'Ask')}
              {tab('write', 'Rewrite or translate')}
            </div>
          ) : null}
          {ctx && mode === 'ask' ? (
            <AskPanel
              key={`ask-${round}`}
              surface="desktop.quick"
              selection={ctx.text}
              insert={insert}
              onOpen={(q, r) => handoff('dock', q, r)}
              reviewElsewhere={() => handoff('changes', '')}
              autoFocus
            />
          ) : null}
          {ctx && mode === 'write' ? (
            <Assist
              key={round}
              text={text}
              onText={setText}
              language={language}
              autoFocus={!ctx.text}
              insert={insert}
              onOpen={(t, r) => handoff('dock', t, r)}
              onTask={(t) => handoff('task', t)}
              onSearch={(t) => handoff('search', t)}
            />
          ) : null}
        </div>
        <p className="shrink-0 border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
          {ctx?.note ?? (ctx?.source === 'selection' ? `The selection was read when you pressed ${key ?? 'the shortcut'}. Nothing else on your screen is read.` : 'Only what you type or paste here is sent.')}
        </p>
      </div>
  );
}
