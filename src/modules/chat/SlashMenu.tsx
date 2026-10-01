import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useLocalModels } from '../../core/local-ai';
import { useWriter } from '../ai/writer';
import { matchActions, suggestEngine, suggestReplies, type RepliesState, type SlashAction, type Turn } from './replies';
import { matchReplies, type SavedReply } from './website/profile';

/** What the composer's textarea asks of the menu while it has the focus. */
export interface SlashMenuHandle {
  /** Handles a key typed in the box; true when the menu took it. */
  onKey: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/** Inside the menu: the box's blur keeps the menu open when the focus moves here. */
export const SLASH_MENU_ATTR = 'data-slash-menu';
export const inSlashMenu = (el: EventTarget | null): boolean => el instanceof Element && !!el.closest(`[${SLASH_MENU_ATTR}]`);

type Item = { kind: 'action'; key: SlashAction; label: string; hint: string; icon: string } | { kind: 'reply'; reply: SavedReply };

/**
 * The "/" menu above the composer (worksuite-desktop#32): Load saved replies (searchable) and Suggest reply (from the
 * conversation). Arrow keys move, Enter picks, Esc closes; what is picked goes into the box in place of the "/word",
 * still editable, and is sent only when the person sends it.
 */
export function SlashMenu({
  word,
  replies,
  context,
  onInsert,
  onClose,
  compact,
  ref,
}: {
  /** What follows the "/" in the box. */
  word: string;
  replies: RepliesState;
  /** The conversation, oldest first, read when a suggestion is asked for. */
  context: () => Turn[];
  onInsert: (text: string) => void;
  /** Closes the menu and gives the box its focus back. */
  onClose: () => void;
  compact?: boolean;
  ref?: Ref<SlashMenuHandle>;
}) {
  const [view, setView] = useState<'root' | SlashAction>('root');
  // The highlighted row goes back to the first when what was typed, or the view, changes.
  const at = `${view}|${word}`;
  const [sel, setSel] = useState({ at, i: 0 });
  const pick = sel.at === at ? sel.i : 0;
  const setPick = (i: number) => setSel({ at, i });

  const ready = replies.state === 'ready' ? replies.replies : [];
  const items: Item[] = [
    ...matchActions(word).map((a) => ({ kind: 'action' as const, key: a.key, label: a.label, hint: a.hint, icon: a.icon })),
    ...matchReplies(ready, word, 5).map((r) => ({ kind: 'reply' as const, reply: r })),
  ];

  const choose = (it: Item) => {
    if (it.kind === 'reply') onInsert(it.reply.body);
    else setView(it.key);
  };

  useImperativeHandle(ref, () => ({
    onKey: (e) => {
      if (view !== 'root' || !items.length) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((pick + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
        return true;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        choose(items[Math.min(pick, items.length - 1)]!);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return true;
      }
      return false;
    },
  }));

  // Nothing matches what was typed ("/usr/bin"): no menu, and the keys stay the box's.
  if (view === 'root' && !items.length) return null;

  return (
    <div
      {...{ [SLASH_MENU_ATTR]: '' }}
      className={cx(
        'absolute bottom-full left-3 z-40 mb-1 flex max-h-[min(360px,60vh)] max-w-[calc(100%-24px)] flex-col rounded-[12px] border border-line bg-surface shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.18)]',
        compact ? 'w-[280px]' : 'w-[360px]',
      )}
    >
      {view === 'root' ? (
        <Root items={items} pick={pick} setPick={setPick} choose={choose} />
      ) : view === 'saved' ? (
        <Saved initial={word} replies={replies} onInsert={onInsert} onBack={() => setView('root')} onClose={onClose} />
      ) : (
        <Suggest context={context} onInsert={onInsert} onBack={() => setView('root')} onClose={onClose} />
      )}
    </div>
  );
}

const optionCls = (on: boolean) => cx('flex w-full items-start gap-2.5 rounded-[8px] px-2 py-1.5 text-left', on ? 'bg-selection' : 'hover:bg-subtle');
const footCls = 'border-t border-line px-2.5 py-1.5 text-[11px] text-ink-3';

function Root({ items, pick, setPick, choose }: { items: Item[]; pick: number; setPick: (i: number) => void; choose: (it: Item) => void }) {
  const firstReply = items.findIndex((it) => it.kind === 'reply');
  return (
    <>
      <div role="listbox" aria-label="Quick actions" className="min-h-0 flex-1 overflow-y-auto p-1 scroll-thin">
        {items.map((it, i) => (
          <div key={it.kind === 'action' ? it.key : `r${it.reply.id}`}>
            {i === firstReply ? <div className="px-2 pt-1.5 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">SAVED REPLIES</div> : null}
            <button type="button" role="option" aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setPick(i)} onClick={() => choose(it)} className={optionCls(i === pick)}>
              {it.kind === 'action' ? (
                <>
                  <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-selection text-primary">
                    <Icon name={it.icon} size={15} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate text-[12.5px] text-ink">{it.label}</b>
                    <span className="truncate text-[11.5px] text-ink-3">{it.hint}</span>
                  </span>
                </>
              ) : (
                <ReplyLine r={it.reply} />
              )}
            </button>
          </div>
        ))}
      </div>
      <div className={footCls}>↑↓ to move · Enter to pick · Esc to close</div>
    </>
  );
}

function ReplyLine({ r }: { r: SavedReply }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[12.5px] font-semibold text-ink">
        {r.title}
        {r.shortcut ? <span className="ml-2 font-mono text-[11.5px] font-normal text-ink-3">/{r.shortcut}</span> : null}
      </span>
      <span className="line-clamp-2 text-[11.5px] text-ink-3">{r.body}</span>
    </span>
  );
}

