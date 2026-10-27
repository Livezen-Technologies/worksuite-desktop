import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, input, PageHead, Sheet } from '../../components/PageKit';
import { assignees, BULK_STATUSES, bulk, bulkAssign, deleteView, fetchOrders, fetchViews, K, KV, PRIORITIES, saveView, SOURCE, statusOf, type ListFilters, type Order, type SavedView } from './api';
import { moveFocus, useSalesKeys } from './keys';
import { OFFLINE_WRITE, offlineLine, useSalesOffline } from './offline';
import { moneyFull, PaymentPill, PriorityPill, StatusPill } from './parts';
import { Checkbox } from '../../components/Checkbox';

const OrderDrawer = lazy(() => import('./OrderDrawer'));
const NewOrder = lazy(() => import('./NewOrder'));

/**
 * All orders (OmsOrders, D-02): search, status, source, priority, payment, the order-date window, "mine" and
 * "overdue"; saved views (ORD-14) bring a set of those back by name. Select some to assign, move, reprioritise or
 * delete them together; the export takes exactly what the list shows. A row opens the order's drawer.
 *
 * Keyboard-first (FR-DSK-03): ↑/↓ move, Enter opens, Space selects, ⌘N / Ctrl+N a new order, ⌘F / Ctrl+F the search,
 * Esc clears the selection. Offline the list is this computer's copy of the orders last seen (FR-DSK-07): read only.
 */
const PAYMENTS = ['unpaid', 'partial', 'paid', 'overpaid', 'refund_pending', 'refunded'] as const;
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));

