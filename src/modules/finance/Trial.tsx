import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { PageHead } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { isZero, money } from './api';
import { Notice } from '../../components/RecordKit';
import type { ScreenProps } from './Rail';
import { backwards, fetchTrialBalance, ledgerExtra, RK, trialCaption } from './reports';
import { Backwards, DateRange, ReportFailed } from './Statements';

/**
 * The trial balance, and the proof at the bottom of it.
 *
 * THE TOTALS ROW IS THE POINT OF THE REPORT. Everything above it is detail;
 * the two figures at the bottom being equal is the only thing that makes any
 * of the detail trustworthy. So the totals are drawn as a conclusion — the
 * heaviest rule on the page, and the verdict spelled out under it — rather
 * than as one more row of numbers.
 *
 * Posted journals only. A trial balance that included drafts would balance
 * while describing a position the company is not in.
 *
 * `To` alone is balances as at that date; `From` makes it the movements in a
 * window. Both are the server's own convention, and the caption is read from
 * the `mode` it answers with rather than restated here.
 */
const W = { code: 110, fig: 170 };

export default function Trial({ company, onGo }: ScreenProps) {
  const [range, setRange] = useState({ from: '', to: '' });
  const bad = backwards(range.from, range.to);
  const q = useQuery({
    // The dates are in the key: a warm cache must not serve last period's figures under a caption describing this one.
    queryKey: RK.trial(company.id, range.from, range.to),
    queryFn: ({ signal }) => fetchTrialBalance(company.id, range.from, range.to, signal),
    enabled: !bad,
    retry: false,
  });
  const d = q.data;
  const base = company.base_currency ?? '';

  let body: ReactNode;
  if (bad) body = <Backwards />;
  else if (q.isLoading) body = <Spinner />;
  // A failed request is not an empty trial balance: this is the screen somebody opens to check whether anything is wrong.
  else if (q.error || !d) body = <ReportFailed what="The trial balance" not="about the books" error={q.error} onRetry={() => void q.refetch()} onAccess={() => onGo('myaccess')} />;
  else if (!d.rows.length) {
    body = (
      <p className="m-0 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[13px] text-ink-2">
        {range.from || range.to
          ? 'No account moved in that period. Widen the dates, or clear them to see everything posted.'
          : 'No account has a posted movement, so there is nothing to balance yet. A set of books that has been posted to and then wholly reversed looks the same from here — the journals list shows which it is.'}
      </p>
    );
  } else {
    body = (
      <>
        <p className="m-0 text-[12.5px] text-ink-2">{trialCaption(d)}</p>
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex gap-2.5 border-b border-line bg-ground px-4 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="shrink-0" style={{ width: W.code }}>
              Code
            </span>
            <span className="min-w-0 flex-1">Account</span>
            <span className="shrink-0 text-right" style={{ width: W.fig }}>
              Debit
            </span>
            <span className="shrink-0 text-right" style={{ width: W.fig }}>
              Credit
            </span>
          </div>
          {d.rows.map((r) => (
            <div key={r.account_id} className="flex items-baseline gap-2.5 border-b border-line/60 px-4 py-[7px] text-[13px] last:border-b-0 hover:bg-subtle">
              <span className="shrink-0 font-mono text-[12px] text-ink-2" style={{ width: W.code }}>
                {r.code}
              </span>
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                {/* The same dates, in the ledger: a trial balance line and the account's closing balance there are the same figure. */}
                <button type="button" onClick={() => onGo('ledger', ledgerExtra(r.account_id, d.from, d.to))} title="Open this account's general ledger for the same dates" className="truncate text-left text-ink hover:text-primary hover:underline">
                  {r.name}
                </button>
                {/* An archived code can be reused, so two rows may both read 6100: this says which one is history. */}
                {r.status === 'archived' ? <Pill tone="grey">Archived</Pill> : null}
              </span>
              <Side value={r.debit} />
              <Side value={r.credit} />
            </div>
          ))}
          <div className="flex items-baseline gap-2.5 border-t-2 border-ink bg-ground px-4 py-2.5 text-[13.5px] font-bold text-ink">
            <span className="shrink-0" style={{ width: W.code }} />
            <span className="min-w-0 flex-1">Total</span>
            <span className="shrink-0 text-right tabular-nums" style={{ width: W.fig }}>
              {money(d.total_debit, base)}
            </span>
            <span className="shrink-0 text-right tabular-nums" style={{ width: W.fig }}>
              {money(d.total_credit, base)}
            </span>
          </div>
        </div>
        <Notice tone={d.balanced ? 'green' : 'red'}>
          <span className="flex items-center gap-2">
            <Icon name={d.balanced ? 'check-circle' : 'warning'} size={15} className="shrink-0" />
            {d.balanced ? (
              'Debits equal credits. The books balance.'
            ) : (
              <span>
                Out by <b className="tabular-nums">{money(d.difference, base)}</b>. Something has been posted that should not have been.
              </span>
            )}
          </span>
        </Notice>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Trial balance" sub="Every account with a posted movement, net on the side it falls — and whether the two sides agree." />
      <DateRange
        from={range.from}
        to={range.to}
        onChange={setRange}
        reset="Everything posted"
        hint={
          <>
            A <b>To</b> on its own gives balances as at that date. Both together give the movements inside the window.
          </>
        }
      />
      {body}
    </div>
  );
}

/** One side of a line: the net, or a dash where it sits on the other side. */
function Side({ value }: { value: string }) {
  return (
    <span className={cx('shrink-0 text-right tabular-nums', isZero(value) ? 'text-ink-3' : 'text-ink')} style={{ width: W.fig }}>
      {isZero(value) ? '—' : money(value)}
    </span>
  );
}
