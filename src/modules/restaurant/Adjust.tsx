import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Modal, TextField, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { get, K, money, needsApproval, newKey, refusal, write, type Adjustment, type Bill, type Customer, type Order, type OrderLine, type Payment } from './api';
import { Approval, type ApprovalAsk } from './Approvals';
import { useT } from './i18n';
import { Note, ReasonField, useTill } from './parts';

/**
 * Money taken off, given away, changed or given back at the till (§8.2
 * RM-DSC-003/004, §8.6): a discount on the order or a line, a line made
 * complimentary, a line's price overridden, a payment refunded, and a bill
 * made a tax invoice. The server works every figure out and keeps each
 * person's limits: above one it answers `approval_needed` with the approval
 * to ask for, which a manager answers with their PIN here or from their own
 * device (`Approval`), and the same request goes again with its
 * `approval_id`. All of it needs WorkSuite: the till never offers it offline.
 */
export type AdjustKind = 'discount' | 'comp' | 'price';

/** The till's permission for each kind (`options.can`). */
export const ADJUST_PERM: Record<AdjustKind, string> = { discount: 'discount_apply', comp: 'comp', price: 'price_override' };

/** Reading an order's adjustments needs one of these (`AdjustmentsController::index`). */
const READS = ['payment_process', 'report_view', 'cashier_close'];

export function AdjustDialog({ order, line, kind, onClose, onDone }: { order: Order; line: OrderLine | null; kind: AdjustKind; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const till = useTill();
  const [by, setBy] = useState<'pct' | 'amount'>('pct');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<ApprovalAsk | null>(null);

  const ready = reason.trim() !== '' && (kind === 'comp' || Number(value) > 0);

  async function run(approvalId?: number) {
    setBusy(true);
    setError(null);
    const extra = { reason: reason.trim(), terminal_id: till.pairing.terminal_id, ...(approvalId ? { approval_id: approvalId } : {}) };
    const [path, body] =
      kind === 'discount'
        ? ['/adjustments/discount', { order_id: order.id, ...(line ? { order_item_id: line.id } : {}), ...(by === 'pct' ? { pct: Number(value) } : { amount: Number(value).toFixed(2) }), ...extra }]
        : kind === 'comp'
          ? ['/adjustments/comp', { order_item_id: line!.id, ...extra }]
          : ['/adjustments/price', { order_item_id: line!.id, unit_price: Number(value).toFixed(2), ...extra }];
    try {
      const r = await write(path, body);
      toast('success', r.message ?? t('adjust.done'));
      onDone();
      onClose();
    } catch (e) {
      const f = refusal(e);
      if (needsApproval(f) && f.approval) setAsk({ ...f.approval, reason: reason.trim(), order_id: order.id, branch_id: order.branch_id, message: f.message });
      else setError(f.message);
    } finally {
      setBusy(false);
    }
  }

  if (ask) return <Approval ask={ask} onClose={onClose} onApproved={(id) => void run(id)} />;

  const title = kind === 'discount' ? (line ? t('adjust.discountLine', { name: line.name }) : t('adjust.discountOrder', { number: order.number })) : kind === 'comp' ? t('adjust.compTitle', { name: line!.name }) : t('adjust.priceTitle', { name: line!.name });
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void run()}>
            {kind === 'discount' ? t('adjust.giveDiscount') : kind === 'comp' ? t('adjust.giveFree') : t('adjust.setPrice')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {line ? (
          <p className="text-[13px] text-ink-2">
            {t('adjust.lineNow', { amount: money(line.line_total, order.currency ?? till.currency) })}
          </p>
        ) : null}
        {kind === 'discount' ? (
          <>
            <div className="flex gap-1.5" role="radiogroup" aria-label={t('adjust.by')}>
              {(['pct', 'amount'] as const).map((b) => (
                <button key={b} type="button" role="radio" aria-checked={by === b} onClick={() => setBy(b)} className={cx('rounded-full border px-3 py-1 text-[12.5px] font-semibold', by === b ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
                  {b === 'pct' ? t('adjust.byPct') : t('adjust.byAmount')}
                </button>
              ))}
            </div>
            <TextField label={by === 'pct' ? t('adjust.pct') : t('adjust.amount')} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
          </>
        ) : null}
        {kind === 'price' ? <TextField label={t('adjust.newPrice')} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} /> : null}
        {kind === 'comp' ? <Note tone="muted">{t('adjust.compHint')}</Note> : null}
        <ReasonField label={t('adjust.why')} value={reason} onChange={setReason} />
        <p className="text-[12px] text-ink-3">{t('adjust.serverDecides')}</p>
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}

/** What was taken off or given away on this order, and taking one back (before anything is paid). */
export function OrderAdjustments({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const reads = READS.some((p) => till.can(p));
  const q = useQuery({
    queryKey: K.adjustments(order.id),
    queryFn: ({ signal }) => get<{ adjustments: Adjustment[] }>('/adjustments', { order_id: order.id }, signal).then((d) => d.adjustments),
    enabled: reads && !till.offline,
  });
  const [removing, setRemoving] = useState<Adjustment | null>(null);
  const shown = (q.data ?? []).filter((a) => ['discount', 'comp', 'price_override'].includes(a.kind) && a.status !== 'removed' && !a.removed_at);
  if (!reads || shown.length === 0) return null;
  const mayRemove = (a: Adjustment) => !till.offline && Number(order.paid_total) === 0 && a.kind !== 'price_override' && till.can(a.kind === 'comp' ? 'comp' : 'discount_apply');
  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface p-3" aria-label={t('adjust.list')} role="region">
      <span className="text-[12.5px] font-bold text-ink-2">{t('adjust.list')}</span>
      {shown.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-[12.5px]">
          <span className="min-w-0 flex-1 text-ink">
            {a.kind_label}
            {a.pct && Number(a.pct) ? ` ${Number(a.pct)}%` : ''} · {a.reason}
            {a.approver_name ? <span className="text-ink-3"> · {t('adjust.approvedBy', { name: a.approver_name })}</span> : null}
          </span>
          <span className="tabular-nums text-ink">− {money(a.amount)}</span>
          {mayRemove(a) ? (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(a)}>
              {t('adjust.takeBack')}
            </Button>
          ) : null}
        </div>
      ))}
      {removing ? (
        <RemoveAdjustment
          adjustment={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: K.adjustments(order.id) });
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function RemoveAdjustment({ adjustment, onClose, onDone }: { adjustment: Adjustment; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await write(`/adjustments/${adjustment.id}/remove`, { reason: reason.trim() });
      toast('success', r.message ?? t('adjust.takenBack'));
      onDone();
      onClose();
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('adjust.takeBackTitle', { what: adjustment.kind_label })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void run()}>
            {t('adjust.takeBack')}
          </Button>
        </>
      }
    >
      <ReasonField label={t('adjust.why')} value={reason} onChange={setReason} />
      {error ? <div className="mt-2"><Note tone="danger">{error}</Note></div> : null}
    </Modal>
  );
}

