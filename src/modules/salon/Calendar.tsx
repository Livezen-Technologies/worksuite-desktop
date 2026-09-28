import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Chip, Empty, IconButton, Modal, Spinner } from '../../components/ui';
import { addDays, clockAt, fetchCalendar, K, longDay, minutesOf, owing, todayAt, type CalendarDay, type Visit } from './api';
import { calendarFromCopy, copyAge, copyHolds, unreachable } from './offline';
import { AllergyChip, Failed, Note, servicesOf, stylistsOf, useDesk, useNow } from './parts';

/**
 * The day by stylist (D03): each stylist's working hours, and every booking
 * as a block to press — check in, or open the client. Drawn on the salon's
 * clock, from the location's opening hours widened to fit every booking.
 * With WorkSuite out of reach, a day the copy holds is drawn from it.
 */
const PX_PER_MIN = 1.4;

export function dayWindow(day: CalendarDay | undefined, date: string): [number, number] {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const hours = (day?.hours ?? []).filter((h) => Number(h.weekday) === weekday);
  let a = Math.min(...hours.map((h) => minutesOf(h.opens)), 9 * 60);
  let b = Math.max(...hours.map((h) => minutesOf(h.closes)), 19 * 60);
  for (const v of day?.visits ?? []) {
    if (v.status === 'cancelled') continue;
    for (const i of v.items) {
      a = Math.min(a, minutesOf(i.start));
      b = Math.max(b, minutesOf(i.end) || 24 * 60);
    }
  }
  return [Math.floor(a / 60) * 60, Math.min(24 * 60, Math.ceil(b / 60) * 60)];
}

