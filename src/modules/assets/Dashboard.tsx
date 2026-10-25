import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorNote, Spinner } from '../../components/ui';
import { shortDate } from '../finance/api';
import { statusLabel, type Can, type Dashboard as Dash } from './api';
import { Badge, Btn, Card, Kpi, Note, PageHead, amt, compact, useReadOnly } from './parts';
import type { AssetView } from './Rail';

/**
 * Dashboard (D04): the server's KPIs, assets by status, warranty ending, upcoming maintenance and what waits on me —
 * with the warning, when a company is chosen, that assets belonging to no company are left out (D26 files them).
 */
export default function Dashboard({ data, can, onGo, onAsset }: { data: UseQueryResult<Dash>; org: number; can: Can; onGo: (v: AssetView, extra?: string) => void; onAsset: (id: number) => void }) {
  const ro = useReadOnly();
  if (data.isPending) return <Spinner />;
  if (data.error || !data.data) return <ErrorNote error={data.error} onRetry={() => void data.refetch()} />;
  const d = data.data;
  const k = d.kpi;
  const cur = d.currency;
  const live = Math.max(1, k.active || k.total);
  const statuses = Object.entries(d.by_status).sort((a, b) => b[1] - a[1]);
  const waiting = [
    { n: k.pending_requests, label: 'Requests to decide', v: 'requests' as const },
    { n: k.pending_transfers, label: 'Transfers to approve', v: 'transfers' as const },
    { n: k.due_maintenance, label: 'Maintenance due', v: 'maintenance' as const },
    { n: k.license_expiring, label: 'Licences renewing soon', v: 'licences' as const },
  ].filter((w) => w.n > 0);

  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Dashboard" sub="Figures from the server, as of now">
        <Btn onClick={() => void data.refetch()}>Refresh · F5</Btn>
        {can.assign ? <Btn onClick={() => onGo('scan')}>Scan station</Btn> : null}
        {can.manage ? <Btn primary disabled={ro} onClick={() => onGo('new')}>Add asset · ⌘N</Btn> : null}
      </PageHead>
      {d.unassigned && d.unassigned.count > 0 ? (
        <Note tone="warn">
          <span className="min-w-0 flex-1">
            <b>{`${d.unassigned.count} ${d.unassigned.count === 1 ? 'asset belongs' : 'assets belong'} to no company`}</b>
            {` and ${d.unassigned.count === 1 ? 'is' : 'are'} left out of these figures (${amt(d.unassigned.value, cur)}).`}
          </span>
          {can.manage ? <Btn disabled={ro} onClick={() => onGo('unfiled')}>File them</Btn> : null}
        </Note>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        <Kpi label="Live assets" value={k.active} />
        <Kpi label="Assigned" value={k.assigned} />
        <Kpi label="Available" value={k.available} />
        <Kpi label="Maintenance / repair" value={k.maintenance + k.repair} />
        <Kpi label={`Cost (${cur})`} value={<span title={amt(k.asset_value, cur)}>{compact(k.asset_value)}</span>} />
        <Kpi label={`Book value (${cur})`} value={<span title={amt(k.net_book_value, cur)}>{compact(k.net_book_value)}</span>} sub={`${amt(k.monthly_depreciation, cur)} a month`} />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="grid min-w-0 flex-[3_1_560px] grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
          <Card title="By status">
            <div className="flex flex-col gap-2 px-3.5 pb-3.5 text-[12.5px]">
              {statuses.map(([s, n]) => (
                <button key={s} type="button" className="text-left" onClick={() => onGo('register', `&status=${s}`)}>
                  <div className="flex"><span className="flex-1">{statusLabel(s)}</span><span className="text-ink-3 tabular-nums">{n}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle">
                    <span className={`block h-full ${s === 'maintenance' || s === 'repair' ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.round((n / live) * 100)}%` }} />
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Warranty ending" action={<button type="button" className="text-[11.5px] font-semibold text-primary" onClick={() => onGo('register', '&warranty=expiring')}>All</button>}>
            {d.warranty_expiring.slice(0, 6).map((w) => (
              <button key={w.id} type="button" onClick={() => onAsset(w.id)} className="flex w-full items-center gap-2 border-t border-line/70 px-3.5 py-2 text-left text-[12.5px] hover:bg-subtle">
                <span className="font-mono text-[11px]">{w.asset_code}</span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <Badge status={w.days_left <= 14 ? 'pending' : 'reserved'}>{`${w.days_left} d`}</Badge>
              </button>
            ))}
            {!d.warranty_expiring.length ? <p className="m-0 px-3.5 pb-3 text-[12px] text-ink-3">Nothing ending soon.</p> : null}
          </Card>
          <Card title="Upcoming maintenance" action={<button type="button" className="text-[11.5px] font-semibold text-primary" onClick={() => onGo('maintenance')}>All</button>}>
            {d.upcoming_maintenance.slice(0, 6).map((m) => (
              <div key={m.id} className="flex items-center gap-2 border-t border-line/70 px-3.5 py-2 text-[12.5px]">
                <Badge status={m.kind === 'repair' ? 'repair' : 'scheduled'}>{statusLabel(m.kind)}</Badge>
                <span className="min-w-0 flex-1 truncate">{`${m.asset} · ${m.asset_code}`}</span>
                <span className="text-[11px] text-ink-3">{shortDate(m.scheduled_for)}</span>
              </div>
            ))}
            {!d.upcoming_maintenance.length ? <p className="m-0 px-3.5 pb-3 text-[12px] text-ink-3">Nothing scheduled.</p> : null}
          </Card>
        </div>
        <aside aria-label="Waiting on you" className="flex min-w-0 flex-[1_1_280px] flex-col gap-2">
          <h2 className="m-0 text-[13.5px] font-bold text-ink">Waiting on you</h2>
          {waiting.map((w) => (
            <button key={w.v} type="button" onClick={() => onGo(w.v)} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left text-[12.5px] hover:bg-subtle">
              <Badge status="pending">{w.n}</Badge>
              <span className="flex-1">{w.label}</span>
              <span className="text-ink-3">›</span>
            </button>
          ))}
          {!waiting.length ? <p className="m-0 text-[12px] text-ink-3">Nothing waits on you.</p> : null}
          <h3 className="m-0 mt-2 text-[12.5px] font-bold text-ink">Recently issued</h3>
          {d.recent_assignments.slice(0, 6).map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span className="font-mono text-[11px]">{r.asset_code}</span>
              <span className="min-w-0 flex-1 truncate">{`${r.asset} → ${r.holder ?? '—'}`}</span>
              <span className="text-[11px] text-ink-3">{shortDate(r.at)}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
