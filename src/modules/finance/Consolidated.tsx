import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btnSmall, Cell, Empty, Field, PageHead, THead, row } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { can, money, shortDate } from './api';
import { companyRow, CONSOLIDATED_FIGURES, decimalsOf, fetchConsolidated, IK, missingSlugs, rangeProblem, SCREEN_SLUGS, type Consolidated as ConsolidatedData } from './insight';
import { Notice } from '../../components/RecordKit';
import type { ScreenProps } from './Rail';
import { NotGranted, RangeFields, ReadFailed } from './ReportBar';

/**
 * Every company side by side, and a total when one is honest (FR-FIN-14.06).
 *
 * NOT ONE COMPANY. This is the only Finance screen that is not about the
 * company in the rail: it reads every company the person can reach, and says
 * so, because a figure under one company's name that is really four
 * companies' is exactly the mistake the rail's single choice exists to stop.
 *
 * A COMPANY THAT COULD NOT BE TRANSLATED IS NEVER FOLDED IN SILENTLY. The
 * danger is not a missing total, it is a total that looks complete and quietly
 * leaves out a subsidiary whose rate nobody entered. So the total says how
 * many companies it covers out of how many have books, the ones left out are
 * named with the reason, and the figure is marked incomplete when it is.
 *
 * Each company's own figures, in its own currency, are shown whatever happens:
 * a local reader must never be given only a converted number they cannot check
 * against their own books. Nothing between the companies is eliminated.
 */
export default function Consolidated({ company, onGo }: ScreenProps) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const lacking = missingSlugs(perms, SCREEN_SLUGS.consolidated);
  const y = todayInZone().slice(0, 4);
  const [range, setRange] = useState({ from: `${y}-01-01`, to: `${y}-12-31` });
  const [currency, setCurrency] = useState('');
  const problem = rangeProblem(range);

  const q = useQuery({
    queryKey: IK.consolidated(range.from, range.to, currency),
    queryFn: ({ signal }) => fetchConsolidated(range.from, range.to, currency, signal),
    enabled: lacking.length === 0 && problem === null,
    retry: false,
    placeholderData: (prev) => prev,
  });

  if (lacking.length) return <NotGranted what="The view across every company" slugs={lacking} onAccess={() => onGo('myaccess')} />;

  const data = q.data;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead
        title="All companies"
        sub={`Every company whose books you can reach — not only ${company.name}. Each is read from its own ledger; nothing between them is eliminated, so a sale from one to another is in both.`}
      />
      <div className="flex flex-wrap items-end gap-2.5">
        <RangeFields range={range} onChange={setRange} />
        {data ? (
          <Field label="Show totals in" className="w-[270px]">
            <Select
              aria-label="Show totals in"
              searchable
              // Their own currencies are an option of their own, not an empty placeholder drawn dimmed.
              value={currency || 'own'}
              onValueChange={(v) => setCurrency(v === 'own' ? '' : v)}
              options={[{ value: 'own', label: 'Each company’s own currency' }, ...data.currency_options.map((o) => ({ value: o.code, label: `${o.code} — ${o.name}` }))]}
              className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
            />
          </Field>
        ) : null}
        {q.isFetching && data ? <span className="pb-2 text-[12px] text-ink-3">Updating…</span> : null}
      </div>
      {problem ? (
        <Notice tone="amber">{problem}</Notice>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error || !data ? (
        <ReadFailed what="The companies’ figures" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Body data={data} onRates={can(perms, 'finance.settings') ? () => onGo('fx') : undefined} />
      )}
    </div>
  );
}

function Body({ data, onRates }: { data: ConsolidatedData; onRates?: () => void }) {
  const withBooks = data.rows.filter((r) => r.has_books);
  const t = data.total;
  const tCur = t?.currency ?? '';
  const tDec = decimalsOf(data.currency_options, tCur);

  return (
    <>
      {data.untranslated.length ? (
        <Notice tone="amber" className="flex items-start gap-2">
          <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
          <span className="flex flex-col gap-1">
            <b>
              {data.untranslated.length === 1 ? '1 company is' : `${data.untranslated.length} companies are`} not in the total.
            </b>
            <ul className="m-0 list-disc pl-5">
              {data.untranslated.map((u, i) => (
                <li key={`${u.company}-${i}`}>
                  {u.company} ({u.currency}) — {u.why}
                </li>
              ))}
            </ul>
            {onRates ? (
              <button type="button" className={cx(btnSmall, 'self-start')} onClick={onRates}>
                Exchange rates
              </button>
            ) : null}
          </span>
        </Notice>
      ) : null}

      {t ? (
        <section className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-subtle px-3.5 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <b className="text-ink">Consolidated total</b>
            <span className="text-[12px] text-ink-3">
              {tCur} · {t.companies_counted} of {t.companies_with_books} {t.companies_with_books === 1 ? 'company' : 'companies'} with books · {shortDate(data.from)} to {shortDate(data.to)}
            </span>
            {t.complete ? null : <Pill tone="amber">incomplete</Pill>}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {CONSOLIDATED_FIGURES.map(([k, label]) => (
              <div key={k} className="flex flex-col">
                <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{label}</span>
                <b className="text-[17px] text-ink tabular-nums">{money(String(t[k] ?? ''), tCur, tDec)}</b>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {withBooks.length === 0 ? (
        <Empty text="None of the companies you can see have open books." />
      ) : (
        <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="overflow-x-auto scroll-thin">
            <div className="min-w-[980px]">
              <THead cols={COLS} />
              {data.rows.map((r) => {
                if (!r.has_books) {
                  return (
                    <div key={r.company.id} className={row}>
                      <Cell w={null} className="text-ink-2">
                        {r.company.name}
                      </Cell>
                      <span className="w-[790px] shrink-0 text-[12px] text-ink-3">No books opened.</span>
                    </div>
                  );
                }
                // The translated figures where they exist, the company's own where they do not — and the row says which.
                const v = companyRow(r, data.untranslated);
                const dec = decimalsOf(data.currency_options, v.currency);
                return (
                  <div key={r.company.id} className={row} data-counted={v.counted ? 'yes' : 'no'}>
                    <Cell w={null}>
                      <span className="flex min-w-0 flex-col">
                        <b className="truncate text-ink">{r.company.name}</b>
                        <span className={cx('truncate text-[11.5px]', v.counted ? 'text-ink-3' : 'text-warning-ink dark:text-warning')}>{v.notes.join(' · ')}</span>
                      </span>
                    </Cell>
                    {CONSOLIDATED_FIGURES.map(([k]) => (
                      <Cell key={k} w={150} className="text-right tabular-nums">
                        {money(v.figures[k], v.currency, dec)}
                      </Cell>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
      <p className="m-0 text-[11.5px] leading-relaxed text-ink-3">{data.note}</p>
    </>
  );
}

const COLS: Array<[string, number | null]> = [['Company', null], ...CONSOLIDATED_FIGURES.map(([, l]) => [l, 150] as [string, number])];
