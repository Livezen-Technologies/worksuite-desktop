import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Button, Chip, Empty, Spinner, TextField, cx } from '../../components/ui';
import type { MeetPoll, MeetQuestion } from './api';
import { useMeetT } from './i18n';
import { meet } from './session';

/**
 * Q&A, polls and raised hands in the meeting room (worksuite-desktop#92).
 *
 * Everything here is what the server says (`meet.activities`), read again
 * whenever the room is told it changed; a button only asks, and the answer is
 * the state after it. Who may do what is the server's to decide — these
 * screens only offer what it will allow. Whether a question or a vote carries
 * the person's name is said before they send it, never after.
 */

const field = 'w-full rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-primary focus:outline-none';

/** The Q&A tab: ask, upvote, and — the host and co-hosts — answer and hide. */
export function QaPanel() {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  const t = useMeetT();
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = meet.activities;
  if (!a) return <Spinner />;
  const on = meet.settings.qa !== false;
  const anonAllowed = on && meet.settings.qa_anonymous !== false;
  const asAnonymous = anonAllowed && anonymous;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    const ok = await meet.ask(q, asAnonymous);
    setBusy(false);
    if (ok) {
      setText('');
      setAnonymous(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3.5 text-[12.5px]">
      {on ? (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
          <textarea
            aria-label={t('act.askPlaceholder')}
            aria-describedby="qa-identity"
            placeholder={t('act.askPlaceholder')}
            rows={2}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className={cx(field, 'resize-none')}
          />
          {anonAllowed ? (
            <label className="flex items-center gap-2 text-ink-2">
              <Checkbox checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              {t('act.askAnonymously')}
            </label>
          ) : null}
          {/* Said before sending: whether the others will see who asked. */}
          <p id="qa-identity" aria-live="polite" className="flex items-start gap-1.5 text-[11.5px] text-ink-3">
            <Icon name={asAnonymous ? 'eye' : 'user'} size={13} className="mt-px shrink-0" />
            {asAnonymous ? t('act.anonymousNote') : anonAllowed ? t('act.identified') : t('act.anonymousOffNote')}
          </p>
          <Button variant="primary" type="submit" loading={busy} disabled={!text.trim()} className="self-end">
            {t('act.ask')}
          </Button>
        </form>
      ) : (
        <p role="status" className="rounded-[9px] bg-subtle px-2.5 py-2 text-ink-2">
          {t('act.qaOff')}
        </p>
      )}
      {a.questions.length ? (
        <ul className="flex flex-col gap-2" aria-label={t('act.qa')}>
          {a.questions.map((q) => (
            <QuestionCard key={q.id} q={q} on={on} manages={meet.canManage} />
          ))}
        </ul>
      ) : (
        <Empty icon="help" title={t('act.noQuestions')} hint={t('act.noQuestionsHint')} />
      )}
    </div>
  );
}

function QuestionCard({ q, on, manages }: { q: MeetQuestion; on: boolean; manages: boolean }) {
  const t = useMeetT();
  const [answering, setAnswering] = useState(false);
  const [draft, setDraft] = useState(q.answer ?? '');
  const who = q.mine ? (q.anonymous ? `${t('act.you')} · ${t('act.anonymous')}` : t('act.you')) : (q.author ?? t('act.anonymous'));
  const link = 'text-[12px] font-semibold text-primary hover:underline';
  return (
    <li className={cx('flex flex-col gap-1.5 rounded-[10px] border border-line p-2.5', q.hidden && 'border-dashed opacity-70')}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          aria-pressed={q.voted}
          aria-label={`${q.voted ? t('act.removeUpvote') : t('act.upvote')} · ${t('act.upvotes', { n: q.votes })}`}
          disabled={!on || q.hidden}
          onClick={() => void meet.upvote(q.id)}
          className={cx('flex w-9 shrink-0 flex-col items-center rounded-[8px] border py-1 text-[11.5px] font-bold disabled:opacity-50', q.voted ? 'border-primary bg-primary/10 text-primary' : 'border-line text-ink-2 hover:bg-subtle')}
        >
          <Icon name="arrow-up" size={13} />
          {q.votes}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="whitespace-pre-wrap break-words text-ink selectable">{q.text}</p>
          <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
            {who}
            {/* The hosts see who asked anonymously; they are told it was asked that way. */}
            {q.anonymous && q.author && !q.mine ? <Chip>{t('act.anonymous')}</Chip> : null}
            {q.guest ? <span>· {t('act.guest')}</span> : null}
            {q.status === 'answered' ? <Chip tone="success">{t('act.answered')}</Chip> : null}
            {q.hidden ? <Chip tone="warning">{t('act.hidden')}</Chip> : null}
          </span>
          {q.answer ? (
            <p className="rounded-[8px] bg-subtle px-2 py-1.5 text-ink-2">
              <b className="text-ink">{q.answered_by ? t('act.answeredBy', { name: q.answered_by }) : t('act.answered')}</b> · {q.answer}
            </p>
          ) : null}
        </div>
      </div>
      {manages ? (
        <div className="flex flex-wrap items-center gap-3 ps-11">
          <button type="button" className={link} onClick={() => (setDraft(q.answer ?? ''), setAnswering(!answering))} aria-expanded={answering}>
            {t('act.answer')}
          </button>
          {q.status === 'answered' ? (
            <button type="button" className={link} onClick={() => void meet.answer(q.id, false)}>
              {t('act.reopen')}
            </button>
          ) : (
            <button type="button" className={link} onClick={() => void meet.answer(q.id, true)}>
              {t('act.markAnswered')}
            </button>
          )}
          <button type="button" className={cx(link, !q.hidden && 'text-danger')} onClick={() => void meet.hideQuestion(q.id, !q.hidden)}>
            {q.hidden ? t('act.unhide') : t('act.hide')}
          </button>
        </div>
      ) : null}
      {answering ? (
        <div className="flex flex-col gap-1.5 ps-11">
          <textarea aria-label={t('act.answerPlaceholder')} placeholder={t('act.answerPlaceholder')} rows={2} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} className={cx(field, 'resize-none')} />
          <span className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setAnswering(false)}>
              {t('act.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void meet.answer(q.id, true, draft).then((ok) => ok && setAnswering(false))}>
              {t('act.markAnswered')}
            </Button>
          </span>
        </div>
      ) : null}
    </li>
  );
}

/** The Polls tab: vote; the host and co-hosts create, launch, close and share. */
export function PollsPanel() {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  const t = useMeetT();
  const [creating, setCreating] = useState(false);
  const a = meet.activities;
  if (!a) return <Spinner />;
  const on = meet.settings.polls !== false;
  const manages = meet.canManage;
  // Live polls first, then drafts, then the closed ones; newest first in each.
  const rank = { live: 0, draft: 1, closed: 2 } as const;
  const polls = [...a.polls].sort((x, y) => rank[x.status] - rank[y.status] || y.id - x.id);
  return (
    <div className="flex flex-col gap-3 p-3.5 text-[12.5px]">
      {!on ? (
        <p role="status" className="rounded-[9px] bg-subtle px-2.5 py-2 text-ink-2">
          {t('act.pollsOff')}
        </p>
      ) : null}
      {manages && on ? (
        creating ? (
          <PollEditor onDone={() => setCreating(false)} />
        ) : (
          <Button icon="plus" className="self-start" onClick={() => setCreating(true)}>
            {t('act.newPoll')}
          </Button>
        )
      ) : null}
      {!polls.length && !creating ? <Empty icon="chart" title={t('act.noPolls')} hint={manages ? t('act.noPollsHost') : t('act.noPollsHint')} /> : null}
      {polls.map((p) => (
        <PollCard key={p.id} p={p} on={on} manages={manages} />
      ))}
    </div>
  );
}

function PollEditor({ onDone }: { onDone: () => void }) {
  const t = useMeetT();
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<'single' | 'multiple'>('single');
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = !!question.trim() && new Set(filled.map((o) => o.toLowerCase())).size >= 2;

  const save = async (launch: boolean) => {
    setBusy(true);
    const before = new Set(meet.activities?.polls.map((p) => p.id));
    const ok = await meet.createPoll({ question: question.trim(), kind, options: filled, anonymous });
    const made = ok ? meet.activities?.polls.find((p) => !before.has(p.id)) : undefined;
    if (made && launch) await meet.launchPoll(made.id);
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form onSubmit={(e) => (e.preventDefault(), void save(true))} className="flex flex-col gap-2.5 rounded-[10px] border border-line p-2.5" aria-label={t('act.newPoll')}>
      <TextField label={t('act.pollQuestion')} value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} />
      <fieldset className="flex gap-3">
        <legend className="sr-only">{t('act.chooseOne')}</legend>
        {(['single', 'multiple'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-ink-2">
            <input type="radio" name="poll-kind" checked={kind === k} onChange={() => setKind(k)} />
            {t(k === 'single' ? 'act.single' : 'act.multiple')}
          </label>
        ))}
      </fieldset>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input aria-label={t('act.option', { n: i + 1 })} placeholder={t('act.option', { n: i + 1 })} value={o} maxLength={120} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} className={field} />
          {options.length > 2 ? (
            <button type="button" aria-label={t('act.removeOption', { n: i + 1 })} onClick={() => setOptions(options.filter((_, j) => j !== i))} className="h-8 w-8 shrink-0 rounded-[7px] text-ink-3 hover:bg-subtle">
              ×
            </button>
          ) : null}
        </div>
      ))}
      {options.length < 10 ? (
        <button type="button" className="self-start text-[12px] font-semibold text-primary hover:underline" onClick={() => setOptions([...options, ''])}>
          + {t('act.addOption')}
        </button>
      ) : null}
      <label className="flex items-start gap-2 text-ink-2">
        <Checkbox className="mt-0.5" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        <span className="flex flex-col">
          <b className="text-ink">{t('act.pollAnonymousChoice')}</b>
          <span className="text-[11.5px] text-ink-3">{t('act.pollAnonymousHint')}</span>
        </span>
      </label>
      <span className="flex justify-end gap-2">
        <Button size="sm" onClick={onDone}>
          {t('act.cancel')}
        </Button>
        <Button size="sm" disabled={!ready} loading={busy} onClick={() => void save(false)}>
          {t('act.saveDraft')}
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!ready} loading={busy}>
          {t('act.launch')}
        </Button>
      </span>
    </form>
  );
}

