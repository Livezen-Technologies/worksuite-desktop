import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useTab } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btnSmall, Field, input, PageHead } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { fetchAccounts, flattenAccounts, isNegative, isZero, K, money, shortDate } from './api';
import { Notice } from '../../components/RecordKit';
import type { ScreenProps } from './Rail';
import { backwards, count, fetchLedger, ledgerExtra, readLedgerQuery, RK, type LedgerData, type LedgerRow } from './reports';
import { Backwards, ReportFailed } from './Statements';

/**
 * One account's movements, with a running balance.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS THE SCREEN SOMEBODY OPENS TO ASK "WHY IS THIS NUMBER WRONG"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The trial balance says an account stands at a figure. This says how it got
 * there. So three things it must never do quietly:
 *
 *   - Start the running total at zero when there is history before the
 *     window. The opening balance is its own row, above the movements, drawn
 *     even when it is zero: "it opened at nothing" is a fact, and its absence
 *     would read as "there was no history", which is a different claim.
 *   - Report a truncated page's last running total as the closing balance.
 *     The server sends `truncated` and the true closing figure; when the page
 *     was cut short this says so, above the table where it is seen first.
 *   - Show a reversal as an ordinary entry. A contra copies the original
 *     line's wording, so without a marker it reads as a second, inexplicable
 *     movement the other way. Both ends are marked, and each opens the other.
 *
 * The running balance moves in the account's NORMAL direction — a debit
 * increases an asset and decreases a liability — which the server computes.
 *
 * Where it starts: `&account=`, `&from=`, `&to=` on the tab's address, which
 * is how the trial balance and the statements open an account here. Read once,
 * when the screen opens; a change made here is written back to the address,
 * so a restored tab reopens on the same account and dates.
 */
const W = { date: 104, journal: 150, fig: 128, balance: 150 };

