import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import { btnPrimary, btnSmall, PageHead } from '../hr/parts';
import { addMonths, addYear, can, fetchPeriods, K, refusal, setPeriodStatus, shortDate, type Company, type Period } from './api';
import { ConfirmSheet, LoadFailed, Notice, PeriodPill, ReasonSheet } from './parts';

/**
 * The financial calendar: which months take entries, and the next year added
 * before the ledger stops. Opening books makes one year; on the first day of
 * the second, every posting is refused for having no period to fall in — so
 * the screen warns two months ahead.
 *
 * Locking is housekeeping. Reopening means a figure somebody has already seen
 * may change, so it takes a reason, kept on the period for the next person. A
 * period closed at year end offers nothing here: the server refuses it by any
 * route, and a greyed button invites clicking.
 */
export default function Periods({ company }: { company: Company }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayManage = can(perms, 'finance.period.manage');
  const q = useQuery({ queryKey: K.periods(company.id), queryFn: ({ signal }) => fetchPeriods(company.id, signal), retry: false });
  const [asking, setAsking] = useState<{ kind: 'lock' | 'reopen'; p: Period } | 'year' | null>(null);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <LoadFailed what="The financial calendar" onRetry={() => void q.refetch()} />;
  const years = q.data?.years ?? [];
  const periods = q.data?.periods ?? [];
  if (!years.length) return <p className="m-6 text-[13px] text-ink-2">This company has no financial years yet. Opening its books creates the first.</p>;

  const refresh = () => void qc.invalidateQueries({ queryKey: K.company(company.id) });
  const run = async (fn: () => Promise<{ message?: string } | undefined>, done: string) => {
    setBusy(true);
    try {
      const r = await fn();
      toast('success', r?.message ?? done);
      setAsking(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const lastEnd = years.map((y) => y.ends_on).sort().slice(-1)[0] ?? '';
  const lapsing = lastEnd !== '' && lastEnd < addMonths(todayInZone(), 2);

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Periods" sub={`Entries can only be dated into an open period.${company.base_currency ? ` Books kept in ${company.base_currency}.` : ''}`}>
        {mayManage ? (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => setAsking('year')}>
            <Icon name="plus" size={14} /> Add the next year
          </button>
        ) : null}
      </PageHead>
      {lapsing ? (
        <Notice tone="amber">
          <b>The calendar runs out on {shortDate(lastEnd)}.</b> After that every entry is refused for having no period to fall in.{mayManage ? ' Add the next year before then.' : ' Ask somebody who manages periods to add the next year.'}
        </Notice>
      ) : null}
      {[...years].reverse().map((y) => (
        <section key={y.id} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <b className="text-[14px] text-ink">{y.name}</b>
            <span className="text-[12px] text-ink-3">
              {shortDate(y.starts_on)} to {shortDate(y.ends_on)}
            </span>
            <PeriodPill status={y.status} />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
            {periods
              .filter((p) => p.fiscal_year_id === y.id)
              .map((p) => (
                <div key={p.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="truncate text-[13px] text-ink">{p.name}</b>
                      <span className="text-[11.5px] text-ink-3">
                        {shortDate(p.starts_on)} – {shortDate(p.ends_on)}
                      </span>
                    </span>
                    <PeriodPill status={p.status} />
                  </div>
                  {p.note ? (
                    <span className="truncate text-[11.5px] text-ink-3" title={p.note}>
                      {p.note}
                    </span>
                  ) : null}
                  {mayManage && p.status !== 'closed' ? (
                    <button type="button" className={`${btnSmall} self-start`} disabled={busy} onClick={() => setAsking({ kind: p.status === 'open' ? 'lock' : 'reopen', p })}>
                      <Icon name={p.status === 'open' ? 'lock' : 'unlock'} size={13} /> {p.status === 'open' ? 'Lock' : 'Reopen…'}
                    </button>
                  ) : null}
                </div>
              ))}
          </div>
        </section>
      ))}
      {asking === 'year' ? (
        <ConfirmSheet
          title="Create the next financial year?"
          body="Twelve periods are created at once, starting the month after the last year ends. Without them, every entry dated in that year is refused."
          action="Create it"
          busy={busy}
          onYes={() => void run(() => addYear(company.id), 'Financial year created.')}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking && asking !== 'year' && asking.kind === 'lock' ? (
        <ConfirmSheet
          title={`Lock ${asking.p.name}?`}
          body="Nothing can be posted or dated into a locked period until it is reopened."
          action="Lock"
          busy={busy}
          onYes={() => void run(() => setPeriodStatus(company.id, asking.p.id, 'locked'), `${asking.p.name} is locked.`)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking && asking !== 'year' && asking.kind === 'reopen' ? (
        <ReasonSheet
          title={`Reopen ${asking.p.name}?`}
          body="Anything posted or corrected after this changes a period that has already been reported on. The reason is kept on the period, where the next person to open this screen will see it."
          label="Why is it being reopened?"
          action="Reopen"
          busy={busy}
          onOk={(r) => void run(() => setPeriodStatus(company.id, asking.p.id, 'open', r), `${asking.p.name} is open again.`)}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}
