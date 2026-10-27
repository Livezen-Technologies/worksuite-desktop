import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btnPrimary, Kpi, Panel } from '../../components/PageKit';
import { short, whole } from '../inventory/api';
import { Line, ListPanel } from '../../components/ListKit';
import type { PurchaseDashboard, QueueItem } from './api';
import { Head } from './parts';
import type { PurView } from './Rail';
import { StatGrid } from '../../components/StatCard';

/**
 * The Purchasing dashboard (S-01; the "Purchasing dashboard" design): what we have committed, what has arrived and
 * what we owe — the approvals waiting on me, deliveries due and late, goods received and not billed, money owed by
 * age, what was committed each month, where the money goes, and the documents that need attention. Every tile opens
 * its filtered list.
 */
const DOC: Record<QueueItem['doc'], string> = { order: 'Order', request: 'Request', return: 'Return', bill: 'Bill' };

export default function Dashboard({
  data,
  queue,
  currency,
  onGo,
  onOrder,
  onBill,
  onNewOrder,
}: {
  data: UseQueryResult<PurchaseDashboard>;
  queue: QueueItem[] | null;
  currency: string | null;
  onGo: (v: PurView, extra?: string) => void;
  onOrder: (id: number) => void;
  onBill: (id: number) => void;
  onNewOrder: (() => void) | null;
}) {
  const d = data.data;
  const cur = d?.currency ?? currency;
  if (data.isLoading) return <Spinner />;
  if (data.error || !d) return <ErrorNote error={data.error} onRetry={() => void data.refetch()} />;
  const late = d.attention.late_deliveries;
  const overdue = d.attention.overdue_bills;
  const pastDue = Object.entries(d.payables.buckets)
    .filter(([k]) => k !== 'current')
    .reduce((s, [, b]) => s + (b.amount || 0), 0);
  const months = d.spend.slice(-6);
  const top = Math.max(1, ...months.map((m) => m.committed || 0));
  const spendTotal = d.top_vendors.reduce((s, v) => s + (v.committed ?? 0), 0);
  const mine = queue?.length ?? 0;
  const notBilled = d.awaiting.billing;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {notBilled > 0 ? (
        <button type="button" onClick={() => onGo('bill')} className="rounded-[10px] border border-warning-line bg-warning-bg px-3.5 py-2 text-left text-[12.5px] text-warning-strong hover:underline dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          {notBilled} {notBilled === 1 ? 'order has' : 'orders have'} goods received that nobody has billed. Until the bill is entered, the cost is on the shelf but not in the ledger — enter it.
        </button>
      ) : null}
      <Head title="Dashboard" sub={`What we have committed, what has arrived, and what we owe${cur ? ` — in ${cur}` : ''}`}>
        {onNewOrder ? (
          <button type="button" className={btnPrimary} onClick={onNewOrder}>
            New purchase order
          </button>
        ) : null}
      </Head>
      <StatGrid min={200}>
        <Kpi icon="hourglass" label="Awaiting approval" value={d.awaiting.approval} sub={queue ? `${mine} waiting on you` : undefined} tone={mine ? 'amber' : undefined} onClick={() => onGo(mine ? 'appr' : 'po', mine ? '' : '&st=pending')} />
        <Kpi icon="truck" tone="blue" label="Awaiting delivery" value={d.awaiting.receipt} sub={d.open_value !== null ? `${short(d.open_value, cur)} on order` : undefined} onClick={() => onGo('rcv')} />
        <Kpi icon="clock" label="Deliveries already late" value={late.length} sub={late.length ? `oldest ${Math.max(...late.map((x) => x.days_late))} days` : 'none'} tone={late.length ? 'red' : undefined} onClick={() => onGo('po')} />
        <Kpi icon="receipt" label="Received, not billed" value={notBilled} tone={notBilled ? 'amber' : undefined} onClick={() => onGo('bill')} />
        <Kpi icon="wallet" label="Owed to vendors" value={short(d.payables.total, cur)} sub={pastDue ? `${short(pastDue, cur)} past due` : 'nothing past due'} tone={pastDue ? 'red' : undefined} onClick={() => onGo('bill')} />
      </StatGrid>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Committed each month" sub={`Approved orders, by order date${cur ? ` · ${cur}` : ''}`} bodyClassName="flex items-end gap-3 px-4 py-3">
          {months.length ? (
            months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: ${whole(m.committed, cur)} · ${m.orders} orders`}>
                <span className="text-[11px] text-ink-3 tabular-nums">{short(m.committed, null)}</span>
                <span className="w-full rounded-t-[4px] bg-primary/80" style={{ height: `${Math.max(4, ((m.committed || 0) / top) * 110)}px` }} />
                <span className="text-[11px] text-ink-2">{m.month.slice(5) ? new Date(`${m.month}-01T00:00:00`).toLocaleString(undefined, { month: 'short' }) : m.month}</span>
              </div>
            ))
          ) : (
            <span className="text-[12.5px] text-ink-3">Nothing committed yet.</span>
          )}
        </Panel>
        <Panel title="Money owed, by age" bodyClassName="flex flex-col">
          {Object.entries(d.payables.buckets).map(([k, b]) => (
            <Line key={k} title={b.label} sub={`${b.count} ${b.count === 1 ? 'bill' : 'bills'}`} right={whole(b.amount, cur)} rightClass={k === 'current' ? 'text-ink' : 'text-danger'} onClick={() => onGo('bill')} />
          ))}
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
        <ListPanel title="Needs attention" empty="Nothing needs attention.">
          {[
            ...(queue ?? []).slice(0, 6).map((a) => (
              <Line key={`a${a.doc}${a.id}`} icon="check-check" title={`${DOC[a.doc]} ${a.number}`} sub={[a.vendor, a.step && a.steps ? `Your approval · step ${a.step} of ${a.steps}` : 'Your approval'].filter(Boolean).join(' · ')} right={a.total !== null ? whole(a.total, a.currency && a.currency !== cur ? a.currency : null) : ''} onClick={() => onGo('appr')} />
            )),
            ...late.slice(0, 6).map((o) => <Line key={`l${o.id}`} icon="truck" title={o.po_number} sub={[o.vendor, `${o.days_late} days late`].filter(Boolean).join(' · ')} right={whole(o.total, cur)} rightClass="text-danger" onClick={() => onOrder(o.id)} />),
            ...overdue.slice(0, 6).map((b) => <Line key={`b${b.id}`} icon="receipt" title={b.bill_number} sub={[b.vendor, `due ${b.days_late} days ago`].filter(Boolean).join(' · ')} right={whole(b.outstanding, cur)} rightClass="text-danger" onClick={() => onBill(b.id)} />),
          ]}
        </ListPanel>
        <Panel title="Where the money goes" sub="Top vendors by committed spend" bodyClassName="flex flex-col gap-1.5 px-4 py-3">
          {d.top_vendors.length ? (
            d.top_vendors.slice(0, 6).map((v) => {
              const share = spendTotal ? Math.round(((v.committed ?? 0) / spendTotal) * 100) : 0;
              return (
                <div key={v.id} className="flex flex-col gap-0.5">
                  <span className="flex text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate text-ink">{v.name}</span>
                    <b className="text-ink tabular-nums">{v.committed !== null ? `${share}%` : '—'}</b>
                  </span>
                  <span className="h-1.5 rounded-full bg-subtle">
                    <span className={cx('block h-1.5 rounded-full bg-primary/70')} style={{ width: `${share}%` }} />
                  </span>
                </div>
              );
            })
          ) : (
            <span className="text-[12.5px] text-ink-3">No orders yet.</span>
          )}
        </Panel>
      </div>
    </div>
  );
}
