import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { Empty, PageHead, Panel, Seg, THead, Cell, row } from '../../components/PageKit';
import { can, money, shortDate } from './api';
import { CurrencyPicker, FxNotice } from './Currency';
import { CostDimensions } from './Dimensions';
import {
  decimalsOf,
  deltaTone,
  fetchFinancialOverview,
  fxState,
  IK,
  magnitude,
  missingSlugs,
  pctText,
  PERIODS,
  periodRange,
  rangeProblem,
  SCREEN_SLUGS,
  TONE_TEXT,
  unpostedCount,
  type AccountSeriesRow,
  type CostVarianceRow,
  type FinancialOverview as OverviewData,
  type KpiCard,
  type PeriodKey,
} from './insight';
import { Notice } from '../../components/RecordKit';
import type { ScreenProps } from './Rail';
import { NotGranted, RangeFields, ReadFailed, ReportBar } from './ReportBar';
import { ShareBar, TrendChart } from './Trend';
import { StatCard, StatGrid, type StatTone, type StatTrend } from '../../components/StatCard';

/**
 * The financial overview (FR-FIN-15.02): KPIs, the monthly profit and loss,
 * margins, cost and revenue by account and by dimension, cost variance and
 * the health checks.
 *
 * EVERY FIGURE IS THE POSTED LEDGER, AND THE PAGE SAYS SO. A dashboard is
 * where somebody stops reading footnotes, so the basis is on the page — posted
 * journals only — with the count of documents raised and not posted beside it
 * and a way to them. "Revenue looks low" and "eleven invoices are not in the
 * ledger" are the same fact, and nobody finds the second by looking at the first.
 *
 * THE COMPARISON IS THE SAME LENGTH, NOT "LAST MONTH". Each change is against
 * the same number of days immediately before the window — a quarter against
 * the month before it is a unit mismatch that looks like growth — and the
 * dates compared against are printed under the cards. A balance on a date has
 * no window, so it is not compared at all.
 */
type PeriodChoice = PeriodKey | 'custom';

export default function FinancialOverview({ company, onGo }: ScreenProps) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const lacking = missingSlugs(perms, SCREEN_SLUGS.overview);
  const [period, setPeriod] = useState<PeriodChoice>('this_year');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [currency, setCurrency] = useState('');
  const range = custom ?? periodRange(period === 'custom' ? 'this_year' : period, todayInZone());
  const problem = rangeProblem(range);

  const q = useQuery({
    queryKey: IK.overview(company.id, range.from, range.to, currency),
    queryFn: ({ signal }) => fetchFinancialOverview(company.id, range.from, range.to, currency, signal),
    enabled: lacking.length === 0 && problem === null,
    retry: false,
    // The last answer stays up while the next loads — but only for this company, never another's figures under this heading.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === company.id ? prev : undefined),
  });

  if (lacking.length) return <NotGranted what="The financial overview" slugs={lacking} onAccess={() => onGo('myaccess')} />;

  const data = q.data;
  const choose = (p: PeriodChoice) => {
    setPeriod(p);
    setCustom(p === 'custom' ? range : null);
  };

  const controls = (
    <div className="flex flex-wrap items-end gap-2.5">
      <div className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        Period
        <div className="overflow-x-auto scroll-thin">
          <Seg label="Period" value={period} onChange={choose} options={[...PERIODS, { id: 'custom' as const, label: 'Custom' }]} />
        </div>
      </div>
      {custom ? <RangeFields range={custom} onChange={setCustom} /> : null}
      {data ? <CurrencyPicker value={currency} options={data.currencies} base={data.base_currency} onChange={setCurrency} /> : null}
      {q.isFetching && data ? <span className="pb-2 text-[12px] text-ink-3">Updating…</span> : null}
    </div>
  );

  const state = fxState(data?.fx, data?.position_fx);
  const cur = data?.currency ?? company.base_currency ?? '';

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Financial overview" sub={data ? `${company.name} · ${shortDate(data.from)} to ${shortDate(data.to)} · in ${cur}` : company.name}>
        {data && state !== 'mixed' ? <ReportBar report="financial-overview" company={company} from={data.from} to={data.to} currency={state === 'translated' ? cur : undefined} /> : null}
      </PageHead>
      {controls}
      {problem ? (
        <Notice tone="amber">{problem}</Notice>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error || !data ? (
        <ReadFailed what="The financial overview" error={q.error} onRetry={() => void q.refetch()} />
      ) : state === 'mixed' ? (
        <FxNotice fx={data.fx} positionFx={data.position_fx} onBase={() => setCurrency('')} />
      ) : (
        <Body data={data} cur={cur} onGo={onGo} mayClassify={can(perms, 'finance.accounts.manage')} />
      )}
    </div>
  );
}

