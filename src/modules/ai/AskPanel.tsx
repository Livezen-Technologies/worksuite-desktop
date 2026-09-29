import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { navigate } from '../../core/tabs';
import { ActionCard } from './ActionCard';
import { ask, assistantProblem, pickFile, useAssistant, type AskTurn, type PendingAction, type Surface } from './assistant';

interface Entry {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  turn?: AskTurn;
}

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
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => setUseTab(true), [tabRef]);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [entries, busy]);

  const off = availability.data && !availability.data.enabled ? availability.data.reason ?? 'The assistant is not switched on for you.' : null;
  const refs = [...(useTab && tabRef ? [tabRef] : []), ...files.map((f) => f.ref)];

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    // A selection from another app goes with the question, fenced, as material to work on.
    const full = selection && selection.trim() && entries.length === 0 ? `${q}\n\nThe text I selected:\n"""\n${selection.trim().slice(0, 6000)}\n"""` : q;
    setText('');
    setEntries((e) => [...e, { role: 'user', text: q }]);
    setBusy(true);
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin" aria-live="polite">
        {entries.length === 0 && !off ? (
          <p className="text-[12.5px] text-ink-3">
            Ask about your work — tasks, mail, files, meetings, customers. The assistant sees only what you can open, and changes nothing until you confirm it.
          </p>
        ) : null}
        {entries.map((e, i) => <Bubble key={i} e={e} elsewhere={reviewElsewhere} />)}
        {busy ? <p className="flex items-center gap-2 text-[12.5px] text-ink-3"><Icon name="spinner" size={14} className="animate-spin" /> Looking into it…</p> : null}
        <div ref={end} />
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
        {tabRef ? (
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
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 4000))}
            onKeyDown={onKey}
            rows={2}
            autoFocus={autoFocus}
            disabled={!!off}
            placeholder={selection ? 'Ask about the selected text' : 'Ask the assistant'}
            aria-label="Your question"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-[10px] border border-line bg-subtle/60 px-3 py-2 text-[13px] text-ink outline-none focus:border-primary"
          />
          {surface === 'assistant.panel' && rules?.localFiles ? (
            <button type="button" onClick={() => void attach()} disabled={busy || !!off} className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-line text-ink-2 hover:bg-subtle disabled:opacity-50" aria-label="Ask about a file from this computer" title="Ask about a file from this computer">
              <Icon name="paperclip" size={16} />
            </button>
          ) : null}
          <button type="button" onClick={() => void send()} disabled={busy || !text.trim() || !!off} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary text-white hover:bg-primary-hover disabled:opacity-50" aria-label="Send">
            <Icon name="send" size={16} />
          </button>
        </div>
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
