import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { bytes, dateLabel, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Sheet, SidePanel } from '../hr/parts';
import { amount, can, K, METHODS, methodLabel, unallocate } from './api';
import { allocateFx, allocatePayment, converted, deletePayment, fetchPayment, fetchPayments, fetchSlips, KB, oldestFirst, openInvoicesOf, PER_PAGE, receiptPdf, refundable, refundPayment, removeSlip, uploadSlip, type PaymentDetail } from './more';
import { money, StatusChip } from './parts';
import { Checkbox } from '../../components/Checkbox';
import { exportRequest } from './actions';

/**
 * Payments (BillPayments, BillPaymentSheet): money received and money given
 * back. A refund is its own row, going out. Unallocated money is on the
 * customer's account until it is set against invoices — the oldest first, or
 * by hand. A refund comes only out of what is not set against an invoice,
 * and needs `billing.credit`. Transfer slips are the customer's proof of
 * payment; the receipt is ours.
 */
export default function Payments({ org, openId, onlyUnallocated, onOpen, onOpenInvoice, onRecord }: {
  org: string;
  openId: number | null;
  onlyUnallocated: boolean;
  onOpen: (id: number | null) => void;
  onOpenInvoice: (id: number) => void;
  onRecord: () => void;
}) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [unallocated, setUnallocated] = useState(onlyUnallocated);
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState(onlyUnallocated);
  if (seen !== onlyUnallocated) {
    setSeen(onlyUnallocated);
    setUnallocated(onlyUnallocated);
    setPage(1);
  }
  const f = { q, method, unallocated, page };
  const list = useQuery({ queryKey: KB.payments(org, f), queryFn: ({ signal }) => fetchPayments(org, f, signal), placeholderData: keepPreviousData });
  const rows = list.data?.payments ?? [];
  const sum = list.data?.summary.in;
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PER_PAGE));
  const reset = (fn: () => void) => (fn(), setPage(1));

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Payments">
        {sum ? (
          <span className="mr-1.5 flex flex-col items-end">
            <span className="text-[11.5px] text-ink-3">Received · on account</span>
            <b className="text-ink tabular-nums">
              {money(sum.total)} · {money(sum.unallocated)}
            </b>
          </span>
        ) : null}
        <button
          type="button"
          className={btn}
          title="Saved to disk as CSV, filtered as the list is — see Transfers"
          onClick={() =>
            void call('transfers:download', exportRequest('payments', 'csv', { org, q: q.trim() || undefined })).then(
              () => toast('success', 'Exporting — see Transfers.'),
              (e) => toast('error', errorMessage(e)),
            )
          }
        >
          <Icon name="download" size={14} /> Export
        </button>
        {can(perms, 'billing.payment') ? (
          <button type="button" className={btnPrimary} onClick={onRecord}>
            <Icon name="plus" size={15} /> Record payment
          </button>
        ) : null}
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="Search reference or customer" aria-label="Search payments" className={input + ' !w-[260px]'} />
        <Select<string> aria-label="Method" value={method} onValueChange={(v) => reset(() => setMethod(v))} options={[{ value: '', label: 'Any method' }, ...METHODS.map((m) => ({ value: m.id, label: m.label })), { value: 'offset', label: 'Offset' }]} className={input + ' !w-[170px]'} />
        <label className="flex items-center gap-1.5 font-semibold text-ink">
          <Checkbox checked={unallocated} onChange={(e) => reset(() => setUnallocated(e.target.checked))} />
          Unallocated only
        </label>
      </div>
      {sum ? (
        <div className="flex gap-4 text-[12px] text-ink-2">
          <span>
            Received: <b className="tabular-nums">{amount(sum.total)}</b>
          </span>
          <span className={sum.unallocated > 0 ? 'text-warning-ink dark:text-warning' : ''}>
            On account: <b className="tabular-nums">{amount(sum.unallocated)}</b>
          </span>
        </div>
      ) : null}
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="w-[150px] shrink-0">Reference</span>
            <span className="min-w-0 flex-1">Customer</span>
            <span className="w-[120px] shrink-0">Method</span>
            <span className="w-[90px] shrink-0">Date</span>
            <span className="w-[140px] shrink-0 text-right">Amount</span>
            <span className="w-[130px] shrink-0 text-right">Unallocated</span>
          </div>
          {rows.length ? (
            rows.map((p) => (
              <button key={p.id} type="button" data-payment={p.id} onClick={() => onOpen(p.id)} className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60', openId === p.id && 'bg-info-soft dark:bg-selection/40')}>
                <span className="flex w-[150px] shrink-0 flex-col">
                  <b className="flex items-center gap-1.5 text-ink">
                    {p.reference}
                    {p.direction === 'out' ? <span className="rounded-[8px] bg-danger-bg px-1.5 text-[10.5px] font-bold text-danger">refund</span> : null}
                  </b>
                  {p.bank_reference ? <span className="truncate text-[11.5px] text-ink-3">{p.bank_reference}</span> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">{p.client ?? 'No customer'}</span>
                <span className="w-[120px] shrink-0 text-ink-2">{methodLabel(p.method)}</span>
                <span className="w-[90px] shrink-0 text-ink-2">{dateLabel(p.paid_on)}</span>
                <b className={cx('w-[140px] shrink-0 text-right tabular-nums', p.direction === 'out' ? 'text-danger' : 'text-ink')}>
                  {p.direction === 'out' ? '− ' : ''}
                  {amount(p.amount, p.currency)}
                </b>
                <span className={cx('w-[130px] shrink-0 text-right tabular-nums', p.unallocated > 0 ? 'font-bold text-warning-ink dark:text-warning' : 'text-ink-3')}>{p.unallocated > 0 ? amount(p.unallocated, p.currency) : '—'}</span>
              </button>
            ))
          ) : (
            <Empty text={q || method || unallocated ? 'No payment matches those filters.' : 'No payments yet.'} />
          )}
        </div>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2.5">
          <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </button>
          <span className="text-[12.5px] text-ink-2 tabular-nums">
            Page {page} of {pages}
          </span>
          <button type="button" className={btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </button>
        </div>
      ) : null}
      {openId ? <PaymentPanel id={openId} onClose={() => onOpen(null)} onOpenInvoice={onOpenInvoice} onOpenPayment={(id) => onOpen(id)} /> : null}
    </div>
  );
}

