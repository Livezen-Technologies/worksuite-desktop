import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { btn, btnSmall, Empty, input, PageHead } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { isZero, longDate, money, shortDate } from './api';
import { Notice } from '../../components/RecordKit';
import type { ScreenProps } from './Rail';
import { ageLabel, ageingKey, BUCKETS, docsFor, endOfLastMonth, fetchAgeing, partyKey, refusedRead, sideWords, tieSentences, type AgeingDoc, type Side, type TieOut } from './owed';

/**
 * Ageing, one screen for receivables and payables because they are mirrors:
 * two copies of a bucketing table would drift the first time somebody changed
 * one. (Payables here is the accounting view — what is owed, how old, whether
 * it ties to the control account — not Inventory's screen for paying bills.)
 *
 * THE DATE IS VISIBLY A PARAMETER. It defaults to today and sits at the top,
 * with the month-end beside it: an ageing that can only answer "now" cannot be
 * checked against a statement already sent or accounts already filed, and if
 * the control is hidden nobody finds out the report can do it. The server
 * re-derives the position as it stood — documents dated by then, settlements
 * made by then.
 *
 * THE TIE-OUT COMES BEFORE THE TABLE. A subledger that does not equal its
 * control account means something was posted to the wrong place, and that can
 * be true while every journal balances — no other figure here would catch it.
 * So it is drawn first and, when it disagrees, says so with the difference
 * spelled out, rather than in a footnote under eight hundred figures.
 *
 * A party's total opens to the documents behind it, in place: a total nobody
 * can open is a number to be argued with rather than checked.
 */
export default function Ageing({ company, onGo, side }: ScreenProps & { side: Side }) {
  // Keyed by side, so the date and the open row never carry from one mirror to the other.
  return <Report key={side} company={company} onGo={onGo} side={side} />;
}

function Report({ company, onGo, side }: ScreenProps & { side: Side }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const today = todayInZone();
  const monthEnd = endOfLastMonth(today);
  const [asOf, setAsOf] = useState(today);
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: ageingKey(company.id, side, asOf), queryFn: ({ signal }) => fetchAgeing(company.id, side, asOf, signal), retry: false });
  const w = sideWords(side);
  const d = q.data;
  const cur = d?.currency ?? company.base_currency ?? '';

  let body;
  if (q.isLoading) body = <Spinner />;
  else if (q.error || !d) {
    const refused = refusedRead(q.error, perms);
    body = (
      <div className="flex flex-col items-start gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[13px] text-ink-2">
        <span>{refused ?? `The ${side} report could not be loaded. This is a failed request, not a statement that nothing is outstanding.`}</span>
        {refused ? null : (
          <button type="button" className={btn} onClick={() => void q.refetch()}>
            Try again
          </button>
        )}
      </div>
    );
  } else {
    const rows = d.rows ?? [];
    const docs = d.documents ?? [];
    const tie: TieOut = d.tie_out ?? { subledger: '0', control: '0', difference: '0', agrees: true, account: null };
    body = (
      <>
        <TieBanner tie={tie} cur={cur} onUnposted={() => onGo('unposted')} />
        {rows.length === 0 ? (
          <div className="rounded-[12px] border border-line bg-surface">
            <Empty text={`Nothing is ${w.owed} as at ${longDate(d.as_of || asOf)}.`} />
          </div>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="overflow-x-auto scroll-thin">
              <div className="min-w-[900px]">
                <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <span className="min-w-0 flex-1">{w.who}</span>
                  {BUCKETS.map((b) => (
                    <span key={b.key} className="w-[112px] shrink-0 text-right">
                      {b.label}
                    </span>
                  ))}
                  <span className="w-[132px] shrink-0 text-right">Total</span>
                </div>
                {rows.map((r) => {
                  const k = partyKey(r.party_id);
                  const on = open === k;
                  return (
                    <Fragment key={k}>
                      <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : k)} className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-left text-[13px] hover:bg-subtle', on && 'bg-selection')}>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <Icon name={on ? 'chevron-down' : 'chevron-right'} size={13} className="shrink-0 text-ink-3" />
                          <span className="truncate text-ink">{r.party_name}</span>
                          {r.oldest !== null && r.oldest > 90 ? <Pill tone="red">{r.oldest} days</Pill> : null}
                        </span>
                        {BUCKETS.map((b) => (
                          <Figure key={b.key} value={r.buckets?.[b.key]} />
                        ))}
                        <span className="w-[132px] shrink-0 text-right font-semibold text-ink tabular-nums">{money(r.total)}</span>
                      </button>
                      {on ? <PartyDocs docs={docsFor(docs, r.party_id)} cur={cur} credit={w.credit} /> : null}
                    </Fragment>
                  );
                })}
                <div className="flex gap-2.5 border-t-2 border-line bg-ground px-3.5 py-2 text-[13px] font-bold text-ink">
                  <span className="min-w-0 flex-1 pl-[19px]">Total</span>
                  {BUCKETS.map((b) => (
                    <span key={b.key} className="w-[112px] shrink-0 text-right tabular-nums">
                      {money(d.totals?.[b.key] ?? '0')}
                    </span>
                  ))}
                  <span className="w-[132px] shrink-0 text-right tabular-nums">{money(d.total, cur)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title={w.title} sub={`What is ${w.owed}, and how long it has been outstanding.${cur ? ` Figures in ${cur}.` : ''}`}>
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
          As at
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today)} className={cx(input, 'w-[150px]')} />
        </label>
        {asOf !== monthEnd ? (
          <button type="button" className={btnSmall} onClick={() => setAsOf(monthEnd)}>
            End of last month
          </button>
        ) : null}
        {asOf !== today ? (
          <button type="button" className={btnSmall} onClick={() => setAsOf(today)}>
            Today
          </button>
        ) : null}
      </PageHead>
      {body}
    </div>
  );
}

