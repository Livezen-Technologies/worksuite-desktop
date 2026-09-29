import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { addDays, currentZone, dayLabel, timeLabel, todayInZone } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../../components/ui';
import { btnSmall, PageHead, Panel } from '../../hr/parts';
import { canAny, OFFLINE_WRITE, refusalOf } from '../api';
import { fetchCalendar, KB2, releaseBooking, type Booking } from '../api-b2';
import type { GarageViewProps } from '../registry';

/**
 * The workshop calendar (SRS §16.2, §28.7, FR-BAY-04), stage B2: one day, a
 * row per bay, each booking where it falls, and the work orders that have no
 * slot yet. A slot is booked from a work order's "Technicians and bay"; a
 * reserved one can be let go here. Times are on the reader's clock.
 */
const FROM = 7 * 60;
const TO = 20 * 60;

/** Minutes since midnight of an instant, on the reader's clock. */
export function minutesOfDay(iso: string, tz = currentZone()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n('hour') * 60 + n('minute');
}

/** Where a booking sits on the day's strip, as percentages; null when it is outside the hours shown. */
export function placeOf(b: Pick<Booking, 'starts_at' | 'ends_at'>, tz = currentZone()): { left: number; width: number } | null {
  const s = Math.max(FROM, minutesOfDay(b.starts_at, tz));
  const e = Math.min(TO, minutesOfDay(b.ends_at, tz) || TO);
  if (e <= s) return null;
  return { left: ((s - FROM) / (TO - FROM)) * 100, width: ((e - s) / (TO - FROM)) * 100 };
}

export default function Calendar({ org, options, online, onJob }: GarageViewProps) {
  const qc = useQueryClient();
  const [day, setDay] = useState(todayInZone);
  const q = useQuery({ queryKey: KB2.calendar(org, day, day), queryFn: ({ signal }) => fetchCalendar(org, day, day, signal), refetchInterval: 60_000, placeholderData: (p) => p });
  const mayBook = canAny(options, 'assign', org);
  const hours = Array.from({ length: (TO - FROM) / 60 + 1 }, (_, i) => FROM / 60 + i);
  const release = async (b: Booking) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    try {
      const r = await releaseBooking(b.id);
      toast('success', r.message || 'The slot is free again.');
      void qc.invalidateQueries({ queryKey: ['garage'] });
    } catch (e) {
      toast('error', refusalOf(e).message);
    }
  };
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Workshop calendar" sub={dayLabel(day)}>
        <button type="button" aria-label="The day before" className={btnSmall} onClick={() => setDay((d) => addDays(d, -1))}>
          <Icon name="chevron-left" size={14} />
        </button>
        <button type="button" className={btnSmall} onClick={() => setDay(todayInZone())}>
          Today
        </button>
        <button type="button" aria-label="The day after" className={btnSmall} onClick={() => setDay((d) => addDays(d, 1))}>
          <Icon name="chevron-right" size={14} />
        </button>
      </PageHead>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <section aria-label="Bays" className="overflow-x-auto rounded-[12px] border border-line bg-surface scroll-thin">
          <div className="min-w-[900px]">
            <div className="flex border-b border-line text-[11px] text-ink-3">
              <span className="w-[120px] shrink-0 px-3 py-1.5 font-bold uppercase">Bay</span>
              <div className="relative h-7 flex-1">
                {hours.map((h) => (
                  <span key={h} className="absolute top-1.5 -translate-x-1/2" style={{ left: `${((h * 60 - FROM) / (TO - FROM)) * 100}%` }}>
                    {String(h).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
            </div>
            {q.data.bays.map((bay) => (
              <div key={bay.id} className="flex border-b border-line/70 last:border-b-0">
                <span className="flex w-[120px] shrink-0 flex-col px-3 py-2 text-[12px]">
                  <b className="text-ink">{bay.code}</b>
                  <span className="text-ink-3">{bay.status_label}</span>
                </span>
                <div className="relative h-14 flex-1">
                  {bay.bookings.map((b) => {
                    const at = placeOf(b);
                    if (!at) return null;
                    return (
                      <div key={b.id} className={cx('absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-hidden rounded-[7px] px-1.5 text-[11px] font-semibold', b.status === 'active' ? 'bg-primary text-white' : b.status === 'reschedule' ? 'bg-danger-bg text-danger' : 'bg-selection text-primary')} style={{ left: `${at.left}%`, width: `${at.width}%` }} title={`${timeLabel(b.starts_at)}–${timeLabel(b.ends_at)} ${b.status_label}${b.note ? ` · ${b.note}` : ''}`}>
                        {b.job && !b.busy_only ? (
                          <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onJob(b.job!.id)}>
                            {b.job.number} {b.work_order ? `· ${b.work_order.code}` : ''}
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">Booked</span>
                        )}
                        {mayBook && (b.status === 'reserved' || b.status === 'reschedule') && !b.busy_only ? (
                          <button type="button" aria-label="Let the slot go" className="shrink-0 opacity-70 hover:opacity-100" onClick={() => void release(b)}>
                            <Icon name="x" size={11} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {!q.data.bays.length ? <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-3">No bays set up.</div> : null}
          </div>
        </section>
      ) : null}
      {q.data?.unscheduled.length ? (
        <Panel title="Not booked yet" sub="Work orders with no slot — give them one from their Technicians and bay">
          {q.data.unscheduled.map((w) => (
            <button key={w.id} type="button" onClick={() => onJob(w.job_id)} className="flex w-full items-center gap-2 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
              <b className="text-ink">{w.code}</b>
              <span className="min-w-0 flex-1 truncate text-ink-2">{w.work_type}</span>
              <span className="text-ink-3">{w.status_label}</span>
            </button>
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
