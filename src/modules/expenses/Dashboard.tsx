import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { shortDate } from '../finance/api';
import { Notice } from '../finance/parts';
import { ReadFailed } from '../finance/ReportBar';
import { Empty, Kpi, PageHead, Panel } from '../hr/parts';
import { HeadLink } from '../inventory/parts';
import { fetchDashboard, K, money } from './api';
import {
  andList,
  axisShort,
  bandColour,
  ceilingOf,
  dashTitle,
  meanOfSpent,
  monthDelta,
  narrowIn,
  num,
  overBy,
  plural,
  shapeDashboard,
  stalledText,
  whereFrom,
  type BudgetLine,
  type Dash,
  type TrendMonth,
} from './insight';
import type { ExpenseView, ScreenProps } from './Rail';
import { StatGrid } from '../../components/StatCard';

/**
 * The dashboard.
 *
 * WHAT IT SHOWS DEPENDS ON WHAT YOU MAY SEE. A member gets their own month,
 * their own unpaid claims and their own advances. Finance additionally gets
 * the company's budgets, unmatched card lines, stalled approvals and overdue
 * advances — the four things that quietly go wrong.
 *
 * IT ADDS COMPANIES UP, BECAUSE THE SERVER WAS BUILT TO. With several
 * selected, `dashboard2` runs each company's own dashboard — by your role in
 * that company — and sums the answers; lists are concatenated and carry the
 * company they came from. Where the companies keep books in different
 * currencies there is no single total: this month is shown per currency, the
 * other amounts become counts, and the chart counts claims rather than adding
 * rupees to dirhams.
 *
 * THE MONTH-ON-MONTH FIGURE IS A COMPARISON, NOT A TREND. It is this month
 * against last month, both actual. There is no projection on this screen
 * except a budget's run rate, which is labelled where it appears.
 *
 * The data is the same query the rail's badges and the quick bar read, so the
 * page costs no second request; the shaping is this screen's `select`.
 */