type Asking = 'allocate' | 'refund' | 'delete' | { unallocate: number; number: string | null };

export function PaymentPanel({ id, onClose, onOpenInvoice, onOpenPayment }: { id: number; onClose: () => void; onOpenInvoice: (id: number) => void; onOpenPayment: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: KB.payment(id), queryFn: ({ signal }) => fetchPayment(id, signal) });
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const p = q.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });
  const run = async (fn: () => Promise<unknown>, done: string | null, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast('success', done);
      setAsking(null);
      after?.();
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const receipt = async () => {
    if (!p) return;
    try {
      const f = await receiptPdf(p.id);
      await call('transfers:download', { fileId: String(f.file_id), name: f.name || `${p.reference}.pdf`, open: true });
      toast('success', 'Downloading the receipt — see Transfers.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const mayPay = can(perms, 'billing.payment');
  const mayRefund = can(perms, 'billing.credit');

  return (
    <SidePanel
      label={p ? `Payment ${p.reference}` : 'Payment'}
      width={480}
      onClose={onClose}
      head={
        p ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[15px] text-ink">{p.reference}</b>
              <span className="truncate text-[12px] text-ink-3">{p.client ?? 'No customer'}</span>
            </span>
            <span className={cx('rounded-[10px] px-2 py-0.5 text-[11.5px] font-bold', p.direction === 'out' ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success')}>{p.direction === 'out' ? 'Refund' : 'Received'}</span>
          </>
        ) : (
          <b className="text-ink">Payment</b>
        )
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : p ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSmall} onClick={() => void receipt()}>
              <Icon name="download" size={13} className="mr-1" /> Receipt
            </button>
            {mayPay && p.direction === 'in' && p.unallocated > 0 ? (
              <button type="button" className={btnPrimary + ' !h-[30px]'} onClick={() => setAsking('allocate')}>
                Allocate {amount(p.unallocated, p.currency)}
              </button>
            ) : null}
            {mayRefund && refundable(p) > 0 ? (
              <button type="button" className={btnSmall} onClick={() => setAsking('refund')}>
                Refund
              </button>
            ) : null}
            {mayPay && p.direction === 'in' && p.unallocated === p.amount && !p.refunds.length ? (
              <button type="button" className={btnSmall + ' !text-danger'} onClick={() => setAsking('delete')}>
                Delete
              </button>
            ) : null}
          </div>
          <Section title="Details">
            <Facts
              rows={[
                ['Amount', amount(p.amount, p.currency)],
                ['Unallocated', <span className={p.unallocated > 0 ? 'text-warning-ink dark:text-warning' : ''}>{amount(p.unallocated, p.currency)}</span>],
                ['Method', methodLabel(p.method)],
                [p.direction === 'out' ? 'Given back on' : 'Received on', dateLabel(p.paid_on)],
                ['Bank reference', p.bank_reference || '—'],
                ...(p.exchange_rate && p.exchange_rate !== 1 ? ([['Rate used', `1 ${p.currency} = ${p.exchange_rate} (${amount(p.base_amount)} in the base currency)`]] as Array<[string, ReactNode]>) : []),
                ['Recorded by', p.recorded_by ?? '—'],
                ['Note', p.note || '—'],
              ]}
            />
            {p.refund_of_id ? (
              <button type="button" className="self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={() => onOpenPayment(p.refund_of_id!)}>
                The payment this refunds
              </button>
            ) : null}
          </Section>
          <Section title={`Against invoices (${p.allocations.length})`}>
            {p.allocations.length ? (
              p.allocations.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-bold text-primary hover:underline" onClick={() => onOpenInvoice(a.invoice_id)}>
                    {a.number ?? `Draft #${a.invoice_id}`}
                  </button>
                  <StatusChip status={a.status} />
                  <span className="text-[11.5px] text-ink-3">{a.due_date ? `due ${dateLabel(a.due_date)}` : ''}</span>
                  <b className="text-ink tabular-nums">{amount(a.amount, p.currency)}</b>
                  {mayPay ? (
                    <button type="button" aria-label={`Remove from ${a.number ?? 'the invoice'}`} title="Remove this allocation" className="flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger-bg" onClick={() => setAsking({ unallocate: a.id, number: a.number })}>
                      <Icon name="x" size={13} />
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <span className="text-[12.5px] text-ink-3">Not set against any invoice.</span>
            )}
          </Section>
          {p.direction === 'in' ? (
            <Section title="Refunds">
              {p.refunds.length ? (
                p.refunds.map((r) => (
                  <button key={r.id} type="button" onClick={() => onOpenPayment(r.id)} className="flex items-center gap-2.5 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                    <b className="flex-1 text-ink">{r.reference}</b>
                    <span className="text-ink-3">{dateLabel(r.paid_on)}</span>
                    <b className="text-danger tabular-nums">− {amount(r.amount, p.currency)}</b>
                  </button>
                ))
              ) : (
                <span className="text-[12.5px] text-ink-3">None.</span>
              )}
            </Section>
          ) : null}
          <Slips payment={p} canEdit={mayPay} />
          {p.gateway ? (
            <Section title="Gateway">
              <Facts
                rows={[
                  ['Gateway', p.gateway],
                  ['Reference', p.gateway_ref ?? '—'],
                  ['Status', p.gateway_status ?? '—'],
                  ['Verified', p.verified_at ? relative(p.verified_at) : 'Not yet'],
                ]}
              />
            </Section>
          ) : null}
          {asking === 'allocate' ? <AllocateSheet p={p} onClose={() => setAsking(null)} /> : null}
          {asking === 'refund' ? <RefundSheet p={p} onClose={() => setAsking(null)} /> : null}
          {asking === 'delete' || (asking && typeof asking === 'object') ? (
            <Sheet
              title={asking === 'delete' ? `Delete ${p.reference}?` : 'Remove this allocation?'}
              width={420}
              onClose={() => setAsking(null)}
              footer={
                <>
                  <button type="button" className={btn} onClick={() => setAsking(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={btnPrimary + ' !bg-danger hover:!opacity-90'}
                    disabled={busy}
                    onClick={() =>
                      asking === 'delete'
                        ? void run(() => deletePayment(p.id), 'Payment deleted.', onClose)
                        : typeof asking === 'object'
                          ? void run(() => unallocate(asking.unallocate), 'Allocation removed; the money is on account.')
                          : undefined
                    }
                  >
                    {asking === 'delete' ? 'Delete' : 'Remove'}
                  </button>
                </>
              }
            >
              <p className="m-0 text-[13px] text-ink-2">
                {asking === 'delete'
                  ? 'It is not set against any invoice, so nothing else changes. Record it again if it was entered by mistake.'
                  : `It comes off ${typeof asking === 'object' && asking.number ? asking.number : 'the invoice'}, which owes it again; the money stays on the customer's account.`}
              </p>
            </Sheet>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}

function AllocateSheet({ p, onClose }: { p: PaymentDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const open = useQuery({ queryKey: ['billing', 'open-invoices', p.client_id], queryFn: ({ signal }) => openInvoicesOf(p.client_id!, signal), enabled: !!p.client_id });
  const same = (open.data ?? []).filter((i) => i.currency === p.currency && i.due > 0);
  // Invoices in other currencies too (G-17): each settles at a rate, and the server posts the realised gain or loss.
  const other = (open.data ?? []).filter((i) => i.currency !== p.currency && i.due > 0);
  const invoices = [...same, ...other];
  const [amounts, setAmounts] = useState<Record<number, string> | null>(null);
  const [rates, setRates] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const plan = oldestFirst(same, p.unallocated);
  const value = (id: number) => amounts?.[id] ?? (plan[id] ? plan[id]!.toFixed(2) : '');
  const rateOf = (id: number) => Number((rates[id] ?? '').replace(/,/g, '')) || 0;
  const entered = invoices.reduce((s, i) => s + (Number(value(i.id)) || 0), 0);
  const over = entered > p.unallocated + 0.005;
  const missingRate = other.some((i) => (Number(value(i.id)) || 0) > 0 && !(rateOf(i.id) > 0));
  /**
   * Same-currency invoices go in one `allocate`; each invoice in another currency is its own `allocate-fx` with the
   * amount in the payment's currency and the rate (G-17). A refusal of one is said and the others still go.
   */
  const send = async (spec: 'auto' | Array<{ invoice_id: number; amount: number; rate?: number }>) => {
    setBusy(true);
    try {
      const plain = spec === 'auto' ? 'auto' : spec.filter((x) => x.rate === undefined).map(({ invoice_id, amount: a }) => ({ invoice_id, amount: a }));
      const fx = spec === 'auto' ? [] : spec.filter((x) => x.rate !== undefined);
      let n = 0;
      let errors = 0;
      if (plain === 'auto' || plain.length) {
        const r = await allocatePayment(p.id, plain);
        n += r.data.allocation.count;
        errors += r.data.allocation.errors.length;
        for (const e of r.data.allocation.errors) toast('error', e);
      }
      for (const x of fx) {
        try {
          await allocateFx(p.id, { invoice_id: x.invoice_id, payment_amount: x.amount, rate: x.rate! });
          n += 1;
        } catch (e) {
          errors += 1;
          toast('error', errorMessage(e));
        }
      }
      if (n) toast('success', `Allocated across ${n} ${n === 1 ? 'invoice' : 'invoices'}.`);
      else if (!errors) toast('success', 'Nothing was open to allocate against.');
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Allocate ${amount(p.unallocated, p.currency)}`}
      width={500}
      onClose={onClose}
      footer={
        <>
          <b className={cx('mr-auto self-center text-[12.5px] tabular-nums', over ? 'text-danger' : 'text-ink')}>
            Entered: {amount(entered, p.currency)}
            {over ? ' — more than is available' : ''}
          </b>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || over || entered <= 0 || missingRate}
            title={missingRate ? 'Give the rate for each invoice in another currency' : undefined}
            onClick={() => void send(invoices.map((i) => ({ invoice_id: i.id, amount: Number(value(i.id)) || 0, ...(i.currency !== p.currency ? { rate: rateOf(i.id) } : {}) })).filter((x) => x.amount > 0))}
          >
            Allocate
          </button>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-ink-3">
        {p.client} · invoices still owing; amounts are in {p.currency}
      </p>
      <button type="button" className={btn + ' self-start'} disabled={busy || !same.length} onClick={() => void send('auto')}>
        Settle the oldest invoices first
      </button>
      <b className="text-[12.5px] text-ink">Or choose amounts</b>
      {open.isLoading ? (
        <Spinner />
      ) : invoices.length ? (
        invoices.map((i) => (
          <div key={i.id} className="flex items-center gap-2.5 text-[12.5px]">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="text-ink">{i.number}</b>
              <span className="text-[11.5px] text-ink-3">
                {i.due_date ? `due ${dateLabel(i.due_date)} · ` : ''}owes {amount(i.due, i.currency)}
              </span>
            </span>
            {i.currency !== p.currency ? (
              <span className="flex flex-col items-end">
                <input
                  aria-label={`Rate for ${i.number}: 1 ${p.currency} in ${i.currency}`}
                  inputMode="decimal"
                  placeholder={`1 ${p.currency} = ? ${i.currency}`}
                  value={rates[i.id] ?? ''}
                  onChange={(e) => setRates({ ...rates, [i.id]: e.target.value })}
                  className={input + ' !h-[30px] !w-[130px] tabular-nums'}
                />
                {rateOf(i.id) > 0 && Number(value(i.id)) > 0 ? <span className="text-[11px] text-ink-3">settles {amount(Math.min(i.due, converted(Number(value(i.id)), rateOf(i.id))), i.currency)}</span> : null}
              </span>
            ) : null}
            <input
              aria-label={`Allocate to ${i.number}`}
              inputMode="decimal"
              value={value(i.id)}
              onChange={(e) => setAmounts({ ...Object.fromEntries(invoices.map((x) => [x.id, value(x.id)])), [i.id]: e.target.value })}
              className={input + ' !h-[30px] !w-[130px] tabular-nums'}
            />
          </div>
        ))
      ) : (
        <Empty text={`${p.client ?? 'This customer'} has no invoice still owing.`} />
      )}
    </Sheet>
  );
}

function RefundSheet({ p, onClose }: { p: PaymentDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const free = refundable(p);
  const onInvoices = p.allocations.reduce((s, a) => s + a.amount, 0);
  const already = p.refunds.reduce((s, r) => s + r.amount, 0);
  const [value, setValue] = useState(free.toFixed(2));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Money taken through a gateway can go back the same way (G-02): the gateway refunds the card and the refund is recorded with its reference.
  const viaGatewayPossible = !!p.gateway && !!p.gateway_ref && p.direction === 'in';
  const [viaGateway, setViaGateway] = useState(viaGatewayPossible);
  const sum = Number(value.replace(/,/g, '')) || 0;
  const send = async () => {
    setBusy(true);
    try {
      const r = await refundPayment(p.id, { amount: sum, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(viaGateway ? { via_gateway: true } : {}) });
      // A gateway that refuses is an error answer (nothing recorded); a success carries the gateway's own reference.
      toast('success', viaGateway ? `Refund of ${amount(sum, p.currency)} sent back through ${p.gateway}${r.refund_ref ? ` (${r.refund_ref})` : ''}.` : `Refund of ${amount(sum, p.currency)} recorded.`);
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Refund from ${p.reference}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || sum <= 0 || sum > free + 0.005} onClick={() => void send()}>
            {viaGateway ? `Refund ${amount(sum, p.currency)} through ${p.gateway}` : `Refund ${amount(sum, p.currency)}`}
          </button>
        </>
      }
    >
      <Facts
        rows={[
          ['Received', amount(p.amount, p.currency)],
          ['On invoices', amount(onInvoices, p.currency)],
          ['Refunded already', amount(already, p.currency)],
          ['Free to refund', <span className="text-success">{amount(free, p.currency)}</span>],
        ]}
      />
      <Field label="Amount to refund" hint="Only what is not set against an invoice. Take it off an invoice first to refund more.">
        <input aria-label="Amount to refund" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={input + ' tabular-nums'} />
      </Field>
      <Field label="Why is the money going back?">
        <textarea aria-label="Why is the money going back?" value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} className={input + ' !h-[52px] resize-none py-2'} />
      </Field>
      {viaGatewayPossible ? (
        <label className="flex items-start gap-2 text-[12.5px] text-ink">
          <Checkbox checked={viaGateway} onChange={(e) => setViaGateway(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Refund through {p.gateway}</b>
            <span className="block text-ink-3">The money goes back to the card or account it came from ({p.gateway_ref}). Leave this off if it was already returned another way.</span>
          </span>
        </label>
      ) : null}
      <p className="m-0 rounded-[8px] bg-subtle px-3 py-2 text-[12px] text-ink-2">
        {viaGateway ? `${p.gateway} is asked to send it back now; its answer is recorded on the refund.` : 'This records money that has already gone back. Nothing here sends it.'}
      </p>
    </Sheet>
  );
}

function Slips({ payment, canEdit }: { payment: PaymentDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KB.slips(payment.id), queryFn: ({ signal }) => fetchSlips(payment.id, signal) });
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement | null>(null);
  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      // One at a time, so a failure leaves whole slips behind it.
      for (const f of Array.from(files)) {
        if (f.size > 10 * 1024 * 1024) {
          toast('error', `${f.name} is over 10 MB.`);
          continue;
        }
        await uploadSlip(payment.id, f);
      }
      toast('success', files.length === 1 ? 'Slip attached.' : 'Slips attached.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      if (pick.current) pick.current.value = '';
      void qc.invalidateQueries({ queryKey: KB.slips(payment.id) });
    }
  };
  const rows = q.data ?? [];
  return (
    <Section title={`Transfer slips${rows.length ? ` (${rows.length})` : ''}`}>
      {rows.map((s) => (
        <div key={s.id} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
          <Icon name={s.is_image ? 'image' : 'file'} size={14} className="shrink-0 text-ink-3" />
          <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-primary hover:underline" onClick={() => void call('transfers:download', { paymentSlip: { payment: payment.id, slip: s.id }, name: s.name, open: true }).then(() => toast('success', 'Downloading — see Transfers.'), (e) => toast('error', errorMessage(e)))}>
            {s.name}
          </button>
          <span className="shrink-0 text-[11.5px] text-ink-3">
            {bytes(s.size)}
            {s.uploaded_by ? ` · ${s.uploaded_by}` : ''}
          </span>
          {canEdit ? (
            <button
              type="button"
              aria-label={`Remove ${s.name}`}
              title="Remove"
              className="flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger-bg"
              onClick={() =>
                void removeSlip(payment.id, s.id).then(
                  () => (toast('success', 'Slip removed.'), void qc.invalidateQueries({ queryKey: KB.slips(payment.id) })),
                  (e) => toast('error', errorMessage(e)),
                )
              }
            >
              <Icon name="x" size={13} />
            </button>
          ) : null}
        </div>
      ))}
      {!rows.length && !q.isLoading ? <span className="text-[12.5px] text-ink-3">None attached.</span> : null}
      {canEdit ? (
        <>
          <input ref={pick} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,application/pdf,image/*" aria-label="Attach a slip" className="hidden" onChange={(e) => void attach(e.target.files)} />
          <button type="button" className={btnSmall + ' self-start'} disabled={busy} onClick={() => pick.current?.click()}>
            {busy ? 'Attaching…' : 'Attach a slip'}
          </button>
          <span className="text-[11.5px] text-ink-3">PDF or image, up to 10 MB — the customer's proof of payment.</span>
        </>
      ) : null}
    </Section>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{title}</div>
      {children}
    </section>
  );
}

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="flex flex-col">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2.5 py-[3px] text-[12.5px]">
          <span className="w-[130px] shrink-0 text-ink-3">{k}</span>
          <span className="min-w-0 flex-1 font-semibold text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}
