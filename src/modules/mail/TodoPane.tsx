import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiGetMeta } from '../../core/api';
import { text } from '../../core/i18n';
import { addDays, currentZone, dayKey, dayWords, parseTs, timeLabel, todayInZone, wallTimeLabel } from '../../core/time';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { ResizeDivider, useResizableWidth } from '../../components/ResizeDivider';
import type { CalendarEvent } from '../calendar/api';
import type { Task } from '../tasks/api';
import type { MessageStates } from './states';

/**
 * The To-Do pane, or My Day (ENH-MAIL-03 DMO-TSK-04, DMO-CAL-05, DMO-CAL-07):
 * on the right of Mail, the week's events, flagged mail by due date and
 * tasks due. A message dragged from the list onto Calendar becomes an event
 * with its text; onto Tasks, a task that links back to it.
 */

export const MAIL_DRAG = 'application/x-worksuite-mail';

/** The next half hour on the WorkSuite clock, for an event made from a message: date, start and end ("HH:MM"). */
export function nextSlot(now = new Date()): { date: string; start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const g = (k: string) => parts.find((p) => p.type === k)?.value ?? '00';
  let mins = Number(g('hour')) * 60 + Number(g('minute'));
  mins = Math.ceil((mins + 1) / 30) * 30;
  let date = `${g('year')}-${g('month')}-${g('day')}`;
  if (mins + 30 > 24 * 60) {
    date = addDays(date, 1);
    mins = 9 * 60;
  }
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { date, start: hm(mins), end: hm(mins + 30) };
}

