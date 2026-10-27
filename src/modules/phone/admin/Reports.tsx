import { useMemo, useState } from 'react';
import { call as desktop, hasDesktop } from '../../../core/bridge';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { toast } from '../../../core/toasts';
import { Button, cx, Empty, Spinner } from '../../../components/ui';
import { useAgentReport, useDepartmentReport, useQueueReport, useSummary, useVolume, type ReportRange, type ReportVolume } from '../api';
import { toCsv } from '../lib/csv';
import { clock, daysAgo, isoDay, money, talkTime } from '../lib/format';
import { Kpi, Mono, PageBody, PageHeader, Panel, Refused, TD, TR, Table } from '../parts';
import { StatGrid } from '../../../components/StatCard';

/**
 * A10 · Call reports (VOIP-RPT-01/02/03). The period's totals, calls per day (answered and missed), the busiest
 * hours, agents, queues with SLA, departments, and outbound cost — counted only on trunks with a rate. When the switch
 * was unreachable for part of the period the report says so: its figures have a hole in them (coverage).
 */
const PERIODS = [
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
] as const;

// Answered / missed: validated (dataviz) for both themes; amber is below 3:1 on white, so the chart has a legend,
// direct labels and a table view.
const ANSWERED = 'bg-blue dark:bg-primary';
const MISSED = 'bg-amber dark:bg-orange';
const SEQ_LIGHT = ['#f1f5fb', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const SEQ_DARK = ['#17213f', '#1c3360', '#1c4a8a', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Reports() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('30');
  const listed = useStore(app, (s) => s.bootstrap?.organizations);
  const orgs = listed ?? [];
  const [org, setOrg] = useState<string>('');
  const range: ReportRange = useMemo(() => ({ from: daysAgo(Number(period) - 1), to: isoDay(new Date()), org_id: org ? Number(org) : null }), [period, org]);
  const summary = useSummary(range);
  const volume = useVolume(range);
  const agents = useAgentReport(range);
  const queues = useQueueReport(range);
  const departments = useDepartmentReport(range);
  const [exporting, setExporting] = useState(false);
  const t = summary.data?.totals;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: unknown[][] = [];
      for (const d of volume.data?.daily ?? []) rows.push(['day', d.date, d.total, d.answered, d.total - d.answered, '', '']);
      for (const a of agents.data ?? []) rows.push(['agent', `${a.name} (${a.extension})`, a.calls, a.answered, a.calls - a.answered, a.talk_seconds, a.avg_talk_seconds ?? '']);
      for (const q of queues.data ?? []) rows.push(['queue', `${q.name} (${q.number})`, q.calls, q.answered, q.abandoned, q.avg_wait_seconds ?? '', q.sla_rate ?? '']);
      const csv = toCsv(['kind', 'name', 'calls', 'answered', 'missed_or_abandoned', 'talk_or_wait_s', 'avg_or_sla'], rows);
      if (hasDesktop()) {
        const where = await desktop('files:saveText', { name: `call-report-${range.from}-to-${range.to}.csv`, text: csv });
        if (where) toast('success', 'Report exported.');
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Call reports"
        actions={
          <>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
              Period
              <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] font-semibold text-ink">
                {PERIODS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {orgs.length > 1 ? (
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
                Company
                <select aria-label="Company" value={org} onChange={(e) => setOrg(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] font-semibold text-ink">
                  <option value="">All companies</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button icon="download" loading={exporting} onClick={() => void exportCsv()}>
              Export
            </Button>
          </>
        }
      />
      <PageBody>
        {summary.isLoading ? (
          <Spinner />
        ) : summary.error ? (
          <Refused error={summary.error} onRetry={() => void summary.refetch()} />
        ) : t ? (
          <div className="flex flex-col gap-4">
            <StatGrid min={200}>
              <Kpi icon="phone" tone="blue" label="Calls" value={t.calls.toLocaleString()} sub={`${t.inbound.toLocaleString()} in · ${t.outbound.toLocaleString()} out · ${t.internal.toLocaleString()} internal`} />
              <Kpi icon="phone-incoming" label="Answered" value={t.answer_rate === null ? null : `${t.answer_rate}%`} tone="success" sub={`${t.answered.toLocaleString()} calls`} />
              <Kpi icon="clock" tone="violet" label="Talk time" value={talkTime(t.talk_seconds)} sub={t.avg_talk_seconds !== null ? `avg ${clock(t.avg_talk_seconds)} per call` : undefined} />
              <Kpi icon="phone-missed" label="Unanswered" value={t.unanswered.toLocaleString()} tone={t.unanswered ? 'warning' : undefined} />
              <Kpi icon="coins" tone="cyan" label="Outbound cost" value={summary.data?.cost ? money(summary.data.cost.total) : null} sub={summary.data?.cost ? `${summary.data.cost.calls_priced} rated calls only` : 'No trunk has a rate'} />
            </StatGrid>
            {summary.data && summary.data.coverage.known && (summary.data.coverage.reachable_pct ?? 100) < 99.5 ? (
              <p className="rounded-[10px] border border-warning/30 bg-warning-bg px-3.5 py-2 text-[12.5px] text-warning-ink dark:text-warning">Coverage: {summary.data.coverage.message}</p>
            ) : summary.data && !summary.data.coverage.known ? (
              <p className="text-[12px] text-ink-3">{summary.data.coverage.message}</p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Panel title="Calls per day">{volume.isLoading ? <Spinner /> : volume.data ? <PerDay v={volume.data} /> : null}</Panel>
              <Panel title="Busiest hours (inbound)">{volume.isLoading ? <Spinner /> : volume.data ? <Busiest v={volume.data} /> : null}</Panel>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Panel title="Agents">
                {agents.isLoading ? (
                  <Spinner />
                ) : (agents.data ?? []).length ? (
                  <Table head={['Agent', 'Calls', 'Answered', 'Talk', 'Avg', 'Missed']}>
                    {(agents.data ?? []).map((a) => (
                      <tr key={a.extension} className={TR}>
                        <td className={cx(TD, 'font-semibold')}>
                          {a.name} ({a.extension})
                        </td>
                        <td className={TD}>
                          <Mono>{a.calls}</Mono>
                        </td>
                        <td className={TD}>
                          <Mono>{a.answer_rate === null ? '—' : `${a.answer_rate}%`}</Mono>
                        </td>
                        <td className={TD}>
                          <Mono>{talkTime(a.talk_seconds)}</Mono>
                        </td>
                        <td className={TD}>
                          <Mono>{a.avg_talk_seconds === null ? '—' : clock(a.avg_talk_seconds)}</Mono>
                        </td>
                        <td className={TD}>
                          <Mono className={a.calls - a.answered ? 'text-danger' : ''}>{a.calls - a.answered || '—'}</Mono>
                        </td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <Empty icon="users" title="No agent calls in this period" />
                )}
              </Panel>
              <Panel title="Queues & cost">
                <div className="flex flex-col gap-2 text-[12.5px]">
                  {(queues.data ?? []).map((q) => (
                    <div key={q.number} className="flex items-center gap-2 border-b border-line pb-2 last:border-b-0">
                      <b className="min-w-0 flex-1 truncate">
                        {q.name} {q.number}
                      </b>
                      <span className="text-ink-3">{q.calls.toLocaleString()} calls</span>
                      <span>{q.sla_rate === null ? 'SLA —' : `SLA ${q.sla_rate}%`}</span>
                      <span className="text-ink-3">avg wait {q.avg_wait_seconds === null ? '—' : clock(q.avg_wait_seconds)}</span>
                    </div>
                  ))}
                  {!(queues.data ?? []).length ? <p className="text-ink-3">No queue calls in this period.</p> : null}
                  <div className="mt-1 flex flex-col gap-1 border-t border-line pt-2">
                    <div className="flex justify-between font-semibold">
                      <span>Outbound cost (rated trunks)</span>
                      <Mono>{summary.data?.cost ? money(summary.data.cost.total) : '—'}</Mono>
                    </div>
                    {(departments.data ?? [])
                      .filter((d) => d.calls)
                      .slice(0, 6)
                      .map((d) => (
                        <div key={d.department ?? 'none'} className="flex justify-between text-ink-2">
                          <span>{d.department ?? 'No department'}</span>
                          <span>
                            {d.calls} calls · <Mono>{d.cost === null ? 'not rated' : money(d.cost)}</Mono>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        ) : null}
      </PageBody>
    </div>
  );
}

/** Calls per day: answered and missed stacked, 2px apart, a legend, the totals by hover, and a table view. */
function PerDay({ v }: { v: ReportVolume }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const days = v.daily;
  const max = Math.max(1, ...days.map((d) => d.total));
  if (!days.length) return <Empty icon="chart" title="No calls in this period" />;
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className={cx('h-2.5 w-2.5 rounded-[3px]', ANSWERED)} />
          Answered
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cx('h-2.5 w-2.5 rounded-[3px]', MISSED)} />
          Missed
        </span>
        <span className="ml-auto min-h-[16px] text-ink-3">{h ? `${new Date(`${h.date}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${h.total} calls · ${h.answered} answered · ${h.total - h.answered} missed` : ''}</span>
        <button type="button" className="text-[11.5px] font-semibold text-primary" onClick={() => setTable(!table)}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {table ? (
        <Table head={['Day', 'Calls', 'Answered', 'Missed']}>
          {days.map((d) => (
            <tr key={d.date} className={TR}>
              <td className={TD}>{d.date}</td>
              <td className={TD}>{d.total}</td>
              <td className={TD}>{d.answered}</td>
              <td className={TD}>{d.total - d.answered}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <>
          <div className="flex h-[180px] items-end gap-[2px] border-b border-line" role="img" aria-label={`Calls per day, ${days[0]!.date} to ${days.at(-1)!.date}`} onMouseLeave={() => setHover(null)}>
            {days.map((d, i) => {
              const missed = d.total - d.answered;
              return (
                <div key={d.date} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
                  {missed > 0 ? <div className={cx('w-full rounded-t-[4px]', MISSED, d.answered > 0 && 'mb-[2px]')} style={{ height: `${(missed / max) * 100}%` }} /> : null}
                  {d.answered > 0 ? <div className={cx('w-full', ANSWERED, missed > 0 ? '' : 'rounded-t-[4px]')} style={{ height: `${(d.answered / max) * 100}%` }} /> : null}
                  {hover === i ? <div className="pointer-events-none absolute inset-0 bg-ink/5" /> : null}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10.5px] text-ink-3">
            <span>{days[0]!.date.slice(5)}</span>
            {days.length > 2 ? <span>{days[Math.floor(days.length / 2)]!.date.slice(5)}</span> : null}
            <span>{days.at(-1)!.date.slice(5)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Busiest hours: a weekday × hour heat map when the server sends one (`heat`), else the hour of day over the period.
 * One hue, light to dark; the value on hover.
 */
function Busiest({ v }: { v: ReportVolume }) {
  const dark = useStore(app, () => (typeof document !== 'undefined' ? document.documentElement.dataset.theme === 'dark' : false));
  const ramp = dark ? SEQ_DARK : SEQ_LIGHT;
  const [hover, setHover] = useState<string | null>(null);
  const hours = Array.from({ length: 12 }, (_, i) => i + 8);
  const colour = (n: number, max: number) => ramp[Math.min(ramp.length - 1, max ? Math.ceil((n / max) * (ramp.length - 1)) : 0)]!;
  if (v.heat?.length) {
    const max = Math.max(1, ...v.heat.map((c) => c.total));
    const at = (d: number, h: number) => v.heat!.find((c) => c.dow === d && c.hour === h)?.total ?? 0;
    const peak = [...v.heat].sort((a, b) => b.total - a.total)[0];
    return (
      <div className="flex flex-col gap-1.5 text-[10.5px]">
        <div className="grid grid-cols-[32px_repeat(12,minmax(0,1fr))] gap-[2px]">
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-ink-3">
              {h}
            </span>
          ))}
          {[1, 2, 3, 4, 5].map((d) => (
            <div key={d} className="contents">
              <span className="text-ink-3">{DOW[d]}</span>
              {hours.map((h) => {
                const n = at(d, h);
                return <span key={h} title={`${DOW[d]} ${h}:00 · ${n} calls`} onMouseEnter={() => setHover(`${DOW[d]} ${h}:00–${h + 1}:00 · ${n} calls`)} className="h-5 rounded-[3px]" style={{ background: colour(n, max) }} />;
              })}
            </div>
          ))}
        </div>
        <span className="text-ink-3">{hover ?? (peak ? `Peak: ${DOW[peak.dow]} ${peak.hour}:00–${peak.hour + 1}:00` : '')}</span>
      </div>
    );
  }
  const byHour = v.hourly.filter((x) => x.hour >= 7 && x.hour <= 20);
  const max = Math.max(1, ...byHour.map((x) => x.total));
  const peak = [...byHour].sort((a, b) => b.total - a.total)[0];
  return (
    <div className="flex flex-col gap-1.5 text-[10.5px]">
      <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-[2px]">
        {byHour.map((x) => (
          <span key={x.hour} title={`${x.hour}:00 · ${x.total} calls, ${x.answered} answered`} onMouseEnter={() => setHover(`${x.hour}:00–${x.hour + 1}:00 · ${x.total} calls, ${x.answered} answered`)} className="h-10 rounded-[3px]" style={{ background: colour(x.total, max) }} />
        ))}
        {byHour.map((x) => (
          <span key={`l${x.hour}`} className="text-center text-ink-3">
            {x.hour}
          </span>
        ))}
      </div>
      <span className="text-ink-3">{hover ?? (peak && peak.total ? `Peak: ${peak.hour}:00–${peak.hour + 1}:00 · ${peak.total} calls over the period` : 'No calls in these hours')}</span>
      <span className="text-ink-3">By hour over the whole period; a weekday-by-hour map needs a newer server.</span>
    </div>
  );
}

