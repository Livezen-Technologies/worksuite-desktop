import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { PageHead } from '../../components/PageKit';
import { eGet, eGetMeta, K, type CatalogCard, type Category, type Paged } from './api';
import { CourseTile, input, useEl } from './parts';

const PER = 24;

/**
 * The course catalogue (WF-02, FR-SRC-01): published courses of the
 * learner's companies they could join — never one they cannot — searched by
 * title, code, summary and category, and filtered like the web's.
 */
export default function Catalogue() {
  const el = useEl();
  const o = el.options;
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [type, setType] = useState('');
  const [max, setMax] = useState('');
  const [page, setPage] = useState(1);
  const f = { q, category_id: category, level, course_type: type, max_minutes: max, page, per_page: PER };
  const cats = useQuery({ queryKey: K.categories('all', false), queryFn: ({ signal }) => eGet<{ items: Category[] }>('/categories', undefined, signal), staleTime: 300_000 });
  const list = useQuery({ queryKey: K.catalog(f), queryFn: ({ signal }) => eGetMeta<Paged<CatalogCard>>('/catalog', f, signal), placeholderData: keepPreviousData });
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const data = list.data?.data;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Course catalogue" sub="Courses you can join in your companies.">
        {list.data?.offline ? <OfflineNote cachedAt={list.data.cachedAt} /> : null}
      </PageHead>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          reset(() => setQ(typed.trim()));
        }}
      >
        <input aria-label="Search courses" placeholder="Search by title, code, summary or category" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${input} max-w-[320px]`} />
        <Select aria-label="Category" value={category} onChange={(e) => reset(() => setCategory(e.target.value))} options={[{ value: '', label: 'Every category' }, ...(cats.data?.items ?? []).filter((c) => !c.archived).map((c) => ({ value: String(c.id), label: c.path || c.label }))]} className="h-9 min-w-[170px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        <Select aria-label="Level" value={level} onChange={(e) => reset(() => setLevel(e.target.value))} options={[{ value: '', label: 'Any level' }, ...o.levels.map((l) => ({ value: l, label: l }))]} className="h-9 min-w-[130px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        <Select aria-label="Type" value={type} onChange={(e) => reset(() => setType(e.target.value))} options={[{ value: '', label: 'Any type' }, ...o.course_types.map((t) => ({ value: t.value, label: t.label }))]} className="h-9 min-w-[150px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        <Select aria-label="Length" value={max} onChange={(e) => reset(() => setMax(e.target.value))} options={[{ value: '', label: 'Any length' }, { value: '15', label: 'Up to 15 min' }, { value: '30', label: 'Up to 30 min' }, { value: '60', label: 'Up to 1 hour' }, { value: '180', label: 'Up to 3 hours' }]} className="h-9 min-w-[130px] rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
        <Button type="submit" icon="search">
          Search
        </Button>
      </form>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {data ? (
        data.items.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">{q || category || level || type || max ? 'No course matches.' : 'There is nothing in the catalogue for you yet.'}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {data.items.map((c) => (
                <CourseTile key={c.id} course={c} onOpen={() => (c.enrollment && c.enrollment.status !== 'PENDING_APPROVAL' ? el.open.course(c.id) : el.open.about(c.id))} />
              ))}
            </div>
            {data.meta.pages > 1 ? (
              <div className="flex items-center justify-center gap-2 text-[12.5px] text-ink-3">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="tabular-nums">
                  Page {data.meta.page} of {data.meta.pages} · {data.meta.total} courses
                </span>
                <Button size="sm" disabled={page >= data.meta.pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}
