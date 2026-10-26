import { useQuery } from '@tanstack/react-query';
import type { AmcView } from '@shared/amc';
import { ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { K, label, read, type Dashboard as Data, type Row } from './api';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * D-01 the desktop dashboard (WS-AMC-SRS-001 §15): the tiles the server counts (`GET /api/amc/dashboard`) — contracts,
 * today's and overdue visits, open requests against their service levels, warranties — and its three short lists:
 * renewals soonest ending, visits longest overdue, requests needing attention. Each tile opens its list.
 */
export default function Dashboard({ onView, onRequest }: { onView: (v: AmcView) => void; onRequest: (id: number) => void }) {
  const q = useQuery({ queryKey: K.dashboard, queryFn: ({ signal }) => read<Data>('/dashboard', undefined, signal), refetchInterval: 120_000 });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <div className="m-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;
  const d = q.data.data ?? {};
  const tile = (title: string, value: number | undefined, sub: string, view: AmcView, icon: string, tone: StatTone) => (
    <StatCard key={title} label={title} value={value ?? 0} sub={sub} icon={icon} tone={tone} onClick={() => onView(view)} />
  );
  const r = d.requests;
  const v = d.visits;
  const c = d.contracts;
  const w = d.warranties;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <h1 className="text-[18px] font-bold">AMC & Service</h1>
        {q.data.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
      </div>
      <StatGrid label="Figures" min={200}>
        {tile('Open requests', r?.open, `${r?.unassigned ?? 0} unassigned · ${r?.approval ?? 0} need approval`, 'requests', 'inbox', 'blue')}
        {tile('SLA', (r?.at_risk ?? 0) + (r?.breached ?? 0), `${r?.at_risk ?? 0} at risk · ${r?.breached ?? 0} breached`, 'requests', 'gauge', r?.breached ? 'red' : r?.at_risk ? 'amber' : 'neutral')}
        {tile('Visits today', v?.today, `${v?.overdue ?? 0} overdue · ${v?.scheduled ?? 0} booked`, 'dispatch', 'truck', v?.overdue ? 'amber' : 'violet')}
        {tile('Contracts', c?.active, `${c?.renewal_due ?? 0} renewals due · ${c?.waiting ?? 0} waiting`, 'contracts', 'file-check', 'cyan')}
        {tile('Warranties', w?.active, `${w?.expiring ?? 0} expiring · ${w?.claim ?? 0} in claim`, 'warranties', 'shield-check', 'green')}
      </StatGrid>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Short title="Needs attention" rows={d.attention} main="subject" sub="client" onOpen={onRequest} />
        <Short title="Overdue visits" rows={d.overdue} main="label" sub="client" onOpen={() => onView('dispatch')} />
        <Short title="Renewals due" rows={d.renewals} main="title" sub="ends_on" onOpen={() => onView('renewals')} />
      </div>
    </div>
  );
}

function Short({ title, rows, main, sub, onOpen }: { title: string; rows?: Row[]; main: string; sub: string; onOpen: (id: number) => void }) {
  return (
    <section aria-label={title} className="rounded-[10px] border border-line bg-surface">
      <h2 className="border-b border-line px-3 py-2 text-[13px] font-bold">{title}</h2>
      {rows?.length ? (
        <ul>
          {rows.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => onOpen(x.id)} className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-subtle">
                <span className="truncate text-[13px] font-semibold">{label(x.number)} · {label(x[main] ?? x.kind_label)}</span>
                <span className="truncate text-[12px] text-ink-3">{label(x[sub])}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="px-3 py-3 text-[12.5px] text-ink-3">Nothing here.</p>}
    </section>
  );
}
