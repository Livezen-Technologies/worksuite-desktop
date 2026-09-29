import { dateLabel, timeLabel } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { Panel } from '../../hr/parts';
import { amount, distance, fuelMark } from '../api';
import { Pill, when } from '../parts';
import type { JobTabProps } from '../registry';

/**
 * The job at a glance (§13 Overview): what the customer asked for and
 * complained of, what diagnosis found so far, the dates, and — for those who
 * may see money — the totals as the server worked them out.
 */
const stamp = (s: string | null | undefined) => (s ? `${dateLabel(s)} ${timeLabel(s)}` : '—');

export default function Overview({ job, company, options }: JobTabProps) {
  const unit = company?.distance_unit ?? 'km';
  const fuel = fuelMark(job.fuel_level, options.checkin.fuel_marks);
  const history = [...job.status_history].reverse().slice(0, 8);
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel title="The request">
        <div className="flex flex-col gap-2 px-3.5 py-3 text-[13px]">
          <p className="m-0 whitespace-pre-wrap text-ink">{job.requested_work || job.service_type?.name || <span className="text-ink-3">Nothing written down yet.</span>}</p>
          {job.checkin.complaints.length ? (
            <ul className="m-0 flex flex-col gap-0.5 pl-5 text-ink-2">
              {job.checkin.complaints.map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
            </ul>
          ) : null}
          {job.notes ? <p className="m-0 rounded-[8px] bg-subtle px-2.5 py-1.5 text-[12.5px] whitespace-pre-wrap text-ink-2">{job.notes}</p> : null}
        </div>
      </Panel>
      <Panel title="Dates and readings">
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5 px-3.5 py-3 text-[12.5px]">
          {(
            [
              ['Opened', stamp(job.created_at)],
              ['Checked in', stamp(job.checkin_at)],
              ['Work started', stamp(job.started_at)],
              ['Promised', when(job.target_completion_at) || '—'],
              ['Completed', stamp(job.completed_at)],
              ['Source', options.sources[job.source] ?? job.source],
              ['Odometer in', job.odometer_in !== null ? distance(job.odometer_in, unit) : '—'],
              ['Fuel in', fuel ? `${fuel}` : '—'],
            ] as Array<[string, string]>
          ).map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-[11.5px] text-ink-3">{k}</dt>
              <dd className="m-0 font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel title="Diagnosis" sub={job.diagnostics.length ? `${job.diagnostics.filter((x) => x.status === 'open').length} open` : 'From the complaints at check-in'}>
        {job.diagnostics.length ? (
          job.diagnostics.map((x) => (
            <div key={x.id} className="flex items-start gap-2 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <Icon name={x.status === 'open' ? 'stethoscope' : 'check-circle'} size={15} className={x.status === 'open' ? 'mt-px text-ink-3' : 'mt-px text-success'} />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-ink">{x.complaint ?? 'Finding'}</b>
                {x.finding ? <span className="text-ink-2">{x.finding}</span> : <span className="text-ink-3">Not diagnosed yet.</span>}
              </span>
              <Pill tone={x.status === 'open' ? 'amber' : 'green'}>{x.status === 'open' ? 'Open' : 'Resolved'}</Pill>
            </div>
          ))
        ) : (
          <div className="px-3.5 py-4 text-[12.5px] text-ink-3">Nothing yet — complaints become diagnostic items when the vehicle is checked in.</div>
        )}
      </Panel>
      {job.totals ? (
        <Panel title="Totals" sub="As WorkSuite worked them out">
          <dl className="m-0 grid grid-cols-3 gap-x-4 px-3.5 py-3 text-[12.5px]">
            {(
              [
                ['Estimate', job.totals.estimate],
                ['Approved', job.totals.approved],
                ['Final', job.totals.final],
              ] as Array<[string, string | null]>
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className="text-[11.5px] text-ink-3">{k}</dt>
                <dd className="m-0 font-bold text-ink tabular-nums">{amount(v, job.currency)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ) : null}
      <Panel title="Status history" className="xl:col-span-2">
        {history.map((h, i) => (
          <div key={`${h.at}-${i}`} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
            <span className="w-[130px] shrink-0 text-ink-3">{stamp(h.at)}</span>
            <b className="text-ink">{h.label}</b>
            <span className="min-w-0 flex-1 truncate text-ink-2">{[h.reason, h.waiting_reason ? `waiting: ${options.waiting_reasons[h.waiting_reason] ?? h.waiting_reason}` : null].filter(Boolean).join(' · ')}</span>
            <span className="shrink-0 text-ink-3">{h.by?.name ?? ''}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
