import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, Switch, cx } from '../../components/ui';
import { problemsOf, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice } from '../../components/RecordKit';
import { btn, btnPrimary, btnSmall, Caps, Field, input, PageHead, Sheet, SidePanel } from '../../components/PageKit';
import { minWidth, Pill } from '../../components/ListKit';
import { can, canAct, K, money } from './api';
import { Note, StatusPill } from './parts';
import type { ScreenProps } from './Rail';
import {
  BUDGET_SCOPES,
  BUDGET_SORTS,
  budgetBody,
  budgetDraft,
  budgetPeriods,
  budgetProblems,
  closeBudget,
  fetchBudget,
  fetchBudgets,
  fetchCategories,
  fetchCentres,
  fetchPeople,
  forecastSentence,
  hardSentence,
  idOf,
  isOver,
  KR,
  meterTone,
  meterWidth,
  PERIOD_WORDS,
  PERIODS,
  pickList,
  readRefusal,
  saveBudget,
  SCOPE_WORDS,
  scopeIdFor,
  shownBudgets,
  unsigned,
  usedSentence,
  type Budget,
  type BudgetDraft,
  type BudgetScope,
  type BudgetSort,
  type BudgetState,
  type PeriodKind,
} from './rules';

/**
 * Budgets: a figure, a scope, a period, and what happens at the edge.
 *
 * THREE NUMBERS, NEVER ONE. Committed, approved and paid are shown separately
 * because a department that has spent its budget and one that has merely
 * asked to both need action, and they need different action.
 *
 * THE RUN RATE SAYS WHAT IT IS. "At this rate" is spend so far divided by the
 * days elapsed, times the days in the period. Wherever it appears it carries
 * that sentence and the words "arithmetic, not a prediction" — a number the
 * software extrapolated in a straight line is not a forecast anybody should
 * commit against.
 *
 * HARD STOPS ARE OPT-IN. A hard budget refuses the claim that breaks it; a
 * soft one warns, with the figures, and a person decides.
 *
 * NO BULK. A budget is a figure somebody set deliberately, and nothing takes
 * an array of them. Closing several at once would remove the ceilings without
 * anything on screen saying which claims stop being checked as a result.
 */

/** Widths of the fixed columns; the budget's name takes the rest. */
const W = { used: 170, fig: 110, remaining: 140, claims: 54, act: 52 };

const METER: Record<ReturnType<typeof meterTone>, string> = { over: 'bg-danger', near: 'bg-warning', hard: 'bg-primary', room: 'bg-primary/55' };

/** How close, as a bar of proportions. The figures beside it come through money(). */
function Meter({ b, className }: { b: Pick<Budget, 'pct' | 'remaining' | 'hard_stop'>; className?: string }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-subtle', className)} title={b.pct === null ? 'Nothing to compare against' : `${b.pct}% used`}>
      <div className={cx('h-full rounded-full', METER[meterTone(b)])} style={{ width: `${meterWidth(b.pct)}%` }} />
    </div>
  );
}