export default function Ledger({ company, onGo }: ScreenProps) {
  const { query } = useTab();
  const [sel, setSel] = useState(() => readLedgerQuery(query));
  const accountsQ = useQuery({ queryKey: K.accounts(company.id), queryFn: ({ signal }) => fetchAccounts(company.id, signal), retry: false });
  // Postable accounts only — a heading carries no entries — archived ones included: they keep their ledger.
  const accounts = useMemo(() => flattenAccounts(accountsQ.data ?? []).filter((a) => a.is_postable), [accountsQ.data]);
  const bad = backwards(sel.from, sel.to);
  const q = useQuery({
    // Every filter is in the key. A date left out of it would serve the previous range's rows under the new heading — plausible and wrong.
    queryKey: RK.ledger(company.id, sel.account, sel.from, sel.to),
    queryFn: ({ signal }) => fetchLedger(company.id, sel, signal),
    enabled: sel.account !== '' && !bad,
    retry: false,
  });

  const change = (patch: Partial<typeof sel>) => {
    const next = { ...sel, ...patch };
    setSel(next);
    onGo('ledger', ledgerExtra(next.account, next.from, next.to));
  };

  let body: ReactNode;
  if (sel.account === '') body = <p className="m-0 rounded-[12px] border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3">Choose an account to see what has moved through it.</p>;
  else if (bad) body = <Backwards />;
  else if (q.isLoading) body = <Spinner />;
  else if (q.error || !q.data) body = <ReportFailed what="The ledger" not="that the account is empty" error={q.error} onRetry={() => void q.refetch()} onAccess={() => onGo('myaccess')} />;
  else body = <Movements d={q.data} from={sel.from} cur={company.base_currency ?? ''} onJournal={(id) => onGo('journals', `&open=${id}`)} />;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="General ledger" sub="One account's posted movements, and the balance after each, moving the way the account normally does." />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Account" className="w-[380px]">
          <Select aria-label="Account" searchable value={sel.account} onChange={(e) => change({ account: e.target.value })} className="h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px]">
            <option value="">Choose an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {`${a.code} — ${a.name}${a.status === 'archived' ? ' (archived)' : ''}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" className="w-[160px]">
          <input type="date" value={sel.from} onChange={(e) => change({ from: e.target.value })} className={input} />
        </Field>
        <Field label="To" className="w-[160px]">
          <input type="date" value={sel.to} onChange={(e) => change({ to: e.target.value })} className={input} />
        </Field>
        {sel.from || sel.to ? (
          <button type="button" className={cx(btnSmall, 'mb-0.5')} onClick={() => change({ from: '', to: '' })}>
            All dates
          </button>
        ) : null}
      </div>
      {accountsQ.error ? <ReportFailed what="The chart of accounts" not="that the company has no accounts" error={accountsQ.error} onRetry={() => void accountsQ.refetch()} /> : null}
      {body}
    </div>
  );
}

function Movements({ d, from, cur, onJournal }: { d: LedgerData; from: string; cur: string; onJournal: (id: number) => void }) {
  const a = d.account;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b className="text-[15px] text-ink">
          <span className="font-mono">{a.code}</span> {a.name}
        </b>
        <span className="text-[12px] text-ink-3">{a.normal_balance === 'debit' ? 'Debits increase it' : 'Credits increase it'}</span>
        {a.status === 'archived' ? <Pill tone="grey">Archived</Pill> : null}
      </div>

      {/*
        * TRUNCATION IS SAID OUT LOUD, before the rows. A page silently showing
        * the first 5,000 of 40,000 movements reads as a complete ledger, and its
        * last running balance would be the middle of the period presented as
        * the end. The closing figure is the server's separate total over the
        * whole window, so it is right — and this is why it does not match the
        * last row.
        */}
      {d.truncated ? (
        <Notice tone="amber">
          <b>Only the first {count(d.limit)} movements are shown, oldest first.</b> The closing balance at the foot covers the whole period, not just this page, so it will not match the last row — narrow the dates to see the rest.
        </Notice>
      ) : null}

      {d.rows.length === 0 && isZero(d.opening) ? (
        <p className="m-0 rounded-[12px] border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3">Nothing has been posted to this account in this window.</p>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
          <div className="min-w-[860px]">
            <div className="flex gap-2.5 border-b border-line bg-ground px-4 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="shrink-0" style={{ width: W.date }}>
                Date
              </span>
              <span className="shrink-0" style={{ width: W.journal }}>
                Journal
              </span>
              <span className="min-w-0 flex-1">Description</span>
              <span className="shrink-0 text-right" style={{ width: W.fig }}>
                Debit
              </span>
              <span className="shrink-0 text-right" style={{ width: W.fig }}>
                Credit
              </span>
              <span className="shrink-0 text-right" style={{ width: W.balance }}>
                Balance
              </span>
            </div>
            {from ? (
              <div className="flex items-baseline gap-2.5 border-b border-line/60 bg-subtle/60 px-4 py-[7px] text-[13px]">
                <span className="shrink-0 text-ink-2" style={{ width: W.date }}>
                  {shortDate(from)}
                </span>
                <span className="shrink-0" style={{ width: W.journal }} />
                <span className="min-w-0 flex-1 text-ink-2 italic">Opening balance</span>
                <span className="shrink-0" style={{ width: W.fig * 2 + 10 }} />
                <span className={cx('shrink-0 text-right font-semibold tabular-nums', isNegative(d.opening) ? 'text-danger' : 'text-ink-2')} style={{ width: W.balance }}>
                  {money(d.opening, cur)}
                </span>
              </div>
            ) : null}
            {d.rows.map((r, i) => (
              <Movement key={`${r.journal_id}-${i}`} r={r} onJournal={onJournal} />
            ))}
            <div className="flex items-baseline gap-2.5 border-t-2 border-ink bg-ground px-4 py-2.5 text-[13.5px] font-bold text-ink">
              <span className="min-w-0 flex-1">
                Closing balance
                {d.truncated ? <span className="ml-2 text-[11.5px] font-medium text-ink-3">the whole window, not the last row shown</span> : null}
              </span>
              <span className={cx('shrink-0 text-right tabular-nums', isNegative(d.closing) && 'text-danger')} style={{ width: W.balance }}>
                {money(d.closing, cur)}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Movement({ r, onJournal }: { r: LedgerRow; onJournal: (id: number) => void }) {
  return (
    <div className="flex items-baseline gap-2.5 border-b border-line/60 px-4 py-[7px] text-[13px] hover:bg-subtle">
      <span className="shrink-0 text-ink-2" style={{ width: W.date }}>
        {shortDate(r.entry_date)}
      </span>
      <span className="flex shrink-0 items-baseline gap-1 overflow-hidden" style={{ width: W.journal }}>
        <button type="button" onClick={() => onJournal(r.journal_id)} title="Open this journal" className="shrink-0 font-mono text-[12px] text-ink-2 hover:text-primary hover:underline">
          {r.journal_no}
        </button>
        {r.source_type && r.source_type !== 'manual' ? <span className="truncate text-[10.5px] text-ink-3">{r.source_type.replace(/_/g, ' ')}</span> : null}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-ink">{r.description || r.journal_description || <span className="text-ink-3">—</span>}</span>
        {/* Both ends of a reversal, named — and each opens the other, so the reader never has to hunt for why. */}
        {r.reverses_id ? (
          <button type="button" className="shrink-0" title="Open the journal this reverses" onClick={() => onJournal(r.reverses_id!)}>
            <Pill tone="amber">
              <Icon name="undo" size={11} className="mr-0.5" /> reverses an earlier entry
            </Pill>
          </button>
        ) : null}
        {r.reversed_by_id ? (
          <button type="button" className="shrink-0" title="Open the reversal" onClick={() => onJournal(r.reversed_by_id!)}>
            <Pill tone="red">since reversed</Pill>
          </button>
        ) : null}
      </span>
      <Figure value={r.debit} />
      <Figure value={r.credit} />
      <span className={cx('shrink-0 text-right font-semibold tabular-nums', isNegative(r.balance) ? 'text-danger' : 'text-ink')} style={{ width: W.balance }}>
        {money(r.balance)}
      </span>
    </div>
  );
}

function Figure({ value }: { value: string }) {
  return (
    <span className={cx('shrink-0 text-right tabular-nums', isZero(value) ? 'text-ink-3' : 'text-ink')} style={{ width: W.fig }}>
      {isZero(value) ? '—' : money(value)}
    </span>
  );
}
