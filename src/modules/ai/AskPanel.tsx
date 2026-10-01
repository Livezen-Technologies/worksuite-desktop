import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useStickToBottom } from '../../components/useStickToBottom';
import { app } from '../../core/app-state';
import { t } from '../../core/i18n';
import { localReady, useLocalModels } from '../../core/local-ai';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { ActionCard } from './ActionCard';
import { LocalSetup } from './LocalSetup';
import { useAssistant, type PendingAction, type Surface } from './assistant';
import { createAskSession, type AskEntry, type AskSession } from './session';
import { effective, personalOff, toolAllowed, useLocalTools, useOrgAccess } from './tools';
import { Checkbox } from '../../components/Checkbox';

/**
 * Ask the assistant (WS-AI-SRS-001 FR-DSK-AI-01/02/04): the server's own
 * assistant, with — only when the person leaves it on — the record the tab
 * beside it shows, and any file they pick from this computer. What it
 * proposes to change arrives as cards; nothing changes until one is
 * confirmed, and only in the main window.
 *
 * The conversation lives in a session (session.ts), not here: the drawer and
 * the floating widget pass the shared one, so either can close, minimise or
 * take over without losing it. Without one (Quick Ask) the panel keeps its
 * own, which ends with it.
 */
export function AskPanel({
  surface,
  session: given,
  tabRef,
  tabTitle,
  selection,
  insert,
  onOpen,
  reviewElsewhere,
  autoFocus,
}: {
  surface: Surface;
  /** The conversation to show; a private one when none is given. */
  session?: AskSession;
  /** The record the active tab shows, as `task:12`, when it shows one. */
  tabRef?: string | null;
  tabTitle?: string | null;
  /** Quick Ask: the text selected when the shortcut was pressed. It travels only with a question. */
  selection?: string;
  insert?: { label: string; run: (text: string) => void };
  onOpen?: (question: string, answer: string | null) => void;
  /** Where a card is reviewed when it cannot be confirmed here (Quick Ask). */
  reviewElsewhere?: () => void;
  autoFocus?: boolean;
}) {
  const { availability, rules } = useAssistant(surface);
  const [own] = useState(() => (given ? null : createAskSession()));
  const session = given ?? own!;
  const st = useStore(session.store, (s) => s);
  const { entries, text, busy, streaming, useTab, files, fileError } = st;
  const set = session.store.set;
  const input = useRef<HTMLTextAreaElement>(null);
  // Local AI (WS-SRS-LAI): the model on this computer, when one is installed — also offline.
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const localModels = useLocalModels(surface === 'assistant.panel');
  const localModel = surface === 'assistant.panel' ? localReady(localModels.data) : null;
  // One assistant (worksuite-desktop#53): the model on this computer when it can answer, online AI when it cannot and
  // the person allows it — no choosing between them here.
  const local = !!localModel;
  const fallbackOn = useStore(app, (s) => s.prefs?.ai.onlineFallback ?? true);
  const enabled = availability.data ? availability.data.enabled : !availability.isError;
  const online = fallbackOn && !offline && enabled;
  const onlineWhy = online
    ? null
    : !fallbackOn
      ? 'Online fallback is off in Settings › AI Assistant.'
      : offline
        ? 'You are offline, so online AI cannot help right now.'
        : (availability.data?.reason ?? 'Online AI is not switched on for you.');
  // Module Access (worksuite-desktop#51): what each assistant may use, the organization's ceiling and this person's choice.
  const accessPrefs = useStore(app, (s) => s.prefs?.ai.moduleAccess);
  const org = useOrgAccess(surface === 'assistant.panel' && !offline);
  const tools = useLocalTools(!!localModel && !offline);
  const localTools = local && !offline && !!tools.data?.length
    ? {
        tools: tools.data,
        allow: (t: Parameters<typeof toolAllowed>[0]) => toolAllowed(t, org.data, accessPrefs),
        off: (org.data?.modules ?? []).filter((m) => !effective(m, 'local', accessPrefs).read).map((m) => `${m.label} (${effective(m, 'local', accessPrefs).readWhy})`),
      }
    : undefined;
  // A private conversation ends with the panel, and a local answer with it; a shared one carries on.
  useEffect(() => (own ? () => own.cancel() : undefined), [own]);
  // Showing the conversation reads what arrived while it was hidden.
  useEffect(() => session.view(), [session]);

  // A new tab's record is used by default only when online AI would answer anyway: with a model on this computer,
  // including it is the person's choice, since the tab is read online (worksuite-desktop#53).
  useEffect(() => {
    if (session.store.get().tabRef !== (tabRef ?? null)) set({ useTab: !local, tabRef: tabRef ?? null });
  }, [tabRef, session, set, local]);
  // The model on this computer is found once the panel is open: from then on the tab is the person's choice.
  useEffect(() => {
    if (local) set({ useTab: false });
  }, [local, set]);
  // The conversation follows new messages and a streaming answer while the reader is at the end (worksuite-desktop#50).
  const { scroller, content, unseen, toEnd, onScroll } = useStickToBottom(`${entries.length}:${busy}:${streaming?.length ?? -1}`);

  // Neither the model on this computer nor online AI can answer: say why, and how to get one.
  const off = !local && !online ? `No model on this computer can answer yet. ${onlineWhy}` : null;
  const refs = online ? [...(useTab && tabRef ? [tabRef] : []), ...files.map((f) => f.ref)] : [];
  // Where the next answer comes from: files and the tab are read online.
  const viaLocal = local && refs.length === 0;

  const send = () => {
    if (!text.trim() || busy) return Promise.resolve();
    // Asking is looking at the answer: back to the end, following again, from wherever the reader had scrolled.
    toEnd();
    return session.send({ surface, refs, local, online, onlineWhy, selection, localTools, moduleAccess: personalOff(accessPrefs, 'worksuite') });
  };
  const attach = () => session.attach();

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const lastAnswer = [...entries].reverse().find((x) => x.role === 'assistant' && !x.error)?.text ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {off ? (
        <div role="status" className="space-y-2 rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-[#7A4308] dark:text-warning">
          <p>{off}</p>
          <div className="flex flex-wrap gap-1.5">
            {surface === 'assistant.panel' ? (
              <button type="button" onClick={() => navigate('/settings/local-ai')} className="h-7 rounded-[7px] bg-surface px-2.5 font-semibold text-ink hover:bg-subtle">Set up Local AI</button>
            ) : null}
            {!fallbackOn ? (
              <button type="button" onClick={() => navigate('/settings/ai')} className="h-7 rounded-[7px] bg-surface px-2.5 font-semibold text-ink hover:bg-subtle">AI Assistant settings</button>
            ) : (
              <button type="button" onClick={() => void availability.refetch()} className="h-7 rounded-[7px] bg-surface px-2.5 font-semibold text-ink hover:bg-subtle">Try again</button>
            )}
          </div>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} data-testid="ai-conversation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-thin" aria-live="polite">
        <div ref={content} className="flex flex-col gap-3 pb-1">
        {/* First-use Local AI setup: offered until a model on this computer can answer, then "ready" once (worksuite-desktop#49/#55). */}
        {surface === 'assistant.panel' ? (
          <LocalSetup
            onStart={() => input.current?.focus()}
          />
        ) : null}
        {entries.length === 0 && !off ? (
          <p className="text-[12.5px] text-ink-3">
            Ask about your work — tasks, mail, files, meetings, customers. The assistant sees only what you can open, and changes nothing until you confirm it.
          </p>
        ) : null}
        {entries.map((e, i) => (
          <Bubble key={i} e={e} elsewhere={reviewElsewhere} onRetry={e.retry && i === entries.length - 1 && !busy ? () => void session.retry() : undefined} onSetup={surface === 'assistant.panel' ? () => navigate('/settings/local-ai') : undefined} />
        ))}
        {/* A growing answer is not read out word by word: the whole one is, once it lands. */}
        {streaming ? (
          <div aria-live="off">
            <Bubble e={{ role: 'assistant', text: streaming, local: true }} />
          </div>
        ) : null}
        {/* From the moment the question goes until the answer starts to show; read out once, as it appears. */}
        {busy && !streaming ? (
          <p data-testid="ai-thinking" className="flex items-center gap-2 text-[13px] text-ink-2">
            <Icon name="sparkles" size={16} aria-hidden className="shrink-0 text-teal motion-safe:animate-pulse" />
            {t('ai.thinking')}
          </p>
        ) : null}
        </div>
      </div>
      {unseen ? (
        <button type="button" onClick={toEnd} className="absolute bottom-2 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-ink shadow-md hover:bg-subtle">
          <Icon name="arrow-down" size={14} /> Jump to latest
        </button>
      ) : null}
      </div>

      {lastAnswer && (insert || onOpen) ? (
        <div className="flex flex-wrap gap-1.5">
          {insert ? (
            <button type="button" onClick={() => insert.run(lastAnswer)} className="h-8 rounded-[8px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover">
              {insert.label}
            </button>
          ) : null}
          {onOpen ? (
            <button type="button" onClick={() => onOpen(entries.find((x) => x.role === 'user')?.text ?? '', lastAnswer)} className="h-8 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
              Open in WorkSuite
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 border-t border-line pt-3">
        {tabRef && online ? (
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <Checkbox checked={useTab} onChange={(e) => set({ useTab: e.target.checked })} />
            <span className="truncate">Use this tab{tabTitle ? `: ${tabTitle}` : ''}</span>
          </label>
        ) : null}
        {files.length ? (
          <div className="flex flex-wrap gap-1">
            {files.map((f) => (
              <span key={f.ref} className="flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11.5px] text-ink-2">
                <Icon name="paperclip" size={12} />
                <span className="max-w-[160px] truncate">{f.name}</span>
                {f.via === 'drive' ? <span className="text-ink-3">(Drive)</span> : null}
                <button type="button" aria-label={`Leave out ${f.name}`} onClick={() => set((s) => ({ files: s.files.filter((x) => x.ref !== f.ref) }))}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
        ) : null}
        {fileError ? <p role="alert" className="text-[12px] text-danger">{fileError}</p> : null}
        {/* The Chat composer's box: the field and its buttons in one bordered, focus-ringed frame. */}
        <div className={cx('relative flex items-end gap-1 rounded-[12px] border px-2 py-1.5 transition-colors', off ? 'border-line bg-subtle/60' : 'border-line bg-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15')}>
          {surface === 'assistant.panel' && rules?.localFiles && online ? (
            <button type="button" onClick={() => void attach()} disabled={busy || !!off} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-50" aria-label="Ask about a file from this computer" title="Ask about a file from this computer">
              <Icon name="paperclip" size={18} />
            </button>
          ) : null}
          <textarea
            ref={input}
            value={text}
            onChange={(e) => set({ text: e.target.value.slice(0, 4000) })}
            onKeyDown={onKey}
            rows={1}
            autoFocus={autoFocus}
            disabled={!!off}
            placeholder={selection ? 'Ask about the selected text' : 'Ask the assistant'}
            aria-label="Your question"
            className="bare-focus field-sizing-content max-h-40 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[13.5px] text-ink outline-none"
          />
          {streaming !== null ? (
            <button type="button" onClick={() => session.cancel()} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-line text-ink hover:bg-subtle" aria-label="Stop" title="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : null}
          <button type="button" onClick={() => void send()} disabled={busy || !text.trim() || !!off} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-primary text-white hover:bg-primary-hover disabled:bg-subtle disabled:text-ink-3" aria-label="Send" title="Send (Enter)">
            <Icon name="send" size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 px-1 text-[11px] text-ink-3">
          {/* Where the next answer comes from, said plainly — never a promise the mode cannot keep (worksuite-desktop#53). */}
          <span data-testid="ai-mode" className="min-w-0 flex-1" title={viaLocal ? (localTools ? 'Answered on this computer. The WorkSuite data it reads, and the changes it prepares, come from WorkSuite as you.' : 'Answered on this computer; your question stays here.') + (online ? ' If it cannot answer, online AI does.' : '') : 'Your question, and the files and tab you include, are sent to WorkSuite AI.'}>
            <Icon name={viaLocal ? 'cpu' : 'sparkles'} size={11} className="mr-1 inline align-[-1px]" />
            {viaLocal ? (localTools ? 'Processing locally · WorkSuite data from the server' : 'Processing locally') : 'Using online AI'} · Enter to send
          </span>
          {given && entries.length > 0 && !busy ? (
            <button type="button" onClick={() => session.reset()} className="shrink-0 font-semibold text-ink-2 hover:text-ink">
              New conversation
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Bubble({ e, elsewhere, onRetry, onSetup }: { e: AskEntry; elsewhere?: () => void; onRetry?: () => void; onSetup?: () => void }) {
  if (e.role === 'user') {
    return <p className="ml-8 self-end whitespace-pre-wrap rounded-[12px] bg-primary px-3 py-2 text-[13px] text-white selectable">{e.text}</p>;
  }
  if (e.error) {
    return (
      <div className="space-y-1.5">
        <p role="alert" className="flex items-start gap-1.5 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger"><Icon name="alert" size={15} className="mt-0.5 shrink-0" />{e.text}</p>
        <div className="flex flex-wrap gap-1.5">
          {onRetry ? (
            <button type="button" onClick={onRetry} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
              <Icon name="rotate-cw" size={14} /> {t('ai.retry')}
            </button>
          ) : null}
          {e.needsSetup && onSetup ? (
            <button type="button" onClick={onSetup} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
              <Icon name="cpu" size={14} /> Set up Local AI
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  const turn = e.turn;
  const records = (turn?.sources ?? []).filter((s) => s.kind === 'record');
  const cards = (turn?.pending_actions ?? []) as PendingAction[];
  return (
    <div className="space-y-2">
      {(turn?.tool_runs ?? []).length ? (
        <div className="flex flex-wrap gap-1">
          {turn!.tool_runs.map((r, i) => (
            <span key={i} title={r.error ?? undefined} className={cx('rounded-full px-2 py-0.5 text-[11px]', r.ok ? 'bg-subtle text-ink-2' : 'bg-warning-bg text-[#7A4308]')}>{r.label}</span>
          ))}
        </div>
      ) : null}
      {e.local ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
          <Icon name="cpu" size={11} /> Processed locally
        </span>
      ) : e.fallback ? (
        <span title={e.fallback} className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
          <Icon name="sparkles" size={11} /> Used online AI · {e.fallback}
        </span>
      ) : null}
      <p className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-ink selectable">{e.text}</p>
      {records.length ? (
        <ul className="space-y-0.5 border-t border-line pt-1.5 text-[12px]">
          {records.map((s) => (
            <li key={`${s.n}-${s.title}`}>
              {s.url ? <button type="button" onClick={() => navigate(s.url!)} className="text-primary hover:underline">[{s.n}] {s.title}</button> : <span className="text-ink-3">[{s.n}] {s.title}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {cards.filter((c) => c.status !== 'superseded').map((c) => <ActionCard key={c.id} action={c} elsewhere={elsewhere} />)}
    </div>
  );
}
