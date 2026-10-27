import { useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, PageHead, Seg, Sheet } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { can, K, money, MONTHS, problemsOf, refusal, shortDate, type Company } from './api';
import {
  approveBudget,
  archiveBudget,
  BUDGET_TYPES,
  copyBudget,
  createBudget,
  fetchBudget,
  fetchBudgets,
  gridFrom,
  gridLines,
  gridMoney,
  gridProblems,
  gridTotals,
  INCOME,
  KC,
  monthLabel,
  plural,
  restamp,
  rowCents,
  saveBudgetLines,
  cellOf,
  type BudgetAccount,
  type BudgetDetail,
  type BudgetList,
  type Grid,
  type Line12,
} from './close';
import { ConfirmSheet, LoadFailed, Notice } from '../../components/RecordKit';
import type { FinanceView, ScreenProps } from './Rail';

/**
 * Budgets: a figure per account per month, which Budget vs actual compares
 * against the ledger. The comparison is arithmetic; the plan is data somebody
 * has to type, and this is where they type it.
 *
 * THE WHOLE GRID SAVES AT ONCE. Per-cell saving would leave a plan half one
 * version and half another whenever a request failed midway. The server takes
 * the whole grid and replaces the budget's figures inside a transaction — so a
 * cell that is not an amount stops the save rather than being dropped, which
 * would delete the figure stored there. Empty cells are not stored: no budget
 * and a budget of nil are the same statement.
 *
 * APPROVED MEANS READ-ONLY. An approved budget is what every variance already
 * reported was measured against; editing it would restate those reports. Copy
 * makes a new draft, and the original stands. One budget per year may be
 * approved, so replacing the plan means archiving the old one first.
 *
 * Income and cost are totalled apart, never together: adding a sales target to
 * a wages bill gives a figure that means nothing. The grid's bottom line is
 * the profit the plan expects.
 */
