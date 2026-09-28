import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Empty, Panel, Seg } from '../hr/parts';
import { isNegative, isZero, money } from './api';
import { magnitude, num, rankDimensions, type Dimension } from './insight';
import { Notice } from './parts';
import { ShareBar } from './Trend';

/**
 * Cost by something other than the account (FR-FIN-13.05).
 *
 * COVERAGE LEADS EVERY TAB. A journal line carries a dimension only if
 * something stamped it: supplier is on every vendor bill; cost centre,
 * department and branch only on approved expense claims. A company whose
 * costs are mostly bills attributes almost nothing to a department, and a bar
 * chart of 8% of the cost base drawn without saying so is read as the whole
 * business. So each tab says what share of cost carries it, the unattributed
 * rest is a row of its own, and a tab at 0% says so plainly.
 *
 * The tabs are in order of coverage — the dimension that actually describes
 * this company's costs comes first, and one whose column does not exist comes
 * last rather than level with a genuine nothing.
 */
export function CostDimensions({ dimensions, currency, decimals, onClassify }: { dimensions: Dimension[]; currency: string; decimals: number; onClassify?: () => void }) {
  const ranked = rankDimensions(dimensions);
  const [active, setActive] = useState('');
  // The chosen tab while the payload still has it; a new period can drop one, and then the best is shown.
  const d = ranked.find((x) => x.dimension === active) ?? ranked[0];
  if (!d) return null;

  const m = (v: string) => money(v, currency, decimals);
  const pct = d.coverage_pct === null ? null : num(d.coverage_pct);
  const biggest = Math.max(...d.rows.map((r) => magnitude([r.total])), magnitude([d.unattributed]), 1);
  const label = d.label.toLowerCase();
  const behaviour = d.dimension === 'cost_behaviour';

  return (
    <Panel title="Cost by…" sub="What a journal line was stamped with, beyond its account" bodyClassName="flex flex-col gap-3 px-3.5 py-3">
      <div className="overflow-x-auto scroll-thin">
        <Seg
          label="Cost dimension"
          value={d.dimension}
          onChange={setActive}
          options={ranked.map((x) => ({
            id: x.dimension,
            label: (
              <>
                {x.label}
                {/* The coverage is on the tab, so the emptiest dimension is obvious before anybody opens it. */}
                <span className="ml-1.5 opacity-60">{!x.available ? '—' : x.coverage_pct === null ? '0%' : `${num(x.coverage_pct).toFixed(0)}%`}</span>
              </>
            ),
          }))}
        />
      </div>

      {!d.available ? (
        <p className="m-0 py-4 text-center text-[12.5px] text-ink-3">{d.why}</p>
      ) : !d.has_activity ? (
        // Nothing posted is a different statement from nothing stamped; the second sends somebody looking for a data problem.
        <p className="m-0 py-4 text-center text-[12.5px] text-ink-3">No cost was posted in this period.</p>
      ) : pct === null || pct === 0 ? (
        <Notice tone="amber">
          <Icon name="warning" size={14} className="mr-1 inline" />
          <b>Nothing carries a {label}.</b>{' '}
          {behaviour
            ? 'No account has been classified as fixed or variable yet — it is a property of the account and nobody has set it.'
            : 'A journal line only carries this if something stamped it: supplier comes from vendor bills, cost centre, department and branch from approved expense claims. Costs entered another way carry none of them.'}
          {onClassify && behaviour ? (
            <button type="button" className="ml-1 font-semibold underline" onClick={onClassify}>
              Classify the accounts
            </button>
          ) : null}
        </Notice>
      ) : (
        <>
          <p className="m-0 text-[12px] leading-relaxed text-ink-3">
            <b className="font-semibold text-ink-2">
              {pct.toFixed(1)}% of cost carries a {label}.
            </b>{' '}
            {m(d.attributed)} of {m(d.total)}. The rest is shown as its own row rather than left out — a breakdown that omits what it cannot attribute reads as the whole business.
            {d.why ? ` ${d.why}` : ''}
            {onClassify && behaviour ? (
              <button type="button" className="ml-1 font-semibold text-primary hover:underline" onClick={onClassify}>
                Classify more accounts
              </button>
            ) : null}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {d.rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-ink-2">
                    {r.name}
                    {isNegative(r.total) ? <span className="ml-1.5 text-[10.5px] font-semibold tracking-wide text-teal uppercase">net credit</span> : null}
                  </span>
                  <span className="shrink-0 text-ink tabular-nums">{m(r.total)}</span>
                </div>
                {/* A group netting to a credit — a debit note, a reversal — is not the largest cost, so it is not drawn in the cost colour. */}
                <ShareBar className="mt-1" value={r.total} total={biggest} tone={isNegative(r.total) ? 'teal' : 'danger'} />
              </li>
            ))}
            {!isZero(d.unattributed) ? (
              <li>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-ink-3 italic">No {label} recorded</span>
                  <span className="shrink-0 text-ink-2 tabular-nums">{m(d.unattributed)}</span>
                </div>
                <ShareBar className="mt-1" value={d.unattributed} total={biggest} tone="muted" />
              </li>
            ) : null}
          </ul>
          {d.rows.length === 0 && isZero(d.unattributed) ? <Empty text="Nothing posted in this period." /> : null}
        </>
      )}
    </Panel>
  );
}
