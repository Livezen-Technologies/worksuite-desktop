import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { dateLabel, relative, timeLabel } from '../../core/time';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, Empty, PageHead, Panel } from '../hr/parts';
import { agingParts, amount, type Dashboard as Data } from './api';
import { money } from './parts';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * The Billing dashboard (D01, BillDashboard): eight tiles — what is owed and
 * how late, billed and received this month, drafts, money on account, unspent
 * credit and recurring invoices due — then how old the money is beside the
 * longest overdue, and below them six months of billed against received, what
 * falls due this week, recurring and recent activity. Totals are in the base
 * currency, said under the title with when it was read; each invoice in a list
 * is in its own currency.
 */
const KIND_ICON: Record<string, string> = { payment: 'wallet', status: 'check-circle', email: 'send', credit: 'undo', file: 'file', view: 'eye', note: 'compose', system: 'settings' };

export default function Dashboard({
  data,
  onOpen,
  onPay,
  onList,
  onOpenProfile,
  canPay,
}: {
  data: UseQueryResult<Data>;
  onOpen: (id: number) => void;
  /** Kept for the shell's callers; the rail holds New invoice (D01). */
  onNew?: () => void;
  onPay: () => void;
  /** To the invoice list, narrowed ('overdue', 'draft', 'unpaid'). */
  onList: (narrow: 'overdue' | 'draft' | 'unpaid' | null) => void;
  onOpenProfile?: (id: number) => void;
  canCreate?: boolean;
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
  const updated = data.dataUpdatedAt ? timeLabel(new Date(data.dataUpdatedAt).toISOString()) : null;
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Dashboard" sub={`${cur}, the base currency${updated ? ` · updated ${updated}` : ''}`}>
        {canPay ? (
          <button type="button" className={btn} onClick={onPay}>
            Record payment
          </button>
        ) : null}
      </PageHead>
      <StatGrid>
        <Tile icon="hourglass" label="Outstanding" value={money(k.outstanding, cur)} sub={n(k.outstanding_count, 'invoice', 'invoices')} tone="primary" onClick={() => onList('unpaid')} />
        <Tile icon="alert" label="Overdue" value={money(k.overdue, cur)} sub={n(k.overdue_count, 'invoice', 'invoices')} tone={k.overdue > 0 ? 'red' : undefined} onClick={() => onList('overdue')} />
        <Tile icon="receipt" tone="violet" label="Billed this month" value={money(k.billed_month, cur)} sub={n(k.billed_month_count, 'invoice', 'invoices')} />
        <Tile icon="banknote" label="Received this month" value={money(k.received_month, cur)} sub={`Today ${money(k.received_today, cur)}`} tone="green" />
        <Tile icon="compose" label="Drafts" value={k.draft_count} sub={`${money(k.draft, cur)} not issued`} tone={k.draft_count ? 'amber' : undefined} onClick={() => onList('draft')} />
        <Tile icon="wallet" tone="cyan" label="Unallocated" value={money(k.unallocated, cur)} sub={n(k.unallocated_count, 'payment', 'payments')} />
        <Tile icon="piggy-bank" tone="violet" label="Credit balance" value={money(k.credit_balance, cur)} sub="unspent credit notes" />
        <Tile icon="repeat" label="Recurring due" value={recurringDue} sub={recurringDue ? 'raise them from Recurring' : 'next 30 days'} tone={recurringDue ? 'red' : undefined} />
      </StatGrid>
      <div className="grid grid-cols-2 gap-2.5">
        <section className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3.5">
          <b className="text-ink">How old the money is</b>
          <div className="flex h-3 overflow-hidden rounded-[6px] bg-subtle" role="img" aria-label="Ageing of what is owed">
            {aging.map((a) => (a.pct > 0 ? <span key={a.key} style={{ width: `${a.pct}%`, background: a.colour }} title={`${a.label}: ${money(a.value, cur)}`} /> : null))}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-[5px] text-[12px]">
            {aging.map((a) => (
              <span key={a.key} className="contents">
                <span className="flex items-center gap-[6px] text-ink">
                  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: a.colour }} />
                  {a.label}
                </span>
                <b className={cx('text-right tabular-nums', a.key === 'over_90' && a.value > 0 ? 'text-danger' : 'text-ink')}>{money(a.value, cur)}</b>
              </span>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-3.5">
          <b className="mb-1 text-ink">Longest overdue</b>
          {(d.most_overdue ?? []).length ? (
            (d.most_overdue ?? []).slice(0, 5).map((r) => (
              <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="flex justify-between gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60">
                <span className="min-w-0 truncate">
                  <b className="text-primary">{r.number}</b> <span className="text-ink">· {r.client ?? 'No customer'}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap">
                  <b className="text-ink tabular-nums">{amount(r.due, r.currency)}</b> <span className="font-semibold text-danger">{r.days}d</span>
                </span>
              </button>
            ))
          ) : (
            <Empty text="Nothing is overdue." />
          )}
        </section>
      </div>
      <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-3">
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
        <ListPanel title="Due in the next week" empty="Nothing falls due in the next seven days.">
          {(d.due_soon ?? []).slice(0, 5).map((r) => (
            <Line key={r.id} title={r.number} sub={`${r.client ?? 'No customer'} · due ${dateLabel(r.due_date)}`} right={amount(r.due, r.currency)} onClick={() => onOpen(r.id)} />
          ))}
        </ListPanel>
        <ListPanel title="Recurring" empty="No recurring invoice is due in the next 30 days.">
          {(d.upcoming_recurring ?? []).slice(0, 5).map((r) => (
            <Line
              key={r.id}
              title={r.name}
              sub={r.client ?? 'No customer'}
              right={r.due_now ? <span className="rounded-[10px] bg-danger-bg px-2 py-0.5 text-[11.5px] font-bold text-danger">due now</span> : dateLabel(r.next_run_on)}
              onClick={onOpenProfile ? () => onOpenProfile(r.id) : undefined}
            />
          ))}
        </ListPanel>
      </div>
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
  );
}

const TONE: Record<string, StatTone> = { primary: 'blue', red: 'red', green: 'green', amber: 'amber' };

/** A D01 tile: the label in small capitals, the figure in its colour, a line under it. */
function Tile({ label, value, sub, tone, onClick, icon }: { label: string; value: ReactNode; sub: ReactNode; tone?: 'primary' | StatTone; onClick?: () => void; icon?: string }) {
  return <StatCard label={label} value={value} sub={sub} tone={tone ? (TONE[tone] ?? (tone as StatTone)) : undefined} onClick={onClick} icon={icon} />;
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