export default function Budgets({ company, onGo }: ScreenProps) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayRead = can(perms, 'finance.reports.view');
  const q = useQuery({ queryKey: KC.budgets(company.id), queryFn: ({ signal }) => fetchBudgets(company.id, signal), enabled: mayRead && company.has_books, retry: false });
  const [openId, setOpenId] = useState<number | null>(null);
  const [making, setMaking] = useState(false);

  if (!company.has_books) return <p className="m-6 text-[13px] text-ink-2">{company.name} has no general ledger yet, so there is no chart to plan against.</p>;
  if (!mayRead) return <NeedsReports onGo={onGo} />;
  if (q.isLoading) return <Spinner />;
  if (q.error instanceof ApiError && q.error.forbidden) return <NeedsReports onGo={onGo} said={q.error.message} />;
  if (q.error || !q.data) return <LoadFailed what="The budgets" onRetry={() => void q.refetch()} />;
  const d = q.data;

  if (openId !== null) return <Editor key={openId} company={company} list={d} id={openId} onBack={() => setOpenId(null)} onOpen={setOpenId} />;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Budgets" sub="A figure per account per month, compared against the ledger under Budget vs actual.">
        <button type="button" className={btn} onClick={() => onGo('variance')}>
          Budget vs actual
        </button>
        {d.can_edit ? (
          <button type="button" className={btnPrimary} onClick={() => setMaking(true)}>
            <Icon name="plus" size={14} /> New budget
          </button>
        ) : null}
      </PageHead>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <span className="min-w-0 flex-1">Budget</span>
          <span className="w-[60px] shrink-0">Year</span>
          <span className="w-[150px] shrink-0">Status</span>
          <span className="w-[80px] shrink-0 text-right">Figures</span>
          <span className="w-[180px] shrink-0 text-right">Sum</span>
        </div>
        {d.rows.map((b) => (
          <button key={b.id} type="button" onClick={() => setOpenId(b.id)} className="flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-left text-[13px] last:border-b-0 hover:bg-subtle">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{b.name}</b>
              {b.note ? <span className="truncate text-[11.5px] text-ink-3">{b.note}</span> : null}
            </span>
            <span className="w-[60px] shrink-0 text-ink-2 tabular-nums">{b.year}</span>
            <span className="flex w-[150px] shrink-0 flex-col items-start">
              <BudgetPill status={b.status} />
              {b.status === 'approved' && b.approved_at ? <span className="text-[11px] text-ink-3">since {shortDate(b.approved_at)}</span> : null}
            </span>
            <span className="w-[80px] shrink-0 text-right text-ink-2 tabular-nums">{b.lines}</span>
            <span className="w-[180px] shrink-0 text-right text-ink tabular-nums">{money(b.total, d.currency ?? '')}</span>
          </button>
        ))}
        {!d.rows.length ? (
          <div className="flex flex-col items-center gap-2 px-3.5 py-8 text-center text-[12.5px] text-ink-3">
            No budgets yet. Until one is approved, Budget vs actual has nothing to compare against.
            {d.can_edit ? (
              <button type="button" className={btn} onClick={() => setMaking(true)}>
                Make the first one
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="m-0 max-w-[80ch] text-[11.5px] leading-relaxed text-ink-3">
        Exactly one budget per year may be approved — that one is “the plan”, and it is what Budget vs actual measures against. Approving it makes it read-only, because every variance already reported was measured against those figures. The sum adds income and cost plans together, so it is a size rather than a result; open a budget to see them apart, and the profit it plans for.
      </p>
      {making ? <NewBudget company={company} list={d} onClose={() => setMaking(false)} onMade={setOpenId} /> : null}
    </div>
  );
}

function NeedsReports({ onGo, said }: { onGo: (v: FinanceView) => void; said?: string }) {
  return (
    <div className="m-6 flex max-w-[620px] flex-col items-start gap-2.5">
      <Notice tone="grey">
        {said ? <b className="block">{said}</b> : null}
        Budgets are read with <code className="font-mono text-[11.5px]">finance.reports.view</code>, which you do not hold. A plan set beside the ledger is the ledger’s figures by another name, so it carries the same permission. Writing one is <code className="font-mono text-[11.5px]">finance.budget.manage</code>.
      </Notice>
      <button type="button" className={btn} onClick={() => onGo('myaccess')}>
        See what you hold
      </button>
    </div>
  );
}

const BUDGET_TONE: Record<string, 'amber' | 'green' | 'grey'> = { draft: 'amber', approved: 'green', archived: 'grey' };
const BUDGET_WORD: Record<string, string> = { draft: 'Draft', approved: 'Approved · the plan', archived: 'Archived' };

function BudgetPill({ status }: { status: string }) {
  return <Pill tone={BUDGET_TONE[status] ?? 'grey'}>{BUDGET_WORD[status] ?? status}</Pill>;
}

const invalidate = (qc: ReturnType<typeof useQueryClient>, company: number, everything = false) => void qc.invalidateQueries({ queryKey: everything ? K.company(company) : KC.budgets(company) });

// ── a new budget ─────────────────────────────────────────────────────────

function NewBudget({ company, list, onClose, onMade }: { company: Company; list: BudgetList; onClose: () => void; onMade: (id: number) => void }) {
  const qc = useQueryClient();
  const now = Number(todayInZone().slice(0, 4));
  const [year, setYear] = useState(now + 1);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [seed, setSeed] = useState<'seed' | 'empty'>('seed');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const called = name.trim() || `Budget ${year}`;
  const clash = list.rows.some((r) => r.year === year && r.name === called);

  const make = async () => {
    setBusy(true);
    setSaid([]);
    try {
      const r = await createBudget(company.id, { year, name, note, seedFrom: seed === 'seed' ? year - 1 : null });
      const seeded = Number(r?.seeded ?? 0);
      toast('success', seed === 'empty' ? `${called} created, empty.` : seeded > 0 ? `${called} created with ${plural(seeded, 'figure')} copied from ${year - 1}.` : `${called} created — ${year - 1} has nothing posted to copy, so it starts empty.`);
      invalidate(qc, company.id);
      onClose();
      if (r?.id) onMade(Number(r.id));
    } catch (e) {
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="New budget"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || clash} onClick={() => void make()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[150px_1fr] gap-3">
        <Field label="Year it plans for">
          <Select aria-label="Year it plans for" value={year} onValueChange={setYear} options={[now - 1, now, now + 1, now + 2].map((y) => ({ value: y, label: String(y) }))} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
        </Field>
        <Field label="Name" hint={clash ? <span className="text-danger">There is already a budget called “{called}” for {year}.</span> : 'Names are unique within a year.'}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Budget ${year}`} className={cx(input, clash && '!border-danger')} />
        </Field>
      </div>
      <Field label="Starting figures">
        <Seg
          label="Starting figures"
          value={seed}
          onChange={setSeed}
          options={[
            { id: 'seed', label: `Copy ${year - 1}’s actuals` },
            { id: 'empty', label: 'Start empty' },
          ]}
        />
      </Field>
      <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">
        {seed === 'seed'
          ? `What was actually posted in ${year - 1} becomes the starting figures. Nobody types two hundred accounts by twelve months from nothing — and every cell can still be changed before you approve it. A month that came out negative is left empty for somebody to fill in deliberately.`
          : 'Every cell starts empty. Add the accounts you plan for, and fill in their months.'}
      </p>
      <Field label="Note" hint="Optional. Shown under the name on the list.">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="What this plan assumes" className={input} />
      </Field>
      {said.length ? <Refused lines={said} /> : null}
    </Sheet>
  );
}

function Refused({ lines, what = 'The server refused it' }: { lines: string[]; what?: string }) {
  return (
    <Notice tone="red">
      <b>
        {what}
        {lines.length > 1 ? ` — ${lines.length} problems` : ''}:
      </b>
      {lines.length === 1 ? <> {lines[0]}</> : (
        <ul className="mt-1 mb-0 pl-4">
          {lines.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

// ── one budget: the grid ─────────────────────────────────────────────────

type Meta = BudgetAccount & { gone: boolean };
type Asking = 'approve' | 'archive' | 'copy' | 'leave' | null;

function Editor({ company, list, id, onBack, onOpen }: { company: Company; list: BudgetList; id: number; onBack: () => void; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KC.budget(company.id, id), queryFn: ({ signal }) => fetchBudget(company.id, id, signal), retry: false });
  const d = q.data;

  /*
   * The grid is held apart from the server's copy so typing survives a
   * background refetch. It is seeded from each new answer only while nothing
   * is unsaved; an answer that arrives mid-edit is noted, not applied.
   */
  const [grid, setGrid] = useState<Grid>({});
  const [seen, setSeen] = useState<BudgetDetail | null>(null);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  /*
   * Which rows are on screen is a set that only grows — never derived from
   * the figures. Deriving it meant clearing a row's last cell (exactly what
   * somebody does before typing a corrected figure) unmounted the input
   * mid-keystroke and took the account off the screen.
   */
  const [rowIds, setRowIds] = useState<number[]>([]);
  const [mode, setMode] = useState<'figures' | 'all'>('figures');
  const [find, setFind] = useState('');
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState<string[]>([]);

  if (d && d !== seen) {
    setSeen(d);
    if (!dirty) {
      setGrid(gridFrom(d));
      setRowIds((ids) => [...new Set([...ids, ...d.accounts.map((a) => a.account_id)])]);
      setStale(false);
      // An empty draft opens on every account, so there is somewhere to type.
      if (seen === null && d.accounts.length === 0 && d.can_edit) setMode('all');
    } else setStale(true);
  }

  const budgetable = useMemo(() => new Map(list.accounts.map((a) => [a.id, a])), [list.accounts]);
  const meta = useMemo(() => {
    const m = new Map<number, Meta>();
    for (const a of list.accounts) m.set(a.id, { ...a, gone: false });
    // An account archived since keeps its stored figure; its name comes from the budget so it still reads properly.
    for (const a of d?.accounts ?? []) if (!budgetable.has(a.account_id)) m.set(a.account_id, { id: a.account_id, code: a.code, name: a.name, type: a.type, gone: true });
    return m;
  }, [list.accounts, budgetable, d]);
  const metaOf = useCallback((aid: number): Meta => meta.get(aid) ?? { id: aid, code: '', name: `Account ${aid}`, type: 'expense', gone: true }, [meta]);
  const gone = useMemo(() => new Set([...meta.values()].filter((a) => a.gone).map((a) => a.id)), [meta]);

  const onCell = useCallback((aid: number, month: string, v: string) => {
    setGrid((g) => ({ ...g, [aid]: { ...g[aid], [month]: v } }));
    setRowIds((ids) => (ids.includes(aid) ? ids : [...ids, aid]));
    setDirty(true);
  }, []);

  if (q.isLoading) return <Spinner />;
  if (q.error || !d) return <LoadFailed what="This budget" onRetry={() => void q.refetch()} />;

  const editable = d.can_edit;
  const months = d.months;
  const cur = d.currency ?? list.currency ?? company.base_currency ?? '';
  const totals = gridTotals(grid, (aid) => metaOf(aid).type, months);
  const problems = editable ? gridProblems(grid, months, (aid) => `${metaOf(aid).code} ${metaOf(aid).name}`.trim(), gone) : [];
  const otherPlan = list.rows.find((r) => r.year === d.year && r.status === 'approved' && r.id !== d.id);

  // The rows on screen: those with figures (and any added), or every account; then the find box; then grouped by type.
  const pool: Meta[] = editable && mode === 'all' ? [...meta.values()] : rowIds.map(metaOf);
  const term = find.trim().toLowerCase();
  const shown = term ? pool.filter((a) => a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term)) : pool;
  const types = [...BUDGET_TYPES.map((t) => t.value as string), ...new Set(shown.map((a) => a.type).filter((t) => !BUDGET_TYPES.some((b) => b.value === t)))];
  const groups = types
    .map((t) => ({ type: t, label: BUDGET_TYPES.find((b) => b.value === t)?.label ?? t.replace(/_/g, ' '), rows: shown.filter((a) => a.type === t).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })) }))
    .filter((g) => g.rows.length > 0);
  // Each input's place down the grid, for Enter and the arrow keys.
  const place = new Map<number, number>();
  for (const g of groups) for (const a of g.rows) place.set(a.id, place.size);
  const addable = list.accounts.filter((a) => !rowIds.includes(a.id));

  const refresh = (everything = false) => invalidate(qc, company.id, everything);
  const act = async (what: string, fn: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(what);
    setSaid([]);
    try {
      await fn();
      toast('success', done);
      setAsking(null);
      after?.();
    } catch (e) {
      setAsking(null);
      setSaid(problemsOf(e));
    } finally {
      setBusy('');
    }
  };
  const save = () => {
    const lines = gridLines(grid, months);
    return act('save', () => saveBudgetLines(company.id, d.id, lines), `${plural(lines.length, 'figure')} saved.`, () => {
      setDirty(false);
      setStale(false);
      refresh();
    });
  };
  const leave = () => (dirty ? setAsking('leave') : onBack());

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <button type="button" onClick={leave} className="inline-flex items-center gap-1 self-start text-[12.5px] font-semibold text-ink-3 hover:text-ink">
        <Icon name="chevron-left" size={14} /> All budgets
      </button>
      <PageHead
        title={
          <>
            {d.name} <span className="font-semibold text-ink-3">{d.year}</span>
          </>
        }
        sub={`January to December ${d.year}${company.fiscal_year_start_month && company.fiscal_year_start_month !== 1 ? ` — a budget is a calendar year, though the books’ year starts in ${MONTHS[company.fiscal_year_start_month - 1]}` : ''} · figures in ${cur}`}
      >
        <BudgetPill status={d.status} />
        {editable ? (
          <button type="button" className={btnPrimary} disabled={busy !== '' || !dirty || problems.length > 0} onClick={() => void save()}>
            {busy === 'save' ? 'Saving…' : dirty ? 'Save figures' : 'Saved'}
          </button>
        ) : null}
        {editable ? (
          <button type="button" className={btn} disabled={busy !== '' || dirty} title={dirty ? 'Save the figures first' : undefined} onClick={() => setAsking('approve')}>
            <Icon name="check" size={14} /> Approve
          </button>
        ) : null}
        {/* Gated on managing budgets, not on editing this one: copying an approved budget is exactly how it is changed. */}
        {d.can_manage ? (
          <button type="button" className={btn} disabled={busy !== ''} onClick={() => setAsking('copy')}>
            <Icon name="copy" size={14} /> Copy to draft
          </button>
        ) : null}
        {d.can_manage && d.status !== 'archived' ? (
          <button type="button" className={btn} disabled={busy !== ''} onClick={() => setAsking('archive')}>
            <Icon name="archive" size={14} /> Archive
          </button>
        ) : null}
      </PageHead>

      {editable ? (
        <p className="m-0 text-[12px] text-ink-3">
          {dirty ? <b className="text-ink-2">Unsaved changes. Save the figures before approving — approval signs what is saved, not what is typed. </b> : null}
          Saving replaces the whole budget with this grid, every account included whether or not it is on screen. A partial save would leave half of one plan and half of another.
        </p>
      ) : (
        <Notice tone="grey">
          {d.status === 'draft' ? (
            <>
              You can read this draft. Changing a budget needs <code className="font-mono text-[11.5px]">finance.budget.manage</code>.
            </>
          ) : (
            <>
              This budget is <b>{d.status}</b> and cannot be edited. Every variance already reported was measured against these figures — copy it to a new draft to change anything.
            </>
          )}
        </Notice>
      )}
      {stale ? <Notice tone="amber">This budget was saved elsewhere since you started typing. Saving replaces the whole grid with what is on this screen, including over their figures.</Notice> : null}
      {said.length ? <Refused lines={said} /> : null}
      {problems.length ? (
        <Notice tone="amber">
          <b>Nothing can be saved until {problems.length === 1 ? 'this is' : 'these are'} fixed, so no stored figure is lost:</b>
          <ul className="mt-1 mb-0 pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a code or a name" aria-label="Find an account" className={cx(input, 'w-[220px]')} />
        {editable ? (
          <Seg
            label="Accounts shown"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'figures', label: `In this budget · ${rowIds.length}` },
              { id: 'all', label: `Every account · ${meta.size}` },
            ]}
          />
        ) : null}
        {editable && mode === 'figures' && addable.length ? (
          <span className="w-[280px]">
            <Select
              aria-label="Add an account"
              searchable
              value=""
              placeholder="Add an account…"
              onValueChange={(v) => v && setRowIds((ids) => (ids.includes(Number(v)) ? ids : [...ids, Number(v)]))}
              options={[{ value: '', label: 'Add an account…' }, ...addable.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}`, group: BUDGET_TYPES.find((t) => t.value === a.type)?.label }))]}
              className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
            />
          </span>
        ) : null}
        {term ? <span className="text-[12px] text-ink-3">Showing {plural(shown.length, 'account')} of {pool.length}. The totals and the save cover them all.</span> : null}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-line bg-surface px-4 py-8 text-center text-[12.5px] text-ink-3">
          {term ? 'No account in this budget has that code or name.' : editable ? 'No figures yet. Add an account above and fill in the months you want to plan for.' : 'This budget holds no figures.'}
        </div>
      ) : (
        <div className="max-h-[calc(100vh-290px)] min-h-[240px] overflow-auto rounded-[12px] border border-line bg-surface scroll-thin">
          <table className="border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 w-[270px] min-w-[270px] border-r border-b border-line bg-ground px-3 py-2 text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Account</th>
                {months.map((m) => (
                  <th key={m} title={monthLabel(m, true)} className="sticky top-0 z-20 min-w-[96px] border-b border-line bg-ground px-2.5 py-2 text-right text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                    {monthLabel(m)}
                  </th>
                ))}
                <th className="sticky top-0 z-20 min-w-[130px] border-b border-l border-line bg-ground px-3 py-2 text-right text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.type} label={g.label} income={INCOME.includes(g.type)} sums={totals.byType[g.type]}>
                  {g.rows.map((a) => (
                    <Row key={a.id} a={a} row={grid[a.id]} months={months} editable={editable} r={place.get(a.id) ?? 0} onCell={onCell} />
                  ))}
                </GroupRows>
              ))}
            </tbody>
            <tfoot>
              <Foot label="Income" sums={totals.income} />
              <Foot label="Cost" sums={totals.cost} />
              <Foot label="Planned profit" sums={totals.profit} strong />
            </tfoot>
          </table>
        </div>
      )}

      <p className="m-0 max-w-[80ch] text-[11.5px] leading-relaxed text-ink-3">
        Figures are entered as positive amounts for both income and cost — the variance report decides what over-plan means from the account type. Empty cells are not stored: no budget and a budget of nil are the same statement. Income and cost are totalled apart, because adding a sales target to a wages bill gives a figure that means nothing.
        {editable ? ' Tab moves along a row; Enter and the arrow keys move down and up a month’s column.' : ''}
      </p>

      {asking === 'leave' ? (
        <ConfirmSheet title="Leave without saving?" body="The figures you have typed have not been saved and will be lost." action="Discard them" danger onYes={onBack} onClose={() => setAsking(null)} />
      ) : null}
      {asking === 'approve' ? (
        <ConfirmSheet
          title={`Approve ${d.name}?`}
          body={
            <>
              This becomes the plan for {d.year} and the figures become read-only — every variance reported afterwards is measured against them. Copy it to a draft to change anything later.
              {otherPlan ? (
                <Notice tone="amber" className="mt-2.5">
                  “{otherPlan.name}” is already the approved plan for {d.year}. Only one budget a year can be the plan, so the server will refuse this until that one is archived.
                </Notice>
              ) : null}
            </>
          }
          action="Approve"
          busy={busy === 'approve'}
          onYes={() => void act('approve', () => approveBudget(company.id, d.id), `Approved. This is now the plan for ${d.year}.`, () => refresh(true))}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'archive' ? (
        <ConfirmSheet
          title={`Archive ${d.name}?`}
          body={d.status === 'approved' ? `It stops being the plan for ${d.year}, which frees the year so another budget can be approved. Variances already reported against it still make sense — it is kept, not deleted.` : 'It is put aside. Nothing is deleted and it can still be copied.'}
          action="Archive"
          danger={d.status === 'approved'}
          busy={busy === 'archive'}
          onYes={() => void act('archive', () => archiveBudget(company.id, d.id), 'Archived. Reports already produced against it still make sense.', () => refresh(true))}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'copy' ? (
        <CopySheet
          company={company}
          list={list}
          d={d}
          dirty={dirty}
          stranded={[...gone].map((aid) => `${metaOf(aid).code} ${metaOf(aid).name}`)}
          onClose={() => setAsking(null)}
          onCopied={(nid) => {
            refresh();
            onOpen(nid);
          }}
        />
      ) : null}
    </div>
  );
}

