import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../../core/bridge';
import { addDays, todayInZone } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../../components/ui';
import { btnSmall, Field, input, PageHead } from '../../hr/parts';
import { refusalOf } from '../api';
import { cell, fetchReport, fetchReports, KB3, REPORT_NEEDS } from '../api-b3';
import type { GarageViewProps } from '../registry';

/**
 * Garage reports (SRS §24, FR-ANL-01..06), stage B3: the server's list, each
 * for two company dates (the last 30 days to start), with its columns, totals
 * and notes as the server worked them out — money columns only where the
 * reader may see money. Export is the server's CSV, saved through the
 * download manager, for those who may export.
 */
export default function Reports({ org }: GarageViewProps) {
  const list = useQuery({ queryKey: KB3.reports, queryFn: ({ signal }) => fetchReports(signal) });
  const [key, setKey] = useState<string | null>(null);
  const [from, setFrom] = useState(() => addDays(todayInZone(), -30));
  const [to, setTo] = useState(todayInZone);
  const [record, setRecord] = useState('');
  const current = key ?? list.data?.items[0]?.key ?? null;
  const needs = current ? REPORT_NEEDS[current] : undefined;
  const query: Record<string, string> = { from, to, ...(org ? { org } : {}), ...(needs && record ? { [needs]: record } : {}) };
  const report = useQuery({ queryKey: KB3.report(current ?? '', query), queryFn: ({ signal }) => fetchReport(current!, query, signal), enabled: !!current && (!needs || !!record), placeholderData: (p) => p });
  const exportCsv = () =>
    void call('transfers:download', { garageFile: { kind: 'report', report: current!, query }, name: `garage-${current}-${from}-to-${to}.csv` }).then(
      () => toast('success', 'Saving the CSV to your downloads.'),
      (e) => toast('error', refusalOf(e).message),
    );

  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorNote error={list.error} onRetry={() => void list.refetch()} />;
  const r = report.data;
  return (
    <div className="flex min-h-0 gap-3 px-6 py-5">
      <nav aria-label="Reports" className="flex w-[220px] shrink-0 flex-col gap-0.5">
        {(list.data?.items ?? []).map((i) => (
          <button key={i.key} type="button" aria-current={current === i.key ? 'page' : undefined} onClick={() => (setKey(i.key), setRecord(''))} className={cx('rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px]', current === i.key ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
            {i.title}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <PageHead title={r?.title ?? 'Reports'} sub={r ? `${r.from} to ${r.to}` : undefined}>
          <Field label="From">
            <input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
          </Field>
          <Field label="To">
            <input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </Field>
          {needs ? (
            <Field label={needs === 'vehicle_id' ? 'Vehicle id' : 'Customer id'}>
              <input aria-label={needs === 'vehicle_id' ? 'Vehicle id' : 'Customer id'} inputMode="numeric" value={record} onChange={(e) => setRecord(e.target.value.replace(/[^\d]/g, ''))} className={cx(input, 'w-[110px]')} />
            </Field>
          ) : null}
          {list.data?.may_export && r ? (
            <button type="button" className={btnSmall} onClick={exportCsv}>
              <Icon name="download" size={13} /> CSV
            </button>
          ) : null}
        </PageHead>
        {needs && !record ? <p className="m-0 text-[12.5px] text-ink-3">This report is about one {needs === 'vehicle_id' ? 'vehicle' : 'customer'}: give its id.</p> : null}
        {report.isLoading ? <Spinner /> : report.error ? <ErrorNote error={report.error} onRetry={() => void report.refetch()} /> : null}
        {r ? (
          <section className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin" aria-label={r.title}>
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-ground text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  {r.columns.map((c) => (
                    <th key={c.key} className={cx('px-3 py-2', ['number', 'money', 'int', 'decimal', 'percent', 'hours'].includes(c.type) && 'text-right')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i} className="border-b border-line/70 last:border-b-0">
                    {r.columns.map((c) => (
                      <td key={c.key} className={cx('px-3 py-1.5 text-ink', ['number', 'money', 'int', 'decimal', 'percent', 'hours'].includes(c.type) && 'text-right tabular-nums')}>
                        {cell(row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
                {!r.rows.length ? (
                  <tr>
                    <td colSpan={r.columns.length} className="px-3 py-5 text-center text-ink-3">
                      Nothing in this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {r.totals ? (
                <tfoot>
                  <tr className="border-t border-line font-bold">
                    {r.columns.map((c, i) => (
                      <td key={c.key} className={cx('px-3 py-2', ['number', 'money', 'int', 'decimal', 'percent', 'hours'].includes(c.type) && 'text-right tabular-nums')}>
                        {r.totals![c.key] !== undefined ? cell(r.totals![c.key]) : i === 0 ? 'Total' : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
            {r.notes.length ? <div className="border-t border-line px-3 py-2 text-[12px] text-ink-3">{r.notes.join(' ')}</div> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