function PollCard({ p, on, manages }: { p: MeetPoll; on: boolean; manages: boolean }) {
  const t = useMeetT();
  const [pick, setPick] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const voted = p.my_choices !== null;
  const canVote = on && p.status === 'live' && !voted;
  const link = 'text-[12px] font-semibold text-primary hover:underline';
  const choose = (i: number, checked: boolean) => setPick(p.kind === 'single' ? [i] : checked ? [...pick, i] : pick.filter((x) => x !== i));

  const vote = async () => {
    setBusy(true);
    await meet.votePoll(p.id, pick);
    setBusy(false);
  };

  return (
    <section aria-label={p.question} className="flex flex-col gap-2 rounded-[10px] border border-line p-2.5">
      <div className="flex items-start gap-2">
        <b className="min-w-0 flex-1 break-words text-ink">{p.question}</b>
        <Chip tone={p.status === 'live' ? 'success' : p.status === 'draft' ? 'warning' : 'muted'}>{t(p.status === 'live' ? 'act.live' : p.status === 'draft' ? 'act.draft' : 'act.closed')}</Chip>
      </div>
      <span className="text-[11.5px] text-ink-3">
        {t(p.kind === 'single' ? 'act.single' : 'act.multiple')}
        {p.status !== 'draft' ? ` · ${t('act.voters', { n: p.voters })}` : ''}
      </span>
      {/* Whether a vote carries the voter's name: on the card, before anybody votes. */}
      <p role="note" className="flex items-start gap-1.5 rounded-[8px] bg-subtle px-2 py-1.5 text-[11.5px] text-ink-2">
        <Icon name={p.anonymous ? 'eye' : 'user'} size={13} className="mt-px shrink-0" />
        {p.anonymous ? t('act.pollIsAnonymous') : t('act.pollIsIdentified')}
      </p>
      {canVote ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[11.5px] text-ink-3">{t(p.kind === 'single' ? 'act.chooseOne' : 'act.chooseAny')}</legend>
          {p.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2 rounded-[8px] border border-line px-2.5 py-1.5 text-ink hover:bg-subtle">
              {p.kind === 'single' ? (
                <input type="radio" name={`poll-${p.id}`} checked={pick.includes(i)} onChange={(e) => choose(i, e.target.checked)} />
              ) : (
                <Checkbox name={`poll-${p.id}`} checked={pick.includes(i)} onChange={(e) => choose(i, e.target.checked)} />
              )}
              {o}
            </label>
          ))}
          <Button variant="primary" size="sm" className="self-end" disabled={!pick.length} loading={busy} onClick={() => void vote()}>
            {t('act.vote')}
          </Button>
        </fieldset>
      ) : null}
      {/* The hosts follow the results as they come in, whether or not they vote themselves. */}
      {!canVote || (manages && p.results) ? <PollResults poll={p} /> : null}
      {voted ? (
        <span className="flex items-center gap-1 text-[11.5px] font-semibold text-success">
          <Icon name="check" size={13} />
          {t('act.voted')}
        </span>
      ) : null}
      {p.status !== 'draft' && !p.results && !manages ? <p className="text-[11.5px] text-ink-3">{t('act.resultsHidden')}</p> : null}
      {p.shared ? <p className="text-[11.5px] text-ink-3">{t('act.resultsShared')}</p> : null}
      {manages ? (
        <div className="flex flex-wrap gap-3">
          {p.status === 'draft' ? (
            <>
              <button type="button" className={link} disabled={!on} onClick={() => void meet.launchPoll(p.id)}>
                {t('act.launch')}
              </button>
              <button type="button" className={cx(link, 'text-danger')} onClick={() => void meet.deletePoll(p.id)}>
                {t('act.delete')}
              </button>
            </>
          ) : null}
          {p.status === 'live' ? (
            <button type="button" className={link} onClick={() => void meet.closePoll(p.id)}>
              {t('act.close')}
            </button>
          ) : null}
          {p.status !== 'draft' ? (
            <button type="button" className={link} onClick={() => void meet.sharePoll(p.id, !p.shared)}>
              {p.shared ? t('act.unshare') : t('act.share')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A poll's options, with the results when this person may see them: bars and
 * counts, my own choices ticked, and — for the hosts, on a poll that is not
 * anonymous — who chose what. Also used in the meeting's details.
 */
export function PollResults({ poll }: { poll: MeetPoll }) {
  const t = useMeetT();
  const total = poll.voters;
  return (
    <div className="flex flex-col gap-1.5">
      {poll.options.map((o, i) => {
        const count = poll.results?.[i] ?? null;
        const pct = count !== null && total ? Math.round((count / total) * 100) : 0;
        const mine = poll.my_choices?.includes(i);
        return (
          <div key={i} className="flex flex-col gap-0.5" aria-label={count !== null ? `${o}: ${count} (${pct}%)` : o}>
            <span className="flex items-center gap-1.5 text-ink">
              {mine ? <Icon name="check" size={13} className="text-success" /> : null}
              <span className="min-w-0 flex-1 break-words">{o}</span>
              {count !== null ? (
                <span className="text-[11.5px] text-ink-3 tabular-nums">
                  {count} · {pct}%
                </span>
              ) : null}
            </span>
            {count !== null ? (
              <span className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </span>
            ) : null}
          </div>
        );
      })}
      {poll.ballots?.length ? (
        <details className="text-[11.5px] text-ink-2">
          <summary className="cursor-pointer font-semibold">{t('act.whoVoted', { n: poll.ballots.length })}</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {poll.ballots.map((b, i) => (
              <li key={i}>
                <b className="text-ink">{b.name}</b> · {b.choices.map((c) => poll.options[c]).join(', ')}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Raised hands, first raised first, at the top of the People panel. The hosts
 * and co-hosts lower one, or all of them; everybody else sees the queue.
 */
export function HandQueue() {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  const t = useMeetT();
  const hands = meet.activities?.hands ?? [];
  if (!hands.length) return null;
  const manages = meet.canManage;
  return (
    <section aria-label={t('act.hands', { n: hands.length })} className="flex flex-col gap-2 rounded-[10px] border border-[#F1D9B5] bg-[#FFF9EC] p-2.5 dark:bg-warning-bg">
      <div className="flex items-center gap-2">
        <Icon name="hand" size={14} className="text-[#9A5B00]" />
        <b className="flex-1 text-ink">{t('act.hands', { n: hands.length })}</b>
        {manages ? (
          <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => void meet.lowerAllHands()}>
            {t('act.lowerAll')}
          </button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1.5">
        {hands.map((h, i) => (
          <li key={h.who} className="flex items-center gap-2">
            <span className="w-5 text-center text-[11.5px] font-bold text-ink-3 tabular-nums">{i + 1}</span>
            <b className="min-w-0 flex-1 truncate text-ink">{h.mine ? `${h.name} (${t('act.you').toLowerCase()})` : h.name}</b>
            {manages && !h.mine ? (
              <button type="button" aria-label={t('act.lowerFor', { name: h.name })} onClick={() => void meet.lowerHandOf(h.who)} className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink">
                {t('act.lowerHand')}
              </button>
            ) : h.mine ? (
              <button type="button" onClick={() => void meet.raiseHand(false)} className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink">
                {t('act.lowerHand')}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
