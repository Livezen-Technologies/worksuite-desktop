import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { Empty, input, PageHead } from '../hr/parts';
import { fetchMovements, K, MOVE_LABEL, moveWhat, num, PER_PAGE, qty, signed, stampFull, whole, type Movement, type MovementFilters, type Warehouse } from './api';
import { minWidth, Signed } from './parts';

/**
 * Movements (InvMovements): every change to stock, newest first — when, what,
 * where, why, how many, at what cost, the balance it left, and who. Narrowed
 * by product or reference, warehouse, reason, direction and dates (days on
 * the server's clock, which is UTC). A row opens its product's history.
 */
type Filters = Omit<MovementFilters, 'page'>;

export default function Movements({ org, warehouse, warehouses, onWarehouse, onOpenProduct }: { org: string; warehouse: number | null; warehouses: Warehouse[]; onWarehouse: (id: number | null) => void; onOpenProduct: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [direction, setDirection] = useState<Filters['direction']>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const f: Filters = { q, type, direction, from, to };
  const list = useInfiniteQuery({
    queryKey: K.movements(org, { ...f, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchMovements(org, warehouse, { ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER_PAGE < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.movements), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const seesCost = rows.some((r) => r.unit_cost !== null);
  const W = { when: 92, wh: 116, why: 170, qty: 60, unit: 76, val: 84, bal: 64, by: 84 };
  const min = minWidth(170, [W.when, W.wh, W.why, W.qty, ...(seesCost ? [W.unit, W.val] : []), W.bal, W.by]);
  const sel = 'h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Movements" sub={<span data-movement-count>{list.isLoading ? '\u00a0' : `${total.toLocaleString()} ${total === 1 ? 'movement' : 'movements'}`}</span>} />
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product or reference…" aria-label="Search movements" className={input + ' !w-[190px]'} />
        <Select
          aria-label="Warehouse"
          value={warehouse ? String(warehouse) : ''}
          onValueChange={(v) => onWarehouse(v ? Number(v) : null)}
          options={[{ value: '', label: 'All warehouses' }, ...warehouses.map((w) => ({ value: String(w.id), label: w.name }))]}
          className={sel + ' w-[160px]'}
        />
        <Select
          aria-label="Reason"
          value={type}
          onValueChange={setType}
          options={[
            { value: '', label: 'Any reason' },
            ...Object.entries(MOVE_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
          className={sel + ' w-[150px]'}
        />
        <Select
          aria-label="Direction"
          value={direction}
          onValueChange={setDirection}
          options={[
            { value: '', label: 'In and out' },
            { value: 'in', label: 'In only' },
            { value: 'out', label: 'Out only' },
          ]}
          className={sel + ' w-[120px]'}
        />
        <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From" className={input + ' !w-[132px]'} />
        <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To" className={input + ' !w-[132px]'} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto scroll-thin">
          <div style={{ minWidth: min }}>
            <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="shrink-0" style={{ width: W.when }}>
                When
              </span>
              <span className="min-w-0 flex-1">Product</span>
              <span className="shrink-0" style={{ width: W.wh }}>
                Warehouse
              </span>
              <span className="shrink-0" style={{ width: W.why }}>
                Reason
              </span>
              <span className="shrink-0 text-right" style={{ width: W.qty }}>
                Qty
              </span>
              {seesCost ? (
                <>
                  <span className="shrink-0 text-right" style={{ width: W.unit }}>
                    Unit cost
                  </span>
                  <span className="shrink-0 text-right" style={{ width: W.val }}>
                    Value
                  </span>
                </>
              ) : null}
              <span className="shrink-0 text-right" style={{ width: W.bal }}>
                Balance
              </span>
              <span className="shrink-0" style={{ width: W.by }}>
                By
              </span>
            </div>
            <div>
              {list.isLoading ? (
                <Spinner />
              ) : list.error ? (
                <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
              ) : rows.length ? (
                rows.map((m) => <Row key={m.id} m={m} w={W} seesCost={seesCost} onOpen={() => onOpenProduct(m.product_id)} />)
              ) : (
                <Empty text={q || type || direction || from || to ? 'No movement matches.' : 'Nothing has moved yet.'} />
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

function Row({ m, w, seesCost, onOpen }: { m: Movement; w: Record<'when' | 'wh' | 'why' | 'qty' | 'unit' | 'val' | 'bal' | 'by', number>; seesCost: boolean; onOpen: () => void }) {
  const n = num(m.quantity) ?? 0;
  const tracked = [m.serial_no ? `SN ${m.serial_no}` : null, m.batch_no ? `B:${m.batch_no}` : null].filter(Boolean).join(' · ');
  return (
    <button type="button" data-movement={m.id} onClick={onOpen} className="flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60">
      <span className="shrink-0 text-ink-2 tabular-nums" style={{ width: w.when }}>
        {stampFull(m.moved_at)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-ink">{m.name}</b>
        <span className="truncate font-mono text-[11px] text-ink-3">{[m.code, tracked].filter(Boolean).join(' · ') || '—'}</span>
      </span>
      <span className="shrink-0 truncate text-ink-2" style={{ width: w.wh }}>
        {[m.warehouse, m.bin].filter(Boolean).join(' · ') || '—'}
      </span>
      <span className="shrink-0 truncate text-ink" style={{ width: w.why }} title={m.note ?? undefined}>
        {moveWhat({ ...m, serial_no: null, batch_no: null })}
      </span>
      <span className="shrink-0 text-right" style={{ width: w.qty }}>
        <Signed value={n} text={signed(n)} />
      </span>
      {seesCost ? (
        <>
          <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: w.unit }}>
            {whole(m.unit_cost)}
          </span>
          <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: w.val }}>
            {m.value === null ? '—' : signed(Math.round(num(m.value) ?? 0)).replace(/^\+/, '')}
          </span>
        </>
      ) : null}
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: w.bal }}>
        {qty(m.balance_after)}
      </span>
      <span className="shrink-0 truncate text-ink-3" style={{ width: w.by }}>
        {m.user ?? 'System'}
      </span>
    </button>
  );
}