function GroupRows({ label, income, sums, children }: { label: string; income: boolean; sums: Line12 | undefined; children: ReactNode }) {
  return (
    <>
      <tr>
        <th scope="rowgroup" className="sticky left-0 z-10 border-r border-b border-line bg-ground px-3 py-1.5 text-left text-[12px] font-bold text-ink">
          {label} <span className="font-medium text-ink-3">{income ? '· income' : '· cost'}</span>
        </th>
        {(sums?.months ?? Array.from({ length: 12 }, () => 0)).map((c, i) => (
          <td key={i} className="border-b border-line bg-ground px-2.5 py-1.5 text-right text-[11.5px] font-semibold text-ink-3 tabular-nums">
            {c ? gridMoney(c) : ''}
          </td>
        ))}
        <td className="border-b border-l border-line bg-ground px-3 py-1.5 text-right text-[12px] font-bold text-ink-2 tabular-nums">{gridMoney(sums?.total ?? 0)}</td>
      </tr>
      {children}
    </>
  );
}

function Foot({ label, sums, strong }: { label: string; sums: Line12; strong?: boolean }) {
  const neg = (c: number) => (c < 0 ? 'text-danger' : '');
  return (
    <tr className={strong ? 'font-bold' : 'font-semibold'}>
      <th scope="row" className={cx('sticky left-0 z-10 border-r border-line bg-ground px-3 py-2 text-left text-[12.5px] text-ink', strong ? 'border-t-2' : 'border-t')}>
        {label}
      </th>
      {sums.months.map((c, i) => (
        <td key={i} className={cx('border-line bg-ground px-2.5 py-2 text-right tabular-nums text-ink', strong ? 'border-t-2' : 'border-t', neg(c))}>
          {gridMoney(c)}
        </td>
      ))}
      <td className={cx('border-l border-line bg-ground px-3 py-2 text-right tabular-nums text-ink', strong ? 'border-t-2' : 'border-t', neg(sums.total))}>{gridMoney(sums.total)}</td>
    </tr>
  );
}

