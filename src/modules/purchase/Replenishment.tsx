import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btnPrimary, Empty, PageHead } from '../hr/parts';
import { num, qty, type Warehouse } from '../inventory/api';
import { fetchReplenishment, KI, raiseRequests } from '../inventory/insight';
import { minWidth } from '../inventory/parts';
import { Checkbox } from '../../components/Checkbox';
import { refreshPurchase } from './api';

/**
 * Replenishment (InvReplenishment): what is below its minimum, soonest to
 * run out first, with what to order to get back to it. Purchase requests
 * are raised from the lines ticked, or from all of them, for whoever may
 * buy; they go to Purchasing's requests to be approved and turned into
 * orders. (Purchasing's own screen since SRS-PUR-001 G-21; Inventory's rail
 * opens it here.)
 */
export default function Replenishment({ org, warehouse, warehouses, canPurchase, onRequests }: { org: string; warehouse: number | null; warehouses: Warehouse[]; canPurchase: boolean; onRequests: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KI.replenishment(org, warehouse), queryFn: ({ signal }) => fetchReplenishment(org, warehouse, signal) });
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const items = q.data?.items ?? [];
  const whName = warehouse ? (warehouses.find((w) => w.id === warehouse)?.name ?? 'that warehouse') : null;
  const W = { wh: 130, avail: 90, inc: 90, min: 80, sug: 90, day: 80, cover: 70, vendor: 150 };

  const raise = async () => {
    setBusy(true);
    try {
      const r = await raiseRequests(org, warehouse, picked);
      const made = r.ids?.length ?? 0;
      toast('success', made === 1 ? 'One purchase request raised — see Purchasing › Requests' : `${made} purchase requests raised — see Purchasing › Requests`);
      setPicked([]);
      refreshPurchase(qc);
      onRequests();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Replenishment" sub={`${whName ? `In ${whName}` : 'Every warehouse'} · ${q.isLoading ? '' : `${items.length.toLocaleString()} below minimum`}`}>
        {canPurchase && items.length ? (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void raise()}>
            {busy ? 'Raising…' : picked.length ? `Raise requests for ${picked.length}` : 'Raise requests for all'}
          </button>
        ) : null}
      </PageHead>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="min-h-0 flex-1 overflow-auto scroll-thin">
              <div style={{ minWidth: minWidth(200, [28, ...Object.values(W)]) }}>
                <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <span className="w-[28px] shrink-0" />
                  <span className="min-w-0 flex-1">Product</span>
                  <span style={{ width: W.wh }}>Warehouse</span>
                  <span className="text-right" style={{ width: W.avail }}>
                    Available
                  </span>
                  <span className="text-right" style={{ width: W.inc }}>
                    Coming
                  </span>
                  <span className="text-right" style={{ width: W.min }}>
                    Minimum
                  </span>
                  <span className="text-right" style={{ width: W.sug }}>
                    Order
                  </span>
                  <span className="text-right" style={{ width: W.day }}>
                    Per day
                  </span>
                  <span className="text-right" style={{ width: W.cover }}>
                    Cover
                  </span>
                  <span style={{ width: W.vendor }}>Vendor</span>
                </div>
                {items.map((i) => (
                  <label key={`${i.product_id}-${i.warehouse_id}`} data-reorder={i.product_id} className="flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0 hover:bg-subtle/60">
                    <span className="flex w-[28px] shrink-0 justify-center">{canPurchase ? <Checkbox checked={picked.includes(i.product_id)} onChange={() => toggle(i.product_id)} aria-label={`Pick ${i.name}`} /> : null}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="truncate text-ink">{i.name}</b>
                      {i.code ? <span className="truncate text-[11px] text-ink-3">{i.code}</span> : null}
                    </span>
                    <span className="shrink-0 truncate text-ink-2" style={{ width: W.wh }}>
                      {i.warehouse ?? '—'}
                    </span>
                    <b className="shrink-0 text-right text-warning-ink tabular-nums dark:text-warning" style={{ width: W.avail }}>
                      {qty(num(i.available) ?? 0)}
                      {i.unit ? ` ${i.unit}` : ''}
                    </b>
                    <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.inc }}>
                      {(num(i.incoming) ?? 0) > 0 ? qty(num(i.incoming)!) : '—'}
                    </span>
                    <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.min }}>
                      {qty(num(i.minimum) ?? 0)}
                    </span>
                    <b className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.sug }}>
                      {qty(num(i.suggested) ?? 0)}
                    </b>
                    <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.day }}>
                      {num(i.per_day) !== null ? qty(num(i.per_day)!) : '—'}
                    </span>
                    <span className={cx('shrink-0 text-right tabular-nums', (num(i.days_cover) ?? 99) < 7 ? 'font-bold text-danger' : 'text-ink-2')} style={{ width: W.cover }}>
                      {num(i.days_cover) !== null ? `${num(i.days_cover)} d` : '—'}
                    </span>
                    <span className="shrink-0 truncate text-ink-2" style={{ width: W.vendor }}>
                      {i.vendor ?? '—'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          {q.data?.basis ? <span className="text-[12px] leading-relaxed text-ink-3">{q.data.basis}</span> : null}
        </>
      ) : (
        <Empty text={whName ? `Nothing in ${whName} is below its minimum.` : 'Nothing is below its minimum.'} />
      )}
    </div>
  );
}
