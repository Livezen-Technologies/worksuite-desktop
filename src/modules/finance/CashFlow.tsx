import { useQuery } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { PageHead } from '../../components/PageKit';
import { isNegative, isZero, longDate, money } from './api';
import { Notice } from '../../components/RecordKit';
import type { ScreenProps } from './Rail';
import { ACTIVITIES, backwards, fetchCashFlow, fetchChangesInEquity, ledgerExtra, RK, type CashActivity, type CashFlowStatement, type CashLine, type EquityStatement } from './reports';
import { Backwards, DateRange, ReportFailed } from './Statements';

/**
 * Cash flow and changes in equity, over one window.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE "CLASSIFIED BY" COLUMN IS NOT DECORATION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Which activity a movement belongs to is the one judgement in a cash flow,
 * and it is made from the chart's own headings — "Current Assets" operating,
 * "Fixed Assets" investing. Reading a heading is less robust than reading
 * structure, so every line shows the heading it was classified by. A reader
 * seeing `Fixed Assets` under investing can tell at a glance whether it is
 * right, which is a better guarantee than a rule nobody can see applied.
 *
 * Both statements carry their check: the three activities against the
 * movement in cash, and closing equity against the balance sheet's. Each is
 * arithmetic the server did, stated rather than assumed.
 */
const W = { section: 200, fig: 180 };

export default function CashFlow({ company, onGo }: ScreenProps) {
  const [range, setRange] = useState({ from: '', to: '' });
  const bad = backwards(range.from, range.to);
  const cf = useQuery({
    queryKey: RK.cf(company.id, range.from, range.to),
    queryFn: ({ signal }) => fetchCashFlow(company.id, range.from, range.to, signal),
    enabled: company.has_books && !bad,
    retry: false,
  });
  const eq = useQuery({
    queryKey: RK.eq(company.id, range.from, range.to),
    queryFn: ({ signal }) => fetchChangesInEquity(company.id, range.from, range.to, signal),
    enabled: company.has_books && !bad,
    retry: false,
  });

  let body: ReactNode;
  if (!company.has_books) body = <p className="m-0 text-[13px] text-ink-2">{company.name} has no general ledger yet.</p>;
  else if (bad) body = <Backwards />;
  else if (cf.isLoading || eq.isLoading) body = <Spinner />;
  else if (cf.error || eq.error || !cf.data || !eq.data) {
    body = (
      <ReportFailed
        what="These statements"
        not="that the company had no cash flow"
        error={cf.error ?? eq.error}
        onRetry={() => {
          void cf.refetch();
          void eq.refetch();
        }}
        onAccess={() => onGo('myaccess')}
      />
    );
  } else {
    const base = cf.data.base_currency ?? company.base_currency ?? '';
    const c = cf.data.statement;
    // The same window in the ledger: a cash flow line is that account's movement in it, with the sign turned to its effect on cash.
    const open = (id: number) => onGo('ledger', ledgerExtra(id, c.from, c.to));
    body = (
      <>
        <CashSection c={c} base={base} onAccount={open} />
        <EquitySection e={eq.data.statement} base={base} onAccount={open} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Cash flow and equity" sub="Where the cash came from and went, and what moved the owners' stake — over the same window, from posted journals only." />
      {/* The dates sit above every branch, so a window that fails can be changed rather than stranding the page. */}
      <DateRange from={range.from} to={range.to} onChange={setRange} reset="The open financial year" hint="Left empty, the open financial year." />
      {body}
    </div>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <Notice tone={ok ? 'green' : 'red'}>
      <span className="flex items-start gap-2">
        <Icon name={ok ? 'check-circle' : 'warning'} size={15} className="mt-0.5 shrink-0" />
        <span>{children}</span>
      </span>
    </Notice>
  );
}

function AccountLabel({ l, onAccount }: { l: CashLine; onAccount: (id: number) => void }) {
  return (
    <button type="button" onClick={() => onAccount(l.account_id)} title="Open this account's general ledger for the same dates" className="group flex min-w-0 flex-1 items-baseline gap-2 pl-4 text-left">
      <span className="w-[46px] shrink-0 font-mono text-[11.5px] text-ink-3">{l.code}</span>
      <span className="truncate text-ink group-hover:text-primary group-hover:underline">{l.name}</span>
    </button>
  );
}

/** A figure on its own line, ruled as heavily as it matters. */
function Line({ label, value, base, rule, strong }: { label: ReactNode; value: string; base: string; rule?: 'thin' | 'heavy' | 'net'; strong?: boolean }) {
  return (
    <div
      className={cx(
        'flex items-baseline gap-2.5 px-4 py-2 text-[13px]',
        rule === 'thin' && 'border-t border-line',
        rule === 'heavy' && 'mt-1 border-t-2 border-line',
        rule === 'net' && 'border-t-2 border-ink',
        strong ? 'font-bold text-ink' : 'text-ink',
      )}
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className={cx('shrink-0 text-right tabular-nums', rule === 'net' && isNegative(value) && 'text-danger')} style={{ width: W.fig }}>
        {money(value, base)}
      </span>
    </div>
  );
}

function CashSection({ c, base, onAccount }: { c: CashFlowStatement; base: string; onAccount: (id: number) => void }) {
  const shown = ACTIVITIES.map((k) => c.activities[k]).filter((a): a is CashActivity => !!a && a.lines.length > 0);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-[16px] font-bold text-ink">Cash flow</h2>
        <p className="m-0 max-w-[80ch] text-[12.5px] text-ink-3">
          {longDate(c.from)} to {longDate(c.to)}, indirect method. Every account that is not cash is classified into one of the three activities, so the total is the cash movement by arithmetic.
        </p>
      </div>
      <Verdict ok={c.reconciles}>
        {c.reconciles ? (
          <>
            The three activities add up to the movement in cash, <b className="tabular-nums">{money(c.movement, base)}</b>.
          </>
        ) : (
          <>
            This does not reconcile — out by <b className="tabular-nums">{money(c.difference, base)}</b>. A journal somewhere does not balance.
          </>
        )}
      </Verdict>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface pb-1">
        <div className="flex gap-2.5 border-b border-line bg-ground px-4 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <span className="min-w-0 flex-1">Account</span>
          <span className="shrink-0" style={{ width: W.section }}>
            Classified by
          </span>
          <span className="shrink-0 text-right" style={{ width: W.fig }}>
            Effect on cash
          </span>
        </div>
        {!shown.length ? <p className="m-0 px-4 pt-3 text-[12.5px] text-ink-3">No account other than cash moved in this window.</p> : null}
        {shown.map((a) => (
          <Fragment key={a.name}>
            <div className="px-4 pt-4 pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{a.name}</div>
            {a.lines.map((l) => (
              <div key={l.account_id} className="flex items-baseline gap-2.5 px-4 py-[5px] text-[13px] hover:bg-subtle">
                <AccountLabel l={l} onAccount={onAccount} />
                <span className="shrink-0 truncate text-[12px] text-ink-3" style={{ width: W.section }}>
                  {l.section || '—'}
                </span>
                <span className={cx('shrink-0 text-right tabular-nums', isNegative(l.amount) ? 'text-danger' : 'text-ink')} style={{ width: W.fig }}>
                  {money(l.amount)}
                </span>
              </div>
            ))}
            <Line label={a.name} value={a.total} base={base} rule="thin" strong />
          </Fragment>
        ))}
        <Line label="Cash at the start" value={c.opening_cash} base={base} rule="heavy" />
        <Line label="Movement" value={c.movement} base={base} />
        <Line label="Cash at the end" value={c.closing_cash} base={base} rule="net" strong />
      </div>
    </section>
  );
}