export default function Calendar() {
  const desk = useDesk();
  const tz = desk.location.timezone;
  const clock = useNow(60_000);
  const today = todayAt(tz, new Date(clock));
  const date = desk.params.get('date') ?? today;
  const [open, setOpen] = useState<Visit | null>(null);
  const live0 = useQuery({ queryKey: K.calendar(desk.location.id, date), queryFn: ({ signal }) => fetchCalendar(desk.location.id, date, signal), refetchInterval: 60_000, retry: desk.offline ? false : undefined });
  const offline = desk.offline || unreachable(live0);
  const copied = offline && desk.copy && copyHolds(desk.copy, date, clock) ? calendarFromCopy(desk.copy, date) : null;
  const q = { data: copied ?? (offline ? undefined : live0.data), isError: !copied && live0.isError, refetch: live0.refetch };
  const [start, end] = useMemo(() => dayWindow(q.data, date), [q.data, date]);
  const hours = Array.from({ length: (end - start) / 60 }, (_, i) => start + i * 60);
  const y = (m: number) => (m - start) * PX_PER_MIN;
  const nowMin = date === today ? minutesOf(clockAt(new Date(clock).toISOString(), tz)) : null;
  const live = (q.data?.visits ?? []).filter((v) => v.status !== 'cancelled');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => desk.go('calendar')}>Today</Button>
        <IconButton icon="chevron-left" label="The day before" onClick={() => desk.go('calendar', { date: addDays(date, -1) })} />
        <IconButton icon="chevron-right" label="The day after" onClick={() => desk.go('calendar', { date: addDays(date, 1) })} />
        <h1 className="text-[18px] font-extrabold text-ink">{longDay(date)}</h1>
        <div className="flex-1" />
        {desk.may('salon.visit.book') ? (
          <>
            <Button onClick={() => desk.walkIn({})}>Walk-in</Button>
            <Button variant="primary" onClick={() => desk.walkIn({ date }, true)}>
              New booking
            </Button>
          </>
        ) : null}
      </div>

      {copied ? <Note tone="muted">From this desk’s copy, taken at {copyAge(desk.copy, tz)} — stylists’ own hours and time off show when WorkSuite answers.</Note> : null}
      {offline && !copied ? (
        <Note tone="warning">WorkSuite cannot be reached, and this desk’s copy does not hold {longDay(date)}.</Note>
      ) : q.isError ? (
        <Failed text="The day could not be loaded." onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Spinner label="Loading the day…" />
      ) : q.data.stylists.length === 0 ? (
        <Empty icon="users" title="No stylist works here that day." />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-[12px] border border-line bg-surface scroll-thin">
          <div className="flex min-w-max">
            <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-line bg-surface">
              <div className="h-11 border-b border-line" />
              <div className="relative" style={{ height: y(end) }}>
                {hours.map((h) => (
                  <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-ink-3 tabular-nums" style={{ top: y(h) }}>
                    {String(Math.floor(h / 60)).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
            </div>
            {q.data.stylists.map((s) => {
              const mine = live.filter((v) => v.items.some((i) => i.provider_id === s.id));
              return (
                <div key={s.id} className="w-[180px] shrink-0 border-r border-line last:border-r-0">
                  <div className="flex h-11 items-center gap-2 border-b border-line px-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? 'var(--color-primary)' }} />
                    <span className="truncate text-[13px] font-bold text-ink">{s.name}</span>
                  </div>
                  <div className="relative bg-subtle/60" style={{ height: y(end) }}>
                    {s.working.map(([a, b], i) => {
                      const from = minutesOf(clockAt(a, tz));
                      const to = minutesOf(clockAt(b, tz)) || 24 * 60;
                      return <div key={i} className="absolute inset-x-0 bg-surface" style={{ top: y(from), height: (to - from) * PX_PER_MIN }} />;
                    })}
                    {hours.map((h) => (
                      <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: y(h) }} />
                    ))}
                    {mine.flatMap((v) =>
                      v.items
                        .filter((i) => i.provider_id === s.id)
                        .map((i) => {
                          const from = minutesOf(i.start);
                          const to = minutesOf(i.end) || from + i.duration_min;
                          return (
                            <button
                              key={`${v.id}-${i.appointment_id}`}
                              type="button"
                              onClick={() => setOpen(v)}
                              className="absolute inset-x-1 overflow-hidden rounded-[8px] border border-primary/30 bg-selection px-2 py-1 text-left hover:border-primary"
                              style={{ top: y(from) + 1, height: Math.max(22, (to - from) * PX_PER_MIN - 2) }}
                              title={`${i.start}–${i.end} · ${v.client.name} · ${i.service}`}
                            >
                              <div className="truncate text-[12px] font-bold text-ink">{v.client.name}</div>
                              <div className="truncate text-[11px] text-ink-2">
                                {i.start} · {i.service}
                              </div>
                            </button>
                          );
                        }),
                    )}
                    {nowMin !== null && nowMin >= start && nowMin <= end ? <div className="absolute inset-x-0 h-0.5 bg-danger" style={{ top: y(nowMin) }} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {open ? <VisitActions visit={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function VisitActions({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const desk = useDesk();
  const canCheckIn = (visit.status === 'pending' || visit.status === 'confirmed') && desk.may('salon.visit.checkin');
  const canPay = ((['checked_in', 'in_service', 'completed'].includes(visit.status) && !visit.checked_out) || owing(visit)) && desk.may('salon.checkout') && !desk.offline;

  return (
    <Modal
      title={`${visit.client.name} · ${visit.start}`}
      onClose={onClose}
      footer={
        <>
          <Button
            onClick={() => {
              onClose();
              desk.go('clients', { client: visit.client.id });
            }}
          >
            Open the client
          </Button>
          {canPay ? (
            <Button
              variant="primary"
              icon="banknote"
              onClick={() => {
                onClose();
                desk.go('pay', { visit: visit.id });
              }}
            >
              {owing(visit) ? 'Take the rest' : 'Take payment'}
            </Button>
          ) : null}
          {canCheckIn ? (
            <Button
              variant="primary"
              icon="check-circle"
              onClick={() => {
                onClose();
                desk.checkIn(visit);
              }}
            >
              Check in
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[13.5px] text-ink">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="indigo">{visit.status_label}</Chip>
          <span className="text-ink-2">{visit.number}</span>
          {visit.client.allergy ? <AllergyChip allergy={visit.client.allergy} /> : null}
        </div>
        <div>{servicesOf(visit)}</div>
        <div className="text-ink-2">
          {visit.start}–{visit.end} · {stylistsOf(visit)}
        </div>
      </div>
    </Modal>
  );
}
