import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AI_TONES, AI_TONE_LABEL, LANGUAGE_LABEL, PRIORITY_LABEL, type AiClassification, type AiReplyDraft, type AiTone, type KbSuggestion, type TicketChanges, type TicketShow } from '@shared/support';
import { call, isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, IconButton, Kbd, cx } from '../../components/ui';
import { K, aiClassify, aiReply, aiSummary, assistError, errorText, insertArticle, ticketArticles, updateTicket } from './api';
import type { InsertRequest } from './Composer';
import { AiBadge } from './parts';

/**
 * The KB & AI side panel inside a ticket (WS-SUPPORT-SRS-001 D-10; FR-KB-02/06/08, FR-AI-01…03/07, AC-17), opened and
 * closed with ⌘J / Ctrl+J while the ticket's tab is in front.
 *
 *  - Knowledge: the articles the server ranks for this ticket (its subject and the requester's last message), or a
 *    search. Insert link (public articles only: an internal one has no address a customer could open) or Insert
 *    text puts it into the composer at the caret — through `POST tickets/{id}/kb/insert`, which counts the use.
 *  - AI assist: the thread's summary (asked when the panel shows it, kept by the server until the thread moves, and
 *    Refresh); a suggested reply in a chosen tone, notes in it only when asked, editable here, with the articles it
 *    leaned on, put into the composer as a draft; the category, priority and language the assistant reads, each
 *    applied with one click through the ordinary PATCH (with the version shown, so a ticket changed meanwhile is
 *    refused rather than overwritten).
 *
 * Everything the assistant wrote carries the violet AI badge, and nothing is ever sent from here: the agent reviews
 * it in the composer and presses Send. The assistant being away (`503 AI_UNAVAILABLE`) is said quietly; the rest of
 * the ticket works on.
 */
export type AssistTab = 'kb' | 'ai';

const SPLIT_KEY = 'ws.support.assist.split';

function rememberedSplit(): boolean {
  try {
    return localStorage.getItem(SPLIT_KEY) === '1';
  } catch {
    return false;
  }
}

/** "92%": a match score as the panel says it (the server's is 0…1). */
export function scoreLabel(score: number | null | undefined): string | null {
  if (score === null || score === undefined || !Number.isFinite(score) || score <= 0) return null;
  return `${Math.round(score <= 1 ? score * 100 : score)}%`;
}

/** What a KB insert puts in the reply: the article's link with its title, or its text. */
export function kbInsertText(mode: 'link' | 'text', answer: { url: string | null; text: string; title: string }): string {
  if (mode === 'link') return answer.url ? `${answer.title}: ${answer.url}` : answer.title;
  return answer.text.trim();
}

/** The classification's suggestions that would change the ticket, as PATCH fields with their words. */
export function classifyChanges(c: AiClassification, t: TicketShow['ticket']): Array<{ key: 'category' | 'priority' | 'language'; label: string; value: string; changes: TicketChanges }> {
  const out: Array<{ key: 'category' | 'priority' | 'language'; label: string; value: string; changes: TicketChanges }> = [];
  if (c.category_id && c.category_id !== t.category?.id) out.push({ key: 'category', label: text('Category'), value: c.category ?? `#${c.category_id}`, changes: { category_id: c.category_id } });
  if (c.priority && c.priority !== t.priority) out.push({ key: 'priority', label: text('Priority'), value: text(PRIORITY_LABEL[c.priority] ?? c.priority), changes: { priority: c.priority } });
  if (c.language && c.language !== (t.language ?? null)) out.push({ key: 'language', label: text('Language'), value: text(LANGUAGE_LABEL[c.language] ?? c.language), changes: { language: c.language } });
  return out;
}

