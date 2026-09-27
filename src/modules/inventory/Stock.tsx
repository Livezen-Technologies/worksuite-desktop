import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Empty, input, PageHead } from '../hr/parts';
import { fetchStock, K, num, PER_PAGE, qty, stampWords, whole, type StockFilters, type StockRow, type Warehouse } from './api';
import { minWidth } from './parts';

/**
 * The stock overview (InvStock): a line per product — per product and
 * warehouse when one is chosen — with what is available against what is on
 * hand and reserved, what is coming, the minimum, and (for those who may
 * see costs) the average cost and value. The head states how many lines
 * match and what they are worth, across every page.
 */
type Filters = Omit<StockFilters, 'page'>;
const FILTERS: Array<{ value: Filters['filter']; label: string }> = [
  { value: '', label: 'Everything' },
  { value: 'low', label: 'At or below minimum' },
  { value: 'out', label: 'Out of stock' },
  { value: 'reserved', label: 'Has reservations' },
];

export default function Stock({
  org,
  warehouse,
  warehouses,
  onWarehouse,
  currency,
  initialFilter,
  onOpenProduct,
}: {
  org: string;
  warehouse: number | null;
  warehouses: Warehouse[];
  onWarehouse: (id: number | null) => void;
  currency: string | null;
  initialFilter: string | null;
  onOpenProduct: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filters['filter']>(FILTERS.some((x) => x.value === initialFilter) ? (initialFilter as Filters['filter']) : '');
  const [zero, setZero] = useState(false);
  const f: Filters = { q, filter, zero };
  const list = useInfiniteQuery({
    queryKey: K.stock(org, { ...f, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchStock(org, warehouse, { ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (last.total !== null ? (pages.length * PER_PAGE < last.total ? pages.length + 1 : undefined) : last.stock.length === PER_PAGE ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.stock), [list.data]);
  const first = list.data?.pages[0];
  const total = first?.total ?? rows.length;
  const value = first?.value ?? null;
  const seesCost = value !== null || rows.some((r) => r.average_cost !== null);
  const W = { wh: 140, avail: 112, inc: 66, min: 66, avg: 84, val: 92, moved: 80 };
  const min = minWidth(200, [W.wh, W.avail, W.inc, W.min, ...(seesCost ? [W.avg, W.val] : []), W.moved]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Stock" sub={warehouse ? 'One warehouse' : 'Across every warehouse; a line per product'} />
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search stock" className={input + ' !w-[240px]'} />
        <Select
          aria-label="Warehouse"
          value={warehouse ? String(warehouse) : ''}
          onValueChange={(v) => onWarehouse(v ? Number(v) : null)}
          options={[{ value: '', label: 'All warehouses' }, ...warehouses.map((w) => ({ value: String(w.id), label: w.name }))]}
          className="h-[34px] w-[200px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink"
        />
        <Select aria-label="Which stock" value={filter} onValueChange={setFilter} options={FILTERS} className="h-[34px] w-[200px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink" />
        <label className="flex items-center gap-1.5 font-semibold text-ink">
          <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} className="accent-primary" />
          Show zero
        </label>
        <span className="ml-auto text-[12.5px] text-ink-3" data-stock-summary>
          {list.isLoading ? '' : `${total.toLocaleString()} ${total === 1 ? 'line' : 'lines'}`}
          {value !== null ? (
            <>
              {' · '}
              <b className="text-ink">{whole(value, currency)}</b>
            </>
          ) : null}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto scroll-thin">
          <div style={{ minWidth: min }}>
            <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Product</span>
              <span className="shrink-0" style={{ width: W.wh }}>
                Warehouse
              </span>
              <span className="shrink-0" style={{ width: W.avail }}>
                Available
              </span>
              <span className="shrink-0 text-right" style={{ width: W.inc }}>
                Incoming
              </span>
              <span className="shrink-0 text-right" style={{ width: W.min }}>
                Minimum
              </span>
              {seesCost ? (
                <>
                  <span className="shrink-0 text-right" style={{ width: W.avg }}>
                    Avg cost
                  </span>
                  <span className="shrink-0 text-right" style={{ width: W.val }}>
                    Value
                  </span>
                </>
              ) : null}
              <span className="shrink-0 text-right" style={{ width: W.moved }}>
                Last moved
              </span>
            </div>
            <div>
              {list.isLoading ? (
                <Spinner />
              ) : list.error ? (
                <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
              ) : rows.length ? (
                rows.map((r) => <Line key={`${r.product_id}-${r.warehouse_id ?? 'all'}`} r={r} w={W} seesCost={seesCost} onOpen={() => onOpenProduct(r.product_id)} />)
              ) : (
                <Empty text={q || filter ? 'Nothing matches.' : zero ? 'No stock has been recorded yet.' : 'Nothing is on hand. Tick Show zero to see products that have run out.'} />
              )}
            </div>
          </div>
        </div>
        {list.hasNextPage ? (
          <div className="flex shrink-0 justify-center border-t border-line px-3.5 py-2 text-[12px]">
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Line({ r, w, seesCost, onOpen }: { r: StockRow; w: Record<'wh' | 'avail' | 'inc' | 'min' | 'avg' | 'val' | 'moved', number>; seesCost: boolean; onOpen: () => void }) {
  const avail = num(r.available) ?? 0;
  const reserved = num(r.reserved) ?? 0;
  const inc = num(r.incoming) ?? 0;
  const where = r.warehouse ?? (r.warehouse_count && r.warehouse_count > 1 ? `${r.warehouse_count} warehouses` : '—');
  return (
    <button type="button" data-stock={r.product_id} onClick={onOpen} className="flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60">
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-ink">{r.name}</b>
        <span className="truncate text-[11px] text-ink-3">
          <span className="font-mono">{r.code ?? '—'}</span>
          {r.category ? ` · ${r.category}` : ''}
        </span>
      </span>
      <span className="shrink-0 truncate text-ink-2" style={{ width: w.wh }}>
        {where}
      </span>
      <span className="flex shrink-0 flex-col" style={{ width: w.avail }}>
        <b className={cx('truncate tabular-nums', avail <= 0 ? 'text-danger' : r.low ? 'text-[#9A4A06] dark:text-warning' : 'text-ink')}>{qty(avail, r.unit)}</b>
        <span className="truncate text-[11px] text-ink-3">
          {qty(r.on_hand)} on hand
          {reserved ? ` · ${qty(reserved)} held` : ''}
        </span>
      </span>
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: w.inc }}>
        {inc ? qty(inc) : '—'}
      </span>
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: w.min }}>
        {num(r.reorder_point) !== null ? qty(r.reorder_point) : '—'}
      </span>
      {seesCost ? (
        <>
          <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: w.avg }}>
            {whole(r.average_cost)}
          </span>
          <span className="shrink-0 text-right font-semibold text-ink tabular-nums" style={{ width: w.val }}>
            {whole(r.value)}
          </span>
        </>
      ) : null}
      <span className="shrink-0 text-right text-ink-3" style={{ width: w.moved }}>
        {r.last_movement_at ? stampWords(r.last_movement_at) : '—'}
      </span>
    </button>
  );
}
