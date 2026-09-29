import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Empty, input, Kpi, PageHead, SidePanel } from '../hr/parts';
import { agingParts, amount } from './api';
import { fetchCustomer, fetchCustomers, frequencyLabel, KB } from './more';
import { money, StatusChip } from './parts';
import { Section } from './Payments';

/**
 * Customers (BillCustomers): who owes what, largest first — outstanding,
 * overdue, billed and money held on account — and one customer's picture:
 * how old their debt is, their invoices, payments and recurring billing.
 * The company picker narrows the money, not the names.
 */
export default function Customers({ org, openId, onOpen, onOpenInvoice, onOpenPayment, onOpenProfile }: {
  org: string;
  openId: number | null;
  onOpen: (id: number | null) => void;
  onOpenInvoice: (id: number) => void;
  onOpenPayment: (id: number) => void;
  onOpenProfile: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(false);
  const f = { q, owing, page: 1 };
  const list = useQuery({ queryKey: KB.customers(org, f), queryFn: ({ signal }) => fetchCustomers(org, f, signal), placeholderData: keepPreviousData });
  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Customers" sub="Largest outstanding first" />
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" aria-label="Search customers" className={input + ' !w-[260px]'} />
        <label className="flex items-center gap-1.5 font-semibold text-ink">
          <input type="checkbox" checked={owing} onChange={(e) => setOwing(e.target.checked)} className="accent-primary" />
          Owing only
        </label>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="min-w-0 flex-1">Customer</span>
            <span className="w-[80px] shrink-0 text-right">Invoices</span>
            <span className="w-[120px] shrink-0 text-right">Billed</span>
            <span className="w-[130px] shrink-0 text-right">Outstanding</span>
            <span className="w-[130px] shrink-0 text-right">Overdue</span>
            <span className="w-[120px] shrink-0 text-right">On account</span>
          </div>
          {rows.length ? (
            rows.map((c) => (
              <button key={c.id} type="button" data-customer={c.id} onClick={() => onOpen(c.id)} className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60', openId === c.id && 'bg-[#F4F6FE] dark:bg-selection/40')}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{c.name}</b>
                  {c.email ? <span className="truncate text-[11.5px] text-ink-3">{c.email}</span> : null}
                </span>
                <span className="w-[80px] shrink-0 text-right text-ink-2 tabular-nums">{c.invoice_count}</span>
                <span className="w-[120px] shrink-0 text-right text-ink tabular-nums">{c.billed ? money(c.billed, c.currency) : '—'}</span>
                <b className="w-[130px] shrink-0 text-right text-ink tabular-nums">{c.outstanding > 0 ? amount(c.outstanding, c.currency) : '—'}</b>
                <span className={cx('w-[130px] shrink-0 text-right tabular-nums', c.overdue > 0 ? 'font-bold text-danger' : 'text-ink-3')}>{c.overdue > 0 ? amount(c.overdue, c.currency) : '—'}</span>
                <span className={cx('w-[120px] shrink-0 text-right tabular-nums', c.on_account > 0 ? 'font-bold text-[#9A4A06] dark:text-warning' : 'text-ink-3')}>{c.on_account > 0 ? amount(c.on_account, c.currency) : '—'}</span>
              </button>
            ))
          ) : (
            <Empty text={q || owing ? 'No customer matches.' : 'No customers yet.'} />
          )}
        </div>
      )}
      {rows.length >= 100 ? <span className="text-center text-[12px] text-ink-3">The 100 who owe the most. Search to find anyone else.</span> : null}
      {openId ? <CustomerPanel id={openId} org={org} onClose={() => onOpen(null)} onOpenInvoice={onOpenInvoice} onOpenPayment={onOpenPayment} onOpenProfile={onOpenProfile} /> : null}
    </div>
  );
}