/** A bucket's figure, or a quiet dash where there is nothing in it. */
function Figure({ value }: { value: string | undefined }) {
  return <span className={cx('w-[112px] shrink-0 text-right tabular-nums', isZero(value) ? 'text-ink-3' : 'text-ink-2')}>{isZero(value) ? '—' : money(value)}</span>;
}

function TieBanner({ tie, cur, onUnposted }: { tie: TieOut; cur: string; onUnposted: () => void }) {
  const { headline, detail } = tieSentences(tie, cur);
  return (
    <Notice tone={tie.agrees ? 'green' : 'red'} className="flex items-start gap-2.5">
      <Icon name={tie.agrees ? 'check-circle' : 'warning'} size={17} className="mt-px shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="text-[13.5px]">{headline}</b>
        <span>{detail}</span>
        {tie.agrees ? null : (
          <span>
            Something issued that never posted shows up here too: it is counted in the documents and missing from the account.{' '}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={onUnposted}>
              See what is not in the ledger
            </button>
          </span>
        )}
      </div>
    </Notice>
  );
}

/**
 * The documents behind one party. Each is in its own currency, with the base
 * figure beneath when they differ: the bucket totals are base, and mixing the
 * two in one column is how a report adds dollars to rupees.
 */
function PartyDocs({ docs, cur, credit }: { docs: AgeingDoc[]; cur: string; credit: string }) {
  return (
    <div className="border-b border-line/60 bg-ground py-2.5 pr-3.5 pl-[38px]">
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className="flex gap-2.5 border-b border-line bg-ground px-3 py-1.5 text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <span className="min-w-0 flex-1">Document</span>
          <span className="w-[104px] shrink-0">Dated</span>
          <span className="w-[104px] shrink-0">Due</span>
          <span className="w-[170px] shrink-0 text-right">Outstanding</span>
          <span className="w-[84px] shrink-0 text-right">Age</span>
        </div>
        {docs.length === 0 ? <Empty text="No open documents are listed for this row." /> : null}
        {docs.map((x) => {
          const own = x.currency || cur;
          return (
            <div key={`${x.id}-${x.number ?? ''}`} className="flex items-center gap-2.5 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate font-mono text-[12px] text-ink-2">{x.number ?? `#${x.id}`}</span>
                {x.is_credit ? <Pill tone="grey">{credit}</Pill> : null}
              </span>
              <span className="w-[104px] shrink-0 text-ink-2">{shortDate(x.doc_date)}</span>
              <span className="w-[104px] shrink-0 text-ink-2">{x.due_date ? shortDate(x.due_date) : '—'}</span>
              <span className="flex w-[170px] shrink-0 flex-col items-end text-ink tabular-nums">
                {money(x.open, own)}
                {own !== cur ? <span className="text-[11px] text-ink-3">{money(x.open_base, cur)}</span> : null}
              </span>
              <span className="w-[84px] shrink-0 text-right text-ink-3 tabular-nums">{ageLabel(x.days)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
