import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { openWebLink } from '../../core/tab-context';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Caps, Empty, Field, Grid, input, Seg, Sheet, SidePanel } from '../hr/parts';
import { approve, assign, assignees, cancel, confirm, fetchOrder, fetchTimeline, K, mayInvoice, movesFor, raiseInvoice, reject, submit, transition, type Move, type OrderDetail } from './api';
import { moneyFull, PaymentPill, PriorityPill, StatusPill } from './parts';

/**
 * One order (OmsOrderDrawer + OmsOrderSheet): the facts, the money and the
 * payment, then its lines (ordered / reserved / delivered / invoiced), the
 * approval steps, the timeline and what it produced (deliveries, invoices).
 * The buttons are what this person may do next: submit, approve or reject,
 * confirm (Inventory reserves the stock), move on, cancel (Inventory releases
 * it), assign, and share — email, WhatsApp, a chat, a link, the PDF.
 */
type Tab = 'overview' | 'items' | 'approval' | 'activity' | 'linked';
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));

export default function OrderDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [tab, setTab] = useState<Tab>('overview');
  const [asking, setAsking] = useState<null | 'reject' | 'cancel' | 'approve'>(null);
  const [sharing, setSharing] = useState<null | 'email' | 'whatsapp' | 'chat' | 'link'>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: K.order(id), queryFn: ({ signal }) => fetchOrder(id, signal) });
  const o = q.data;
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

  const moves = movesFor(o);
  const pending = o.status === 'pending_approval';
  const canSubmit = o.status === 'draft' && has(perms, 'oms.orders.edit');
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
      <div className="flex flex-wrap items-center gap-1.5" data-order-head>
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
        {mayInvoice(o, perms) ? (
          <button type="button" className={btn} disabled={busy} onClick={() => void run(() => raiseInvoice(o.id), `A draft invoice for ${o.number} is in Billing — see Linked.`)} title="A draft invoice for what was delivered and not yet invoiced">
            Raise invoice
          </button>
        ) : null}
        <span className="flex-1" />
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
                <button key={k} type="button" role="menuitem" onClick={() => (setMenu(false), setSharing(k))} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] font-semibold text-ink hover:bg-subtle">
                  <Icon name={icon} size={14} className="text-ink-3" />
                  {label}
                </button>
              ))}
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
          { id: 'activity', label: 'Activity' },
          { id: 'linked', label: 'Linked' },
        ]}
      />
      {tab === 'overview' ? <Overview o={o} canAssign={has(perms, 'oms.orders.assign')} onAssigned={refresh} /> : null}
      {tab === 'items' ? <Items o={o} /> : null}
      {tab === 'approval' ? <Approval o={o} /> : null}
      {tab === 'activity' ? <Activity id={o.id} /> : null}
      {tab === 'linked' ? <Linked o={o} /> : null}

      {asking === 'approve' ? <ReasonSheet title={`Approve ${o.number}?`} label="A note, if you like" optional busy={busy} onClose={() => setAsking(null)} onOk={(r) => void run(() => approve(o.id, r || undefined), `${o.number}: your step is approved.`).then((ok) => ok && setAsking(null))} okLabel="Approve" /> : null}
      {asking === 'reject' ? <ReasonSheet title={`Reject ${o.number}`} label="Why is it rejected? The person who raised it has to know what to change." busy={busy} onClose={() => setAsking(null)} onOk={(r) => void run(() => reject(o.id, r), `${o.number} rejected.`).then((ok) => ok && setAsking(null))} okLabel="Reject" danger /> : null}
      {asking === 'cancel' ? (
        <Sheet
          title="Cancel this order?"
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>
                Keep it
              </button>
              <button type="button" className={btnPrimary + ' !bg-danger'} disabled={busy} onClick={() => void run(() => (moves.find((m) => m.status === 'cancelled')?.via === 'transition' ? transition(o.id, 'cancelled') : cancel(o.id)), `${o.number} cancelled — reserved stock released.`).then((ok) => ok && setAsking(null))}>
                Cancel order
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] leading-[1.5] text-ink-2">Cancelling releases any reserved stock. An invoice or payment already made is a separate document in Billing and Finance and is not undone here. An order with anything delivered cannot be cancelled.</p>
        </Sheet>
      ) : null}
      {sharing ? <ShareSheet o={o} how={sharing} onClose={() => setSharing(null)} /> : null}
    </SidePanel>
  );
}

function Overview({ o, canAssign, onAssigned }: { o: OrderDetail; canAssign: boolean; onAssigned: () => void }) {
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
          {o.coupon_code ? <Money k={`Coupon ${o.coupon_code}`} v={`− ${moneyFull(o.coupon_discount, cur)}`} tone="text-danger" /> : null}
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
            </div>
          ))}
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

function Linked({ o }: { o: OrderDetail }) {
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

function ReasonSheet({ title, label, optional, danger, okLabel, busy, onOk, onClose }: { title: string; label: string; optional?: boolean; danger?: boolean; okLabel: string; busy: boolean; onOk: (reason: string) => void; onClose: () => void }) {
  const [r, setR] = useState('');
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary + (danger ? ' !bg-danger' : '')} disabled={busy || (!optional && !r.trim())} onClick={() => onOk(r.trim())}>
            {okLabel}
          </button>
        </>
      }
    >
      <Field label={label}>
        <textarea autoFocus value={r} onChange={(e) => setR(e.target.value)} rows={3} className={input + ' !h-auto py-2'} />
      </Field>
    </Sheet>
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
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
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
