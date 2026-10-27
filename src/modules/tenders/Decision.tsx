import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { btn, btnPrimary, btnSmall, Empty, Facts, Field, input, Panel, Sheet } from '../../components/PageKit';
import { K, money, refusalOf, wallParts, type Workspace as Data } from './api';
import { addEvaluation, EVALUATION_KINDS, evaluationBody, labelOf, METHODS, recordSubmission, submissionBody } from './work';

/**
 * What went in and what came back: the submissions recorded against the bid
 * (recording one moves the tender to Submitted, through the same checks as
 * any move — outstanding requirements and approvals are named, and going
 * ahead anyway is kept in the history), what the buyer said at evaluation,
 * and, once decided, why it was lost or what was won.
 */
const SUBMITTABLE = ['ready', 'submitted', 'evaluation', 'clarification'];

export default function Decision({ d, canManage }: { d: Data; canManage: boolean }) {
  const r = d.tender;
  const [submitting, setSubmitting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const canSubmit = canManage && r.outcome === 'open' && (SUBMITTABLE.includes(r.stage) || d.next.some((s) => s.key === 'submitted'));
  return (
    <div className="grid grid-cols-2 gap-3.5">
      {r.outcome === 'lost' ? (
        <Panel title="Why it was lost" bodyClassName="px-3.5 py-2.5 text-[12.5px]">
          <Facts
            rows={[
              ['Reason', r.lost_reason],
              ['Won by', r.competitor],
              ['Their price', r.winning_price ? money(r.winning_price, r.currency) : null],
              ['What we learned', r.lessons],
            ]}
          />
        </Panel>
      ) : null}
      {r.outcome === 'won' ? (
        <Panel title="Won" bodyClassName="px-3.5 py-2.5 text-[12.5px]">
          <Facts
            rows={[
              ['Awarded', r.award_value ? money(r.award_value, r.currency) : 'Not recorded yet'],
              ['Decided', r.decided_at ? dateLabel(r.decided_at) : null],
              ['Client', r.client_name],
            ]}
          />
        </Panel>
      ) : null}
      <Panel
        title="Submissions"
        sub="What went to the buyer, and how"
        action={
          canSubmit ? (
            <button type="button" className={btnSmall + ' gap-1'} onClick={() => setSubmitting(true)}>
              <Icon name="send" size={13} /> Record a submission
            </button>
          ) : undefined
        }
        bodyClassName="flex flex-col"
      >
        {d.submissions.length ? (
          d.submissions.map((s) => (
            <div key={s.id} className="flex flex-col border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <b className="text-ink">
                {s.submitted_at ? `${dateLabel(s.submitted_at)}, ${timeLabel(s.submitted_at)}` : 'Not dated'}
                {s.method ? <span className="font-medium text-ink-3"> · {labelOf(METHODS, s.method).toLowerCase()}</span> : null}
              </b>
              <span className="text-[11.5px] text-ink-3">
                {[s.bid_value ? money(s.bid_value, r.currency) : null, s.receipt_no ? `receipt ${s.receipt_no}` : null, s.reference, s.acknowledged_at ? `acknowledged ${dateLabel(s.acknowledged_at)}` : null].filter(Boolean).join(' · ')}
              </span>
              {s.note ? <span className="text-[12px] text-ink-2">{s.note}</span> : null}
            </div>
          ))
        ) : (
          <Empty text="Nothing has been submitted." />
        )}
      </Panel>
      <Panel
        title="Evaluation"
        sub="What the buyer said, and when"
        action={
          canManage ? (
            <button type="button" className={btnSmall + ' gap-1'} onClick={() => setEvaluating(true)}>
              <Icon name="plus" size={13} /> Record
            </button>
          ) : undefined
        }
        bodyClassName="flex flex-col"
      >
        {d.evaluations.length ? (
          d.evaluations.map((e) => (
            <div key={e.id} className="flex flex-col border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <span className="flex items-center gap-1.5">
                <b className="min-w-0 flex-1 truncate text-ink">{e.title ?? labelOf(EVALUATION_KINDS, e.kind)}</b>
                {e.score !== null ? (
                  <b className="shrink-0 text-ink tabular-nums">
                    {Number(e.score)}
                    {e.max_score !== null ? ` / ${Number(e.max_score)}` : ''}
                  </b>
                ) : null}
              </span>
              <span className="text-[11.5px] text-ink-3">{[labelOf(EVALUATION_KINDS, e.kind), e.happened_at ? dateLabel(e.happened_at) : null].filter(Boolean).join(' · ')}</span>
              {e.body ? <span className="text-[12px] whitespace-pre-wrap text-ink-2">{e.body}</span> : null}
            </div>
          ))
        ) : (
          <Empty text="Nothing from the buyer yet." />
        )}
      </Panel>
      {submitting ? <SubmitSheet id={r.id} bid={r.bid_value} currency={r.currency} onClose={() => setSubmitting(false)} /> : null}
      {evaluating ? <EvaluationSheet id={r.id} onClose={() => setEvaluating(false)} /> : null}
    </div>
  );
}

function SubmitSheet({ id, bid, currency, onClose }: { id: number; bid: string | null; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  // Now, on the reader's clock, unless they say otherwise — it is usually recorded as it goes in.
  const [d, setD] = useState(() => ({ method: 'portal', ...wallParts(new Date().toISOString()), receipt_no: '', bid_value: bid ?? '', reference: '', note: '' }));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ message: string; blockers: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    const out = submissionBody(d);
    if (!out.body) return setError(out.error);
    setBusy(true);
    setError(null);
    try {
      await recordSubmission(id, out.body, !!refused);
      toast('success', refused ? 'Submission recorded, with what was outstanding.' : 'Submission recorded.');
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      const { blockers } = refusalOf(e);
      if (blockers.length) setRefused({ message: errorMessage(e), blockers });
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Sheet
      title="Record a submission"
      width={540}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary + (refused ? ' !bg-danger hover:!opacity-90' : '')} disabled={busy} onClick={() => void go()}>
            {busy ? 'Recording…' : refused ? 'Record it anyway' : 'Record'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">This moves the tender to Submitted and keeps the bid value and receipt with it.</p>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="How it went in">
          <Select<string> aria-label="How it went in" value={d.method} onValueChange={(v) => setD({ ...d, method: v })} options={METHODS.map(([value, label]) => ({ value, label }))} className={input} />
        </Field>
        <Field label="When">
          <span className="flex gap-1.5">
            <input type="date" aria-label="Submitted on" value={d.date} onChange={set('date')} className={input} />
            <input type="time" aria-label="Submitted at" value={d.time} onChange={set('time')} className={input + ' !w-[110px]'} />
          </span>
        </Field>
        <Field label={`Bid value (${currency})`}>
          <input aria-label="Bid value" inputMode="decimal" value={d.bid_value} onChange={set('bid_value')} className={input} />
        </Field>
        <Field label="Receipt number">
          <input aria-label="Receipt number" value={d.receipt_no} onChange={set('receipt_no')} maxLength={120} className={input} />
        </Field>
        <Field label="Our reference">
          <input aria-label="Our reference" value={d.reference} onChange={set('reference')} maxLength={200} className={input} />
        </Field>
        <Field label="Note">
          <input aria-label="Note" value={d.note} onChange={set('note')} className={input} />
        </Field>
      </div>
      {refused ? (
        <div className="flex flex-col gap-1 rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-strong dark:bg-warning-bg dark:text-warning" aria-label="Outstanding">
          <b>{refused.message}</b>
          {refused.blockers.map((b, i) => (
            <span key={i}>· {b}</span>
          ))}
          <span>Recording it anyway is allowed; the history will say what was missing.</span>
        </div>
      ) : null}
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function EvaluationSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState({ kind: 'technical', title: '', body: '', score: '', max_score: '', date: todayInZone() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    const out = evaluationBody(d);
    if (!out.body) return setError(out.error);
    setBusy(true);
    try {
      await addEvaluation(id, out.body);
      toast('success', 'Recorded.');
      void qc.invalidateQueries({ queryKey: K.tender(id) });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Sheet
      title="Record what the buyer said"
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !d.title.trim()} onClick={() => void go()}>
            {busy ? 'Recording…' : 'Record'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="What">
          <Select<string> aria-label="What" value={d.kind} onValueChange={(v) => setD({ ...d, kind: v })} options={EVALUATION_KINDS.map(([value, label]) => ({ value, label }))} className={input} />
        </Field>
        <Field label="When">
          <input type="date" aria-label="When" value={d.date} onChange={set('date')} className={input} />
        </Field>
      </div>
      <Field label="Title">
        <input aria-label="Title" autoFocus value={d.title} onChange={set('title')} maxLength={250} placeholder="Technical evaluation results" className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Score">
          <input aria-label="Score" inputMode="decimal" value={d.score} onChange={set('score')} className={input} />
        </Field>
        <Field label="Out of">
          <input aria-label="Out of" inputMode="decimal" value={d.max_score} onChange={set('max_score')} className={input} />
        </Field>
      </div>
      <Field label="What they said">
        <textarea aria-label="What they said" value={d.body} onChange={set('body')} rows={4} className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary" />
      </Field>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
