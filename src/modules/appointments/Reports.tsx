import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { addDays, fetchReport, fetchReports, K, money, saveCsv, today, toCsv, type Report } from './api';
import { errText, Head, input, Section, td, tdr, th, useDesk } from './parts';
import { esc, printPage, readDesk } from './print';

/**
 * D17 · Reports: the server's report catalogue (staff utilisation, outcomes, services, no-shows, customers, revenue
 * where the reader may see money), for a period and a location. Tiles, a bar per row for the utilisation reports and
 * the table are all the server's; Print and Export CSV take what is shown.
 */
type Money = Array<{ currency: string; amount: number }>;
const cell = (v: unknown, kind: string): string => {
  if (v === null || v === undefined) return '—';
  if (kind === 'money') return (v as Money).map((m) => money(m.amount, m.currency)).join(' · ') || '—';
  if (kind === 'percent') return `${Number(v).toFixed(1)}%`;
  if (kind === 'minutes') return `${v} min`;
  if (typeof v === 'object') return (v as { name?: string }).name ?? JSON.stringify(v);
  return String(v);
};

export default function Reports({ report, onReport }: { report: string | null; onReport: (k: string) => void }) {
  const desk = useDesk();
  const idx = useQuery({ queryKey: K.reports, queryFn: ({ signal }) => fetchReports(signal), staleTime: 10 * 60_000 });
  const key = report ?? idx.data?.reports.find((r) => r.key === 'staff')?.key ?? idx.data?.reports[0]?.key ?? null;
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(`${today().slice(0, 8)}01`);
  const [loc, setLoc] = useState<number | null>(desk.location);
  const r = useQuery({ queryKey: K.report(key ?? '', { from, to, loc }), queryFn: ({ signal }) => fetchReport(key!, { from, to, location: loc }, signal), enabled: !!key });
  const d = r.data;
  const meterKey = d && (d as { meter?: string }).meter ? (d as { meter?: string }).meter! : null;

  const table = (x: Report) => {
    const rows = [...x.rows, ...(x.totals ? [x.totals] : [])];
    return { head: x.columns.map((c) => c[1]), body: rows.map((row) => x.columns.map(([k, , kind]) => cell(row[k], kind))) };
  };
  const exportCsv = async () => {
    if (!d) return;
    const t = table(d);
    const where = await saveCsv(`appointments-${key}-${from}-${to}.csv`, toCsv(t.head, t.body));
    if (where) toast('success', `Saved to ${where}`);
  };
  const print = async () => {
    if (!d) return;
    const t = table(d);
    const html = `<style>body{font:11px system-ui}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:4px;text-align:left}</style><h2>${esc(d.title ?? key)}</h2><p>${esc(from)} – ${esc(to)}</p><table><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${t.body.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    try {
      await printPage(html, `Appointments · ${d.title ?? key}`, readDesk().a4Printer);
    } catch (e) {
      toast('error', errText(e));
    }
  };

  return (
    <div>
      <Head title="Reports">
        <input type="date" aria-label="From" className={cx(input, 'w-[140px]')} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" aria-label="To" className={cx(input, 'w-[140px]')} value={to} min={from} max={addDays(today(), 366)} onChange={(e) => setTo(e.target.value)} />
        <select aria-label="Location" className={cx(input, 'w-auto')} value={loc ?? ''} onChange={(e) => setLoc(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Every location</option>
          {(desk.options?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <Button variant="secondary" icon="printer" disabled={!d} onClick={() => void print()}>Print</Button>
        <Button variant="secondary" icon="download" disabled={!d || !idx.data?.export} title={idx.data?.export ? undefined : 'Exporting needs the export permission.'} onClick={() => void exportCsv()}>Export CSV</Button>
      </Head>
      <div className="grid grid-cols-[200px_1fr] gap-4">
        <nav aria-label="Reports" className="flex flex-col gap-0.5">
          {(idx.data?.reports ?? []).map((x) => (
            <button key={x.key} type="button" aria-current={x.key === key ? 'page' : undefined} onClick={() => onReport(x.key)} className={cx('rounded-[8px] px-2.5 py-1.5 text-left text-[13px]', x.key === key ? 'bg-[#EEF1FD] font-bold text-[#23349E] dark:bg-selection dark:text-primary' : 'text-ink-2 hover:bg-subtle')}>
              {x.label}
            </button>
          ))}
          {idx.isError ? <p className="text-[12px] text-danger">{errText(idx.error)}</p> : null}
        </nav>
        <div className="min-w-0">
          {r.isError ? <p className="text-[13px] text-danger">{errText(r.error)}</p> : !d ? <p className="text-[13px] text-ink-3">Reading…</p> : (
            <>
              {d.tiles?.length ? (
                <div className="mb-4 grid grid-cols-4 gap-2">
                  {d.tiles.map((t) => (
                    <div key={t.key} className="rounded-[12px] border border-line bg-surface px-3 py-2.5">
                      <div className="text-[11.5px] text-ink-3">{t.label}</div>
                      <div className="text-[18px] font-extrabold text-ink tabular-nums">{cell(t.value, t.kind)}</div>
                      {t.note ? <div className="text-[11px] text-ink-3">{t.note}</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {meterKey ? (
                <Section title="Booked time ÷ bookable time" className="mb-4">
                  <div className="px-3.5 pb-3">
                    {d.rows.map((row, i) => {
                      const p = Number(row[meterKey] ?? 0);
                      const name = cell(row[d.columns[0]?.[0] ?? 'name'], d.columns[0]?.[2] ?? 'text');
                      return (
                        <div key={i} className="flex items-center gap-2 py-1 text-[12.5px]">
                          <span className="w-[140px] truncate text-ink">{name}</span>
                          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-subtle"><span className="block h-full rounded-full bg-[#3B5BDB]" style={{ width: `${Math.min(100, Math.max(0, p))}%` }} /></span>
                          <span className="w-12 text-right tabular-nums">{`${p.toFixed(0)}%`}</span>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              ) : null}
              <Section>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px] text-ink">
                    <thead><tr>{d.columns.map(([k, l, kind]) => <th key={k} className={cx(th, kind !== 'text' && kind !== 'service' && kind !== 'provider' && kind !== 'location' && 'text-right')}>{l}</th>)}</tr></thead>
                    <tbody>
                      {[...d.rows, ...(d.totals ? [d.totals] : [])].map((row, i) => (
                        <tr key={i} className={i === d.rows.length ? 'font-bold' : undefined}>
                          {d.columns.map(([k, , kind]) => <td key={k} className={kind === 'text' || kind === 'service' || kind === 'provider' || kind === 'location' || kind === 'resource' ? td : tdr}>{cell(row[k], kind)}</td>)}
                        </tr>
                      ))}
                      {!d.rows.length ? <tr><td colSpan={d.columns.length} className="px-3 py-6 text-center text-ink-3">Nothing in this period.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
