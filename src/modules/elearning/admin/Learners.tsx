import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Spinner } from '../../../components/ui';
import { PageHead } from '../../../components/PageKit';
import { eGet, K, type LearnerRow, type Paged } from '../api';
import { input, useEl } from '../parts';
import { clickOnKey } from '../../../components/press';

/**
 * Learners the person follows (§5.14): their reports, their courses'
 * learners, or everyone in their data scope — most overdue first.
 */
export default function Learners() {
  const el = useEl();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const f = { q, page };
  const list = useQuery({ queryKey: K.learners(f), queryFn: ({ signal }) => eGet<Paged<LearnerRow>>('/learners', f, signal), placeholderData: keepPreviousData });
  const data = list.data;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Learners" sub="The people whose learning you follow, most overdue first." />
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
          setPage(1);
        }}
      >
        <input aria-label="Search learners" placeholder="Name" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${input} max-w-[260px]`} />
        <Button type="submit" icon="search">
          Search
        </Button>
      </form>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {data && data.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">Nobody to follow here.</p> : null}
      {data && data.items.length ? (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] text-ink-3">
                <th className="px-3 py-2 font-semibold">Learner</th>
                <th className="px-3 py-2 text-right font-semibold">Courses</th>
                <th className="px-3 py-2 text-right font-semibold">Not started</th>
                <th className="px-3 py-2 text-right font-semibold">In progress</th>
                <th className="px-3 py-2 text-right font-semibold">Completed</th>
                <th className="px-3 py-2 text-right font-semibold">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => (
                <tr tabIndex={0} onKeyDown={clickOnKey} key={l.user_id} className="cursor-pointer border-b border-line last:border-0 hover:bg-subtle" onClick={() => el.open.learner(l.user_id)}>
                  <td className="px-3 py-2">
                    <button type="button" className="font-semibold text-ink hover:text-primary" onClick={() => el.open.learner(l.user_id)}>
                      {l.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.assigned}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.in_progress}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.completed}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${l.overdue ? 'font-bold text-danger' : ''}`}>{l.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && data.meta.pages > 1 ? (
        <div className="flex items-center justify-center gap-2 text-[12.5px] text-ink-3">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            Page {data.meta.page} of {data.meta.pages}
          </span>
          <Button size="sm" disabled={page >= data.meta.pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
