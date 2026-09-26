import { wallTimeLabel } from '../../core/time';
import { cx } from '../../components/ui';
import { useRef, useState } from 'react';
import { colourOf, dayDiff, dayOf, minutesOf, monthGrid, movable, type CalendarEvent } from './api';
import { eventKey } from './WeekGrid';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const SHOWN = 3;

/**
 * Month view: six weeks from the Monday before the 1st; a busy day says how
 * many more. What you may move drags to another day and keeps its time: a
 * month cell has no hours in it to take one from.
 */
export function MonthGrid({ anchor, events, today, readOnly, onOpen, onCreate, onDay, onMove }: {
  anchor: string;
  events: CalendarEvent[];
  today: string;
  onOpen: (e: CalendarEvent) => void;
  onCreate: (ymd: string, minutes: number, allDay?: boolean) => void;
  onDay: (ymd: string) => void;
  onMove: (e: CalendarEvent, dDays: number, dMinutes: number) => void;
  readOnly?: boolean;
}) {
  // A ref, not state: the drop can arrive before a re-render would have shown what is being dragged.
  const dragging = useRef<CalendarEvent | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const days = monthGrid(anchor);
  const can = (e: CalendarEvent) => !readOnly && movable(e);
  const grab = (e: CalendarEvent) => ({
    draggable: can(e),
    onDragStart: (ev: React.DragEvent) => {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', e.title);
      dragging.current = e;
    },
    onDragEnd: () => {
      dragging.current = null;
      setOver(null);
    },
  });
  const month = anchor.slice(0, 7);
  const on = (d: string) =>
    events
      .filter((e) => dayOf(e.start_at) <= d && dayOf(e.end_at ?? e.start_at) >= d && (e.all_day || dayOf(e.start_at) === d))
      .sort((a, b) => Number(b.all_day) - Number(a.all_day) || minutesOf(a.start_at) - minutesOf(b.start_at));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAYS.map((w) => <span key={w} className="py-2 text-center text-[11px] font-bold text-ink-3">{w}</span>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const list = on(d);
          return (
            <div
              key={d}
              data-day={d}
              className={cx('flex min-h-0 flex-col gap-[3px] overflow-hidden border-r border-b border-line p-1', d.slice(0, 7) !== month && 'bg-subtle/60', over === d && 'bg-selection ring-2 ring-primary/40 ring-inset')}
              onDoubleClick={(ev) => ev.target === ev.currentTarget && onCreate(d, 9 * 60)}
              onDragOver={(ev) => {
                if (!dragging.current) return;
                ev.preventDefault();
                if (over !== d) setOver(d);
              }}
              onDrop={(ev) => {
                ev.preventDefault();
                const e = dragging.current;
                dragging.current = null;
                setOver(null);
                const n = e ? dayDiff(dayOf(e.start_at), d) : 0;
                if (e && n !== 0) onMove(e, n, 0);
              }}
            >
              <button type="button" onClick={() => onDay(d)} className={cx('flex h-6 w-6 items-center justify-center self-end rounded-full text-[12px] font-bold', d === today ? 'bg-primary text-white' : d.slice(0, 7) === month ? 'text-ink hover:bg-subtle' : 'text-ink-3')}>
                {Number(d.slice(8))}
              </button>
              {list.slice(0, SHOWN).map((e) =>
                e.all_day ? (
                  <button key={eventKey(e)} type="button" {...grab(e)} onClick={() => onOpen(e)} className={cx('truncate rounded-[5px] px-1.5 py-px text-left text-[10.5px] font-bold text-white', can(e) && 'cursor-grab')} style={{ background: colourOf(e) }} title={e.title}>
                    {e.title}
                  </button>
                ) : (
                  <button key={eventKey(e)} type="button" {...grab(e)} onClick={() => onOpen(e)} className={cx('flex items-center gap-1 truncate rounded-[5px] px-1 text-left text-[11px] text-ink hover:bg-subtle', can(e) && 'cursor-grab')} title={e.title}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colourOf(e) }} />
                    <span className="shrink-0 text-ink-3">{wallTimeLabel(e.start_at)}</span>
                    <span className="truncate">{e.title}</span>
                  </button>
                ),
              )}
              {list.length > SHOWN ? (
                <button type="button" onClick={() => onDay(d)} className="px-1 text-left text-[11px] font-semibold text-primary hover:underline">
                  +{list.length - SHOWN} more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