/** Enter and the arrows move down and up a month's column; Tab already moves along the row. */
function nav(e: KeyboardEvent<HTMLInputElement>) {
  const at = e.currentTarget;
  const r = Number(at.dataset.r);
  const c = at.dataset.c;
  const to = e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey) ? r + 1 : e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? r - 1 : null;
  if (to === null) return;
  const next = at.closest('table')?.querySelector<HTMLInputElement>(`input[data-r="${to}"][data-c="${c}"]`);
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/**
 * One account's twelve months. Memoised on its own figures, so a keystroke
 * redraws one row and not a hundred.
 */
const Row = memo(function Row({ a, row, months, editable, r, onCell }: { a: Meta; row: Record<string, string> | undefined; months: string[]; editable: boolean; r: number; onCell: (id: number, month: string, v: string) => void }) {
  return (
    <tr className="group">
      <th scope="row" className="sticky left-0 z-10 max-w-[270px] border-r border-b border-line/60 bg-surface px-3 py-1 text-left font-normal group-hover:bg-subtle">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-[11.5px] text-ink-3">{a.code}</span>
          <span className="min-w-0 truncate text-ink" title={a.name}>
            {a.name}
          </span>
          {a.gone ? (
            <span className="shrink-0" title="No longer an active, postable account. Its stored figures are shown; no new figure can be set against it.">
              <Pill tone="amber">archived</Pill>
            </span>
          ) : null}
        </span>
      </th>
      {months.map((m, c) => {
        const text = row?.[m] ?? '';
        const bad = 'bad' in cellOf(text);
        return (
          <td key={m} className="border-b border-line/60 px-1 py-[3px] group-hover:bg-subtle/50">
            {editable ? (
              <input
                aria-label={`${a.code} ${a.name}, ${monthLabel(m, true)}`}
                inputMode="decimal"
                placeholder="—"
                value={text}
                data-r={r}
                data-c={c}
                onChange={(e) => onCell(a.id, m, e.target.value)}
                onKeyDown={nav}
                onFocus={(e) => e.currentTarget.select()}
                className={cx('h-[28px] w-[90px] rounded-[6px] border border-line bg-surface px-1.5 text-right text-[12.5px] text-ink tabular-nums outline-none placeholder:text-ink-3/60 focus:border-primary', bad && '!border-danger text-danger')}
              />
            ) : (
              <span className={cx('block px-1.5 text-right tabular-nums', text ? 'text-ink' : 'text-ink-3')}>{text || '—'}</span>
            )}
          </td>
        );
      })}
      <td className="border-b border-l border-line/60 px-3 py-1 text-right font-semibold whitespace-nowrap text-ink tabular-nums">{gridMoney(rowCents(row, months))}</td>
    </tr>
  );
});

