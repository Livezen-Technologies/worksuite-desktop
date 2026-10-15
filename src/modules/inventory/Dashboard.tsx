import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { dateLabel, dayWords } from '../../core/time';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Kpi, PageHead, Panel } from '../hr/parts';
import { attention, fetchDetail, K, moveLabel, num, qty, short, signed, WEB_VIEW, type Dashboard as Data, stampWords } from './api';
import { HeadLink, Line, ListPanel } from './parts';
import { openWeb, type InvView } from './Rail';
import { ComputerCard } from './ThisComputer';

/**
 * The Inventory dashboard (InvDashboard; on the desktop the "Desktop inventory
 * dashboard" design): what the stock is worth and where it is short in five
 * tiles, what came in and went out beside this computer's scanner, printer,
 * offline copy and changes waiting to sync, then the catalogue in tiles, what is waiting on somebody, fourteen days of movement, what
 * is coming in and going out, the health of the stock and each warehouse, the
 * latest movements, what runs out soonest, what to reorder, and how the books
 * compare with the shelves. The warehouse picker narrows it.
 */
/** The "needs attention" lines this app opens itself, and the list each opens on. */
const HERE: Record<string, string> = { adj: '&st=pending', trf: '&st=in_transit', cnt: '&st=counting', trk: '&tt=expiring', pur: '&bt=orders', mfg: '&mt=jobs' };

