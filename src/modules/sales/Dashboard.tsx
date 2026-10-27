import type { UseQueryResult } from '@tanstack/react-query';
import { dateLabel } from '../../core/time';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Empty, Kpi, PageHead, Panel } from '../hr/parts';
import { MOVING, SOURCE, statusOf, type Overview } from './api';
import { money, PriorityPill, StatusPill } from './parts';
import type { SalesView } from './Rail';
import { StatGrid } from '../../components/StatCard';

/**
 * The Orders dashboard (OmsDashboard): how many, how much is still open (per
 * currency — the server's single total adds rupees to dollars), where the
 * moving orders stand, what waits on a person, and where orders come from.
 * The server refreshes it every thirty seconds.
 */
export default function Dashboard({ overview, onOpen, onList, onPick }: {
  org: string;
  overview: UseQueryResult<Overview>;
  onOpen: (id: number) => void;
  onList: (status: string | null) => void;
  onPick: (v: SalesView, status?: string | null) => void;
}) {
  if (overview.isLoading) return <Spinner />;
  if (overview.error) return <ErrorNote error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data!;
  const moving = o.stages.filter((s) => MOVING.includes(s.status) || s.status === 'pending_approval' || s.status === 'approved');
  const stillMoving = moving.reduce((n, s) => n + s.count, 0);
  const most = Math.max(1, ...moving.map((s) => s.count));
  const open = o.open_by_currency ?? [];
  const done = o.completed_by_currency ?? [];
  const finished = o.delivered + o.completed;
  const byCur = (rows: Array<{ currency: string; value: number }>) => (rows.length ? rows.map((r) => money(r.value, r.currency)).join(' · ') : '—');
  const sources = [...o.sources].sort((a, b) => b.count - a.count);
  const topSource = Math.max(1, ...sources.map((s) => s.count));
  const need: Array<[number, string, () => void, 'amber' | 'red']> = [
    [o.attention.pending_approval, 'waiting for approval', () => onList('pending_approval'), 'amber'],
    [o.attention.unassigned, 'in progress with nobody assigned', () => onList(null), 'amber'],
    // Past their expected date (Ph1): the list narrowed to them.
    [o.attention.overdue ?? 0, 'past their expected date', () => onPick('orders', '__overdue'), 'red'],
    [o.attention.stale, 'open for more than 30 days', () => onList(null), 'red'],
    [o.attention.integration_failures, 'hand-offs failed or retrying', () => onList(null), 'red'],
  ];

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Orders" sub="Where every order stands, and what is waiting on somebody. Refreshed every 30 seconds." />
      <StatGrid>
        <Kpi icon="cart" tone="blue" label="Orders" value={o.total} sub={`${o.today} raised today`} />
        <Kpi icon="truck" tone="amber" label="Still moving" value={stillMoving} sub="not yet delivered or invoiced" onClick={() => onList(null)} />
        <Kpi icon="coins" tone="violet" label="Open order value" value={open.length === 1 ? money(open[0]!.value, open[0]!.currency) : open.length ? `${open.length} currencies` : '—'} sub={open.length > 1 ? byCur(open) : `${open[0]?.orders ?? 0} orders committed`} />
        <Kpi icon="package-check" tone="green" label="Delivered or completed" value={finished} sub={done.length ? `${byCur(done)} finished` : 'none yet'} />
      </StatGrid>
      <div className="grid grid-cols-3 gap-3">
        <Panel title="Where the orders are" sub={`${stillMoving} still moving`} className="col-span-2" bodyClassName="flex flex-col gap-2 px-3.5 py-3">
          {moving.map((s) => (
            <button key={s.status} type="button" onClick={() => onList(s.status)} className="flex items-center gap-3 rounded-[8px] px-1 py-0.5 text-left hover:bg-subtle">
              <span className="w-[140px] shrink-0 text-[12.5px] text-ink">{statusOf(s.status).label}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-[5px] bg-subtle">
                <span className="block h-2.5 rounded-[5px]" style={{ width: `${(s.count / most) * 100}%`, background: statusOf(s.status).dot }} />
              </span>
              <b className="w-8 text-right text-[12.5px] text-ink tabular-nums">{s.count}</b>
              <span className="w-[90px] text-right text-[12px] text-ink-3 tabular-nums">{s.count ? money(s.value) : ''}</span>
            </button>
          ))}
          <p className="m-0 pt-1 text-[12px] text-ink-3">
            Left the pipeline · {o.delivered} delivered · {o.completed} completed · {o.cancelled} cancelled · {o.returned} returned
          </p>
        </Panel>
        <Panel title="Needs a person" bodyClassName="flex flex-col">
          {need.filter(([n]) => n > 0).length ? (
            need
              .filter(([n]) => n > 0)
              .map(([n, label, go, tone]) => (
                <button key={label} type="button" onClick={go} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-subtle">
                  <b className={cx('text-[18px] tabular-nums', tone === 'red' ? 'text-danger' : 'text-warning-ink dark:text-warning')}>{n}</b>
                  <span className="text-[12.5px] text-ink">{label}</span>
                </button>
              ))
          ) : (
            <Empty text="Nothing is waiting on anybody." />
          )}
        </Panel>
        <Panel title="Latest orders" action={<button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => onPick('orders')}>See all</button>} className="col-span-2" bodyClassName="flex flex-col">
          {o.recent.length ? (
            o.recent.map((r) => (
              <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="flex items-center gap-3 border-b border-line/70 px-3.5 py-2 text-left last:border-b-0 hover:bg-subtle">
                <span className="flex w-[160px] shrink-0 flex-col">
                  <b className="text-[12.5px] text-ink">{r.number}</b>
                  <span className="truncate text-[11.5px] text-ink-3">{r.client ?? 'No customer'}</span>
                </span>
                <PriorityPill priority={r.priority} />
                <StatusPill status={r.status} label={r.status_label} />
                <span className="flex-1 text-[12px] text-ink-3">{r.date ? dateLabel(r.date) : ''}</span>
                <b className="text-[12.5px] text-ink tabular-nums">{money(r.total, r.currency)}</b>
              </button>
            ))
          ) : (
            <Empty text="No orders yet." />
          )}
        </Panel>
        <Panel title="Where orders come from" bodyClassName="flex flex-col gap-2 px-3.5 py-3">
          {sources.length ? (
            sources.map((s) => (
              <div key={s.source} className="flex flex-col gap-1">
                <span className="flex text-[12.5px] text-ink">
                  <span className="flex-1">{SOURCE[s.source] ?? s.source}</span>
                  <b className="tabular-nums">{s.count}</b>
                </span>
                <span className="h-2 overflow-hidden rounded-[4px] bg-subtle">
                  <span className="block h-2 rounded-[4px] bg-teal" style={{ width: `${(s.count / topSource) * 100}%` }} />
                </span>
              </div>
            ))
          ) : (
            <Empty text="No orders yet." />
          )}
        </Panel>
      </div>
    </div>
  );
}
