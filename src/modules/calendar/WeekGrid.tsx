import { useEffect, useRef, useState } from 'react';
import { wallTimeLabel } from '../../core/time';
import { cx } from '../../components/ui';
import { colourOf, dayOf, layoutDay, minutesOf, movable, nowWall, type CalendarEvent, EVENT_TONE } from './api';

const HOUR = 52;
const SNAP = 15;
const GUTTER = 56;
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** A drag in progress: moving an entry (by days and minutes) or stretching its end. The column width is read once, when it starts. */
type Drag = { key: string; e: CalendarEvent; mode: 'move' | 'resize'; x0: number; y0: number; colW: number; dDays: number; dMin: number; moved: boolean };

export function eventKey(e: CalendarEvent): string {
  return `${e.source}:${e.id}:${e.occurrence_date ?? e.start_at}`;
}

/**
 * The time grid of the Day and Week views (CalendarWeek). All-day entries sit
 * in their own row; timed ones are placed by their wall-clock digits, side by
 * side where they overlap. Your own events, and meetings you organise or
 * host, drag to a new time or day and stretch from their bottom edge, in
 * quarter hours; an empty slot starts a new event there.
 */
export function WeekGrid({ days, events, today, readOnly, onOpen, onCreate, onMove, onResize }: {
  days: string[];
  events: CalendarEvent[];
  today: string;
  onOpen: (e: CalendarEvent) => void;
  onCreate: (ymd: string, minutes: number, allDay?: boolean) => void;
  onMove: (e: CalendarEvent, dDays: number, dMinutes: number) => void;
  onResize: (e: CalendarEvent, dMinutes: number) => void;
  readOnly?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The click that ends a drag is not a request to open the entry.
  const dragged = useRef(false);
  const [now, setNow] = useState(() => nowWall());
  const allDay = events.filter((e) => e.all_day);
  const timed = events.filter((e) => !e.all_day);

  useEffect(() => {
    const t = setInterval(() => setNow(nowWall()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Open on the working day: the current time if today is shown, else 7:30.
  useEffect(() => {
    const at = days.includes(now.ymd) ? Math.max(0, now.minutes - 120) : 7.5 * 60;
    scroller.current?.scrollTo({ top: (at / 60) * HOUR });
  }, [days.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (ev: React.PointerEvent, e: CalendarEvent, mode: Drag['mode']) => {
    if (readOnly || !movable(e)) return;
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const colW = ((body.current?.getBoundingClientRect().width ?? 700) - GUTTER) / days.length;
    setDrag({ key: eventKey(e), e, mode, x0: ev.clientX, y0: ev.clientY, colW, dDays: 0, dMin: 0, moved: false });
  };
  const pointerMove = (ev: React.PointerEvent) => {
    if (!drag) return;
    const far = Math.abs(ev.clientY - drag.y0) + Math.abs(ev.clientX - drag.x0) > 4;
    const dMin = Math.round((ev.clientY - drag.y0) / HOUR * 60 / SNAP) * SNAP;
    const dDays = drag.mode === 'move' ? Math.round((ev.clientX - drag.x0) / drag.colW) : 0;
    if (dMin !== drag.dMin || dDays !== drag.dDays || (!drag.moved && far)) setDrag({ ...drag, dMin, dDays, moved: drag.moved || far });
  };
  const pointerUp = (e: CalendarEvent) => {
    const d = drag;
    setDrag(null);
    if (!d || !d.moved) return;
    // The click, if the browser sends one, comes before this timer runs.
    dragged.current = true;
    setTimeout(() => (dragged.current = false), 0);
    if (d.mode === 'resize') {
      if (d.dMin !== 0) onResize(e, d.dMin);
      return;
    }
    if (d.dMin !== 0 || d.dDays !== 0) onMove(e, d.dDays, d.dMin);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 border-b border-line" style={{ gridTemplateColumns: `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((d) => {
          const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
          return (
            <div key={d} className="flex flex-col items-center border-l border-line py-2">
              <span className="text-[11px] font-bold text-ink-3">{WEEKDAYS[dow]}</span>
              <span className={cx('flex h-[30px] min-w-[30px] items-center justify-center text-[17px] font-bold', d === today ? 'rounded-full bg-primary text-white' : 'text-ink')}>{Number(d.slice(8))}</span>
            </div>
          );
        })}
      </div>
      <div className="grid min-h-[40px] shrink-0 border-b border-line" style={{ gridTemplateColumns: `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span className="px-1 py-1.5 text-[10.5px] text-ink-3">All day</span>
        {days.map((d) => (
          <div key={d} className="flex min-w-0 flex-col gap-[3px] border-l border-line p-1" onDoubleClick={() => onCreate(d, 9 * 60, true)}>
            {allDay.filter((e) => dayOf(e.start_at) <= d && dayOf(e.end_at ?? e.start_at) >= d).map((e) => (
              <button key={eventKey(e)} type="button" onClick={() => onOpen(e)} className="truncate rounded-[5px] px-1.5 py-0.5 text-left text-[10.5px] font-bold text-white" style={{ background: colourOf(e) }} title={e.title}>
                {e.title}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div ref={body} className="relative" style={{ height: 24 * HOUR }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="absolute right-0 left-0 border-t border-line/60" style={{ top: h * HOUR, height: HOUR }}>
              <span className="block w-[52px] pr-1 text-right text-[10.5px] text-ink-3">{h === 0 ? '' : wallTimeLabel(`2000-01-01 ${String(h).padStart(2, '0')}:00:00`)}</span>
            </div>
          ))}
          <div className="absolute inset-0 grid" style={{ left: GUTTER, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d) => {
              const items = layoutDay(
                timed
                  .filter((e) => dayOf(e.start_at) === d)
                  .map((e) => {
                    const start = minutesOf(e.start_at);
                    const end = e.end_at && dayOf(e.end_at) === d ? minutesOf(e.end_at) : e.end_at ? 1440 : start + 60;
                    return { e, start, end: Math.max(end, start + 20) };
                  }),
              );
              return (
                <div
                  key={d}
                  className="relative border-l border-line"
                  onClick={(ev) => {
                    if (ev.target !== ev.currentTarget) return;
                    const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                    onCreate(d, Math.floor((y / HOUR) * 60 / 30) * 30);
                  }}
                >
                  {items.map(({ e, start: from, end, col, cols }) => {
                    const dragging = drag?.key === eventKey(e) && drag.moved ? drag : null;
                    const top = ((from + (dragging?.mode === 'move' ? dragging.dMin : 0)) / 60) * HOUR;
                    const length = Math.max(15, end - from + (dragging?.mode === 'resize' ? dragging.dMin : 0));
                    const c = colourOf(e);
                    const can = !readOnly && movable(e);
                    return (
                      <button
                        key={eventKey(e)}
                        type="button"
                        onPointerDown={(ev) => start(ev, e, 'move')}
                        onPointerMove={pointerMove}
                        onPointerUp={() => pointerUp(e)}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (dragged.current) {
                            dragged.current = false;
                            return;
                          }
                          onOpen(e);
                        }}
                        className={cx('group/ev absolute flex flex-col overflow-hidden rounded-[6px] px-1.5 py-1 text-left', EVENT_TONE, can ? 'cursor-grab' : 'cursor-pointer', dragging && 'z-10 opacity-80 shadow-lg')}
                        style={{
                          top: top + 1,
                          height: (length / 60) * HOUR - 3,
                          left: `calc(${(col / cols) * 100}% + 2px)`,
                          width: `calc(${100 / cols}% - 5px)`,
                          ['--ev' as string]: c,
                          borderLeft: `3px solid ${c}`,
                          transform: dragging?.dDays ? `translateX(${dragging.dDays * dragging.colW}px)` : undefined,
                        }}
                        title={`${e.title} · ${wallTimeLabel(e.start_at)}`}
                        aria-label={`${e.title}, ${wallTimeLabel(e.start_at)}`}
                      >
                        <b className="truncate text-[11.5px] leading-tight">{e.title}</b>
                        <span className="truncate text-[10.5px]">{wallTimeLabel(e.start_at)}{e.location ? ` · ${e.location}` : e.subtitle ? ` · ${e.subtitle}` : ''}</span>
                        {can ? (
                          <span
                            aria-hidden
                            data-resize=""
                            onPointerDown={(ev) => start(ev, e, 'resize')}
                            className="absolute right-0 bottom-0 left-0 h-[6px] cursor-ns-resize opacity-0 group-hover/ev:opacity-100"
                            style={{ background: `linear-gradient(transparent, ${c}55)` }}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                  {d === now.ymd ? (
                    <>
                      <span className="pointer-events-none absolute right-0 left-0 z-10 h-[2px] bg-[#E0522F]" style={{ top: (now.minutes / 60) * HOUR }} />
                      <span className="pointer-events-none absolute z-10 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E0522F]" style={{ top: (now.minutes / 60) * HOUR + 1, left: 0 }} />
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