export default function Dashboard({
  data,
  org,
  warehouse,
  currency,
  onGo,
  onStock,
  onOpenProduct,
  onNewAdjustment,
  onSales,
  onReceive,
  onNewWindow,
  onComputer,
}: {
  data: UseQueryResult<Data>;
  org: string;
  warehouse: number | null;
  currency: string | null;
  onGo: (v: InvView, extra?: string) => void;
  onStock: (filter: 'low' | 'out') => void;
  onOpenProduct: (id: number) => void;
  onNewAdjustment: (() => void) | null;
  /** Sales orders in Sales & Orders, for those who may open it; the browser otherwise. */
  onSales: (() => void) | null;
  /** Receive goods with the scanner, for those who may receive. */
  onReceive?: (() => void) | null;
  /** The dashboard in a window of its own. */
  onNewWindow?: () => void;
  /** This computer's details (the rail's Desktop section). */
  onComputer?: () => void;
}) {
  const detail = useQuery({
    queryKey: K.detail(org, warehouse),
    queryFn: ({ signal }) => fetchDetail(org, warehouse, signal),
    staleTime: 60_000,
  });
  if (data.isLoading) return <Spinner />;
  if (data.error) return <ErrorNote error={data.error} onRetry={() => void data.refetch()} />;
  const d = data.data!;
  const t = d.totals;
  const c = d.counts;
  const x = detail.data;
  const chips = attention(d);
  const days = d.movement ?? [];
  const top = Math.max(1, ...days.flatMap((m) => [num(m.received) ?? 0, num(m.issued) ?? 0]));
  const busiest = [...(d.categories ?? [])].sort((a, b) => b.product_count - a.product_count)[0];

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Inventory dashboard">
        {onNewWindow ? (
          <button type="button" className={btn} onClick={onNewWindow}>
            Open in new window
          </button>
        ) : null}
        {onNewAdjustment ? (
          <button type="button" className={btn} onClick={onNewAdjustment}>
            New adjustment
          </button>
        ) : null}
        <button type="button" className={btn} onClick={() => onGo('rep')}>
          Reports
        </button>
        {onReceive ? (
          <button type="button" className={btnPrimary} onClick={onReceive}>
            Receive goods
          </button>
        ) : null}
      </PageHead>
      <div className="grid grid-cols-5 gap-3">
        <Kpi label="Stock value" value={t.value === null ? '—' : short(t.value, currency)} sub={t.value === null ? 'Needs permission to see costs' : `${t.stocked_products.toLocaleString()} products holding stock`} />
        <Kpi label="Units on hand" value={qty(t.units)} sub={`${qty(t.reserved)} reserved`} onClick={() => onGo('stock')} />
        <Kpi label="Low stock" value={t.low_stock} sub="At or below minimum" tone={t.low_stock ? 'amber' : undefined} onClick={() => onStock('low')} />
        <Kpi label="Out of stock" value={t.out_of_stock} sub="Nothing available" tone={t.out_of_stock ? 'red' : undefined} onClick={() => onStock('out')} />
        <Kpi label="To approve" value={d.pending.adjustments} sub={d.pending.adjustments === 1 ? 'Adjustment waiting' : 'Adjustments waiting'} onClick={() => onGo('adj', HERE.adj)} />
      </div>
      <div className="grid grid-cols-3 gap-3.5">
        <Panel title="Coming in and going out" sub="units, the last 14 days" className="col-span-2" bodyClassName="flex flex-col">
          <div className="flex h-[200px] items-end gap-2 px-4 pt-4" role="img" aria-label="Units received and issued each day, the last fourteen days">
            {days.map((m) => {
              const r = num(m.received) ?? 0;
              const i = num(m.issued) ?? 0;
              return (
                <div key={m.day} className="flex h-full flex-1 items-end justify-center gap-[3px]" title={`${dayWords(m.day)}: ${qty(r)} received, ${qty(i)} issued`}>
                  <span className="w-full max-w-[14px] rounded-t-[3px] bg-primary" style={{ height: `${Math.max(r ? 2 : 0, (r / top) * 100)}%` }} />
                  <span className="w-full max-w-[14px] rounded-t-[3px] bg-[#f59e0b]" style={{ height: `${Math.max(i ? 2 : 0, (i / top) * 100)}%` }} />
                </div>
              );
            })}
            {!days.length ? <span className="m-auto text-[12.5px] text-ink-3">Nothing has moved in the last 14 days.</span> : null}
          </div>
          <div className="flex items-center gap-1.5 px-4 pt-2 pb-3 text-[11.5px] text-ink-3">
            <span className="h-2 w-2 rounded-[2px] bg-primary" /> received <span className="ml-1.5 h-2 w-2 rounded-[2px] bg-[#f59e0b]" /> issued
            {days.length ? <span className="ml-auto">{`${dayWords(days[0]!.day)} – ${dayWords(days[days.length - 1]!.day)}`}</span> : null}
          </div>
        </Panel>
        <ComputerCard copy={{ products: c.products, warehouses: c.warehouses }} onOpen={onComputer} />
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        <Kpi label="Products" value={c.products.toLocaleString()} sub={`${c.stocked.toLocaleString()} tracked for stock`} onClick={() => onGo('prod')} />
        <Kpi label="Categories" value={c.categories.toLocaleString()} sub={busiest ? `Busiest holds ${busiest.product_count}` : 'None yet'} />
        <Kpi label="Vendors" value={c.vendors.toLocaleString()} sub="Shared across companies" />
        <Kpi label="Warehouses" value={c.warehouses.toLocaleString()} sub={warehouse ? 'One chosen' : 'Holding stock'} />
      </div>
      {chips.length ? (
        <section aria-label="Needs attention" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3">
          <b className="text-ink">Needs attention</b>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((a) => (
              <button
                key={a.key}
                type="button"
                title={HERE[a.view] !== undefined || a.view === 'stock' ? undefined : 'Opens in your browser'}
                onClick={() => (a.view === 'stock' ? onStock(a.key === 'out' ? 'out' : 'low') : a.view === 'so' && onSales ? onSales() : HERE[a.view] !== undefined ? onGo(a.view as InvView, HERE[a.view]) : openWeb(WEB_VIEW[a.view]))}
                className={cx(
                  'inline-flex h-7 items-center gap-1 rounded-[14px] px-3 text-[12.5px] font-semibold',
                  a.tone === 'red' ? 'bg-[#FCE9E4] text-[#8C2A14] hover:bg-[#F8DCD3] dark:bg-danger-bg dark:text-danger' : 'bg-[#FFF4E0] text-[#9A4A06] hover:bg-[#FCE8C4] dark:bg-warning-bg dark:text-warning',
                )}
              >
                {a.label}
                {a.view === 'stock' || HERE[a.view] !== undefined || (a.view === 'so' && onSales) ? null : <Icon name="external" size={11} />}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <div className="grid grid-cols-3 gap-3">
        <ListPanel title="Open orders and transfers" empty="">
          {[
            <Line key="po" title="Purchase orders open" right={d.pending.purchase_orders} onClick={() => onGo('pur', '&bt=orders')} />,
            <Line key="in" title="Units incoming" right={qty(t.incoming)} />,
            <Line key="so" title="Sales orders open" right={d.pending.sales_orders} onClick={() => (onSales ? onSales() : openWeb('sales'))} />,
            <Line key="res" title="Units reserved" right={qty(t.reserved)} />,
            <Line key="trf" title="Transfers in flight" right={d.pending.transfers} onClick={() => onGo('trf', HERE.trf)} />,
          ]}
        </ListPanel>
        <ListPanel title="Stock health" empty="">
          {[
            <Line key="h" title="Products holding stock" right={t.stocked_products.toLocaleString()} onClick={() => onGo('stock')} />,
            <Line key="l" title="Below minimum" right={t.low_stock} rightClass={t.low_stock ? 'text-[#9A4A06] dark:text-warning' : undefined} onClick={() => onStock('low')} />,
            <Line key="o" title="Nothing available" right={t.out_of_stock} rightClass={t.out_of_stock ? 'text-danger' : undefined} onClick={() => onStock('out')} />,
            <Line key="e" title="Batches expiring" right={t.expiring_batches} rightClass={t.expiring_batches ? 'text-[#9A4A06] dark:text-warning' : undefined} onClick={() => onGo('trk', HERE.trk)} />,
          ]}
        </ListPanel>
        <ListPanel title="Warehouses" empty="No warehouse holds stock yet.">
          {(d.warehouses ?? []).map((w) => {
            const low = num(w.low) ?? 0;
            const cap = num(w.capacity);
            return (
              <Line
                key={w.id}
                title={w.name}
                sub={[`${low} below minimum`, cap ? `${qty(w.units)} of ${qty(cap)} ${w.capacity_unit ?? 'units'}` : `${qty(w.units)} units`].join(' · ')}
                right={w.value === null || w.value === undefined ? undefined : short(w.value, currency)}
              />
            );
          })}
        </ListPanel>
        <ListPanel title="Latest movements" empty="Nothing has moved yet." action={<HeadLink onClick={() => onGo('mov')}>View all</HeadLink>}>
          {(d.recent ?? []).slice(0, 6).map((m) => {
            const q = num(m.quantity) ?? 0;
            return (
              <Line
                key={m.id}
                title={`${m.code ?? m.name} · ${moveLabel(m.ref_type)}`}
                sub={[m.ref_no, m.warehouse, stampWords(m.moved_at)].filter(Boolean).join(' · ')}
                right={signed(q)}
                rightClass={q > 0 ? 'text-[#166534] dark:text-success' : 'text-danger'}
              />
            );
          })}
        </ListPanel>
        <ListPanel title="Runs out soonest" empty={detail.isLoading ? 'Working it out…' : 'Nothing is running out at the rate it moves.'} action={<HeadLink onClick={() => onGo('rpl')}>Replenishment</HeadLink>}>
          {(x?.cover.rows ?? []).slice(0, 5).map((r) => (
            <Line
              key={r.id}
              title={r.name}
              sub={`${qty(r.available)} left${r.per_day ? ` · ${qty(Math.round(r.per_day * 10) / 10)}/day` : ''}`}
              right={r.available <= 0 ? 'gone' : `${qty(Math.floor(r.days))} ${Math.floor(r.days) === 1 ? 'day' : 'days'}`}
              rightClass={r.available <= 0 || r.days < 7 ? 'text-danger' : 'text-[#9A4A06] dark:text-warning'}
              onClick={() => onOpenProduct(r.id)}
            />
          ))}
        </ListPanel>
        <ListPanel title="To reorder" empty={detail.isLoading ? 'Working it out…' : 'Nothing is below its reorder point.'} action={<HeadLink onClick={() => onGo('pur', '&bt=requests')}>Purchasing</HeadLink>}>
          {(x?.reorder.rows ?? []).slice(0, 5).map((r) => {
            const covered = r.incoming > 0 && r.available + r.incoming > r.minimum;
            return (
              <Line
                key={r.id}
                title={r.name}
                sub={`${qty(r.available)} / ${qty(r.minimum)}${r.incoming ? ` · ${qty(r.incoming)} coming` : ''}`}
                right={covered ? 'covered' : `order ${qty(r.suggest)}`}
                rightClass={covered ? 'text-[#166534] dark:text-success' : 'text-[#9A4A06] dark:text-warning'}
                onClick={() => onOpenProduct(r.id)}
              />
            );
          })}
        </ListPanel>
        <Panel title="Checked against the shelves" bodyClassName="flex flex-col gap-1 px-3.5 py-3 text-[12.5px] text-ink-2">
          {x ? (
            <>
              <span>
                {x.accuracy.counted_90} {x.accuracy.counted_90 === 1 ? 'count' : 'counts'} posted in 90 days
              </span>
              {x.accuracy.last ? (
                <>
                  <span>
                    Last: <b className="text-ink">{x.accuracy.last.reference ?? 'a count'}</b>
                    {x.accuracy.last.warehouse ? ` at ${x.accuracy.last.warehouse}` : ''}
                    {x.accuracy.last.at ? ` on ${dateLabel(x.accuracy.last.at)}` : ''}
                  </span>
                  {x.accuracy.last.variance !== null ? <span>{x.accuracy.last.variance === 0 ? 'It found no difference.' : `It found ${short(Math.abs(x.accuracy.last.variance), currency)} of difference.`}</span> : null}
                </>
              ) : (
                <span>No count has been posted yet.</span>
              )}
              <b className="mt-2 text-ink">Negative stock</b>
              {x.negative.products ? (
                x.negative.rows.slice(0, 4).map((r) => (
                  <button key={`${r.id}-${r.warehouse}`} type="button" className="flex gap-2 text-left hover:underline" onClick={() => onOpenProduct(r.id)}>
                    <span className="min-w-0 flex-1 truncate">
                      {r.name}
                      {r.warehouse ? ` · ${r.warehouse}` : ''}
                    </span>
                    <b className="text-danger tabular-nums">{qty(r.on_hand)}</b>
                  </button>
                ))
              ) : (
                <span>None. No warehouse has issued stock it did not hold.</span>
              )}
            </>
          ) : detail.error ? (
            <ErrorNote error={detail.error} onRetry={() => void detail.refetch()} />
          ) : (
            <span className="text-ink-3">Working it out…</span>
          )}
        </Panel>
      </div>
    </div>
  );
}