function EquitySection({ e, base, onAccount }: { e: EquityStatement; base: string; onAccount: (id: number) => void }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-5">
      <div>
        <h2 className="m-0 text-[16px] font-bold text-ink">Changes in equity</h2>
        <p className="m-0 text-[12.5px] text-ink-3">
          {longDate(e.from)} to {longDate(e.to)}
        </p>
      </div>
      <Verdict ok={e.reconciles}>
        {e.reconciles ? (
          <>
            Closing equity agrees with the balance sheet at <b className="tabular-nums">{money(e.closing, base)}</b>.
          </>
        ) : (
          <>
            Closing equity is <b className="tabular-nums">{money(e.closing, base)}</b> against the balance sheet's <b className="tabular-nums">{money(e.closing_per_balance_sheet, base)}</b>.
          </>
        )}
      </Verdict>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <Line
          label={
            <>
              <b>Equity at the start</b>
              {/* Last year's result, still unclosed in the P&L accounts, is part of it — which only shows from the second year on. */}
              {!isZero(e.profit_brought_forward) ? <span className="ml-2 text-[11.5px] text-ink-3">including {money(e.profit_brought_forward, base)} of earlier profit not yet closed into equity</span> : null}
            </>
          }
          value={e.opening}
          base={base}
        />
        {e.movements.map((m) => (
          <div key={m.account_id} className="flex items-baseline gap-2.5 border-t border-line/60 px-4 py-[6px] text-[13px] hover:bg-subtle">
            <AccountLabel l={m} onAccount={onAccount} />
            <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.fig }}>
              {money(m.amount)}
            </span>
          </div>
        ))}
        <div className="flex items-baseline gap-2.5 border-t border-line/60 px-4 py-[6px] text-[13px]">
          <span className="min-w-0 flex-1 pl-4 text-ink">
            Profit for the year
            <span className="ml-2 text-[11.5px] text-ink-3">computed, until a close writes it to 3300</span>
          </span>
          <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.fig }}>
            {money(e.profit)}
          </span>
        </div>
        <Line label="Equity at the end" value={e.closing} base={base} rule="net" strong />
      </div>
    </section>
  );
}
