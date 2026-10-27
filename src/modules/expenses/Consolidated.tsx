import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { shortDate } from '../finance/api';
import { Notice } from '../../components/RecordKit';
import { RangeFields, ReadFailed } from '../finance/ReportBar';
import { Cell, Empty, Field, input, PageHead, row } from '../../components/PageKit';
import { minWidth } from '../../components/ListKit';
import { can, money } from './api';
import { CONSOLIDATED_SORTS, fetchConsolidated, filterConsolidated, IK, num, sortConsolidated, topByCurrency, totalsByCurrency, type ConsolidatedSort } from './insight';
import { Note } from './parts';
import type { ScreenProps } from './Rail';

/**
 * Every company side by side.
 *
 * NOT THE SELECTION. This is the one Expenses screen that ignores the
 * switcher: it reads every company the person can report on, and says so,
 * because a heading naming the ticked companies over figures for all of them
 * is exactly the mistake the switcher exists to prevent. It takes its own
 * permission, `expense.report` — membership of one company does not imply
 * sight of the others.
 *
 * THE ABSENT NUMBER IS THE HONEST ONE. Where companies report in different
 * currencies there is no group total, and the screen says why rather than
 * adding LKR to USD because both happen to be DECIMAL. Converting them would
 * need one rate for a whole period, and which rate is an accounting policy
 * decision — not one this software makes on somebody's behalf and prints as a
 * fact. So the footer carries one total per currency, and a company's bar is
 * measured against the largest in its own currency.
 *
 * COMPANIES YOU CAN READ BUT NOT ACT IN ARE MARKED. Consolidated reporting
 * grants sight, not authority, and the row says so. Nothing acts on a row:
 * each is one company's totals for a period — a reading, not a record.
 */
