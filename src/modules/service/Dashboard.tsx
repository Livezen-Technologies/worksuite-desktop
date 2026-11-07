import { money } from '@shared/service';
import { ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { useOverview } from './api';
import { StatusChip } from './parts';

/** Repair KPIs, revenue and workload (blueprint §1 Dashboard). */
export default function Dashboard({ onJobs }: { onJobs: (scope: string) => void }) {
  const o = useOverview();
  if (o.isPending) return <Spinner />;
  if (o.isError) return <div className="p-4"><ErrorNote error={o.error} onRetry={() => void o.refetch()} /></div>;
  const d = o.data.data;
  const tiles: Array<[string, number, string]> = [['Active repairs', d.active, 'active'], ['Awaiting approval', d.awaiting_approval, 'awaiting_approval'], ['Ready for pickup', d.ready_for_pickup, 'ready_for_pickup'], ['Overdue jobs', d.overdue, 'overdue']];
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2"><h1 className="text-[18px] font-bold">Service & Repair</h1>{o.data.offline ? <OfflineNote cachedAt={o.data.cachedAt} /> : null}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([l, n, s]) => (
          <button key={l} type="button" onClick={() => onJobs(s)} className="rounded-[10px] border border-line bg-surface p-3 text-left hover:bg-subtle">
            <div className="text-[12px] text-ink-3">{l}</div>
            <div className={`text-[26px] font-bold ${s === 'overdue' && n > 0 ? 'text-danger' : ''}`}>{n}</div>
          </button>
        ))}
      </div>
      {d.revenue_today != null || d.revenue_month != null ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[10px] border border-line bg-surface p-3"><div className="text-[12px] text-ink-3">Revenue today</div><div className="text-[18px] font-bold">{money(d.revenue_today, d.currency ?? 'LKR')}</div></div>
          <div className="rounded-[10px] border border-line bg-surface p-3"><div className="text-[12px] text-ink-3">Revenue this month</div><div className="text-[18px] font-bold">{money(d.revenue_month, d.currency ?? 'LKR')}</div></div>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {d.by_status ? (
          <section className="rounded-[10px] border border-line bg-surface p-3">
            <h2 className="mb-2 text-[13px] font-bold">By status</h2>
            {Object.entries(d.by_status).map(([s, n]) => (
              <button key={s} type="button" onClick={() => onJobs(s)} className="flex w-full items-center justify-between py-1 text-[13px] hover:bg-subtle"><StatusChip status={s} /><span className="font-semibold">{n}</span></button>
            ))}
          </section>
        ) : null}
        {d.by_technician?.length ? (
          <section className="rounded-[10px] border border-line bg-surface p-3">
            <h2 className="mb-2 text-[13px] font-bold">Technician workload</h2>
            {d.by_technician.map((t) => <div key={t.name} className="flex justify-between py-1 text-[13px]"><span>{t.name}</span><span className="font-semibold">{t.open} open</span></div>)}
          </section>
        ) : null}
      </div>
    </div>
  );
}
