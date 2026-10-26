import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Button, ErrorNote, Spinner, cx } from '../../../components/ui';
import { CompanySelect, useProjectCompany } from '../company';
import { exportReport, gk, gov, type BudgetRow, type BudgetStep, type PortfolioBudget } from './gov-api';
import { Kpi, Mono, PageHead, WAITS, WebButton, fmtDay, num, shortMoney, signed, usedTone } from './gov-kit';
import { StatGrid } from '../../../components/StatCard';

/**
 * W12 · Budget & cost (SRS p46, PRJ-BUD), the portfolio's (`/projects/budget`) and one project's
 * (`/projects/<id>/budget`).
 *
 * The tiles add up the live projects in the reporting currency at Finance's rates of the date the head names; each
 * project's row stays in its own currency. A project whose currency has no Finance rate is named under the table, not
 * silently left out. Picking a row shows how its budget moved and whose time the labour cost is. One company at a time
 * (G-01): "Company: ▾" picks it and the totals say whose they are. Export saves the budget report as a CSV through the
 * download manager; it needs WorkSuite.
 */
export function BudgetScreen({ projectId = null, offline, onOffline, onGo }: { projectId?: number | null; offline: boolean; onOffline: (o: boolean) => void; onGo: (route: string) => void }) {
  useProjectCompany();
  const [picked, setPicked] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const p = { project_id: projectId };
  const q = useQuery({ queryKey: gk.budget(p), queryFn: ({ signal }) => gov.budget(p, { signal }) });
  const d = q.data?.data;
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const rows = (d?.projects ?? []).filter((r) => !projectId || r.id === projectId);
  const selectedId = projectId ?? picked ?? d?.totals.worst?.id ?? rows[0]?.id ?? null;
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await exportReport({ kind: 'budget', format: 'csv', project_id: projectId });
      toast('success', 'Saving the budget report to Downloads — see Transfers.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const note = d ? (
    <>
      Totals{d.company ? <> for <b className="font-semibold text-ink-2">{d.company.name}</b></> : null} in {d.currency}
      {d.rate_date ? ` at Finance rates of ${fmtDay(d.rate_date)}` : ''} · each project in its own currency below
    </>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead crumb={projectId && selected ? `${selected.code} · ${selected.name}` : undefined} title={projectId ? 'Budget' : 'Budget & cost'} sub={note}>
        {!projectId ? <CompanySelect /> : <Button size="sm" icon="board" onClick={() => onGo(`/projects/${projectId}/board`)}>Board</Button>}
        <Button size="sm" icon="download" loading={exporting} disabled={!d || offline} title={offline ? WAITS : 'Saves the budget report as a CSV'} onClick={() => void exportCsv()}>
          Export
        </Button>
        <WebButton path={projectId ? `/projects/${projectId}/budget` : '/projects/budget'} />
      </PageHead>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
        {q.isLoading ? <Spinner /> : null}
        {q.error && !d ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {d ? (
          <div className="flex flex-col gap-3.5">
            {projectId ? selected ? <ProjectTiles row={selected} /> : null : <PortfolioTiles d={d} />}
            <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex min-w-0 flex-col gap-2">
                <section className="overflow-x-auto rounded-[12px] border border-line bg-surface">
                  {!rows.length ? (
                    <p className="px-4 py-6 text-center text-ink-3">No live projects with a budget.</p>
                  ) : (
                    <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
                      <thead className="bg-subtle text-[11.5px] text-ink-3">
                        <tr>
                          <th className="px-3 py-2 text-start font-semibold">Project</th>
                          <th className="px-3 py-2 text-end font-semibold">Budget</th>
                          <th className="px-3 py-2 text-end font-semibold">Labour</th>
                          <th className="px-3 py-2 text-end font-semibold">Expenses</th>
                          <th className="px-3 py-2 text-end font-semibold">Remaining</th>
                          <th className="w-40 px-3 py-2 text-start font-semibold">Used</th>
                          <th className="px-3 py-2 text-end font-semibold">At completion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <Row key={r.id} r={r} on={r.id === selectedId} single={!!projectId} onPick={() => setPicked(r.id)} />
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
                {d.unconverted.length ? (
                  <p role="note" className="text-[12px] text-warning-ink">
                    Not in the totals — Finance has no rate for{' '}
                    {d.unconverted.map((u, i) => (
                      <span key={u.id}>
                        {i > 0 ? ', ' : ''}
                        <button type="button" className="font-mono underline" onClick={() => onGo(`/projects/${u.id}/budget`)}>
                          {u.code}
                        </button>{' '}
                        ({u.currency})
                      </span>
                    ))}
                    . Their rows above are in their own currency.
                  </p>
                ) : null}
              </div>
              <aside aria-label="Budget detail" className="flex flex-col gap-3.5">
                {selected ? <CostPanels row={selected} /> : null}
                <p className="text-[11.5px] leading-relaxed text-ink-3">
                  Actual is billable time valued at each member’s rate (else the project rate), plus expense claims charged to the project that are submitted, approved or paid. It is a management figure, not an accounting one.
                </p>
              </aside>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PortfolioTiles({ d }: { d: PortfolioBudget }) {
  const t = d.totals;
  return (
    <StatGrid min={200} label="Totals">
      <Kpi icon="wallet" tone="blue" label="Budget (live projects)" value={shortMoney(t.budget)} sub={`${d.company ? `${d.company.name} · ` : ''}${d.currency}, ${t.live_projects} project${t.live_projects === 1 ? '' : 's'}`} />
      <Kpi icon="banknote" label="Spent" value={shortMoney(t.spent)} sub={`${t.used_percent}% used`} tone={t.used_percent > 100 ? 'danger' : undefined} />
      <Kpi icon="clock" tone="violet" label="Labour" value={shortMoney(t.labour)} sub={`${num(t.billable_minutes / 60)} billable hours`} />
      <Kpi icon="receipt" tone="cyan" label="Expenses" value={shortMoney(t.expenses)} sub={`${t.claims} claim${t.claims === 1 ? '' : 's'} charged`} />
      <Kpi icon="warning" label="Over budget" value={t.over_budget} tone={t.over_budget ? 'danger' : undefined} sub={t.worst ? `${t.worst.code}${t.over_budget_by ? ` by ${shortMoney(t.over_budget_by)}` : ''}` : 'none'} />
    </StatGrid>
  );
}

function ProjectTiles({ row: r }: { row: BudgetRow }) {
  const spent = Number(r.labour) + Number(r.expenses);
  return (
    <StatGrid min={200} label="Totals">
      <Kpi icon="wallet" tone="blue" label="Budget" value={shortMoney(r.budget)} sub={r.currency} />
      <Kpi icon="banknote" label="Spent" value={shortMoney(spent)} sub={`${r.used_percent}% used`} tone={r.over ? 'danger' : undefined} />
      <Kpi icon="clock" tone="violet" label="Labour" value={shortMoney(r.labour)} sub="billable time" />
      <Kpi icon="receipt" tone="cyan" label="Expenses" value={shortMoney(r.expenses)} sub="claims charged" />
      <Kpi icon="target" label="At completion" value={r.eac ? shortMoney(r.eac) : '—'} sub={r.over ? 'over budget' : 'estimate'} tone={r.over ? 'danger' : undefined} />
    </StatGrid>
  );
}

function Row({ r, on, single, onPick }: { r: BudgetRow; on: boolean; single: boolean; onPick: () => void }) {
  const neg = Number(r.remaining) < 0;
  const fill = r.used_percent > 100 ? 'bg-danger' : r.used_percent >= r.warn_percent ? 'bg-warning' : 'bg-primary';
  const eacOver = r.eac !== null && Number(r.eac) > Number(r.budget);
  return (
    <tr className={cx('border-t border-line/70', on && !single && 'bg-selection/60', !single && 'cursor-pointer hover:bg-subtle')} onClick={single ? undefined : onPick}>
      <td className="px-3 py-2">
        {single ? (
          <b className="text-ink">{r.name}</b>
        ) : (
          <button type="button" aria-pressed={on} onClick={onPick} className="text-start font-semibold text-ink hover:text-primary">
            {r.name}
          </button>
        )}
        <div className="font-mono text-[11px] text-ink-3">
          {r.code} · {r.currency}
        </div>
      </td>
      <td className="px-3 py-2 text-end text-ink"><Mono>{num(r.budget)}</Mono></td>
      <td className="px-3 py-2 text-end text-ink-2"><Mono>{num(r.labour)}</Mono></td>
      <td className="px-3 py-2 text-end text-ink-2"><Mono>{num(r.expenses)}</Mono></td>
      <td className={cx('px-3 py-2 text-end', neg ? 'font-bold text-danger' : 'text-ink-2')}><Mono>{neg ? signed(r.remaining) : num(r.remaining)}</Mono></td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div role="progressbar" aria-label={`${r.code} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(r.used_percent))} className="h-[7px] flex-1 overflow-hidden rounded-full bg-subtle">
            <div className={cx('h-full rounded-full', fill)} style={{ width: `${Math.min(100, r.used_percent)}%` }} />
          </div>
          <Mono className={cx('w-10 text-end text-[11.5px]', usedTone(r.used_percent, r.warn_percent))}>{Math.round(r.used_percent)}%</Mono>
        </div>
      </td>
      <td className={cx('px-3 py-2 text-end', eacOver ? 'font-semibold text-danger' : 'text-ink-2')}>
        <Mono>{r.eac ? shortMoney(r.eac) : '—'}</Mono>
        {eacOver ? <span className="sr-only"> (over budget)</span> : null}
      </td>
    </tr>
  );
}

function stepAmount(s: BudgetStep): { text: string; tone: string } {
  if (s.kind === 'baseline') return { text: num(s.amount), tone: 'text-ink-2' };
  if (s.kind === 'current') return { text: num(s.amount), tone: 'font-bold text-ink' };
  if (s.kind === 'pending_change') return { text: `${signed(s.delta)}?`, tone: 'text-warning-ink' };
  if (s.kind === 'change') return { text: signed(s.delta), tone: 'text-success' };
  return { text: s.delta ? signed(s.delta) : num(s.amount), tone: 'text-ink-2' };
}

function CostPanels({ row }: { row: BudgetRow }) {
  const q = useQuery({ queryKey: gk.cost(row.id), queryFn: ({ signal }) => gov.cost(row.id, { signal }) });
  const c = q.data?.data;
  const people = [...(c?.labour_by_person ?? [])].sort((a, b) => Number(b.amount) - Number(a.amount));
  const top = people.slice(0, 5).map((p) => ({ key: String(p.user_id), name: p.name, amount: Number(p.amount) }));
  const rest = people.slice(5);
  if (rest.length) top.push({ key: 'others', name: `Others (${rest.length})`, amount: rest.reduce((n, p) => n + Number(p.amount), 0) });
  const max = Math.max(1, ...top.map((p) => p.amount));
  return (
    <>
      <section className="rounded-[12px] border border-line bg-surface px-3.5 py-3">
        <h2 className="mb-1.5 text-[13.5px] font-bold text-ink">
          <Mono>{row.code}</Mono> · how the budget moved
        </h2>
        {q.isLoading ? <Spinner /> : q.error && !c ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : !c?.history.length ? (
          <p className="text-[12.5px] text-ink-3">No budget history yet.</p>
        ) : (
          <ol className="flex flex-col">
            {c.history.map((s, i) => {
              const a = stepAmount(s);
              return (
                <li key={i} className="flex gap-2 border-t border-line/60 py-1 text-[12.5px] first:border-t-0">
                  <span className="w-14 shrink-0 text-ink-3">{s.kind === 'current' ? 'Now' : fmtDay(s.at)}</span>
                  <span className="min-w-0 flex-1 text-ink">
                    {s.label}
                    {s.kind === 'pending_change' ? <span className="text-warning-ink"> (waiting)</span> : null}
                  </span>
                  <Mono className={a.tone}>{a.text}</Mono>
                </li>
              );
            })}
          </ol>
        )}
        <span className="mt-1 block text-[11px] text-ink-3">Amounts in {c?.currency ?? row.currency}</span>
      </section>
      <section className="rounded-[12px] border border-line bg-surface px-3.5 py-3">
        <h2 className="mb-2 text-[13.5px] font-bold text-ink">Labour by person</h2>
        {!top.length ? (
          <p className="text-[12.5px] text-ink-3">No billable time yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {top.map((p) => (
              <li key={p.key} className="grid grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-2 text-[12px]">
                <span className="truncate text-ink">{p.name}</span>
                <div className="h-[7px] overflow-hidden rounded-full bg-subtle" aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(p.amount / max) * 100}%` }} />
                </div>
                <Mono className="text-end text-ink">{shortMoney(p.amount)}</Mono>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
