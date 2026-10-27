import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, cx, ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { fetchPage, K, label, pages, read, type ListDef, type Row } from './api';
import { clickOnKey } from '../../components/press';

/**
 * Contracts, renewals, estimates, units and warranties (and the requests list): the server's paged lists
 * (docs/amc/API.md §1 — `page`, `per_page`, `sort`, `dir`, a search and the list's status filter) and a record's
 * detail beside them, read-only here. Changing a record (amending a contract, sending an estimate…) opens it on the web.
 */
export default function ListView({ def, selected, onSelect, onWeb }: { def: ListDef; selected: number | null; onSelect: (id: number | null) => void; onWeb: (path: string) => void }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(def.sorts[0]!);
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState(def.filter?.options[0]?.[0] ?? '');
  const params = { page, sort, dir, q: text.trim(), filter };
  const list = useQuery({ queryKey: K.list(def.view, params), queryFn: ({ signal }) => fetchPage(def, params, signal), placeholderData: keepPreviousData });

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[18px] font-bold">{def.title}</h1>
          {list.data?.offline ? <OfflineNote cachedAt={list.data.cachedAt} /> : null}
          <span className="flex-1" />
          <input aria-label="Search" placeholder="Search" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} className="w-[200px] rounded-[7px] border border-line bg-surface px-2 py-1 text-[13px]" />
          {def.filter ? (
            <select aria-label="Filter" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} className="rounded-[7px] border border-line bg-surface px-1.5 py-1 text-[13px]">
              {def.filter.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) : null}
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-[7px] border border-line bg-surface px-1.5 py-1 text-[13px]">
            {def.sorts.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>{dir === 'asc' ? 'Ascending' : 'Descending'}</Button>
        </div>
        {list.isPending ? <Spinner /> : list.isError ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : (
          <>
            <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-line bg-surface scroll-thin">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-surface text-left text-ink-3"><tr>{def.columns.map((c) => <th key={c.key} className="px-2.5 py-1.5 font-semibold">{c.label}</th>)}</tr></thead>
                <tbody>
                  {list.data.data.items.map((r) => (
                    <tr tabIndex={0} onKeyDown={clickOnKey} key={r.id} onClick={() => onSelect(r.id)} aria-selected={selected === r.id} className={cx('cursor-pointer border-t border-line hover:bg-subtle', selected === r.id ? 'bg-yellow-bg dark:bg-selection' : '')}>
                      {def.columns.map((c) => <td key={c.key} className="max-w-[260px] truncate px-2.5 py-1.5">{label(r[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.data.data.items.length ? <p className="p-4 text-[13px] text-ink-3">Nothing matches.</p> : null}
            </div>
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <span>{list.data.data.total} in all · page {list.data.data.page} of {pages(list.data.data)}</span>
              <span className="flex-1" />
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" disabled={page >= pages(list.data.data)} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </>
        )}
      </div>
      {selected ? <Detail def={def} id={selected} onClose={() => onSelect(null)} onWeb={onWeb} /> : null}
    </div>
  );
}

const SKIP = /(^id$|_id$|^org_id$|hash|_ip$|^can$)/;

/** A record's fields as the server sent them: its plain values, then each list it carries as a count. */
export function Detail({ def, id, onClose, onWeb }: { def: ListDef; id: number; onClose: () => void; onWeb: (path: string) => void }) {
  const q = useQuery({ queryKey: K.record(def.view, id), queryFn: ({ signal }) => read<Record<string, unknown>>(def.detail(id), undefined, signal) });
  const body = q.data?.data;
  const rec = ((body && typeof body[def.key] === 'object' ? body[def.key] : body) ?? {}) as Row;
  const plain = Object.entries(rec).filter(([k, v]) => !SKIP.test(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v)));
  const lists = Object.entries(body ?? {}).filter(([, v]) => Array.isArray(v));
  return (
    <aside aria-label="Detail" className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-bold">{label(rec.number ?? rec.name ?? rec.title ?? `#${id}`)}</h2>
        <Button size="sm" variant="ghost" icon="external" onClick={() => onWeb(`/amc?view=${def.view === 'units' ? 'equipment' : def.view === 'renewals' ? 'contracts' : def.view}&${def.key === 'equipment' ? 'equipment' : def.param}=${id}`)}>Web</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin">
        {q.isPending ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : (
          <>
            {q.data.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
            <dl className="grid grid-cols-[130px_1fr] gap-x-2 gap-y-1 text-[12.5px]">
              {plain.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-3">{k.replace(/_/g, ' ')}</dt><dd className="break-words">{label(typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)}</dd></div>)}
            </dl>
            {lists.length ? <ul className="mt-3 text-[12.5px] text-ink-2">{lists.map(([k, v]) => <li key={k}>{k.replace(/_/g, ' ')}: {(v as unknown[]).length}</li>)}</ul> : null}
          </>
        )}
      </div>
    </aside>
  );
}
