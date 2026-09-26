import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, input, PageHead, Sheet } from '../hr/parts';
import { assignees, BULK_STATUSES, bulk, bulkAssign, fetchOrders, K, PRIORITIES, SOURCE, statusOf, type ListFilters, type Order } from './api';
import { moneyFull, PaymentPill, PriorityPill, StatusPill } from './parts';

const OrderDrawer = lazy(() => import('./OrderDrawer'));
const NewOrder = lazy(() => import('./NewOrder'));

/**
 * All orders (OmsOrders): search, status, source and priority, "mine";
 * select some to assign, move, reprioritise or delete them together; the
 * export takes exactly what the list shows. A row opens the order's drawer.
 */
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));

export default function Orders({ org, status, openId, creating, canCreate, onOpen, onNew, onCloseNew }: {
  org: string;
  status: string | null;
  openId: number | null;
  creating: boolean;
  canCreate: boolean;
  onOpen: (id: number | null) => void;
  onNew: () => void;
  onCloseNew: (createdId?: number) => void;
}) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  const [source, setSource] = useState('');
  const [priority, setPriority] = useState('');
  const [mine, setMine] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters: ListFilters = { status: status ?? undefined, source: source || undefined, priority: priority || undefined, q: needle || undefined, mine };
  const list = useInfiniteQuery({
    queryKey: K.orders(org, filters),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchOrders(org, { ...filters, page: pageParam }, signal),
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
  });
  const people = useQuery({ queryKey: ['sales', 'assignees'], queryFn: assignees, enabled: has(perms, 'oms.orders.assign'), staleTime: 300_000 });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.orders), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const chosen = rows.filter((r) => picked.has(r.id));
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });

  const after = (done: number, failed: Array<{ number: string; why: string }>, what: string) => {
    setPicked(new Set());
    refresh();
    if (failed.length) toast('warning', `${done} ${what}; ${failed.length} not: ${failed.slice(0, 3).map((f) => `${f.number} — ${f.why}`).join('; ')}${failed.length > 3 ? '…' : ''}`);
    else toast('success', `${done} ${done === 1 ? 'order' : 'orders'} ${what}.`);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const ids = chosen.map((c) => c.id);
  const exportCsv = () =>
    void call('transfers:download', {
      ordersCsv: { ...(org ? { org } : {}), ...(status ? { status } : {}), ...(source ? { source } : {}), ...(priority ? { priority: priority as (typeof PRIORITIES)[number] } : {}), ...(needle ? { q: needle } : {}), ...(mine ? { mine: true } : {}) },
      name: `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      open: true,
    }).then(
      () => toast('success', 'Exporting — see Transfers.'),
      (e) => toast('error', errorMessage(e)),
    );

  const title = status === 'pending_approval' ? 'Pending approval' : status ? statusOf(status).label : 'All orders';

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={title} sub={list.data ? `${total} ${total === 1 ? 'order' : 'orders'}` : undefined}>
        {canCreate ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            New order
          </button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number or customer" aria-label="Search orders" className={input + ' !w-[240px]'} />
        <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className={input + ' !w-auto'}>
          <option value="">Any source</option>
          {Object.entries(SOURCE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={input + ' !w-auto'}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Mine
        </label>
        <span className="flex-1" />
        {has(perms, 'oms.orders.export') ? (
          <button type="button" className={btn} onClick={exportCsv} title="Exports exactly what this list is showing, filters and all">
            <Icon name="download" size={14} /> Export
          </button>
        ) : null}
      </div>

      {chosen.length ? (
        <div className="flex flex-wrap items-center gap-1.5 self-start rounded-[9px] border border-[#C7D0F5] bg-[#EEF1FC] px-2 py-1 dark:border-[#2D3A66] dark:bg-[#16203E]" aria-label="Selected orders">
          <b className="px-1 text-[12.5px] text-primary">{chosen.length} selected ·</b>
          {has(perms, 'oms.orders.assign') ? (
            <select aria-label="Assign to" disabled={busy} value="" onChange={(e) => e.target.value && void run(async () => { const r = await bulkAssign(ids, Number(e.target.value)); after(r.assigned, r.failed, 'assigned'); })} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px]">
              <option value="">assign to…</option>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          {has(perms, 'oms.fulfilment.manage') ? (
            <select aria-label="Move to" disabled={busy} value="" onChange={(e) => e.target.value && void run(async () => { const r = await bulk(ids, 'status', e.target.value); after(r.done, r.failed, `moved to ${statusOf(e.target.value).label.toLowerCase()}`); })} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px]">
              <option value="">move to…</option>
              {BULK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusOf(s).label}
                </option>
              ))}
            </select>
          ) : null}
          {has(perms, 'oms.orders.edit') ? (
            <select aria-label="Priority to" disabled={busy} value="" onChange={(e) => e.target.value && void run(async () => { const r = await bulk(ids, 'priority', e.target.value); after(r.done, r.failed, `set to ${e.target.value}`); })} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px]">
              <option value="">priority…</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : null}
          {has(perms, 'oms.orders.delete') ? (
            <button type="button" disabled={busy} onClick={() => setDeleting(true)} className="h-7 rounded-[7px] px-2 text-[12px] font-bold text-danger hover:bg-danger-bg">
              Delete
            </button>
          ) : null}
          <button type="button" onClick={() => setPicked(new Set())} className="h-7 rounded-[7px] px-2 text-[12px] font-semibold text-ink-2 hover:bg-subtle">
            Clear
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex items-center gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <input
            type="checkbox"
            aria-label="Select every order shown"
            checked={rows.length > 0 && chosen.length === rows.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span className="w-[180px]">Order</span>
          <span className="w-[150px]">Status</span>
          <span className="w-[70px]">Priority</span>
          <span className="w-[76px]">Source</span>
          <span className="w-[72px]">Ordered</span>
          <span className="w-[72px]">Expected</span>
          <span className="w-[110px]">Assigned</span>
          <span className="w-[80px]">Payment</span>
          <span className="flex-1 text-right">Total</span>
        </div>
        {list.isLoading ? <Spinner /> : null}
        {list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
        {rows.map((o) => (
          <Row key={o.id} o={o} checked={picked.has(o.id)} open={openId === o.id} onCheck={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(o.id); else n.delete(o.id); return n; })} onOpen={() => onOpen(o.id)} />
        ))}
        {!list.isLoading && !list.error && !rows.length ? <Empty text={needle || source || priority || mine ? 'No orders match.' : 'No orders here.'} /> : null}
        {list.data ? (
          <div className="flex items-center px-3.5 py-2 text-[12px] text-ink-3">
            <span className="flex-1">
              {rows.length} of {total}
            </span>
            {list.hasNextPage ? (
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {deleting ? (
        <Sheet
          title={`Delete ${chosen.length} ${chosen.length === 1 ? 'order' : 'orders'}?`}
          onClose={() => setDeleting(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary + ' !bg-danger'}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await bulk(ids, 'delete');
                    setDeleting(false);
                    after(r.done, r.failed, 'deleted');
                  })
                }
              >
                Delete
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
            Only a draft, cancelled or rejected order can be deleted. Anything that has reserved stock or been delivered is a record of something and is refused, named one by one. Every deletion is written to the order’s timeline.
          </p>
        </Sheet>
      ) : null}

      <Suspense fallback={null}>
        {openId ? <OrderDrawer id={openId} onClose={() => onOpen(null)} /> : null}
        {creating ? <NewOrder org={org} onClose={onCloseNew} /> : null}
      </Suspense>
    </div>
  );
}

function Row({ o, checked, open, onCheck, onOpen }: { o: Order; checked: boolean; open: boolean; onCheck: (on: boolean) => void; onOpen: () => void }) {
  return (
    <div data-order={o.id} className={cx('relative flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0', open ? 'bg-selection' : checked ? 'bg-[#F4F6FE] dark:bg-[#141D38]' : 'hover:bg-subtle')}>
      <button type="button" onClick={onOpen} className="absolute inset-0" aria-label={`Open ${o.number}`} />
      <input type="checkbox" aria-label={`Select ${o.number}`} checked={checked} onChange={(e) => onCheck(e.target.checked)} className="relative z-10 h-3.5 w-3.5 accent-primary" />
      <span className="flex w-[180px] min-w-0 flex-col">
        <b className="truncate text-ink">{o.number}</b>
        <span className="truncate text-[11.5px] text-ink-3">{o.client ?? 'No customer'}</span>
      </span>
      <span className="w-[150px]">
        <StatusPill status={o.status} label={o.status_label} />
      </span>
      <span className="w-[70px]">
        <PriorityPill priority={o.priority} />
      </span>
      <span className="w-[76px] truncate text-ink-2" title={o.source_ref ?? undefined}>
        {SOURCE[o.source] ?? o.source}
      </span>
      <span className="w-[72px] text-ink-2">{o.order_date ? dateLabel(o.order_date) : '—'}</span>
      <span className="w-[72px] text-ink-2">{o.expected_date ? dateLabel(o.expected_date) : '—'}</span>
      <span className="w-[110px] truncate text-ink-2">{o.assigned_name ?? '—'}</span>
      <span className="w-[80px]">
        <PaymentPill status={o.payment_status} />
      </span>
      <b className="flex-1 text-right text-ink tabular-nums">{moneyFull(o.total, o.currency)}</b>
    </div>
  );
}
