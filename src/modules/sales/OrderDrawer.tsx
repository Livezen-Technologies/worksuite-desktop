import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { openWebLink, useTab } from '../../core/tab-context';
import { dateLabel, relative, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Caps, Empty, Field, Grid, input, Seg, Sheet, SidePanel } from '../../components/PageKit';
import { addComment, approve, assign, assignees, cancel, commentText, confirm, deleteComment, duplicateOrder, editComment, fetchComments, fetchOrder, fetchTimeline, K, KV, mayInvoice, mention, movesFor, paymentLink, raiseInvoice, reject, retryIntegration, submit, transition, type Comment, type Move, type OrderDetail } from './api';
import { OFFLINE_WRITE, offlineLine, useSalesOffline } from './offline';
import { printNote } from './print';
import { moneyFull, PaymentPill, PriorityPill, StatusPill } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * One order (OmsOrderDrawer + OmsOrderSheet, D-03): the facts, the money and the
 * payment, then its lines (ordered / reserved / delivered / invoiced), the
 * approval steps, the comments, the timeline and what it produced (deliveries,
 * invoices). The buttons are what this person may do next: submit, approve or
 * reject, confirm (Inventory reserves the stock), move on, cancel with a reason
 * (Inventory releases it), assign, re-order, a payment link, and share — email,
 * WhatsApp, a chat, a link, the PDF. A failed hand-off can be tried again. It
 * opens in a tab or its own window (FR-DSK-04), and a delivery note prints on
 * this computer's delivery-note printer (FR-DSK-06).
 *
 * Offline it is this computer's copy as last seen (FR-DSK-07): every button that
 * changes the order waits for the connection.
 */
type Tab = 'overview' | 'items' | 'approval' | 'comments' | 'activity' | 'linked';
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));

