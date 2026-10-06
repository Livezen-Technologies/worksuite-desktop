import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Empty, Modal, Spinner, cx } from '../../components/ui';
import { addDays, amount, clockAt, dayMonth, fetchCalendar, fetchVisitRange, K, longDay, minutesOf, owing, todayAt, weekOf, type CalendarDay, type Visit, type VisitFilter, type VisitItem } from './api';
import { calendarFromCopy, copyAge, copyHolds, unreachable, visitsOf } from './offline';
import { AllergyChip, Failed, firstName, Note, Segmented, servicesOf, stylistsOf, Tag, TouchButton, useDesk, useNow, Who } from './parts';

/**
 * The day by stylist (D03): each stylist's working hours, and every booking
 * as a block to press — check in, take a deposit, take payment, record the
 * service, or open the client. Drawn on the salon's clock, from the
 * location's opening hours widened to fit every booking; time a stylist is
 * not working — leave approved in HR, a block-out — is hatched and not
 * bookable. With WorkSuite out of reach, a day the copy holds is drawn from it.
 */
const HOUR_PX = 64;
const PX_PER_MIN = HOUR_PX / 60;

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

/** The location's open hours that day, on its clock, when it gives them. */
function openHours(day: CalendarDay | undefined, date: string): [number, number] | null {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const h = (day?.hours ?? []).filter((x) => Number(x.weekday) === weekday);
  if (h.length === 0) return null;
  return [Math.min(...h.map((x) => minutesOf(x.opens))), Math.max(...h.map((x) => minutesOf(x.closes)))];
}

/** Spans of [from, to] not covered by any of `spans` (minutes past midnight). */
export function gaps(from: number, to: number, spans: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = from;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (b <= at) continue;
    if (a > at) out.push([at, Math.min(a, to)]);
    at = Math.max(at, b);
    if (at >= to) break;
  }
  if (at < to) out.push([at, to]);
  return out.filter(([a, b]) => b - a >= 15);
}

type Tone = 'done' | 'service' | 'confirmed' | 'pending' | 'late' | 'off';

const TONES: Record<Tone, { cls: string; line: string }> = {
  done: { cls: 'bg-[#F8FAFC] text-[#334155] dark:bg-subtle dark:text-ink-2', line: '#94A3B8' },
  service: { cls: 'bg-[#F0FDFA] text-[#134E4A] dark:bg-[#0D2F2C] dark:text-[#5EEAD4]', line: '#14B8A6' },
  confirmed: { cls: 'bg-[#EFF6FF] text-[#1E3A8A] dark:bg-[#172554] dark:text-[#BFDBFE]', line: '#3B82F6' },
  pending: { cls: 'bg-[#FFFBEB] text-[#92400E] dark:bg-[#36240F] dark:text-[#FCD34D]', line: '#F59E0B' },
  late: { cls: 'bg-[#FFF1F2] text-[#881337] dark:bg-[#3A1614] dark:text-[#FDA4AF]', line: '#F43F5E' },
  off: { cls: 'bg-surface text-[#94A3B8] dark:text-ink-3', line: '#CBD5E1' },
};

/** How a booking reads on the day: done, in the chair, confirmed, waiting to be confirmed, late, or off. */
export function toneOf(item: Pick<VisitItem, 'status' | 'starts_at'>, now: number, isToday: boolean): Tone {
  if (item.status === 'cancelled' || item.status === 'no_show') return 'off';
  if (item.status === 'completed') return 'done';
  if (item.status === 'checked_in' || item.status === 'in_service') return 'service';
  if (isToday && Date.parse(item.starts_at) < now - 5 * 60_000) return 'late';
  return item.status === 'pending' ? 'pending' : 'confirmed';
}

type Mode = 'day' | 'week' | 'list';

