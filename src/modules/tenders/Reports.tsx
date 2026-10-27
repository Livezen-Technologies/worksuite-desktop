import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { todayInZone } from '../../core/time';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { Empty, input, Kpi, PageHead, Panel } from '../../components/PageKit';
import { moneyList } from './api';
import { bars, fetchReport, KA, PERIODS, periodOf, type PeriodPreset } from './admin';
import { amount, fetchBidCostReport, KE } from './bidcost';
import { StatGrid } from '../../components/StatCard';

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
          <StatGrid min={180} label="The period">
            <Kpi icon="inbox" tone="blue" label="Came in" value={r.total} sub="Added in the period" />
            <Kpi icon="folder-open" tone="violet" label="Still open" value={r.open} sub="Of those that came in" />
            <Kpi icon="trophy" label="Won" value={r.won} tone={r.won ? 'green' : undefined} sub="Decided in the period" />
            <Kpi icon="x-circle" label="Lost" value={r.lost} tone={r.lost ? 'red' : undefined} sub="Decided in the period" />
            <Kpi icon="ban" label="Cancelled" value={r.cancelled} sub="Not in the win rate" />
            <Kpi icon="percent" tone="cyan" label="Win rate" value={r.win_rate === null ? '—' : `${r.win_rate}%`} sub={r.won + r.lost ? `${r.won} of ${r.won + r.lost} decided` : 'Nothing decided'} />
          </StatGrid>
          <p className="m-0 text-[12.5px] text-ink-3">{r.note}</p>
          <div className="grid grid-cols-3 gap-3.5">
            <Panel title="Awarded to us" sub="The award value on each tender won, per currency" bodyClassName="px-3.5 py-3">
              <b className="text-[18px] text-success-ink tabular-nums dark:text-success">{moneyList(r.awarded_by_currency)}</b>
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
          <BidCost org={org} from={p.from} to={p.to} />
        </>
      )}
    </div>
  );
}

const OUTCOME: Record<string, string> = { won: 'Won', lost: 'Lost', open: 'Open', cancelled: 'Cancelled' };

/**
 * Bid cost by tender (worksuite-desktop#159): what bidding cost, won against
 * lost, and the cost of a win — everything spent on the decided bids over the
 * number won. Below it the pipeline, tender by tender, with its bid cost. The
 * figures are the expenses each reader may see, so a member's report counts
 * their own claims and says nothing it cannot back.
 */
export function BidCost({ org, from, to }: { org: string; from: string; to: string }) {
  const q = useQuery({ queryKey: KE.report(org, from, to), queryFn: ({ signal }) => fetchBidCostReport(org, from, to, signal), placeholderData: keepPreviousData, retry: false });
  const r = q.data;
  if (q.isLoading) return <Spinner />;
  if (q.error || !r) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (!r.visible) return <p className="m-0 text-[12.5px] text-ink-3">{r.why ?? 'Bid costs come from the Expenses module.'}</p>;
  const ccy = r.currency;
  return (
    <Panel title="Bid cost by tender" sub={ccy ? `In ${ccy}, from the expenses linked to each tender` : 'Across companies that keep different currencies — the figures are not one total'} bodyClassName="flex flex-col gap-3 px-3.5 py-3">
      <StatGrid label="Bid cost">
        <Kpi icon="coins" tone="blue" label="Total bid cost" value={amount(r.total, ccy)} sub={`${r.rows.length} ${r.rows.length === 1 ? 'tender' : 'tenders'}`} />
        <Kpi icon="badge-check" label="On bids won" value={amount(r.by_outcome.won.cost, ccy)} tone={r.by_outcome.won.count ? 'green' : undefined} sub={`${r.by_outcome.won.count} won`} />
        <Kpi icon="x-circle" label="On bids lost" value={amount(r.by_outcome.lost.cost, ccy)} tone={r.by_outcome.lost.count ? 'red' : undefined} sub={`${r.by_outcome.lost.count} lost`} />
        <Kpi icon="calculator" tone="violet" label="Cost per win" value={r.cost_per_win === null ? '—' : amount(r.cost_per_win, ccy)} sub="Won and lost, over the wins" />
      </StatGrid>
      {r.note ? <p className="m-0 text-[12px] text-ink-3">{r.note}</p> : null}
      {r.rows.length ? (
        <table className="w-full border-collapse text-[12.5px]" aria-label="Tender pipeline with bid cost">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-ink-3">
              <th className="py-1.5 pr-2 font-semibold">Tender</th>
              <th className="px-2 py-1.5 font-semibold">Stage</th>
              <th className="px-2 py-1.5 font-semibold">Outcome</th>
              <th className="px-2 py-1.5 text-right font-semibold">Expenses</th>
              <th className="py-1.5 pl-2 text-right font-semibold">Bid cost</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.id} data-bid-cost={x.id} className="border-b border-line/60 last:border-b-0">
                <td className="max-w-[320px] truncate py-1.5 pr-2 text-ink" title={x.title}>
                  {x.reference ? <span className="text-ink-3">{x.reference} · </span> : null}
                  {x.title}
                </td>
                <td className="px-2 py-1.5 text-ink-2">{x.stage_label}</td>
                <td className="px-2 py-1.5 text-ink-2">{OUTCOME[x.outcome] ?? x.outcome}</td>
                <td className="px-2 py-1.5 text-right text-ink-2 tabular-nums">{x.expenses}</td>
                <td className="py-1.5 pl-2 text-right font-semibold text-ink tabular-nums">{amount(x.bid_cost, ccy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty text="No tenders in this period." />
      )}
    </Panel>
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