// ── copying ──────────────────────────────────────────────────────────────

function CopySheet({ company, list, d, dirty, stranded, onClose, onCopied }: { company: Company; list: BudgetList; d: BudgetDetail; dirty: boolean; stranded: string[]; onClose: () => void; onCopied: (id: number) => void }) {
  const [year, setYear] = useState(d.year);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const called = name.trim() || `${d.name} (copy)`;
  const clash = list.rows.some((r) => r.year === year && r.name === called);
  const first = d.months[0] ?? `${d.year}-01`;

  const copy = async () => {
    setBusy(true);
    setSaid([]);
    try {
      const r = await copyBudget(company.id, d.id, { year, name });
      toast('success', `Copied to a new draft, “${called}”.`);
      onClose();
      if (r?.id) onCopied(Number(r.id));
    } catch (e) {
      setSaid(problemsOf(e));
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`Copy ${d.name} to a new draft`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || clash} onClick={() => void copy()}>
            {busy ? 'Copying…' : 'Copy'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
        A new draft with the stored figures, to change and approve. The original stands{d.status === 'approved' ? ` — and stays the plan for ${d.year} until it is archived` : ''}.
        {dirty ? ' What you have typed here and not saved is not copied.' : ''}
      </p>
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <Field label="Into the year">
          <Select
            aria-label="Into the year"
            value={year}
            onValueChange={setYear}
            options={[
              { value: d.year, label: `${d.year} — the same year` },
              { value: d.year + 1, label: `${d.year + 1} — a year later` },
            ]}
            className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
          />
        </Field>
        <Field label="Name" hint={clash ? <span className="text-danger">There is already a budget called “{called}” for {year}.</span> : undefined}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${d.name} (copy)`} className={cx(input, clash && '!border-danger')} />
        </Field>
      </div>
      {year !== d.year ? (
        <p className="m-0 text-[12.5px] text-ink-3">
          Its months are moved onto {year}: {monthLabel(first, true)} becomes {monthLabel(restamp(first, year), true)}, and so on through December.
        </p>
      ) : d.status === 'approved' ? (
        <p className="m-0 text-[12.5px] text-ink-3">Only one budget a year can be approved. To make the copy the plan, archive this one first.</p>
      ) : null}
      {stranded.length ? (
        <Notice tone="amber">
          {stranded.join('; ')} {stranded.length === 1 ? 'is' : 'are'} no longer an active, postable account, and the server refuses to copy a figure against {stranded.length === 1 ? 'it' : 'them'} — so this copy is likely to be refused until {stranded.length === 1 ? 'that figure is' : 'those figures are'} cleared from a draft.
        </Notice>
      ) : null}
      {said.length ? <Refused lines={said} /> : null}
    </Sheet>
  );
}
