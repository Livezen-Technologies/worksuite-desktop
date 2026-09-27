import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { call } from '../../core/bridge';
import { dateLabel, relative } from '../../core/time';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, Kpi, PageHead, Panel } from '../hr/parts';
import { agingParts, amount, type Dashboard as Data } from './api';
import { money } from './parts';

/**
 * The Billing dashboard (BillDashboard): what is owed and how late, what was
 * billed and received this month, what is waiting on somebody (drafts, money
 * on account, unspent credit, recurring invoices due), how old the money is,
 * six months of billed against received, and the lists worth acting on.
 * Totals are in the base currency; each invoice in a list is in its own.
 */
const KIND_ICON: Record<string, string> = { payment: 'wallet', status: 'check-circle', email: 'send', credit: 'undo', file: 'file', view: 'eye', note: 'compose', system: 'settings' };

export default function Dashboard({ data, onOpen, onNew, onPay, onList, canCreate, canPay }: {
  data: UseQueryResult<Data>;
  onOpen: (id: number) => void;
  onNew: () => void;
  onPay: () => void;
  /** To the invoice list, narrowed ('overdue', 'draft', 'unpaid'). */
  onList: (narrow: 'overdue' | 'draft' | 'unpaid' | null) => void;
  canCreate: boolean;
  canPay: boolean;
}) {
  if (data.isLoading) return <Spinner />;
  if (data.error) return <ErrorNote error={data.error} onRetry={() => void data.refetch()} />;
  const d = data.data!;
  const k = d.kpi;
  const cur = d.base_currency;
  const aging = agingParts(d.aging);
  const trend = d.trend ?? [];
  const top = Math.max(1, ...trend.flatMap((m) => [m.billed, m.received]));
  const last = trend[trend.length - 1];
  const recurringDue = (d.upcoming_recurring ?? []).filter((r) => r.due_now).length;
  const browser = () => void call('app:openInBrowser', { path: '/billing' });

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Billing">
        {canCreate ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            <Icon name="plus" size={15} /> New invoice
          </button>
        ) : null}
        {canPay ? (
          <button type="button" className={btn} onClick={onPay}>
            Record payment
          </button>
        ) : null}
        <button type="button" className={btn} title="Opens in your browser" onClick={browser}>
          Reports <Icon name="external" size={12} className="text-ink-3" />
        </button>
      </PageHead>
      <div className="grid grid-cols-4 gap-2.5">
        <Kpi label="Outstanding" value={money(k.outstanding, cur)} sub={`${k.outstanding_count} ${k.outstanding_count === 1 ? 'invoice' : 'invoices'}`} onClick={() => onList('unpaid')} />
        <Kpi label="Overdue" value={money(k.overdue, cur)} sub={`${k.overdue_count} ${k.overdue_count === 1 ? 'invoice' : 'invoices'}`} tone={k.overdue > 0 ? 'red' : undefined} onClick={() => onList('overdue')} />
        <Kpi label="Billed this month" value={money(k.billed_month, cur)} sub={`${k.billed_month_count} issued`} />
        <Kpi label="Received this month" value={money(k.received_month, cur)} sub={`${money(k.received_today, cur)} today`} />
        <Kpi label="Drafts" value={k.draft_count} sub={`${money(k.draft, cur)} not yet issued`} tone={k.draft_count ? 'amber' : undefined} onClick={() => onList('draft')} />
        <Kpi label="Unallocated payments" value={k.unallocated_count} sub={`${money(k.unallocated, cur)} on account`} />
        <Kpi label="Credit balance" value={money(k.credit_balance, cur)} sub="unspent credit notes" />
        <Kpi label="Recurring due" value={recurringDue} tone={recurringDue ? 'red' : undefined} sub={recurringDue ? 'raise them from Recurring' : 'nothing due now'} />
      </div>
      <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-3">
        <Panel
          title="How old the money is"
          action={
            <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" title="Opens in your browser" onClick={browser}>
              By customer
            </button>
          }
          bodyClassName="flex flex-col gap-2 px-3.5 py-3"
        >
          <div className="flex h-3.5 overflow-hidden rounded-[7px] bg-subtle" role="img" aria-label="Ageing of what is owed">
            {aging.map((a) => (a.pct > 0 ? <span key={a.key} style={{ width: `${a.pct}%`, background: a.colour }} title={`${a.label}: ${money(a.value, cur)}`} /> : null))}
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {aging.map((a) => (
              <span key={a.key} className="flex min-w-0 flex-col">
                <span className="flex items-start gap-[5px] text-[11.5px] leading-tight text-ink-3">
                  <span className="mt-[3px] h-2 w-2 shrink-0 rounded-[2px]" style={{ background: a.colour }} />
                  <span>{a.label}</span>
                </span>
                <b className="text-[13px] text-ink tabular-nums">{money(a.value, cur)}</b>
              </span>
            ))}
          </div>
        </Panel>
        <Panel title="Billed and received" bodyClassName="flex flex-col">
          <div className="flex h-[118px] items-end gap-2.5 px-3.5 pt-3" role="img" aria-label="Billed and received, the last six months">
            {trend.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: billed ${money(m.billed, cur)}, received ${money(m.received, cur)}`}>
                <div className="flex h-[92px] items-end gap-[3px]">
                  <span className="w-3 rounded-t-[3px] bg-[#7C3AED]" style={{ height: `${(m.billed / top) * 92}px` }} />
                  <span className="w-3 rounded-t-[3px] bg-[#16A34A]" style={{ height: `${(m.received / top) * 92}px` }} />
                </div>
                <span className="text-[11px] text-ink-3">{m.month.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="px-3.5 pt-1.5 pb-2.5 text-[11.5px] text-ink-2">
            {last ? `${last.month.slice(0, 3)} · billed ${money(last.billed, cur)} · received ${money(last.received, cur)}` : 'Nothing billed yet.'}
            <span className="ml-2 inline-flex items-center gap-1 text-ink-3">
              <span className="h-2 w-2 rounded-[2px] bg-[#7C3AED]" /> billed <span className="ml-1 h-2 w-2 rounded-[2px] bg-[#16A34A]" /> received
            </span>
          </div>
        </Panel>
        <ListPanel title="Recurring" empty="No recurring invoice is due in the next 30 days.">
          {(d.upcoming_recurring ?? []).slice(0, 5).map((r) => (
            <Line key={r.id} title={r.name} sub={r.client ?? 'No customer'} right={r.due_now ? <span className="rounded-[10px] bg-danger-bg px-2 py-0.5 text-[11.5px] font-bold text-danger">due now</span> : dateLabel(r.next_run_on)} onClick={browser} />
          ))}
        </ListPanel>
        <ListPanel title="Longest overdue" empty="Nothing is overdue.">
          {(d.most_overdue ?? []).slice(0, 5).map((r) => (
            <Line key={r.id} title={r.number} sub={`${r.client ?? 'No customer'} · ${r.days} ${r.days === 1 ? 'day' : 'days'} late`} right={amount(r.due, r.currency)} onClick={() => onOpen(r.id)} />
          ))}
        </ListPanel>
        <ListPanel title="Due in the next week" empty="Nothing falls due in the next seven days.">
          {(d.due_soon ?? []).slice(0, 5).map((r) => (
            <Line key={r.id} title={r.number} sub={`${r.client ?? 'No customer'} · due ${dateLabel(r.due_date)}`} right={amount(r.due, r.currency)} onClick={() => onOpen(r.id)} />
          ))}
        </ListPanel>
        <ListPanel title="Recent activity" empty="Nothing has happened in Billing yet.">
          {(d.recent ?? []).slice(0, 6).map((r, i) => (
            <Line
              key={`${r.subject_type}-${r.subject_id}-${i}`}
              icon={KIND_ICON[r.kind] ?? 'activity'}
              title={r.title}
              sub={`${r.author ?? 'System'} · ${relative(r.at)}`}
              onClick={r.subject_type === 'invoice' ? () => onOpen(r.subject_id) : undefined}
            />
          ))}
        </ListPanel>
      </div>
    </div>
  );
}

function ListPanel({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <Panel title={title} bodyClassName="flex flex-col">
      {children.length ? children : <Empty text={empty} />}
    </Panel>
  );
}

function Line({ title, sub, right, icon, onClick }: { title: ReactNode; sub: ReactNode; right?: ReactNode; icon?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag {...(onClick ? { type: 'button' as const, onClick } : {})} className={cx('flex items-center gap-2 border-b border-line/60 px-3.5 py-2 text-left last:border-b-0', onClick && 'hover:bg-subtle')}>
      {icon ? <Icon name={icon} size={14} className="shrink-0 text-ink-3" /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[12.5px] text-ink">{title}</b>
        <span className="truncate text-[11.5px] text-ink-3">{sub}</span>
      </span>
      {right ? <span className="shrink-0 text-[12px] font-bold whitespace-nowrap text-ink tabular-nums">{right}</span> : null}
    </Tag>
  );
}
