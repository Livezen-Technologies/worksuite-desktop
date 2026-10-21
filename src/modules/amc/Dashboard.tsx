import { useQuery } from '@tanstack/react-query';
import type { AmcView } from '@shared/amc';
import { ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { K, label, read, type Dashboard as Data, type Row } from './api';

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
  const tile = (title: string, value: number | undefined, sub: string, view: AmcView, tone = '') => (
    <button type="button" onClick={() => onView(view)} className="flex min-w-[150px] flex-1 flex-col items-start rounded-[10px] border border-line bg-surface px-3.5 py-3 text-left hover:border-primary">
      <span className="text-[11.5px] font-semibold text-ink-3 uppercase">{title}</span>
      <span className={`text-[24px] font-bold tabular-nums ${tone}`}>{value ?? 0}</span>
      <span className="text-[12px] text-ink-2">{sub}</span>
    </button>
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
      <section aria-label="Figures" className="flex flex-wrap gap-3">
        {tile('Open requests', r?.open, `${r?.unassigned ?? 0} unassigned · ${r?.approval ?? 0} need approval`, 'requests')}
        {tile('SLA', (r?.at_risk ?? 0) + (r?.breached ?? 0), `${r?.at_risk ?? 0} at risk · ${r?.breached ?? 0} breached`, 'requests', r?.breached ? 'text-danger' : '')}
        {tile('Visits today', v?.today, `${v?.overdue ?? 0} overdue · ${v?.scheduled ?? 0} booked`, 'dispatch', v?.overdue ? 'text-warning' : '')}
        {tile('Contracts', c?.active, `${c?.renewal_due ?? 0} renewals due · ${c?.waiting ?? 0} waiting`, 'contracts')}
        {tile('Warranties', w?.active, `${w?.expiring ?? 0} expiring · ${w?.claim ?? 0} in claim`, 'warranties')}
      </section>
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
