import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../../core/bridge';
import { dateLabel, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../../components/PageKit';
import { cost, num, qty, stampWords, whole } from '../inventory/api';
import { Pill } from '../../components/ListKit';
import { pick } from '../inventory/pickers';
import { closeOrder, fetchMatch, fetchOrderFull, fxOf, KP, landedShare, OFFLINE_WRITE, refreshPurchase, sendOrder, usePurchaseCan, usePurchaseOffline, type OrderFull } from './api';
import { approvalOf, currentStep, decide, refusalText } from './chain';
import { deleteOrder, fetchOrders, KB, orderAct, orderActions, PER, PO_LABEL, type PurchaseOrder } from './buying';
import { Chain, DecisionBar } from './parts';
import { PoChip } from './Purchasing';

/**
 * Purchase orders (S-03, S-05; the "Desktop Purchasing" design): a dense grid on the left, the order in a pane on the
 * right — its progress (received, billed, paid), the three-way match line by line with each line's landed cost, the
 * approval chain with Submit, Approve and Reject, the vendor's answer, and Send, Receive, PDF, Close, Edit. An order in
 * another currency shows the rate captured on it and what it comes to in the company's own (G-02); freight, insurance
 * and duty show as each unit's landed share (G-03).
 *
 * Keyboard-first: ↑↓ move through the grid (the pane follows), Enter opens the order full width, A approves my step,
 * R receives it, / filters.
 */
const STATUSES = [{ value: '', label: 'Every state' }, ...['draft', 'pending', 'approved', 'sent', 'acknowledged', 'partial', 'received', 'billed', 'closed', 'cancelled'].map((s) => ({ value: s, label: PO_LABEL[s] ?? s }))];

export default function Orders({
  org,
  currency,
  openId,
  initialStatus,
  onOpen,
  onNew,
  onEdit,
  onReceive,
  onReceipt,
  onBill,
  onReturn,
}: {
  org: string;
  currency: string | null;
  openId: number | null;
  initialStatus?: string | null;
  onOpen: (id: number | null) => void;
  onNew: (() => void) | null;
  onEdit: (id: number) => void;
  onReceive: (id: number) => void;
  onReceipt: (id: number) => void;
  onBill: (id: number) => void;
  onReturn: (id: number) => void;
}) {
  const [status, setStatus] = useState(initialStatus ?? '');
  const [late, setLate] = useState(false);
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  const [wide, setWide] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const keys = useRef<{ approve?: () => void; receive?: () => void }>({});
  const offline = usePurchaseOffline();
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const f = { status, q: needle, late };
  const list = useInfiniteQuery({
    queryKey: KB.orders(org, f),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchOrders(org, null, { ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const today = todayInZone();
  const isLate = (o: PurchaseOrder) => !!o.expected_date && o.expected_date < today && ['approved', 'sent', 'acknowledged', 'partial'].includes(o.status);
  const rows = useMemo(() => {
    const all = (list.data?.pages ?? []).flatMap((p) => p.rows);
    // A server that does not filter by lateness: the page is narrowed here.
    return late ? all.filter(isLate) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, late, today]);
  const total = list.data?.pages[0]?.total ?? 0;
  const synced = list.dataUpdatedAt ? new Date(list.dataUpdatedAt).toISOString() : null;
  const at = rows.findIndex((o) => Number(o.id) === openId);

  const onKey = (e: React.KeyboardEvent) => {
    // The grid's keys, not a field's, a button's or an open dialog's.
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.closest?.('button, select, a, [role="dialog"], [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) onOpen(Number(next.id));
      if (e.key === 'ArrowDown' && at >= rows.length - 3 && list.hasNextPage) void list.fetchNextPage();
    } else if (e.key === 'Enter' && openId) {
      e.preventDefault();
      setWide((w) => !w);
    } else if (e.key === 'Escape' && wide) setWide(false);
    else if (e.key.toLowerCase() === 'a' && keys.current.approve) {
      e.preventDefault();
      keys.current.approve();
    } else if (e.key.toLowerCase() === 'r' && keys.current.receive) {
      e.preventDefault();
      keys.current.receive();
    } else if (e.key === '/') {
      e.preventDefault();
      filterRef.current?.focus();
    }
  };
  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-po="${openId}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [openId]);

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKey}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <h1 className="m-0 mr-2 text-[17px] font-bold text-ink">Purchase orders</h1>
        <input ref={filterRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setQ(''), gridRef.current?.focus())} placeholder="Filter orders  /" aria-label="Filter orders" className={input + ' !h-[30px] !w-[200px] !text-[12.5px]'} />
        <button type="button" aria-pressed={status === 'pending'} onClick={() => setStatus(status === 'pending' ? '' : 'pending')} className={cx(btnSmall, status === 'pending' && '!border-primary !text-primary')}>
          Awaiting approval
        </button>
        <button type="button" aria-pressed={late} onClick={() => setLate(!late)} className={cx(btnSmall, late && '!border-danger !text-danger')}>
          Late
        </button>
        <Select aria-label="Order status" value={status} onValueChange={setStatus} options={STATUSES} className={pick + ' !h-[30px] !w-[160px] !text-[12.5px]'} />
        <span className="ml-auto text-[12px] text-ink-3" data-doc-count>
          {list.isLoading ? '' : `${total.toLocaleString()} ${total === 1 ? 'order' : 'orders'}`}
        </span>
        {onNew ? (
          <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={offline} title={offline ? OFFLINE_WRITE : 'New order'} onClick={onNew}>
            New order
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        {!wide ? (
          <section className={cx('flex min-h-0 flex-col border-r border-line bg-surface', openId ? 'w-[46%] min-w-[380px]' : 'flex-1')} aria-label="Orders">
            <div className="flex gap-2 border-b border-line bg-ground px-3.5 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="w-[110px]">Order</span>
              <span className="min-w-0 flex-1">Vendor</span>
              <span className="w-[120px]">Status</span>
              <span className="w-[100px] text-right">Total</span>
            </div>
            <div ref={gridRef} tabIndex={0} role="listbox" aria-label="Purchase orders" aria-activedescendant={openId ? `po-row-${openId}` : undefined} className="min-h-0 flex-1 overflow-y-auto outline-none scroll-thin focus-visible:ring-2 focus-visible:ring-primary/40">
              {list.isLoading ? (
                <Spinner />
              ) : list.error ? (
                <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
              ) : rows.length ? (
                rows.map((o) => {
                  const lateBy = isLate(o) ? Math.round((Date.parse(today) - Date.parse(o.expected_date!)) / 86_400_000) : 0;
                  return (
                    <div
                      key={o.id}
                      id={`po-row-${o.id}`}
                      role="option"
                      aria-selected={openId === Number(o.id)}
                      data-po={o.id}
                      onClick={() => onOpen(Number(o.id))}
                      onDoubleClick={() => setWide(true)}
                      className={cx('flex cursor-default items-center gap-2 border-b border-line/60 px-3.5 py-[7px] text-[12.5px]', openId === Number(o.id) ? 'bg-selection dark:bg-selection/50' : 'hover:bg-subtle/60')}
                    >
                      <b className="w-[110px] truncate text-ink">{o.po_number}</b>
                      <span className="min-w-0 flex-1 truncate text-ink">{o.vendor ?? '—'}</span>
                      <span className="w-[120px]">{lateBy > 0 ? <Pill tone="red">{lateBy} {lateBy === 1 ? 'day' : 'days'} late</Pill> : <PoChip status={o.status} />}</span>
                      <b className="w-[100px] text-right text-ink tabular-nums">{whole(o.total, o.currency && o.currency !== currency ? o.currency : null)}</b>
                    </div>
                  );
                })
              ) : (
                <Empty text={q || status || late ? 'No orders match that.' : 'No purchase orders yet.'} />
              )}
              {list.hasNextPage ? (
                <div className="flex justify-center py-2 text-[12px]">
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                    {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3 border-t border-line bg-ground px-3.5 py-1.5 text-[11.5px] text-ink-3" aria-label="Keyboard">
              <span>↑↓ move</span>
              <span>Enter open</span>
              <span>A approve</span>
              <span>R receive</span>
              <span className="ml-auto">{offline ? 'Offline · as last seen' : synced ? `Synced ${timeLabel(synced)} · offline-ready` : 'Offline-ready'}</span>
            </div>
          </section>
        ) : null}
        {openId ? (
          <OrderPane key={openId} id={openId} currency={currency} wide={wide} onWide={setWide} onClose={() => onOpen(null)} onEdit={() => onEdit(openId)} onReceive={() => onReceive(openId)} onReceipt={onReceipt} onBill={onBill} onReturn={onReturn} keysRef={keys} />
        ) : !wide ? (
          <div className="hidden flex-1 items-center justify-center text-[13px] text-ink-3 lg:flex">Choose an order — ↑↓ moves through them.</div>
        ) : null}
      </div>
    </div>
  );
}

function OrderPane({
  id,
  currency,
  wide,
  onWide,
  onClose,
  onEdit,
  onReceive,
  onReceipt,
  onBill,
  onReturn,
  keysRef,
}: {
  id: number;
  currency: string | null;
  wide: boolean;
  onWide: (w: boolean) => void;
  onClose: () => void;
  onEdit: () => void;
  onReceive: () => void;
  onReceipt: (id: number) => void;
  onBill: (id: number) => void;
  onReturn: (id: number) => void;
  keysRef: React.MutableRefObject<{ approve?: () => void; receive?: () => void }>;
}) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const q = useQuery({ queryKey: KB.order(id), queryFn: ({ signal }) => fetchOrderFull(id, signal) });
  const d = q.data as OrderFull | undefined;
  const m = useQuery({ queryKey: KP.match(id), queryFn: ({ signal }) => fetchMatch(id, signal), enabled: !!d && !d.match });
  const match = d?.match ?? m.data ?? null;
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'send' | 'close' | 'cancel' | 'remove' | null>(null);
  const o = d?.order;
  const a = approvalOf(d, c.approve);
  // The purchasing build sends `approval` (G-01: submit, approve, reject at /api/purchase); an older server only the list.
  const modern = d?.approval !== undefined;
  const received = d ? d.lines.reduce((s, l) => s + (num(l.received_qty) ?? 0), 0) : 0;
  const ordered = d ? d.lines.reduce((s, l) => s + (num(l.quantity) ?? 0), 0) : 0;
  const acts = o ? orderActions(o, received, { purchase: c.order, approve: c.approve, mayApprove: d?.may_approve, receive: c.receive }) : null;
  // A chain from the purchasing build decides who receives: an order still waiting on approval is not received.
  const mayReceive = !!acts?.receive && a.status !== 'pending' && !offline;
  const step = currentStep(a)?.step ?? null;
  const fx = o ? fxOf(o, currency) : null;
  const cur = o?.currency ?? currency;
  const prices = !!o && num(o.total) !== null;
  const charges = o ? (num(o.freight_cost) ?? 0) + (num(o.insurance_cost) ?? 0) + (num(o.duty_cost) ?? 0) + (num(o.other_charges) ?? 0) : 0;

  const run = async (label: string, fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      if (label) toast('success', label);
      after?.(r);
    } catch (e) {
      toast('error', refusalText(e));
    } finally {
      setBusy(false);
      setDialog(null);
      refreshPurchase(qc);
    }
  };
  // The grid's A and R act on this order.
  useEffect(() => {
    const decideOk = c.approve && a.status === 'pending' && a.canApprove && !offline;
    keysRef.current = {
      approve: modern ? (decideOk ? () => void run('Approved', () => decide('order', id, 'approve', { step })) : undefined) : acts?.approve && !offline ? () => void run('Order approved', () => orderAct(id, 'approve')) : undefined,
      receive: mayReceive ? onReceive : undefined,
    };
    return () => {
      keysRef.current = {};
    };
  });
  const pdf = () =>
    void run('', async () => {
      const f = (await orderAct(id, 'pdf')) as { file_id?: number; name?: string };
      if (f.file_id) await call('transfers:download', { fileId: String(f.file_id), name: f.name || `${o?.po_number ?? 'order'}.pdf`, open: true });
    });
  const pctRec = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-ground scroll-thin" aria-label={o ? `Order ${o.po_number}` : 'Order'}>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : o && d ? (
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <b className="truncate text-[17px] text-ink">{o.po_number}</b>
                <PoChip status={o.status} />
              </span>
              <span className="truncate text-[12.5px] text-ink-2">
                {[o.vendor, fx ? `${fx.currency} @ ${fx.rate.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : o.currency, o.warehouse, o.expected_date ? `expected ${dateLabel(o.expected_date)}` : null].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {prices ? (
                <button type="button" className={btnSmall} disabled={busy} onClick={pdf}>
                  PDF
                </button>
              ) : null}
              {acts?.receive ? (
                <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={!mayReceive} title={offline ? OFFLINE_WRITE : a.status === 'pending' ? 'Waiting on approval' : 'Receive by scan (R)'} onClick={onReceive}>
                  Receive
                </button>
              ) : null}
              {acts?.send ? (
                <button type="button" className={btnSmall} disabled={busy || offline} title={offline ? OFFLINE_WRITE : 'E-mail it to the vendor with its PDF and a portal link'} onClick={() => setDialog('send')}>
                  {o.status === 'sent' || o.status === 'acknowledged' ? 'Send again' : 'Send'}
                </button>
              ) : null}
              {acts?.edit ? (
                <button type="button" className={btnSmall} disabled={busy || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={onEdit}>
                  Edit
                </button>
              ) : null}
              {acts?.close ? (
                <button type="button" className={btnSmall} disabled={busy || offline} title={offline ? OFFLINE_WRITE : 'Short-close: nothing more is expected'} onClick={() => setDialog('close')}>
                  Close
                </button>
              ) : null}
              <button type="button" className={btnSmall} onClick={() => onWide(!wide)} title={wide ? 'Back to the grid (Esc)' : 'Full width (Enter)'}>
                {wide ? 'Grid' : 'Expand'}
              </button>
              <button type="button" className={btnSmall} aria-label="Close the order" onClick={onClose}>
                ×
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <Progress label="Received" value={`${pctRec}%`} pct={pctRec} />
            <Progress label="Billed" value={num(o.billed_total) !== null ? whole(o.billed_total, cur) : '—'} pct={num(o.total) ? Math.min(100, ((num(o.billed_total) ?? 0) / num(o.total)!) * 100) : 0} />
            <Progress label="Paid" value={num(o.paid_total) !== null ? whole(o.paid_total, cur) : '—'} pct={num(o.total) ? Math.min(100, ((num(o.paid_total) ?? 0) / num(o.total)!) * 100) : 0} />
          </div>
          {fx ? (
            <span className="text-[12.5px] text-ink-2">
              {cost(o.total, fx.currency)} at {fx.rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} is <b className="text-ink">{cost(fx.baseTotal, fx.base)}</b> — stock is valued in {fx.base} at the rate on each receipt.
            </span>
          ) : null}

          <Block title="Three-way match">
            <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
              <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Item</span>
                <span className="w-[52px] text-right">Ord</span>
                <span className="w-[52px] text-right">Rec</span>
                <span className="w-[52px] text-right">Bill</span>
                {prices ? <span className="w-[86px] text-right">Landed</span> : null}
              </div>
              {(match?.rows ?? []).map((r) => {
                const share = landedShare(r);
                return (
                  <div key={r.line_id} className="flex flex-col border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0" data-match-line={r.line_id}>
                    <div className="flex items-center gap-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <b className="truncate text-ink">{r.description}</b>
                        {r.code ? <span className="truncate text-[11px] text-ink-3">{r.code}</span> : null}
                      </span>
                      <span className="w-[52px] text-right text-ink tabular-nums">{qty(r.ordered)}</span>
                      <span className={cx('w-[52px] text-right tabular-nums', r.received >= r.ordered ? 'text-success-ink dark:text-success' : r.received > 0 ? 'text-warning-ink dark:text-warning' : 'text-ink-3')}>{qty(r.received)}</span>
                      <span className={cx('w-[52px] text-right tabular-nums', r.billed > r.received ? 'font-bold text-danger' : 'text-ink-2')}>{qty(r.billed)}</span>
                      {prices ? (
                        <span className="w-[86px] text-right text-ink-2 tabular-nums" title={share ? `${whole(r.unit_cost)} + ${whole(share)} freight, insurance and duty` : undefined}>
                          {r.landed_unit_cost !== null ? whole(r.landed_unit_cost) : '—'}
                        </span>
                      ) : null}
                    </div>
                    {r.issues.length ? <span className="text-[11.5px] font-semibold text-danger">{r.issues.join(' · ')}</span> : null}
                  </div>
                );
              })}
              {!match ? <div className="px-3 py-2 text-[12px] text-ink-3">{m.isLoading ? 'Matching…' : 'No match yet.'}</div> : null}
            </div>
            {match?.matched ? <span className="text-[12px] font-semibold text-success-ink dark:text-success">Ordered, received and billed agree.</span> : null}
            {charges > 0 && prices ? <span className="text-[12px] text-ink-2">Freight, insurance and duty {cost(charges, cur)}, spread over the lines by value: each receipt brings its share into the cost of the stock.</span> : null}
          </Block>

          <Block title="Approvals">
            <Chain a={a} />
            {modern ? <DecisionBar doc="order" id={id} a={a} status={o.status} raise={c.order} approve={c.approve} offline={offline} /> : null}
            {/* A server before the purchasing build: Approve is the order's own call (it decides the step), for whoever may. */}
            {!modern && acts?.approve ? (
              <button type="button" className={btnSmall + ' self-start'} disabled={busy || offline} title={offline ? OFFLINE_WRITE : 'Approve (A)'} onClick={() => void run('Order approved', () => orderAct(id, 'approve'))}>
                Approve
              </button>
            ) : null}
            {!modern && acts?.waiting ? <span className="text-[12.5px] text-ink-3">You raised this order, so someone else approves it.</span> : null}
          </Block>

          {d.duplicates?.length ? (
            <Block title="Possible duplicates">
              {d.duplicates.map((x) => (
                <span key={x.id} className="text-[12.5px] text-ink-2">
                  <b className="text-ink">{x.number}</b> · {[x.vendor, x.date ? dateLabel(x.date) : null, whole(x.total)].filter(Boolean).join(' · ')}
                </span>
              ))}
            </Block>
          ) : null}

          <Block title="Vendor">
            <span className="text-[12.5px] text-ink-2">
              {o.vendor_response === 'accepted'
                ? `Accepted${o.vendor_promised_date ? ` · promised ${dateLabel(o.vendor_promised_date)}` : ''}`
                : o.vendor_response === 'declined'
                  ? 'Declined'
                  : o.status === 'sent'
                    ? 'Sent · no answer yet'
                    : 'Not sent yet'}
              {d.portal.issued && d.portal.expires ? ` · link expires ${dateLabel(d.portal.expires.slice(0, 10))}` : ''}
            </span>
            {(o as { closed_reason?: string | null }).closed_reason ? <span className="text-[12.5px] text-ink-2">Closed short: {(o as { closed_reason?: string | null }).closed_reason}</span> : null}
          </Block>

          {d.receipts.length || d.bills?.length || d.returns?.length ? (
            <Block title="Receipts, bills and returns">
              {d.receipts.map((g) => (
                <button key={`g${g.id}`} type="button" onClick={() => onReceipt(Number(g.id))} className="flex items-center gap-2 border-b border-line/60 py-1 text-left text-[12.5px] hover:bg-subtle">
                  <b className="text-primary">{g.grn_number}</b>
                  <Pill tone={g.status === 'posted' ? 'green' : g.status === 'draft' ? 'amber' : 'grey'}>{g.status}</Pill>
                  <span className="flex-1 text-ink-3">{g.posted_at ? stampWords(g.posted_at) : g.received_at ? stampWords(g.received_at) : ''}</span>
                </button>
              ))}
              {(d.bills ?? []).map((b) => (
                <button key={`b${b.id}`} type="button" onClick={() => onBill(b.id)} className="flex items-center gap-2 border-b border-line/60 py-1 text-left text-[12.5px] hover:bg-subtle">
                  <b className="text-primary">{b.bill_number}</b>
                  <Pill tone={b.status === 'paid' ? 'green' : b.status === 'disputed' ? 'red' : 'blue'}>{b.status}</Pill>
                  <span className="flex-1 text-ink-3">{b.vendor_invoice_no ?? ''}</span>
                  <span className="text-ink-2 tabular-nums">{whole(b.total, cur)}</span>
                </button>
              ))}
              {(d.returns ?? []).map((r) => (
                <button key={`r${r.id}`} type="button" onClick={() => onReturn(r.id)} className="flex items-center gap-2 border-b border-line/60 py-1 text-left text-[12.5px] hover:bg-subtle">
                  <b className="text-primary">{r.reference}</b>
                  <Pill tone="grey">{r.status}</Pill>
                </button>
              ))}
            </Block>
          ) : null}

          {acts?.cancel || acts?.remove ? (
            <div className="flex gap-2 border-t border-line pt-3">
              {acts.cancel ? (
                <button type="button" className={btnSmall} disabled={busy || offline} onClick={() => setDialog('cancel')}>
                  Cancel order
                </button>
              ) : null}
              {acts.remove ? (
                <button type="button" className={btnSmall + ' ml-auto text-danger'} disabled={busy || offline} onClick={() => setDialog('remove')}>
                  Delete
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {dialog === 'send' && o ? <SendSheet number={o.po_number} busy={busy} onClose={() => setDialog(null)} onSend={(body) => void run('Sent to the vendor', () => sendOrder(id, body))} /> : null}
      {dialog === 'close' && o ? <CloseSheet number={o.po_number} busy={busy} onClose={() => setDialog(null)} onConfirm={(reason) => void run('Order closed short — incoming stock released', () => closeOrder(id, reason))} /> : null}
      {(dialog === 'cancel' || dialog === 'remove') && o ? (
        <Sheet
          title={dialog === 'cancel' ? `Cancel ${o.po_number}?` : `Delete ${o.po_number}?`}
          width={440}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setDialog(null)}>
                Keep it
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => (dialog === 'cancel' ? void run('Order cancelled', () => orderAct(id, 'cancel')) : void run('Order removed', () => deleteOrder(id), onClose))}>
                {dialog === 'cancel' ? 'Cancel the order' : 'Delete'}
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">{dialog === 'cancel' ? 'Cancelling releases whatever this order had booked as incoming stock, and any receipt not yet posted goes with it.' : 'It is removed from the list.'}</span>
        </Sheet>
      ) : null}
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <b className="text-[13px] text-ink">{title}</b>
      {children}
    </section>
  );
}

function Progress({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface px-3 py-2">
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      <b className="text-[15px] text-ink tabular-nums">{value}</b>
      <span className="h-1.5 rounded-full bg-subtle">
        <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
    </div>
  );
}

const emails = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Send to the vendor (G-05): to and cc, a message, the PDF, the portal link. Blank "to" goes to the vendor's purchasing contact. */
type SendBody = Parameters<typeof sendOrder>[1];

function SendSheet({ number, busy, onClose, onSend }: { number: string; busy: boolean; onClose: () => void; onSend: (body: SendBody) => void }) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [message, setMessage] = useState('');
  const [pdf, setPdf] = useState(true);
  const [portal, setPortal] = useState(true);
  const [subject, setSubject] = useState('');
  const [wa, setWa] = useState(false);
  const [waTo, setWaTo] = useState('');
  const [markSent, setMarkSent] = useState(false);
  const bad = [...emails(to), ...emails(cc)].find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return (
    <Sheet
      title={`Send ${number}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !!bad} onClick={() => onSend({ to: emails(to), cc: emails(cc), ...(subject.trim() ? { subject: subject.trim() } : {}), message: message.trim(), attach_pdf: pdf, portal_link: portal, ...(wa ? { whatsapp: true, ...(waTo.trim() ? { whatsapp_to: waTo.trim() } : {}) } : {}), ...(markSent ? { mark_sent: true } : {}) })}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="To" hint="Blank: the vendor's purchasing contact">
          <input className={input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" placeholder="orders@vendor.com" />
        </Field>
        <Field label="Cc">
          <input className={input} value={cc} onChange={(e) => setCc(e.target.value)} aria-label="Cc" />
        </Field>
        <Field label="Subject" hint="Blank: the order's number">
          <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" maxLength={200} />
        </Field>
        <Field label="Message">
          <textarea className={input + ' !h-[90px] py-1.5'} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Message" maxLength={4000} />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <Checkbox checked={pdf} onChange={(e) => setPdf(e.target.checked)} /> Attach the PDF
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <Checkbox checked={portal} onChange={(e) => setPortal(e.target.checked)} /> Include a link where they accept, decline or give a date
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <Checkbox checked={wa} onChange={(e) => setWa(e.target.checked)} /> Send on WhatsApp too, where WorkSuite has it
        </label>
        {wa ? <input className={input} value={waTo} onChange={(e) => setWaTo(e.target.value)} aria-label="WhatsApp number" placeholder="Blank: the vendor's mobile" /> : null}
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <Checkbox checked={markSent} onChange={(e) => setMarkSent(e.target.checked)} /> Mark it sent even if nothing is delivered (it went another way)
        </label>
        {bad ? <span className="text-[12px] font-semibold text-danger">“{bad}” is not an e-mail address.</span> : null}
        <span className="text-[12px] text-ink-3">Sending marks the order sent. An order still waiting on approval cannot be sent.</span>
      </div>
    </Sheet>
  );
}

/** Close short (G-06): nothing more is expected; incoming stock is released. */
function CloseSheet({ number, busy, onClose, onConfirm }: { number: string; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Sheet
      title={`Close ${number} short?`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Keep it open
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !reason.trim()} onClick={() => onConfirm(reason)}>
            Close the order
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <span className="text-[13px] text-ink-2">What has arrived stays; what has not is no longer expected, and its incoming stock is released. Bills already entered are unaffected.</span>
        <Field label="Why">
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why it is closed" maxLength={300} autoFocus />
        </Field>
      </div>
    </Sheet>
  );
}

