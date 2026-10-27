import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../../../core/api';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { Select } from '../../../../components/Select';
import { Button, Empty, ErrorNote, Spinner, TextField, cx } from '../../../../components/ui';
import { Note } from '../../../../components/CardKit';
import {
  AUTO,
  REPLIES,
  assistantsOf,
  changedChatbot,
  chatbotOf,
  chatbotProblems,
  handoverOptions,
  modelOptions,
  modelsOf,
  outcomeLine,
  saveChatbot,
  sourceOptions,
  tryChatbot,
  type ChatbotPayload,
  type ChatbotSettings,
  type TryTurn,
} from './chatbot';
import { Labelled, Toggle } from './parts';

/**
 * Widget settings › Chatbot (S-05; WS-WCHAT X-UI-18, UX-SET-07; BOT-01…06): "Assistant answers first" and its card —
 * name, avatar, model, what it answers from, when it hands the chat to a person, replies before it stops — the note on
 * what the hand-off does, and beside them TRY IT, a test chat with the settings on screen whose chats are not saved and
 * ring nobody.
 *
 * Like Behaviour, it saves from the editor's header (the design's Save), so its state lives in `useChatbot()`, which
 * the editor holds; only what was changed is sent (`PUT widgets/{id}/chatbot`).
 */

export type ChatbotState = ReturnType<typeof useChatbot>;

