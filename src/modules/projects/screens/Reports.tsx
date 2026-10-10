import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { PROJECT_REPORT_KINDS, type ProjectReportFormat, type ProjectReportKind } from '@shared/projects';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../../components/ui';
import { useProjectCompany } from '../company';
import { exportReport, gk, gov, type ReportResponse } from './gov-api';
import { ChartTable, CompanyPicker, Kpi, Mono, WAITS, WebButton, fmtDay, inputClass, num } from './gov-kit';
import { ScheduleButton, ScheduledList } from './ReportSchedules';

/**
 * W15 · Reports (SRS p47, PRJ-RPT): one address per report (`/projects/reports/<kind>`), each drawn the same way from
 * the server's one shape — summary figures, columns, rows and an optional two-series chart — so a new report is a
 * server change. Filters: the company (G-01), the period and the client. Export saves CSV, Excel or PDF as the server
 * renders it through the desktop's download manager (Downloads, and Transfers); "Schedule email" emails it on a
 * schedule, and the schedules the reader may see are listed under it.
 */

export const REPORT_KINDS: Array<{ kind: ProjectReportKind; label: string; hint: string }> = [
  { kind: 'summary', label: 'Portfolio summary', hint: 'status, progress, health' },
  { kind: 'budget', label: 'Budget vs actual', hint: 'labour + expenses' },
  { kind: 'tasks', label: 'Task delivery', hint: 'done, overdue, blocked' },
  { kind: 'time_by_person', label: 'Time by person', hint: 'billable, approved' },
  { kind: 'time_by_project', label: 'Time by project', hint: 'and by client' },
  { kind: 'workload', label: 'Team workload', hint: 'load vs capacity' },
  { kind: 'risks', label: 'Risk register', hint: 'ranked by score' },
  { kind: 'velocity', label: 'Sprint velocity', hint: 'committed vs delivered' },
  { kind: 'milestone_billing', label: 'Milestone billing', hint: 'achieved, invoiced' },
  { kind: 'by_client', label: 'By client', hint: 'budget, time, billing' },
];

const FORMATS: Array<{ format: ProjectReportFormat; label: string }> = [
  { format: 'csv', label: 'CSV' },
  { format: 'xlsx', label: 'Excel' },
  { format: 'pdf', label: 'PDF' },
];

export const reportKindOf = (k: string | null | undefined): ProjectReportKind => ((PROJECT_REPORT_KINDS as readonly string[]).includes(k ?? '') ? (k as ProjectReportKind) : 'summary');