export default function Budgets({ orgId, orgs, onGo }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const oid = orgId ?? 0;
  const q = useQuery({ queryKey: KR.budgets(oid), queryFn: ({ signal }) => fetchBudgets(oid, signal), enabled: orgId !== null, retry: false });
  const [find, setFind] = useState('');
  const [period, setPeriod] = useState('');
  const [state, setState] = useState<BudgetState>('');
  const [sort, setSort] = useState<BudgetSort>('used');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const periods = useMemo(() => budgetPeriods(all), [all]);
  const shown = useMemo(() => shownBudgets(all, { q: find, period, state, sort, dir }), [all, find, period, state, sort, dir]);

  if (orgId === null) return null;
  if (q.isLoading) return <Spinner />;
  const refused = readRefusal(q.error);
  if (refused) return <Note>{refused}</Note>;
  if (q.error || !q.data) return <LoadFailed what="The budgets" onRetry={() => void q.refetch()} />;

  const d = q.data;
  const org = orgs.find((o) => o.id === orgId);
  // The server's word (an administrator here), the grant, and a company this person may act in.
  const mayEdit = d.can_edit && can(perms, 'expense.admin') && !!org && canAct(org);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KR.budgets(orgId) });
    void qc.invalidateQueries({ queryKey: [...K.all, 's'] });
  };
  const fixed = [W.used, W.fig, W.fig, W.fig, W.remaining, W.claims, ...(mayEdit ? [W.act] : [])];
  const openRow = open !== null ? (all.find((b) => b.id === open) ?? null) : null;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Budgets" sub="A figure, a scope and a period. A hard budget refuses the claim that breaks it; a soft one warns and lets a person decide.">
        {mayEdit ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} /> New budget
          </button>
        ) : null}
      </PageHead>

      {all.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search name or scope" aria-label="Search name or scope" className={cx(input, 'w-[220px] pl-8')} />
          </div>
          <Select aria-label="Filter by period" value={period} onValueChange={setPeriod} options={[{ value: '', label: 'Any period' }, ...periods.map((p) => ({ value: p, label: p }))]} className={cx('w-[190px]', period && 'bg-selection')} />
          <Select<BudgetState>
            aria-label="Narrow"
            value={state}
            onValueChange={setState}
            options={[
              { value: '', label: 'Everything' },
              { value: 'over', label: 'Over budget' },
              { value: 'near', label: '80% or more used' },
              { value: 'hard', label: 'Hard limits only' },
            ]}
            className={cx('w-[170px]', state && 'bg-selection')}
          />
          <Select<BudgetSort> aria-label="Sort by" value={sort} onValueChange={setSort} options={BUDGET_SORTS.map(([v, l]) => ({ value: v, label: `Sort: ${l}` }))} className="w-[170px]" />
          <button type="button" className={btn} aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'} title={dir === 'asc' ? 'Ascending' : 'Descending'} onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>
            <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} />
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
        <div style={{ minWidth: minWidth(220, fixed) }}>
          <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
            <span className="min-w-0 flex-1">Budget</span>
            <span className="shrink-0" style={{ width: W.used }}>
              Used
            </span>
            <span className="shrink-0 text-right" style={{ width: W.fig }} title="Submitted, not yet decided">
              Committed
            </span>
            <span className="shrink-0 text-right" style={{ width: W.fig }} title="Decided yes, not yet paid">
              Approved
            </span>
            <span className="shrink-0 text-right" style={{ width: W.fig }}>
              Paid
            </span>
            <span className="shrink-0 text-right" style={{ width: W.remaining }}>
              Remaining
            </span>
            <span className="shrink-0 text-right" style={{ width: W.claims }}>
              Claims
            </span>
            {mayEdit ? <span className="shrink-0" style={{ width: W.act }} /> : null}
          </div>
          {shown.map((b) => (
            <BudgetLine key={b.id} b={b} mayEdit={mayEdit} onOpen={() => setOpen(b.id)} onEdit={() => setEditing(b)} />
          ))}
          {!all.length ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
              <b className="text-[13px] text-ink">No budgets set.</b>
              <span className="max-w-[560px] text-[12.5px] text-ink-3">Without one, spending is recorded but nothing compares it to a plan. A budget can cover the organization, a branch, a department, a cost centre, a project, a category or one person.</span>
            </div>
          ) : !shown.length ? (
            <div className="px-3.5 py-6 text-center text-[12.5px] text-ink-3">No budgets match those filters.</div>
          ) : null}
        </div>
      </div>

      {d.note ? <p className="m-0 max-w-[80ch] text-[11.5px] leading-relaxed text-ink-3">{d.note}</p> : null}

      {open !== null ? (
        <BudgetDrawer
          orgId={orgId}
          id={open}
          row={openRow}
          mayEdit={mayEdit}
          onEdit={openRow ? () => setEditing(openRow) : undefined}
          onClaim={(id) => onGo('organization', `&claim=${id}`)}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {editing !== null ? (
        <BudgetSheet
          orgId={orgId}
          budget={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onClosed={() => {
            setEditing(null);
            setOpen(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** One budget on the list. Over budget is the row somebody came to find, so it carries the tone rather than a minus sign in one column. */
function BudgetLine({ b, mayEdit, onOpen, onEdit }: { b: Budget; mayEdit: boolean; onOpen: () => void; onEdit: () => void }) {
  const over = isOver(b);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={onKey} className={cx('flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-[13px] last:border-b-0 hover:bg-subtle', over && 'bg-danger-bg/50')}>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-ink">{b.name}</b>
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
          <span className="truncate">
            {b.scope_name} · {b.period}
          </span>
          {b.hard_stop ? <Pill tone="red">Hard limit</Pill> : null}
        </span>
      </span>
      <span className="flex shrink-0 flex-col gap-1" style={{ width: W.used }}>
        <span className="flex justify-between gap-2 text-[11.5px] text-ink-3 tabular-nums">
          <span>{b.pct === null ? '—' : `${b.pct}%`}</span>
          <span className="truncate">of {money(b.amount, b.currency)}</span>
        </span>
        <Meter b={b} />
      </span>
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.fig }}>
        {money(b.committed, b.currency)}
      </span>
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.fig }}>
        {money(b.approved, b.currency)}
      </span>
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.fig }}>
        {money(b.paid, b.currency)}
      </span>
      <span className="flex shrink-0 flex-col items-end text-right tabular-nums" style={{ width: W.remaining }}>
        {over ? <b className="text-danger">{money(unsigned(b.remaining), b.currency)} over</b> : <span className="text-ink">{money(b.remaining, b.currency)}</span>}
        {b.forecast?.over_by && !over ? (
          <span className="text-[11px] text-warning-ink dark:text-warning" title={`${b.forecast.basis}. Arithmetic, not a prediction.`}>
            at this rate {money(b.forecast.over_by, b.currency)} over
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.claims }}>
        {b.claims}
      </span>
      {mayEdit ? (
        <span className="flex shrink-0 justify-end" style={{ width: W.act }}>
          <button
            type="button"
            className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-ink-3 hover:bg-subtle hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </button>
        </span>
      ) : null}
    </div>
  );
}

function Split({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-line bg-ground px-3 py-2">
      <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{label}</span>
      <b className="truncate text-[13.5px] text-ink tabular-nums">{value}</b>
      <span className="text-[11px] text-ink-3">{hint}</span>
    </div>
  );
}

/**
 * One budget: the three figures, how close, the run rate with its caveat,
 * and the claims that make up the number — largest first, because the
 * question is always "what took it", and the answer is usually in the first
 * three rows.
 */
function BudgetDrawer({ orgId, id, row, mayEdit, onEdit, onClaim, onClose }: { orgId: number; id: number; row: Budget | null; mayEdit: boolean; onEdit?: () => void; onClaim: (id: number) => void; onClose: () => void }) {
  const q = useQuery({ queryKey: KR.budget(orgId, id), queryFn: ({ signal }) => fetchBudget(orgId, id, signal), retry: false });
  const b = q.data;
  const refused = readRefusal(q.error);
  return (
    <SidePanel
      label="Budget"
      width={580}
      onClose={onClose}
      head={
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-[15px] text-ink">{b?.name ?? row?.name ?? 'Budget'}</b>
            <span className="truncate text-[12px] text-ink-3">{[row?.scope_name, b?.period ?? row?.period].filter(Boolean).join(' · ')}</span>
          </span>
          {mayEdit && onEdit ? (
            <button type="button" className={btnSmall} onClick={onEdit}>
              Edit
            </button>
          ) : null}
        </>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : refused ? (
        <p className="m-0 text-[13px] text-ink-2">{refused}</p>
      ) : q.error || !b ? (
        <div className="flex flex-col items-start gap-2 text-[13px] text-ink-2">
          This budget could not be loaded. This is a failed request, not a statement about the budget.
          <button type="button" className={btn} onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="m-0 text-[13px] text-ink-2">{usedSentence(b)}</p>
            <Meter b={b} className="h-2" />
            <p className="m-0 text-[12px] text-ink-3">
              {hardSentence(b.hard_stop)} It warns at {b.alert_at_pct}% used.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Split label="Committed" value={money(b.committed, b.currency)} hint="Submitted, not yet decided." />
            <Split label="Approved" value={money(b.approved, b.currency)} hint="Decided yes, not yet paid." />
            <Split label="Paid" value={money(b.paid, b.currency)} hint="Gone." />
            <Split label={isOver(b) ? 'Over by' : 'Remaining'} value={money(isOver(b) ? unsigned(b.remaining) : b.remaining, b.currency)} hint={`Of ${money(b.amount, b.currency)}.`} />
          </div>
          {b.forecast ? (
            <Notice tone={b.forecast.over_by ? 'amber' : 'grey'}>
              <b>{forecastSentence(b.forecast, b.currency)}</b> That is {b.forecast.basis}. Arithmetic, not a prediction.
            </Notice>
          ) : null}
          <div className="flex flex-col">
            <Caps>What consumed it</Caps>
            {b.claim_list.length ? (
              <div className="flex flex-col overflow-hidden rounded-[10px] border border-line">
                {b.claim_list.map((c) => (
                  <button key={c.id} type="button" onClick={() => onClaim(c.id)} className="flex items-center gap-2.5 border-b border-line/60 px-3 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {c.claim_no ? <span className="shrink-0 font-mono text-[11.5px] text-ink-3">{c.claim_no}</span> : null}
                        <span className="truncate text-ink">{c.description || 'No description'}</span>
                      </span>
                      <span className="truncate text-[11.5px] text-ink-3">{[c.claimant, shortDate(c.spent_on)].filter(Boolean).join(' · ')}</span>
                    </span>
                    {c.status ? <StatusPill status={c.status} /> : null}
                    <b className="shrink-0 text-ink tabular-nums">{money(c.base_amount, b.currency)}</b>
                  </button>
                ))}
              </div>
            ) : (
              <p className="m-0 text-[12.5px] text-ink-3">Nothing has been charged to this budget's scope and period.</p>
            )}
            {b.claim_list.length >= 100 ? <p className="mt-1.5 mb-0 text-[11.5px] text-ink-3">The largest 100 are shown.</p> : null}
          </div>
        </>
      )}
    </SidePanel>
  );
}

function Said({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <Notice tone="red">
      {lines.length === 1 ? (
        lines[0]
      ) : (
        <ul className="m-0 pl-4">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

const selectField = 'w-full';

/** A new budget, or an existing one. Closing sits here too, behind a sentence saying what it stops. */
function BudgetSheet({ orgId, budget, onClose, onSaved, onClosed }: { orgId: number; budget: Budget | null; onClose: () => void; onSaved: () => void; onClosed: () => void }) {
  const [d, setD] = useState<BudgetDraft>(() => budgetDraft(budget, todayInZone()));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const [closing, setClosing] = useState(false);
  const set = <F extends keyof BudgetDraft>(f: F, v: BudgetDraft[F]) => setD((x) => ({ ...x, [f]: v }));

  const cats = useQuery({ queryKey: KR.categories(orgId), queryFn: ({ signal }) => fetchCategories(orgId, signal), enabled: d.scope === 'category', retry: false, staleTime: 60_000 });
  const centres = useQuery({ queryKey: KR.centres(orgId), queryFn: ({ signal }) => fetchCentres(orgId, signal), enabled: d.scope === 'cost_centre', retry: false, staleTime: 60_000 });
  const people = useQuery({ queryKey: KR.people(orgId), queryFn: ({ signal }) => fetchPeople(orgId, signal), enabled: ['branch', 'department', 'user'].includes(d.scope), retry: false, staleTime: 60_000 });
  const loading = (d.scope === 'category' && cats.isLoading) || (d.scope === 'cost_centre' && centres.isLoading) || (['branch', 'department', 'user'].includes(d.scope) && people.isLoading);
  const options = pickList(d.scope, { categories: cats.data, centres: centres.data, people: people.data });
  // The list sends the scope's name, not its id: an edit finds it again by name.
  const guess = budget && d.scope === budget.scope ? scopeIdFor(options, budget.scope_name) : null;
  const scopeId = d.scope === 'organization' ? null : options ? (d.scope_id ?? guess) : idOf(d.scope_typed);
  const problems = budgetProblems(d);

  const save = async () => {
    setBusy(true);
    setSaid([]);
    try {
      const r = await saveBudget(orgId, budgetBody(d, scopeId), budget?.id ?? null);
      toast('success', r?.message ?? (budget ? 'Budget saved.' : 'Budget created.'));
      onSaved();
      onClose();
    } catch (e) {
      // The engine's sentence — "…already covers that scope and period", or whose rights this needs — as said.
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!budget) return;
    setBusy(true);
    try {
      const m = await closeBudget(orgId, budget.id);
      toast('success', m ?? 'Budget closed. Its figures stay available in reports.');
      onClosed();
    } catch (e) {
      setClosing(false);
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  let which: ReactNode = null;
  if (d.scope !== 'organization') {
    if (options) {
      const lost = budget && d.scope === budget.scope && d.scope_id === null && guess === null && !loading;
      which = (
        <Field label="Which one" hint={lost ? `It was “${budget.scope_name}”. Choose it again — the list cannot tell which one that was.` : undefined}>
          <Select<number | null>
            aria-label="Which one"
            value={scopeId}
            onValueChange={(v) => set('scope_id', v)}
            disabled={loading}
            placeholder={loading ? 'Loading…' : 'Choose'}
            options={options.map((o) => ({ value: o.id, label: o.label }))}
            empty="Nothing to choose here yet."
            className={selectField}
          />
        </Field>
      );
    } else {
      which = (
        <Field label="Which one" hint={d.scope === 'project' ? 'Projects have no list here yet, so give the project’s number.' : loading ? undefined : 'The list could not be loaded, so give its number.'}>
          <input inputMode="numeric" value={d.scope_typed} onChange={(e) => set('scope_typed', e.target.value)} placeholder="id" aria-label="Which one" className={input} disabled={loading} />
        </Field>
      );
    }
  }

  return (
    <>
      <Sheet
        title={budget ? 'Edit the budget' : 'New budget'}
        onClose={onClose}
        width={540}
        footer={
          <>
            {budget ? (
              <button type="button" className="mr-auto h-[34px] rounded-[8px] px-2.5 text-[12.5px] font-semibold text-danger hover:bg-danger-bg disabled:opacity-50" disabled={busy} onClick={() => setClosing(true)}>
                Close the budget
              </button>
            ) : null}
            <button type="button" className={btn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={busy || !d.name.trim() || !d.amount.trim() || problems.length > 0} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={150} className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Covers">
            <Select<BudgetScope>
              aria-label="Covers"
              value={d.scope}
              onValueChange={(v) => setD((x) => ({ ...x, scope: v, scope_id: null, scope_typed: '' }))}
              options={BUDGET_SCOPES.map((s) => ({ value: s, label: SCOPE_WORDS[s] ?? s }))}
              className={selectField}
            />
          </Field>
          {which}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <input inputMode="decimal" value={d.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" className={input} />
          </Field>
          <Field label="Period" hint="Quarters and years follow this organization's financial year.">
            <Select<PeriodKind> aria-label="Period" value={d.period} onValueChange={(v) => set('period', v)} options={PERIODS.map((p) => ({ value: p, label: PERIOD_WORDS[p] }))} className={selectField} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starting" hint={d.period === 'custom' ? undefined : `The ${d.period === 'year' ? 'financial year' : d.period} this date falls in.`}>
            <input type="date" value={d.period_start} onChange={(e) => set('period_start', e.target.value)} aria-label="Starting" className={input} />
          </Field>
          {d.period === 'custom' ? (
            <Field label="Ending">
              <input type="date" value={d.period_end} onChange={(e) => set('period_end', e.target.value)} aria-label="Ending" className={input} />
            </Field>
          ) : null}
        </div>
        <Field label="Warn at" hint={problems[0] ? <span className="text-danger">{problems[0]}</span> : 'The owner hears once, when utilisation crosses this.'}>
          <span className="flex items-center gap-2">
            <input inputMode="numeric" value={d.alert_at_pct} onChange={(e) => set('alert_at_pct', e.target.value)} aria-label="Warn at" className={cx(input, 'w-[90px]')} />
            <span className="text-[13px] font-medium text-ink-2">% used</span>
          </span>
        </Field>
        <div className="flex items-start gap-3 rounded-[10px] border border-line bg-ground px-3 py-2.5">
          <Switch checked={d.hard_stop} onChange={(v) => set('hard_stop', v)} label="Refuse claims that would break it" />
          <span className="flex flex-col gap-0.5">
            <b className="text-[13px] text-ink">Refuse claims that would break it</b>
            <span className="text-[12px] leading-relaxed text-ink-3">
              Off by default. A budget is a plan, and refusing a genuine business expense in November because a plan written in January was low has real costs. Left off, this warns loudly and a person decides.
            </span>
          </span>
        </div>
        <Said lines={said} />
      </Sheet>
      {closing && budget ? (
        <ConfirmSheet
          title={`Close “${budget.name}”?`}
          body="Claims stop being checked against it from now, and it leaves this list. Its figures stay available in reports."
          action="Close the budget"
          danger
          busy={busy}
          onYes={() => void close()}
          onClose={() => setClosing(false)}
        />
      ) : null}
    </>
  );
}
