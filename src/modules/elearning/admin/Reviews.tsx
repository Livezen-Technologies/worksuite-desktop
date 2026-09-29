import { useQuery } from '@tanstack/react-query';
import { ErrorNote, Spinner } from '../../../components/ui';
import { PageHead } from '../../hr/parts';
import { eGet, K, when, type CourseCard } from '../api';
import { CourseStatusPill, useEl } from '../parts';

type Waiting = CourseCard & { submitted_at: string | null; submitted_by: { id: number; name: string } | string | null; note: string | null };

/** Courses waiting for the person's review (the approval chain's current step); nobody reviews their own. */
export default function Reviews() {
  const el = useEl();
  const q = useQuery({ queryKey: K.reviews, queryFn: ({ signal }) => eGet<{ items: Waiting[] }>('/reviews', undefined, signal) });
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Reviews" sub="Courses submitted for your review." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data?.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">Nothing is waiting for your review.</p> : null}
      <ul className="m-0 flex max-w-[900px] list-none flex-col gap-1.5 p-0">
        {(q.data?.items ?? []).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => el.open.manage(c.id, 'preview')} className="flex w-full flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-left text-[13px] hover:border-primary/50">
              <span className="min-w-0 flex-1">
                <b className="text-ink">{c.title}</b> <span className="font-mono text-[11px] text-ink-3">{c.code}</span>
                <span className="block text-[12px] text-ink-3">
                  Submitted {when(c.submitted_at, true)}
                  {c.submitted_by ? ` by ${typeof c.submitted_by === 'string' ? c.submitted_by : c.submitted_by.name}` : ''}
                  {c.note ? ` — ${c.note}` : ''}
                </span>
              </span>
              <CourseStatusPill status={c.status} options={el.options} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
