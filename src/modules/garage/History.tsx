import { dateLabel } from '../../core/time';
import { cx } from '../../components/ui';
import { amount, distance, type Options } from './api';
import { invoiceLine, peopleOf, type HistoryLike, type HistoryTotals } from './api-b3';

/**
 * Service history (SRS §11.3, FR-HIS-01..02), stage B3's rows: each completed
 * job with what was reported, the approved work, the parts used, who did it,
 * the labour hours and the invoice (amounts only for those who may see money)
 * — newest first, as the server sends them. Totals per currency are Billing's
 * figures, shown when the server gives them. A stage-A row (no repairs, no
 * parts, technicians as names) reads the same with those columns empty.
 */
export function ServiceHistory({ rows, totals, unit, options, onJob, showVehicle = false, empty = 'No service recorded yet.' }: { rows: HistoryLike[]; totals?: HistoryTotals[] | null; unit: string; options: Options; onJob: (id: number) => void; showVehicle?: boolean; empty?: string }) {
  return (
    <section aria-label="Service history" className="overflow-hidden rounded-[12px] border border-line bg-surface">
      {totals?.length ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-3.5 py-2 text-[12.5px]">
          {totals.map((t) => (
            <span key={t.currency} className="text-ink-2">
              {t.jobs} {t.jobs === 1 ? 'job' : 'jobs'} · invoiced <b className="text-ink tabular-nums">{amount(t.invoiced, t.currency)}</b> · paid <b className="text-ink tabular-nums">{amount(t.paid, t.currency)}</b>
            </span>
          ))}
        </div>
      ) : null}
      {rows.map((h) => {
        const kind = h.service_type ?? (h.job_type ? (options.job_types[h.job_type] ?? h.job_type) : null);
        const odo = h.odometer_out && h.odometer_out !== h.odometer ? `${distance(h.odometer ?? null, unit)} → ${distance(h.odometer_out, unit)}` : distance(h.odometer ?? null, unit);
        const who = peopleOf(h.technicians);
        const inv = invoiceLine(h.invoice ?? null, amount);
        return (
          <button key={h.job_id} type="button" onClick={() => onJob(h.job_id)} className="flex w-full flex-col gap-0.5 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
            <span className="flex flex-wrap items-center gap-x-2.5">
              <b className="w-[92px] shrink-0 text-ink tabular-nums">{dateLabel(h.date ?? null) || '—'}</b>
              <b className="text-primary">{h.number}</b>
              {showVehicle && h.vehicle ? <span className="font-semibold text-ink">{h.vehicle.vehicle_number}</span> : null}
              <span className="text-ink-2">{[kind, odo].filter(Boolean).join(' · ')}</span>
              <span className="flex-1" />
              {inv ? <span className={cx('text-ink-3', h.invoice?.outstanding !== undefined && Number(h.invoice.outstanding) > 0 && 'text-warning')}>{inv}</span> : null}
            </span>
            {h.complaints?.length ? <span className="truncate text-ink-2">Reported: {h.complaints.join('; ')}</span> : null}
            {h.repairs?.length ? <span className="truncate text-ink-2">Work: {h.repairs.map((r) => r.description).join('; ')}</span> : null}
            {h.parts?.length ? <span className="truncate text-ink-2">Parts: {h.parts.map((p) => `${p.name} × ${p.qty}${p.serial_no ? ` (${p.serial_no})` : ''}`).join('; ')}</span> : null}
            {who || h.labour_hours ? <span className="truncate text-ink-3">{[who, h.labour_hours ? `${h.labour_hours} h labour` : null].filter(Boolean).join(' · ')}</span> : null}
          </button>
        );
      })}
      {!rows.length ? <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-3">{empty}</div> : null}
    </section>
  );
}