export default function OrderDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [tab, setTab] = useState<Tab>('overview');
  const [asking, setAsking] = useState<null | 'reject' | 'cancel' | 'approve' | 'reorder' | 'paylink'>(null);
  const { openInNewTab, openInWindow } = useTab();
  const [sharing, setSharing] = useState<null | 'email' | 'whatsapp' | 'chat' | 'link'>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: K.order(id), queryFn: ({ signal }) => fetchOrder(id, signal) });
  const o = q.data;
  const offline = useSalesOffline(o?.offline);
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const move = (m: Move) => {
    if (!o) return;
    if (m.status === 'cancelled') return setAsking('cancel');
    if (m.via === 'inventory-confirm') {
      setBusy(true);
      void confirm(o.id)
        .then((r) => {
          refresh();
          if (r.short?.length) toast('warning', `Confirmed. Not enough stock to reserve everything: ${r.short.join(', ')}.`);
          else toast('success', `${o.number} confirmed — the stock is reserved.`);
        }, (e) => toast('error', errorMessage(e)))
        .finally(() => setBusy(false));
      return;
    }
    void run(() => transition(o.id, m.status), `${o.number} is ${m.label.toLowerCase()} now.`);
  };

  if (q.isLoading) return <SidePanel label="Order" width={620} onClose={onClose} head={<b className="text-ink">Loading…</b>}><Spinner /></SidePanel>;
  if (q.error || !o) return <SidePanel label="Order" width={620} onClose={onClose} head={<b className="text-ink">Order</b>}><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></SidePanel>;

  const moves = offline ? [] : movesFor(o);
  const pending = o.status === 'pending_approval' && !offline;
  const canSubmit = o.status === 'draft' && has(perms, 'oms.orders.edit') && !offline;
  const here = `/sales?tab=orders&order=${o.id}`;
  const pdf = () => void call('transfers:download', { orderPdf: o.id, name: `${o.number}.pdf`, open: true }).then(() => toast('success', 'Downloading the PDF — see Transfers.'), (e) => toast('error', errorMessage(e)));
  const copy = () =>
    void apiGet<{ text: string }>(`/api/share/oms/${o.id}/copy`).then(
      (r) => navigator.clipboard.writeText(r.text).then(() => toast('success', 'Order details copied.')),
      (e) => toast('error', errorMessage(e)),
    );

  return (
    <SidePanel
      label={`Order ${o.number}`}
      width={640}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-[16px] text-ink">{o.number}</b>
          <span className="truncate text-[12.5px] text-ink-3">{o.client ?? 'No customer'}</span>
        </span>
      }
    >
      {offline ? (
        <p className="m-0 flex items-center gap-2 rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning" role="status">
          <Icon name="cloud-off" size={14} /> {offlineLine(o.cachedAt)} · read only.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5" data-order-head>
        {o.overdue ? <span className="inline-flex h-[22px] items-center rounded-[11px] bg-danger-bg px-2 text-[11.5px] font-bold text-danger">Overdue</span> : null}
        <StatusPill status={o.status} label={o.status_label} />
        <PriorityPill priority={o.priority} />
        <PaymentPill status={o.payment_status} />
        <span className="flex-1" />
        <b className="text-[16px] text-ink tabular-nums">{moneyFull(o.total, o.currency)}</b>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" data-order-actions>
        {pending && o.approval.mine ? (
          <>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => setAsking('approve')}>
              Approve
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => setAsking('reject')}>
              Reject
            </button>
          </>
        ) : null}
        {canSubmit ? (
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void submit(o.id)
                .then(
                  (r) => (refresh(), toast('success', r.status === 'approved' ? `${o.number} approved — no approval rule applies to it.` : `${o.number} sent for approval.`)),
                  (e) => toast('error', errorMessage(e)),
                )
                .finally(() => setBusy(false));
            }}
          >
            Submit for approval
          </button>
        ) : null}
        {moves.map((m) => (
          <button
            key={m.status}
            type="button"
            className={m.status === 'cancelled' ? btn + ' !text-danger' : m.via === 'inventory-confirm' ? btnPrimary : btn}
            disabled={busy || !!m.disabled}
            onClick={() => move(m)}
            title={m.disabled ?? (m.via === 'inventory-confirm' ? 'Reserves the stock in Inventory' : m.status === 'cancelled' ? 'Releases any reserved stock' : undefined)}
          >
            {m.via === 'inventory-confirm' ? 'Confirm' : m.status === 'cancelled' ? 'Cancel order' : m.label}
          </button>
        ))}
        {!offline && mayInvoice(o, perms) ? (
          <button type="button" className={btn} disabled={busy} onClick={() => void run(() => raiseInvoice(o.id), `A draft invoice for ${o.number} is in Billing — see Linked.`)} title="A draft invoice for what was delivered and not yet invoiced">
            Raise invoice
          </button>
        ) : null}
        <span className="flex-1" />
        <button type="button" className={btnSmall} onClick={() => openInNewTab(here, o.number)} title="Open in a new tab" aria-label="Open in a new tab">
          <Icon name="external" size={14} />
        </button>
        <button type="button" className={btnSmall} onClick={() => openInWindow(here, o.number)} title="Open in its own window" aria-label="Open in its own window">
          <Icon name="app-window" size={14} />
        </button>
        <button type="button" className={btnSmall} onClick={copy} title="Copy the order’s details">
          <Icon name="copy" size={14} />
        </button>
        <button type="button" className={btnSmall} onClick={pdf} title="Download the PDF">
          PDF
        </button>
        <span className="relative">
          <button type="button" className={btnSmall} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            Share <Icon name="chevron-down" size={13} />
          </button>
          {menu ? (
            <div role="menu" aria-label="Share" className="absolute top-8 right-0 z-30 w-[180px] rounded-[10px] border border-line bg-surface p-1 shadow-[0_12px_30px_rgb(var(--ws-shadow-rgb)/.2)]" onMouseLeave={() => setMenu(false)}>
              {(
                [
                  ['email', 'Email', 'mail'],
                  ['whatsapp', 'WhatsApp', 'phone'],
                  ['chat', 'Chat', 'chat'],
                  ['link', 'Shareable link', 'link'],
                ] as const
              ).map(([k, label, icon]) => (
                <button key={k} type="button" role="menuitem" disabled={offline} onClick={() => (setMenu(false), setSharing(k))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
                  <Icon name={icon} size={14} className="text-ink-3" />
                  {label}
                </button>
              ))}
              <div className="my-1 border-t border-line" />
              {has(perms, 'oms.orders.edit') || has(perms, 'billing.invoice') ? (
                <button type="button" role="menuitem" disabled={offline || o.payment_status === 'paid'} onClick={() => (setMenu(false), setAsking('paylink'))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
                  <Icon name="credit-card" size={14} className="text-ink-3" />
                  Payment link
                </button>
              ) : null}
              {has(perms, 'inventory.sell') ? (
                <button type="button" role="menuitem" disabled={offline} onClick={() => (setMenu(false), setAsking('reorder'))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">
                  <Icon name="repeat" size={14} className="text-ink-3" />
                  Re-order
                </button>
              ) : null}
            </div>
          ) : null}
        </span>
      </div>

      <Seg
        label="Order"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'overview', label: 'Overview' },
          { id: 'items', label: `Items · ${o.lines.length}` },
          { id: 'approval', label: `Approval${o.approval.steps.length ? ` · ${o.approval.steps.length}` : ''}` },
          { id: 'comments', label: 'Comments' },
          { id: 'activity', label: 'Activity' },
          { id: 'linked', label: 'Linked' },
        ]}
      />
      {tab === 'overview' ? <Overview o={o} canAssign={has(perms, 'oms.orders.assign') && !offline} canRetry={!offline && (has(perms, 'oms.orders.edit') || has(perms, 'oms.settings'))} onAssigned={refresh} /> : null}
      {tab === 'items' ? <Items o={o} /> : null}
      {tab === 'approval' ? <Approval o={o} /> : null}
      {tab === 'comments' ? <Comments id={o.id} offline={offline} /> : null}
      {tab === 'activity' ? <Activity id={o.id} /> : null}
      {tab === 'linked' ? <Linked o={o} offline={offline} /> : null}

      {asking === 'approve' ? <ReasonSheet title={`Approve ${o.number}?`} label="A note, if you like" optional busy={busy} onClose={() => setAsking(null)} onOk={(r) => void run(() => approve(o.id, r || undefined), `${o.number}: your step is approved.`).then((ok) => ok && setAsking(null))} okLabel="Approve" /> : null}
      {asking === 'reject' ? <ReasonSheet title={`Reject ${o.number}`} label="Why is it rejected? The person who raised it has to know what to change." busy={busy} onClose={() => setAsking(null)} onOk={(r) => void run(() => reject(o.id, r), `${o.number} rejected.`).then((ok) => ok && setAsking(null))} okLabel="Reject" danger /> : null}
      {asking === 'cancel' ? (
        <ReasonSheet
          title={`Cancel ${o.number}?`}
          label="Why is it cancelled? The reason is kept on the order’s timeline."
          note="Cancelling releases any reserved stock. An invoice or payment already made is a separate document in Billing and Finance and is not undone here. An order with anything delivered cannot be cancelled."
          busy={busy}
          onClose={() => setAsking(null)}
          onOk={(r) => void run(() => (moves.find((m) => m.status === 'cancelled')?.via === 'transition' ? transition(o.id, 'cancelled', r) : cancel(o.id, r)), `${o.number} cancelled — reserved stock released.`).then((ok) => ok && setAsking(null))}
          okLabel="Cancel order"
          cancelLabel="Keep it"
          danger
        />
      ) : null}
      {asking === 'reorder' ? (
        <Sheet
          title={`Re-order ${o.number}?`}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      const r = await duplicateOrder(o.id);
                      refresh();
                      toast('success', `A new draft from ${o.number} is ready.`, { label: 'Open it', run: () => openInNewTab(`/sales?tab=orders&order=${r.id}`) });
                      setAsking(null);
                    } catch (e) {
                      toast('error', errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                Make the draft
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] leading-[1.5] text-ink-2">A new draft order for {o.client ?? 'the same customer'} with the same lines, made in Inventory at today’s prices. Nothing is reserved until it is confirmed.</p>
        </Sheet>
      ) : null}
      {asking === 'paylink' ? <PaymentLinkSheet o={o} onClose={() => setAsking(null)} /> : null}
      {sharing ? <ShareSheet o={o} how={sharing} onClose={() => setSharing(null)} /> : null}
    </SidePanel>
  );
}

