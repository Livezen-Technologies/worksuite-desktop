import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Seg, Sheet, SidePanel } from '../hr/parts';
import { can, cost, num, qty, stampWords, whole, type Warehouse } from './api';
import {
  cancelReceipt,
  deleteOrder,
  fetchOrder,
  fetchOrders,
  fetchReceipt,
  fetchReceipts,
  fetchRequests,
  KB,
  orderActions,
  orderAct,
  orderBody,
  PER,
  PO_LABEL,
  poTone,
  postReceipt,
  receiptBody,
  REJECT_REASONS,
  requestAct,
  requestsFromReplenishment,
  saveOrder,
  searchVendors,
  type PODraft,
  type POLineDraft,
  type ReceiptLine,
  type ReceiptLineDraft,
} from './buying';
import { minWidth, Pill } from './parts';
import { pick, ProductPick, WarehousePick } from './pickers';

/**
 * Purchasing (InvPurchasing): the orders raised with vendors, the goods
 * received against them, and the requests that come before them. An order
 * is approved, received — in one delivery or several — and each receipt is
 * checked and posted, which is the moment the stock is on the shelf.
 */
export type BuyTab = 'orders' | 'receipts' | 'requests';

const ORDER_STATUSES = [{ value: '', label: 'Every state' }, ...['draft', 'approved', 'acknowledged', 'partial', 'received', 'cancelled'].map((s) => ({ value: s, label: PO_LABEL[s]! }))];

export function PoChip({ status }: { status: string }) {
  return <Pill tone={poTone(status)}>{PO_LABEL[status] ?? status.replace(/_/g, ' ')}</Pill>;
}

const rowCls = 'flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60';

export default function Purchasing({
  org,
  warehouse,
  currency,
  canCost,
  tab,
  onTab,
  orderId,
  onOrder,
  receiptId,
  onReceipt,
  onNewOrder,
  onEditOrder,
  initialStatus,
}: {
  org: string;
  warehouse: number | null;
  currency: string | null;
  canCost: boolean;
  tab: BuyTab;
  onTab: (t: BuyTab) => void;
  orderId: number | null;
  onOrder: (id: number | null) => void;
  receiptId: number | null;
  onReceipt: (id: number | null) => void;
  onNewOrder: (() => void) | null;
  onEditOrder: (id: number) => void;
  initialStatus?: string | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Purchasing">
        <Seg
          label="Purchasing"
          value={tab}
          onChange={onTab}
          options={[
            { id: 'orders', label: 'Orders' },
            { id: 'receipts', label: 'Receipts' },
            { id: 'requests', label: 'Requests' },
          ]}
        />
        {onNewOrder && tab === 'orders' ? (
          <button type="button" className={btnPrimary} onClick={onNewOrder}>
            <Icon name="plus" size={15} /> New order
          </button>
        ) : null}
      </PageHead>
      {tab === 'orders' ? <Orders key={initialStatus ?? ''} org={org} warehouse={warehouse} currency={currency} openId={orderId} onOpen={onOrder} initialStatus={initialStatus} /> : null}
      {tab === 'receipts' ? <Receipts org={org} warehouse={warehouse} openId={receiptId} onOpen={onReceipt} /> : null}
      {tab === 'requests' ? <Requests org={org} warehouse={warehouse} onOrdered={() => onTab('orders')} /> : null}
      {orderId ? <OrderPanel key={orderId} id={orderId} currency={currency} canCost={canCost} onClose={() => onOrder(null)} onEdit={() => onEditOrder(orderId)} onReceipt={onReceipt} /> : null}
      {receiptId ? <ReceiptPanel key={receiptId} id={receiptId} currency={currency} onClose={() => onReceipt(null)} onOrder={onOrder} /> : null}
    </div>
  );
}

function Frame({ min, head, children, more }: { min: number; head: ReactNode; children: ReactNode; more?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="min-h-0 flex-1 overflow-auto scroll-thin">
        <div style={{ minWidth: min }}>
          <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{head}</div>
          {children}
        </div>
      </div>
      {more}
    </div>
  );
}