/**
 * The payments on an order's bills, each refundable (in part) by those with
 * `restaurant.refund` once the bill is paid in full. One idempotency key per
 * refund attempt, kept until the server answers — a retry after a dropped
 * answer never gives the money back twice.
 */
export function OrderPayments({ orderId, currency, onChanged }: { orderId: number; currency: string; onChanged: () => void }) {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const reads = READS.some((p) => till.can(p));
  const q = useQuery({
    queryKey: K.payments(orderId),
    queryFn: ({ signal }) => get<{ payments: Payment[] }>('/payments', { order_id: orderId }, signal).then((d) => d.payments),
    enabled: reads && !till.offline,
  });
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const list = q.data ?? [];
  if (!reads || list.length === 0) return null;
  return (
    <Card title={t('refund.payments')}>
      <ul className="flex flex-col divide-y divide-line">
        {list.map((p) => {
          const left = Number(p.amount) - Number(p.refunded_total || 0);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
              <span className="min-w-0 flex-1 text-ink">
                {p.refund_of_id ? t('refund.refundOf') : p.method_label} · {p.status_label}
                {Number(p.refunded_total) > 0 ? <span className="text-ink-3"> · {t('refund.refunded', { amount: money(p.refunded_total, currency) })}</span> : null}
              </span>
              <span className={cx('tabular-nums', p.refund_of_id ? 'text-danger' : 'text-ink')}>{money(p.amount, currency)}</span>
              {!p.refund_of_id && p.status === 'captured' && left > 0 && till.can('refund') ? (
                <Button size="sm" variant="ghost" disabled={till.offline} onClick={() => setRefunding(p)}>
                  {t('refund.open')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {refunding ? (
        <RefundDialog
          payment={refunding}
          currency={currency}
          onClose={() => setRefunding(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: K.payments(orderId) });
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

export function RefundDialog({ payment, currency, onClose, onDone }: { payment: Payment; currency: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const till = useTill();
  const left = (Number(payment.amount) - Number(payment.refunded_total || 0)).toFixed(2);
  const [amount, setAmount] = useState(left);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<ApprovalAsk | null>(null);

  async function run(approvalId?: number) {
    setBusy(true);
    setError(null);
    try {
      const r = await write<{ open_drawer?: boolean }>(
        `/payments/${payment.id}/refund`,
        { amount: Number(amount).toFixed(2), reason: reason.trim(), method: payment.method, terminal_id: till.pairing.terminal_id, ...(approvalId ? { approval_id: approvalId } : {}) },
        key,
      );
      toast('success', r.message ?? t('refund.done'));
      if (r.data?.open_drawer) {
        const o = await call('restaurant:openDrawer');
        if (!o.ok) toast('warning', o.message);
      }
      onDone();
      onClose();
    } catch (e) {
      const f = refusal(e);
      /* Answered: the next press is a new attempt. Not answered: the same key again. */
      if (f.status > 0 && f.status < 500 && f.code !== 'in_progress') setKey(newKey());
      if (needsApproval(f) && f.approval) setAsk({ ...f.approval, reason: reason.trim(), order_id: payment.order_id, message: f.message });
      else setError(f.message);
    } finally {
      setBusy(false);
    }
  }

  if (ask) return <Approval ask={ask} onClose={onClose} onApproved={(id) => void run(id)} />;

  return (
    <Modal
      title={t('refund.title', { method: payment.method_label })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim() || !(Number(amount) > 0)} onClick={() => void run()}>
            {t('refund.give', { amount: money(Number(amount || 0).toFixed(2), currency) })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-2">{t('refund.left', { amount: money(left, currency) })}</p>
        <TextField label={t('refund.amount')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        <ReasonField label={t('adjust.why')} value={reason} onChange={setReason} />
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}

/**
 * A tax invoice for a bill that is the whole order (RM-BIL-004): Billing's
 * invoice, addressed to a CRM customer — the order's, or one looked up here.
 * An invoiced bill answers with its invoice again.
 */
export function InvoiceDialog({ bill, onClose, onDone }: { bill: Bill; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const till = useTill();
  const [q, setQ] = useState('');
  const [client, setClient] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const lookup = useQuery({
    queryKey: ['restaurant', 'customers', q.trim()],
    queryFn: ({ signal }) => get<{ customers: Customer[] }>('/customers', { q: q.trim() }, signal).then((d) => d.customers),
    enabled: q.trim().length >= 2 && !till.offline,
    staleTime: 30_000,
  });

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await write<{ invoice_number?: string | null }>(`/bills/${bill.id}/invoice`, client ? { client_id: client.client_id } : {});
      setDone(r.message ?? t('invoice.done'));
      onDone();
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title={t('invoice.title', { number: bill.number })} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('common.done')}</Button>}>
        <p className="text-[13.5px] text-ink">{done}</p>
      </Modal>
    );
  }

  const hasClient = !!client || !!bill.client_id;
  return (
    <Modal
      title={t('invoice.title', { number: bill.number })}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon="receipt" loading={busy} disabled={!hasClient && !bill.invoice_id} onClick={() => void run()}>
            {bill.invoice_id ? t('invoice.again') : t('invoice.make')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-2">{t('invoice.hint')}</p>
        {bill.client_id && !client ? <Note tone="muted">{t('invoice.orderCustomer')}</Note> : null}
        <TextField label={t('invoice.find')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('invoice.findHint')} />
        {client ? (
          <Note tone="indigo" action={<Button size="sm" variant="ghost" onClick={() => setClient(null)}>{t('invoice.change')}</Button>}>
            {client.name}
            {client.phone ? ` · ${client.phone}` : ''}
          </Note>
        ) : (
          <ul className="flex max-h-[200px] flex-col overflow-y-auto" aria-label={t('invoice.found')}>
            {(lookup.data ?? []).map((c) => (
              <li key={c.client_id}>
                <button type="button" onClick={() => setClient(c)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-start text-[13px] hover:bg-subtle">
                  <span className="flex-1 font-semibold text-ink">{c.name}</span>
                  <span className="text-ink-3">{c.phone ?? c.email ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}