function Overview({ o, canAssign, canRetry, onAssigned }: { o: OrderDetail; canAssign: boolean; canRetry: boolean; onAssigned: () => void }) {
  const [retrying, setRetrying] = useState<number | null>(null);
  const retry = (integrationId: number) => {
    setRetrying(integrationId);
    void retryIntegration(o.id, integrationId)
      .then(
        () => (onAssigned(), toast('success', 'Tried again — see Hand-offs.')),
        (e) => toast('error', errorMessage(e)),
      )
      .finally(() => setRetrying(null));
  };
  const people = useQuery({ queryKey: ['sales', 'assignees'], queryFn: assignees, enabled: canAssign, staleTime: 300_000 });
  const d = (v: string | null | undefined) => (v ? dateLabel(v) : '—');
  const cur = o.currency;
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <Caps>Order</Caps>
        <Grid
          rows={[
            ['Ordered', d(o.order_date)],
            ['Expected', d(o.expected_date)],
            ['Type', o.order_type ?? 'Standard'],
            ['Sales', o.sales_user ?? '—'],
            ['Approved', d(o.approved_at)],
            ['Confirmed', d(o.confirmed_at)],
            ['Completed', d(o.completed_at)],
            ['Ship to', o.ship_to ?? '—'],
          ]}
        />
      </div>
      <div className="flex items-center gap-2 text-[13px]">
        <span className="w-[110px] shrink-0 text-ink-3">Assigned to</span>
        {canAssign ? (
          <Select
            aria-label="Assigned to"
            searchable
            value={o.assigned_to ?? ''}
            onChange={(e) =>
              e.target.value &&
              void assign(o.id, Number(e.target.value)).then(
                () => (onAssigned(), toast('success', 'Assigned.')),
                (err) => toast('error', errorMessage(err)),
              )
            }
            className={input + ' !w-[260px]'}
          >
            {!o.assigned_to ? <option value="">Nobody yet</option> : null}
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {o.assigned_to && !(people.data ?? []).some((p) => p.id === o.assigned_to) ? <option value={o.assigned_to}>{o.assigned_name}</option> : null}
          </Select>
        ) : (
          <b className="text-ink">{o.assigned_name ?? 'Nobody'}</b>
        )}
      </div>
      <div>
        <Caps>Money</Caps>
        <div className="flex flex-col rounded-[10px] border border-line text-[13px]">
          <Money k="Lines, after their discounts" v={moneyFull(o.subtotal, cur)} />
          {o.discount_total ? <Money k="Line discounts given" v={moneyFull(o.discount_total, cur)} note="already in the lines" /> : null}
          {o.coupons?.length ? o.coupons.map((c) => <Money key={c.code} k={`Coupon ${c.code}`} v={`− ${moneyFull(c.discount, cur)}`} tone="text-danger" />) : o.coupon_code ? <Money k={`Coupon ${o.coupon_code}`} v={`− ${moneyFull(o.coupon_discount, cur)}`} tone="text-danger" /> : null}
          <Money k="Tax" v={moneyFull(o.tax_total, cur)} />
          <Money k="Shipping" v={moneyFull(o.shipping, cur)} />
          <Money k="Total" v={moneyFull(o.total, cur)} strong />
        </div>
      </div>
      <div>
        <Caps>Payment</Caps>
        <Grid
          rows={[
            ['Recorded as', <PaymentPill key="p" status={o.payment_status} />],
            ['Method', o.payment_method ?? '—'],
            ['Reference', o.payment_reference ?? '—'],
            ['Paid', d(o.paid_at)],
          ]}
        />
        {o.source === 'manual' || o.source === 'quote' ? <p className="m-0 mt-1.5 text-[11.5px] text-ink-3">For an order entered here, what was paid is on its invoices (Linked).</p> : null}
      </div>
      {o.integrations.length ? (
        <div>
          <Caps>Hand-offs</Caps>
          {o.integrations.map((x, i) => (
            <div key={i} className="flex items-start gap-2 border-b border-line/70 py-1.5 text-[12.5px] last:border-b-0">
              <span className="min-w-0 flex-1">
                <b className="text-ink">
                  {x.module} · {x.operation.replace(/_/g, ' ')}
                </b>
                {x.error ? <span className="block text-[11.5px] text-danger">{x.error}</span> : null}
              </span>
              <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', x.status === 'failed' ? 'bg-danger-bg text-danger' : x.status === 'retrying' ? 'bg-warning-bg text-warning' : 'bg-subtle text-ink-2')}>{x.status}</span>
              {canRetry && x.id && x.status === 'failed' ? (
                <button type="button" className={btnSmall + ' !h-6 !px-2 !text-[11.5px]'} disabled={retrying === x.id} onClick={() => retry(x.id!)}>
                  Retry
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {o.cancel_reason ? (
        <div>
          <Caps>Why it was cancelled</Caps>
          <p className="m-0 text-[13px] whitespace-pre-wrap text-ink-2">{o.cancel_reason}</p>
        </div>
      ) : null}
      {o.notes ? (
        <div>
          <Caps>Notes</Caps>
          <p className="m-0 text-[13px] whitespace-pre-wrap text-ink-2">{o.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

function Money({ k, v, note, tone, strong }: { k: string; v: string; note?: string; tone?: string; strong?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2 border-b border-line/70 px-3 py-2 last:border-b-0', strong && 'bg-ground')}>
      <span className="flex-1 text-ink-2">
        {k}
        {note ? <span className="text-[11.5px] text-ink-3"> · {note}</span> : null}
      </span>
      <span className={cx('tabular-nums', strong ? 'text-[14px] font-extrabold text-ink' : 'text-ink', tone)}>{v}</span>
    </div>
  );
}

function Items({ o }: { o: OrderDetail }) {
  if (!o.lines.length) return <Empty text="This order has no lines." />;
  return (
    <div className="overflow-hidden rounded-[10px] border border-line">
      <div className="flex gap-2 border-b border-line bg-ground px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        <span className="flex-1">Item</span>
        <span className="w-[56px] text-right">Ordered</span>
        <span className="w-[62px] text-right">Reserved</span>
        <span className="w-[62px] text-right">Delivered</span>
        <span className="w-[58px] text-right">Invoiced</span>
        <span className="w-[110px] text-right">Line total</span>
      </div>
      {o.lines.map((l) => (
        <div key={l.id} className="flex items-center gap-2 border-b border-line/70 px-3 py-2 text-[12.5px] last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{l.product}</b>
            <span className="truncate text-[11.5px] text-ink-3">
              {[l.code, `${moneyFull(l.unit_price, o.currency)} each`].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="w-[56px] text-right tabular-nums">{l.quantity}</span>
          <span className="w-[62px] text-right text-ink-2 tabular-nums">{l.reserved_qty}</span>
          <span className={cx('w-[62px] text-right tabular-nums', l.delivered_qty >= l.quantity ? 'text-success' : 'text-ink-2')}>{l.delivered_qty}</span>
          <span className="w-[58px] text-right text-ink-2 tabular-nums">{l.invoiced_qty}</span>
          <b className="w-[110px] text-right text-ink tabular-nums">{moneyFull(l.line_total, o.currency)}</b>
        </div>
      ))}
    </div>
  );
}

function Approval({ o }: { o: OrderDetail }) {
  if (!o.approval.steps.length)
    return <Empty text={o.status === 'draft' ? 'The approval steps are worked out when the order is submitted.' : 'No approval rule applies to this order, so nobody has to sign it off.'} />;
  return (
    <div className="flex flex-col gap-2">
      {o.approval.steps.map((s) => (
        <div key={s.step} className="flex items-start gap-3 rounded-[10px] border border-line px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-selection text-[12.5px] font-extrabold text-primary">{s.step}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[12.5px] text-ink">
              needs <code className="font-mono text-[12px]">{s.permission}</code>
            </span>
            <span className="text-[11.5px] text-ink-3">{s.decision === 'pending' ? (o.approval.mine ? 'Waiting on you' : 'Waiting') : [s.by, s.at ? `${dateLabel(s.at)}, ${timeLabel(s.at)}` : null].filter(Boolean).join(' · ')}</span>
            {s.reason ? <span className="mt-1 text-[12px] text-ink-2">“{s.reason}”</span> : null}
          </span>
          <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold', s.decision === 'approved' ? 'bg-success-bg text-success' : s.decision === 'rejected' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning')}>{s.decision}</span>
        </div>
      ))}
    </div>
  );
}

function Activity({ id }: { id: number }) {
  const q = useQuery({ queryKey: K.timeline(id), queryFn: ({ signal }) => fetchTimeline(id, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const ev = q.data ?? [];
  if (!ev.length) return <Empty text="Nothing has happened to this order yet." />;
  return (
    <div className="flex flex-col">
      {ev.map((e) => (
        <div key={e.id} className="flex gap-3 border-b border-line/70 py-2 text-[12.5px] last:border-b-0">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-ink">{e.type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</b>
            {e.description ? <span className="text-ink-2">{e.description}</span> : null}
            <span className="text-[11.5px] text-ink-3">{[e.user ?? 'System', `${dateLabel(e.at)}, ${timeLabel(e.at)}`].join(' · ')}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Linked({ o, offline }: { o: OrderDetail; offline: boolean }) {
  const { deliveries, invoices } = o.links;
  // An invoice opens in Invoices: listed for everyone, a way in only for whoever has that app.
  const billing = useCanOpen('billing');
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <Caps>Deliveries</Caps>
        {deliveries.length ? (
          deliveries.map((d) => (
            <div key={d.id} className="flex items-center gap-2 border-b border-line/70 py-1.5 text-[12.5px] last:border-b-0">
              <b className="flex-1 text-ink">{d.dn_number}</b>
              <span className="text-ink-3">{d.delivered_at ? `delivered ${dateLabel(d.delivered_at)}` : ''}</span>
              <span className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] font-bold text-ink-2">{d.status}</span>
              {d.status !== 'cancelled' ? (
                <button type="button" className={btnSmall + ' !h-6 !px-2 !text-[11.5px]'} disabled={offline} title={offline ? OFFLINE_WRITE : 'Print on the delivery-note printer'} onClick={() => void printNote(d.id)}>
                  <Icon name="printer" size={12} /> Print
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <p className="m-0 text-[12.5px] text-ink-3">Nothing has been delivered.</p>
        )}
      </div>
      <div>
        <Caps>Invoices</Caps>
        {invoices.length ? (
          invoices.map((i) => {
            const row = 'flex w-full items-center gap-2 border-b border-line/70 py-1.5 text-left text-[12.5px] last:border-b-0';
            const cells = (
              <>
                <b className={cx('flex-1', billing ? 'text-primary' : 'text-ink')}>{i.number}</b>
                <span className="text-ink-3">{i.issue_date ? dateLabel(i.issue_date) : ''}</span>
                <span className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] font-bold text-ink-2">{i.status}</span>
                <b className="w-[120px] text-right text-ink tabular-nums">{moneyFull(i.total, o.currency)}</b>
              </>
            );
            return billing ? (
              <button key={i.id} type="button" onClick={() => openWebLink(`/billing?invoice=${i.id}`)} className={cx(row, 'hover:bg-subtle')}>
                {cells}
              </button>
            ) : (
              <div key={i.id} className={row}>
                {cells}
              </div>
            );
          })
        ) : (
          <p className="m-0 text-[12.5px] text-ink-3">Nothing has been invoiced.</p>
        )}
      </div>
    </div>
  );
}

function ReasonSheet({ title, label, note, optional, danger, okLabel, cancelLabel = 'Cancel', busy, onOk, onClose }: { title: string; label: string; note?: string; optional?: boolean; danger?: boolean; okLabel: string; cancelLabel?: string; busy: boolean; onOk: (reason: string) => void; onClose: () => void }) {
  const [r, setR] = useState('');
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className={btnPrimary + (danger ? ' !bg-danger' : '')} disabled={busy || (!optional && !r.trim())} onClick={() => onOk(r.trim())}>
            {okLabel}
          </button>
        </>
      }
    >
      {note ? <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{note}</p> : null}
      <Field label={label}>
        <textarea autoFocus value={r} onChange={(e) => setR(e.target.value)} rows={3} className={input + ' !h-auto py-2'} />
      </Field>
    </Sheet>
  );
}

/** A payment link through Billing (PAY-06): sent to the customer, or made to copy. The order's payment updates when it is paid. */
function PaymentLinkSheet({ o, onClose }: { o: OrderDetail; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const send = async (channel: 'email' | 'whatsapp' | 'copy') => {
    setBusy(true);
    try {
      const r = await paymentLink(o.id, channel);
      if (channel === 'copy') {
        setUrl(r.url);
        await navigator.clipboard.writeText(r.url).catch(() => undefined);
        toast('success', 'Payment link copied.');
      } else {
        toast('success', channel === 'email' ? 'Payment link emailed to the customer.' : 'Payment link sent on WhatsApp.');
        onClose();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Payment link · ${moneyFull(o.total, o.currency)}`}
      onClose={onClose}
      footer={
        <button type="button" className={btn} onClick={onClose}>
          {url ? 'Done' : 'Cancel'}
        </button>
      }
    >
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">The customer pays through Billing’s payment page; the order shows as paid when the payment comes in.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void send('email')}>
          Email it
        </button>
        <button type="button" className={btn} disabled={busy} onClick={() => void send('whatsapp')}>
          WhatsApp
        </button>
        <button type="button" className={btn} disabled={busy} onClick={() => void send('copy')}>
          Copy link
        </button>
      </div>
      {url ? <code className="block truncate rounded-[9px] bg-subtle px-3 py-2 font-mono text-[12px] text-ink">{url}</code> : null}
    </Sheet>
  );
}

/**
 * The order's comments (Ph2): newest last, mine to edit or delete. `@` picks somebody to mention — the server tells
 * them. Offline they are read as last seen and nothing can be added.
 */
function Comments({ id, offline }: { id: number; offline: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KV.comments(id), queryFn: ({ signal }) => fetchComments(id, signal) });
  const people = useQuery({ queryKey: ['sales', 'assignees'], queryFn: assignees, staleTime: 300_000, retry: false });
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mentioning, setMentioning] = useState(false);
  const again = () => void qc.invalidateQueries({ queryKey: KV.comments(id) });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      again();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const list: Comment[] = q.data ?? [];
  return (
    <div className="flex flex-col gap-2.5">
      {!list.length ? <Empty text="No comments yet." /> : null}
      {list.map((c) => (
        <div key={c.id} data-comment={c.id} className="rounded-[10px] border border-line px-3 py-2 text-[12.5px]">
          <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
            <b className="text-ink">{c.user?.name ?? 'Somebody'}</b>
            <span>{relative(c.at)}</span>
            {c.edited_at ? <span>· edited</span> : null}
            <span className="flex-1" />
            {c.can?.edit && !offline ? (
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing({ id: c.id, body: c.body })}>
                Edit
              </button>
            ) : null}
            {c.can?.delete && !offline ? (
              <button type="button" className="font-semibold text-danger hover:underline" disabled={busy} onClick={() => void run(() => deleteComment(c.id))}>
                Delete
              </button>
            ) : null}
          </div>
          {editing?.id === c.id ? (
            <div className="mt-1.5 flex flex-col gap-1.5">
              <textarea rows={3} value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} className={input + ' !h-auto py-2'} />
              <span className="flex justify-end gap-1.5">
                <button type="button" className={btnSmall} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="button" className={btnSmall + ' !bg-primary !text-white'} disabled={busy || !editing.body.trim()} onClick={() => void run(() => editComment(c.id, editing.body.trim())).then((ok) => ok && setEditing(null))}>
                  Save
                </button>
              </span>
            </div>
          ) : (
            <p className="m-0 mt-1 whitespace-pre-wrap text-ink">{commentText(c.body)}</p>
          )}
        </div>
      ))}
      {offline ? (
        <p className="m-0 text-[12px] text-ink-3">{OFFLINE_WRITE}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <textarea
            rows={3}
            value={body}
            placeholder="Write a comment — @ to mention somebody"
            aria-label="Write a comment"
            onChange={(e) => {
              setBody(e.target.value);
              setMentioning(/(^|\s)@$/.test(e.target.value));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) {
                e.preventDefault();
                void run(() => addComment(id, body.trim())).then((ok) => ok && setBody(''));
              }
            }}
            className={input + ' !h-auto py-2'}
          />
          {mentioning && (people.data ?? []).length ? (
            <div role="listbox" aria-label="Mention" className="flex max-h-40 flex-col overflow-y-auto rounded-[9px] border border-line bg-surface py-1 scroll-thin">
              {(people.data ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="px-3 py-1 text-left text-[12.5px] text-ink hover:bg-subtle"
                  onClick={() => {
                    setBody((b) => `${b.replace(/@$/, '')}${mention(p)} `);
                    setMentioning(false);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          ) : null}
          <span className="flex items-center justify-end gap-2">
            <span className="text-[11.5px] text-ink-3">⌘↵ / Ctrl+Enter</span>
            <button type="button" className={btnPrimary} disabled={busy || !body.trim()} onClick={() => void run(() => addComment(id, body.trim())).then((ok) => ok && setBody(''))}>
              Comment
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

interface ShareOptions {
  printable: boolean;
  recipients: { name: string | null; email: string | null; phone: string | null };
  subject: string;
  message: string;
  can: Record<string, boolean>;
  links: Array<{ id: number; prefix: string; expires: string | null; views: number; expired: boolean }>;
}

/** Email, WhatsApp, a chat, or a link — the server's sharing, with its own permissions. */
function ShareSheet({ o, how, onClose }: { o: OrderDetail; how: 'email' | 'whatsapp' | 'chat' | 'link'; onClose: () => void }) {
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['sales', 'share', o.id], queryFn: ({ signal }) => apiGet<ShareOptions>(`/api/share/oms/${o.id}`, undefined, signal) });
  const people = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<{ users: Array<{ id: number; name: string }> }>('/api/chat/directory', undefined, signal), enabled: how === 'chat', staleTime: 300_000 });
  const [f, setF] = useState<Record<string, string>>({});
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const v = (k: string, d = '') => f[k] ?? d;
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const s = opts.data;
  const titles = { email: `Email ${o.number}`, whatsapp: 'Send on WhatsApp', chat: 'Share in chat', link: 'A shareable link' };
  const send = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const body =
        how === 'email'
          ? { to: v('to', s.recipients.email ?? ''), cc: v('cc'), bcc: v('bcc'), subject: v('subject', s.subject), message: v('message', s.message), attach_pdf: attach && s.printable }
          : how === 'whatsapp'
            ? { phone: v('phone', s.recipients.phone ?? ''), message: v('wa', `Your order ${o.number} — ${moneyFull(o.total, o.currency)}`), attach_pdf: attach && s.printable }
            : how === 'chat'
              ? { user_id: Number(v('user')) }
              : { days: Number(v('days', '30')) };
      const r = await apiPost<{ message?: string; url?: string | null }>(`/api/share/oms/${o.id}/${how}`, body);
      if (how === 'link' && r.url) {
        setMade(r.url);
        void qc.invalidateQueries({ queryKey: ['sales', 'share', o.id] });
        return;
      }
      toast('success', r.message ?? 'Sent.');
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const allowed = s ? s.can[how] !== false : true;
  const field = (label: string, node: ReactNode) => <Field label={label}>{node}</Field>;
  return (
    <Sheet
      title={titles[how]}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            {made ? 'Done' : 'Cancel'}
          </button>
          {!made ? (
            <button type="button" className={btnPrimary} disabled={busy || !s || !allowed || (how === 'chat' && !v('user'))} onClick={() => void send()}>
              {how === 'link' ? 'Create link' : 'Send'}
            </button>
          ) : null}
        </>
      }
    >
      {opts.isLoading ? <Spinner /> : null}
      {opts.error ? <ErrorNote error={opts.error} /> : null}
      {s && !allowed ? <p className="m-0 text-[13px] text-warning">You may not share orders this way.</p> : null}
      {s && allowed && how === 'email' ? (
        <>
          {field('To', <input className={input} value={v('to', s.recipients.email ?? '')} onChange={set('to')} />)}
          <div className="grid grid-cols-2 gap-2">
            {field('Cc', <input className={input} value={v('cc')} onChange={set('cc')} />)}
            {field('Bcc', <input className={input} value={v('bcc')} onChange={set('bcc')} />)}
          </div>
          {field('Subject', <input className={input} value={v('subject', s.subject)} onChange={set('subject')} />)}
          {field('Message', <textarea rows={6} className={input + ' !h-auto py-2'} value={v('message', s.message)} onChange={set('message')} />)}
        </>
      ) : null}
      {s && allowed && how === 'whatsapp' ? (
        <>
          {field('Number', <input className={input} value={v('phone', s.recipients.phone ?? '')} onChange={set('phone')} placeholder="+94…" />)}
          {field('Message', <textarea rows={4} className={input + ' !h-auto py-2'} value={v('wa', `Your order ${o.number} — ${moneyFull(o.total, o.currency)}`)} onChange={set('wa')} />)}
        </>
      ) : null}
      {s && allowed && (how === 'email' || how === 'whatsapp') && s.printable ? (
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
          <Checkbox checked={attach} onChange={(e) => setAttach(e.target.checked)} />
          Attach the PDF
        </label>
      ) : null}
      {s && allowed && how === 'chat'
        ? field(
            'Send to',
            <Select aria-label="Send to" searchable className={input} value={v('user')} onChange={set('user')}>
              <option value="">Choose somebody</option>
              {(people.data?.users ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>,
          )
        : null}
      {s && allowed && how === 'link' ? (
        <>
          {made ? (
            <div className="flex items-center gap-2 rounded-[9px] bg-subtle px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{made}</code>
              <button type="button" className={btnSmall} onClick={() => void navigator.clipboard.writeText(made).then(() => toast('success', 'Link copied.'))}>
                Copy
              </button>
            </div>
          ) : (
            field('Lasts for (days)', <input type="number" min={1} max={365} className={input + ' !w-[120px]'} value={v('days', '30')} onChange={set('days')} />)
          )}
          {s.links.length ? (
            <div>
              <Caps>Live links</Caps>
              {s.links.map((l) => (
                <div key={l.id} className="flex items-center gap-2 border-b border-line/70 py-1.5 text-[12.5px] last:border-b-0">
                  <code className="flex-1 font-mono text-[12px] text-ink-2">…/{l.prefix}</code>
                  <span className="text-ink-3">{l.expired ? 'expired' : l.expires ? `until ${dateLabel(l.expires)}` : 'no end'} · {l.views} views</span>
                  <button
                    type="button"
                    className="text-[12px] font-bold text-danger hover:underline"
                    onClick={() =>
                      void apiDelete(`/api/share/link/${l.id}`).then(
                        () => (void qc.invalidateQueries({ queryKey: ['sales', 'share', o.id] }), toast('success', 'Withdrawn.')),
                        (e) => toast('error', errorMessage(e)),
                      )
                    }
                  >
                    Withdraw
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <p className="m-0 text-[11.5px] text-ink-3">Anyone with the link can see this order until it ends or is withdrawn. The full link is shown once, when it is made.</p>
        </>
      ) : null}
    </Sheet>
  );
}
