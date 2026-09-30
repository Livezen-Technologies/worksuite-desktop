import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useStickToBottom } from '../../components/useStickToBottom';
import { app } from '../../core/app-state';
import { askLocal, localReady, useLocalModels, type LocalAsk } from '../../core/local-ai';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { ActionCard } from './ActionCard';
import { LocalSetup } from './LocalSetup';
import { ask, assistantProblem, pickFile, useAssistant, type AskTurn, type PendingAction, type Surface } from './assistant';

interface Entry {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  turn?: AskTurn;
  /** Answered by the model on this computer. */
  local?: boolean;
}

const LOCAL_SYSTEM = 'You are WorkSuite\'s assistant, running on this computer. Answer clearly and briefly. You cannot see the person\'s WorkSuite data or change anything; say so when a question needs it.';

/**
 * Ask the assistant (WS-AI-SRS-001 FR-DSK-AI-01/02/04): the server's own
 * assistant, with — only when the person leaves it on — the record the tab
 * beside it shows, and any file they pick from this computer. What it
 * proposes to change arrives as cards; nothing changes until one is
 * confirmed, and only in the main window.
 */
export function AskPanel({
  surface,
  tabRef,
  tabTitle,
  selection,
  insert,
  onOpen,
  reviewElsewhere,
  autoFocus,
}: {
  surface: Surface;
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
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [useTab, setUseTab] = useState(true);
  const [files, setFiles] = useState<{ ref: string; name: string; via: 'upload' | 'drive' }[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  // Local AI (WS-SRS-LAI): the model on this computer, when one is installed — also offline.
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const localModels = useLocalModels(surface === 'assistant.panel');
  const localModel = surface === 'assistant.panel' ? localReady(localModels.data) : null;
  const [localPick, setLocalPick] = useState<boolean | null>(null);
  const local = !!localModel && (localPick ?? offline);
  const [streaming, setStreaming] = useState<string | null>(null);
  const running = useRef<LocalAsk | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => running.current?.cancel(), []);

  useEffect(() => setUseTab(true), [tabRef]);
  // The conversation follows new messages and a streaming answer while the reader is at the end (worksuite-desktop#50).
  const view = useStickToBottom(`${entries.length}:${busy}:${streaming?.length ?? -1}`);

  const off = local ? null : availability.data && !availability.data.enabled ? availability.data.reason ?? 'The assistant is not switched on for you.' : null;
  const refs = [...(useTab && tabRef ? [tabRef] : []), ...files.map((f) => f.ref)];

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    // A selection from another app goes with the question, fenced, as material to work on.
    const full = selection && selection.trim() && entries.length === 0 ? `${q}\n\nThe text I selected:\n"""\n${selection.trim().slice(0, 6000)}\n"""` : q;
    setText('');
    setEntries((e) => [...e, { role: 'user', text: q, local }]);
    // Asking is looking at the answer: back to the end, following again, from wherever the reader had scrolled.
    view.toEnd();
    setBusy(true);
    if (local) {
      // This computer's model: the conversation so far in this mode, nothing from WorkSuite.
      const history = entries.filter((x) => x.local && !x.error).map((x) => ({ role: x.role, content: x.text }));
      setStreaming('');
      const r = askLocal([{ role: 'system', content: LOCAL_SYSTEM }, ...history, { role: 'user', content: full }], (t) => setStreaming(t));
      running.current = r;
      try {
        const a = await r.done;
        setEntries((e) => [...e, { role: 'assistant', text: a.text.trim() || (a.cancelled ? 'Stopped.' : ''), local: true }]);
      } catch (err) {
        setEntries((e) => [...e, { role: 'assistant', text: assistantProblem(err), error: true, local: true }]);
      } finally {
        running.current = null;
        setStreaming(null);
        setBusy(false);
      }
      return;
    }
    try {
      const t = await ask(full, { surface, refs, conversationId });
      setConversationId(t.conversation_id);
      setEntries((e) => [...e, t.ok ? { role: 'assistant', text: t.reply ?? '', turn: t } : { role: 'assistant', text: t.error ?? 'The assistant could not answer just now.', error: true }]);
    } catch (err) {
      setEntries((e) => [...e, { role: 'assistant', text: assistantProblem(err), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    setFileError(null);
    try {
      const f = await pickFile();
      if (f) setFiles((all) => [...all.filter((x) => x.ref !== f.ref), f]);
    } catch (e) {
      setFileError(assistantProblem(e));
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const lastAnswer = [...entries].reverse().find((x) => x.role === 'assistant' && !x.error)?.text ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {off ? <p className="rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-[#7A4308] dark:text-warning">{off}</p> : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={view.scroller} onScroll={view.onScroll} data-testid="ai-conversation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-thin" aria-live="polite">
        <div ref={view.content} className="flex flex-col gap-3 pb-1">
        {/* First-use Local AI setup: offered until a model on this computer can answer, then "ready" once (worksuite-desktop#49/#55). */}
        {surface === 'assistant.panel' ? (
          <LocalSetup
            onStart={() => {
              setLocalPick(true);
              input.current?.focus();
            }}
          />
        ) : null}
        {entries.length === 0 && !off ? (
          <p className="text-[12.5px] text-ink-3">
            Ask about your work — tasks, mail, files, meetings, customers. The assistant sees only what you can open, and changes nothing until you confirm it.
          </p>
        ) : null}
        {entries.map((e, i) => <Bubble key={i} e={e} elsewhere={reviewElsewhere} />)}
        {streaming ? <Bubble e={{ role: 'assistant', text: streaming, local: true }} /> : null}
        {busy && !streaming ? <p className="flex items-center gap-2 text-[12.5px] text-ink-3"><Icon name="spinner" size={14} className="animate-spin" /> Looking into it…</p> : null}
        </div>
      </div>
      {view.unseen ? (
        <button type="button" onClick={view.toEnd} className="absolute bottom-2 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-ink shadow-md hover:bg-subtle">
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
        {localModel ? (
          <div role="radiogroup" aria-label="Who answers" className="flex rounded-[9px] bg-subtle p-0.5 text-[12px] font-semibold">
            {[
              { v: false, label: 'WorkSuite AI', icon: 'sparkles', hint: 'The server\'s assistant: sees what you can open, proposes changes.' },
              { v: true, label: 'On this computer', icon: 'cpu', hint: `${localModel.model.name}, on this computer — nothing leaves it; it cannot see your WorkSuite data.` },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={local === o.v}
                title={o.hint}
                disabled={busy || (!o.v && offline)}
                onClick={() => setLocalPick(o.v)}
                className={cx('flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[7px] transition-colors disabled:opacity-50', local === o.v ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}
              >
                <Icon name={o.icon} size={13} /> {o.label}
              </button>
            ))}
          </div>
        ) : null}
        {tabRef && !local ? (
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <input type="checkbox" checked={useTab} onChange={(e) => setUseTab(e.target.checked)} />
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
                <button type="button" aria-label={`Leave out ${f.name}`} onClick={() => setFiles((all) => all.filter((x) => x.ref !== f.ref))}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
        ) : null}
        {fileError ? <p role="alert" className="text-[12px] text-danger">{fileError}</p> : null}
        {/* The Chat composer's box: the field and its buttons in one bordered, focus-ringed frame. */}
        <div className={cx('relative flex items-end gap-1 rounded-[12px] border px-2 py-1.5 transition-colors', off ? 'border-line bg-subtle/60' : 'border-line bg-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15')}>
          {surface === 'assistant.panel' && rules?.localFiles && !local ? (
            <button type="button" onClick={() => void attach()} disabled={busy || !!off} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-50" aria-label="Ask about a file from this computer" title="Ask about a file from this computer">
              <Icon name="paperclip" size={18} />
            </button>
          ) : null}
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 4000))}
            onKeyDown={onKey}
            rows={1}
            autoFocus={autoFocus}
            disabled={!!off}
            placeholder={selection ? 'Ask about the selected text' : local ? 'Ask the model on this computer' : 'Ask the assistant'}
            aria-label="Your question"
            className="bare-focus field-sizing-content max-h-40 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[13.5px] text-ink outline-none"
          />
          {streaming !== null ? (
            <button type="button" onClick={() => running.current?.cancel()} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-line text-ink hover:bg-subtle" aria-label="Stop" title="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : null}
          <button type="button" onClick={() => void send()} disabled={busy || !text.trim() || !!off} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-primary text-white hover:bg-primary-hover disabled:bg-subtle disabled:text-ink-3" aria-label="Send" title="Send (Enter)">
            <Icon name="send" size={16} />
          </button>
        </div>
        <div className="px-1 text-[11px] text-ink-3">{local ? 'On this computer · nothing is sent · ' : ''}Enter to send · Shift+Enter for a new line</div>
      </div>
    </div>
  );
}

function Bubble({ e, elsewhere }: { e: Entry; elsewhere?: () => void }) {
  if (e.role === 'user') {
    return <p className="ml-8 self-end whitespace-pre-wrap rounded-[12px] bg-primary px-3 py-2 text-[13px] text-white selectable">{e.text}</p>;
  }
  if (e.error) {
    return <p role="alert" className="flex items-start gap-1.5 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger"><Icon name="alert" size={15} className="mt-0.5 shrink-0" />{e.text}</p>;
  }
  const t = e.turn;
  const records = (t?.sources ?? []).filter((s) => s.kind === 'record');
  const cards = (t?.pending_actions ?? []) as PendingAction[];
  return (
    <div className="space-y-2">
      {(t?.tool_runs ?? []).length ? (
        <div className="flex flex-wrap gap-1">
          {t!.tool_runs.map((r, i) => (
            <span key={i} title={r.error ?? undefined} className={cx('rounded-full px-2 py-0.5 text-[11px]', r.ok ? 'bg-subtle text-ink-2' : 'bg-warning-bg text-[#7A4308]')}>{r.label}</span>
          ))}
        </div>
      ) : null}
      {e.local ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
          <Icon name="cpu" size={11} /> On this computer
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
