import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { shortDate } from '../finance/api';
import { monthShort } from '../finance/insight';
import { Notice } from '../../components/RecordKit';
import { RangeFields, ReadFailed } from '../finance/ReportBar';
import { btnSmall, Empty, Field, Kpi, PageHead, Panel, Seg } from '../../components/PageKit';
import { HeadLink, minWidth } from '../../components/ListKit';
import { can, canAct, money, type Org } from './api';
import {
  andList,
  CLASSIC_STATUSES,
  classicQuery,
  classicTotal,
  fetchActs,
  fetchCatalogue,
  fetchCategories,
  fetchClassic,
  fetchReport,
  IK,
  mayDo,
  num,
  plural,
  reportBars,
  reportCell,
  reportQuery,
  reportTotal,
  type ClassicFilters,
  type Report,
} from './insight';
import { Note } from './parts';
import type { ScreenProps } from './Rail';
import { StatGrid } from '../../components/StatCard';

/**
 * Analytics and Reports: the fourteen named reports, run by name, in one
 * company — and, on Reports, the claims summary beside them.
 *
 * ONE ENDPOINT FOR ALL FOURTEEN, on purpose. The screen and the CSV both go
 * through `reports2`, with the same query, so a report whose export disagrees
 * with what was on screen is not possible. A caveat attached to a report — the
 * run rate, the tax note — travels into the CSV too, because a warning that
 * only exists on screen never reaches whoever reads the spreadsheet later.
 *
 * The named reports show everybody's spending, so the server wants the
 * approver role for them. The claims summary is open to every claimant and
 * scopes itself: your own claims, unless you approve in this company. A
 * person the named reports refuse starts on the summary, rather than on a
 * refusal.
 *
 * Exports are fetched by the main process with the session and land in
 * Transfers; each button is drawn only where the route's area lets it
 * through, and the server checks again.
 */
export default function Analytics({ orgId, orgs, startOnReports }: ScreenProps & { startOnReports?: boolean }) {
  const id = orgId ?? 0;
  const org = orgs.find((o) => o.id === orgId);
  const acts = useQuery({ queryKey: IK.acts(id), queryFn: ({ signal }) => fetchActs(id, signal), enabled: orgId !== null, retry: false, staleTime: 60_000 });
  const [tab, setTab] = useState<'named' | 'summary' | null>(null);

  // The shell sends one company here; with none there is nothing honest to show.
  if (orgId === null) return <Note>Reports show one company at a time. Choose one in the switcher.</Note>;

  const namedRefused = acts.data?.['analytics.metrics.view'] === false;
  const shown = startOnReports ? (tab ?? (namedRefused ? 'summary' : 'named')) : 'named';

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title={startOnReports ? 'Reports' : 'Analytics'} sub={org ? `${org.name} · ${org.currency}` : undefined} />
      {startOnReports ? (
        <Seg
          label="Which reports"
          value={shown}
          onChange={setTab}
          options={[
            { id: 'named', label: 'Named reports' },
            { id: 'summary', label: 'Claims summary' },
          ]}
        />
      ) : null}
      {shown === 'named' ? (
        <NamedReports key={id} orgId={id} initial={startOnReports ? 'by_category' : ''} acts={acts.data} actsFailed={!!acts.error} />
      ) : (
        <ClassicSummary key={id} orgId={id} org={org} orgs={orgs} acts={acts.data} actsFailed={!!acts.error} onNamed={namedRefused ? undefined : () => setTab('named')} />
      )}
    </div>
  );
}

/** From after To is a question the server would answer with an empty report; it is asked here instead. */
const rangeProblem = (r: { from: string; to: string }) => (r.from && r.to && r.from > r.to ? 'The From date is after the To date.' : null);

