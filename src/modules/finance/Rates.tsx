import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Cell, Empty, Field, input, PageHead, row, THead } from '../hr/parts';
import { can, K, refusal, shortDate } from './api';
import { ConfirmSheet, LoadFailed, Notice } from './parts';
import type { ScreenProps } from './Rail';
import { existingRate, fetchRates, forbiddenWhy, fxRateProblem, KS, removeRate, saveRate, trimDecimals, type FxPayload, type FxRate } from './setup';

/**
 * Exchange rates — what one unit of a currency bought on a date.
 *
 * NOT PER COMPANY. What a pound was worth in rupees on a day is a fact about
 * the world; two companies on one installation disagreeing about it would make
 * a consolidated total depend on which company you looked from. So the rows
 * are shared, the screen says so, and the company in the rail changes nothing
 * here except which currency the form suggests.
 *
 * Reading and writing both take `finance.settings`: this is the Setup screen
 * for the people who keep the rates. Nobody needs it to read a translated
 * report — the translation happens on the server.
 *
 * A rate holds until a later one supersedes it; the reverse pair is derived.
 * Saving a pair on a day that already has one replaces it, and the form says
 * so before it happens rather than after.
 */
export default function Rates({ company }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const mayRead = can(perms, 'finance.settings');
  const q = useQuery({ queryKey: KS.fx(uid), queryFn: ({ signal }) => fetchRates(signal), retry: false, enabled: mayRead });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FxRate | null>(null);
  const [busy, setBusy] = useState(false);

  const head = (action?: ReactNode) => (
    <PageHead title="Exchange rates" sub="Shared across every company on this installation — a rate is a fact about the world, not about one set of books.">
      {action}
    </PageHead>
  );

  if (!mayRead) {
    return (
      <div className="flex flex-col gap-3.5 px-6 py-5">
        {head()}
        <Notice tone="grey">
          Exchange rates are kept by people who hold <code className="font-mono text-[11.5px]">finance.settings</code>. You do not need this screen to read a translated figure — reports convert on the server, with the rates kept here.
        </Notice>
      </div>
    );
  }
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const why = forbiddenWhy(q.error);
    return why ? (
      <div className="flex flex-col gap-3.5 px-6 py-5">
        {head()}
        <Notice tone="grey">{why}</Notice>
      </div>
    ) : (
      <LoadFailed what="The exchange rates" onRetry={() => void q.refetch()} />
    );
  }

  const d = q.data;
  // Every translated figure changes with a rate — the overview, the cash-flow
  // overview, the consolidated total — under whichever keys those screens use.
  // Stale-marking all of Finance is cheaper than missing one.
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });
  const remove = async (r: FxRate) => {
    setBusy(true);
    try {
      await removeRate(r.id);
      toast('success', 'Rate removed. Reports translated with it will now use the next earlier rate, or refuse if there is none.');
      setRemoving(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      {head(
        d.can_edit ? (
          <button type="button" className={adding ? btn : btnPrimary} onClick={() => setAdding((v) => !v)}>
            {adding ? (
              'Close'
            ) : (
              <>
                <Icon name="plus" size={14} /> Add a rate
              </>
            )}
          </button>
        ) : null,
      )}

      {d.base_currencies.length > 1 ? (
        <Notice tone="grey">
          Your companies keep their books in <b>{d.base_currencies.join(', ')}</b>. A consolidated total needs a rate between each of those and whichever currency you want the total in.
        </Notice>
      ) : null}

      {adding && d.can_edit ? <AddRate d={d} base={company.base_currency ?? ''} onDone={refresh} /> : null}

      {d.rows.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-line bg-surface px-6 py-8 text-center text-[13px] text-ink-2">
          No rates yet. Until there is one, the currency selector on the dashboards has nothing to convert with and will say so rather than guessing.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead
            cols={[
              ['From this date', 130],
              ['Pair', null],
              ['Rate', 170],
              ['Source', 110],
              ['', 34],
            ]}
          />
          {d.rows.map((r) => (
            <div key={r.id} className={row}>
              <Cell w={130} className="text-ink-2 tabular-nums">
                {shortDate(r.effective_on)}
              </Cell>
              <Cell w={null}>
                1 {r.from} <span className="text-ink-3">→</span> {r.to}
              </Cell>
              <Cell w={170} className="text-right font-semibold tabular-nums">
                <span title={r.rate}>{trimDecimals(r.rate, 2)}</span>
              </Cell>
              <Cell w={110} className="text-[12px] text-ink-3">
                {r.source ?? '—'}
              </Cell>
              <span className="flex w-[34px] shrink-0 justify-end">
                {d.can_edit ? (
                  <button
                    type="button"
                    aria-label={`Remove the ${r.from}→${r.to} rate of ${shortDate(r.effective_on)}`}
                    title="Remove"
                    onClick={() => setRemoving(r)}
                    className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-danger-bg hover:text-danger"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}

      {d.note ? <p className="m-0 text-[11.5px] leading-relaxed text-ink-3">{d.note}</p> : null}

      {removing ? (
        <ConfirmSheet
          title={`Remove the ${removing.from}→${removing.to} rate of ${shortDate(removing.effective_on)}?`}
          body="Reports translated with it will use the next earlier rate, or refuse if there is none. Nothing is posted against a rate, so nothing else moves."
          action="Remove"
          danger
          busy={busy}
          onYes={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One unit of `from` buys `rate` of `to`, from a date. Suggests the company's
 * own currency as the second, which is the pair almost everybody enters.
 */
function AddRate({ d, base, onDone }: { d: FxPayload; base: string; onDone: () => void }) {
  const known = (c: string) => d.currencies.some((x) => x.code === c);
  const [f, setF] = useState(() => ({ from: '', to: known(base) ? base : '', rate: '', on: todayInZone() }));
  const [busy, setBusy] = useState(false);
  const problem = fxRateProblem(f.rate, f.from, f.to);
  const replaces = f.from && f.to && f.on ? existingRate(d.rows, f.from, f.to, f.on) : null;
  const ready = f.from !== '' && f.to !== '' && f.from !== f.to && f.rate.trim() !== '' && !problem && /^\d{4}-\d{2}-\d{2}$/.test(f.on);
  const options = (skip: string) => [{ value: '', label: 'Choose…' }, ...d.currencies.filter((c) => c.code !== skip).map((c) => ({ value: c.code, label: c.code, hint: c.name }))];

  const save = async () => {
    setBusy(true);
    try {
      await saveRate({ from: f.from, to: f.to, rate: f.rate.trim(), effective_on: f.on });
      toast('success', replaces ? 'Rate updated.' : 'Rate saved.');
      setF((x) => ({ ...x, rate: '' }));
      onDone();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Add a rate" className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="One unit of" className="w-[150px]">
          <Select<string> aria-label="One unit of" searchable value={f.from} options={options('')} onValueChange={(v) => setF((x) => ({ ...x, from: v, to: x.to === v ? '' : x.to }))} className={input} />
        </Field>
        <Field label="buys this many" className="w-[150px]">
          <Select<string> aria-label="buys this many" searchable value={f.to} options={options(f.from)} onValueChange={(v) => setF((x) => ({ ...x, to: v }))} className={input} />
        </Field>
        <Field label="Rate" className="w-[170px]">
          <input aria-label="Rate" inputMode="decimal" value={f.rate} onChange={(e) => setF((x) => ({ ...x, rate: e.target.value }))} placeholder="312.55" className={cx(input, 'text-right tabular-nums', problem && '!border-danger')} />
        </Field>
        <Field label="From this date" className="w-[160px]">
          <input aria-label="From this date" type="date" value={f.on} onChange={(e) => setF((x) => ({ ...x, on: e.target.value }))} className={input} />
        </Field>
        <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Saving…' : replaces ? 'Replace the rate' : 'Save rate'}
        </button>
      </div>
      {problem ? <p className="m-0 text-[12px] text-danger">{problem}</p> : null}
      {!problem && f.from && f.to && f.rate.trim() ? (
        <p className="m-0 text-[12px] text-ink-3">
          1 {f.from} = {f.rate.trim()} {f.to}. The reverse is derived, so you do not need to enter {f.to} → {f.from} as well.
        </p>
      ) : null}
      {replaces ? (
        <p className="m-0 text-[12px] text-warning-ink dark:text-warning">
          There is already a {f.from} → {f.to} rate from {shortDate(f.on)} ({trimDecimals(replaces.rate, 2)}). Saving replaces it — one pair has one rate a day.
        </p>
      ) : null}
      {!d.currencies.length ? <Empty text="This installation lists no currencies, so there is nothing to pair." /> : null}
    </section>
  );
}
