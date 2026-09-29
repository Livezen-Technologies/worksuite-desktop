import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Spinner } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { eGet, ePost, errorText, K, pct, when, type StaffAssessment, type StaffAttempt } from '../api';
import { area, Back, Field, FileLink, input, Pill, Refusal, Rich, useEl } from '../parts';

/** A response as words: option ids read back as their labels where the assessment is at hand. */
export function responseText(r: unknown, labels: Map<number, string>): string {
  if (r === null || r === undefined || r === '') return '—';
  const l = (v: unknown) => labels.get(Number(v)) ?? String(v);
  if (Array.isArray(r)) return r.map((x) => (Array.isArray(x) ? x.join(' / ') : typeof x === 'number' ? l(x) : String(x))).join(', ');
  if (typeof r === 'object') return Object.entries(r as Record<string, unknown>).map(([k, v]) => `${l(k)} — ${l(v)}`).join('; ');
  if (typeof r === 'number' && labels.has(r)) return l(r);
  return String(r);
}

/**
 * Grading an attempt's answers that need a person (long answers, uploads, a
 * short answer set to be graded by hand), and changing a score already given
 * — with a reason, audited. The server works out the total and the pass.
 */
export default function GradeAttempt({ id, onBack }: { id: number; onBack: () => void }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.staffAttempt(id), queryFn: ({ signal }) => eGet<StaffAttempt>(`/attempts/${id}`, undefined, signal) });
  const a = q.data;
  const assessment = useQuery({ queryKey: K.assessment(a?.assessment_id ?? 0), queryFn: ({ signal }) => eGet<StaffAssessment>(`/assessments/${a!.assessment_id}`, undefined, signal), enabled: !!a, retry: false });
  const [scores, setScores] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !a) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Back onClick={onBack} label="Grading" />
        <ErrorNote error={q.error ?? new Error('This attempt could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const labels = new Map<number, string>();
  for (const x of assessment.data?.question_list ?? []) for (const o of x.options) labels.set(o.id, o.match_label && x.qtype === 'MATCHING' ? o.match_label : o.label);
  const changed = a.answers.filter((x) => scores[x.question_id] !== undefined || notes[x.question_id] !== undefined);
  const regrade = changed.some((x) => x.manual_score !== null && scores[x.question_id] !== undefined && Number(scores[x.question_id]) !== x.manual_score);
  const save = async () => {
    setBusy(true);
    setWhy(null);
    try {
      const answers = changed.map((x) => ({ question_id: x.question_id, score: Number(scores[x.question_id] ?? x.manual_score ?? x.auto_score ?? 0), ...(notes[x.question_id] !== undefined ? { feedback: notes[x.question_id] } : {}) }));
      const r = await ePost<StaffAttempt>(`/attempts/${id}/grade`, { answers, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      qc.setQueryData(K.staffAttempt(id), r.data);
      void qc.invalidateQueries({ queryKey: ['elearning', 'grading'] });
      toast('success', r.message);
      setScores({});
      setNotes({});
      setReason('');
    } catch (e) {
      setWhy(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Back onClick={onBack} label="Grading" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 min-w-0 flex-1 text-[19px] font-bold text-ink">
          {a.learner.name} · {assessment.data?.title ?? 'Quiz'} · attempt {a.attempt_no}
        </h1>
        {a.status === 'NEEDS_GRADING' ? <Pill tone="amber">Needs grading</Pill> : a.passed ? <Pill tone="green">Passed</Pill> : a.passed === false ? <Pill tone="red">Not passed</Pill> : null}
        <span className="text-[13px] text-ink-2 tabular-nums">
          {a.score ?? '—'} / {a.max_score} ({pct(a.percent)})
        </span>
      </div>
      <p className="m-0 text-[12.5px] text-ink-3">
        Handed in {when(a.submitted_at, true)}
        {a.auto_submitted ? ' when time ran out' : ''}
        {a.graded_at ? ` · graded ${when(a.graded_at, true)}` : ''}
      </p>
      <ol className="m-0 flex max-w-[960px] list-none flex-col gap-2 p-0">
        {a.answers.map((x, i) => {
          const person = x.needs_grading || x.qtype === 'LONG_ANSWER' || x.qtype === 'FILE_UPLOAD' || x.manual_score !== null;
          return (
            <li key={x.question_id} className="rounded-[12px] border border-line bg-surface p-3">
              <div className="flex items-start gap-2">
                <span className="w-6 text-[12px] text-ink-3 tabular-nums">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <Rich html={x.prompt} />
                  <div className="mt-1 text-[13px] text-ink">
                    <span className="text-ink-3">Answer: </span>
                    {x.qtype === 'LONG_ANSWER' ? <span className="whitespace-pre-wrap selectable">{String(x.response ?? '—')}</span> : responseText(x.response, labels)}
                  </div>
                  {x.files?.length ? (
                    <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-[12.5px]">
                      {x.files.map((f) => (
                        <li key={f.id}>
                          <FileLink name={f.name} url={f.url} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {x.answer !== null && x.answer !== undefined && !person ? <div className="mt-0.5 text-[12px] text-ink-3">Key: {responseText(x.answer, labels)}</div> : null}
                </div>
                <div className="flex w-[240px] shrink-0 flex-col gap-1.5">
                  {x.needs_grading ? <Pill tone="amber">Needs a person</Pill> : null}
                  <div className="flex items-center gap-1.5 text-[12.5px]">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      max={x.points}
                      aria-label={`Score for question ${i + 1}`}
                      disabled={!el.online}
                      className={`${input} w-24`}
                      value={scores[x.question_id] ?? String(x.manual_score ?? x.auto_score ?? '')}
                      onChange={(e) => setScores((s) => ({ ...s, [x.question_id]: e.target.value }))}
                    />
                    <span className="text-ink-3">of {x.points}</span>
                  </div>
                  <textarea aria-label={`Feedback on question ${i + 1}`} placeholder="Feedback (optional)" disabled={!el.online} className={`${area} min-h-[60px]`} value={notes[x.question_id] ?? x.feedback ?? ''} onChange={(e) => setNotes((s) => ({ ...s, [x.question_id]: e.target.value }))} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex max-w-[960px] flex-wrap items-end gap-2">
        <Field label={regrade ? 'Why the score changes (required)' : 'Why (needed when changing a score already given)'} className="min-w-[280px] flex-1">
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </Field>
        <Button variant="primary" icon="check" loading={busy} disabled={!changed.length || !el.online || (regrade && !reason.trim())} onClick={() => void save()}>
          Save the grades
        </Button>
      </div>
      {why ? <Refusal text={why} /> : null}
    </div>
  );
}