export default function Dashboard({ org, onGo }: ScreenProps) {
  const q = useQuery({ queryKey: K.dashboard(org), queryFn: ({ signal }) => fetchDashboard<unknown>(org, signal), select: shapeDashboard });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    return (
      <div className="px-6 py-5">
        <ReadFailed what="The dashboard" error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const d = q.data;
  const cur = d.currency ?? '';
  const narrow = narrowIn(d);
  const allNarrow = d.consolidated && narrow.length === d.orgs.length;
  // Where a list row came from, when the page is several companies.
  const currencyOf = (orgId: number | null) => (d.consolidated ? (d.orgs.find((o) => o.id === orgId)?.currency ?? '') : cur);

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead
        title={dashTitle(d)}
        sub={
          <>
            {d.consolidated ? (allNarrow ? `Your own expenses, across ${d.orgs.length} companies` : `Consolidated across ${d.orgs.length} companies`) : d.scope === 'organization' ? 'Everything this organization spent' : 'Your own expenses'}
            {d.fiscalYear ? (
              <>
                {' '}
                · financial year {d.fiscalYear.label} ({shortDate(d.fiscalYear.start)} to {shortDate(d.fiscalYear.end)})
              </>
            ) : (
              <> · these companies have different financial years, so the period shown is the last twelve months</>
            )}
            {d.mixed ? (
              <>
                {' '}
                · <span className="text-[#9A4A06] dark:text-warning">mixed currencies, so there is no single total</span>
              </>
            ) : null}
          </>
        }
      />

      {narrow.length && !allNarrow ? (
        <p className="m-0 text-[12.5px] text-ink-3">
          In {andList(narrow)} only your own claims are counted — your role there is not finance, so the company’s other spending is not yours to see.
        </p>
      ) : null}
      {d.mixed && d.note ? <Notice tone="amber">{d.note}</Notice> : null}

      {/* No "File an expense" here: the rail carries it on every screen, and a second copy is the same control twice in one view. */}
      <StatGrid>
        <MonthKpi d={d} />
        <Kpi
          icon="inbox"
          label="Waiting for me"
          value={String(d.awaitingMe)}
          sub={d.awaitingMe === 0 ? 'nothing to decide' : 'claims and advances to decide'}
          tone={d.awaitingMe > 0 ? 'amber' : undefined}
          onClick={() => onGo('approvals')}
        />
        <Kpi
          icon="hand-coins"
          tone="green"
          label="Owed to you"
          value={d.mixed ? plural(d.myUnpaid.count, 'claim', 'claims') : money(d.myUnpaid.total, cur)}
          sub={d.mixed ? 'approved, not yet reimbursed · in several currencies' : `${d.myUnpaid.count} approved, not yet reimbursed`}
          onClick={() => onGo('mine')}
        />
        <Kpi
          icon="wallet"
          label="Advances you hold"
          value={d.mixed ? plural(d.advances.count, 'advance', 'advances') : money(d.advances.total, cur)}
          sub={d.advances.count === 0 ? 'nothing outstanding' : d.mixed ? 'still to settle · in several currencies' : `${d.advances.count} still to settle`}
          tone={d.advances.count > 0 ? 'amber' : undefined}
          onClick={() => onGo('advances')}
        />
      </StatGrid>

      <Problems d={d} cur={cur} currencyOf={currencyOf} onGo={onGo} />

      <div className="grid gap-3.5 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={d.mixed ? 'Claims, month by month' : 'Spending, month by month'}
          sub={d.mixed ? 'Counted rather than added up, because these companies keep their books in different currencies.' : undefined}
          bodyClassName="px-3.5 py-3"
        >
          <Trend rows={d.trend} bands={d.bands} currency={cur} mode={d.mixed ? 'count' : 'money'} />
        </Panel>
        <Categories d={d} cur={cur} />
      </div>

      <Renewals d={d} onGo={onGo} />
      <Budgets d={d} onGo={onGo} />

      {d.funds.length ? (
        <Panel title="Petty cash" action={<HeadLink onClick={() => onGo('petty')}>Open</HeadLink>} bodyClassName="flex flex-wrap gap-2 px-3.5 py-3">
          {d.funds.map((f) => (
            <span key={f.id ?? f.name} className={cx('rounded-[8px] px-2.5 py-1.5 text-[12.5px]', f.needsRefill ? 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' : 'bg-subtle text-ink-2')}>
              {f.name}: <b className="tabular-nums">{money(f.balance, f.currency)}</b>
              {f.needsRefill ? ' · below its minimum' : ''}
            </span>
          ))}
        </Panel>
      ) : null}

      <p className="m-0 max-w-[80ch] text-[12px] leading-relaxed text-ink-3">
        Every figure on this page is a sum of claims recorded in {d.consolidated ? 'these companies' : 'this organization'}. Nothing here is estimated or predicted — the only extrapolation in the module is a budget’s run rate, and it says so wherever it appears.
      </p>
    </div>
  );
}

/** This month: one figure, compared with last month — or one per currency, compared with nothing. */
function MonthKpi({ d }: { d: Dash }) {
  const cur = d.currency ?? '';
  if (d.mixed) {
    return (
      <Kpi
        icon="calendar"
        tone="violet"
        label={d.month.label}
        value={
          <span className="flex flex-col text-[15px] leading-snug">
            {d.monthByCurrency.map((t) => (
              <span key={t.currency}>{money(t.total, t.currency)}</span>
            ))}
          </span>
        }
        sub="one figure per currency, not added together"
      />
    );
  }
  const pct = d.month.changePct;
  return (
    <Kpi
      icon="calendar"
      label={d.month.label}
      value={money(d.month.total, cur)}
      sub={pct === null ? 'nothing spent last month to compare with' : `${pct > 0 ? '+' : ''}${pct}% against ${money(d.month.lastMonth, cur)} last month`}
      tone={pct !== null && pct > 25 ? 'amber' : undefined}
    />
  );
}

interface Problem {
  key: string;
  tone: 'red' | 'amber';
  text: string;
  hint: string;
  where: string[];
  go: ExpenseView;
  items: Array<{ key: string; label: string; sub: string; right?: string; go: [ExpenseView, string] }>;
}

const PROBLEM_TONE = {
  red: 'border-[#F1B8A8] bg-[#FDF1EE] text-[#8C2A14] dark:border-danger/40 dark:bg-danger-bg dark:text-danger',
  amber: 'border-[#F5D48A] bg-[#FFF8E6] text-[#7A3B05] dark:border-warning/40 dark:bg-warning-bg dark:text-warning',
};

/**
 * The four things that go wrong quietly. Only shown when they exist — a
 * permanently empty "problems" panel trains people to ignore it. Each goes to
 * the screen that fixes it, and the first few stalled approvals and overdue
 * advances open the record itself.
 */
function Problems({ d, cur, currencyOf, onGo }: { d: Dash; cur: string; currencyOf: (orgId: number | null) => string; onGo: (v: ExpenseView, extra?: string) => void }) {
  const list: Problem[] = [];
  if (d.stalled.length) {
    list.push({
      key: 'stalled',
      tone: 'red',
      text: stalledText(d.stalled),
      hint: 'They are routed to a step that resolves to no person, so they will sit forever.',
      where: whereFrom(d.stalled),
      go: 'policies',
      items: d.stalled
        .filter((s) => s.entityId !== null)
        .slice(0, 3)
        .map((s) => ({
          key: `${s.entityType}-${s.entityId}`,
          label: s.label || `${s.entityType === 'advance' ? 'Advance' : 'Claim'} ${s.entityId}`,
          sub: [`waiting ${plural(s.daysWaiting, 'day', 'days')}`, d.consolidated ? s.orgName : null].filter(Boolean).join(' · '),
          go: s.entityType === 'advance' ? ['advances', `&advance=${s.entityId}`] : ['mine', `&claim=${s.entityId}`],
        })),
    });
  }
  if (d.overdue.length) {
    list.push({
      key: 'overdue',
      tone: 'amber',
      text: `${plural(d.overdue.length, 'advance', 'advances')} paid out over 30 days ago and not settled`,
      hint: 'That is company money somebody is still holding.',
      where: whereFrom(d.overdue),
      go: 'advances',
      items: d.overdue
        .filter((a) => a.id !== null)
        .slice(0, 3)
        .map((a) => ({
          key: `advance-${a.id}`,
          label: [a.number, a.claimant].filter(Boolean).join(' · ') || `Advance ${a.id}`,
          sub: [a.paidOut ? `paid out ${shortDate(a.paidOut)}` : '', d.consolidated ? a.orgName : null].filter(Boolean).join(' · '),
          right: money(a.amount, currencyOf(a.orgId)),
          go: ['advances', `&advance=${a.id}`],
        })),
    });
  }
  if (d.cardsUnmatched.count > 0) {
    list.push({
      key: 'cards',
      tone: 'amber',
      text: `${plural(d.cardsUnmatched.count, 'card transaction', 'card transactions')} with no claim against ${d.cardsUnmatched.count === 1 ? 'it' : 'them'}`,
      hint: d.mixed ? 'Card spending nobody has explained, in more than one currency.' : `${money(d.cardsUnmatched.value, cur)} of card spending nobody has explained.`,
      where: [],
      go: 'cards',
      items: [],
    });
  }
  if (d.duplicates > 0) {
    list.push({
      key: 'duplicates',
      tone: 'amber',
      text: `${plural(d.duplicates, 'claim looks', 'claims look')} like the same expense twice`,
      hint: 'Flagged arithmetically. Usually a return journey; occasionally a double submission.',
      where: [],
      go: 'team',
      items: [],
    });
  }
  if (!list.length) return null;

  return (
    <Panel title="Needs somebody" bodyClassName="grid gap-2 p-3 lg:grid-cols-2">
      {list.map((p) => (
        <div key={p.key} className={cx('flex flex-col overflow-hidden rounded-[10px] border', PROBLEM_TONE[p.tone])}>
          <button type="button" onClick={() => onGo(p.go)} className="flex flex-col gap-0.5 px-3 py-2.5 text-left hover:brightness-[.98]">
            <b className="text-[13px]">{p.text}</b>
            <span className="text-[12px] opacity-90">{p.hint}</span>
            {d.consolidated && p.where.length ? <span className="text-[11.5px] opacity-80">In {andList(p.where)}.</span> : null}
          </button>
          {p.items.length ? (
            <div className="flex flex-col border-t border-current/15">
              {p.items.map((it) => (
                <button key={it.key} type="button" onClick={() => onGo(it.go[0], it.go[1])} className="flex items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:underline">
                  <span className="min-w-0 flex-1 truncate">
                    <b>{it.label}</b>
                    {it.sub ? <span className="opacity-80"> · {it.sub}</span> : null}
                  </span>
                  {it.right ? <span className="shrink-0 font-semibold tabular-nums">{it.right}</span> : null}
                  <Icon name="chevron-right" size={13} className="shrink-0 opacity-70" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </Panel>
  );
}

/** Where the money went this financial year, largest first — or, across currencies, how many claims. */
function Categories({ d, cur }: { d: Dash; cur: string }) {
  const byCount = d.mixed;
  const rows = (byCount ? [...d.byCategory].sort((a, b) => b.count - a.count) : d.byCategory).slice(0, 8);
  const top = Math.max(1, ...rows.map((c) => (byCount ? c.count : Math.abs(num(c.total)))));
  return (
    <Panel title={d.fiscalYear ? `By category, ${d.fiscalYear.label}` : 'By category, each company’s financial year'} sub={byCount ? 'Claims counted, not added up across currencies.' : undefined} bodyClassName="flex flex-col gap-2.5 px-3.5 py-3">
      {rows.length === 0 ? (
        <Empty text="Nothing has been claimed this financial year." />
      ) : (
        rows.map((c) => {
          const v = byCount ? c.count : Math.abs(num(c.total));
          return (
            <div key={c.id ?? c.name} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="truncate text-ink-2">{c.name}</span>
                <span className="shrink-0 font-semibold text-ink tabular-nums">{byCount ? plural(c.count, 'claim', 'claims') : money(c.total, cur)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (v / top) * 100)}%` }} />
              </div>
            </div>
          );
        })
      )}
    </Panel>
  );
}

/**
 * Renewals inside thirty days.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE "7 renewing" CHIP. A count says money is
 * about to leave and nothing about whether that is fine. These rows carry the
 * two facts that decide it — how much, and whether it renews on its own. One
 * set to auto-renew takes the money whether or not anybody looks; one that
 * does not is something a person has to act on before the date. Both come
 * from the one server-side predicate, so the chip and this list agree.
 */
function Renewals({ d, onGo }: { d: Dash; onGo: (v: ExpenseView, extra?: string) => void }) {
  if (!d.renewals.length) return null;
  return (
    <Panel title="Renewing in the next 30 days" action={<HeadLink onClick={() => onGo('subs')}>All subscriptions</HeadLink>} bodyClassName="flex flex-col">
      {d.renewals.map((r) => (
        <button key={r.id ?? r.name} type="button" disabled={r.id === null} onClick={() => r.id !== null && onGo('subs', `&sub=${r.id}`)} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-left last:border-b-0 enabled:hover:bg-subtle">
          {/* Days, not a date, as the leading figure: "in 3 days" is what is being decided on. */}
          <span className={cx('flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-center', r.daysUntil <= 3 ? 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' : 'bg-subtle text-ink-2')}>
            <b className="text-[14px] leading-none tabular-nums">{r.daysUntil}</b>
            <span className="mt-0.5 text-[9px] tracking-wide uppercase">{r.daysUntil === 1 ? 'day' : 'days'}</span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-[13px] text-ink">{r.name}</b>
            <span className="truncate text-[11.5px] text-ink-3">
              {[r.vendor, r.category].filter(Boolean).join(' · ') || 'No vendor or category'} · {shortDate(r.renewsOn)}
              {d.consolidated && r.orgName ? ` · ${r.orgName}` : ''}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end">
            <b className="text-[13px] text-ink tabular-nums">{money(r.amount, r.currency)}</b>
            {/* The one that needs a person, said in words rather than by a colour. */}
            <span className={cx('text-[11px]', r.autoRenew ? 'text-ink-3' : 'text-[#9A4A06] dark:text-warning')}>{r.autoRenew ? 'renews automatically' : 'will not auto-renew'}</span>
          </span>
        </button>
      ))}
      {/* Capped at eight, and said — a list that silently shows part of its own count is worse than a shorter one. */}
      {d.subscriptionsDue > d.renewals.length ? (
        <p className="m-0 border-t border-line px-3.5 py-2 text-[12px] text-ink-3">
          Showing {d.renewals.length} of {d.subscriptionsDue}.{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onGo('subs')}>
            See them all
          </button>
        </p>
      ) : null}
    </Panel>
  );
}

function Budgets({ d, onGo }: { d: Dash; onGo: (v: ExpenseView, extra?: string) => void }) {
  if (!d.budgets.length) return null;
  return (
    <Panel title="Budgets" action={<HeadLink onClick={() => onGo('budgets')}>All budgets</HeadLink>} bodyClassName="grid gap-3 p-3.5 md:grid-cols-2 xl:grid-cols-3">
      {d.budgets.map((b) => (
        <BudgetCard key={`${b.orgName ?? ''}-${b.id ?? b.name}`} b={b} showOrg={d.consolidated} />
      ))}
    </Panel>
  );
}

function BudgetCard({ b, showOrg }: { b: BudgetLine; showOrg: boolean }) {
  const over = /^\s*-/.test(b.remaining) && !/^-?0*(\.0*)?$/.test(b.remaining.trim());
  const pct = b.pct ?? 0;
  const bar = pct > 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : b.hardStop ? 'bg-primary' : 'bg-primary/60';
  return (
    <div className="flex flex-col rounded-[10px] border border-line px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <b className="truncate text-[13px] text-ink">{b.name}</b>
        <span className={cx('shrink-0 text-[12px] font-bold tabular-nums', over ? 'text-danger' : 'text-ink-3')}>{b.pct === null ? '—' : `${b.pct}%`}</span>
      </div>
      <span className="text-[11.5px] text-ink-3">
        {b.period}
        {showOrg && b.orgName ? ` · ${b.orgName}` : ''}
      </span>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle" title={b.pct === null ? 'no budget set' : `${b.pct}%`}>
        <div className={cx('h-full rounded-full', bar)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="mt-1.5 text-[12px] text-ink-2">
        {money(b.used, b.currency)} of {money(b.amount, b.currency)}
        {over ? <span className="text-danger"> · {money(overBy(b.remaining), b.currency)} over</span> : null}
      </span>
      {b.forecast ? (
        <span className="mt-1 text-[11.5px] text-ink-3">
          At this rate: {money(b.forecast.amount, b.currency)} — {b.forecast.basis}
        </span>
      ) : null}
    </div>
  );
}

// ── the trend ────────────────────────────────────────────────────────────

const W = 640;
const H = 230;
const PAD_L = 46;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 24;
/** The surface gap between two stacked bands: the edge between them is what a reader uses to tell one from the other. */
const GAP = 2;

/**
 * Spending by month, stacked by category, drawn by hand in SVG.
 *
 * A TOTAL ALONE IS NOT AN OVERVIEW. Stacking by category answers what the
 * money went on, and whether that changed, without a second chart.
 *
 * THE SCALE IS DRAWN, NOT IMPLIED. Gridlines on round figures and a dashed
 * mean across the months that had spending — skipping empty months, or six
 * months of data in a twelve-month window would report half the true average.
 * Months with nothing are drawn as nothing, never skipped: the server returns
 * them, because a gap reads as steady spending through a month with none.
 *
 * The same figures are in a table for anything that cannot see the bars.
 */
function Trend({ rows, bands, currency, mode }: { rows: TrendMonth[]; bands: Dash['bands']; currency: string; mode: 'money' | 'count' }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <Empty text="Nothing has been claimed in the last twelve months." />;

  const values = rows.map((r) => (mode === 'money' ? Math.max(0, num(r.total)) : r.count));
  const ceiling = ceilingOf(values, mode === 'count');
  const mean = meanOfSpent(values);
  const cats = mode === 'money' ? bands.categories : [];
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH - (Math.min(v, ceiling) / ceiling) * plotH;
  const groupW = plotW / rows.length;
  const barW = Math.max(4, groupW * 0.62);
  const fmt = (v: string | number) => (mode === 'money' ? money(String(v), currency) : plural(Number(v), 'claim', 'claims'));
  const cellsOf = (m: string) => bands.cells[m] ?? {};
  const delta = monthDelta(rows, mode);
  const tip = hover !== null ? rows[hover] : undefined;
  const tipX = hover !== null ? ((PAD_L + (hover + 0.5) * groupW) / W) * 100 : 0;

  return (
    <div className="flex flex-col gap-2.5">
      <table className="sr-only">
        <caption>{mode === 'money' ? 'Spending by month and category' : 'Claims by month'}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            {cats.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
            {mode === 'money' ? <th scope="col">Total</th> : null}
            <th scope="col">Claims</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <th scope="row">{r.label}</th>
              {cats.map((c) => (
                <td key={c}>{cellsOf(r.month)[c] ? money(String(cellsOf(r.month)[c]), currency) : '—'}</td>
              ))}
              {mode === 'money' ? <td>{money(r.total, currency)}</td> : null}
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div aria-hidden="true" className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block h-auto overflow-visible">
          {[0, 1, 2, 3, 4].map((i) => {
            const v = (ceiling / 4) * i;
            return (
              <g key={i}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className={i === 0 ? 'stroke-ink-3' : 'stroke-line'} strokeWidth="1" />
                <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" className="fill-ink-3 text-[10px] tabular-nums">
                  {axisShort(v)}
                </text>
              </g>
            );
          })}
          {rows.map((r, i) => {
            const total = values[i]!;
            const x = PAD_L + i * groupW + (groupW - barW) / 2;
            const cells = cellsOf(r.month);
            const stack = cats.filter((c) => (cells[c] ?? 0) > 0);
            let base = 0;
            return (
              <g key={r.month} className={cx(hover !== null && hover !== i && 'opacity-60')}>
                {total > 0 && stack.length === 0 ? <rect x={x} y={y(total)} width={barW} height={Math.max(1, y(0) - y(total))} rx="2" className="fill-primary" /> : null}
                {stack.map((c, k) => {
                  const v = cells[c] ?? 0;
                  const bottom = y(base) - (k > 0 ? GAP / 2 : 0);
                  base += v;
                  const top = y(base) + (k < stack.length - 1 ? GAP / 2 : 0);
                  const colour = bandColour(cats, c);
                  return <rect key={c} x={x} y={top} width={barW} height={Math.max(0.5, bottom - top)} rx="1.5" className={colour ? undefined : 'fill-ink-3'} style={colour ? { fill: colour } : undefined} />;
                })}
                <text x={PAD_L + (i + 0.5) * groupW} y={H - 7} textAnchor="middle" className="fill-ink-3 text-[10px]">
                  {r.label}
                </text>
                {/* The hover target is the whole column, bigger than the bar. */}
                <rect x={PAD_L + i * groupW} y={PAD_T} width={groupW} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            );
          })}
          {mean > 0 ? (
            <g className="pointer-events-none">
              <line x1={PAD_L} x2={W - PAD_R} y1={y(mean)} y2={y(mean)} className="stroke-warning" strokeWidth="1.2" strokeDasharray="4 3" />
              <text x={W - PAD_R} y={y(mean) - 4} textAnchor="end" className="fill-warning text-[10px] font-semibold">
                avg {mode === 'money' ? axisShort(mean) : mean.toFixed(1).replace(/\.0$/, '')}
              </text>
            </g>
          ) : null}
        </svg>
        {tip && hover !== null && values[hover]! > 0 ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-52 rounded-[10px] border border-line bg-surface p-2 text-[11.5px] shadow-[0_8px_24px_rgb(var(--ws-shadow-rgb)/.18)]"
            style={hover < rows.length / 2 ? { left: `${tipX}%` } : { right: `${100 - tipX}%` }}
          >
            <div className="flex items-baseline justify-between gap-2 border-b border-line pb-1">
              <b className="text-ink">{tip.label}</b>
              <span className="text-ink tabular-nums">{mode === 'money' ? money(tip.total, currency) : fmt(tip.count)}</span>
            </div>
            {cats.length ? (
              <div className="mt-1 flex flex-col gap-0.5">
                {cats
                  .filter((c) => (cellsOf(tip.month)[c] ?? 0) > 0)
                  .map((c) => (
                    <div key={c} className="flex items-center gap-1.5">
                      <Swatch categories={cats} c={c} />
                      <span className="min-w-0 flex-1 truncate text-ink-2">{c}</span>
                      <span className="text-ink tabular-nums">{money(String(cellsOf(tip.month)[c]), currency)}</span>
                    </div>
                  ))}
              </div>
            ) : null}
            {mode === 'money' ? <div className="mt-1 border-t border-line pt-1 text-ink-3">{plural(tip.count, 'claim', 'claims')}</div> : null}
          </div>
        ) : null}
      </div>

      {cats.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2.5">
          {cats.map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              <Swatch categories={cats} c={c} />
              {c}
            </span>
          ))}
        </div>
      ) : null}

      {delta ? (
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink-3">
          <Icon name={delta.more ? 'arrow-up' : 'arrow-down'} size={14} className={delta.more ? 'text-warning' : 'text-success'} />
          {mode === 'money' ? `${money(delta.diff, currency)} ${delta.more ? 'more' : 'less'} than the month before.` : `${delta.diff} ${delta.more ? 'more' : 'fewer'} ${delta.diff === '1' ? 'claim' : 'claims'} than the month before.`}
        </p>
      ) : null}
    </div>
  );
}

function Swatch({ categories, c }: { categories: string[]; c: string }): ReactNode {
  const colour = bandColour(categories, c);
  return <span aria-hidden="true" className={cx('h-2.5 w-2.5 shrink-0 rounded-[3px]', colour ? undefined : 'bg-ink-3')} style={colour ? { background: colour } : undefined} />;
}
