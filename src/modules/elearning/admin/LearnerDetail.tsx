import { useQuery } from '@tanstack/react-query';
import { ErrorNote, Spinner } from '../../../components/ui';
import { eGet, K, pct, when, type Enrollment } from '../api';
import { Back, Bar, EnrolPill, Pill, useEl } from '../parts';

/** One learner's enrolments the person may follow (a line manager's report, a course's learner). */
export default function LearnerDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const el = useEl();
  const q = useQuery({ queryKey: K.learner(id), queryFn: ({ signal }) => eGet<{ learner: { id: number; name: string }; enrollments: Enrollment[] }>(`/learners/${id}`, undefined, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Back onClick={onBack} />
        <ErrorNote error={q.error ?? new Error('This learner could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <Back onClick={onBack} />
      <h1 className="m-0 text-[20px] font-bold text-ink">{d.learner.name}</h1>
      <ul className="m-0 flex max-w-[960px] list-none flex-col gap-1.5 p-0">
        {d.enrollments.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => el.open.enrollment(e.id)} className="flex w-full flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-left text-[13px] hover:border-primary/50">
              <b className="min-w-0 flex-1 truncate text-ink">{e.course.title}</b>
              {e.is_mandatory ? <Pill tone="amber">Mandatory</Pill> : null}
              <EnrolPill status={e.status} overdue={e.overdue} />
              <Bar value={e.progress_percent} label={`${e.course.title} progress`} className="w-24" />
              <span className="w-12 text-right text-[12px] text-ink-3 tabular-nums">{pct(e.progress_percent)}</span>
              <span className="w-[120px] text-right text-[12px] text-ink-3">{e.due_at ? `due ${when(e.due_at)}` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
