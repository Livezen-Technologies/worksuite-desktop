import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dayWords } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { btnPrimary, btnSmall, Empty, input, Panel } from '../hr/parts';
import { K, money, type Budget as Data } from './api';
import { amount, KE, overBy, saveBidBudget, varianceLine, type BidCostSummary } from './bidcost';
import { addBudgetLine, budgetLineBody, COST_KINDS, fetchCosts, K2, labelOf, removeBudgetLine } from './work';

/**
 * What the bid will cost to deliver, line by line, against our bid — the
 * margin appears only once a bid value has been entered, because deriving
 * one from the buyer's ceiling would invent the number this module refuses
 * to invent. Below it, what has actually been spent chasing the bid: the
 * expense claims filed against it, for those who may see Expenses.
 */
export default function Budget({
  id,
  budget,
  canManage,
  bidCost,
  currency,
  onExpenses,
}: {
  id: number;
  budget: Data;
  canManage: boolean;
  /** What chasing the bid has cost against its bid budget, from the tender's own payload. */
  bidCost?: BidCostSummary | null;
  currency?: string;
  /** Opens the Expenses tab, for those who may see it. */
  onExpenses?: () => void;
}) {
  const qc = useQueryClient();
  const costs = useQuery({ queryKey: K2.costs(id), queryFn: ({ signal }) => fetchCosts(id, signal) });
  const [d, setD] = useState({ label: '', category: 'labour', quantity: '1', unit_cost: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: K.tender(id) });
  const add = async () => {
    const out = budgetLineBody(d);
    if (!out.body) return setError(out.error);
    setBusy(true);
    setError(null);
    try {
      await addBudgetLine(id, out.body);
      setD({ label: '', category: d.category, quantity: '1', unit_cost: '', note: '' });
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (lid: number) => {
    try {
      await removeBudgetLine(lid);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const cur = budget.currency;
  const cats = Object.entries(budget.by_category);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-[1fr_300px] gap-3.5">
        <Panel title="What it will cost" sub="Delivering the work if we win it" bodyClassName="flex flex-col">
          {budget.lines.length ? (
            budget.lines.map((l) => (
              <div key={l.id} data-budget-line={l.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{l.label}</b>
                  <span className="text-[11.5px] text-ink-3">{[labelOf(COST_KINDS, l.category), l.note].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-ink-2 tabular-nums">
                  {Number(l.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })} × {money(l.unit_cost, null)}
                </span>
                <b className="w-[140px] shrink-0 text-right text-ink tabular-nums">{money(l.line_total, cur)}</b>
                {canManage ? (
                  <button type="button" aria-label={`Remove ${l.label}`} title="Remove" className={btnSmall + ' !h-7 !w-7 justify-center !px-0 !text-danger'} onClick={() => void remove(l.id)}>
                    <Icon name="trash" size={13} />
                  </button>
                ) : null}
              </div>
            ))
          ) : (
            <Empty text="Nothing costed yet." />
          )}
          {canManage ? (
            <div className="flex flex-col gap-1.5 border-t border-line bg-ground px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="What is this cost?" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} maxLength={200} placeholder="What is this cost?" className={input + ' !w-auto min-w-[180px] flex-1'} />
                <Select<string> aria-label="What kind of cost" value={d.category} onValueChange={(v) => setD({ ...d, category: v })} options={COST_KINDS.map(([value, label]) => ({ value, label }))} className={input + ' !w-[130px]'} />
                <input aria-label="Quantity" inputMode="decimal" value={d.quantity} onChange={(e) => setD({ ...d, quantity: e.target.value })} placeholder="Qty" className={input + ' !w-[70px]'} />
                <input
                  aria-label="Unit cost"
                  inputMode="decimal"
                  value={d.unit_cost}
                  onChange={(e) => setD({ ...d, unit_cost: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && void add()}
                  placeholder={`Unit cost (${cur})`}
                  className={input + ' !w-[130px]'}
                />
                <button type="button" className={btnPrimary} disabled={busy || !d.label.trim() || !d.unit_cost.trim()} onClick={() => void add()}>
                  Add
                </button>
              </div>
              {error ? <span className="text-[12px] text-danger">{error}</span> : null}
            </div>
          ) : null}
        </Panel>
        <Panel title="Margin" bodyClassName="flex flex-col gap-2 px-3.5 py-3 text-[12.5px]">
          <span className="flex justify-between">
            <span className="text-ink-3">Total cost</span>
            <b className="text-ink tabular-nums">{money(budget.total_cost, cur)}</b>
          </span>
          {budget.margin ? (
            <>
              <span className="flex justify-between">
                <span className="text-ink-3">Our bid</span>
                <b className="text-ink tabular-nums">{money(budget.margin.bid, cur)}</b>
              </span>
              <span className="flex justify-between border-t border-line/70 pt-2">
                <span className="text-ink-3">Profit</span>
                <b className={cx('tabular-nums', budget.margin.profit.startsWith('-') ? 'text-danger' : 'text-success-ink dark:text-success')}>
                  {money(budget.margin.profit, cur)} · {budget.margin.percent}%
                </b>
              </span>
            </>
          ) : (
            <span className="text-[12px] leading-relaxed text-ink-3">{budget.note ?? 'Enter our bid on the tender to see the margin.'}</span>
          )}
          {cats.length ? (
            <div className="mt-1 flex flex-col gap-1 border-t border-line/70 pt-2">
              {cats.map(([k, v]) => (
                <span key={k} className="flex justify-between text-[12px]">
                  <span className="text-ink-3">{labelOf(COST_KINDS, k)}</span>
                  <span className="text-ink tabular-nums">{money(v, cur)}</span>
                </span>
              ))}
            </div>
          ) : null}
        </Panel>
      </div>

      <BidBudget id={id} bidCost={bidCost ?? null} currency={currency ?? budget.currency} canManage={canManage} onExpenses={onExpenses} />

      <Panel title="Spent so far" sub="Expense claims filed against this tender" bodyClassName="flex flex-col">
        {costs.isLoading ? (
          <Empty text="Reading the claims…" />
        ) : costs.data?.why ? (
          <Empty text={costs.data.why} />
        ) : costs.data?.items.length ? (
          <>
            {costs.data.items.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
                <span className="w-[92px] shrink-0 text-ink-2">{c.spent_on ? dayWords(c.spent_on, { year: true }) : '—'}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{c.description ?? c.category ?? 'A claim'}</b>
                  <span className="truncate text-[11.5px] text-ink-3">{[c.claim_no, c.claimant, c.category, c.status.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</span>
                </span>
                <b className="shrink-0 text-ink tabular-nums">{money(c.amount, c.currency)}</b>
              </div>
            ))}
            <div className="flex justify-between border-t border-line bg-ground px-3.5 py-2 text-[12.5px]">
              <span className="text-ink-3">
                {costs.data.total} {costs.data.total === 1 ? 'claim' : 'claims'}
                {costs.data.unconverted ? ` · ${costs.data.unconverted} not converted to one currency, so not in the total` : ''}
              </span>
              <b className="text-ink tabular-nums">{money(costs.data.sum, costs.data.sum_currency)}</b>
            </div>
          </>
        ) : (
          <Empty text="No claims filed against this tender." />
        )}
      </Panel>
    </div>
  );
}

/**
 * The bid budget — what pursuing this bid should cost: the fee for the
 * documents, the bond, printing, travel — and what has been spent against it.
 * "Spent LKR 18,500 of LKR 25,000 planned (74%)", the same line the Expenses
 * tab shows, from the same server figure. Not the delivery estimate above,
 * which is what the work costs if it is won.
 */
export function BidBudget({ id, bidCost, currency, canManage, onExpenses }: { id: number; bidCost: BidCostSummary | null; currency: string; canManage: boolean; onExpenses?: () => void }) {
  const qc = useQueryClient();
  const planned = bidCost?.planned ?? null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(planned?.amount ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ccy = bidCost?.totals?.currency ?? bidCost?.currency ?? planned?.currency ?? currency;
  const v = bidCost?.variance ?? null;
  const over = overBy(v, ccy);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveBidBudget(id, value);
      setEditing(false);
      void qc.invalidateQueries({ queryKey: K.tender(id) });
      void qc.invalidateQueries({ queryKey: KE.tab(id) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Bid budget"
      sub="What pursuing this bid should cost, against what its expenses have cost"
      action={
        onExpenses ? (
          <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={onExpenses}>
            Expenses
          </button>
        ) : undefined
      }
      bodyClassName="flex flex-col gap-2 px-3.5 py-3 text-[12.5px]"
    >
      {editing ? (
        <span className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Bid budget"
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            placeholder={`e.g. 25000 (${ccy})`}
            className={input + ' !w-[180px]'}
          />
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : value.trim() ? 'Save' : 'Clear it'}
          </button>
          <button type="button" className={btnSmall} onClick={() => (setEditing(false), setError(null))}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <b className="text-[16px] text-ink tabular-nums">{planned ? amount(planned.amount, ccy) : 'Not set'}</b>
          {canManage ? (
            <button type="button" className={btnSmall + ' !h-7'} onClick={() => (setValue(planned?.amount ?? ''), setEditing(true))}>
              {planned ? 'Change' : 'Set a bid budget'}
            </button>
          ) : null}
        </span>
      )}
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
      {v ? (
        <span aria-label="Budget variance" className={cx(v.over ? 'text-danger' : 'text-ink-2')}>
          {varianceLine(v, ccy)}
          {over ? ` · ${over}` : ''}
        </span>
      ) : bidCost?.visible && bidCost.totals ? (
        <span className="text-ink-2">Spent {amount(bidCost.totals.spent, ccy)} so far{planned ? '' : '; set a bid budget to see it against a plan'}.</span>
      ) : null}
    </Panel>
  );
}