function Head({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-1 border-b border-line px-1.5 py-1">
      <button type="button" aria-label="Back" title="Back" onClick={onBack} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle">
        <Icon name="chevron-left" size={15} />
      </button>
      <b className="flex-1 truncate text-[12.5px] text-ink">{title}</b>
      {children}
    </div>
  );
}

/** Moves the pick with ↑↓, picks with Enter, closes with Esc: for a view that has the focus. */
function listKeys(e: ReactKeyboardEvent, count: number, pick: number, setPick: (n: number) => void, onPick: (i: number) => void, onClose: () => void) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  } else if (count && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    setPick((pick + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
  } else if (count && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onPick(Math.min(pick, count - 1));
  }
}

function Saved({ initial, replies, onInsert, onBack, onClose }: { initial: string; replies: RepliesState; onInsert: (t: string) => void; onBack: () => void; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const [pick, setPick] = useState(0);
  const list = replies.state === 'ready' ? matchReplies(replies.replies, q.trim(), 200) : [];
  return (
    <>
      <Head title="Saved replies" onBack={onBack} />
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <Icon name="search" size={14} className="shrink-0 text-ink-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setPick(0))}
          onKeyDown={(e) => listKeys(e, list.length, pick, setPick, (i) => onInsert(list[i]!.body), onClose)}
          placeholder="Search saved replies"
          aria-label="Search saved replies"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      <div role="listbox" aria-label="Saved replies" className="min-h-0 flex-1 overflow-y-auto p-1 scroll-thin">
        {replies.state === 'loading' ? (
          <p role="status" className="flex items-center gap-2 px-2 py-3 text-[12px] text-ink-3"><Icon name="spinner" size={14} className="animate-spin-slow" />Loading saved replies…</p>
        ) : replies.state === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-1.5 px-2 py-3 text-[12px] text-ink-2">
            {replies.message}
            <button type="button" onClick={replies.retry} className="font-semibold text-primary hover:underline">Try again</button>
          </div>
        ) : !list.length ? (
          <div className="flex flex-col items-center gap-1 px-3 py-5 text-center">
            <Icon name="bookmark" size={20} className="text-ink-3" />
            <b className="text-[12.5px] text-ink">{q.trim() && replies.replies.length ? `No saved reply matches “${q.trim()}”` : 'No saved replies yet'}</b>
            <span className="text-[11.5px] text-ink-3">{q.trim() && replies.replies.length ? 'Try other words.' : (replies.note ?? 'Saved replies your workspace adds show here.')}</span>
          </div>
        ) : (
          list.map((r, i) => (
            <button key={r.id} type="button" role="option" aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setPick(i)} onClick={() => onInsert(r.body)} className={optionCls(i === pick)}>
              <ReplyLine r={r} />
            </button>
          ))
        )}
      </div>
      <div className={footCls}>↑↓ to move · Enter to insert · Esc to close</div>
    </>
  );
}

