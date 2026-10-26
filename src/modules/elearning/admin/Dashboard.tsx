import { useQuery } from '@tanstack/react-query';
import { ErrorNote, Spinner } from '../../../components/ui';
import { PageHead } from '../../hr/parts';
import { eGet, K, nice, pct, when, type Overview } from '../api';
import { Section, Tile, useEl } from '../parts';
import { StatGrid, type StatTone } from '../../../components/StatCard';

const KPIS: Array<[string, string, (v: number) => string, string, StatTone]> = [
  ['active_courses', 'Active courses', String, 'book-open', 'blue'],
  ['enrolled_learners', 'Enrolled learners', String, 'users', 'violet'],
  ['courses_in_progress', 'Courses in progress', String, 'hourglass', 'cyan'],
  ['completed_this_month', 'Completed this month', String, 'graduation-cap', 'green'],
  ['pending_assignments', 'Pending assignments', String, 'clipboard-list', 'amber'],
  ['compliance_overdue', 'Mandatory overdue', String, 'shield-alert', 'red'],
  ['average_completion', 'Average completion', (v) => pct(v), 'gauge', 'blue'],
  ['training_hours', 'Training hours', (v) => `${Math.round(v * 10) / 10} h`, 'timer', 'violet'],
  ['upcoming_live_classes', 'Upcoming live classes', String, 'video', 'cyan'],
  ['certificates_issued', 'Certificates issued', String, 'award', 'green'],
];

/**
 * The training dashboard (§4.2, FR-DSH-01/02): the server's figures within
 * the viewer's reach, for the company chosen. A figure of a later phase is
 * said to be later, never shown as zero.
 */
export default function Dashboard() {
  const el = useEl();
  const q = useQuery({ queryKey: K.overview(el.org), queryFn: ({ signal }) => eGet<Overview>('/overview', { org: el.org }, signal), refetchInterval: 120_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The dashboard could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const w = d.widgets;
  const trend = w.completion_trend ?? [];
  const top = Math.max(1, ...trend.map((t) => t.completed));
  const activityTop = Math.max(1, ...(w.learner_activity ?? []).map((t) => t.learners));

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Training dashboard" sub="Within your reach, for the company chosen." />
      <StatGrid min={190}>
        {KPIS.map(([k, label, fmt, icon, tone]) => {
          const v = d.kpi[k];
          return <Tile key={k} icon={icon} tone={tone} label={label} value={v === null || v === undefined ? 'Later' : fmt(v)} hint={v === null ? (d.later[k] ?? 'Arrives in a later phase.') : undefined} onClick={k === 'pending_assignments' ? () => el.go('grading') : k === 'compliance_overdue' ? () => el.go('enrollments', { overdue: 1 }) : undefined} />;
        })}
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Completions, last six months">
          {trend.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No completions yet.</p>
          ) : (
            <>
              <div className="flex h-[120px] items-end gap-3" aria-hidden>
                {trend.map((t) => (
                  <div key={t.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${t.month}: ${t.completed} completed`}>
                    <span className="text-[11px] text-ink-2 tabular-nums">{t.completed}</span>
                    <span className="w-full max-w-[28px] rounded-t-[4px] bg-primary" style={{ height: `${Math.max(2, (t.completed / top) * 90)}px` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-3" aria-hidden>
                {trend.map((t) => (
                  <span key={t.month} className="flex-1 text-center text-[11px] text-ink-3">{t.month.slice(5)}/{t.month.slice(2, 4)}</span>
                ))}
              </div>
              <table className="sr-only">
                <caption>Completions by month</caption>
                <tbody>
                  {trend.map((t) => (
                    <tr key={t.month}>
                      <th>{t.month}</th>
                      <td>{t.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
        <Section title="Learning progress">
          <table className="w-full text-[13px]">
            <tbody>
              {Object.entries(w.learning_progress ?? {}).map(([k, v]) => (
                <tr key={k} className="border-t border-line first:border-0">
                  <td className="py-1.5 text-ink-2">{nice(k)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{v}</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="py-1.5 text-ink-2">Quizzes waiting for a grader</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">{w.pending_assessments ?? 0}</td>
              </tr>
            </tbody>
          </table>
          {w.compliance_status ? (
            <p className="mt-2 mb-0 text-[12px] text-ink-3">
              Mandatory learning: {Object.entries(w.compliance_status).map(([k, v]) => `${nice(k).toLowerCase()} ${v}`).join(' · ')}
            </p>
          ) : null}
        </Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Popular courses">
          {(w.popular_courses ?? []).length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No enrolments yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {w.popular_courses.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-primary" onClick={() => el.open.manage(c.id)}>
                    {c.title} <span className="font-mono text-[11px] font-normal text-ink-3">{c.code}</span>
                  </button>
                  <span className="text-ink-3 tabular-nums">{c.enrolled} enrolled</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recently completed">
          {(w.recently_completed ?? []).length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">Nothing completed yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {w.recently_completed.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    <b className="text-ink">{typeof r.learner === 'string' ? r.learner : r.learner?.name}</b> <span className="text-ink-2">— {r.course.title}</span>
                  </span>
                  {r.final_score !== null ? <span className="text-ink-3 tabular-nums">{pct(r.final_score)}</span> : null}
                  <span className="text-ink-3">{when(r.completed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Learners active each day">
          {(w.learner_activity ?? []).length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No activity yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
              {w.learner_activity.slice(-14).map((a) => (
                <li key={a.day} className="flex items-center gap-2" title={`${a.day}: ${a.learners} learners`}>
                  <span className="w-[84px] shrink-0 text-ink-3">{when(a.day)}</span>
                  <span className="h-2 rounded-r-[4px] bg-primary" style={{ width: `${Math.max(2, (a.learners / activityTop) * 70)}%` }} />
                  <span className="text-ink-2 tabular-nums">{a.learners}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Grading by instructors">
          {(w.instructor_activity ?? []).length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">Nothing graded yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {w.instructor_activity.map((a) => (
                <li key={a.user_id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ink">{a.name}</span>
                  <span className="text-ink-3 tabular-nums">{a.graded} graded</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <p className="m-0 text-[12px] text-ink-3">{Object.values(d.later).filter((v, i, all) => all.indexOf(v) === i).join(' ')}</p>
    </div>
  );
}