async function download(expenseFile: { kind: 'report'; which: 'insights' | 'classic'; query: Record<string, string> }, name: string) {
  try {
    await call('transfers:download', { expenseFile, name });
    toast('success', 'Exporting — see Transfers.');
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

// ── the named reports ────────────────────────────────────────────────────

function NamedReports({ orgId, initial, acts, actsFailed }: { orgId: number; initial: string; acts: Record<string, boolean> | undefined; actsFailed: boolean }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [report, setReport] = useState(initial);
  const [range, setRange] = useState({ from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const problem = rangeProblem(range);
  const cat = useQuery({ queryKey: IK.catalogue(orgId), queryFn: ({ signal }) => fetchCatalogue(orgId, signal), retry: false, staleTime: 300_000 });
  const data = useQuery({
    queryKey: IK.report(orgId, report, range.from, range.to),
    queryFn: ({ signal }) => fetchReport(orgId, report, range.from, range.to, signal),
    enabled: report !== '' && problem === null,
    retry: false,
    // The last answer stays up while the dates change — never another report's rows under this one's title.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[5] === report ? prev : undefined),
  });

  if (cat.isLoading) return <Spinner />;
  if (cat.error || !cat.data) return <ReadFailed what="The list of reports" error={cat.error} onRetry={() => void cat.refetch()} />;

  const fy = cat.data.fiscalYear;
  const r = data.data;
  const mayExport = can(perms, 'expense.view') && mayDo(acts, actsFailed, 'analytics.metrics.export');
  const exportCsv = async () => {
    setBusy(true);
    await download({ kind: 'report', which: 'insights', query: reportQuery(orgId, report, range.from, range.to) }, `${report}-${todayInZone()}.csv`);
    setBusy(false);
  };

  return (
    <>
      {fy ? (
        <p className="m-0 text-[12.5px] text-ink-3">
          Without dates, a report covers the {fy.label} financial year, {shortDate(fy.start)} to {shortDate(fy.end)}.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Report" className="w-[260px]">
          <Select
            aria-label="Report"
            searchable
            value={report}
            onValueChange={setReport}
            options={[{ value: '', label: 'Choose a report' }, ...cat.data.catalogue.map((c) => ({ value: c.key, label: c.title }))]}
            className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
          />
        </Field>
        <RangeFields range={range} onChange={setRange} />
        {data.isFetching && r ? <span className="pb-2 text-[12px] text-ink-3">Updating…</span> : null}
        <span className="flex-1" />
        {report !== '' && mayExport && r && r.rows.length > 0 && problem === null ? (
          <button type="button" className={cx(btnSmall, 'mb-0.5')} disabled={busy} title="This report as it is shown, with its note, as a CSV" onClick={() => void exportCsv()}>
            <Icon name="file-sheet" size={14} className="mr-1" /> {busy ? 'Exporting…' : 'Export as CSV'}
          </button>
        ) : null}
      </div>

      {report === '' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {cat.data.catalogue.map((c) => (
            <button key={c.key} type="button" onClick={() => setReport(c.key)} className="flex items-center gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-left hover:border-primary/40">
              <Icon name="file-text" size={15} className="shrink-0 text-ink-3" />
              <b className="min-w-0 flex-1 text-[13px] text-ink">{c.title}</b>
              <Icon name="chevron-right" size={14} className="shrink-0 text-ink-3" />
            </button>
          ))}
        </div>
      ) : problem ? (
        <Notice tone="amber">{problem}</Notice>
      ) : data.isLoading ? (
        <Spinner />
      ) : data.error || !r ? (
        // A report that is not installed here, or a role the server wants: its sentence, as written.
        <ReadFailed what="This report" error={data.error} onRetry={() => void data.refetch()} />
      ) : (
        <ReportBody r={r} onAll={initial === '' ? () => setReport('') : undefined} />
      )}
    </>
  );
}

function ReportBody({ r, onAll }: { r: Report; onAll?: () => void }) {
  // A column is right-aligned when every cell in it is a figure or a count.
  const numeric = r.columns.map((_, j) => r.rows.length > 0 && r.rows.every((row) => row[j] === '—' || reportCell(row[j] ?? '').numeric));
  const W_COL = 124;
  const fixed = r.columns.slice(1).map(() => W_COL);
  const total = reportTotal(r);
  const bars = reportBars(r);

  return (
    <Panel
      title={r.title}
      sub={[r.period ? r.period.replace(/(\d{4}-\d{2}-\d{2})/g, (m) => shortDate(m)) : null, r.currency ? `in ${r.currency}` : null].filter(Boolean).join(' · ')}
      action={onAll ? <HeadLink onClick={onAll}>All reports</HeadLink> : undefined}
      bodyClassName="flex flex-col"
    >
      {r.rows.length === 0 ? (
        <Empty text="Nothing in that period." />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <div style={{ minWidth: minWidth(220, fixed) }}>
            <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              {r.columns.map((c, j) => (
                <span key={`${c}-${j}`} className={cx(j === 0 ? 'min-w-0 flex-1' : 'shrink-0', numeric[j] && 'text-right')} style={j === 0 ? undefined : { width: W_COL }}>
                  {c}
                </span>
              ))}
            </div>
            {r.rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-[9px] text-[13px] last:border-b-0">
                {row.map((cell, j) => {
                  const c = reportCell(cell);
                  return (
                    <span key={j} title={cell.length > 24 ? cell : undefined} className={cx(j === 0 ? 'min-w-0 flex-1 truncate font-semibold text-ink' : 'shrink-0 truncate text-ink-2', numeric[j] && 'text-right tabular-nums')} style={j === 0 ? undefined : { width: W_COL }}>
                      {c.text}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {r.rows.length > 0 && total ? (
        <p className="m-0 border-t border-line px-3.5 py-2.5 text-[13px]">
          <span className="text-ink-3">Total</span> <b className="text-ink tabular-nums">{money(total, r.currency)}</b>
        </p>
      ) : r.rows.length > 0 && r.total ? (
        <p className="m-0 border-t border-line px-3.5 py-2.5 text-[12.5px] text-ink-3">No total: these rows are in more than one currency, and adding them would make a figure that is not any amount of money.</p>
      ) : null}

      {/* The grouped reports, where the shape is the point: bars drawn from the same rows the table shows. */}
      {bars ? (
        <div className="flex flex-col gap-2 border-t border-line px-3.5 py-3">
          {bars.map((b, i) => (
            <div key={`${b.label}-${i}`} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="truncate text-ink-2">{b.label}</span>
                <span className="shrink-0 text-ink-3 tabular-nums">{money(b.value, r.currency)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full bg-primary" style={{ width: `${b.share}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {r.note ? (
        <div className="border-t border-line px-3.5 py-3">
          <Notice tone="grey">{r.note}</Notice>
        </div>
      ) : null}
    </Panel>
  );
}

// ── the claims summary (the classic report) ──────────────────────────────

/**
 * The claims summary: every claim the filters match, by status, category,
 * month and vendor, aggregated at the moment it is asked — no stored report
 * to fall out of date.
 *
 * ONE CURRENCY AT A TIME. The server totals what each claim was spent in, not
 * the company's books, so a summary across currencies would add dollars to
 * rupees. It is asked for one currency — the company's own to begin with —
 * and says so; the export takes the same filters, so the file holds the claims
 * the page summed.
 */
function ClassicSummary({ orgId, org, orgs, acts, actsFailed, onNamed }: { orgId: number; org: Org | undefined; orgs: Org[]; acts: Record<string, boolean> | undefined; actsFailed: boolean; onNamed?: () => void }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const own = org?.currency ?? '';
  const [f, setF] = useState<ClassicFilters>({ from: '', to: '', status: '', category: '', currency: own });
  const [busy, setBusy] = useState(false);
  const problem = rangeProblem(f);
  const cats = useQuery({ queryKey: IK.categories(orgId), queryFn: ({ signal }) => fetchCategories(orgId, signal), retry: false, staleTime: 300_000 });
  const q = useQuery({
    queryKey: IK.classic(orgId, f),
    queryFn: ({ signal }) => fetchClassic(orgId, f, signal),
    enabled: problem === null,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const currencies = [...new Set([own, ...orgs.map((o) => o.currency)].filter(Boolean))];
  const mayExport = can(perms, 'expense.view') && mayDo(acts, actsFailed, 'reports.reports.export');
  // The server reads only the caller's own claims unless they approve here.
  const ownOnly = org ? org.role === 'member' || (org.role === null && !canAct(org)) : false;
  const set = (patch: Partial<ClassicFilters>) => setF((prev) => ({ ...prev, ...patch }));
  const cur = f.currency;
  const exportCsv = async () => {
    setBusy(true);
    await download({ kind: 'report', which: 'classic', query: classicQuery(orgId, f) }, 'expense-report.csv');
    setBusy(false);
  };

  const d = q.data;
  const t = d ? classicTotal(d.byStatus) : null;
  const topCat = d ? Math.max(1, ...d.byCategory.map((c) => Math.abs(num(c.total)))) : 1;

  return (
    <>
      <div className="flex flex-wrap items-end gap-2.5">
        <RangeFields range={f} onChange={(r) => set(r)} />
        <Field label="Status" className="w-[150px]">
          <Select aria-label="Status" value={f.status} onValueChange={(v) => set({ status: v })} options={CLASSIC_STATUSES} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
        </Field>
        <Field label="Category" className="w-[190px]">
          <Select
            aria-label="Category"
            searchable
            value={f.category}
            onValueChange={(v) => set({ category: v })}
            options={[{ value: '', label: 'Any category' }, ...(cats.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))]}
            className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]"
          />
        </Field>
        {currencies.length > 1 ? (
          <Field label="Currency" className="w-[120px]">
            <Select aria-label="Currency" value={f.currency} onValueChange={(v) => set({ currency: v })} options={currencies.map((c) => ({ value: c, label: c }))} className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px]" />
          </Field>
        ) : null}
        {q.isFetching && d ? <span className="pb-2 text-[12px] text-ink-3">Updating…</span> : null}
        <span className="flex-1" />
        {mayExport && problem === null ? (
          <button type="button" className={cx(btnSmall, 'mb-0.5')} disabled={busy} title="Every claim these filters match, one row each, as a CSV" onClick={() => void exportCsv()}>
            <Icon name="file-sheet" size={14} className="mr-1" /> {busy ? 'Exporting…' : 'Export claims'}
          </button>
        ) : null}
      </div>
      <p className="m-0 text-[12.5px] text-ink-3">
        {ownOnly ? 'These are your own claims — seeing everybody’s needs the approver role in this company. ' : ''}
        {cur ? `Claims are totalled in the currency they were spent in, so these are the ${cur} claims only${currencies.length > 1 ? '; choose another currency to see those' : ''}.` : null}
      </p>

      {problem ? (
        <Notice tone="amber">{problem}</Notice>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error || !d || !t ? (
        <ReadFailed what="The claims summary" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <StatGrid>
            <Kpi icon="sigma" tone="blue" label="Total" value={money(t.total, cur)} sub={t.rejected > 0 ? `not counting ${plural(t.rejected, 'rejected claim', 'rejected claims')}` : 'everything claimed'} />
            <Kpi icon="hourglass" label="Outstanding" value={money(d.outstanding.total, cur)} sub={`${plural(d.outstanding.count, 'claim', 'claims')} approved, not yet paid`} tone={d.outstanding.count > 0 ? 'amber' : undefined} />
            <Kpi icon="check-circle" tone="green" label="Paid" value={money(d.byStatus.paid?.total ?? '0.00', cur)} sub={plural(d.byStatus.paid?.count ?? 0, 'claim', 'claims')} />
            <Kpi icon="send" tone="violet" label="Submitted" value={money(d.byStatus.submitted?.total ?? '0.00', cur)} sub="awaiting a decision" />
          </StatGrid>

          <div className="grid gap-3.5 lg:grid-cols-2">
            <Panel title="Top spending categories" bodyClassName="flex flex-col gap-2 px-3.5 py-3">
              {d.byCategory.length === 0 ? (
                <Empty text="No claims match." />
              ) : (
                d.byCategory.map((c) => (
                  <div key={c.name} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                      <span className="truncate text-ink-2">{c.name}</span>
                      <span className="shrink-0 text-ink tabular-nums">{money(c.total, cur)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (Math.abs(num(c.total)) / topCat) * 100)}%` }} />
                    </div>
                  </div>
                ))
              )}
            </Panel>
            <Panel title="Top vendors" bodyClassName="flex flex-col">
              {d.topVendors.length === 0 ? (
                <Empty text="No claim that matches names a vendor." />
              ) : (
                d.topVendors.map((v) => (
                  <div key={v.vendor} className="flex items-center justify-between gap-2 border-b border-line/60 px-3.5 py-2 text-[13px] last:border-b-0">
                    <span className="truncate text-ink">{v.vendor}</span>
                    <span className="shrink-0 text-ink-2 tabular-nums">{money(v.total, cur)}</span>
                  </div>
                ))
              )}
            </Panel>
          </div>

          <Panel title="By month" bodyClassName="flex flex-wrap gap-2 px-3.5 py-3">
            {d.byMonth.length === 0 ? (
              <Empty text="No claims match." />
            ) : (
              d.byMonth.map((m) => (
                <span key={m.month} className="rounded-[8px] bg-subtle px-2.5 py-1 text-[12px] text-ink-2">
                  {monthShort(m.month, true)} · <b className="text-ink tabular-nums">{money(m.total, cur)}</b>
                </span>
              ))
            )}
          </Panel>

          {d.unavailable.length ? (
            <p className="m-0 text-[12px] text-ink-3">
              This summary does not break spending down by {andList(d.unavailable)}.{' '}
              {onNamed ? (
                <>
                  The{' '}
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={onNamed}>
                    named reports
                  </button>{' '}
                  cover most of those.
                </>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
