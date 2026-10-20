import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { openRouteInWindow } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ResizeDivider, useResizableWidth } from '../../components/ResizeDivider';
import { Avatar, ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, input } from '../hr/parts';
import {
  fetchKit, fetchMyEvaluation, K, saveScorecard, scorecardOk, submitScorecard, validateScorecard,
  type Criterion, type Evaluation, type Interview, type Kit, type Recommendation, type ScorecardDraft,
} from './api';
import { scorecardRoute } from './Today';

/**
 * D04 · the scorecard beside the call. In the Recruitment tab: my interviews, the interview kit, and the scorecard
 * in a resizable panel docked on the right. Popped out (`&solo=1`, a record window of its own, opened by Join Meet),
 * it is a narrow window to keep beside Meet's. Ratings 1–5 per criterion; a 1 or a 5 needs a comment (§3.13).
 */
const RECS: Array<[Recommendation, string]> = [['PROCEED', 'Proceed'], ['HOLD', 'Hold'], ['ADDITIONAL_INTERVIEW', 'Extra round'], ['REJECT', 'Reject']];

export default function Scorecards({ interviews, interview, solo, canEvaluate, onPick }: { interviews: Interview[]; interview: number | null; solo?: boolean; canEvaluate: boolean; onPick: (id: number | null) => void }) {
  const mine = interviews.filter((i) => i.my_role !== 'OBSERVER');
  const chosen = interview ?? mine[0]?.id ?? null;
  const kit = useQuery({ queryKey: K.kit(chosen ?? 0), queryFn: ({ signal }) => fetchKit(chosen!, signal), enabled: !!chosen && canEvaluate });
  const panel = useResizableWidth('recruitment-scorecard', { defaultWidth: 420, min: 340, max: () => Math.max(420, window.innerWidth - 520) });

  if (!canEvaluate) return <p className="m-6 text-[13px] text-ink-2">Scorecards are for interviewers.</p>;
  if (!chosen) return <p className="m-6 text-[13px] text-ink-2">No interviews to score today.</p>;
  const form = kit.isPending ? <Spinner /> : kit.isError ? <ErrorNote error={kit.error} onRetry={() => void kit.refetch()} /> : <ScorecardForm key={chosen} interview={chosen} kit={kit.data} solo={solo} />;
  if (solo) return <div className="h-full overflow-y-auto bg-surface scroll-thin">{form}</div>;

  return (
    <div className="flex h-full min-h-0">
      <ul aria-label="My interviews" className="w-[220px] shrink-0 overflow-y-auto border-r border-line bg-surface scroll-thin">
        {mine.map((i) => (
          <li key={i.id}>
            <button type="button" aria-current={i.id === chosen ? 'true' : undefined} onClick={() => onPick(i.id)} className={cx('flex w-full items-center gap-2 border-b border-line/70 px-3 py-2.5 text-left', i.id === chosen ? 'bg-[#EEF1FD] dark:bg-selection' : 'hover:bg-subtle')}>
              <Avatar name={i.candidate?.name} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{i.candidate?.name ?? 'Candidate'}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{i.my_evaluation?.status === 'SUBMITTED' ? 'Submitted' : i.round ?? i.title ?? ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <section aria-label="Interview kit" className="min-w-0 flex-1 overflow-y-auto p-5 scroll-thin">
        {kit.data ? <KitView kit={kit.data} /> : null}
      </section>
      <ResizeDivider state={panel} label="Resize the scorecard" side="left" />
      <aside aria-label="Scorecard" className="flex shrink-0 flex-col overflow-y-auto border-l border-line bg-surface scroll-thin" style={{ width: panel.width }}>
        <div className="flex justify-end px-4 pt-3">
          <button type="button" className={btn} onClick={() => openRouteInWindow(scorecardRoute(chosen), 'Scorecard')} title="Keep it beside the call">
            <Icon name="app-window" size={14} /> Pop out
          </button>
        </div>
        {form}
      </aside>
    </div>
  );
}

function KitView({ kit }: { kit: Kit }) {
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex items-center gap-3">
        <Avatar name={kit.candidate.name} size={40} />
        <div>
          <b className="text-[16px] text-ink">{kit.candidate.name}</b>
          {kit.candidate.headline ? <div className="text-ink-3">{kit.candidate.headline}</div> : null}
        </div>
      </div>
      {kit.candidate.summary ? <p className="text-ink-2">{kit.candidate.summary}</p> : null}
      <div>
        <div className="mb-1.5 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">Questions</div>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ink">
          {kit.questions.map((q, i) => <li key={q.id ?? i}>{q.text}</li>)}
        </ol>
      </div>
    </div>
  );
}

export function emptyDraft(criteria: Criterion[]): ScorecardDraft {
  return { ratings: criteria.map((c) => ({ criterion_id: c.id, rating: null, comment: '' })), notes: '', recommendation: null };
}

export function ScorecardForm({ interview, kit, solo }: { interview: number; kit: Kit; solo?: boolean }) {
  const existing = useQuery({ queryKey: K.evaluations(interview), queryFn: ({ signal }) => fetchMyEvaluation(interview, signal) });
  if (existing.isPending) return <Spinner />;
  const ev = existing.data ?? null;
  return <ScorecardBody key={ev ? `${ev.id}-${ev.status}` : 'new'} interview={interview} kit={kit} solo={solo} ev={ev} />;
}

/** The draft as last saved, else empty. */
export function draftFrom(ev: Evaluation | null, criteria: Criterion[]): ScorecardDraft {
  const d = emptyDraft(criteria);
  if (!ev) return d;
  return {
    ratings: d.ratings.map((r) => {
      const had = ev.ratings?.find((x) => String(x.criterion_id) === String(r.criterion_id));
      return had ? { ...r, rating: had.rating ?? null, comment: had.comment ?? '' } : r;
    }),
    notes: ev.notes ?? '',
    recommendation: ev.recommendation ?? null,
  };
}

function ScorecardBody({ interview, kit, solo, ev }: { interview: number; kit: Kit; solo?: boolean; ev: Evaluation | null }) {
  const qc = useQueryClient();
  const criteria = kit.criteria;
  const [draft, setDraft] = useState<ScorecardDraft>(() => draftFrom(ev, criteria));
  const [tried, setTried] = useState(false);
  const submitted = ev?.status === 'SUBMITTED';

  const errors = validateScorecard(draft, criteria);
  const save = useMutation({
    mutationFn: () => saveScorecard(interview, ev?.id ?? null, draft),
    onSuccess: () => { toast('success', 'Draft saved.'); void qc.invalidateQueries({ queryKey: K.evaluations(interview) }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const submit = useMutation({
    mutationFn: () => submitScorecard(interview, ev?.id ?? null, draft, criteria),
    onSuccess: () => { toast('success', 'Scorecard submitted.'); void qc.invalidateQueries({ queryKey: ['recruitment'] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const rate = (id: Criterion['id'], patch: Partial<{ rating: number; comment: string }>) =>
    setDraft((d) => ({ ...d, ratings: d.ratings.map((r) => (String(r.criterion_id) === String(id) ? { ...r, ...patch } : r)) }));

  return (
    <form
      aria-label={`Scorecard · ${kit.candidate.name}`}
      className="flex flex-col gap-4 p-4 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (scorecardOk(errors)) submit.mutate();
      }}
    >
      <div>
        <b className="text-[15px] text-ink">Scorecard · {kit.candidate.name}</b>
        <div className="text-[12px] text-ink-3">{[kit.interview?.round ?? kit.interview?.title, kit.mode ? `${kit.mode} mode` : null].filter(Boolean).join(' · ')}</div>
        {solo ? <div className="mt-1 text-[12px] text-ink-3">Keep this window beside the call.</div> : null}
      </div>
      {submitted ? <p className="rounded-[8px] bg-subtle px-3 py-2 text-ink-2">Submitted — it can no longer be changed.</p> : null}
      <fieldset disabled={submitted} className="flex flex-col gap-3">
        {criteria.map((c) => {
          const r = draft.ratings.find((x) => String(x.criterion_id) === String(c.id))!;
          const err = tried ? errors.criteria[String(c.id)] : undefined;
          const needsWhy = r.rating === 1 || r.rating === 5;
          return (
            <div key={c.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 font-semibold text-ink" title={c.description ?? undefined}>{c.name}</span>
                <span role="radiogroup" aria-label={c.name} className="inline-flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={r.rating === n}
                      aria-label={`${c.name}: ${n}`}
                      onClick={() => rate(c.id, { rating: n })}
                      className={cx('inline-flex h-7 w-7 items-center justify-center rounded-[7px] border text-[12.5px] font-bold', r.rating === n ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
                    >
                      {n}
                    </button>
                  ))}
                </span>
              </div>
              {needsWhy || r.comment ? (
                <textarea aria-label={`${c.name} comment`} placeholder={needsWhy ? `Why a ${r.rating}? (required)` : 'Comment'} className={cx(input, 'h-14 py-1.5')} value={r.comment} onChange={(e) => rate(c.id, { comment: e.target.value })} />
              ) : null}
              {err ? <span role="alert" className="text-[12px] text-danger">{err}</span> : null}
            </div>
          );
        })}
        <label className="flex flex-col gap-1 font-semibold text-ink-2">
          Notes
          <textarea aria-label="Notes" className={cx(input, 'h-24 py-2 font-normal')} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-ink-2">Recommendation</span>
          <div role="radiogroup" aria-label="Recommendation" className="flex flex-wrap gap-1.5">
            {RECS.map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={draft.recommendation === id} onClick={() => setDraft({ ...draft, recommendation: id })} className={cx('h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold', draft.recommendation === id ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink hover:bg-subtle')}>
                {label}
              </button>
            ))}
          </div>
          {tried && errors.form.length ? <span role="alert" className="text-[12px] text-danger">{errors.form.join(' ')}</span> : null}
        </div>
      </fieldset>
      {!submitted ? (
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} disabled={save.isPending} onClick={() => save.mutate()}>Save draft</button>
          <button type="submit" className={btnPrimary} disabled={submit.isPending}>Submit</button>
        </div>
      ) : null}
    </form>
  );
}