function Orders({ org, warehouse, currency, openId, onOpen, initialStatus }: { org: string; warehouse: number | null; currency: string | null; openId: number | null; onOpen: (id: number) => void; initialStatus?: string | null }) {
  const [status, setStatus] = useState(initialStatus ?? '');
  const [q, setQ] = useState('');
  const f = { status, q };
  const list = useInfiniteQuery({
    queryKey: KB.orders(org, { ...f, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchOrders(org, warehouse, { ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const today = todayInZone();
  const W = { vendor: 170, wh: 140, st: 110, exp: 84, out: 90, tot: 110 };
  return (
    <>
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number, vendor, note…" aria-label="Search orders" className={input + ' !w-[240px]'} />
        <Select aria-label="Order status" value={status} onValueChange={setStatus} options={ORDER_STATUSES} className={pick + ' !w-[170px]'} />
        <span className="ml-auto text-[12.5px] text-ink-3" data-doc-count>
          {list.isLoading ? '' : `${total.toLocaleString()} ${total === 1 ? 'order' : 'orders'}`}
        </span>
      </div>
      <Frame
        min={minWidth(110, Object.values(W))}
        head={
          <>
            <span className="min-w-0 flex-1">Order</span>
            <span style={{ width: W.vendor }}>Vendor</span>
            <span style={{ width: W.wh }}>Deliver to</span>
            <span style={{ width: W.st }}>Status</span>
            <span style={{ width: W.exp }}>Expected</span>
            <span className="text-right" style={{ width: W.out }}>
              To come
            </span>
            <span className="text-right" style={{ width: W.tot }}>
              Total
            </span>
          </>
        }
        more={
          list.hasNextPage ? (
            <div className="flex shrink-0 justify-center border-t border-line px-3.5 py-2 text-[12px]">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : null
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((o) => {
            const late = !!o.expected_date && o.expected_date < today && ['approved', 'acknowledged', 'partial'].includes(o.status);
            const out = num(o.outstanding_qty) ?? 0;
            return (
              <button key={o.id} type="button" data-po={o.id} onClick={() => onOpen(Number(o.id))} className={cx(rowCls, openId === Number(o.id) && 'bg-[#F4F6FE] dark:bg-selection/40')}>
                <b className="min-w-0 flex-1 truncate text-ink">{o.po_number}</b>
                <span className="shrink-0 truncate text-ink" style={{ width: W.vendor }}>
                  {o.vendor ?? '—'}
                </span>
                <span className="shrink-0 truncate text-ink-2" style={{ width: W.wh }}>
                  {o.warehouse ?? '—'}
                </span>
                <span className="shrink-0" style={{ width: W.st }}>
                  <PoChip status={o.status} />
                </span>
                <span className={cx('shrink-0', late ? 'font-bold text-danger' : 'text-ink-2')} style={{ width: W.exp }}>
                  {o.expected_date ? dateLabel(o.expected_date) : '—'}
                </span>
                <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.out }}>
                  {['cancelled', 'draft'].includes(o.status) ? '—' : out > 0 ? `${qty(out)} to come` : 'complete'}
                </span>
                <b className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.tot }}>
                  {whole(o.total, o.currency && o.currency !== currency ? o.currency : null)}
                </b>
              </button>
            );
          })
        ) : (
          <Empty text={q || status ? 'No orders match that.' : 'No purchase orders yet.'} />
        )}
      </Frame>
    </>
  );
}

function OrderPanel({ id, currency, canCost, onClose, onEdit, onReceipt }: { id: number; currency: string | null; canCost: boolean; onClose: () => void; onEdit: () => void; onReceipt: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: KB.order(id), queryFn: ({ signal }) => fetchOrder(id, signal) });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'remove' | null>(null);
  const d = q.data;
  const o = d?.order;
  const received = d ? d.lines.reduce((s, l) => s + (num(l.received_qty) ?? 0), 0) : 0;
  const acts = o ? orderActions(o, received, { purchase: can(perms, 'inventory.purchase'), approve: can(perms, 'inventory.approve'), mayApprove: d?.may_approve }) : null;
  // Buyers and cost holders see an order's prices; the server sends null to anyone else.
  const prices = !!o && num(o.total) !== null;
  const cur = o?.currency ?? currency;
  const charges = o ? (num(o.freight_cost) ?? 0) + (num(o.insurance_cost) ?? 0) + (num(o.duty_cost) ?? 0) + (num(o.other_charges) ?? 0) : 0;

  const run = async (label: string, fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      if (label) toast('success', label);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      after?.(r);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const pdf = () =>
    void run('', async () => {
      const f = (await orderAct(id, 'pdf')) as { file_id?: number; name?: string };
      if (f.file_id) await call('transfers:download', { fileId: String(f.file_id), name: f.name || `${o?.po_number ?? 'order'}.pdf`, open: true });
    });

  return (
    <>
      <SidePanel
        label={o ? `Order ${o.po_number}` : 'Order'}
        width={640}
        onClose={onClose}
        head={
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <b className="truncate text-[15px] text-ink">{o?.po_number ?? 'Order'}</b>
              {o ? <PoChip status={o.status} /> : null}
            </span>
            {o ? <span className="truncate text-[12.5px] text-ink-3">{o.vendor}</span> : null}
          </span>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : o && d ? (
          <>
            <span className="text-[12.5px] text-ink-2">
              {[o.warehouse, o.expected_date ? `expected ${dateLabel(o.expected_date)}` : null, o.reference_no ? `our ref ${o.reference_no}` : null, o.created_by_name ? `raised by ${o.created_by_name}` : null].filter(Boolean).join(' · ')}
              {' · '}
              <b className="text-ink">{cost(o.total, cur)}</b>
            </span>
            {o.vendor_response === 'accepted' ? <span className="text-[12.5px] font-semibold text-[#166534] dark:text-success">The vendor accepted it{o.vendor_promised_date ? `, promising ${dateLabel(o.vendor_promised_date)}` : ''}.</span> : null}
            <div className="overflow-hidden rounded-[10px] border border-line">
              <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Item</span>
                <span className="w-[62px] text-right">Ordered</span>
                <span className="w-[66px] text-right">Received</span>
                {prices ? <span className="w-[80px] text-right">Unit cost</span> : null}
                <span className="w-[90px] text-right">Line total</span>
              </div>
              {d.lines.map((l) => {
                const ord = num(l.quantity) ?? 0;
                const got = num(l.received_qty) ?? 0;
                return (
                  <div key={l.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="truncate text-ink">{l.product_name ?? l.description}</b>
                      <span className="truncate text-[11px] text-ink-3">{[l.code, l.tracking && l.tracking !== 'none' ? l.tracking : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="w-[62px] text-right text-ink tabular-nums">{qty(ord)}</span>
                    <span className={cx('w-[66px] text-right tabular-nums', got >= ord ? 'text-[#166534] dark:text-success' : got > 0 ? 'text-[#9A4A06] dark:text-warning' : 'text-ink-3')}>{qty(got)}</span>
                    {prices ? <span className="w-[80px] text-right text-ink-2 tabular-nums">{whole(l.unit_cost)}</span> : null}
                    <span className="w-[90px] text-right text-ink tabular-nums">{whole(l.line_total)}</span>
                  </div>
                );
              })}
            </div>
            {charges > 0 ? (
              <span className="text-[12.5px] text-ink-2">
                Freight, insurance and duty: <b className="text-ink">{cost(charges, cur)}</b> — each receipt brings its share into the cost of the stock.
              </span>
            ) : null}
            {d.receipts.length ? (
              <section className="flex flex-col gap-1">
                <b className="text-[13px] text-ink">Receipts</b>
                {d.receipts.map((g) => (
                  <button key={g.id} type="button" onClick={() => onReceipt(Number(g.id))} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                    <b className="text-primary">{g.grn_number}</b>
                    <Pill tone={g.status === 'posted' ? 'green' : g.status === 'draft' ? 'amber' : 'grey'}>{g.status}</Pill>
                    <span className="flex-1 text-ink-3">{g.posted_at ? stampWords(g.posted_at) : g.received_at ? stampWords(g.received_at) : ''}</span>
                    {canCost ? <span className="text-ink-2 tabular-nums">{whole(g.total_value)}</span> : null}
                  </button>
                ))}
              </section>
            ) : null}
            {acts ? (
              <div className="flex flex-wrap gap-2">
                {acts.edit ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={onEdit}>
                    Edit
                  </button>
                ) : null}
                {acts.approve ? (
                  <button type="button" className={btnSmall} disabled={busy || !d.lines.length} onClick={() => void run('Order approved', () => orderAct(id, 'approve'))}>
                    Approve
                  </button>
                ) : null}
                {acts.waiting ? <span className="self-center text-[12.5px] text-ink-3">You raised this order, so someone else approves it.</span> : null}
                {acts.receive ? (
                  <button
                    type="button"
                    className={btnPrimary + ' !h-[30px] !text-[12.5px]'}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        'Draft receipt created — check the quantities, then post it',
                        () => orderAct(id, 'receive'),
                        (r) => onReceipt(Number((r as { id?: number }).id)),
                      )
                    }
                  >
                    Receive goods
                  </button>
                ) : null}
                {prices ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={pdf}>
                    PDF
                  </button>
                ) : null}
                {acts.cancel ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => setConfirm('cancel')}>
                    Cancel order
                  </button>
                ) : null}
                {acts.remove ? (
                  <button type="button" className={btnSmall + ' ml-auto text-danger'} disabled={busy} onClick={() => setConfirm('remove')}>
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </SidePanel>
      {confirm && o ? (
        <Sheet
          title={confirm === 'cancel' ? `Cancel ${o.po_number}?` : `Delete ${o.po_number}?`}
          width={440}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirm(null)}>
                Keep it
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => (confirm === 'cancel' ? void run('Order cancelled', () => orderAct(id, 'cancel')) : void run('Order removed', () => deleteOrder(id), onClose))}>
                {confirm === 'cancel' ? 'Cancel the order' : 'Delete'}
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">{confirm === 'cancel' ? 'Cancelling releases whatever this order had booked as incoming stock, and any receipt not yet posted goes with it.' : 'It is removed from the list.'}</span>
        </Sheet>
      ) : null}
    </>
  );
}

function Receipts({ org, warehouse, openId, onOpen }: { org: string; warehouse: number | null; openId: number | null; onOpen: (id: number) => void }) {
  const [status, setStatus] = useState('');
  const list = useInfiniteQuery({
    queryKey: KB.receipts(org, { status, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchReceipts(org, warehouse, { status, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const seesCost = rows.some((r) => r.total_value !== null);
  const W = { po: 100, vendor: 160, wh: 130, st: 80, when: 90, inv: 100, val: 96 };
  return (
    <>
      <div className="flex items-center gap-2">
        <Select
          aria-label="Receipt status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: '', label: 'Every state' },
            { value: 'draft', label: 'Draft' },
            { value: 'posted', label: 'Posted' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
          className={pick + ' !w-[160px]'}
        />
        <span className="ml-auto text-[12.5px] text-ink-3">{list.isLoading ? '' : `${total.toLocaleString()} ${total === 1 ? 'receipt' : 'receipts'}`}</span>
      </div>
      <Frame
        min={minWidth(110, [W.po, W.vendor, W.wh, W.st, W.when, W.inv, ...(seesCost ? [W.val] : [])])}
        head={
          <>
            <span className="min-w-0 flex-1">Receipt</span>
            <span style={{ width: W.po }}>Order</span>
            <span style={{ width: W.vendor }}>Vendor</span>
            <span style={{ width: W.wh }}>Warehouse</span>
            <span style={{ width: W.st }}>Status</span>
            <span style={{ width: W.when }}>Received</span>
            <span style={{ width: W.inv }}>Their invoice</span>
            {seesCost ? (
              <span className="text-right" style={{ width: W.val }}>
                Value
              </span>
            ) : null}
          </>
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((g) => (
            <button key={g.id} type="button" data-grn={g.id} onClick={() => onOpen(Number(g.id))} className={cx(rowCls, openId === Number(g.id) && 'bg-[#F4F6FE] dark:bg-selection/40')}>
              <b className="min-w-0 flex-1 truncate text-ink">{g.grn_number}</b>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.po }}>
                {g.po_number ?? '—'}
              </span>
              <span className="shrink-0 truncate text-ink" style={{ width: W.vendor }}>
                {g.vendor ?? '—'}
              </span>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.wh }}>
                {g.warehouse ?? '—'}
              </span>
              <span className="shrink-0" style={{ width: W.st }}>
                <Pill tone={g.status === 'posted' ? 'green' : g.status === 'draft' ? 'amber' : 'grey'}>{g.status}</Pill>
              </span>
              <span className="shrink-0 text-ink-3" style={{ width: W.when }}>
                {g.received_at ? stampWords(g.received_at) : '—'}
              </span>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.inv }}>
                {g.vendor_invoice_no ?? '—'}
              </span>
              {seesCost ? (
                <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.val }}>
                  {g.status === 'posted' ? whole(g.total_value) : '—'}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <Empty text={status ? 'No receipt matches.' : 'Nothing has been received yet. Receive goods from an approved order.'} />
        )}
      </Frame>
    </>
  );
}

function ReceiptPanel({ id, currency, onClose, onOrder }: { id: number; currency: string | null; onClose: () => void; onOrder: (id: number) => void }) {
  const q = useQuery({ queryKey: KB.receipt(id), queryFn: ({ signal }) => fetchReceipt(id, signal) });
  const d = q.data;
  if (!d) {
    return (
      <SidePanel label="Receipt" width={720} onClose={onClose} head={<b className="text-[15px] text-ink">Receipt</b>}>
        {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : <Spinner />}
      </SidePanel>
    );
  }
  // Keyed by status: once it posts, the editor starts again as a record.
  return <ReceiptEditor key={`${d.receipt.id}-${d.receipt.status}`} id={id} d={d} currency={currency} onClose={onClose} onOrder={onOrder} />;
}

function ReceiptEditor({ id, d, currency, onClose, onOrder }: { id: number; d: Awaited<ReturnType<typeof fetchReceipt>>; currency: string | null; onClose: () => void; onOrder: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const g = d.receipt;
  const draft = g.status === 'draft';
  const mayPost = can(perms, 'inventory.purchase');
  // What the draft says, to correct before posting.
  const [head, setHead] = useState(() => ({ invoice: g.vendor_invoice_no ?? '', delivery: g.delivery_note_no ?? '', charges: num(g.other_charges) ? String(num(g.other_charges)) : '', notes: g.notes ?? '' }));
  const [lines, setLines] = useState<Record<string, ReceiptLineDraft>>(() =>
    Object.fromEntries(
      d.lines.map((l) => [
        String(l.id),
        { accepted: String(num(l.quantity) ?? 0), rejected: num(l.rejected_qty) ? String(num(l.rejected_qty)) : '', reason: l.reject_reason ?? '', batch: l.batch_no ?? '', expiry: l.expiry_date ?? '', serials: l.serials ?? '' },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'post' | 'discard' | null>(null);
  const seesCost = d.lines.some((l) => l.unit_cost !== null);
  const setLine = (lid: string, patch: Partial<ReceiptLineDraft>) => setLines((x) => ({ ...x, [lid]: { ...x[lid]!, ...patch } }));

  const post = async () => {
    if (!d) return;
    setError(null);
    const { body, error: bad } = receiptBody(
      head,
      d.lines.map((l) => ({ line: l, d: lines[String(l.id)]! })),
    );
    if (bad) {
      setConfirm(null);
      return setError(bad);
    }
    setBusy(true);
    try {
      const r = await postReceipt(id, body);
      toast(r.over_received?.length ? 'warning' : 'success', r.over_received?.length ? `Receipt posted — the stock is in. More arrived than was ordered on ${r.over_received.join('; ')}.` : 'Receipt posted — the stock is in');
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const discard = async () => {
    setBusy(true);
    try {
      await cancelReceipt(id);
      toast('success', 'Receipt discarded');
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <>
      <SidePanel
        label={g ? `Receipt ${g.grn_number}` : 'Receipt'}
        width={720}
        onClose={onClose}
        head={
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <b className="truncate text-[15px] text-ink">{g?.grn_number ?? 'Receipt'}</b>
              {g ? <Pill tone={g.status === 'posted' ? 'green' : g.status === 'draft' ? 'amber' : 'grey'}>{g.status}</Pill> : null}
            </span>
            {g ? (
              <span className="truncate text-[12.5px] text-ink-3">
                {[g.vendor, g.warehouse].filter(Boolean).join(' · ')}
                {g.po_number && g.po_id ? (
                  <>
                    {' · against '}
                    <button type="button" className="text-primary hover:underline" onClick={() => onOrder(Number(g.po_id))}>
                      {g.po_number}
                    </button>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
        }
      >
        {g ? (
          <>
            {draft && mayPost ? (
              <div className="grid grid-cols-3 gap-2.5">
                <Field label="Their invoice">
                  <input className={input} value={head.invoice} onChange={(e) => setHead({ ...head, invoice: e.target.value })} aria-label="Their invoice" maxLength={60} />
                </Field>
                <Field label="Delivery note">
                  <input className={input} value={head.delivery} onChange={(e) => setHead({ ...head, delivery: e.target.value })} aria-label="Delivery note" maxLength={60} />
                </Field>
                <Field label="Freight and duty on this delivery" hint="Spread across the lines by value">
                  <input className={input + ' text-right tabular-nums'} value={head.charges} onChange={(e) => setHead({ ...head, charges: e.target.value })} aria-label="Freight and duty" inputMode="decimal" />
                </Field>
              </div>
            ) : (
              <span className="text-[12.5px] text-ink-2">
                {[
                  g.vendor_invoice_no ? `their invoice ${g.vendor_invoice_no}` : null,
                  g.delivery_note_no ? `delivery note ${g.delivery_note_no}` : null,
                  num(g.other_charges) ? `freight and duty ${cost(g.other_charges, currency)}` : null,
                  g.posted_at ? `posted ${stampWords(g.posted_at)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            )}
            <div className="overflow-hidden rounded-[10px] border border-line">
              <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Product</span>
                <span className="w-[76px] text-right">Accepted</span>
                <span className="w-[76px] text-right">Rejected</span>
                {draft ? <span className="w-[150px]">Why rejected</span> : null}
                {seesCost ? <span className="w-[80px] text-right">{draft ? 'Unit cost' : 'Landed'}</span> : null}
              </div>
              {d.lines.map((l) => (
                <ReceiptRow key={l.id} line={l} draft={draft && mayPost} d={lines[String(l.id)]} onChange={(p) => setLine(String(l.id), p)} seesCost={seesCost} />
              ))}
            </div>
            {draft ? <span className="text-[11.5px] text-ink-3">Landed cost is the unit price plus this line's share of the freight and duty. That is what opens the cost layer.</span> : null}
            {error ? (
              <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
                {error}
              </span>
            ) : null}
            {draft && mayPost ? (
              <div className="flex gap-2">
                <button type="button" className={btnPrimary + ' !h-[32px] !text-[12.5px]'} disabled={busy} onClick={() => setConfirm('post')}>
                  Post — put this stock on the shelf
                </button>
                <button type="button" className={btnSmall + ' ml-auto'} disabled={busy} onClick={() => setConfirm('discard')}>
                  Discard
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </SidePanel>
      {confirm && g ? (
        <Sheet
          title={confirm === 'post' ? `Post ${g.grn_number}?` : `Discard ${g.grn_number}?`}
          width={440}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirm(null)}>
                Back
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void (confirm === 'post' ? post() : discard())}>
                {confirm === 'post' ? 'Post' : 'Discard'}
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">
            {confirm === 'post'
              ? 'What was accepted goes onto the shelf now, at its landed cost, and the order counts it as received. A posted receipt cannot be undone — only written back out by an adjustment.'
              : 'Nothing has moved. The receipt is dropped, and the order still waits for these goods.'}
          </span>
        </Sheet>
      ) : null}
    </>
  );
}

function ReceiptRow({ line, draft, d, onChange, seesCost }: { line: ReceiptLine; draft: boolean; d: ReceiptLineDraft | undefined; onChange: (p: Partial<ReceiptLineDraft>) => void; seesCost: boolean }) {
  const code = line.code ?? String(line.product_id);
  return (
    <div data-grn-line={code} className="flex flex-col gap-1 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-ink">{line.product_name}</b>
          <span className="truncate text-[11px] text-ink-3">{[line.code, !draft && line.batch_no ? `B:${line.batch_no}` : null, line.tracking !== 'none' ? line.tracking : null].filter(Boolean).join(' · ')}</span>
        </span>
        {draft && d ? (
          <>
            <input className={input + ' !h-[28px] !w-[76px] text-right tabular-nums'} value={d.accepted} onChange={(e) => onChange({ accepted: e.target.value })} aria-label={`Accepted ${code}`} />
            <input className={input + ' !h-[28px] !w-[76px] text-right tabular-nums'} value={d.rejected} placeholder="0" onChange={(e) => onChange({ rejected: e.target.value })} aria-label={`Rejected ${code}`} />
            <span className="w-[150px]">
              {Number(d.rejected) > 0 ? (
                <Select aria-label={`Why ${code} was rejected`} value={d.reason || 'other'} onValueChange={(v) => onChange({ reason: v })} options={REJECT_REASONS} className={pick + ' !h-[28px] !text-[12px]'} />
              ) : (
                <span className="text-[11.5px] text-ink-3">Only if rejecting</span>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="w-[76px] text-right text-ink tabular-nums">{qty(line.quantity, line.unit)}</span>
            <span className={cx('w-[76px] text-right tabular-nums', num(line.rejected_qty) ? 'text-danger' : 'text-ink-3')}>{num(line.rejected_qty) ? qty(line.rejected_qty) : '—'}</span>
          </>
        )}
        {seesCost ? <span className="w-[80px] text-right text-ink-2 tabular-nums">{draft ? whole(line.unit_cost) : cost(line.landed_cost)}</span> : null}
      </div>
      {draft && d && line.tracking === 'batch' ? (
        <div className="flex items-center gap-2 pl-1 text-[12px] text-ink-3">
          Batch
          <input className={input + ' !h-[28px] !w-[150px]'} value={d.batch} onChange={(e) => onChange({ batch: e.target.value })} aria-label={`Batch ${code}`} />
          Expires
          <input type="date" className={input + ' !h-[28px] !w-[150px]'} value={d.expiry} onChange={(e) => onChange({ expiry: e.target.value })} aria-label={`Expiry ${code}`} />
        </div>
      ) : null}
      {draft && d && line.tracking === 'serial' ? (
        <label className="flex flex-col gap-1 pl-1 text-[12px] text-ink-3">
          Serial numbers, one per unit
          <textarea className={input + ' !h-[52px] py-1.5 font-mono'} value={d.serials} onChange={(e) => onChange({ serials: e.target.value })} aria-label={`Serials ${code}`} />
        </label>
      ) : null}
    </div>
  );
}

function Requests({ org, warehouse, onOrdered }: { org: string; warehouse: number | null; onOrdered: () => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: KB.requests(org, status), queryFn: ({ signal }) => fetchRequests(org, status, signal) });
  const [busy, setBusy] = useState(false);
  const rows = q.data ?? [];
  const mayBuy = can(perms, 'inventory.purchase');
  const mayApprove = can(perms, 'inventory.approve');
  const run = async (fn: () => Promise<unknown>, label: (r: unknown) => string, after?: () => void) => {
    setBusy(true);
    try {
      const r = await fn();
      toast('success', label(r));
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      after?.();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="flex items-center gap-2">
        <Select
          aria-label="Request status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: '', label: 'Every state' },
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'ordered', label: 'Ordered' },
          ]}
          className={pick + ' !w-[160px]'}
        />
        <span className="text-[12.5px] text-ink-3">What people have asked for</span>
        {mayBuy ? (
          <button
            type="button"
            className={btn + ' ml-auto'}
            disabled={busy}
            onClick={() =>
              void run(
                () => requestsFromReplenishment(org, warehouse),
                (r) => `${(r as { ids?: number[] }).ids?.length ?? 0} request(s) raised`,
              )
            }
          >
            Raise from what is below minimum
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto scroll-thin">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {!q.isLoading && !rows.length ? <Empty text={status ? 'No request matches.' : 'Nobody has asked for anything yet.'} /> : null}
        {rows.map((r) => (
          <section key={r.id} data-request={r.id} className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-3.5 py-3">
            <div className="flex items-center gap-2">
              <b className="text-ink">{r.reference}</b>
              <span className="text-[12.5px] text-ink-3">{r.warehouse ?? 'No warehouse'}</span>
              <PoChip status={r.status} />
              {r.source === 'reorder' ? <span className="text-[11.5px] text-ink-3">raised by the reorder rules</span> : null}
              <span className="ml-auto flex gap-1.5">
                {mayApprove && r.may_approve === false && (r.status === 'pending' || r.status === 'draft') ? (
                  <span className="self-center text-[12px] text-ink-3">You raised it, so someone else approves it</span>
                ) : null}
                {mayApprove && r.may_approve !== false && (r.status === 'pending' || r.status === 'draft') ? (
                  <button
                    type="button"
                    className={btnSmall}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => requestAct(Number(r.id), 'approve'),
                        () => 'Approved',
                      )
                    }
                  >
                    Approve
                  </button>
                ) : null}
                {mayBuy && r.status === 'approved' ? (
                  <button
                    type="button"
                    className={btnPrimary + ' !h-[30px] !text-[12.5px]'}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => requestAct(Number(r.id), 'order'),
                        (x) => `${(x as { ids?: number[] }).ids?.length ?? 0} draft order(s) created`,
                        onOrdered,
                      )
                    }
                  >
                    Turn into draft orders
                  </button>
                ) : null}
              </span>
            </div>
            {r.reason || r.needed_by ? (
              <span className="text-[12px] text-ink-2">{[r.reason, r.needed_by ? `needed by ${dateLabel(r.needed_by)}` : null, r.requested_by_name ? `asked by ${r.requested_by_name}` : null].filter(Boolean).join(' · ')}</span>
            ) : null}
            <div className="flex flex-col">
              {r.lines.map((l) => (
                <span key={l.id} className="flex gap-2 border-t border-line/60 py-1 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {l.name} <span className="text-ink-3">{l.code}</span>
                  </span>
                  <b className="w-[80px] text-right text-ink tabular-nums">{qty(l.quantity, l.unit)}</b>
                  <span className="w-[160px] truncate text-ink-2">{l.vendor ?? <span className="text-[#9A4A06] dark:text-warning">no vendor set</span>}</span>
                  <span className="w-[200px] truncate text-ink-3">{l.note ?? ''}</span>
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** The vendor for an order, searched on the server among active vendors. */
function VendorPick({ value, onChange }: { value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({ queryKey: KB.vendorSearch(needle), queryFn: ({ signal }) => searchVendors(needle, signal), staleTime: 30_000 });
  const found = res.data ?? [];
  const all = [...(value && !found.some((v) => v.id === value.id) ? [{ id: value.id, name: value.name, code: null, city: null }] : []), ...found];
  return (
    <Select<string>
      aria-label="Vendor"
      value={value ? String(value.id) : ''}
      placeholder="Choose a vendor"
      options={all.map((v) => ({ value: String(v.id), label: v.name, hint: [v.code, v.city].filter(Boolean).join(' · ') || undefined }))}
      onSearch={setQ}
      loading={res.isFetching && !found.length}
      empty={res.error ? errorMessage(res.error) : needle ? 'No active vendor matches.' : 'No vendors yet.'}
      onValueChange={(v) => {
        const hit = all.find((x) => String(x.id) === v);
        onChange(hit ? { id: hit.id, name: hit.name } : null);
      }}
      className={pick}
    />
  );
}

/** A new purchase order, or a change to a draft one (InvTradeSheet). */
export function OrderSheet({
  org,
  warehouses,
  id,
  defaultWarehouse,
  canCost,
  onClose,
  onSaved,
}: {
  org: string;
  warehouses: Warehouse[];
  id: number | null;
  defaultWarehouse?: number | null;
  canCost: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const existing = useQuery({ queryKey: KB.order(id ?? 0), queryFn: ({ signal }) => fetchOrder(id!, signal), enabled: !!id });
  if (id && existing.isLoading) {
    return (
      <Sheet title="Edit order" width={760} onClose={onClose} footer={null}>
        <Spinner />
      </Sheet>
    );
  }
  const d = existing.data;
  const initial: PODraft = d
    ? {
        vendor: { id: Number(d.order.vendor_id), name: d.order.vendor ?? '' },
        warehouse: Number(d.order.warehouse_id),
        expected: d.order.expected_date ?? '',
        reference: d.order.reference_no ?? '',
        freight: num(d.order.freight_cost) ? String(num(d.order.freight_cost)) : '',
        insurance: num(d.order.insurance_cost) ? String(num(d.order.insurance_cost)) : '',
        duty: num(d.order.duty_cost) ? String(num(d.order.duty_cost)) : '',
        notes: d.order.notes ?? '',
        lines: d.lines.map((l, i) => ({
          key: i,
          id: Number(l.id),
          product: l.product_id ? { id: Number(l.product_id), code: l.code, name: l.product_name ?? l.description } : null,
          qty: String(num(l.quantity) ?? ''),
          cost: l.unit_cost === null ? '' : String(num(l.unit_cost) ?? ''),
        })),
      }
    : { vendor: null, warehouse: defaultWarehouse ?? null, expected: '', reference: '', freight: '', insurance: '', duty: '', notes: '', lines: [{ key: 0, id: null, product: null, qty: '', cost: '' }] };
  return <OrderForm org={org} warehouses={warehouses} id={id} poNumber={d?.order.po_number ?? null} initial={initial} canCost={canCost} onClose={onClose} onSaved={onSaved} />;
}

function OrderForm({
  org,
  warehouses,
  id,
  poNumber,
  initial,
  canCost,
  onClose,
  onSaved,
}: {
  org: string;
  warehouses: Warehouse[];
  id: number | null;
  poNumber: string | null;
  initial: PODraft;
  canCost: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<PODraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const setLine = (key: number, patch: Partial<POLineDraft>) => setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const goods = d.lines.reduce((s, l) => s + (Number(l.qty.replace(/,/g, '')) || 0) * (Number(l.cost.replace(/,/g, '')) || 0), 0);
  const charges = [d.freight, d.insurance, d.duty].reduce((s, v) => s + (Number(v.replace(/,/g, '')) || 0), 0);

  const save = async () => {
    setError(null);
    const { body, error: bad } = orderBody(d, canCost);
    if (bad) return setError(bad);
    setSaving(true);
    try {
      const r = await saveOrder(org, id, body);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast('success', id ? 'Order saved' : 'Draft order created');
      onSaved(Number(r.order?.id ?? id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={id ? `Edit ${poNumber ?? 'order'}` : 'New purchase order'}
      width={780}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : id ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div role="form" aria-label={id ? 'Edit order' : 'New purchase order'} className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Vendor">
            <VendorPick value={d.vendor} onChange={(v) => setD({ ...d, vendor: v })} />
          </Field>
          <Field label="Deliver to">
            <WarehousePick warehouses={warehouses} value={d.warehouse} onChange={(w) => setD({ ...d, warehouse: w })} label="Deliver to" />
          </Field>
        </div>
        <div className="grid grid-cols-5 gap-2.5">
          <Field label="Expected" hint="What the vendor said">
            <input type="date" className={input} value={d.expected} onChange={(e) => setD({ ...d, expected: e.target.value })} aria-label="Expected" />
          </Field>
          <Field label="Our reference">
            <input className={input} value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} aria-label="Our reference" maxLength={60} />
          </Field>
          <Field label="Freight">
            <input className={input + ' text-right tabular-nums'} value={d.freight} onChange={(e) => setD({ ...d, freight: e.target.value })} aria-label="Freight" inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Insurance">
            <input className={input + ' text-right tabular-nums'} value={d.insurance} onChange={(e) => setD({ ...d, insurance: e.target.value })} aria-label="Insurance" inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Duty">
            <input className={input + ' text-right tabular-nums'} value={d.duty} onChange={(e) => setD({ ...d, duty: e.target.value })} aria-label="Duty" inputMode="decimal" placeholder="0.00" />
          </Field>
        </div>
        <b className="mt-1 text-[13px] text-ink">Products</b>
        <div className="flex flex-col gap-2">
          {d.lines.map((l, i) => (
            <div key={l.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <ProductPick
                  org={org}
                  warehouse={d.warehouse}
                  value={l.product ? { id: l.product.id, code: l.product.code, barcode: null, name: l.product.name, variant_label: l.product.variant_label ?? null, unit: null, tracking: 'none', is_stocked: 1, on_hand: 0, reserved: 0 } : null}
                  onChange={(p) => setLine(l.key, { product: p ? { id: p.id, code: p.code, name: p.name, variant_label: p.variant_label } : null })}
                  label={`Line ${i + 1} product`}
                />
              </span>
              <input className={input + ' !w-[80px] text-right tabular-nums'} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} placeholder="Qty" aria-label={`Line ${i + 1} quantity`} />
              {canCost ? <input className={input + ' !w-[110px] text-right tabular-nums'} value={l.cost} onChange={(e) => setLine(l.key, { cost: e.target.value })} placeholder="Catalogue" aria-label={`Line ${i + 1} unit cost`} /> : null}
              <button
                type="button"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => setD((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((y) => y.key !== l.key) : [{ key: l.key + 1, id: null, product: null, qty: '', cost: '' }] }))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="self-start text-[12.5px] font-semibold text-primary hover:underline"
            onClick={() => setD((x) => ({ ...x, lines: [...x.lines, { key: Math.max(...x.lines.map((y) => y.key)) + 1, id: null, product: null, qty: '', cost: '' }] }))}
          >
            + Add a line
          </button>
        </div>
        {canCost ? (
          <span className="text-[12.5px] text-ink-2">
            Goods {goods.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {charges ? ` · freight, insurance and duty ${charges.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''} — the server adds tax and works out the total. A blank unit cost takes the catalogue's.
          </span>
        ) : (
          <span className="text-[12.5px] text-ink-3">Unit costs come from the catalogue, and a line you change keeps its own. Only people who can see costs set them.</span>
        )}
        <Field label="Internal notes" hint="Never printed and never shown to the vendor">
          <input className={input} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} aria-label="Internal notes" />
        </Field>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}
