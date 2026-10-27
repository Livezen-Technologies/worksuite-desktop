import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, Cell, Empty, Field, PageHead, THead, row } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { can, isNegative, isZero, money, shortDate } from './api';
import { favourTone, fetchBudgetVariance, IK, missingSlugs, num, pctText, profitTone, SCREEN_SLUGS, signedMoney, TONE_TEXT, type BudgetVariance, type Tone, type VarianceRow, type VarianceSide } from './insight';
import type { ScreenProps } from './Rail';
import { NotGranted, ReadFailed, ReportBar } from './ReportBar';
import { ShareBar, type ShareTone } from './Trend';
import { StatCard, StatGrid, type StatTone, type StatTrend } from '../../components/StatCard';

/**
 * Budget against actual (FR-FIN-13.04).
 *
 * COLOUR COMES FROM `favourable`, NEVER FROM THE SIGN. Spending 5.2M against
 * a 4.8M plan is +400K and bad; earning 5.2M against 4.8M is +400K and good.
 * A screen colouring by sign is right on every figure and the wrong colour on
 * half the page. The server decides once per row and this reads it; the arrow
 * shows the direction of the number, only the colour judges it.
 *
 * ONLY THE MONTHS THAT HAVE HAPPENED. In March a whole year's plan against
 * three months of trade reports a 75% underspend on everything — true,
 * useless, and it buries the one account really over. The server closes the
 * window at today, prorates the current month by days, and reports the rest
 * of the plan as remaining, which is the other half of the answer.
 *
 * INCOME AND COST ARE TOTALLED APART. Miss revenue by 1M and save 1M on cost
 * and one total says 2M "under plan" while profit is exactly on it. So three
 * figures — income, cost, and profit, the one that says ahead or behind.
 */
export default function Variance({ company, onGo }: ScreenProps) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const lacking = missingSlugs(perms, SCREEN_SLUGS.variance);
  const thisYear = Number(todayInZone().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const q = useQuery({
    queryKey: IK.variance(company.id, year),
    queryFn: ({ signal }) => fetchBudgetVariance(company.id, year, signal),
    enabled: lacking.length === 0,
    retry: false,
  });

  if (lacking.length) return <NotGranted what="Budget against actual" slugs={lacking} onAccess={() => onGo('myaccess')} />;

  const data = q.data;
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);
  const ready = data?.ok && data.budget && data.totals && data.from && data.to ? data : null;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead
        title="Budget vs actual"
        sub={
          ready ? (
            <>
              {company.name} · {ready.budget!.name} <Pill tone={ready.budget!.status === 'approved' ? 'green' : 'grey'}>{ready.budget!.status}</Pill> · {shortDate(ready.from)} to {shortDate(ready.to)} · in {ready.currency}
            </>
          ) : (
            company.name
          )
        }
      >
        {ready ? <ReportBar report="budget-variance" company={company} from={ready.from!} to={ready.to!} /> : null}
      </PageHead>
      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Year" className="w-[120px]">
          <Select aria-label="Year" value={year} onValueChange={setYear} options={years.map((y) => ({ value: y, label: String(y) }))} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
        </Field>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !data ? (
        <ReadFailed what="The variance" error={q.error} onRetry={() => void q.refetch()} />
      ) : !ready ? (
        // A year with no approved plan is a normal state with a clear next step, not an error.
        <div className="flex flex-col items-center gap-2.5 rounded-[12px] border border-dashed border-line bg-surface px-6 py-8 text-center">
          <p className="m-0 max-w-[60ch] text-[13px] text-ink-2">{data.message ?? `No approved budget for ${year}.`}</p>
          {can(perms, 'finance.budget.manage') ? (
            <button type="button" className={btn} onClick={() => onGo('budgets')}>
              Go to Budgets
            </button>
          ) : null}
        </div>
      ) : (
        <Body rows={ready.rows ?? []} totals={ready.totals!} cur={ready.currency} note={ready.note} />
      )}
    </div>
  );
}