export default function Orders({ org, status, overdue: overdueAsked = false, openId, creating, canCreate, onOpen, onNew, onCloseNew }: {
  org: string;
  status: string | null;
  /** Opened narrowed to the overdue orders (the dashboard's "past their expected date"). */
  overdue?: boolean;
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
  const [overdue, setOverdue] = useState(overdueAsked);
  const [payment, setPayment] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [naming, setNaming] = useState(false);
  const [at, setAt] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { active } = useTab();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters: ListFilters = { status: status ?? undefined, source: source || undefined, priority: priority || undefined, q: needle || undefined, mine, overdue, payment: payment || undefined, from: from || undefined, to: to || undefined };
  const list = useInfiniteQuery({
    queryKey: K.orders(org, filters),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchOrders(org, { ...filters, page: pageParam }, signal),
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
  });
  const people = useQuery({ queryKey: ['sales', 'assignees'], queryFn: assignees, enabled: has(perms, 'oms.orders.assign'), staleTime: 300_000 });
  const views = useQuery({ queryKey: KV.views, queryFn: ({ signal }) => fetchViews(signal), staleTime: 60_000, retry: false });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.orders), [list.data]);
  const servedOffline = list.data?.pages.some((p) => p.offline) ?? false;
  const offline = useSalesOffline(servedOffline);
  const cachedAt = list.data?.pages[0]?.cachedAt ?? null;
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
  const narrowed = !!(needle || source || priority || mine || overdue || payment || from || to);
  const applyView = (v: SavedView) => {
    const f = v.filters;
    setQ(String(f.q ?? ''));
    setSource(String(f.source ?? ''));
    setPriority(String(f.priority ?? ''));
    setPayment(String(f.payment ?? ''));
    setFrom(String(f.from ?? ''));
    setTo(String(f.to ?? ''));
    setMine(f.mine === true || f.mine === '1');
    setOverdue(f.overdue === true || f.overdue === '1');
  };
  const clearFilters = () => {
    setQ('');
    setSource('');
    setPriority('');
    setPayment('');
    setFrom('');
    setTo('');
    setMine(false);
    setOverdue(false);
  };
  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // The keyboard map (FR-DSK-03), while this tab is in front and no drawer or form is open over the list.
  useSalesKeys(active && !openId && !creating && !deleting && !naming, { canCreate: canCreate && !offline }, (a) => {
    if (a.kind === 'move') {
      const n = moveFocus(at, a.delta, rows.length);
      setAt(n);
      listRef.current?.querySelector(`[data-order="${rows[n]?.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (a.kind === 'open') return rows[at] ? onOpen(rows[at]!.id) : false;
    if (a.kind === 'select') return rows[at] ? toggle(rows[at]!.id) : false;
    if (a.kind === 'new') return onNew();
    if (a.kind === 'search') {
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (a.kind === 'escape' && picked.size) return setPicked(new Set());
    return false;
  });

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={title} sub={list.data ? `${total} ${total === 1 ? 'order' : 'orders'}` : undefined}>
        {(views.data ?? []).length ? (
          <Select<string>
            aria-label="Saved views"
            value=""
            placeholder="Saved views"
            options={(views.data ?? []).map((v) => ({ value: String(v.id), label: v.name }))}
            onValueChange={(id) => {
              const v = views.data?.find((x) => String(x.id) === id);
              if (v) applyView(v);
            }}
            className={input + ' !w-[180px]'}
          />
        ) : null}
        {narrowed && !views.error ? (
          <button type="button" className={btn} disabled={offline} onClick={() => setNaming(true)} title={offline ? OFFLINE_WRITE : 'Keep these filters as a view, by name'}>
            <Icon name="bookmark" size={14} /> Save view
          </button>
        ) : null}
        {canCreate ? (
          <button type="button" className={btnPrimary} onClick={onNew} disabled={offline} title={offline ? OFFLINE_WRITE : 'New order (⌘N / Ctrl+N)'}>
            New order
          </button>
        ) : null}
      </PageHead>
      {offline ? (
        <p className="m-0 flex items-center gap-2 rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning" role="status">
          <Icon name="cloud-off" size={14} /> {offlineLine(cachedAt)} · read only.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number or customer" aria-label="Search orders" title="⌘F / Ctrl+F" className={input + ' !w-[240px]'} />
        <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className={input + ' !w-auto'}>
          <option value="">Any source</option>
          {Object.entries(SOURCE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={input + ' !w-auto'}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select aria-label="Payment" value={payment} onChange={(e) => setPayment(e.target.value)} className={input + ' !w-auto'}>
          <option value="">Any payment</option>
          {PAYMENTS.map((p) => (
            <option key={p} value={p}>
              {p.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <input type="date" aria-label="Ordered from" value={from} onChange={(e) => setFrom(e.target.value)} className={input + ' !w-[140px]'} />
        <input type="date" aria-label="Ordered to" value={to} onChange={(e) => setTo(e.target.value)} className={input + ' !w-[140px]'} />
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Mine
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Checkbox checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          Overdue
        </label>
        {narrowed ? (
          <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={clearFilters}>
            Clear
          </button>
        ) : null}
        <span className="flex-1" />
        {has(perms, 'oms.orders.export') ? (
          <button type="button" className={btn} onClick={exportCsv} title="Exports exactly what this list is showing, filters and all">
            <Icon name="download" size={14} /> Export
          </button>
        ) : null}
      </div>

      {chosen.length && !offline ? (
        <div className="flex flex-wrap items-center gap-1.5 self-start rounded-[9px] border border-info-line bg-selection px-2 py-1 dark:border-primary-soft dark:bg-info-soft" aria-label="Selected orders">
          <b className="px-1 text-[12.5px] text-primary">{chosen.length} selected ·</b>
          {has(perms, 'oms.orders.assign') ? (
            <Select aria-label="Assign to" searchable disabled={busy} value="" onChange={(e) => e.target.value && void run(async () => { const r = await bulkAssign(ids, Number(e.target.value)); after(r.assigned, r.failed, 'assigned'); })} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px]">
              <option value="">assign to…</option>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : null}
          {has(perms, 'oms.fulfilment.manage') ? (
            <Select aria-label="Move to" disabled={busy} value="" onChange={(e) => e.target.value && void run(async () => { const r = await bulk(ids, 'status', e.target.value); after(r.done, r.failed, `moved to ${statusOf(e.target.value).label.toLowerCase()}`); })} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px]">
              <option value="">move to…</option>
              {BULK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusOf(s).label}
                </option>
              ))}
            </Select>
          ) : null}
          {has(perms, 'oms.orders.edit') ? (
            <Select aria-label="Priority to" disabled={busy} value="" onChange={(e) => e.target.value && void run(async () => { const r = await bulk(ids, 'priority', e.target.value); after(r.done, r.failed, `set to ${e.target.value}`); })} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px]">
              <option value="">priority…</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
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

      <div ref={listRef} role="listbox" aria-label="Orders" aria-multiselectable aria-activedescendant={rows[at] ? `order-${rows[at]!.id}` : undefined} tabIndex={0} className="overflow-hidden rounded-[12px] border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
        <div className="flex items-center gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <Checkbox
            aria-label="Select every order shown"
            checked={rows.length > 0 && chosen.length === rows.length}
            indeterminate={chosen.length > 0 && chosen.length < rows.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
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
        {rows.map((o, i) => (
          <Row key={o.id} o={o} checked={picked.has(o.id)} open={openId === o.id} focused={i === at} onCheck={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(o.id); else n.delete(o.id); return n; })} onOpen={() => (setAt(i), onOpen(o.id))} />
        ))}
        {!list.isLoading && !list.error && !rows.length ? <Empty text={narrowed ? 'No orders match.' : offline ? 'No orders were kept on this computer for this list.' : 'No orders here.'} /> : null}
        {list.data ? (
          <div className="flex items-center px-3.5 py-2 text-[12px] text-ink-3">
            <span className="flex-1">
              {rows.length} of {total}
              {picked.size ? ` · ${picked.size} selected` : ''}
            </span>
            <span className="mr-3 hidden text-[11.5px] lg:inline">↑ ↓ move · Enter open · Space select</span>
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

      {naming ? (
        <NameView
          onClose={() => setNaming(false)}
          onSave={async (name) => {
            await saveView({ name, filters: { ...(needle ? { q: needle } : {}), ...(source ? { source } : {}), ...(priority ? { priority } : {}), ...(payment ? { payment } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(mine ? { mine: true } : {}), ...(overdue ? { overdue: true } : {}), ...(status ? { status } : {}) } });
            void qc.invalidateQueries({ queryKey: KV.views });
            toast('success', `Saved “${name}”.`);
            setNaming(false);
          }}
          views={views.data ?? []}
          onDelete={async (v) => {
            await deleteView(v.id);
            void qc.invalidateQueries({ queryKey: KV.views });
          }}
        />
      ) : null}

      <Suspense fallback={null}>
        {openId ? <OrderDrawer id={openId} onClose={() => onOpen(null)} /> : null}
        {creating ? <NewOrder org={org} onClose={onCloseNew} /> : null}
      </Suspense>
    </div>
  );
}

function NameView({ views, onSave, onDelete, onClose }: { views: SavedView[]; onSave: (name: string) => Promise<void>; onDelete: (v: SavedView) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
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
  return (
    <Sheet
      title="Save this view"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !name.trim()} onClick={() => void run(() => onSave(name.trim()))}>
            Save view
          </button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        Name
        <input autoFocus className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Overdue, unpaid — Colombo" />
      </label>
      <p className="m-0 text-[12px] text-ink-3">The filters set now are kept by name, for you, on every computer and on the web.</p>
      {views.length ? (
        <div className="flex flex-col">
          {views.map((v) => (
            <div key={v.id} className="flex items-center gap-2 border-b border-line/70 py-1.5 text-[12.5px] last:border-b-0">
              <span className="flex-1 text-ink">{v.name}</span>
              <button type="button" className="text-[12px] font-bold text-danger hover:underline" disabled={busy} onClick={() => void run(() => onDelete(v))}>
                Delete
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </Sheet>
  );
}

function Row({ o, checked, open, focused, onCheck, onOpen }: { o: Order; checked: boolean; open: boolean; focused: boolean; onCheck: (on: boolean) => void; onOpen: () => void }) {
  return (
    <div
      id={`order-${o.id}`}
      role="option"
      aria-selected={checked}
      data-order={o.id}
      data-focused={focused || undefined}
      onClick={onOpen}
      className={cx('relative flex cursor-default items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0', open ? 'bg-selection' : checked ? 'bg-info-soft dark:bg-rail' : 'hover:bg-subtle', focused && 'ring-2 ring-primary/40 ring-inset')}
    >
      <span role="presentation" onClick={(e) => e.stopPropagation()} className="relative z-10 flex">
        <Checkbox aria-label={`Select ${o.number}`} checked={checked} onChange={(e) => onCheck(e.target.checked)} />
      </span>
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
      <span className={cx('w-[72px]', o.overdue ? 'font-bold text-danger' : 'text-ink-2')} title={o.overdue ? 'Overdue: past its expected date' : undefined}>
        {o.expected_date ? dateLabel(o.expected_date) : '—'}
      </span>
      <span className="w-[110px] truncate text-ink-2">{o.assigned_name ?? '—'}</span>
      <span className="w-[80px]">
        <PaymentPill status={o.payment_status} />
      </span>
      <b className="flex-1 text-right text-ink tabular-nums">{moneyFull(o.total, o.currency)}</b>
    </div>
  );
}
