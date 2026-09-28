import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { monthWords, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Cell, Empty, input, PageHead, Panel, row, Sheet, THead } from '../hr/parts';
import { can, fromCents, K, money, problemsOf, refusal, shortDate, type Company } from './api';
import { ConfirmSheet, Notice } from './parts';
import type { ScreenProps } from './Rail';
import { chargeMonth, fetchDepreciation, forbiddenWhy, KS, openingSplit, previousMonth, sameId, saveOpeningDepreciation, type Opening } from './setup';

/**
 * Depreciation — one month at a time, named explicitly.
 *
 * THE PREVIEW IS THE POSTING WITH THE LAST STEP LEFT OFF. Every figure comes
 * from the same server call the charge makes to decide what to post, so the
 * number beside the button is the number the button posts, by construction.
 *
 * NO "CHARGE WHATEVER IS MISSING". The month is chosen. A screen that works
 * out its own periods posts eleven months because somebody restored a backup,
 * and every one of those journals would look reasonable. The months already
 * charged are listed, so a gap is visible without being acted on.
 *
 * WHO MAY CHARGE: `finance.journal.post`, the route's own gate. The server
 * also sends an area envelope for this screen, but it asks about an area that
 * does not exist ('post'), so it always says no — the web read it and showed
 * posting as never allowed. It is not read here.
 *
 * The month picker is drawn above every state, including a failed load: the
 * month is what failed, and without the picker there is no way to choose
 * another.
 *
 * The brought-forward depreciation — one figure for the company in the
 * opening balance — has to be split across the assets before a disposal of one
 * can post. Recording that split writes no journal; it takes
 * `finance.accounts.manage`, and the parts may not come to more than the whole.
 */