function CustomerPanel({ id, org, onClose, onOpenInvoice, onOpenPayment, onOpenProfile }: { id: number; org: string; onClose: () => void; onOpenInvoice: (id: number) => void; onOpenPayment: (id: number) => void; onOpenProfile: (id: number) => void }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: KB.customer(id, org), queryFn: ({ signal }) => fetchCustomer(id, org, signal) });
  const d = q.data;
  const cur = d?.customer.currency ?? null;
  const aging = agingParts(d?.aging);
  // Their subscriptions are in Subscriptions (in the browser): only for whoever has that app, and its permission.
  const subs = useCanOpen('subscriptions') && !!perms && (perms.includes('*') || perms.includes('customer_subscription.view'));

  return (
    <SidePanel
      label={d ? `Customer ${d.customer.name}` : 'Customer'}
      width={520}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-[15px] text-ink">{d?.customer.name ?? 'Customer'}</b>
          <span className="truncate text-[12px] text-ink-3">{[d?.customer.email, d?.customer.phone].filter(Boolean).join(' · ') || 'Customer'}</span>
        </span>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : d ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Outstanding" value={amount(d.summary.outstanding, cur)} sub={`${d.summary.invoice_count} ${d.summary.invoice_count === 1 ? 'invoice' : 'invoices'}`} />
            <Kpi label="Overdue" value={amount(d.summary.overdue, cur)} sub={d.summary.overdue > 0 ? 'needs chasing' : 'nothing late'} tone={d.summary.overdue > 0 ? 'red' : undefined} />
            <Kpi label="Billed" value={money(d.summary.billed, cur)} sub="all time" />
            <Kpi label="On account" value={amount(d.summary.on_account, cur)} sub="unallocated" tone={d.summary.on_account > 0 ? 'amber' : undefined} />
          </div>
          {d.customer.billing_address ? <span className="text-[12px] text-ink-3">{d.customer.billing_address}</span> : null}
          <Section title="How old the money is">
            <div className="flex h-3 overflow-hidden rounded-[6px] bg-subtle">{aging.map((a) => (a.pct > 0 ? <span key={a.key} style={{ width: `${a.pct}%`, background: a.colour }} title={`${a.label}: ${amount(a.value, cur)}`} /> : null))}</div>
            <div className="grid grid-cols-5 gap-1">
              {aging.map((a) => (
                <span key={a.key} className="flex flex-col text-[11px] leading-tight text-ink-3">
                  {a.label}
                  <b className="text-[12px] text-ink tabular-nums">{money(a.value, cur)}</b>
                </span>
              ))}
            </div>
          </Section>
          <Section title={`Invoices (${d.invoices.length})`}>
            {d.invoices.length ? (
              d.invoices.slice(0, 30).map((i) => (
                <button key={i.id} type="button" onClick={() => onOpenInvoice(i.id)} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className={i.number ? 'text-ink' : 'text-ink-3'}>
                      {i.number ?? 'Draft'}
                      {i.type === 'credit_note' ? ' · credit note' : i.type === 'debit_note' ? ' · debit note' : ''}
                    </b>
                    <span className="text-[11.5px] text-ink-3">{[i.issue_date && i.number ? `issued ${dateLabel(i.issue_date)}` : null, i.due_date && i.due > 0 ? `due ${dateLabel(i.due_date)}` : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <StatusChip status={i.status} />
                  <b className="w-[110px] text-right text-ink tabular-nums">{amount(i.due > 0 ? i.due : i.total, i.currency)}</b>
                </button>
              ))
            ) : (
              <span className="text-[12.5px] text-ink-3">None.</span>
            )}
          </Section>
          <Section title={`Payments (${d.payments.length})`}>
            {d.payments.length ? (
              d.payments.slice(0, 20).map((p) => (
                <button key={p.id} type="button" onClick={() => onOpenPayment(p.id)} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                  <b className="flex-1 text-ink">{p.reference}</b>
                  <span className="text-ink-3">{dateLabel(p.paid_on)}</span>
                  <b className={cx('w-[110px] text-right tabular-nums', p.direction === 'out' ? 'text-danger' : 'text-ink')}>
                    {p.direction === 'out' ? '− ' : ''}
                    {amount(p.amount, p.currency)}
                  </b>
                </button>
              ))
            ) : (
              <span className="text-[12.5px] text-ink-3">None.</span>
            )}
          </Section>
          <Section title={`Recurring (${d.recurring.length})`}>
            {d.recurring.length ? (
              d.recurring.map((r) => (
                <button key={r.id} type="button" onClick={() => onOpenProfile(r.id)} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                  <b className="flex-1 text-ink">{r.name}</b>
                  <span className="text-ink-3">
                    {frequencyLabel(r.frequency)} · {r.status === 'active' && r.next_run_on ? `next ${dateLabel(r.next_run_on)}` : r.status}
                  </span>
                </button>
              ))
            ) : (
              <span className="text-[12.5px] text-ink-3">None.</span>
            )}
          </Section>
          {subs ? (
            <button type="button" className="flex items-center gap-1.5 self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: `/subscriptions?client=${d.customer.id}` })}>
              Their subscriptions <Icon name="external" size={12} />
            </button>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}
