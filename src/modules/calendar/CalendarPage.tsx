import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canOpenApp } from '@shared/access';
import { useVisibleIds } from '../../core/access';
import { apiDelete, apiGet, apiGetMeta, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dayLabel, todayInZone, wallTimeLabel, wallToUtc } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, OfflineNote, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { addMonths, CATEGORIES, categoryOf, colourOf, dayOf, endOf, minutesOf, monthGrid, monthLabel, monthStart, naive, nowWall, rangeLabel, shifted, step, viewRange, type CalendarEvent, type EventDetail, type View, EVENT_TEXT } from './api';
import { ImportResult, SeriesDialog, SubscribeDialog, UndoBar, type IcsReport } from './Dialogs';
import { EventDrawer, type Draft } from './EventDrawer';
import { MonthGrid } from './MonthGrid';
import { eventKey, WeekGrid } from './WeekGrid';
import { SidePanel } from '../../components/SidePanel';
import { Checkbox } from '../../components/Checkbox';
import { ConflictDialog, checkConflicts, type ConflictResult } from './conflicts';

const VIEWS: Array<[View, string]> = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
];
const HIDDEN_KEY = 'ws.calendar.hidden';
const btn = 'flex h-[34px] items-center rounded-[8px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-subtle disabled:opacity-50';

/** A change made by dragging: minutes added to the start and to the end. */
type Change = { e: CalendarEvent; dStart: number; dEnd: number; kind: 'move' | 'resize' };

function loadHidden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Start, end and all-day, as a write sends them: always together. */
function times(allDay: boolean, start: string, end: string) {
  return allDay
    ? { start: start.slice(0, 10), end: end.slice(0, 10), all_day: true }
    : { start: start.replace(' ', 'T').slice(0, 16), end: end.replace(' ', 'T').slice(0, 16), all_day: false };
}

/** "Moved to 10:00 AM", "Moved to Tue 29 Sep · 10:00 AM", "Now ends at 11:30 AM". */
function said(c: Change, start: string, end: string): string {
  if (c.kind === 'resize') return `Now ends at ${wallTimeLabel(end)}`;
  if (c.e.all_day) return `Moved to ${dayLabel(dayOf(start), 'short')}`;
  return dayOf(start) === dayOf(c.e.start_at) ? `Moved to ${wallTimeLabel(start)}` : `Moved to ${dayLabel(dayOf(start), 'short')} · ${wallTimeLabel(start)}`;
}

/**
 * Calendar (CalendarWeek): Day, Week and Month over everything the feed
 * brings — your events, meetings, tasks, leave, holidays, projects, tenders,
 * assets and renewals — with the categories to show on the left. Your own
 * events and the meetings you run move by dragging; each move can be undone.
 * The feed is on your WorkSuite clock, so times are placed by their digits.
 */