export default function Depreciation({ company, onGo }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayPost = can(perms, 'finance.journal.post');
  const mayManage = can(perms, 'finance.accounts.manage');
  const [period, setPeriod] = useState(() => previousMonth(todayInZone()));
  const valid = /^\d{4}-\d{2}$/.test(period);
  // The month is in the key: a month change must never show the last month's figures under this month's heading.
  const q = useQuery({ queryKey: KS.depreciationFor(company.id, period), queryFn: ({ signal }) => fetchDepreciation(company.id, period, signal), retry: false, enabled: company.has_books && valid });
  const [asking, setAsking] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = company.base_currency ?? '';

  const frame = (body: ReactNode, action?: ReactNode) => (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Depreciation" sub="One month at a time, named explicitly. Charging a month writes a single journal for the company, with the per-asset split kept alongside it." />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
          Month
          <input type="month" aria-label="Month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className={cx(input, 'w-[170px]')} />
        </label>
        {action}
      </div>
      {body}
    </div>
  );

  if (!company.has_books) return frame(<Notice tone="grey">{company.name} has no general ledger yet. Open its books first.</Notice>);
  if (q.isLoading) return frame(<Spinner />);
  if (q.error || !q.data) {
    const why = forbiddenWhy(q.error);
    return frame(
      why ? (
        <Notice tone="grey">{why}</Notice>
      ) : (
        <Notice tone="grey">
          Depreciation could not be loaded for that month. That is a failed request, not a statement that nothing has been charged.{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </Notice>
      ),
    );
  }

  const d = q.data;
  const p = d.preview;
  const runs = d.runs ?? [];
  const reasons = Object.entries(p.reasons ?? {});
  const run = runs.find((r) => r.period === p.period) ?? null;
  const openJournal = (id: number | string | null | undefined) => (id ? () => onGo('journals', `&open=${id}`) : undefined);

  const charge = async () => {
    setBusy(true);
    try {
      const r = await chargeMonth(company.id, period);
      toast('success', r?.journal_no ? `Charged as ${r.journal_no}.` : 'Charged.');
      setAsking(false);
      // The run, the journal list and the dashboard all live under the company.
      void qc.invalidateQueries({ queryKey: K.company(company.id) });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const action = p.posted ? (
    <button type="button" onClick={openJournal(run?.journal_id)} disabled={!run?.journal_id} className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-success-bg px-3 text-[12.5px] font-semibold text-success disabled:cursor-default">
      <Icon name="check-circle" size={14} /> Charged as {p.journal_no}
    </button>
  ) : mayPost ? (
    <button type="button" className={btnPrimary} disabled={busy || p.rows.length === 0} onClick={() => setAsking(true)}>
      {busy ? 'Charging…' : `Charge ${monthWords(period)}`}
    </button>
  ) : (
    <span className="text-[12px] text-ink-3">
      Charging a month needs <code className="font-mono text-[11.5px]">finance.journal.post</code>.
    </span>
  );

  return frame(
    <>
      {d.opening.posted && !d.opening.ties ? <OpeningNotice o={d.opening} base={base} onSplit={mayManage ? () => setSplitting(true) : undefined} /> : null}

      <Notice tone="grey" className="!text-[13px] !text-ink">
        {p.posted ? (
          <>
            <b className="tabular-nums">{money(p.total, base)}</b> was charged across {p.rows.length} asset{p.rows.length === 1 ? '' : 's'}, dated {shortDate(p.charged_on)}.
          </>
        ) : p.rows.length > 0 ? (
          <>
            <b className="tabular-nums">{money(p.total, base)}</b> would be charged across {p.rows.length} of {p.considered} asset{p.considered === 1 ? '' : 's'}, dated {shortDate(p.charged_on)}.
          </>
        ) : (
          <>
            Nothing would be charged for {monthWords(period)}. {p.considered} asset{p.considered === 1 ? ' was' : 's were'} considered.
            {p.why ? ` ${p.why}` : ''}
          </>
        )}
        {reasons.length ? (
          <ul className="mt-2 mb-0 flex list-none flex-col gap-1.5 p-0">
            {reasons.map(([why, n]) => (
              <li key={why} className="flex gap-2 text-[12px] text-[#9A4A06] dark:text-warning">
                <span className="shrink-0 rounded-[5px] bg-warning-bg px-1.5 font-bold tabular-nums">{n}</span>
                <span>{why}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Notice>

      {p.rows.length ? (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <THead
            cols={[
              ['Asset', 130],
              ['Name', null],
              ['This month', 160],
            ]}
          />
          {p.rows.map((r) => (
            <div key={r.asset_id} className={row}>
              <Cell w={130} className="font-mono text-[12px] text-ink-2">
                {r.asset_code ?? '—'}
              </Cell>
              <Cell w={null}>{r.name ?? '—'}</Cell>
              <Cell w={160} className="text-right tabular-nums">
                {money(r.amount, base)}
              </Cell>
            </div>
          ))}
        </div>
      ) : null}

      <Panel title="Months charged" sub="Listed so a gap is visible — nothing here fills one in on its own." bodyClassName="flex flex-col">
        {runs.length === 0 ? (
          <Empty text="No month has ever been charged for this company." />
        ) : (
          runs.map((r) => (
            <button key={String(r.id)} type="button" onClick={openJournal(r.journal_id)} disabled={!r.journal_id} className={cx(row, 'w-full text-left enabled:hover:bg-subtle disabled:cursor-default', sameId(r.id, run?.id) && 'bg-selection')}>
              <Icon name="lock" size={13} className="shrink-0 text-ink-3" />
              <Cell w={110} className="font-semibold tabular-nums">
                {monthWords(r.period)}
              </Cell>
              <Cell w={null} className="text-ink-3">
                {r.journal_no ?? '—'}
              </Cell>
              <Cell w={150} className="text-right tabular-nums">
                {money(r.total, base)}
              </Cell>
              <Cell w={90} className="text-right text-[12px] text-ink-3">
                {r.asset_count} asset{Number(r.asset_count) === 1 ? '' : 's'}
              </Cell>
            </button>
          ))
        )}
      </Panel>

      {asking ? (
        <ConfirmSheet
          title={`Charge ${monthWords(period)}?`}
          body={`${money(p.total, base)} across ${p.rows.length} asset${p.rows.length === 1 ? '' : 's'}, dated ${shortDate(p.charged_on)}. This writes one journal — debiting Depreciation and crediting Accumulated Depreciation — and it cannot be charged twice.`}
          action="Charge it"
          busy={busy}
          onYes={() => void charge()}
          onClose={() => setAsking(false)}
        />
      ) : null}
      {splitting ? <OpeningSheet company={company} o={d.opening} onClose={() => setSplitting(false)} onDone={() => void qc.invalidateQueries({ queryKey: KS.depreciation(company.id) })} /> : null}
    </>,
    action,
  );
}

/** The brought-forward split, because it is the prerequisite most likely to be missing — and until it ties, no disposal of an opening-balance asset can post. */
function OpeningNotice({ o, base, onSplit }: { o: Opening; base: string; onSplit?: () => void }) {
  return (
    <Notice tone="amber">
      <b>The brought-forward depreciation is not split across the assets yet.</b> The opening balance brought in <b className="tabular-nums">{money(o.expected, base)}</b> for the company; <b className="tabular-nums">{money(o.entered, base)}</b> has been recorded against individual assets, leaving{' '}
      <b className="tabular-nums">{money(o.difference, base)}</b> unallocated across {o.missing} asset{o.missing === 1 ? '' : 's'}. Depreciation still charges correctly — but a disposal cannot, because it would not know how much to reverse.
      {onSplit ? (
        <span className="mt-2 block">
          <button type="button" className={btnSmall} onClick={onSplit}>
            Record the split…
          </button>
        </span>
      ) : null}
    </Notice>
  );
}

/**
 * Each asset's share of the brought-forward depreciation. A breakdown of a
 * number already in the ledger: saving posts nothing. An empty box keeps what
 * is recorded; only changed figures are sent.
 */
function OpeningSheet({ company, o, onClose, onDone }: { company: Company; o: Opening; onClose: () => void; onDone: () => void }) {
  const base = company.base_currency ?? '';
  const [typed, setTyped] = useState<Record<number, string>>(() => Object.fromEntries(o.assets.map((a) => [a.id, a.opening_accumulated ?? ''])));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const split = openingSplit(o, typed);
  const count = Object.keys(split.send).length;
  const left = split.expected - split.total;

  const save = async () => {
    setBusy(true);
    setRefused([]);
    try {
      const r = await saveOpeningDepreciation(company.id, split.send);
      const n = r?.written ?? count;
      toast('success', `Recorded against ${n} asset${n === 1 ? '' : 's'}.`);
      onDone();
      onClose();
    } catch (e) {
      setRefused(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Split the brought-forward depreciation"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || count === 0 || split.problems.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : count ? `Record ${count} figure${count === 1 ? '' : 's'}` : 'Record'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
        The opening balance carries accumulated depreciation as one figure for the company. Enter each asset’s share of it, as the prior year’s accounts record it. No journal is written — this is a breakdown of a figure already in the ledger, and it is what a disposal reverses.
      </p>
      <div className="overflow-hidden rounded-[10px] border border-line">
        <THead
          cols={[
            ['Asset', 110],
            ['Name', null],
            ['Cost', 130],
            ['Brought forward', 140],
          ]}
        />
        {o.assets.map((a) => (
          <div key={a.id} className={row}>
            <Cell w={110} className="font-mono text-[12px] text-ink-2">
              {a.asset_code ?? `#${a.id}`}
            </Cell>
            <Cell w={null}>{a.name ?? '—'}</Cell>
            <Cell w={130} className="text-right text-ink-3 tabular-nums">
              {money(a.cost)}
            </Cell>
            <span className="w-[140px] shrink-0">
              <input
                aria-label={`${a.asset_code ?? a.id} brought forward`}
                inputMode="decimal"
                value={typed[a.id] ?? ''}
                placeholder="0.00"
                onChange={(e) => setTyped({ ...typed, [a.id]: e.target.value })}
                className={cx(input, 'h-[30px] text-right tabular-nums')}
              />
            </span>
          </div>
        ))}
      </div>
      <p className="m-0 text-[12.5px] text-ink-2 tabular-nums">
        {money(fromCents(split.total), base)} of {money(o.expected, base)} allocated
        {left > 0 ? ` — ${money(fromCents(left), base)} still to split.` : left === 0 ? ' — it ties.' : '.'}
      </p>
      {[...split.problems, ...refused].length ? (
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[12.5px] text-danger">
          {[...split.problems, ...refused].map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  );
}
