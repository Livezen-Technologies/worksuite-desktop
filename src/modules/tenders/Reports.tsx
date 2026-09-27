import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { todayInZone } from '../../core/time';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { Empty, input, Kpi, PageHead, Panel } from '../hr/parts';
import { moneyList } from './api';
import { bars, fetchReport, KA, PERIODS, periodOf, type PeriodPreset } from './admin';

/**
 * What came in and what came back, over a period. Two questions on their
 * own dates: what came in — how many tenders, by sector and industry — is by
 * when each was added; what was decided — won, lost, cancelled, the win rate,
 * the value awarded and why bids were lost — by when each was decided. The
 * period's days are on the company's calendar. Awarded value is per
 * currency and never added across them.
 */
const SECTORS: Record<string, string> = { government: 'Government', private: 'Private', ngo: 'NGO', other: 'Other' };

export default function Reports({ org }: { org: string }) {
  const [preset, setPreset] = useState<PeriodPreset>('year');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const today = todayInZone();
  const p = periodOf(preset, today, custom);
  const bad = !!(p.from && p.to && p.to < p.from);
  const q = useQuery({ queryKey: KA.report(org, p.from, p.to), queryFn: ({ signal }) => fetchReport(org, p.from, p.to, signal), placeholderData: keepPreviousData, enabled: !bad });
  const r = q.data;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Reports" sub="What came in, and what came back">
        <Select<PeriodPreset> aria-label="Period" value={preset} onValueChange={setPreset} options={PERIODS.map(([value, label]) => ({ value, label }))} className={input + ' !w-[190px]'} />
        {preset === 'custom' ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={input + ' !w-[150px]'} />
            to
            <input type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={input + ' !w-[150px]'} />
          </span>
        ) : null}
      </PageHead>
      {bad ? <p className="m-0 text-[12.5px] text-danger">The period ends before it starts.</p> : null}
      {bad ? null : q.isLoading ? (
        <Spinner />
      ) : q.error || !r ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-6 gap-3" aria-label="The period">
            <Kpi label="Came in" value={r.total} sub="Added in the period" />
            <Kpi label="Still open" value={r.open} sub="Of those that came in" />
            <Kpi label="Won" value={r.won} tone={r.won ? 'green' : undefined} sub="Decided in the period" />
            <Kpi label="Lost" value={r.lost} tone={r.lost ? 'red' : undefined} sub="Decided in the period" />
            <Kpi label="Cancelled" value={r.cancelled} sub="Not in the win rate" />
            <Kpi label="Win rate" value={r.win_rate === null ? '—' : `${r.win_rate}%`} sub={r.won + r.lost ? `${r.won} of ${r.won + r.lost} decided` : 'Nothing decided'} />
          </div>
          <p className="m-0 text-[12.5px] text-ink-3">{r.note}</p>
          <div className="grid grid-cols-3 gap-3.5">
            <Panel title="Awarded to us" sub="The award value on each tender won, per currency" bodyClassName="px-3.5 py-3">
              <b className="text-[18px] text-[#145C39] tabular-nums dark:text-success">{moneyList(r.awarded_by_currency)}</b>
              <p className="m-0 mt-1.5 text-[11.5px] leading-relaxed text-ink-3">A tender won without an award value recorded adds nothing here, rather than the bid standing in for it.</p>
            </Panel>
            <Panel title="By sector" sub="What came in" bodyClassName="flex flex-col gap-1.5 px-3.5 py-3">
              <Bars data={r.by_sector} names={SECTORS} />
            </Panel>
            <Panel title="By industry" sub="What came in" bodyClassName="flex flex-col gap-1.5 px-3.5 py-3">
              <Bars data={r.by_industry} />
            </Panel>
          </div>
          <Panel title="Why we lost" sub={r.loss_analysis.note} bodyClassName="grid grid-cols-3 gap-4 px-3.5 py-3">
            <div className="flex flex-col gap-1.5">
              <b className="text-[11px] tracking-[.4px] text-ink-3 uppercase">The reasons given</b>
              <Bars data={r.loss_analysis.by_reason} />
            </div>
            <div className="flex flex-col gap-1.5">
              <b className="text-[11px] tracking-[.4px] text-ink-3 uppercase">Won instead by</b>
              <Bars data={r.loss_analysis.by_competitor} />
            </div>
            <div className="flex flex-col gap-1.5">
              <b className="text-[11px] tracking-[.4px] text-ink-3 uppercase">Our price against theirs</b>
              {r.loss_analysis.price_gap ? (
                <>
                  <b className="text-[18px] text-ink tabular-nums">
                    {r.loss_analysis.price_gap.median > 0 ? '+' : ''}
                    {r.loss_analysis.price_gap.median}%
                  </b>
                  <span className="text-[11.5px] leading-relaxed text-ink-3">The median gap above the winning price. {r.loss_analysis.price_gap.note}</span>
                </>
              ) : (
                <span className="text-[12px] text-ink-3">No loss in the period has both our bid and the winning price recorded.</span>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Bars({ data, names }: { data: Record<string, number>; names?: Record<string, string> }) {
  const list = bars(data);
  if (!list.length) return <Empty text="Nothing recorded." />;
  return (
    <>
      {list.map((b) => (
        <div key={b.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-[42%] shrink-0 truncate text-ink-2" title={names?.[b.label] ?? b.label}>
            {names?.[b.label] ?? b.label}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${b.pct}%` }} />
          </span>
          <b className="w-7 shrink-0 text-right text-ink tabular-nums">{b.n}</b>
        </div>
      ))}
    </>
  );
}
