import { useEffect, useState } from 'react';
import type { QuickAskContext } from '@shared/types';
import { app } from '../core/app-state';
import { call, isMac, on } from '../core/bridge';
import { useStore } from '../core/store';
import { Assist } from '../modules/ai/Assist';
import { shortcutLabel } from '../modules/ai/writer';

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
  const handoff = (to: 'dock' | 'task' | 'search', t: string, result: string | null = null) => void call('quickask:handoff', { to, text: t.slice(0, 8000), result });
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
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 scroll-thin">
          {ctx ? (
            <Assist
              key={round}
              text={text}
              onText={setText}
              language={language}
              autoFocus={!ctx.text}
              insert={ctx.canInsert ? { label: `Insert into ${ctx.app ?? 'the app'}`, run: (r) => void call('quickask:insert', { text: r }) } : undefined}
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
