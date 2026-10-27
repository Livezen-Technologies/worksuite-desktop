import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { Cell, Empty, Kpi, PageHead, Panel, Seg, THead, row } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { isNegative, isZero, money, problemsOf, shortDate } from './api';
import { CurrencyPicker, FxNotice } from './Currency';
import {
  decimalsOf,
  fetchCashOverview,
  fetchForecast,
  fxState,
  horizons,
  IK,
  missingSlugs,
  monthLong,
  rangeProblem,
  SCREEN_SLUGS,
  type CashBucket,
  type CashOverview as CashData,
  type Forecast as ForecastData,
} from './insight';
import { Notice } from '../../components/RecordKit';
import type { ScreenProps } from './Rail';
import { NotGranted, RangeFields, ReadFailed, ReportBar } from './ReportBar';
import { ShareBar, TrendChart } from './Trend';
import { StatGrid } from '../../components/StatCard';

/**
 * The cash flow overview (FR-FIN-15.03) and the forecast (FR-FIN-15.04).
 *
 * THIS IS THE DIRECT METHOD, AND THE STATEMENT UNDER REPORTS IS NOT. That one
 * derives the movement in cash from the movement in every other account — what
 * an accountant signs, and structurally unable to say how much came in from
 * customers. This reads the cash accounts' own lines and groups what was on
 * the other side. Both come from one ledger, and the page states whether they
 * agree on the net movement rather than assuming it.
 *
 * THE FORECAST IS MARKED ON EVERY ROW. It is the only thing here with no
 * journal behind it, so it is labelled estimated, and each month shows how
 * much is committed — an invoice due, a recurring profile scheduled — as
 * against extrapolated from history. "27M next month" made of signed
 * contracts and "27M" made of hoping are different facts. It has its own
 * permission, and more than three months ahead needs `finance.forecast.manage`.
 */
export default function CashOverview({ company, onGo }: ScreenProps) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const lacking = missingSlugs(perms, SCREEN_SLUGS.cash);
  const today = todayInZone();
  const [range, setRange] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today });
  const [currency, setCurrency] = useState('');
  const problem = rangeProblem(range);

  const q = useQuery({
    queryKey: IK.cash(company.id, range.from, range.to, currency),
    queryFn: ({ signal }) => fetchCashOverview(company.id, range.from, range.to, currency, signal),
    enabled: lacking.length === 0 && problem === null,
    retry: false,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === company.id ? prev : undefined),
  });

  if (lacking.length) return <NotGranted what="The cash flow overview" slugs={lacking} onAccess={() => onGo('myaccess')} />;

  const data = q.data;
  const state = fxState(data?.fx, data?.position_fx);
  const cur = data?.currency ?? company.base_currency ?? '';

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Cash flow overview" sub={data ? `${company.name} · ${shortDate(data.from)} to ${shortDate(data.to)} · in ${cur}` : company.name}>
        {data && state !== 'mixed' ? <ReportBar report="cash-flow" company={company} from={data.from} to={data.to} currency={state === 'translated' ? cur : undefined} /> : null}
      </PageHead>
      <div className="flex flex-wrap items-end gap-2.5">
        <RangeFields range={range} onChange={setRange} />
        {data ? <CurrencyPicker value={currency} options={data.currencies} base={data.base_currency} onChange={setCurrency} /> : null}
        {q.isFetching && data ? <span className="pb-2 text-[12px] text-ink-3">Updating…</span> : null}
      </div>
      {problem ? (
        <Notice tone="amber">{problem}</Notice>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error || !data ? (
        <ReadFailed what="The cash flow" error={q.error} onRetry={() => void q.refetch()} />
      ) : state === 'mixed' ? (
        <FxNotice fx={data.fx} positionFx={data.position_fx} onBase={() => setCurrency('')} />
      ) : (
        <Body data={data} cur={cur} translated={state === 'translated'} />
      )}
      {/* The forecast is its own read and its own grant; a person without it still has the actuals. */}
      {problem === null ? <ForecastPanel company={company.id} currency={currency} /> : null}
    </div>
  );
}

