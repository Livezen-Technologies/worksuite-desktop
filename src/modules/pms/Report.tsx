import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { input } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, errorText, K, money, pGet, stamp, type ReportCatalogue, type ReportColumn, type ReportResult } from './api';
import { PMS_EXPORT_FORMATS } from '@shared/pms-files';
import { pmsDownload, useMaySave } from './ops';
import { NoAccess, Refusal, usePms } from './parts';

const NUMERIC = ['int', 'money', 'pct'];

function cell(c: ReportColumn, v: unknown, cur: string): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (c.type) {
    case 'money':
      return money(String(v), cur);
    case 'pct':
      return `${String(v)}%`;
    case 'date':
      return day(String(v));
    case 'datetime':
      return stamp(String(v));
    default:
      return String(v as string | number);
  }
}

/**
 * One report (§13.6, `/pms/reports/<key>`): its filters, its rows and totals
 * as the server worked them out, and — for `pms.reports.export`, where the
 * organization lets files be saved on this computer — the server's CSV (and
 * the other formats it lists) saved through the download manager
 * (`pms:download`, which checks the policy in the main process). The server
 * audits every export, and so does this computer.
 */
export default function Report({ reportKey }: { reportKey: string }) {
  const pms = usePms();
  const pid = pms.property.id;
  const maySave = useMaySave();
  const cat = useQuery({ queryKey: K.reports(pid), queryFn: ({ signal }) => pGet<ReportCatalogue>(`/properties/${pid}/reports`, undefined, signal), enabled: pms.may('pms.reports.view') && pms.online });
  const types = useQuery({ queryKey: ['pms', 'room-types', pid], queryFn: ({ signal }) => pGet<{ items: Array<{ id: number; name: string }> }>(`/properties/${pid}/room-types`, undefined, signal), retry: false, enabled: pms.online });
  const plans = useQuery({ queryKey: ['pms', 'rate-plans', pid], queryFn: ({ signal }) => pGet<{ items: Array<{ id: number; name: string }> }>(`/properties/${pid}/rate-plans`, undefined, signal), retry: false, enabled: pms.online });
  const [f, setF] = useState({ from: pms.businessDate, to: pms.businessDate, room_type_id: '', source_id: '', rate_plan_id: '' });
  const [asked, setAsked] = useState(f);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = Object.fromEntries(Object.entries(asked).filter(([, v]) => v));
  const q = useQuery({ queryKey: K.report(pid, reportKey, asked), queryFn: ({ signal }) => pGet<ReportResult>(`/properties/${pid}/reports/${reportKey}`, query, signal), enabled: pms.may('pms.reports.view') && pms.online });

  if (!pms.may('pms.reports.view')) return <NoAccess what="Reports are shown to people who may read them." />;
  if (!pms.online) return <NoAccess what="Reports show when WorkSuite is back: the figures are the server’s." />;
  const entry = cat.data?.reports.find((r) => r.key === reportKey);
  const filters = entry?.filters ?? ['from', 'to'];
  const r = q.data;
  const formats = cat.data?.export && maySave && pms.may('pms.reports.export') ? cat.data.formats.filter((x): x is (typeof PMS_EXPORT_FORMATS)[number] => (PMS_EXPORT_FORMATS as readonly string[]).includes(x)) : [];

  const exportAs = async (format: string) => {
    setBusy(format);
    setError(null);
    try {
      const kept = await pmsDownload(
        { kind: 'report', property: pid, report: reportKey, format: format as (typeof PMS_EXPORT_FORMATS)[number], query: query as Record<string, string> },
        `${reportKey}-${asked.from}${asked.to && asked.to !== asked.from ? `-to-${asked.to}` : ''}.${format}`,
      );
      toast('success', `Saving ${kept} to your downloads folder.`);
    } catch (e) {
      setError(errorText(e, 'The export could not be made.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title={r?.title ?? entry?.title ?? 'Report'} sub={r ? `${r.property} · ${r.period.from ? `${day(r.period.from)} – ` : ''}${day(r.period.to)} · made ${stamp(r.generated_at)}` : undefined}>
        <Button variant="ghost" icon="back" onClick={() => pms.go('reports')}>
          Reports
        </Button>
        {formats.map((fmt) => (
          <Button key={fmt} icon="download" loading={busy === fmt} disabled={busy !== null} onClick={() => void exportAs(fmt)}>
            {fmt.toUpperCase()}
          </Button>
        ))}
      </PageHead>
      <form
        className="flex flex-wrap items-end gap-2 text-[12.5px]"
        onSubmit={(e) => {
          e.preventDefault();
          setAsked(f);
        }}
      >
        {filters.includes('from') ? (
          <label className="flex flex-col gap-1">
            From
            <input aria-label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={`${input} w-40`} />
          </label>
        ) : null}
        {filters.includes('to') ? (
          <label className="flex flex-col gap-1">
            To
            <input aria-label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={`${input} w-40`} />
          </label>
        ) : null}
        {filters.includes('room_type_id') ? (
          <label className="flex flex-col gap-1">
            Room type
            <Select aria-label="Room type" value={f.room_type_id} options={[{ value: '', label: 'All' }, ...(types.data?.items ?? []).map((t) => ({ value: String(t.id), label: t.name }))]} onChange={(e) => setF({ ...f, room_type_id: e.target.value })} className={`${input} w-44`} />
          </label>
        ) : null}
        {filters.includes('source_id') ? (
          <label className="flex flex-col gap-1">
            Source
            <Select aria-label="Source" value={f.source_id} options={[{ value: '', label: 'All' }, ...pms.options.sources.map((s) => ({ value: String(s.id), label: s.name }))]} onChange={(e) => setF({ ...f, source_id: e.target.value })} className={`${input} w-44`} />
          </label>
        ) : null}
        {filters.includes('rate_plan_id') ? (
          <label className="flex flex-col gap-1">
            Rate plan
            <Select aria-label="Rate plan" value={f.rate_plan_id} options={[{ value: '', label: 'All' }, ...(plans.data?.items ?? []).map((p) => ({ value: String(p.id), label: p.name }))]} onChange={(e) => setF({ ...f, rate_plan_id: e.target.value })} className={`${input} w-44`} />
          </label>
        ) : null}
        <Button variant="primary" type="submit">
          Run
        </Button>
      </form>
      {error ? <Refusal text={error} /> : null}
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !r ? (
        <ErrorNote error={q.error ?? new Error('The report could not be run.')} onRetry={() => void q.refetch()} />
      ) : r.rows.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <table className="w-full text-[13px]" style={{ minWidth: Math.max(560, r.columns.length * 110) }}>
            <thead className="bg-subtle text-left text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <tr>
                {r.columns.map((c) => (
                  <th key={c.key} className={cx('px-3 py-2', NUMERIC.includes(c.type) && 'text-right')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {r.columns.map((c) => (
                    <td key={c.key} className={cx('px-3 py-1.5', NUMERIC.includes(c.type) && 'text-right tabular-nums')}>
                      {cell(c, row[c.key], r.currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {r.totals ? (
              <tfoot className="border-t-2 border-line font-semibold">
                <tr>
                  {r.columns.map((c, i) => (
                    <td key={c.key} className={cx('px-3 py-1.5', NUMERIC.includes(c.type) && 'text-right tabular-nums')}>
                      {r.totals![c.key] !== undefined ? cell(c, r.totals![c.key], r.currency) : i === 0 ? 'Total' : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </div>
  );
}