function Suggest({ context, onInsert, onBack, onClose }: { context: () => Turn[]; onInsert: (t: string) => void; onBack: () => void; onClose: () => void }) {
  const models = useLocalModels();
  const writer = useWriter();
  const settled = !models.isLoading && !writer.isLoading;
  const [run, setRun] = useState(0);
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; list: string[] }>({ phase: 'loading' });
  const [pick, setPick] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settled) return;
    const engine = suggestEngine(models.data, writer.data);
    const serverToo = suggestEngine(undefined, writer.data) === 'server';
    let alive = true;
    const job = suggestReplies(context(), engine, serverToo);
    job.done.then(
      (list) => alive && setState(list.length ? { phase: 'ready', list } : { phase: 'error', message: 'No suggestion came back. Try again.' }),
      (e: unknown) => alive && setState({ phase: 'error', message: e instanceof Error ? e.message : 'The suggestions could not be made.' }),
    );
    return () => {
      alive = false;
      job.cancel();
    };
  }, [settled, run]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    box.current?.focus();
  }, []);
  /** Asks again: the list goes, the wait shows. */
  const again = () => {
    setState({ phase: 'loading' });
    setPick(0);
    setRun((n) => n + 1);
  };
  const list = state.phase === 'ready' ? state.list : [];

  return (
    <div ref={box} tabIndex={-1} className="flex min-h-0 flex-col outline-none" onKeyDown={(e) => listKeys(e, list.length, pick, setPick, (i) => onInsert(list[i]!), onClose)}>
      <Head title="Suggested replies" onBack={onBack}>
        {state.phase === 'ready' ? (
          <button type="button" onClick={again} className="flex h-7 items-center gap-1 rounded-[7px] px-2 text-[11.5px] font-semibold text-ink-2 hover:bg-subtle">
            <Icon name="refresh" size={13} />
            New ideas
          </button>
        ) : null}
      </Head>
      <div role="listbox" aria-label="Suggested replies" aria-busy={state.phase === 'loading'} className="min-h-0 flex-1 overflow-y-auto p-1 scroll-thin">
        {state.phase === 'loading' ? (
          <p role="status" className="flex items-center gap-2 px-2 py-3 text-[12px] text-ink-3"><Icon name="spinner" size={14} className="animate-spin-slow" />Thinking of replies…</p>
        ) : state.phase === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-1.5 px-2 py-3 text-[12px] text-ink-2">
            {state.message}
            <button type="button" onClick={again} className="flex items-center gap-1 font-semibold text-primary hover:underline">
              <Icon name="refresh" size={12} />
              Retry
            </button>
          </div>
        ) : (
          list.map((s, i) => (
            <button key={s} type="button" role="option" aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setPick(i)} onClick={() => onInsert(s)} className={optionCls(i === pick)}>
              <Icon name="sparkles" size={14} className="mt-0.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 text-[12.5px] whitespace-pre-wrap text-ink">{s}</span>
            </button>
          ))
        )}
      </div>
      <div className={footCls}>{state.phase === 'ready' ? 'Enter to insert — you can change it before sending · Esc to close' : 'Esc to close'}</div>
    </div>
  );
}