function Body({ data, cur, translated }: { data: CashData; cur: string; translated: boolean }) {
  const dec = decimalsOf(data.currencies, cur);
  const m = (v: string | null | undefined) => money(v, cur, dec);
  const months = Object.keys(data.monthly);
  const s = data.summary;

  return (
    <>
      {data.note ? <Notice tone="amber">{data.note}</Notice> : null}
      <StatGrid min={200}>
        <Kpi icon="landmark" tone="blue" label="Opening balance" value={<span className="text-[18px]">{m(s.opening)}</span>} sub={`on ${shortDate(data.from)}`} />
        <Kpi icon="arrow-down-line" label="Cash in" tone="green" value={<span className="text-[18px]">{m(s.inflows)}</span>} />
        <Kpi icon="arrow-up-line" label="Cash out" tone="red" value={<span className="text-[18px]">{m(s.outflows)}</span>} />
        <Kpi icon="arrow-left-right" tone="violet" label="Net movement" value={<span className="text-[18px]">{m(s.net)}</span>} />
        <Kpi icon="landmark" tone="cyan" label="Closing balance" value={<span className="text-[18px]">{m(s.closing)}</span>} sub={`on ${shortDate(data.to)}`} />
      </StatGrid>
      <FxNotice fx={data.fx} positionFx={data.position_fx} />
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] leading-relaxed text-ink-3">
        {/* Translated, balances take the closing rate and movements the average, so the identity holds only in the books' own currency. */}
        <span>{translated ? `In ${data.base_currency}, opening + in − out = closing; translated at two rates, the figures above need not add up exactly.` : 'Opening + in − out = closing.'}</span>
        {!isZero(s.transfers) ? <span>{m(s.transfers)} moved between this company’s own accounts and is excluded from both totals — it never left.</span> : null}
        <span className={data.agrees ? '' : 'font-semibold text-danger'}>
          {data.agrees ? 'Agrees with the indirect cash flow statement under Reports' : 'Does NOT agree with the indirect statement — the difference is worth investigating'}
          {/* Checked in the books' currency, before any translation: a converted net against an unconverted movement would never agree. */}
          {translated ? ` (checked in ${data.statement.currency}, before translation).` : '.'}
        </span>
      </p>

      <Panel title="Cash in and out by month" bodyClassName="px-3.5 py-3">
        <TrendChart
          title="Cash in and out by month"
          description={`From ${shortDate(data.from)} to ${shortDate(data.to)}, in ${cur}.`}
          labels={months}
          format={m}
          series={[
            { key: 'in', label: 'In', values: months.map((mo) => data.monthly[mo]?.in ?? '0'), tone: 'success' },
            { key: 'out', label: 'Out', values: months.map((mo) => data.monthly[mo]?.out ?? '0'), tone: 'danger' },
            { key: 'net', label: 'Net', values: months.map((mo) => data.monthly[mo]?.net ?? '0'), tone: 'primary' },
          ]}
        />
      </Panel>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Buckets title="Cash inflows" icon="arrow-down" rows={data.inflows} total={s.inflows} money={m} tone="success" />
        <Buckets title="Cash outflows" icon="arrow-up" rows={data.outflows} total={s.outflows} money={m} tone="danger" />
      </div>

      <Panel title="Bank and cash accounts" sub="A transfer between two of these is money out of one and into the other, so these columns add up to more than the totals above. It only cancels when they are combined." bodyClassName="flex flex-col">
        {data.accounts.length === 0 ? (
          <Empty text="No cash or bank account is nominated for this company." />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <div className="min-w-[760px]">
              <THead cols={ACC_COLS} />
              {data.accounts.map((a) => (
                <div key={a.account_id} className={row}>
                  <Cell w={null}>
                    <span className="font-mono text-[11.5px] text-ink-3">{a.code}</span> {a.name}
                    {a.reconcilable ? <span className="ml-2 rounded-[6px] bg-subtle px-1.5 py-0.5 text-[10.5px] text-ink-3">reconcilable</span> : null}
                  </Cell>
                  <Cell w={140} className="text-right text-ink-2 tabular-nums">
                    {m(a.opening)}
                  </Cell>
                  <Cell w={140} className="text-right text-success tabular-nums">
                    {m(a.in)}
                  </Cell>
                  <Cell w={140} className="text-right text-danger tabular-nums">
                    {m(a.out)}
                  </Cell>
                  <Cell w={140} className="text-right font-semibold tabular-nums">
                    {m(a.closing)}
                  </Cell>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}

const ACC_COLS: Array<[string, number | null]> = [
  ['Account', null],
  ['Opening', 140],
  ['In', 140],
  ['Out', 140],
  ['Closing', 140],
];

function Buckets({ title, icon, rows, total, money: m, tone }: { title: string; icon: string; rows: CashBucket[]; total: string; money: (v: string) => string; tone: 'success' | 'danger' }) {
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-1.5">
          <Icon name={icon} size={15} className={tone === 'success' ? 'text-success' : 'text-danger'} /> {title}
        </span>
      }
      sub="By the account on the other side of each cash entry — its nominated role where it has one, its own name where it does not."
      bodyClassName="flex flex-col gap-2 px-3.5 py-3"
    >
      {rows.length === 0 ? (
        <Empty text="No movement in this period." />
      ) : (
        <>
          {rows.map((r) => (
            <div key={r.category}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-ink-2" title={r.accounts.map((a) => a.name).join(', ')}>
                  {r.category}
                </span>
                <span className="shrink-0 text-ink tabular-nums">{m(r.amount)}</span>
              </div>
              <ShareBar className="mt-1" value={r.amount} total={total} tone={tone} />
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2 text-[13px] font-semibold">
            <span className="text-ink-2">Total</span>
            <span className="text-ink tabular-nums">{m(total)}</span>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── the forecast ─────────────────────────────────────────────────────────

const FC_COLS: Array<[string, number | null]> = [
  ['Month', null],
  ['Expected in', 140],
  ['Expected out', 140],
  ['Net', 140],
  ['Closing cash', 150],
  ['Committed', 220],
];

function ForecastPanel({ company, currency }: { company: number; currency: string }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const lacking = missingSlugs(perms, SCREEN_SLUGS.forecast);
  const allowed = horizons(perms);
  const [horizon, setHorizon] = useState(3);
  const q = useQuery({
    queryKey: IK.forecast(company, horizon, currency),
    queryFn: ({ signal }) => fetchForecast(company, horizon, currency, signal),
    enabled: lacking.length === 0,
    retry: false,
  });
  const fc = q.data;

  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-dashed border-line bg-subtle/40 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-ink">Forecast</b>
        {fc?.estimated === false ? null : <Pill tone="amber">estimated</Pill>}
        <span className="min-w-0 flex-1" />
        {lacking.length ? null : allowed.length > 1 ? (
          <Seg label="Horizon" value={horizon} onChange={setHorizon} options={allowed.map((n) => ({ id: n, label: `${n} months` }))} />
        ) : (
          <span className="text-[11.5px] text-ink-3">
            Three months ahead. Further needs <code className="font-mono">finance.forecast.manage</code>.
          </span>
        )}
      </div>
      {lacking.length ? (
        <p className="m-0 text-[12.5px] text-ink-3">
          The forecast needs {lacking.map((s, i) => (
            <span key={s}>
              {i > 0 ? ' and ' : ''}
              <code className="font-mono text-[11.5px]">{s}</code>
            </span>
          ))}
          , which you do not hold. It is a separate grant from the actuals above because it is not a fact.
        </p>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error || !fc ? (
        <Notice tone="amber">{q.error ? problemsOf(q.error).join(' ') : 'Could not read the forecast.'}</Notice>
      ) : (
        <ForecastBody fc={fc} />
      )}
    </section>
  );
}

function ForecastBody({ fc }: { fc: ForecastData }) {
  const cur = fc.currency;
  const m = (v: string) => money(v, cur);
  if (fc.months.length === 0) return <p className="m-0 text-[13px] text-ink-2">{fc.note}</p>;
  return (
    <>
      {/* The forecast follows the page's currency, at the average of the last year: there is no rate for a month that has not happened. */}
      <FxNotice fx={fc.fx} over="the last twelve months" />
      <p className="m-0 text-[12px] leading-relaxed text-ink-3">
        {fc.note} Based on {fc.history_months} month{fc.history_months === 1 ? '' : 's'} of posted history. <b className="font-semibold text-ink-2">These are not accounting figures</b> — nothing here is posted, and nothing here is stored.
      </p>
      {fc.risks.map((r) => (
        <Notice key={r.month} tone="red" className="flex items-start gap-2">
          <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
          <span>
            <b>Possible shortfall in {monthLong(r.month)}.</b> Cash is expected to reach {m(r.expected_closing)}, a shortfall of {m(r.shortfall)}. {m(r.scheduled_out)} of that month’s outgoings is already committed.
          </span>
        </Notice>
      ))}
      <div className="overflow-x-auto rounded-[10px] border border-line bg-surface scroll-thin">
        <div className="min-w-[900px]">
          <THead cols={FC_COLS} />
          {fc.months.map((mo) => (
            <div key={mo.month} className={row}>
              <Cell w={null}>
                {monthLong(mo.month)}
                {mo.estimated ? <span className="ml-1.5 text-[11px] text-ink-3">estimated</span> : null}
              </Cell>
              <Cell w={140} className="text-right tabular-nums">
                {m(mo.revenue)}
              </Cell>
              <Cell w={140} className="text-right tabular-nums">
                {m(mo.expenses)}
              </Cell>
              <Cell w={140} className="text-right tabular-nums">
                {m(mo.profit)}
              </Cell>
              <Cell w={150} className={cx('text-right font-semibold tabular-nums', isNegative(mo.closing_cash) && 'text-danger')}>
                {m(mo.closing_cash)}
              </Cell>
              {/* The honest column: how much of the row is a commitment rather than an extrapolation. */}
              <Cell w={220} className="text-right text-[12px] text-ink-3 tabular-nums">
                {m(mo.basis.scheduled_in)} in · {m(mo.basis.scheduled_out)} out
              </Cell>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