export default function Calendar() {
  const desk = useDesk();
  const tz = desk.location.timezone;
  const clock = useNow(60_000);
  const today = todayAt(tz, new Date(clock));
  const date = desk.params.get('date') ?? today;
  const raw = desk.params.get('mode');
  const mode: Mode = raw === 'week' || raw === 'list' ? raw : 'day';
  const [open, setOpen] = useState<Visit | null>(null);
  const book = desk.may('salon.visit.book');
  const step = mode === 'day' ? 1 : 7;
  const from = weekOf(date);
  const go = (d: string | null, m: Mode = mode) => desk.go('calendar', { date: d, mode: m === 'day' ? null : m });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <TouchButton className="w-12 px-0" aria-label={mode === 'day' ? 'The day before' : 'The week before'} onClick={() => go(addDays(date, -step))}>
          <Icon name="chevron-left" size={20} />
        </TouchButton>
        <TouchButton onClick={() => go(null)}>Today</TouchButton>
        <TouchButton className="w-12 px-0" aria-label={mode === 'day' ? 'The day after' : 'The week after'} onClick={() => go(addDays(date, step))}>
          <Icon name="chevron-right" size={20} />
        </TouchButton>
        <h1 className="ml-1.5 text-[20px] font-extrabold text-ink">{mode === 'day' ? longDay(date).replace(/ \d{4}$/, '') : weekTitle(from)}</h1>
        <div className="w-[264px]">
          <Segmented
            label="Calendar view"
            value={mode}
            onChange={(m) => go(date, m)}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
              { value: 'list', label: 'List' },
            ]}
          />
        </div>
        <div className="flex-1" />
        {book ? (
          <>
            <TouchButton icon="door" onClick={() => desk.walkIn({})}>
              Walk-in
            </TouchButton>
            <TouchButton variant="primary" icon="plus" onClick={() => desk.walkIn({ date }, true)}>
              New booking
            </TouchButton>
          </>
        ) : null}
      </div>

      {mode === 'day' ? (
        <DayView date={date} today={today} clock={clock} onOpen={setOpen} />
      ) : mode === 'week' ? (
        <WeekView from={from} today={today} clock={clock} onOpen={setOpen} onDay={(d) => go(d, 'day')} />
      ) : (
        <ListView from={from} today={today} clock={clock} onOpen={setOpen} />
      )}

      {open ? <VisitActions visit={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** "28 Sep – 04 Oct": a week, Monday to Sunday. */
export function weekTitle(from: string): string {
  return `${dayMonth(from, false)} – ${dayMonth(addDays(from, 6), false)}`;
}

function DayView({ date, today, clock, onOpen }: { date: string; today: string; clock: number; onOpen: (v: Visit) => void }) {
  const desk = useDesk();
  const tz = desk.location.timezone;
  const live0 = useQuery({ queryKey: K.calendar(desk.location.id, date), queryFn: ({ signal }) => fetchCalendar(desk.location.id, date, signal), refetchInterval: 60_000, retry: desk.offline ? false : undefined });
  const offline = desk.offline || unreachable(live0);
  const copied = offline && desk.copy && copyHolds(desk.copy, date, clock) ? calendarFromCopy(desk.copy, date) : null;
  const q = { data: copied ?? (offline ? undefined : live0.data), isError: !copied && live0.isError, refetch: live0.refetch };
  const [start, end] = useMemo(() => dayWindow(q.data, date), [q.data, date]);
  const opens = openHours(q.data, date) ?? [start, end];
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const y = (m: number) => (m - start) * PX_PER_MIN;
  const isToday = date === today;
  const nowMin = isToday ? minutesOf(clockAt(new Date(clock).toISOString(), tz)) : null;
  const visits = q.data?.visits ?? [];
  const book = desk.may('salon.visit.book');

  return (
    <>
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
        <div className="min-h-0 flex-1 overflow-auto rounded-[14px] border border-line bg-surface scroll-thin">
          <div className="flex min-w-max flex-col">
            <div className="sticky top-0 z-20 flex border-b border-line bg-[#F8FAFC] dark:bg-subtle">
              <div className="sticky left-0 z-10 w-14 shrink-0 bg-[#F8FAFC] dark:bg-subtle" />
              {q.data.stylists.map((s) => (
                <div key={s.id} className="flex w-[220px] min-w-[200px] flex-1 items-center gap-2 border-l border-line px-2.5 py-2">
                  <Who name={s.name} color={s.color} size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold text-ink">{s.name}</div>
                    {s.title ? <div className="truncate text-[11px] text-ink-3">{s.title}</div> : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="relative flex" style={{ height: y(end) + 8 }}>
              {/* The hours, and a faint line at each half. */}
              <div className="pointer-events-none absolute inset-0">
                {hours.map((h) => (
                  <div key={h}>
                    <div className="absolute inset-x-0 border-t border-line" style={{ top: y(h) }} />
                    {h < end ? <div className="absolute right-0 left-14 border-t border-dashed border-line/60" style={{ top: y(h + 30) }} /> : null}
                  </div>
                ))}
              </div>
              <div className="sticky left-0 z-10 w-14 shrink-0 bg-surface">
                {hours.map((h, i) => (
                  <div key={h} className="absolute left-1.5 text-[11px] text-ink-3 tabular-nums" style={{ top: i === 0 ? 2 : y(h) - 7 }}>
                    {String(Math.floor(h / 60)).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
              {q.data.stylists.map((s) => {
                const working = s.working.map(([a, b]) => [minutesOf(clockAt(a, tz)), minutesOf(clockAt(b, tz)) || 24 * 60] as [number, number]);
                const off = gaps(opens[0], opens[1], working);
                const onLeave = (s.leave ?? []).length > 0;
                const items = visits.flatMap((v) => v.items.filter((i) => i.provider_id === s.id).map((i) => ({ v, i })));
                /* A tap on free time books it (CAL-04): that stylist, that day, the quarter hour tapped — still checked by the server. */
                const tap = (e: MouseEvent<HTMLDivElement>) => {
                  if (e.target !== e.currentTarget || !book) return;
                  const m = start + Math.floor((e.nativeEvent.offsetY / PX_PER_MIN) / 15) * 15;
                  if (!working.some(([a, b]) => m >= a && m < b)) return;
                  if (isToday && nowMin !== null && m < nowMin) return;
                  desk.walkIn({ provider_id: s.id, date, time: hm(m) }, true);
                };
                return (
                  <div key={s.id} onClick={tap} title={book ? `Tap a free time to book ${s.name}` : undefined} className={cx('relative w-[220px] min-w-[200px] flex-1 border-l border-line', book && 'cursor-copy')}>
                    {off.map(([a, b]) => {
                      const block = (s.blocks ?? []).find((x) => minutesOf(clockAt(x.starts_at, tz)) < b && (minutesOf(clockAt(x.ends_at, tz)) || 24 * 60) > a);
                      const first = a > opens[0];
                      return (
                        <div
                          key={a}
                          className="absolute inset-x-[3px] overflow-hidden rounded-[8px] border border-line px-2 py-1.5 text-[12px] text-[#475569] dark:text-ink-2"
                          style={{ top: y(a) + 1, height: (b - a) * PX_PER_MIN - 2, background: 'repeating-linear-gradient(135deg, var(--ws-subtle), var(--ws-subtle) 6px, var(--ws-surface) 6px, var(--ws-surface) 12px)' }}
                        >
                          {onLeave ? (
                            <>
                              <b>{first ? `On leave from ${hm(a)}` : `On leave until ${hm(b)}`}</b>
                              <br />
                              Approved in HR · not bookable
                            </>
                          ) : block ? (
                            <>
                              <b>Blocked{first ? ` from ${hm(a)}` : ''}</b>
                              <br />
                              {block.reason || 'Not bookable'}
                            </>
                          ) : b - a >= 45 ? (
                            <b>Not working</b>
                          ) : null}
                        </div>
                      );
                    })}
                    {items.map(({ v, i }) => (
                      <Block key={`${v.id}-${i.appointment_id}`} visit={v} item={i} top={y(minutesOf(i.start))} height={((minutesOf(i.end) || minutesOf(i.start) + i.duration_min) - minutesOf(i.start)) * PX_PER_MIN} tone={toneOf(i, clock, isToday)} onOpen={() => onOpen(v)} />
                    ))}
                  </div>
                );
              })}
              {nowMin !== null && nowMin >= start && nowMin <= end ? (
                <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: y(nowMin) }}>
                  <div className="absolute right-0 left-[50px] border-t-2 border-[#E11D48]" />
                  <span className="absolute left-1 -translate-y-1/2 rounded-[4px] bg-[#E11D48] px-1 py-0.5 text-[10px] font-bold text-white tabular-nums">{hm(nowMin)}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Whether a visit is one a filter keeps — the server's rules, for the desk's copy. */
export function visitMatches(v: Visit, f: VisitFilter): boolean {
  if (f.stylist && !v.items.some((i) => i.provider_id === f.stylist)) return false;
  if (f.status && !f.status.split(',').includes(v.status)) return false;
  if (f.allergy && !v.client.allergy) return false;
  const term = f.q?.trim().toLowerCase();
  if (term && ![v.number, v.client.name, v.client.phone ?? ''].some((s) => s.toLowerCase().includes(term))) return false;
  return true;
}

/** A week of the book from WorkSuite, or from the desk's copy for the days it holds. */
function useRange(from: string, to: string, f: VisitFilter, clock: number) {
  const desk = useDesk();
  const live = useQuery({
    queryKey: K.range(desk.location.id, from, to, JSON.stringify(f)),
    queryFn: ({ signal }) => fetchVisitRange(desk.location.id, from, to, f, signal),
    refetchInterval: 60_000,
    retry: desk.offline ? false : undefined,
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  if ((desk.offline || unreachable(live)) && desk.copy) {
    const copy = desk.copy;
    return {
      days,
      visits: visitsOf(copy).filter((v) => v.date >= from && v.date <= to && visitMatches(v, f)),
      held: new Set(days.filter((d) => copyHolds(copy, d, clock))),
      copied: true,
      live,
    };
  }
  return { days, visits: live.data, held: null, copied: false, live };
}

const ACTIVE = (v: Visit) => v.status !== 'cancelled' && v.status !== 'no_show';

function RangeState({ r, label }: { r: ReturnType<typeof useRange>; label: string }) {
  const desk = useDesk();
  if (r.copied) return <Note tone="muted">From this desk’s copy, taken at {copyAge(desk.copy, desk.location.timezone) ?? '—'}. Days it does not hold are marked.</Note>;
  if (desk.offline || unreachable(r.live)) return <Note tone="warning">WorkSuite cannot be reached, and this desk has no copy of the book.</Note>;
  if (r.live.isError) return <Failed text={`The ${label} could not be loaded.`} onRetry={() => void r.live.refetch()} />;
  if (!r.visits) return <Spinner label={`Loading the ${label}…`} />;
  return null;
}

/** Monday to Sunday, a column a day: every booking in time order. A day's heading opens it by stylist. */
function WeekView({ from, today, clock, onOpen, onDay }: { from: string; today: string; clock: number; onOpen: (v: Visit) => void; onDay: (d: string) => void }) {
  const r = useRange(from, addDays(from, 6), {}, clock);
  const byDay = new Map<string, Visit[]>();
  for (const v of r.visits ?? []) byDay.set(v.date, [...(byDay.get(v.date) ?? []), v]);

  return (
    <>
      <RangeState r={r} label="week" />
      {r.visits ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-[14px] border border-line bg-surface scroll-thin">
          <div className="grid min-h-full min-w-[1050px] grid-cols-7">
            {r.days.map((d) => {
              const list = (byDay.get(d) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
              const isToday = d === today;
              const n = list.filter(ACTIVE).length;
              return (
                <div key={d} className="flex min-w-0 flex-col border-l border-line first:border-l-0">
                  <button
                    type="button"
                    onClick={() => onDay(d)}
                    title="Open this day by stylist"
                    className={cx('sticky top-0 z-10 flex min-h-12 items-center justify-between gap-2 border-b border-line px-3 text-left', isToday ? 'bg-selection' : 'bg-[#F8FAFC] hover:bg-subtle dark:bg-subtle')}
                  >
                    <span className={cx('text-[14px] font-bold', isToday ? 'text-primary' : 'text-ink')}>{weekdayLabel(d)}</span>
                    <span className="text-[12px] font-semibold text-ink-3 tabular-nums">{n === 0 ? '' : `${n} booked`}</span>
                  </button>
                  <div className="flex flex-col gap-1.5 p-1.5">
                    {r.held && !r.held.has(d) ? (
                      <div className="px-1.5 py-3 text-[12px] text-ink-3">Not in this desk’s copy</div>
                    ) : list.length === 0 ? (
                      <div className="px-1.5 py-3 text-[12px] text-ink-3">Nothing booked</div>
                    ) : (
                      list.map((v) => <WeekCard key={v.id} visit={v} tone={toneOf(v, clock, isToday)} onOpen={() => onOpen(v)} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** "Mon 28". */
function weekdayLabel(ymd: string): string {
  return `${new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${Number(ymd.slice(8, 10))}`;
}

function WeekCard({ visit, tone, onOpen }: { visit: Visit; tone: Tone; onOpen: () => void }) {
  const t = TONES[tone];
  const first = visit.items[0];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx('rounded-[8px] border border-l-4 px-2 py-1.5 text-left text-[12.5px] leading-snug hover:shadow-sm hover:brightness-[.98]', t.cls)}
      style={{ borderColor: `${t.line}33`, borderLeftColor: t.line }}
      title={`${visit.start}–${visit.end} · ${visit.client.name} · ${servicesOf(visit)} · ${visit.status_label}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <b className="tabular-nums">{visit.start}</b>
        {first ? <Who name={first.provider} color={first.provider_color} size={18} /> : null}
        <span className="min-w-0 flex-1 truncate opacity-85">{first ? firstName(first.provider) : ''}</span>
        {visit.client.allergy ? <Icon name="warning" size={13} className="shrink-0 text-[#BE123C] dark:text-[#FDA4AF]" label="Allergy on file" /> : null}
        {visit.money.deposit_owed > 0 ? <Icon name="wallet" size={13} className="shrink-0 text-[#B45309] dark:text-warning" label="Deposit owed" /> : null}
      </div>
      <div className={cx('truncate font-bold', tone === 'off' && 'line-through')}>{visit.client.name}</div>
      <div className="truncate opacity-85">{servicesOf(visit)}</div>
    </button>
  );
}

const STATUS_FILTERS = {
  all: '',
  waiting: 'pending,confirmed',
  in: 'checked_in,in_service',
  done: 'completed',
  off: 'cancelled,no_show',
} as const;

/** The week as a list, day by day, narrowed by stylist, state, allergy or a name (CAL-02). */
function ListView({ from, today, clock, onOpen }: { from: string; today: string; clock: number; onOpen: (v: Visit) => void }) {
  const desk = useDesk();
  const [stylist, setStylist] = useState<number | null>(null);
  const [status, setStatus] = useState<keyof typeof STATUS_FILTERS>('all');
  const [allergy, setAllergy] = useState(false);
  const [q, setQ] = useState('');
  const term = useDeferredValue(q);
  const r = useRange(from, addDays(from, 6), { stylist, status: STATUS_FILTERS[status], allergy, q: term }, clock);
  const stylists = desk.options.stylists.filter((s) => s.active !== false && s.locations.includes(desk.location.id));
  const list = [...(r.visits ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const byDay = r.days.map((d) => ({ d, visits: list.filter((v) => v.date === d) })).filter((g) => g.visits.length > 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-12 min-w-[240px] flex-1 items-center gap-2 rounded-[12px] border border-line bg-surface px-3.5 focus-within:border-primary">
          <Icon name="search" size={18} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, mobile or visit number" aria-label="Search the week" className="bare-focus min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        <select
          aria-label="Stylist"
          value={stylist ?? ''}
          onChange={(e) => setStylist(e.target.value ? Number(e.target.value) : null)}
          className="h-12 rounded-[12px] border border-line bg-surface px-3 text-[15px] text-ink"
        >
          <option value="">Every stylist</option>
          {stylists.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="State" value={status} onChange={(e) => setStatus(e.target.value as keyof typeof STATUS_FILTERS)} className="h-12 rounded-[12px] border border-line bg-surface px-3 text-[15px] text-ink">
          <option value="all">Every state</option>
          <option value="waiting">Still to come</option>
          <option value="in">In the salon</option>
          <option value="done">Done</option>
          <option value="off">Cancelled or no-show</option>
        </select>
        <TouchButton variant={allergy ? 'primary' : 'secondary'} icon="warning" aria-pressed={allergy} onClick={() => setAllergy(!allergy)}>
          Allergy on file
        </TouchButton>
      </div>

      <RangeState r={r} label="week" />
      {r.visits ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-[14px] border border-line bg-surface scroll-thin">
          {byDay.length === 0 ? (
            <Empty icon="calendar" title="Nothing booked that matches." hint="Change the filters, or move to another week." />
          ) : (
            byDay.map(({ d, visits }) => (
              <section key={d}>
                <h2 className={cx('sticky top-0 z-10 flex items-baseline justify-between border-b border-line px-4 py-2 text-[13px] font-bold', d === today ? 'bg-selection text-primary' : 'bg-[#F8FAFC] text-ink dark:bg-subtle')}>
                  <span>{longDay(d).replace(/ \d{4}$/, '')}</span>
                  <span className="font-semibold text-ink-3">{visits.filter(ACTIVE).length} booked</span>
                </h2>
                <ul>
                  {visits.map((v) => (
                    <ListRow key={v.id} visit={v} tone={toneOf(v, clock, d === today)} held={!r.held || r.held.has(d)} onOpen={() => onOpen(v)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}

function ListRow({ visit, tone, held, onOpen }: { visit: Visit; tone: Tone; held: boolean; onOpen: () => void }) {
  const first = visit.items[0];
  return (
    <li className="border-t border-line first:border-t-0">
      <button type="button" onClick={onOpen} disabled={!held} className="flex w-full items-center gap-3.5 px-4 py-2.5 text-left hover:bg-subtle disabled:opacity-60">
        <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: TONES[tone].line }} aria-hidden />
        <span className="w-[118px] shrink-0 whitespace-nowrap text-[15px] font-bold text-ink tabular-nums">
          {visit.start}–{visit.end}
        </span>
        {first ? <Who name={first.provider} color={first.provider_color} size={32} /> : null}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className={cx('truncate text-[15px] text-ink', tone === 'off' && 'line-through')}>{visit.client.name}</b>
            {visit.client.allergy ? <AllergyChip allergy={visit.client.allergy} /> : null}
            {visit.money.deposit_owed > 0 ? <Tag tone="warning">Deposit owed</Tag> : visit.money.advance > 0 ? <Tag tone="violet">Advance</Tag> : null}
          </span>
          <span className="block truncate text-[13px] text-ink-2">
            {servicesOf(visit)} · {stylistsOf(visit)} · {visit.number}
          </span>
        </span>
        <Tag tone={tone === 'late' ? 'danger' : tone === 'service' ? 'success' : tone === 'pending' ? 'warning' : tone === 'off' || tone === 'done' ? 'muted' : 'blue'}>{tone === 'late' ? 'Late' : visit.status_label}</Tag>
      </button>
    </li>
  );
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function Block({ visit, item, top, height, tone, onOpen }: { visit: Visit; item: VisitItem; top: number; height: number; tone: Tone; onOpen: () => void }) {
  const t = TONES[tone];
  const owed = visit.money.deposit_owed > 0;
  /* The shorthand first: the left edge is the status colour at full strength. */
  const style: CSSProperties = { top: top + 1, height: Math.max(24, height - 2), borderColor: `${t.line}33`, borderLeftColor: t.line };
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx('absolute inset-x-[3px] z-[1] overflow-hidden rounded-[8px] border border-l-4 px-2 py-1 text-left text-[13px] leading-snug hover:brightness-[.98] hover:shadow-sm', t.cls)}
      style={style}
      title={`${item.start}–${item.end} · ${visit.client.name} · ${item.service} · ${item.status_label}`}
    >
      <div className="flex min-w-0 items-center gap-1">
        <span className={cx('truncate font-bold', tone === 'off' && 'line-through')}>{visit.client.name}</span>
        {visit.client.allergy ? <Icon name="warning" size={13} className="shrink-0 text-[#BE123C] dark:text-[#FDA4AF]" label="Allergy on file" /> : null}
        {owed ? <Icon name="wallet" size={13} className="shrink-0 text-[#B45309] dark:text-warning" label="Deposit owed" /> : visit.money.advance > 0 ? <Icon name="wallet" size={13} className="shrink-0 text-[#6D28D9] dark:text-[#D2B4FE]" label="Advance received" /> : null}
      </div>
      {height >= 34 ? <div className="truncate opacity-85">{item.service}</div> : null}
    </button>
  );
}

/** A booking pressed on the calendar: what it is, and what the desk can do with it now. */
function VisitActions({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const desk = useDesk();
  const waiting = visit.status === 'pending' || visit.status === 'confirmed';
  const canCheckIn = waiting && desk.may('salon.visit.checkin');
  const canDeposit = waiting && visit.money.deposit_owed > 0 && desk.may('salon.checkout') && !desk.offline;
  const canPay = ((['checked_in', 'in_service', 'completed'].includes(visit.status) && !visit.checked_out) || owing(visit)) && desk.may('salon.checkout') && (!desk.offline || !!desk.desk.register);
  const canRecord = ['checked_in', 'in_service', 'completed'].includes(visit.status) && desk.may('salon.visit.service') && !desk.offline;
  const then = (f: () => void) => () => {
    onClose();
    f();
  };

  return (
    <Modal title={`${visit.client.name} · ${visit.start}–${visit.end}`} width={600} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[14px] text-ink">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="indigo">{visit.status_label}</Tag>
          <span className="text-[13px] text-ink-2">{visit.number}</span>
          {visit.client.allergy ? <AllergyChip allergy={visit.client.allergy} /> : null}
          {visit.money.deposit_owed > 0 ? <Tag tone="warning">Deposit owed {amount(visit.money.deposit_owed)}</Tag> : visit.money.advance > 0 ? <Tag tone="violet">Advance {amount(visit.money.advance)}</Tag> : null}
        </div>
        <div className="text-[16px] font-bold">{servicesOf(visit)}</div>
        <div className="text-ink-2">With {stylistsOf(visit)}</div>
        <div className="mt-2 flex flex-wrap justify-end gap-2.5">
          <TouchButton icon="user" onClick={then(() => desk.go('clients', { client: visit.client.id }))}>
            Open the client
          </TouchButton>
          {canRecord ? (
            <TouchButton icon="file-text" onClick={then(() => desk.go('record', { visit: visit.id }))}>
              Service record
            </TouchButton>
          ) : null}
          {canDeposit ? (
            <TouchButton icon="wallet" onClick={then(() => desk.deposit(visit))}>
              Take deposit
            </TouchButton>
          ) : null}
          {canPay ? (
            <TouchButton variant="primary" icon="banknote" onClick={then(() => desk.go('pay', { visit: visit.id }))}>
              {owing(visit) ? 'Take the rest' : 'Take payment'}
            </TouchButton>
          ) : null}
          {canCheckIn ? (
            <TouchButton variant="primary" icon="check" onClick={then(() => desk.checkIn(visit))}>
              Check in
            </TouchButton>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
