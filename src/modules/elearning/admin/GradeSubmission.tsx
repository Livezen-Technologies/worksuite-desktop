import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Spinner } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { eGet, ePost, errorText, K, when, type Submission } from '../api';
import { SubmissionView } from '../Assignment';
import { area, Back, Field, input, Refusal, Rich, Section, useEl } from '../parts';

/**
 * Grading a submission (§5.13, WF-12): take it for review, score it (the late
 * penalty is the server's), give feedback, or ask for it again while attempts
 * are left. A grade already given changes only with a reason, audited.
 */
export default function GradeSubmission({ id, onBack }: { id: number; onBack: () => void }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.submission(id), queryFn: ({ signal }) => eGet<Submission>(`/submissions/${id}`, undefined, signal) });
  const [score, setScore] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [decision, setDecision] = useState('grade');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Back onClick={onBack} label="Grading" />
        <ErrorNote error={q.error ?? new Error('This submission could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const s = q.data;
  const a = s.assignment;
  const max = a?.max_score ?? 100;
  const graded = s.graded_at !== null;
  const done = () => {
    void qc.invalidateQueries({ queryKey: K.submission(id) });
    void qc.invalidateQueries({ queryKey: ['elearning', 'grading'] });
    void qc.invalidateQueries({ queryKey: ['elearning', 'submissions'] });
  };
  const review = async () => {
    setBusy(true);
    try {
      const r = await ePost(`/submissions/${id}/review`, {});
      toast('success', r.message);
      done();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const grade = async () => {
    setBusy(true);
    setWhy(null);
    try {
      const r = await ePost(`/submissions/${id}/grade`, {
        score: Number(score ?? s.raw_score ?? s.score ?? 0),
        feedback: feedback ?? s.feedback ?? undefined,
        decision,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast('success', r.message);
      setScore(null);
      setFeedback(null);
      setReason('');
      done();
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Back onClick={onBack} label="Grading" />
      <h1 className="m-0 text-[19px] font-bold text-ink">
        {s.learner?.name ?? 'Learner'} · {a?.title ?? 'Assignment'}
      </h1>
      <div className="grid max-w-[1100px] gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <SubmissionView s={s} max={max} />
          {a?.instructions ? (
            <Section title="The brief">
              <Rich html={a.instructions} />
            </Section>
          ) : null}
          {s.history?.length ? (
            <Section title="History">
              <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                {s.history.map((h) => (
                  <li key={h.id}>
                    <span className="text-ink-3">{when(h.at, true)}</span> <b className="text-ink">{h.action}</b> <span className="text-ink-2">{h.by ?? ''}</span>
                    {h.reason ? <span className="block text-ink-3">{h.reason}</span> : null}
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}
        </div>
        <Section title="Grade">
          <div className="flex flex-col gap-3">
            {s.status === 'SUBMITTED' || s.status === 'LATE' ? (
              <Button icon="eye" loading={busy} disabled={!el.online} className="self-start" onClick={() => void review()}>
                Take it for review
              </Button>
            ) : null}
            <Field label={`Score (out of ${max})`} hint={a?.late_penalty_pct && s.is_late ? `Late: ${a.late_penalty_pct}% is taken off by the server.` : a?.pass_score !== null && a?.pass_score !== undefined ? `Pass at ${a.pass_score}.` : undefined}>
              <input type="number" min={0} max={max} step="any" className={`${input} max-w-[160px]`} disabled={!el.online} value={score ?? String(s.raw_score ?? s.score ?? '')} onChange={(e) => setScore(e.target.value)} />
            </Field>
            <Field label="Feedback">
              <textarea className={`${area} min-h-[120px]`} disabled={!el.online} value={feedback ?? s.feedback ?? ''} onChange={(e) => setFeedback(e.target.value)} />
            </Field>
            <Field label="Then">
              <Select aria-label="Decision" value={decision} onChange={(e) => setDecision(e.target.value)} options={[{ value: 'grade', label: 'Grade it' }, { value: 'resubmit', label: 'Ask for it again (needs an attempt left)' }]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
            </Field>
            {graded ? (
              <Field label="Why the grade changes (required)">
                <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
              </Field>
            ) : null}
            <Button variant="primary" icon="check" loading={busy} disabled={!el.online || (graded && !reason.trim())} onClick={() => void grade()}>
              Save the grade
            </Button>
            {why ? <Refusal text={why} /> : null}
          </div>
        </Section>
      </div>
    </div>
  );
}
