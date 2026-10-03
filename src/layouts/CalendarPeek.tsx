import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { apiGetMeta } from '../core/api';
import { text } from '../core/i18n';
import { addDays, dayWords, todayInZone, wallTimeLabel } from '../core/time';

/**
 * Calendar peek (ENH-MAIL-03 DMO-CAL-05): resting on the Calendar icon in
 * the sidebar (or tabbing to it) shows today's agenda beside it, without
 * leaving what you are doing. From the calendar's own feed, kept offline
 * like the rest of it.
 */

interface PeekEvent {
  source: string;
  id: number | string;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  status?: string | null;
  my_rsvp?: string | null;
}

/** Today's entries in order: all-day first, then by start; cancelled and declined ones left out. */
export function agendaOf(events: PeekEvent[]): PeekEvent[] {
  return events
    .filter((e) => e.status !== 'cancelled' && e.my_rsvp !== 'declined')
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start_at.localeCompare(b.start_at));
}

export function CalendarPeek({ at, onClose }: { at: { top: number; left: number }; onClose: () => void }) {
  const today = todayInZone();
  const q = useQuery({
    queryKey: ['calendar', 'peek', today],
    queryFn: ({ signal }) => apiGetMeta<{ events: PeekEvent[] }>('/api/calendar/events', { from: today, to: addDays(today, 1) }, signal),
    staleTime: 60_000,
  });
  const items = agendaOf((q.data?.data.events ?? []).filter((e) => e.start_at.slice(0, 10) <= today && (e.end_at ?? e.start_at).slice(0, 10) >= today));
  return createPortal(
    <div role="dialog" aria-label={text('Today’s agenda')} onMouseLeave={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()} style={{ top: at.top, left: at.left }} className="fixed z-50 w-[280px] rounded-[12px] border border-line bg-surface p-3 text-ink shadow-[0_10px_40px_rgb(var(--ws-shadow-rgb)/0.22)]">
      <div className="mb-2 text-[13px] font-bold">{text('Today · {day}', { day: dayWords(today, { weekday: true }) })}</div>
      {q.isLoading ? (
        <p className="text-[12.5px] text-ink-3">{text('Loading…')}</p>
      ) : items.length ? (
        <ul className="flex flex-col gap-1.5">
          {items.slice(0, 8).map((e) => (
            <li key={`${e.source}-${e.id}`} className="flex gap-2 text-[12.5px]">
              <span className="w-[86px] shrink-0 text-ink-3">{e.all_day ? text('All day') : `${wallTimeLabel(e.start_at)}${e.end_at ? `–${wallTimeLabel(e.end_at)}` : ''}`}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{e.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-ink-3">{q.data?.offline ? text('Nothing kept on this computer for today.') : text('Nothing in your calendar today.')}</p>
      )}
      {items.length > 8 ? <p className="mt-1 text-[12px] text-ink-3">{text('and {n} more', { n: items.length - 8 })}</p> : null}
    </div>,
    document.body,
  );
}