export function useChatbot(id: number, enabled: boolean) {
  const qc = useQueryClient();
  const key = ['website', 'widget-chatbot', id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => chatbotOf(id, signal), retry: false, enabled });
  const [draft, setDraft] = useState<ChatbotSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = q.data?.settings ?? null;
  const settings = draft ?? saved;
  const changes = saved && settings ? changedChatbot(saved, settings) : {};
  const issues = settings ? chatbotProblems(settings) : {};
  const dirty = Object.keys(changes).length > 0;
  const blocked = Object.keys(issues).length > 0;
  // A server from before S-05 has no such page: the tab says so.
  const missing = q.error instanceof ApiError && q.error.status === 404;

  const set = <K extends keyof ChatbotSettings>(k: K, v: ChatbotSettings[K]) =>
    setDraft((d) => {
      const base = d ?? saved;
      return base ? { ...base, [k]: v } : d;
    });
  const save = async () => {
    if (!dirty || blocked) return;
    setBusy(true);
    try {
      const fresh = await saveChatbot(id, changes);
      qc.setQueryData<ChatbotPayload>(key, fresh);
      setDraft(null);
      // The widgets list's "Chatbot on" chip.
      void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
      toast('success', text('Widget saved — visitors see it on their next page'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return { q, settings, set, save, dirty, blocked, busy, issues, missing, can: Boolean(q.data?.can_manage) };
}

export function ChatbotTab({ id, c }: { id: number; c: ChatbotState }) {
  const models = useQuery({ queryKey: ['website', 'widget-chatbot-models', id], queryFn: ({ signal }) => modelsOf(id, signal), retry: false, staleTime: 300_000 });
  const assistants = useQuery({ queryKey: ['ai', 'assistants-published'], queryFn: ({ signal }) => assistantsOf(signal), staleTime: 300_000 });

  if (c.q.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (c.missing || (c.q.data && !c.q.data.installed)) {
    return <div className="flex flex-1"><Empty icon="sparkles" title="Not on this server yet" hint="Update WorkSuite's Communication module to set the widget's chatbot here." /></div>;
  }
  if (c.q.error || !c.q.data || !c.settings) return <div className="flex-1 p-6"><ErrorNote error={c.q.error} onRetry={() => void c.q.refetch()} /></div>;

  const s = c.settings;
  const p = c.q.data;
  const published = assistants.data ?? [];
  const assistant = s.ai_assistant_id ? published.find((a) => a.id === s.ai_assistant_id) ?? null : null;
  const turnOn = (v: boolean) => {
    c.set('ai_enabled', v);
    // On with nothing to answer with would be on and silent: the organisation's default model, unless one is chosen.
    if (v && !s.ai_model && !s.ai_assistant_id) c.set('ai_model', AUTO);
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <form
        aria-label="Chatbot"
        onSubmit={(e) => {
          e.preventDefault();
          void c.save();
        }}
        className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pb-4 scroll-thin"
      >
        {!c.can ? <Note>You can look at these settings. Changing them needs the “Create and configure chat widgets” permission.</Note> : null}
        <fieldset disabled={!c.can || c.busy} className="flex min-w-0 flex-col gap-3">
          <div className="rounded-[12px] border border-line bg-surface px-4 py-3">
            <Toggle
              label="Assistant answers first"
              hint="Answers from your knowledge base, then hands the chat to a person. Its replies never count as a staff reply."
              checked={s.ai_enabled}
              onChange={turnOn}
            />
          </div>

          <div className="grid grid-cols-2 gap-3.5 rounded-[12px] border border-line bg-surface p-4">
            <TextField label="Assistant name" maxLength={60} value={s.bot_name ?? ''} placeholder="Aria" onChange={(e) => c.set('bot_name', e.target.value || null)} />
            <TextField
              label="Assistant avatar URL"
              type="url"
              maxLength={500}
              value={s.avatar_url ?? ''}
              placeholder="https://…/avatar.png"
              onChange={(e) => c.set('avatar_url', e.target.value.trim() || null)}
              error={c.issues.avatar_url ?? null}
            />
            <Labelled label="Model">
              <Select
                aria-label="Model"
                placeholder="Choose a model"
                value={s.ai_assistant_id ? (assistant?.model ?? s.ai_model) : s.ai_model}
                disabled={Boolean(s.ai_assistant_id)}
                onValueChange={(v) => c.set('ai_model', v)}
                options={modelOptions(models.data?.models ?? [], s.ai_assistant_id ? (assistant?.model ?? s.ai_model) : s.ai_model)}
              />
              {s.ai_assistant_id ? <span className="text-[12px] text-ink-3">The assistant brings its own model.</span> : null}
            </Labelled>
            <Labelled label="Answers from">
              <Select aria-label="Answers from" value={s.ai_assistant_id ?? 0} onValueChange={(v) => c.set('ai_assistant_id', v || null)} options={sourceOptions(p.articles, published, s.ai_assistant_id)} />
            </Labelled>
            <Labelled label="Hand to a person after">
              <Select aria-label="Hand to a person after" value={s.ai_handover_after} onValueChange={(v) => c.set('ai_handover_after', v)} options={handoverOptions(s.ai_handover_after)} />
            </Labelled>
            <TextField
              label="Replies before it stops"
              type="number"
              inputMode="numeric"
              min={REPLIES[0]}
              max={REPLIES[1]}
              className="w-[100px]"
              value={Number.isFinite(s.ai_max_replies) ? String(s.ai_max_replies) : ''}
              onChange={(e) => c.set('ai_max_replies', e.target.value === '' ? Number.NaN : Number(e.target.value))}
              error={c.issues.ai_max_replies ?? null}
            />
          </div>

          <Note tone="amber" className="rounded-[12px] border border-warning-line px-3.5 py-3 dark:border-warning/40">
            When staff are online the hand-off rings them like any new chat. Outside hours the assistant takes the visitor's email instead.
          </Note>
        </fieldset>
      </form>
      <TryIt id={id} s={s} can={c.can} />
    </div>
  );
}

type Line = TryTurn | { from: 'note'; body: string };

/** TRY IT: a test chat with the settings on screen. Nothing is saved and nobody is rung. */
function TryIt({ id, s, can }: { id: number; s: ChatbotSettings; can: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const name = s.bot_name?.trim() || 'Assistant';

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [lines, busy]);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    const history = lines.filter((l): l is TryTurn => l.from !== 'note');
    setLines((ls) => [...ls, { from: 'visitor', body: message }]);
    setDraft('');
    setBusy(true);
    try {
      const r = await tryChatbot(id, message, history, {
        bot_name: s.bot_name,
        ai_model: s.ai_model,
        ai_assistant_id: s.ai_assistant_id,
        ai_max_replies: s.ai_max_replies,
        ai_handover_after: s.ai_handover_after,
      });
      const note = outcomeLine(r.outcome);
      setLines((ls) => [...ls, r.outcome === 'answered' && r.reply ? { from: 'bot', body: r.reply } : { from: 'note', body: note ?? '' }]);
    } catch (err) {
      setLines((ls) => [...ls, { from: 'note', body: errorMessage(err) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Try it" className="flex w-[360px] shrink-0 flex-col gap-2.5 self-start rounded-[12px] border border-line bg-subtle p-4">
      <div className="flex items-center">
        <h3 className="flex-1 text-[10.5px] font-bold tracking-[0.9px] text-ink-3">TRY IT</h3>
        {lines.length ? <button type="button" onClick={() => setLines([])} className="text-[11.5px] font-semibold text-primary hover:underline">Start again</button> : null}
      </div>
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        <div role="log" aria-label="Test chat" className="flex max-h-[360px] min-h-[160px] flex-col gap-2 overflow-y-auto bg-ground px-3.5 py-3 scroll-thin">
          {lines.map((l, i) =>
            l.from === 'visitor' ? (
              <div key={i} className="max-w-[260px] self-end rounded-[12px_12px_4px_12px] bg-primary px-[11px] py-[7px] text-[12.5px] whitespace-pre-wrap text-white">{l.body}</div>
            ) : l.from === 'bot' ? (
              <div key={i} className="max-w-[260px] self-start rounded-[12px] border border-teal/30 bg-teal/10 px-[11px] py-[7px] text-[12.5px] whitespace-pre-wrap text-ink">
                <span className="text-[10.5px] font-bold text-teal">{text('{name} · assistant', { name })}</span>
                <br />
                {l.body}
              </div>
            ) : (
              <div key={i} role="status" className="self-center text-center text-[11px] text-ink-3">{l.body}</div>
            ),
          )}
          {busy ? <div className="self-start text-[11px] text-ink-3">{text('{name} is typing…', { name })}</div> : null}
          <div ref={end} />
        </div>
        <form onSubmit={(e) => void ask(e)} className="flex items-center gap-2 border-t border-line px-3 py-[9px]">
          <input
            aria-label="Ask the assistant"
            placeholder="Ask the assistant…"
            value={draft}
            disabled={!can}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
          />
          <Button type="submit" size="sm" variant="primary" disabled={!can || busy || !draft.trim()} className={cx(!draft.trim() && 'opacity-60')}>Send</Button>
        </form>
      </div>
      <p className="text-[11.5px] text-ink-3">Test chats are not saved and do not ring anyone.</p>
    </section>
  );
}
