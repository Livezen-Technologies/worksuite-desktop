import { useQuery } from '@tanstack/react-query';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { fetchReport, REPORTS, type Report } from './api';
import { Card, NotYet, Table, td, tdr } from './parts';

/**
 * Reports (D21): the register and the rest of the report menu, each read from `reports/{key}` for the chosen run
 * (or the latest effective one). Save CSV… writes exactly the rows the server sent.
 */
const NUM = /^-?\d+(\.\d+)?$/;
const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** The rows the server sent, as CSV — quoted where needed, nothing recalculated. */
export function toCsv(r: Report): string {
  const q = (v: unknown) => {
    const s = cell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.columns.map((c) => q(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => q(row[c.key])).join(','));
  if (r.totals) lines.push(r.columns.map((c, i) => q(i === 0 ? r.totals![c.key] ?? 'Total' : r.totals![c.key])).join(','));
  return `${lines.join('\n')}\n`;
}

export async function saveReportCsv(r: Report, name: string): Promise<void> {
  try {
    const file = `${name.replace(/[^A-Za-z0-9 ._-]/g, '-').slice(0, 70) || 'payroll-report'}.csv`;
    const path = await call('files:saveText', { name: file, text: toCsv(r) });
    if (path) toast('success', 'Saved.');
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

export function ReportTable({ r }: { r: Report }) {
  return (
    <div className="overflow-x-auto">
      <Table head={r.columns.map((c, i) => (i > 0 && r.rows.some((x) => NUM.test(cell(x[c.key]))) ? ([c.label, 'r'] as [string, 'r']) : c.label))}>
        {r.rows.map((row, i) => (
          <tr key={i} className={cx(String(row.kind ?? '') === 'subtotal' && 'bg-ground font-bold')}>
            {r.columns.map((c, j) => (
              <td key={c.key} className={j > 0 && NUM.test(cell(row[c.key])) ? tdr : td}>{cell(row[c.key])}</td>
            ))}
          </tr>
        ))}
        {r.totals ? (
          <tr className="font-bold">
            {r.columns.map((c, j) => (
              <td key={c.key} className={j > 0 ? tdr : td}>{j === 0 ? cell(r.totals![c.key]) || 'Total' : cell(r.totals![c.key])}</td>
            ))}
          </tr>
        ) : null}
      </Table>
      {!r.rows.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nothing to report.</p> : null}
    </div>
  );
}

export default function Reports({ runId, report, onReport }: { runId: number | null; report: string; onReport: (key: string) => void }) {
  const key = REPORTS.some((r) => r.key === report) ? report : 'register';
  const q = useQuery({ queryKey: ['payroll', 'report', key, runId], queryFn: ({ signal }) => fetchReport(key, runId, {}, signal) });
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  const title = REPORTS.find((r) => r.key === key)!.label;
  return (
    <div className="flex gap-3">
      <nav aria-label="Reports" className="flex w-[180px] shrink-0 flex-col gap-0.5 text-[12.5px]">
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-0.5">
            <div className="mt-2 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{g}</div>
            {REPORTS.filter((r) => r.group === g).map((r) => (
              <button key={r.key} type="button" aria-current={r.key === key ? 'page' : undefined} onClick={() => onReport(r.key)} className={cx('h-[30px] rounded-[7px] px-2 text-left', r.key === key ? 'bg-[#EEF1FD] font-bold text-[#3B5BDB] dark:bg-selection dark:text-primary' : 'text-ink-2 hover:bg-subtle')}>
                {r.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[21px] font-extrabold text-ink">{title}</h1>
            {q.data?.run ? <div className="mt-0.5 text-[12px] text-ink-2">{[q.data.run.group_name, q.data.run.period_name, q.data.run.currency].filter(Boolean).join(' · ')}</div> : null}
          </div>
          {q.data ? <button type="button" className="h-8 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink" onClick={() => void saveReportCsv(q.data!, `${key}-${q.data!.run?.period_name ?? ''}`)}>Save CSV…</button> : null}
        </div>
        <Card>{q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : q.data === null ? <NotYet what={`The ${title.toLowerCase()} report`} /> : q.data ? <ReportTable r={q.data} /> : null}</Card>
      </div>
    </div>
  );
}