const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function ReportsScreen({ kind: routeKind, offline, onOffline, onGo }: { kind: string | null; offline: boolean; onOffline: (o: boolean) => void; onGo: (route: string) => void }) {
  useProjectCompany();
  const kind = reportKindOf(routeKind);
  const meta = REPORT_KINDS.find((k) => k.kind === kind)!;
  const today = isoDay();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [client, setClient] = useState('');
  const p = { kind, from, to, client_id: client || null };
  const q = useQuery({ queryKey: gk.reports(p), queryFn: ({ signal }) => gov.reports(p, { signal }), placeholderData: (prev) => prev });
  const clients = useQuery({ queryKey: gk.clients(), queryFn: ({ signal }) => gov.clients({ signal }), staleTime: 300_000 });
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[220px] shrink-0 flex-col border-e border-line">
        <h1 className="px-4 pt-4 pb-2 text-[18px] font-bold text-ink">Reports</h1>
        <nav aria-label="Reports" className="flex flex-col gap-0.5 overflow-y-auto px-2.5 pb-3 scroll-thin">
          {REPORT_KINDS.map((k) => {
            const on = k.kind === kind;
            return (
              <button key={k.kind} type="button" aria-current={on ? 'page' : undefined} onClick={() => onGo(`/projects/reports/${k.kind}`)} className={cx('flex flex-col gap-px rounded-[9px] px-2.5 py-1.5 text-start text-[13px] font-semibold', on ? 'bg-selection text-primary' : 'text-ink hover:bg-subtle')}>
                <span>{k.label}</span>
                <span className="text-[11.5px] font-normal text-ink-3">{k.hint}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-5 py-3">
          <h2 className="me-2 text-[18px] font-bold text-ink">{meta.label}</h2>
          <CompanyPicker />
          <input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={cx(inputClass, 'h-7 w-[138px]')} />
          <span aria-hidden className="text-ink-3">
            –
          </span>
          <input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={cx(inputClass, 'h-7 w-[138px]')} />
          <div className="w-[200px]">
            <Select aria-label="Client" value={client} onValueChange={setClient} options={[{ value: '', label: 'Client: any' }, ...(clients.data?.data.clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))]} className={cx(inputClass, 'h-7')} />
          </div>
          <div className="ms-auto flex flex-wrap gap-2">
            <ScheduleButton kinds={REPORT_KINDS} kind={kind} clientId={client} offline={offline} />
            <ExportMenu params={{ kind, from, to, client_id: client || null }} offline={offline} />
            <WebButton path={`/projects/reports/${kind}`} />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
          <div className="flex flex-col gap-3.5">
            {q.isLoading ? <Spinner /> : null}
            {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
            {q.data ? <Report r={q.data.data} /> : null}
            <ScheduledList kinds={REPORT_KINDS} offline={offline} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportMenu({ params, offline }: { params: { kind: ProjectReportKind; from: string; to: string; client_id: string | null }; offline: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const run = async (format: ProjectReportFormat) => {
    setOpen(false);
    setBusy(true);
    try {
      await exportReport({ ...params, format });
      toast('success', `Saving the report as ${FORMATS.find((f) => f.format === format)!.label} to Downloads — see Transfers.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={wrap}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Button size="sm" variant="primary" icon="download" aria-haspopup="menu" aria-expanded={open} loading={busy} disabled={offline} title={offline ? WAITS : undefined} onClick={() => setOpen((o) => !o)}>
        Export ▾ <span className="font-normal opacity-80">CSV · Excel · PDF</span>
      </Button>
      {open ? (
        <div role="menu" aria-label="Export format" className="absolute end-0 z-20 mt-1 flex w-40 flex-col rounded-[10px] border border-line bg-surface p-1 shadow-lg">
          {FORMATS.map((f, i) => (
            <button key={f.format} type="button" role="menuitem" autoFocus={i === 0} onClick={() => void run(f.format)} className="rounded-[7px] px-3 py-1.5 text-start text-[13px] text-ink hover:bg-subtle focus:bg-subtle focus:outline-none">
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  return typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 1) : v;
}

function Report({ r }: { r: ReportResponse }) {
  const cols = r.columns ?? [];
  const rows = r.rows ?? [];
  const chart = r.chart ?? [];
  const legend = r.chart_legend ?? ['A', 'B'];
  const max = Math.max(1, ...chart.map((c) => c.a + c.b));
  return (
    <div className="flex flex-col gap-3.5">
      {r.summary?.length ? (
        <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
          {r.summary.map((s) => (
            <Kpi key={s.label} label={s.label} value={s.value} sub={s.sub} />
          ))}
        </section>
      ) : null}
      <p className="text-[12px] text-ink-3">
        {r.company ? (
          <>
            <b className="font-semibold text-ink-2">{r.company.name}</b> ·{' '}
          </>
        ) : null}
        Money in <Mono>{r.currency}</Mono>
        {r.rate_date ? <> at Finance rates of {fmtDay(r.rate_date)}</> : null}.
      </p>
      {chart.length ? (
        <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-ink-2">
            <h3 className="text-[14px] font-bold text-ink">
              {legend[0]} vs {legend[1].toLowerCase()}
            </h3>
            <span className="ms-auto" aria-hidden>
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" /> {legend[0]}
            </span>
            <span aria-hidden>
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning" /> {legend[1]}
            </span>
          </div>
          <ul aria-hidden className="flex flex-col gap-1.5">
            {chart.map((c) => (
              <li key={c.label} className="grid grid-cols-[170px_minmax(0,1fr)_70px] items-center gap-2.5 text-[12.5px]">
                <span className="truncate text-ink">{c.label}</span>
                <div className="flex h-3.5 overflow-hidden rounded bg-subtle">
                  <div className="bg-primary" style={{ width: `${(c.a / max) * 100}%` }} />
                  <div className="bg-warning" style={{ width: `${(c.b / max) * 100}%` }} />
                </div>
                <Mono className="text-end text-ink">{num(c.a + c.b, Number.isInteger(c.a + c.b) ? 0 : 1)}</Mono>
              </li>
            ))}
          </ul>
          <ChartTable caption={`${legend[0]} and ${legend[1]} by row`} head={['', legend[0], legend[1]]} rows={chart.map((c) => [c.label, c.a, c.b])} />
        </section>
      ) : null}
      <section className="overflow-x-auto rounded-[12px] border border-line bg-surface">
        {!rows.length ? (
          <p className="px-4 py-6 text-center text-ink-3">Nothing to report for this range.</p>
        ) : (
          <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
            <thead className="bg-subtle text-[11.5px] text-ink-3">
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className={cx('px-3 py-2 font-semibold', c.align === 'right' ? 'text-end' : 'text-start')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-line/70">
                  {cols.map((c, j) => (
                    <td key={c.key} className={cx('px-3 py-2', c.align === 'right' ? 'text-end' : 'text-start', j === 0 ? 'font-semibold text-ink' : 'text-ink-2')}>
                      {c.mono ? <Mono>{cell(row[c.key])}</Mono> : cell(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
