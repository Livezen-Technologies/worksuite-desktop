import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { addDays, todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, PageHead, Panel, Seg } from '../hr/parts';
import type { CrmReports } from './api';
import { exportCrmCsv } from './exportCsv';
import { isMissing } from './logic';
import { BarRow, crmCan, Kpi, money } from './parts';
import { useOwnerList } from './Schedule';
import { useCrmScope } from './scope';
import { StatGrid } from '../../components/StatCard';

/**
 * Reports (Insight → Reports, W5): for the company the CRM is showing and a
 * period — won against forecast by month, wins and losses with the reasons
 * given, where leads come from and how many convert, how long a sale takes
 * (and in which stage), and each owner's open, won and win rate; Export
 * saves the server's CSV. Every figure is the server's. A server without
 * reports says so instead of a broken screen.
 */
type Range = '90' | '180' | '365';

const WON = 'bg-primary dark:bg-brand-soft';
const FORECAST = 'bg-teal';

export default function Reports() {
  const scope = useCrmScope();
  const owners = useOwnerList();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [range, setRange] = useState<Range>('180');
  const [owner, setOwner] = useState('');
  const to = todayInZone();
  const from = addDays(to, -Number(range));
  const params = { from, to, owner_id: owner || undefined, ...scope.params };
  const q = useQuery({ queryKey: ['crm', 'reports', params], queryFn: ({ signal }) => apiGet<CrmReports>('/api/crm/reports', params, signal), retry: false });
  const r = q.data;
  const cur = r?.currency ?? 'LKR';
  const decided = (r?.win_loss.won ?? 0) + (r?.win_loss.lost ?? 0);
  const monthMax = Math.max(1, ...(r?.won_vs_forecast ?? []).flatMap((m) => [m.won, m.forecast]));
  const reasonMax = Math.max(1, ...(r?.win_loss.reasons ?? []).map((x) => x.count));
  const stageMax = Math.max(1, ...(r?.cycle.by_stage ?? []).map((x) => x.avg_days ?? 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin">
      <PageHead title="Reports" sub={`CRM · ${scope.name}`}>
        <Seg<Range> label="Period" value={range} onChange={setRange} options={[{ id: '90', label: '3 months' }, { id: '180', label: '6 months' }, { id: '365', label: '12 months' }]} />
        <Select label="Owner" value={owner} onValueChange={setOwner} options={[{ value: '', label: 'Everyone' }, ...(owners.data?.owners ?? []).map((o) => ({ value: String(o.id), label: o.name }))]} />
        {crmCan(perms, 'crm.export') && r ? (
          <button type="button" className={btn} onClick={() => void exportCrmCsv('/api/crm/reports/export', params, 'crm-report')}>
            <Icon name="download" size={14} /> Export
          </button>
        ) : null}
      </PageHead>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? (
        isMissing(q.error) ? (
          <div className="rounded-[12px] border border-dashed border-line bg-surface px-6 py-10 text-center">
            <b className="text-[14px] text-ink">Reports need a newer WorkSuite server</b>
            <p className="m-0 mt-1 text-[12.5px] text-ink-3">The dashboard still shows the pipeline, follow-ups and quotes.</p>
          </div>
        ) : (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : null}
      {r ? (
        <>
          <StatGrid>
            <Kpi icon="trophy" label="Won" value={money(r.won_vs_forecast.reduce((a, m) => a + m.won, 0), cur)} sub={`${r.win_loss.won} ${r.win_loss.won === 1 ? 'deal' : 'deals'}`} tone="green" />
            <Kpi icon="percent" tone="cyan" label="Win rate" value={decided ? `${Math.round((r.win_loss.won / decided) * 100)}%` : '—'} sub={`${r.win_loss.won} won · ${r.win_loss.lost} lost`} />
            <Kpi icon="timer" label="Sales cycle" value={r.cycle.avg_days === null ? '—' : `${r.cycle.avg_days} d`} sub="lead to won, on average" tone="blue" />
            <Kpi icon="user-plus" tone="violet" label="Leads" value={r.sources.reduce((a, s) => a + s.leads, 0)} sub={`${r.sources.reduce((a, s) => a + s.converted, 0)} converted`} />
          </StatGrid>

          <Panel
            title="Won against forecast"
            action={
              <span className="flex items-center gap-3 text-[12px] text-ink-2" aria-label="Legend">
                <span className="flex items-center gap-1.5">
                  <span className={cx('h-2.5 w-2.5 rounded-[3px]', WON)} /> Won
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={cx('h-2.5 w-2.5 rounded-[3px]', FORECAST)} /> Forecast
                </span>
              </span>
            }
            bodyClassName="px-3.5 py-3"
          >
            {r.won_vs_forecast.length ? (
              <div role="table" aria-label="Won against forecast by month" className="flex h-[180px] items-end gap-3">
                {r.won_vs_forecast.map((m) => (
                  <div role="row" key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
                    <div className="flex w-full min-h-0 flex-1 items-end justify-center gap-[2px]">
                      <span role="cell" title={`${m.month} · won ${money(m.won, cur)}`} className={cx('w-full max-w-[18px] rounded-t-[4px]', WON)} style={{ height: `${(m.won / monthMax) * 100}%` }} />
                      <span role="cell" title={`${m.month} · forecast ${money(m.forecast, cur)}`} className={cx('w-full max-w-[18px] rounded-t-[4px]', FORECAST)} style={{ height: `${(m.forecast / monthMax) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-ink-3">{m.month}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="m-0 text-[12.5px] text-ink-3">Nothing won or forecast in this period.</p>
            )}
          </Panel>

          <div className="grid items-start gap-3 min-[1000px]:grid-cols-2">
            <Panel title="Why deals were lost" sub={`${r.win_loss.lost} lost · ${r.win_loss.won} won`} bodyClassName="flex flex-col gap-2 px-3.5 py-2.5">
              {r.win_loss.reasons.map((x) => (
                <BarRow key={x.reason} label={x.reason || 'No reason given'} value={x.count} pct={(x.count / reasonMax) * 100} colour="var(--color-danger)" />
              ))}
              {!r.win_loss.reasons.length ? <p className="m-0 text-[12.5px] text-ink-3">No deal was lost in this period.</p> : null}
            </Panel>
            <Panel title="Days in each stage" sub={r.cycle.avg_days === null ? undefined : `${r.cycle.avg_days} days from lead to won`} bodyClassName="flex flex-col gap-2 px-3.5 py-2.5">
              {r.cycle.by_stage.map((x) => (
                <BarRow key={x.stage} label={x.stage} value={x.avg_days === null ? '—' : `${x.avg_days} d`} pct={((x.avg_days ?? 0) / stageMax) * 100} />
              ))}
              {!r.cycle.by_stage.length ? <p className="m-0 text-[12.5px] text-ink-3">Nothing has moved through the pipeline yet.</p> : null}
            </Panel>
          </div>

          <div className="grid items-start gap-3 min-[1000px]:grid-cols-2">
            <Panel title="Lead sources">
              <Table head={['Source', 'Leads', 'Converted', 'Rate']} rows={r.sources.map((s) => [s.source || 'Not given', s.leads, s.converted, s.rate === null ? '—' : `${s.rate}%`])} empty="No leads in this period." />
            </Panel>
            <Panel title="By owner">
              <Table head={['Owner', 'Open', 'Won', 'Won value', 'Win rate']} rows={r.owners.map((o) => [o.name || 'Nobody', o.open, o.won, money(o.won_value, cur), o.win_rate === null ? '—' : `${o.win_rate}%`])} empty="Nobody has deals in this period." />
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: Array<Array<string | number>>; empty: string }) {
  if (!rows.length) return <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">{empty}</p>;
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} className={cx('border-b border-line px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase', i ? 'text-right' : 'text-left')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, j) => (
          <tr key={j} className="border-b border-line/60 last:border-b-0">
            {r.map((c, i) => (
              <td key={i} className={cx('px-3.5 py-2', i ? 'text-right text-ink tabular-nums' : 'font-semibold text-ink')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
