import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Spinner } from '../../../components/ui';
import { PageHead } from '../../hr/parts';
import { eGet, K, when, type GradingItem } from '../api';
import { Pill, WorkPill, useEl } from '../parts';

/**
 * The grading queue (§5.12, §5.13, WF-12): submissions and answers waiting for
 * a person among the learners the grader reaches, oldest first — never their
 * own. Each opens here, or in a window of its own beside the course.
 */
export default function Grading() {
  const el = useEl();
  const [kind, setKind] = useState('');
  const f = { kind };
  const q = useQuery({ queryKey: K.grading(f), queryFn: ({ signal }) => eGet<{ items: GradingItem[]; count: number }>('/grading', kind ? { kind } : undefined, signal), refetchInterval: 60_000 });
  const open = (g: GradingItem) => (g.kind === 'assessment' ? el.open.attempt(g.id) : el.open.submission(g.id));
  const route = (g: GradingItem) => el.route(g.kind === 'assessment' ? { gattempt: g.id } : { submission: g.id });
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Grading" sub={q.data ? `${q.data.count} waiting, oldest first.` : 'Work waiting for a person.'}>
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: 'Everything' }, { value: 'assignment', label: 'Assignments' }, { value: 'assessment', label: 'Quiz answers' }]} className="h-9 min-w-[150px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
      </PageHead>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data?.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">Nothing is waiting to be graded.</p> : null}
      <ul className="m-0 flex max-w-[980px] list-none flex-col gap-1.5 p-0">
        {(q.data?.items ?? []).map((g) => (
          <li key={`${g.kind}${g.id}`} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px]">
            <Pill tone={g.kind === 'assessment' ? 'blue' : 'grey'}>{g.kind === 'assessment' ? 'Quiz' : 'Assignment'}</Pill>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(g)}>
              <b className="text-ink hover:text-primary">{typeof g.learner === 'string' ? g.learner : g.learner.name}</b> <span className="text-ink-2">— {g.title}</span>
              <span className="block text-[12px] text-ink-3">
                Attempt {g.attempt_no} · handed in {when(g.submitted_at, true)}
              </span>
            </button>
            {g.is_late ? <span className="text-[12px] font-semibold text-warning">Late</span> : null}
            <WorkPill status={g.status} />
            <Button size="sm" variant="ghost" icon="app-window" title="Grade in a window of its own" onClick={() => el.openWindow(route(g), `Grading · ${g.title}`)}>
              Window
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