export function TodoPane({ onOpenFlag, onDropMail, onClose, canCalendar, canTasks }: { onOpenFlag: (f: { mailbox: number; folder: string; uid: string }) => void; onDropMail: (rowKey: string, to: 'event' | 'task') => void; onClose: () => void; canCalendar: boolean; canTasks: boolean }) {
  // 300px to start; never so wide that the mail beside it is squeezed out.
  const size = useResizableWidth('mail.todoPane', { defaultWidth: 300, min: 240, max: () => Math.max(240, Math.min(560, window.innerWidth - 880)) });
  const today = todayInZone();
  const week = addDays(today, 6);
  const events = useQuery({
    queryKey: ['calendar', today, week],
    queryFn: () => apiGetMeta<{ events: CalendarEvent[] }>('/api/calendar/events', { from: today, to: week }),
    enabled: canCalendar,
    staleTime: 60_000,
  });
  const tasks = useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: ({ signal }) => apiGetMeta<{ tasks: Task[] }>('/api/tasks', undefined, signal),
    enabled: canTasks,
    staleTime: 60_000,
  });
  const flags = useQuery({
    queryKey: ['mail', 'states', 'all'],
    queryFn: async () => {
      try {
        return await apiGet<MessageStates>('/api/mail/states');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });

  // When the pane opened: late flags are late as of then (a render is not a clock).
  const [now] = useState(() => Date.now());
  // Calendar times are wall-clock digits: compared as digits, from today on.
  const upcoming = (events.data?.data.events ?? [])
    .filter((e) => e.start_at.slice(0, 10) >= today || (e.end_at ?? '').slice(0, 10) >= today)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 8);
  const flagged = Object.values(flags.data?.flags ?? {})
    .filter((f) => !f.completed_at)
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    .slice(0, 10);
  const due = (tasks.data?.data.tasks ?? [])
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled' && !t.archived && t.due_date && t.due_date <= week)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
    .slice(0, 10);

  return (
    <aside aria-label={text('My Day')} className="relative flex shrink-0 flex-col border-l border-line bg-surface" style={{ width: size.width }}>
      {/* Its width is the person's: drag its left edge, remembered on this computer (#304). */}
      <ResizeDivider state={size} side="left" label={text('Resize My Day')} />
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[14px] font-bold text-ink">{text('My Day')}</h2>
        <button type="button" aria-label={text('Close My Day')} onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="panel-right-close" size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin">
        {canCalendar ? (
          <Drop label={text('Calendar')} hint={text('Drop a message here to make an event')} onDrop={(k) => onDropMail(k, 'event')}>
            {events.isLoading ? <p className="text-[12.5px] text-ink-3">{text('Loading…')}</p> : upcoming.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('Nothing this week.')}</p> : null}
            <ul className="flex flex-col gap-1">
              {upcoming.map((e) => {
                const day = e.start_at.slice(0, 10);
                return (
                  <li key={`${e.source}:${e.id}:${e.start_at}`} className="rounded-[8px] border border-line px-2 py-1.5 text-[12.5px]">
                    <span className="block truncate font-semibold text-ink">{e.title}</span>
                    <span className="text-ink-3">
                      {day === today ? text('Today') : dayWords(day, { weekday: true })} · {e.all_day ? text('All day') : `${wallTimeLabel(e.start_at)}${e.end_at ? `–${wallTimeLabel(e.end_at)}` : ''}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Drop>
        ) : null}
        <section aria-label={text('Flagged mail')} className="mt-4">
          <h3 className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-3">{text('Flagged mail')}</h3>
          {flags.data === null ? <p className="text-[12.5px] text-ink-3">{text('This WorkSuite server does not keep flags yet.')}</p> : flagged.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('No flagged mail.')}</p> : null}
          <ul className="flex flex-col gap-1">
            {flagged.map((f) => {
              const late = f.due_at ? parseTs(f.due_at).getTime() < now : false;
              return (
                <li key={`${f.mailbox}:${f.folder}:${f.uid}`}>
                  <button type="button" onClick={() => onOpenFlag({ mailbox: f.mailbox, folder: f.folder, uid: f.uid })} className="w-full rounded-[8px] px-2 py-1.5 text-left text-[12.5px] hover:bg-subtle">
                    <span className="flex items-center gap-1.5">
                      <Icon name="flag" size={12} className={late ? 'text-danger' : 'text-ink-3'} />
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{f.subject || text('(no subject)')}</span>
                    </span>
                    <span className={cx('block truncate', late ? 'text-danger' : 'text-ink-3')}>
                      {f.from_name || f.from_email}
                      {f.due_at ? ` · ${text('Due {when}', { when: dayKey(parseTs(f.due_at)) === today ? `${text('today')} ${timeLabel(f.due_at)}` : dayWords(dayKey(parseTs(f.due_at)), { weekday: true }) })}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        {canTasks ? (
          <Drop label={text('Tasks due')} hint={text('Drop a message here to make a task')} onDrop={(k) => onDropMail(k, 'task')} className="mt-4">
            {tasks.isLoading ? <p className="text-[12.5px] text-ink-3">{text('Loading…')}</p> : due.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('Nothing due this week.')}</p> : null}
            <ul className="flex flex-col gap-1">
              {due.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-[8px] px-2 py-1 text-[12.5px]">
                  <Icon name="tasks" size={12} className="text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                  <span className={cx('shrink-0', (t.due_date ?? '') < today ? 'font-semibold text-danger' : 'text-ink-3')}>{t.due_date === today ? text('Today') : dayWords(t.due_date ?? today)}</span>
                </li>
              ))}
            </ul>
          </Drop>
        ) : null}
      </div>
    </aside>
  );
}

/** A section that takes a message dropped from the list. */
function Drop({ label, hint, onDrop, className, children }: { label: string; hint: string; onDrop: (rowKey: string) => void; className?: string; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <section
      aria-label={label}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes(MAIL_DRAG)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const k = e.dataTransfer.getData(MAIL_DRAG);
        setOver(false);
        if (!k) return;
        e.preventDefault();
        onDrop(k);
      }}
      className={cx('rounded-[10px] p-1 transition-colors', over && 'bg-selection outline-2 outline-dashed outline-primary', className)}
    >
      <h3 className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-3">{label}</h3>
      {children}
      <p className="mt-1.5 text-[11.5px] text-ink-3">{hint}</p>
    </section>
  );
}