function Body({ rows, totals, cur, note }: { rows: VarianceRow[]; totals: NonNullable<BudgetVariance['totals']>; cur: string; note?: string }) {
  const m = (v: string) => money(v, cur);
  // The longest bar is the worst variance; lengths only, the figures stay strings.
  const worst = Math.max(...rows.map((r) => Math.abs(num(r.variance))), 1);
  return (
    <>
      <StatGrid>
        <SideTile label="Income" side={totals.income} cur={cur} icon="trending-up" tone="blue" />
        <SideTile label="Cost" side={totals.cost} cur={cur} icon="receipt" tone="amber" />
        <StatCard
          label="Profit against plan"
          value={m(totals.profit.actual)}
          trend={varianceTrend(totals.profit.variance, cur, profitTone(totals.profit.variance))}
          sub={
            <>
              of {m(totals.profit.budget)} planned · Income less cost, both against plan.
            </>
          }
          icon="scale"
          tone="green"
        />
      </StatGrid>
      {note ? <p className="m-0 text-[11.5px] leading-relaxed text-ink-3">{note}</p> : null}

      <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="overflow-x-auto scroll-thin">
          <div className="min-w-[860px]">
            <THead cols={COLS} />
            {rows.length === 0 ? (
              <Empty text="Nothing budgeted and nothing posted for these months." />
            ) : (
              rows.map((r) => {
                const tone = favourTone(r.favourable);
                return (
                  <div key={r.account_id} className={row} data-favourable={r.favourable === null ? 'none' : String(r.favourable)}>
                    <Cell w={null} className="flex items-center gap-1.5">
                      <span className="font-mono text-[11.5px] text-ink-3">{r.code}</span>
                      <span className="min-w-0 truncate">{r.name}</span>
                      {/* The most useful rows in the report: money going somewhere nobody planned for. */}
                      {r.unbudgeted ? <Pill tone="amber">not budgeted</Pill> : null}
                      {r.is_income ? <Pill tone="grey">income</Pill> : null}
                    </Cell>
                    <Cell w={140} className="text-right text-ink-2 tabular-nums">
                      {m(r.budget)}
                    </Cell>
                    <Cell w={140} className="text-right tabular-nums">
                      {m(r.actual)}
                    </Cell>
                    <Cell w={220} className="text-right tabular-nums">
                      <VarianceCell row={r} cur={cur} tone={tone} />
                    </Cell>
                    <Cell w={120}>
                      <ShareBar value={Math.abs(num(r.variance))} total={worst} tone={SHARE[tone]} />
                    </Cell>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
      <p className="m-0 text-[11.5px] leading-relaxed text-ink-3">
        Worst first. Green is favourable and red is not — which is not the same as the sign: over plan is bad on a cost and good on income, so the colour reads the kind of account rather than the number.
      </p>
    </>
  );
}

const COLS: Array<[string, number | null]> = [
  ['Account', null],
  ['Budget', 140],
  ['Actual', 140],
  ['Variance', 220],
  ['Size', 120],
];

const SHARE: Record<Tone, ShareTone> = { good: 'success', bad: 'danger', flat: 'muted', none: 'muted' };

function VarianceCell({ row: r, cur, tone }: { row: VarianceRow; cur: string; tone: Tone }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="text-ink-2">{money(r.variance, cur)}</span>
      <span className={cx('inline-flex items-center gap-0.5 text-[11.5px] font-semibold', TONE_TEXT[tone])}>
        <Icon name={isZero(r.variance) ? 'minus' : isNegative(r.variance) ? 'arrow-down' : 'arrow-up'} size={12} />
        {pctText(r.variance_pct) ?? '—'}
      </span>
    </span>
  );
}

/** A variance as the card's pill: its sign as the arrow, and whether it is good news as its colour and its words. */
function varianceTrend(variance: string, cur: string, tone: Tone): StatTrend {
  return { direction: isZero(variance) ? 'flat' : isNegative(variance) ? 'down' : 'up', text: signedMoney(variance, cur), good: tone === 'good', label: 'against plan' };
}

function SideTile({ label, side, cur, icon, tone }: { label: string; side: VarianceSide; cur: string; icon: string; tone: StatTone }) {
  const m = (v: string) => money(v, cur);
  const t = favourTone(side.favourable);
  return (
    <StatCard
      data-favourable={side.favourable === null ? 'none' : String(side.favourable)}
      label={label}
      value={m(side.actual)}
      trend={side.favourable === null ? { direction: 'flat', text: signedMoney(side.variance, cur), label: 'against plan' } : varianceTrend(side.variance, cur, t)}
      sub={
        <>
          of {m(side.budget)} planned · {m(side.remaining_plan)} of plan left
        </>
      }
      icon={icon}
      tone={tone}
    />
  );
}