export default function CalendarPage(_props: ModuleProps) {
  useTabTitle('Calendar');
  const qc = useQueryClient();
  const { query, go, active } = useTab();
  const today = todayInZone();
  const v = query.get('view');
  const view: View = v === 'day' || v === 'month' ? v : 'week';
  const d = query.get('date');
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const { from, to, days } = viewRange(view, date);
  const q = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: ({ signal }) => apiGetMeta<{ events: CalendarEvent[] }>('/api/calendar/events', { from, to }, signal),
    refetchInterval: 30_000,
  });
  const todays = useQuery({
    queryKey: ['calendar', today, today],
    queryFn: ({ signal }) => apiGetMeta<{ events: CalendarEvent[] }>('/api/calendar/events', { from: today, to: today }, signal),
    refetchInterval: 60_000,
  });
  const offline = !!q.data?.offline;
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  // A category of an app the person was not given is not listed, and its entries (a cached feed's) not drawn.
  const visible = useVisibleIds();
  const categories = CATEGORIES.filter((c) => !c.apps || c.apps.some((a) => canOpenApp(a, visible)));
  const shows = (e: CalendarEvent) => !hidden.includes(categoryOf(e.source)) && categories.some((c) => c.id === categoryOf(e.source));
  const [mini, setMini] = useState(monthStart(date));
  const [drawer, setDrawer] = useState<{ event: CalendarEvent | null; draft: Draft | null } | null>(null);
  const [series, setSeries] = useState<Change | null>(null);
  const [clash, setClash] = useState<{ c: Change; result: ConflictResult } | null>(null);
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<unknown> } | null>(null);
  const [dialog, setDialog] = useState<'subscribe' | null>(null);
  const [report, setReport] = useState<{ name: string; report: IcsReport } | null>(null);
  const [handled, setHandled] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const events = (q.data?.data.events ?? []).filter(shows);
  const todayList = (todays.data?.data.events ?? [])
    .filter(shows)
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || minutesOf(a.start_at) - minutesOf(b.start_at));

  const set = (nv: View, nd: string) => go(`/calendar?view=${nv}&date=${nd}`);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['calendar'] });

  function nextDraft(on = today): Draft {
    const at = on === today ? Math.min(23 * 60, Math.ceil((nowWall().minutes + 1) / 30) * 30) : 9 * 60;
    return { start: naive(on, at), end: naive(on, at + 60), allDay: false };
  }

  // A link can open an event (?event=12) or a new one (?new=1), once.
  const linked = query.get('event');
  const wantNew = query.get('new') === '1';
  const linkedEvent = useQuery({
    queryKey: ['calendar', 'event', linked ? Number(linked) : null],
    queryFn: ({ signal }) => apiGet<EventDetail>(`/api/calendar/events/${linked}`, undefined, signal),
    enabled: !!linked && /^\d+$/.test(linked),
  });
  const want = linked ? `event:${linked}` : wantNew ? 'new' : null;
  if (want && handled !== want && (want === 'new' || linkedEvent.data)) {
    setHandled(want);
    setDrawer(want === 'new' ? { event: null, draft: { ...nextDraft(), title: (query.get('title') ?? '').slice(0, 200) || undefined } } : { event: { ...linkedEvent.data!, source: 'event' }, draft: null });
  }

  const newEvent = () => {
    if (offline) return toast('info', 'You are offline. New events can be added when you are back.');
    setDrawer({ event: null, draft: nextDraft(days.includes(today) ? today : date) });
  };
  const create = (ymd: string, minutes: number, allDay = false) => {
    if (offline) return toast('info', 'You are offline. New events can be added when you are back.');
    setDrawer({ event: null, draft: allDay ? { start: ymd, end: ymd, allDay: true } : { start: naive(ymd, minutes), end: naive(ymd, minutes + 60), allDay: false } });
  };

  /** Carry out a change: to this entry alone, to every occurrence of a series, or to one occurrence taken out of it. */
  const apply = async (c: Change, scope: 'single' | 'all' | 'one') => {
    setSeries(null);
    const { e } = c;
    const s1 = shifted(e.start_at, c.dStart);
    const e1 = shifted(endOf(e), c.dEnd);
    try {
      if (e.source === 'businessmeeting') {
        // A meeting stores instants, and moving one tells everybody invited.
        const put = (s: string, en: string) => apiPost(`/api/meetings/${e.id}/reschedule`, { start_at: wallToUtc(dayOf(s), minutesOf(s)), end_at: wallToUtc(dayOf(en), minutesOf(en)) });
        await put(s1, e1);
        setUndo({ label: `${said(c, s1, e1)} · everyone invited was told`, run: () => put(e.start_at, endOf(e)) });
      } else if (scope === 'single') {
        await apiPut(`/api/calendar/events/${e.id}`, times(e.all_day, s1, e1));
        setUndo({ label: said(c, s1, e1), run: () => apiPut(`/api/calendar/events/${e.id}`, times(e.all_day, e.start_at, endOf(e))) });
      } else if (scope === 'all') {
        // The series' own times, not this occurrence's: the series moves by the distance dragged.
        const master = await apiGet<EventDetail>(`/api/calendar/events/${e.id}`);
        await apiPut(`/api/calendar/events/${e.id}`, times(master.all_day, shifted(master.start_at, c.dStart), shifted(endOf(master), c.dEnd)));
        setUndo({ label: `Every occurrence · ${said(c, s1, e1).toLowerCase()}`, run: () => apiPut(`/api/calendar/events/${e.id}`, times(master.all_day, master.start_at, endOf(master))) });
      } else {
        // Only this one: a one-off copy at the new time, with the same people, and the date skipped in the series.
        const master = await apiGet<EventDetail>(`/api/calendar/events/${e.id}`);
        const date = e.occurrence_date!;
        const copy = await apiPost<CalendarEvent>('/api/calendar/events', {
          title: master.title,
          description: master.description ?? '',
          category: master.category ?? '',
          location: master.location ?? '',
          color: master.color,
          remind_minutes: master.remind_minutes ?? null,
          ...times(master.all_day, s1, e1),
        });
        try {
          if (master.meeting_uuid) await apiPut(`/api/calendar/events/${copy.id}`, { meeting_uuid: master.meeting_uuid });
          for (const role of ['viewer', 'editor'] as const) {
            const ids = master.participants.filter((p) => p.status !== 'organizer' && !p.is_you && (p.role ?? 'viewer') === role).map((p) => p.user_id);
            if (ids.length) await apiPost(`/api/calendar/events/${copy.id}/invite`, { user_ids: ids, role });
          }
          await apiPost(`/api/calendar/events/${e.id}/skip`, { date });
        } catch (err) {
          await apiDelete(`/api/calendar/events/${copy.id}`).catch(() => undefined);
          throw err;
        }
        setUndo({
          label: `This one only · ${said(c, s1, e1).toLowerCase()}`,
          run: async () => {
            await apiDelete(`/api/calendar/events/${copy.id}`);
            await apiPost(`/api/calendar/events/${e.id}/unskip`, { date });
          },
        });
      }
    } catch (err) {
      // A refused move is usually a clash (a meeting room), and says so.
      toast('error', errorMessage(err));
    } finally {
      refresh();
    }
  };

  const proceed = (c: Change) => {
    if (c.e.source === 'event' && c.e.recurring && c.e.occurrence_date) return setSeries(c);
    void apply(c, 'single');
  };
  // Asked before anything moves (worksuite-desktop#99): onto something else, the person chooses; nothing is moved meanwhile.
  const change = async (c: Change) => {
    if (offline) return toast('info', 'You are offline. Changes can be made when you are back.');
    const { e } = c;
    const result = await checkConflicts({
      start: shifted(e.start_at, c.dStart),
      end: shifted(endOf(e), c.dEnd),
      all_day: e.all_day,
      ...(e.source === 'businessmeeting' ? { meeting_id: Number(e.id) } : /^\d+$/.test(String(e.id)) ? { event_id: Number(e.id) } : {}),
    }).catch(() => null);
    if (result?.conflicts.length) return setClash({ c, result });
    proceed(c);
  };
  const onMove = (e: CalendarEvent, dDays: number, dMin: number) => void change({ e, dStart: dDays * 1440 + dMin, dEnd: dDays * 1440 + dMin, kind: 'move' });
  const onResize = (e: CalendarEvent, dMin: number) => {
    const at = (s: string) => Date.parse(`${s.replace(' ', 'T').slice(0, 16)}Z`);
    if ((at(endOf(e)) - at(e.start_at)) / 60_000 + dMin < 15) return;
    void change({ e, dStart: 0, dEnd: dMin, kind: 'resize' });
  };

  const runUndo = async () => {
    const u = undo;
    setUndo(null);
    if (!u) return;
    try {
      await u.run();
      toast('success', 'Put back.');
    } catch (err) {
      toast('error', `That could not be undone: ${errorMessage(err)}`);
    } finally {
      refresh();
    }
  };
  const dropUndo = useCallback(() => setUndo(null), []);

  const importIcs = async (f: File) => {
    try {
      const r = await apiPost<IcsReport>('/api/calendar/import', { ics: await f.text() });
      refresh();
      if (r.errors > 0 || r.notes.length > 0 || r.problems.length > 0) setReport({ name: f.name, report: r });
      else toast('success', `Imported ${r.imported} event${r.imported === 1 ? '' : 's'} from ${f.name}.`);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };
  const exportIcs = async () => {
    try {
      await call('transfers:download', { name: 'worksuite-calendar.ics', export: 'calendar' });
      toast('info', 'Saving your calendar (.ics) to your downloads…');
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  // Keys, while this tab is in front and nothing is being typed or asked: T today, N new, D/W/M the view, ← → to move.
  useEffect(() => {
    if (!active) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || drawer || series || clash || dialog || report) return;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const k = ev.key.toLowerCase();
      if (k === 't') set(view, today);
      else if (k === 'n') newEvent();
      else if (k === 'd' || k === 'w' || k === 'm') set(k === 'd' ? 'day' : k === 'w' ? 'week' : 'month', date);
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') set(view, step(view, date, ev.key === 'ArrowLeft' ? -1 : 1));
      else return;
      ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const closeDrawer = () => {
    setDrawer(null);
    if (linked || wantNew) go(`/calendar?view=${view}&date=${date}`);
  };

  return (
    <div className="relative flex h-full bg-surface text-[13px]">
      <SidePanel id="calendar" label="the calendars">
        <aside aria-label="Calendars" className="flex w-[250px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line px-3 py-3.5 scroll-thin">
          <button type="button" data-guide="calendar.new-event" onClick={newEvent} title="New event (N)" className="flex h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-[9px] bg-primary font-bold text-white hover:bg-primary-hover">
            <Icon name="plus" size={16} /> New event
          </button>
          <MiniMonth month={mini} today={today} range={view === 'month' ? [] : days} selected={date} onMonth={(n) => setMini(addMonths(mini, n))} onPick={(x) => set(view === 'month' ? 'day' : view, x)} />
          <div className="flex flex-col gap-[5px]">
            <b className="text-[11px] tracking-[0.5px] text-ink-3">SHOW</b>
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-ink">
                <Checkbox
                  checked={!hidden.includes(c.id)}
                  onChange={(ev) => {
                    const next = ev.target.checked ? hidden.filter((h) => h !== c.id) : [...hidden, c.id];
                    setHidden(next);
                    try {
                      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
                    } catch {
                      // Kept for this session only.
                    }
                  }}
                  color={c.color}
                />
                <span className="h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: c.color }} />
                <span className="min-w-0 truncate" title={c.label}>{c.label}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-[5px] border-t border-line pt-2">
            <b className="text-[11px] tracking-[0.5px] text-ink-3">TODAY</b>
            {todayList.length === 0 ? <span className="text-[12px] text-ink-3">{todays.isLoading ? 'Loading…' : 'Nothing today'}</span> : null}
            {todayList.slice(0, 8).map((e) => (
              <button key={eventKey(e)} type="button" onClick={() => setDrawer({ event: e, draft: null })} className="flex gap-2 rounded-[6px] text-left text-[12px] hover:bg-subtle">
                <span className="w-[66px] shrink-0 font-mono whitespace-nowrap text-ink-3">{e.all_day ? 'All day' : wallTimeLabel(e.start_at)}</span>
                <span className={cx('min-w-0 truncate font-semibold', EVENT_TEXT)} style={{ ['--ev' as string]: colourOf(e) }}>{e.title}</span>
              </button>
            ))}
          </div>
        </aside>
      </SidePanel>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <button type="button" title="Jump to today (T)" onClick={() => (set(view, today), setMini(monthStart(today)))} className={btn}>Today</button>
          <button type="button" aria-label={`Previous ${view}`} onClick={() => set(view, step(view, date, -1))} className={cx(btn, 'w-[34px] justify-center px-0')}><Icon name="chevron-left" size={16} /></button>
          <button type="button" aria-label={`Next ${view}`} onClick={() => set(view, step(view, date, 1))} className={cx(btn, 'w-[34px] justify-center px-0')}><Icon name="chevron-right" size={16} /></button>
          <h1 className="ml-1.5 min-w-0 flex-1 truncate text-[18px] font-bold text-ink">{rangeLabel(view, date)}</h1>
          {offline ? <OfflineNote cachedAt={q.data?.cachedAt ?? null} /> : null}
          <span role="tablist" aria-label="View" className="flex rounded-[9px] bg-subtle p-[3px] font-semibold">
            {VIEWS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} title={`${label} (${id[0]!.toUpperCase()})`} onClick={() => set(id, date)} className={cx('rounded-[7px] px-3 py-[5px]', view === id ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.12)]' : 'text-ink-2 hover:text-ink')}>
                {label}
              </button>
            ))}
          </span>
          <button type="button" className={btn} disabled={offline} onClick={() => file.current?.click()}>Import .ics</button>
          <button type="button" className={btn} onClick={() => void exportIcs()}>Export .ics</button>
          <button type="button" className={btn} disabled={offline} onClick={() => setDialog('subscribe')}>Subscribe</button>
          <input
            ref={file}
            type="file"
            accept=".ics,text/calendar"
            aria-label="Choose a calendar file"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = '';
              if (f) void importIcs(f);
            }}
          />
        </div>
        {q.error && !q.data ? <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        {view === 'month' ? (
          <MonthGrid anchor={date} events={events} today={today} readOnly={offline} onOpen={(e) => setDrawer({ event: e, draft: null })} onCreate={create} onDay={(x) => set('day', x)} onMove={onMove} />
        ) : (
          <WeekGrid days={days} events={events} today={today} readOnly={offline} onOpen={(e) => setDrawer({ event: e, draft: null })} onCreate={create} onMove={onMove} onResize={onResize} />
        )}
      </main>
      {drawer ? (
        <>
          <button type="button" aria-label="Close the event" className="absolute inset-0 z-20 cursor-default bg-[rgba(15,27,61,.12)]" onClick={closeDrawer} />
          <EventDrawer key={drawer.event ? eventKey(drawer.event) : `new:${drawer.draft?.start}`} event={drawer.event} draft={drawer.draft} onClose={closeDrawer} />
        </>
      ) : null}
      {series ? (
        <SeriesDialog
          title={series.kind === 'move' ? 'Move the whole series?' : 'Change the whole series?'}
          what={
            series.kind === 'move'
              ? `You dragged “${series.e.title}” from ${dayLabel(dayOf(series.e.start_at), 'short')} ${wallTimeLabel(series.e.start_at)} to ${dayLabel(dayOf(shifted(series.e.start_at, series.dStart)), 'short')} ${wallTimeLabel(shifted(series.e.start_at, series.dStart))}. It repeats.`
              : `You changed “${series.e.title}” on ${dayLabel(dayOf(series.e.start_at), 'short')} to end at ${wallTimeLabel(shifted(endOf(series.e), series.dEnd))}. It repeats.`
          }
          canOne={!!series.e.can_manage}
          onOne={() => void apply(series, 'one')}
          onAll={() => void apply(series, 'all')}
          onCancel={() => setSeries(null)}
        />
      ) : null}
      {clash ? <ConflictDialog result={clash.result} action={clash.c.kind === 'move' ? 'Move anyway' : 'Change anyway'} onContinue={() => proceed(clash.c)} onClose={() => setClash(null)} /> : null}
      {undo ? <UndoBar label={undo.label} onUndo={() => void runUndo()} onGone={dropUndo} /> : null}
      {dialog === 'subscribe' ? <SubscribeDialog onClose={() => setDialog(null)} /> : null}
      {report ? <ImportResult name={report.name} report={report.report} onClose={() => setReport(null)} /> : null}
    </div>
  );
}