export function Assist({
  show,
  tab,
  onTab,
  searchRequest,
  onInsert,
  onClose,
}: {
  show: TicketShow;
  tab: AssistTab;
  onTab: (t: AssistTab) => void;
  /** The palette's "Insert KB link…": the search box takes the focus. A new number asks again. */
  searchRequest?: number;
  onInsert: (r: Omit<InsertRequest, 'n'>) => void;
  onClose: () => void;
}) {
  const [split, setSplit] = useState(rememberedSplit);
  const toggleSplit = () => {
    setSplit(!split);
    try {
      localStorage.setItem(SPLIT_KEY, split ? '0' : '1');
    } catch {
      // A view preference: the panel opens with tabs next time.
    }
  };
  const tabs: Array<{ id: AssistTab; label: string }> = [
    { id: 'kb', label: text('Knowledge') },
    { id: 'ai', label: text('AI assist') },
  ];
  return (
    <aside aria-label={text('KB & AI')} className={cx('flex h-full shrink-0 flex-col border-l border-line bg-surface', split ? 'w-[640px]' : 'w-[340px]')}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 pt-2">
        <b className="pb-2 text-[13px] text-ink">{text('KB & AI')}</b>
        <Kbd className="mb-2" aria-hidden>
          {isMac ? '⌘J' : 'Ctrl+J'}
        </Kbd>
        {split ? null : (
          <div role="tablist" aria-label={text('KB & AI')} className="-mb-px ml-2 flex gap-3">
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tab === x.id}
                onClick={() => onTab(x.id)}
                className={cx('h-8 border-b-2 text-[12.5px] font-semibold', tab === x.id ? 'border-primary text-ink' : 'border-transparent text-ink-3 hover:text-ink')}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto flex items-center gap-1 pb-2">
          <IconButton icon="layout-side" size={15} active={split} aria-pressed={split} label={split ? text('Show as tabs') : text('Side by side')} onClick={toggleSplit} className="h-7 w-7" />
          <IconButton icon="x" size={15} label={text('Close KB & AI')} onClick={onClose} className="h-7 w-7" />
        </span>
      </header>
      <div className={cx('flex min-h-0 flex-1', split ? 'flex-row' : 'flex-col')}>
        {split || tab === 'kb' ? (
          <div role={split ? 'region' : 'tabpanel'} aria-label={text('Knowledge')} className={cx('flex min-h-0 flex-1 flex-col', split && 'border-r border-line')}>
            <Knowledge show={show} searchRequest={searchRequest} onInsert={onInsert} />
          </div>
        ) : null}
        {split || tab === 'ai' ? (
          <div role={split ? 'region' : 'tabpanel'} aria-label={text('AI assist')} className="flex min-h-0 flex-1 flex-col">
            <AiAssist show={show} onInsert={onInsert} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/* ── Knowledge ──────────────────────────────────────────────────────────── */

function Knowledge({ show, searchRequest, onInsert }: { show: TicketShow; searchRequest?: number; onInsert: (r: Omit<InsertRequest, 'n'>) => void }) {
  const t = show.ticket;
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    if (searchRequest) box.current?.focus();
  }, [searchRequest]);
  const list = useQuery({ queryKey: K.kb(t.id, asked), queryFn: ({ signal }) => ticketArticles(t.id, asked, signal), staleTime: 60_000, retry: false });
  const canInsert = show.can.reply === true && !t.merged_into && !t.deleted_at;

  const insert = async (a: KbSuggestion, mode: 'link' | 'text') => {
    setBusy(`${a.id}:${mode}`);
    try {
      const r = await insertArticle(t.id, a.id, mode);
      onInsert({ text: kbInsertText(mode, r), how: 'insert' });
    } catch (e) {
      toast('error', assistError(e));
    } finally {
      setBusy(null);
    }
  };

  const articles = list.data ?? [];
  return (
    <>
      <div className="shrink-0 px-3 pt-2.5 pb-2">
        <label className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} placeholder={text('Search the knowledge base')} aria-label={text('Search the knowledge base')} className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-thin">
        <p className="pb-1.5 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">{asked ? text('Results for “{q}”', { q: asked }) : text('Suggested for this ticket')}</p>
        {list.isLoading ? (
          <p role="status" className="py-3 text-[12px] text-ink-3">
            {text('Looking…')}
          </p>
        ) : list.error ? (
          <p role="alert" className="py-3 text-[12px] text-danger">
            {assistError(list.error)}
          </p>
        ) : !articles.length ? (
          <p className="py-3 text-[12px] text-ink-3">{asked ? text('No article matches.') : text('No article fits this ticket yet. Search for one above.')}</p>
        ) : (
          <ul aria-label={text('Articles')} className="flex flex-col gap-2">
            {articles.map((a) => {
              const internal = a.visibility !== 'public';
              const score = scoreLabel(a.score);
              return (
                <li key={a.id} className="rounded-[10px] border border-line bg-surface p-2.5 text-[12.5px]">
                  <div className="flex items-start gap-2">
                    <Icon name="book-open" size={14} className="mt-0.5 shrink-0 text-ink-3" />
                    <b className="min-w-0 flex-1 text-ink">{a.title}</b>
                    {score ? <span className="shrink-0 text-[11.5px] font-semibold text-success">{score}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                    <span className={cx('rounded-[5px] px-1 font-semibold', internal ? 'bg-warning-bg text-warning-ink' : 'bg-subtle text-ink-2')}>{internal ? text('Internal') : text('Public')}</span>
                    {a.language ? <span>{(a.language ?? '').toUpperCase()}</span> : null}
                  </div>
                  {a.excerpt ? <p className="mt-1 line-clamp-3 text-[12px] text-ink-2 selectable">{a.excerpt}</p> : null}
                  {canInsert ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button size="sm" icon="link" disabled={internal} title={internal ? text('An internal article has no link a customer could open. Insert its text instead.') : undefined} loading={busy === `${a.id}:link`} onClick={() => void insert(a, 'link')}>
                        {text('Insert link')}
                      </Button>
                      <Button size="sm" variant="ghost" icon="file-text" loading={busy === `${a.id}:text`} onClick={() => void insert(a, 'text')}>
                        {text('Insert text')}
                      </Button>
                      {a.url ? <IconButton icon="external" size={14} label={text('Open {title} in the help centre', { title: a.title })} onClick={() => void call('app:openExternal', { url: a.url! }).catch(() => undefined)} className="ml-auto h-7 w-7" /> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/* ── AI assist ──────────────────────────────────────────────────────────── */

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-[10px] border border-line bg-surface p-2.5 text-[12.5px]">
      <header className="mb-1.5 flex items-center gap-1.5">
        <AiBadge />
        <b className="flex-1 text-ink">{title}</b>
        {aside}
      </header>
      {children}
    </section>
  );
}

function AiAssist({ show, onInsert }: { show: TicketShow; onInsert: (r: Omit<InsertRequest, 'n'>) => void }) {
  const qc = useQueryClient();
  const t = show.ticket;
  const readOnly = !!t.merged_into || !!t.deleted_at;
  const last = show.messages[show.messages.length - 1]?.id ?? 0;
  // Asked when the panel shows it, and again when the thread has moved (the server's copy is per last message).
  const summary = useQuery({ queryKey: [...K.summary(t.id), last], queryFn: () => aiSummary(t.id), staleTime: Infinity, retry: false });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData([...K.summary(t.id), last], await aiSummary(t.id, true));
    } catch (e) {
      toast('error', assistError(e));
    } finally {
      setRefreshing(false);
    }
  };

  const [tone, setTone] = useState<AiTone>('friendly');
  const [notes, setNotes] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [reply, setReply] = useState<{ phase: 'working' } | { phase: 'error'; error: string } | ({ phase: 'done'; text: string } & AiReplyDraft) | null>(null);
  const suggest = async () => {
    setReply({ phase: 'working' });
    try {
      const r = await aiReply(t.id, { tone, include_notes: notes && show.can.notes === true, instructions });
      setReply({ phase: 'done', ...r, text: r.draft });
    } catch (e) {
      setReply({ phase: 'error', error: assistError(e) });
    }
  };

  const [detected, setDetected] = useState<{ phase: 'working' } | { phase: 'error'; error: string } | { phase: 'done'; c: AiClassification } | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const detect = async () => {
    setDetected({ phase: 'working' });
    try {
      setDetected({ phase: 'done', c: await aiClassify(t.id) });
    } catch (e) {
      setDetected({ phase: 'error', error: assistError(e) });
    }
  };
  const apply = async (key: string, changes: TicketChanges) => {
    setApplying(key);
    try {
      const r = await updateTicket(t.id, t.version, changes);
      toast('success', r ? text('{ref} updated.', { ref: t.reference }) : text('The change is in the outbox and goes when WorkSuite is back.'));
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setApplying(null);
      void qc.invalidateQueries({ queryKey: K.ticket(t.id) });
    }
  };
  const suggestions = detected?.phase === 'done' ? classifyChanges(detected.c, t) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2.5 scroll-thin">
      <Section
        title={text('Thread summary')}
        aside={
          <IconButton icon="refresh" size={13} label={text('Summarise again')} disabled={refreshing || summary.isFetching} onClick={() => void refresh()} className={cx('h-6 w-6', refreshing && 'animate-spin-slow')} />
        }
      >
        {summary.isLoading ? (
          <p role="status" className="text-ink-3">
            {text('Summarising the thread…')}
          </p>
        ) : summary.error ? (
          <p role="alert" className="text-ink-3">
            {assistError(summary.error)}
          </p>
        ) : summary.data ? (
          <>
            <p className="whitespace-pre-wrap text-ink selectable">{summary.data.text}</p>
            <p className="mt-1 text-[11px] text-ink-3">{[text('{n} messages', { n: show.messages.length }), summary.data.at ? timeLabel(summary.data.at) : null].filter(Boolean).join(' · ')}</p>
          </>
        ) : null}
      </Section>

      {show.can.reply && !readOnly ? (
        <Section title={text('Suggested reply')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Select<AiTone> className="h-7 w-[140px] text-[12px]" aria-label={text('Tone')} value={tone} onValueChange={(v) => setTone(v)} options={AI_TONES.map((x) => ({ value: x, label: text(AI_TONE_LABEL[x]) }))} />
            {show.can.notes ? (
              <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
                <Checkbox checked={notes} onChange={(e) => setNotes(e.target.checked)} />
                {text('Use internal notes')}
              </label>
            ) : null}
          </div>
          <input value={instructions} onChange={(e) => setInstructions(e.target.value)} aria-label={text('What the reply should say (optional)')} placeholder={text('What it should say (optional)')} className="mt-1.5 h-7 w-full rounded-[6px] border border-line bg-surface px-2 text-[12px] text-ink outline-none focus:border-primary" />
          <div className="mt-1.5 flex justify-end">
            <Button size="sm" icon="sparkles" loading={reply?.phase === 'working'} onClick={() => void suggest()}>
              {reply?.phase === 'done' ? text('Suggest again') : text('Suggest a reply')}
            </Button>
          </div>
          {reply?.phase === 'error' ? (
            <p role="alert" className="mt-1.5 text-ink-3">
              {reply.error}
            </p>
          ) : null}
          {reply?.phase === 'done' ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <textarea value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })} rows={6} aria-label={text('Suggested reply')} className="w-full resize-y rounded-[8px] border border-[#DDD6FE] bg-[#F5F3FF] px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-primary dark:border-[#3B2F63] dark:bg-[#1A1530]" />
              {reply.sources.length ? (
                <div className="text-[11.5px] text-ink-3">
                  {text('Based on:')}
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {reply.sources.map((s) => (
                      <li key={s.id} className="flex items-center gap-1">
                        <Icon name="book-open" size={12} />
                        {s.url ? (
                          <button type="button" className="text-primary hover:underline" onClick={() => void call('app:openExternal', { url: s.url! }).catch(() => undefined)}>
                            {s.title}
                          </button>
                        ) : (
                          s.title
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-ink-3">{text('Never sent automatically — you review and send.')}</span>
                <Button size="sm" variant="primary" className="ml-auto" disabled={!reply.text.trim()} onClick={() => onInsert({ text: reply.text.trim(), how: 'insert', mode: 'reply' })}>
                  {text('Insert into composer')}
                </Button>
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      {show.can.edit && !readOnly ? (
        <Section
          title={text('Detected')}
          aside={
            <Button size="sm" variant="ghost" loading={detected?.phase === 'working'} onClick={() => void detect()}>
              {detected?.phase === 'done' ? text('Detect again') : text('Detect')}
            </Button>
          }
        >
          {!detected ? <p className="text-ink-3">{text('Category, priority, language and sentiment as the assistant reads the ticket.')}</p> : null}
          {detected?.phase === 'error' ? (
            <p role="alert" className="text-ink-3">
              {detected.error}
            </p>
          ) : null}
          {detected?.phase === 'done' ? (
            <div className="flex flex-col gap-1">
              {suggestions.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="w-[70px] shrink-0 text-ink-3">{s.label}</span>
                  <b className="min-w-0 flex-1 truncate text-ink">{s.value}</b>
                  <Button size="sm" variant="ghost" loading={applying === s.key} disabled={!!applying} onClick={() => void apply(s.key, s.changes)}>
                    {text('Apply')}
                  </Button>
                </div>
              ))}
              {detected.c.sentiment ? (
                <div className="flex items-center gap-2">
                  <span className="w-[70px] shrink-0 text-ink-3">{text('Sentiment')}</span>
                  <b className="text-ink">{text(detected.c.sentiment.charAt(0).toUpperCase() + detected.c.sentiment.slice(1))}</b>
                </div>
              ) : null}
              {!suggestions.length ? <p className="text-ink-3">{text('The ticket already says what the assistant reads.')}</p> : null}
              {suggestions.length > 1 ? (
                <div className="flex justify-end">
                  <Button size="sm" loading={applying === 'all'} disabled={!!applying} onClick={() => void apply('all', Object.assign({}, ...suggestions.map((s) => s.changes)) as TicketChanges)}>
                    {text('Apply all')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </Section>
      ) : null}

      <p className="mt-auto pt-1 text-[11px] text-ink-3">{text('All AI goes through your organization’s AI policy and is logged. Nothing is sent without you.')}</p>
    </div>
  );
}
