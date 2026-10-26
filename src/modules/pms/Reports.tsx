import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Spinner } from '../../components/ui';
import { input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, K, labelled, money, pGet, type Kpi, type ReportCatalogue } from './api';
import { NoAccess, usePms } from './parts';
import { StatCard, StatGrid, type StatTone } from '../../components/StatCard';

/**
 * Reports and KPIs (§13.6–13.7): the KPIs as the SRS defines them —
 * occupancy, ADR, RevPAR, no-show and cancellation rates — worked out by the
 * server per business date (with only `pms.dashboard.view` the server answers
 * today alone), and the reports this person may run, by group. A report
 * opens on its own screen with its filters and exports. Online only.
 */
export default function Reports() {
  const pms = usePms();
  const pid = pms.property.id;
  const runs = pms.may('pms.reports.view');
  const cat = useQuery({ queryKey: K.reports(pid), queryFn: ({ signal }) => pGet<ReportCatalogue>(`/properties/${pid}/reports`, undefined, signal), enabled: runs && pms.online });

  if (!pms.mayAny('pms.reports.view', 'pms.dashboard.view')) return <NoAccess what="Reports are shown to people who may read them." />;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Reports & KPIs" sub={pms.property.name} />
      {!pms.online ? <p className="text-[13px] text-ink-3">Reports show when WorkSuite is back: the figures are the server’s.</p> : null}
      {pms.online ? <Kpis /> : null}
      {runs && pms.online ? (
        cat.isLoading ? (
          <Spinner />
        ) : cat.error ? (
          <ErrorNote error={cat.error} onRetry={() => void cat.refetch()} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {labelled(cat.data?.groups).map((g) => {
              const rs = (cat.data?.reports ?? []).filter((r) => r.group === g.value);
              if (rs.length === 0) return null;
              return (
                <Section key={g.value} title={g.label}>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                    {rs.map((r) => (
                      <li key={r.key}>
                        <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => pms.open({ kind: 'report', key: r.key })}>
                          {r.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}

function Tile({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon?: string; tone?: StatTone }) {
  return <StatCard size="sm" label={label} value={value} sub={sub} icon={icon} tone={tone} />;
}

/** The KPIs over a period (at most the server's limit); a person with the dashboard alone sees today. */
function Kpis() {
  const pms = usePms();
  const pid = pms.property.id;
  const period = pms.may('pms.reports.view');
  const [from, setFrom] = useState(pms.businessDate);
  const [to, setTo] = useState(pms.businessDate);
  const q = useQuery({ queryKey: K.kpis(pid, from, to), queryFn: ({ signal }) => pGet<{ days: Kpi[]; totals: Kpi; currency: string }>(`/properties/${pid}/kpis`, { from: from || undefined, to: to || undefined }, signal) });
  const t = q.data?.totals;
  const cur = q.data?.currency ?? pms.property.currency;
  return (
    <Section
      title="KPIs"
      action={
        period ? (
          <span className="flex gap-2">
            <input aria-label="KPIs from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} w-40`} />
            <input aria-label="KPIs to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} w-40`} />
          </span>
        ) : (
          <span className="text-[12px] text-ink-3">Today</span>
        )
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !t ? (
        <ErrorNote error={q.error ?? new Error('The KPIs could not be read.')} />
      ) : (
        <>
          <StatGrid min={170}>
            <Tile icon="bed" tone="blue" label="Occupancy" value={`${t.occupancy_pct}%`} sub={`${t.rooms_sold} of ${t.rooms_available} room nights`} />
            <Tile icon="banknote" tone="violet" label="ADR" value={money(t.adr, cur)} />
            <Tile icon="chart" tone="cyan" label="RevPAR" value={money(t.revpar, cur)} />
            <Tile icon="coins" tone="green" label="Room revenue" value={money(t.room_revenue, cur)} />
            <Tile icon="concierge" tone="neutral" label="Complimentary" value={String(t.complimentary)} sub={`House use ${t.house_use}`} />
            <Tile icon="user-x" tone="amber" label="No-show rate" value={`${t.no_show_rate}%`} sub={`${t.no_shows} of ${t.arrivals_expected}`} />
            <Tile icon="x-circle" tone="red" label="Cancellation rate" value={`${t.cancellation_rate}%`} sub={`${t.cancellations} of ${t.created} made`} />
          </StatGrid>
          {(q.data?.days.length ?? 0) > 1 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12.5px]">
                <thead className="text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <tr>
                    <th className="py-1">Date</th>
                    <th className="text-right">Available</th>
                    <th className="text-right">Sold</th>
                    <th className="text-right">Occ.</th>
                    <th className="text-right">ADR</th>
                    <th className="text-right">RevPAR</th>
                    <th className="text-right">Arrivals</th>
                    <th className="text-right">Departures</th>
                    <th className="text-right">Stayovers</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data!.days.map((d) => (
                    <tr key={d.date} className="border-t border-line tabular-nums">
                      <td className="py-1">{day(d.date ?? null)}</td>
                      <td className="text-right">{d.rooms_available}</td>
                      <td className="text-right">{d.rooms_sold}</td>
                      <td className="text-right">{d.occupancy_pct}%</td>
                      <td className="text-right">{money(d.adr, cur)}</td>
                      <td className="text-right">{money(d.revpar, cur)}</td>
                      <td className="text-right">{d.arrivals}</td>
                      <td className="text-right">{d.departures}</td>
                      <td className="text-right">{d.stayovers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