/** The small month on the left: the days shown are marked, today is filled, and a day opens it. */
function MiniMonth({ month, today, range, selected, onMonth, onPick }: { month: string; today: string; range: string[]; selected: string; onMonth: (n: number) => void; onPick: (ymd: string) => void }) {
  const days = monthGrid(month);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center">
        <b className="flex-1 text-ink">{monthLabel(month)}</b>
        <button type="button" aria-label="Previous month" onClick={() => onMonth(-1)} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-2 hover:bg-subtle"><Icon name="chevron-left" size={14} /></button>
        <button type="button" aria-label="Next month" onClick={() => onMonth(1)} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-2 hover:bg-subtle"><Icon name="chevron-right" size={14} /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11.5px]" aria-label={monthLabel(month)}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => <span key={i} className="py-[3px] font-bold text-ink-3">{w}</span>)}
        {days.map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => onPick(x)}
            aria-label={dayLabel(x)}
            aria-current={x === today ? 'date' : undefined}
            data-ymd={x}
            className={cx(
              'rounded-[6px] py-1',
              x === today
                ? 'bg-primary font-bold text-white'
                : range.includes(x) || (range.length === 0 && x === selected)
                  ? 'bg-selection text-primary'
                  : x.slice(0, 7) === month.slice(0, 7)
                    ? 'text-ink hover:bg-subtle'
                    : 'text-ink-3 hover:bg-subtle',
            )}
          >
            {Number(x.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}