export default function Consolidated(_props: ScreenProps) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const allowed = can(perms, 'expense.report');
  const [range, setRange] = useState({ from: '', to: '' });
  const [q, setQ] = useState('');
  const [access, setAccess] = useState<'' | 'act' | 'read'>('');
  const [sort, setSort] = useState<ConsolidatedSort>('total');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const problem = range.from && range.to && range.from > range.to ? 'The From date is after the To date.' : null;

  const data = useQuery({
    queryKey: IK.consolidated(range.from, range.to),
    queryFn: ({ signal }) => fetchConsolidated(range.from, range.to, signal),
    enabled: allowed && problem === null,
    retry: false,
    placeholderData: (prev) => prev,
  });

  const all = useMemo(() => data.data?.rows ?? [], [data.data]);
  const rows = useMemo(() => sortConsolidated(filterConsolidated(all, q, access), sort, dir), [all, q, access, sort, dir]);

  if (!allowed) {
    return (
      <Note>
        Seeing every organization at once needs the consolidated reporting permission, <code className="font-mono text-[12px]">expense.report</code>. Membership of one organization does not imply sight of the others.
      </Note>
    );
  }

  const d = data.data;
  const filtered = rows.length !== all.length;
  // Totals of what is on screen, per currency — the same as the server's when nothing is filtered out.
  const totals = totalsByCurrency(rows);
  const top = topByCurrency(all);
  const currencies = new Set(all.map((r) => r.currency)).size;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead
        title="All organizations"
        sub={
          <>
            Every company you can report on — not only the ones ticked in the switcher.
            {d?.from && d.to ? ` Spending from ${shortDate(d.from)} to ${shortDate(d.to)}.` : null}
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Find" className="w-[220px]">
          <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Organization or currency" aria-label="Search organization" />
        </Field>
        <RangeFields range={range} onChange={setRange} />
        <Field label="Access" className="w-[150px]">
          <Select
            aria-label="Filter by access"
            value={access}
            onValueChange={setAccess}
            options={[
              { value: '', label: 'Any access' },
              { value: 'act', label: 'Can act in' },
              { value: 'read', label: 'Read only' },
            ]}
            className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
          />
        </Field>
        <Field label="Order" className="w-[230px]">
          <span className="flex gap-1.5">
            <Select aria-label="Sort by" value={sort} onValueChange={setSort} options={CONSOLIDATED_SORTS} className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
            <button
              type="button"
              onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}
              aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
              title={dir === 'asc' ? 'Smallest first' : 'Largest first'}
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface text-ink-2 hover:bg-subtle"
            >
              <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={15} />
            </button>
          </span>
        </Field>
        {data.isFetching && d ? <span className="pb-2 text-[12px] text-ink-3">Updating…</span> : null}
      </div>

      {problem ? (
        <Notice tone="amber">{problem}</Notice>
      ) : data.isLoading ? (
        <Spinner />
      ) : data.error || !d ? (
        <ReadFailed what="The organizations’ figures" error={data.error} onRetry={() => void data.refetch()} />
      ) : (
        <>
          {currencies > 1 && sort !== 'name' && sort !== 'claims' ? <p className="m-0 text-[12px] text-ink-3">Amounts are ranked within each currency — a larger number in one currency is not more money than a smaller one in another.</p> : null}
          <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="overflow-x-auto scroll-thin">
              <div style={{ minWidth: minWidth(240, COLS.slice(1).map(([, w]) => w ?? 0)) }}>
                <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  {COLS.map(([l, w], i) => (
                    <span key={l} className={cx(w === null ? 'min-w-0 flex-1' : 'shrink-0', i > 0 && 'text-right')} style={w === null ? undefined : { width: w }}>
                      {l}
                    </span>
                  ))}
                </div>
                {rows.length === 0 ? (
                  <Empty text={all.length === 0 ? 'No organizations to compare.' : 'Nothing matches those filters.'} />
                ) : (
                  rows.map((r) => (
                    <div key={r.orgId ?? r.name} className={row}>
                      <Cell w={null}>
                        <span className="flex min-w-0 flex-col">
                          <b className="truncate text-ink">{r.name}</b>
                          <span className="truncate text-[11.5px] text-ink-3">
                            {r.currency}
                            {r.canAct ? '' : ' · you can read this one, not change it'}
                          </span>
                          {/* Relative to the largest in the same currency, so the shape of the group reads without comparing figures by eye. */}
                          <span className="mt-1 h-1.5 w-36 overflow-hidden rounded-full bg-subtle">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${(top[r.currency] ?? 0) > 0 ? Math.min(100, (Math.abs(num(r.total)) / top[r.currency]!) * 100) : 0}%` }} />
                          </span>
                        </span>
                      </Cell>
                      <Cell w={80} className="text-right text-ink-2 tabular-nums">
                        {r.claims}
                      </Cell>
                      <Cell w={150} className="text-right font-bold text-ink tabular-nums">
                        {money(r.total, r.currency)}
                      </Cell>
                      <Cell w={150} className="text-right text-warning-ink tabular-nums dark:text-warning">
                        {money(r.pending, r.currency)}
                      </Cell>
                      <Cell w={150} className="text-right text-primary tabular-nums">
                        {money(r.owed, r.currency)}
                      </Cell>
                      <Cell w={150} className="text-right text-success tabular-nums">
                        {money(r.paid, r.currency)}
                      </Cell>
                    </div>
                  ))
                )}
                {/*
                 * One figure per currency, spanning the row on purpose. "Total in
                 * LKR" is the Total column of the LKR companies only, so no single
                 * column position is honest for it — and a single group figure
                 * across currencies would be one the software invented.
                 */}
                {totals.length ? (
                  <div className="flex flex-wrap items-baseline justify-end gap-x-5 gap-y-1 border-t border-line bg-ground px-3.5 py-2.5">
                    {filtered ? <span className="mr-auto text-[12px] text-ink-3">Totals of the {rows.length === 1 ? 'company' : `${rows.length} companies`} shown</span> : null}
                    {totals.map((t) => (
                      <span key={t.currency} className="flex items-baseline gap-2" data-total={t.currency}>
                        <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Total in {t.currency || 'no currency'}</span>
                        <b className="text-[14px] text-ink tabular-nums">{money(t.total, t.currency)}</b>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
          {d.note ? <Notice tone="grey">{d.note}</Notice> : null}
        </>
      )}
    </div>
  );
}

const COLS: Array<[string, number | null]> = [
  ['Organization', null],
  ['Claims', 80],
  ['Total', 150],
  ['Awaiting approval', 150],
  ['Approved, unpaid', 150],
  ['Paid', 150],
];
