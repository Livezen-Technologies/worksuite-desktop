import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Spinner, Switch, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { eGet, ePost, K, LESSON_ICON, pct, toLocalInput, toUtc, when, type AssessmentCard, type AssignmentCard, type EnrollmentDetail as Data } from '../api';
import { Ask, Back, Bar, EnrolPill, Field, input, Pill, Refusal, Section, useEl } from '../parts';

/**
 * One enrolment for the people who follow it (§5.7, FR-PRG-05): where the
 * learner stands lesson by lesson and against the completion rule, its
 * history, and — for whoever manages it — the due date, mandatory or not,
 * withdraw, mark complete, reset (each with its reason, audited), extensions
 * and extra attempts, or the decision on a request to join.
 */
export default function EnrollmentDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.enrollment(id), queryFn: ({ signal }) => eGet<Data>(`/enrollments/${id}`, undefined, signal) });
  const [asking, setAsking] = useState<null | 'withdraw' | 'complete' | 'reset' | 'approve' | 'reject' | 'due' | 'extend'>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Back onClick={onBack} />
        <ErrorNote error={q.error ?? new Error('This enrolment could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const e = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.enrollment(id) });
    void qc.invalidateQueries({ queryKey: ['elearning', 'enrollments'] });
    void qc.invalidateQueries({ queryKey: K.approvals });
    void qc.invalidateQueries({ queryKey: ['elearning', 'learners'] });
  };
  const post = async (path: string, body: object) => {
    const r = await ePost(path ? `/enrollments/${id}/${path}` : `/enrollments/${id}`, body);
    toast('success', r.message);
    refresh();
    setAsking(null);
  };
  const open = !['WITHDRAWN'].includes(e.status);
  const may = e.can.manage && el.online;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Back onClick={onBack} />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[20px] font-bold text-ink">{e.learner.name}</h1>
          <button type="button" className="text-left text-[13px] text-primary hover:underline" onClick={() => el.open.manage(e.course.id, 'enrollments')}>
            {e.course.title} <span className="font-mono text-[11px] text-ink-3">{e.course.code} · v{e.course_version}</span>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
            <EnrolPill status={e.status} overdue={e.overdue} />
            {e.is_mandatory ? <Pill tone="amber">Mandatory</Pill> : null}
            <span>{e.enrollment_type.charAt(0) + e.enrollment_type.slice(1).toLowerCase()}{e.assigned_by ? ` by ${e.assigned_by.name}` : ''}</span>
            <span>· enrolled {when(e.enrolled_at)}</span>
            {e.due_at ? <span>· due {when(e.due_at)}</span> : null}
            {e.completed_at ? <span>· completed {when(e.completed_at)}{e.completion_source === 'MANUAL' ? ' (marked by staff)' : ''}</span> : null}
            {e.final_score !== null ? <span>· final score {pct(e.final_score)}</span> : null}
          </div>
          {e.withdraw_reason ? <p className="m-0 mt-1 text-[12.5px] text-ink-3">Withdrawn: {e.withdraw_reason}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {e.can.decide && e.status === 'PENDING_APPROVAL' && el.online ? (
            <>
              <Button variant="success" icon="check" onClick={() => setAsking('approve')}>
                Approve
              </Button>
              <Button onClick={() => setAsking('reject')}>Decline</Button>
            </>
          ) : null}
          {may && open ? (
            <>
              <Button onClick={() => setAsking('due')}>Due date</Button>
              {e.status !== 'PENDING_APPROVAL' ? <Button onClick={() => setAsking('extend')}>Extension</Button> : null}
              {e.status !== 'COMPLETED' && e.status !== 'PENDING_APPROVAL' ? <Button onClick={() => setAsking('complete')}>Mark complete</Button> : null}
              {e.status !== 'PENDING_APPROVAL' ? <Button onClick={() => setAsking('reset')}>Reset</Button> : null}
              {e.status !== 'COMPLETED' ? (
                <Button variant="ghost" onClick={() => setAsking('withdraw')}>
                  Withdraw
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Bar value={e.progress_percent} label="Course progress" className="max-w-[360px] flex-1" />
        <span className="text-[12.5px] text-ink-3 tabular-nums">{pct(e.progress_percent)}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {e.lessons ? (
          <Section title="Lessons">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {e.lessons.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <Icon name={l.progress.status === 'COMPLETED' ? 'check-circle' : (LESSON_ICON[l.lesson_type] ?? 'file')} size={15} className={cx('shrink-0', l.progress.status === 'COMPLETED' ? 'text-success' : 'text-ink-3')} />
                  <span className="min-w-0 flex-1 truncate text-ink">{l.title}</span>
                  {!l.is_mandatory ? <span className="text-[11.5px] text-ink-3">optional</span> : null}
                  <span className="w-12 text-right text-[12px] text-ink-3 tabular-nums">{Math.round(l.progress.percent)}%</span>
                  <span className="w-[110px] text-right text-[12px] text-ink-3">{l.progress.completed_at ? when(l.progress.completed_at) : l.progress.started_at ? 'started' : ''}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : (
          <Section title="Lessons">
            <p className="m-0 text-[13px] text-ink-3">Following lesson progress needs learner_progress.view, or to teach or evaluate the course.</p>
          </Section>
        )}
        <div className="flex flex-col gap-4">
          {e.completion ? (
            <Section title="Completion rule">
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                {e.completion.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Icon name={c.met ? 'check-circle' : 'minus'} size={15} className={cx('mt-0.5 shrink-0', c.met ? 'text-success' : 'text-ink-3')} />
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {e.history?.length ? (
            <Section title="History">
              <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                {e.history.map((h) => (
                  <li key={h.id}>
                    <span className="text-ink-3">{when(h.at, true)}</span> <b className="text-ink">{h.action}</b> <span className="text-ink-2">{h.by ?? ''}</span>
                    {h.reason ? <span className="block text-ink-3">{h.reason}</span> : null}
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}
        </div>
      </div>
      {asking === 'withdraw' ? <Ask title={`Withdraw ${e.learner.name}`} text="The history is kept and reminders stop." label="Why" required danger confirm="Withdraw" onClose={() => setAsking(null)} onConfirm={(w) => post('withdraw', { reason: w })} /> : null}
      {asking === 'complete' ? <Ask title="Mark the course complete" text="Recorded as completed by staff, with your reason." label="Why" required confirm="Mark complete" onClose={() => setAsking(null)} onConfirm={(w) => post('complete', { reason: w })} /> : null}
      {asking === 'reset' ? <Ask title="Reset the enrolment" text="Back to not started: lesson progress is cleared, attempts and submissions are set aside (kept, not counted)." label="Why" required danger confirm="Reset" onClose={() => setAsking(null)} onConfirm={(w) => post('reset', { reason: w })} /> : null}
      {asking === 'approve' ? <Ask title="Approve the request" label="Comment" confirm="Approve" onClose={() => setAsking(null)} onConfirm={(w) => post('decide', { decision: 'approve', comment: w })} /> : null}
      {asking === 'reject' ? <Ask title="Decline the request" label="Why" required danger confirm="Decline" onClose={() => setAsking(null)} onConfirm={(w) => post('decide', { decision: 'reject', comment: w })} /> : null}
      {asking === 'due' ? <DueDialog e={e} onClose={() => setAsking(null)} onSave={(body) => post('', body)} /> : null}
      {asking === 'extend' ? <Extension e={e} onClose={() => setAsking(null)} onSave={(body) => post('extensions', body)} /> : null}
    </div>
  );
}

function DueDialog({ e, onClose, onSave }: { e: Data; onClose: () => void; onSave: (body: object) => Promise<void> }) {
  const [due, setDue] = useState(toLocalInput(e.due_at));
  const [mandatory, setMandatory] = useState(e.is_mandatory);
  return (
    <Ask title="Due date and mandatory" label="Why" confirm="Save" onClose={onClose} onConfirm={(w) => onSave({ due_at: due ? toUtc(due) : null, is_mandatory: mandatory, ...(w ? { reason: w } : {}) })}>
      <Field label="Due">
        <input type="datetime-local" className={input} value={due} onChange={(x) => setDue(x.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <Switch checked={mandatory} onChange={setMandatory} label="Mandatory" /> Mandatory
      </label>
    </Ask>
  );
}

/** A later due date or extra attempts for one assessment or assignment; re-judges the enrolment (a failed one reopens). */
function Extension({ e, onClose, onSave }: { e: Data; onClose: () => void; onSave: (body: object) => Promise<void> }) {
  const assessments = useQuery({ queryKey: K.assessments(e.course_id), queryFn: ({ signal }) => eGet<{ items: AssessmentCard[] }>(`/courses/${e.course_id}/assessments`, undefined, signal), retry: false });
  const assignments = useQuery({ queryKey: K.assignments(e.course_id), queryFn: ({ signal }) => eGet<{ items: AssignmentCard[] }>(`/courses/${e.course_id}/assignments`, undefined, signal), retry: false });
  const [subject, setSubject] = useState('');
  const [due, setDue] = useState('');
  const [extra, setExtra] = useState('');
  const options = [
    ...(assessments.data?.items ?? []).map((a) => ({ value: `assessment:${a.id}`, label: `Quiz · ${a.title}` })),
    ...(assignments.data?.items ?? []).map((a) => ({ value: `assignment:${a.id}`, label: `Assignment · ${a.title}` })),
  ];
  const [kind, sid] = subject.split(':');
  return (
    <Ask
        title="Extension"
        label="Why"
        required
        confirm="Give the extension"
        onClose={onClose}
        onConfirm={(w) => {
          if (!kind || !sid) return Promise.reject(new Error('Choose the quiz or assignment.'));
          return onSave({ subject: kind, subject_id: Number(sid), ...(due ? { due_at: toUtc(due) } : {}), ...(extra ? { extra_attempts: Number(extra) } : {}), reason: w });
        }}
      >
        <Field label="For">
          <Select aria-label="Quiz or assignment" value={subject} onChange={(x) => setSubject(x.target.value)} options={[{ value: '', label: options.length ? 'Choose…' : 'Nothing you may extend' }, ...options]} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New due date">
            <input type="datetime-local" className={input} value={due} onChange={(x) => setDue(x.target.value)} />
          </Field>
          <Field label="Extra attempts (1–20)">
            <input type="number" min={1} max={20} className={input} value={extra} onChange={(x) => setExtra(x.target.value)} />
          </Field>
        </div>
        {!due && !extra ? <Refusal text="Give a new due date, extra attempts, or both." /> : null}
    </Ask>
  );
}
