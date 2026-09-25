import { useQuery } from '@tanstack/react-query';
import { apiGetMeta } from '../../core/api';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { addDays, dayLabel, todayInZone, wallTimeLabel } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Button, Chip, Empty, ErrorNote, IconButton, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';

/**
 * Calendar (READ_CACHE, §14). The feed publishes wall-clock digits already on
 * the reader's clock — meetings, rooms, tenders and timed tasks converted by
 * the server, native events floating — so times are shown as written, never
 * re-read as UTC, and days are bucketed by the date digits, exactly as the
 * web calendar does.
 */
export interface CalendarEvent {
  source: string;
  id: number;
  title: string;
  color: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  editable: boolean;
  location?: string | null;
  join_url?: string | null;
  description?: string | null;
  link?: string;
  route?: string;
  status?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  event: 'Event',
  meeting: 'Meet',
  businessmeeting: 'Meeting',
  task: 'Task',
  leave: 'Leave',
  holiday: 'Holiday',
  tender: 'Tender',
  subscription: 'Renewal',
};

function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday first
  return addDays(ymd, -dow);
}

export default function CalendarPage(_props: ModuleProps) {
  useTabTitle('Calendar');
  const { query, go, openLink } = useTab();
  const today = todayInZone();
  const from = query.get('week') ?? weekStart(today);
  const to = addDays(from, 6);
  const q = useQuery({ queryKey: ['calendar', from, to], queryFn: ({ signal }) => apiGetMeta<{ events: CalendarEvent[] }>('/api/calendar/events', { from, to }, signal) });
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const byDay = (() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of q.data?.data.events ?? []) {
      const start = e.start_at.slice(0, 10);
      const end = (e.end_at ?? e.start_at).slice(0, 10);
      for (const d of days) if (d >= start && d <= end) m.set(d, [...(m.get(d) ?? []), e]);
    }
    for (const list of m.values()) list.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start_at.localeCompare(b.start_at));
    return m;
  })();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <h1 className="text-[20px] font-bold text-ink">Calendar</h1>
        <div className="ml-3 flex items-center gap-1">
          <IconButton icon="chevron-left" label="Previous week" onClick={() => go(`/calendar?week=${addDays(from, -7)}`)} />
          <Button size="sm" onClick={() => go('/calendar')}>
            Today
          </Button>
          <IconButton icon="chevron-right" label="Next week" onClick={() => go(`/calendar?week=${addDays(from, 7)}`)} />
        </div>
        <span className="text-[14px] font-semibold text-ink-2">
          {dayLabel(from, 'short')} – {dayLabel(to, 'short')}
        </span>
        <div className="flex-1" />
        {q.data?.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
        <Button icon="plus" onClick={() => openLink('/calendar?new=1')}>
          New event
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6 scroll-thin">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <section key={d} className={cx('rounded-[12px] border bg-surface', d === today ? 'border-primary/50' : 'border-line')}>
                <header className="flex items-center justify-between px-4 pt-3 pb-2">
                  <h2 className={cx('text-[14px] font-bold', d === today ? 'text-primary' : 'text-ink')}>{d === today ? `Today · ${dayLabel(d, 'short')}` : dayLabel(d)}</h2>
                  <span className="text-[12px] text-ink-3">{list.length ? `${list.length} item${list.length === 1 ? '' : 's'}` : ''}</span>
                </header>
                <ul className="flex flex-col gap-1.5 px-3 pb-3">
                  {list.length === 0 ? <li className="px-1 pb-1 text-[12.5px] text-ink-3">Nothing scheduled</li> : null}
                  {list.map((e) => (
                    <li key={`${e.source}:${e.id}:${e.start_at}`} className="flex items-center gap-3 rounded-[9px] bg-subtle px-3 py-2">
                      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: e.color ?? 'var(--ws-indigo)' }} />
                      <span className="w-[74px] shrink-0 font-mono text-[12.5px] font-semibold text-primary">{e.all_day ? 'All day' : wallTimeLabel(e.start_at)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink">{e.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {e.all_day || !e.end_at ? '' : `until ${wallTimeLabel(e.end_at)} `}
                          {e.location ?? ''}
                        </span>
                      </span>
                      <Chip>{SOURCE_LABEL[e.source] ?? e.source.replace(/_/g, ' ')}</Chip>
                      {e.join_url ? (
                        <Button size="sm" variant="primary" icon="video" onClick={() => void call('app:openExternal', { url: e.join_url! })}>
                          Join
                        </Button>
                      ) : e.link || e.route ? (
                        <IconButton icon="external" label="Open" size={15} onClick={() => openLink(e.link ?? e.route)} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        {!q.isLoading && (q.data?.data.events ?? []).length === 0 ? <Empty icon="calendar" title="A clear week" hint="Events, meetings, leave and task deadlines appear here." /> : null}
        <p className="mt-6 flex items-center gap-1.5 text-[12px] text-ink-3">
          <Icon name="info" size={13} /> Creating and editing events opens WorkSuite Calendar on the web.
        </p>
      </div>
    </div>
  );
}