function Body({ data, cur, onGo, mayClassify }: { data: OverviewData; cur: string; onGo: ScreenProps['onGo']; mayClassify: boolean }) {
  // The currency's own decimals — the server already rounded to them, and padding to two would undo it.
  const dec = decimalsOf(data.currencies, cur);
  const m = (v: string | null | undefined) => money(v, cur, dec);
  const series = (k: string) => data.months.map((mo) => data.series[mo]?.[k] ?? '0');
  const waiting = unpostedCount(data.unposted);
  const p = data.profitability;

  return (
    <>
      <StatGrid label="Key figures">
        {data.kpis.map((k) => (
          <KpiTile key={k.key} k={k} value={m(k.value)} to={data.to} previous={k.previous === null ? null : m(k.previous)} />
        ))}
      </StatGrid>
      <FxNotice fx={data.fx} positionFx={data.position_fx} />
      <p className="m-0 text-[11.5px] leading-relaxed text-ink-3">
        Compared with {shortDate(data.previous.from)} to {shortDate(data.previous.to)} — the same length of time immediately before this period. {data.basis}
        {waiting > 0 ? (
          <>
            {' '}
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onGo('unposted')}>
              {waiting} document{waiting === 1 ? ' is' : 's are'} waiting to post
            </button>
            .
          </>
        ) : null}
      </p>

      {data.health.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {data.health.map((h) => (
            <Notice key={h.text} tone={h.level === 'warn' ? 'amber' : 'green'} className="flex items-start gap-2">
              <Icon name={h.level === 'warn' ? 'warning' : 'check-circle'} size={15} className="mt-0.5 shrink-0" />
              <span>{h.text}</span>
            </Notice>
          ))}
        </div>
      ) : null}

      <Panel title="Revenue, cost and profit by month" bodyClassName="px-3.5 py-3">
        <TrendChart
          title="Revenue, cost and profit by month"
          description={`From ${shortDate(data.from)} to ${shortDate(data.to)}, in ${cur}.`}
          labels={data.months}
          format={m}
          series={[
            { key: 'rev', label: 'Revenue', values: series('revenue'), tone: 'primary' },
            { key: 'cost', label: 'Cost', values: series('total_cost'), tone: 'danger' },
            { key: 'profit', label: 'Net profit', values: series('net_profit'), tone: 'success' },
          ]}
        />
      </Panel>

      <Panel title="Profitability" bodyClassName="px-3.5 py-2">
        <dl className="m-0 flex flex-col text-[13px]">
          {(
            [
              ['Revenue', p.subtotals.revenue, false],
              ['Cost of sales', p.subtotals.cogs, true],
              ['Gross profit', p.subtotals.gross_profit, false, p.margins.gross],
              ['Operating expenses', p.subtotals.expenses, true],
              ['Operating profit', p.subtotals.operating_profit, false, p.margins.operating],
              ['Other income', p.subtotals.other_income, false],
              ['Other expenses', p.subtotals.other_expense, true],
              ['Net profit', p.net_profit, false, p.margins.net],
            ] as Array<[string, string | undefined, boolean, (string | null)?]>
          ).map(([label, value, isCost, margin]) => {
            const sub = margin !== undefined;
            return (
              <div key={label} className={cx('flex items-baseline justify-between gap-4 py-1.5', sub && 'border-t border-line font-semibold text-ink')}>
                <dt className={sub ? 'text-ink' : 'text-ink-2'}>{label}</dt>
                <dd className="m-0 flex items-baseline gap-3">
                  {/* A margin is a ratio of revenue; with no revenue there is none, not 0%. */}
                  {sub ? <span className="text-[11.5px] font-medium text-ink-3 tabular-nums">{margin === null ? 'no margin without revenue' : `${Number(margin).toFixed(1)}% margin`}</span> : null}
                  <span className="text-ink tabular-nums">{isCost ? `(${m(value)})` : m(value)}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </Panel>

      {/*
        Cost by something other than the account, apart from the account breakdown: an account breakdown always covers
        all of cost and these cover whatever was stamped, and tabs of one control would hide that difference.
      */}
      <CostDimensions dimensions={data.cost_dimensions} currency={cur} decimals={dec} onClassify={mayClassify ? () => onGo('accounts') : undefined} />

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Breakdown title="Cost by account" rows={data.costs.accounts} money={m} tone="danger" />
        <Breakdown title="Revenue by account" rows={data.revenue.accounts} money={m} tone="primary" />
      </div>

      <CostVariance rows={data.variance} money={m} />
    </>
  );
}

const KPI_ICON: Record<string, [string, StatTone]> = {
  revenue: ['trending-up', 'blue'],
  expenses: ['receipt', 'amber'],
  gross_profit: ['chart', 'green'],
  operating_profit: ['chart-line', 'green'],
  net_profit: ['coins', 'green'],
  cash: ['banknote', 'cyan'],
  receivable: ['hand-coins', 'violet'],
  payable: ['wallet', 'red'],
  assets: ['landmark', 'violet'],
  liabilities: ['scale', 'red'],
  equity: ['piggy-bank', 'cyan'],
};

function KpiTile({ k, value, previous, to }: { k: KpiCard; value: string; previous: string | null; to: string }) {
  // For a cost, up is bad: the arrow shows the direction of the number and the pill's colour judges it.
  const invert = k.key === 'expenses' || k.key === 'payable';
  const tone = deltaTone(k.change_pct, invert);
  const text = pctText(k.change_pct);
  const n = Number(k.change_pct);
  const [icon, accent] = KPI_ICON[k.key] ?? ['chart', 'neutral'];
  const sub =
    k.previous === null ? <span>A balance on {shortDate(to)} — not compared</span> : text === null ? <span>No comparison — nothing in the previous period</span> : <span title={previous ?? undefined}>from {previous}</span>;
  const trend: StatTrend | null = k.previous === null || text === null ? null : { direction: n > 0 ? 'up' : n < 0 ? 'down' : 'flat', text, good: tone === 'good', label: 'against the previous period' };
  return <StatCard label={k.label} value={value} sub={sub} trend={trend} icon={icon} tone={accent} />;
}

function Breakdown({ title, rows, money: m, tone }: { title: string; rows: AccountSeriesRow[]; money: (v: string) => string; tone: 'danger' | 'primary' }) {
  // Bar lengths only: the proportions of the magnitudes, never a figure anybody reads.
  const total = magnitude(rows.map((r) => r.total));
  return (
    <Panel title={title} sub="Grouped by account, the one thing every journal line carries" bodyClassName="flex flex-col gap-2 px-3.5 py-3">
      {rows.length === 0 ? (
        <Empty text="Nothing posted in this period." />
      ) : (
        <>
          {rows.slice(0, 12).map((r) => (
            <div key={r.account_id}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-ink-2">
                  <span className="font-mono text-[11.5px] text-ink-3">{r.code}</span> {r.name}
                </span>
                <span className="shrink-0 text-ink tabular-nums">{m(r.total)}</span>
              </div>
              <ShareBar className="mt-1" value={r.total} total={total} tone={tone} />
            </div>
          ))}
          {rows.length > 12 ? (
            <span className="text-[11.5px] text-ink-3">
              {rows.length - 12} smaller account{rows.length - 12 === 1 ? '' : 's'} not shown.
            </span>
          ) : null}
        </>
      )}
    </Panel>
  );
}

const VAR_COLS: Array<[string, number | null]> = [
  ['Account', null],
  ['Current', 150],
  ['Previous', 150],
  ['Change', 210],
];

function CostVariance({ rows, money: m }: { rows: CostVarianceRow[]; money: (v: string) => string }) {
  const shown = rows.slice(0, 25);
  return (
    <Panel
      title="Cost variance against the previous period"
      sub="Biggest movement first. An account with spend last period and none in this one is listed too — that is the largest decrease there can be, and dropping it would hide it."
      bodyClassName="flex flex-col"
    >
      {rows.length === 0 ? (
        <Empty text="No costs posted in either period." />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <div className="min-w-[680px]">
            <THead cols={VAR_COLS} />
            {shown.map((v) => {
              const text = pctText(v.change_pct);
              return (
                <div key={v.account_id} className={row}>
                  <Cell w={null}>
                    <span className="font-mono text-[11.5px] text-ink-3">{v.code}</span> {v.name}
                  </Cell>
                  <Cell w={150} className="text-right tabular-nums">
                    {m(v.current)}
                  </Cell>
                  <Cell w={150} className="text-right text-ink-2 tabular-nums">
                    {m(v.previous)}
                  </Cell>
                  <Cell w={210} className="text-right tabular-nums">
                    {m(v.change)}{' '}
                    <span className={cx('text-[11.5px] font-semibold', TONE_TEXT[deltaTone(v.change_pct, true)])}>{text ?? 'new'}</span>
                  </Cell>
                </div>
              );
            })}
            {rows.length > shown.length ? <div className="px-3.5 py-2 text-[11.5px] text-ink-3">{rows.length - shown.length} smaller movements not shown.</div> : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
