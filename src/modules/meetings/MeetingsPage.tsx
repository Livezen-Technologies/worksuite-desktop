import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ModuleProps } from '../registry';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { addDays, dateLabel, dayKey, parseTs, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Chip, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { dayStrip, listOf, matchesSource, providerLabel, RSVP_LABEL, rowChip, SOURCE_FILTERS, TYPE_COLOUR, TYPES, typeLabel, type Can, type Meeting, type MeetingRoom, type Occurrence, type PageMeta, type Rsvp } from './api';
import { MeetingDetail } from './MeetingDetail';
import { AgendaWindow } from './AgendaWindow';
import { ScheduleDialog } from './ScheduleDialog';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';
import { invitationsChanged, useInvitationAnswer } from '../calendar/conflicts';

type Tab = 'dashboard' | 'mine' | 'invitations' | 'rooms' | 'recurring';
const TABS: Array<[Tab, string]> = [
  ['dashboard', 'Dashboard'],
  ['mine', 'My meetings'],
  ['invitations', 'Invitations'],
  ['rooms', 'Meeting rooms'],
  ['recurring', 'Recurring'],
];

interface Dashboard {
  kpi: { today: number; upcoming: number; ongoing: number; completed: number; pending_invitations: number; meeting_hours_this_month: number; average_attendance: number | null; action_items_pending: number };
  can: Can;
}

/** When, as the dashboard's left column says it: "4:30 PM" over "Today". */
export function whenParts(iso: string): [string, string] {
  const day = dayKey(parseTs(iso));
  const today = todayInZone();
  const label = day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : dateLabel(iso).replace(/,? \d{4}$/, '');
  return [timeLabel(iso), label];
}

export default function MeetingsPage(_props: ModuleProps) {
  const { query, go } = useTab();
  const selected = query.get('meeting');
  // The always-on-top agenda window (D08) is this module in a window of its own.
  const agendaOf = query.get('agenda');
  const tab = (TABS.find(([k]) => k === query.get('tab'))?.[0] ?? 'dashboard') as Tab;
  const [q, setQ] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  useTabTitle(selected || agendaOf ? null : 'Meetings');
  const dash = useQuery({ queryKey: ['meetings', 'dashboard'], queryFn: ({ signal }) => apiGet<Dashboard>('/api/meetings/dashboard', undefined, signal), refetchInterval: 60_000 });

  if (agendaOf) return <AgendaWindow id={Number(agendaOf)} />;
  if (selected) return <MeetingDetail id={Number(selected)} onBack={() => go(`/meetings${tab === 'dashboard' ? '' : `?tab=${tab}`}`)} />;
  const k = dash.data?.kpi;
  const kpis: Array<[string, string, string]> = k
    ? [
        ['Happening now', String(k.ongoing), 'text-danger'],
        ['Coming up', String(k.upcoming), 'text-ink'],
        ['Awaiting your answer', String(k.pending_invitations), 'text-[#9A4A06] dark:text-warning'],
        ['Your action items', String(k.action_items_pending), 'text-ink'],
        ['Hours this month', String(Math.round(k.meeting_hours_this_month * 10) / 10), 'text-ink'],
        ['Average attendance', k.average_attendance === null ? '—' : `${k.average_attendance}%`, 'text-success'],
      ]
    : [];
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <main className="flex flex-col gap-4 px-7 py-6 text-[13px]">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-[22px] font-bold text-ink">Meetings</h1>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search meetings" placeholder="Search…" className="h-9 w-64 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
          {dash.data?.can.schedule ? (
            <button type="button" data-guide="meetings.schedule" onClick={() => setScheduling(true)} className="h-9 rounded-[8px] bg-primary px-3.5 font-bold text-white hover:bg-primary-hover">
              Schedule a meeting
            </button>
          ) : null}
        </div>
        <div role="tablist" className="flex border-b border-line">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go(id === 'dashboard' ? '/meetings' : `/meetings?tab=${id}`)} className={cx('h-10 px-3', tab === id ? 'font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]' : 'font-medium text-ink-2')}>
              {label}
              {id === 'invitations' && k?.pending_invitations ? <span className="ml-1.5 rounded-full bg-warning-bg px-1.5 text-[11px] font-bold text-[#9A4A06] dark:text-warning">{k.pending_invitations}</span> : null}
            </button>
          ))}
          <span className="flex-1" />
          <button type="button" onClick={() => void call('app:openInBrowser', { path: '/meetings?tab=reports' })} className="h-10 px-3 font-medium text-ink-2" title="Opens on the web">Reports ↗</button>
          <button type="button" onClick={() => void call('app:openInBrowser', { path: '/meetings?tab=setup' })} className="h-10 px-3 font-medium text-ink-2" title="Opens on the web">Setup ↗</button>
        </div>
        {dash.error ? <ErrorNote error={dash.error} onRetry={() => void dash.refetch()} /> : null}
        {tab === 'dashboard' ? (
          <>
            <div className="grid grid-cols-6 gap-2.5">
              {kpis.map(([label, value, tone]) => (
                <div key={label} className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface px-3.5 py-3">
                  <span className="text-[12px] text-ink-3">{label}</span>
                  <span className={cx('text-[22px] font-bold', tone)}>{value}</span>
                </div>
              ))}
            </div>
            <DayStrip day={day} onDay={setDay} />
            <div className="grid items-start gap-4 [grid-template-columns:1.6fr_1fr]">
              <MeetingList scope="upcoming" q={q} day={day} title={day ? `Meetings on ${dayWordsOf(day)}` : 'Upcoming meetings'} typeFilter onOpen={(id) => go(`/meetings?meeting=${id}`)} />
              <div className="flex flex-col gap-4">
                <Invitations onOpen={(id) => go(`/meetings?meeting=${id}`)} compact />
                <MyActions onOpen={(id) => go(`/meetings?meeting=${id}`)} />
                <RoomsToday />
              </div>
            </div>
          </>
        ) : tab === 'mine' ? (
          <MeetingList scope="mine" q={q} title="Meetings you organise" onOpen={(id) => go(`/meetings?meeting=${id}`)} />
        ) : tab === 'recurring' ? (
          <MeetingList scope="recurring" q={q} title="Recurring meetings" onOpen={(id) => go(`/meetings?meeting=${id}`)} />
        ) : tab === 'invitations' ? (
          <Invitations onOpen={(id) => go(`/meetings?meeting=${id}`)} />
        ) : (
          <RoomsToday all />
        )}
      </main>
      {scheduling ? <ScheduleDialog onClose={() => setScheduling(false)} onCreated={(id) => go(`/meetings?meeting=${id}`)} /> : null}
    </div>
  );
}

interface ListFilters {
  source?: string;
  type?: string;
  q?: string;
  day?: string | null;
  page?: number;
}

/**
 * A list of meetings. Its filters are asked of the server (MTG-U11: `q`, `type`, `source_type`, a day as `from`/`to`,
 * `page`), and held to again on the rows it sends, so an older server that ignores them still shows the right ones.
 */
function useMeetings(scope: string, f: ListFilters = {}) {
  const needle = (f.q ?? '').trim();
  return useQuery({
    queryKey: ['meetings', 'list', scope, f.source ?? '', f.type ?? '', needle, f.day ?? '', f.page ?? 0],
    queryFn: ({ signal }) =>
      apiGet<{ meetings?: Meeting[]; data?: Meeting[]; meta?: PageMeta | null; can?: Can }>(
        '/api/meetings',
        {
          scope,
          source: f.source || undefined,
          source_type: f.source && f.source !== 'crm' ? f.source : undefined,
          type: f.type || undefined,
          q: needle.length >= 2 ? needle : undefined,
          from: f.day || undefined,
          to: f.day || undefined,
          page: f.page && f.page > 1 ? f.page : undefined,
          per_page: f.page ? 25 : undefined,
        },
        signal,
      ).then(listOf),
    refetchInterval: 60_000,
  });
}

/** "Tue 13 Oct": a day of the strip, in words. */
function dayWordsOf(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * The home's day strip (D01): this week, day by day, with how many meetings each has — every occurrence of a
 * repeating one counted on its own day when the server lays them out (MTG-U12), the list's rows otherwise. Choosing a
 * day narrows the upcoming list to it.
 */
function DayStrip({ day, onDay }: { day: string | null; onDay: (d: string | null) => void }) {
  const today = todayInZone();
  const to = addDays(today, 6);
  const occ = useQuery({
    queryKey: ['meetings', 'calendar', today, to],
    queryFn: ({ signal }) => apiGet<{ data?: Occurrence[] }>('/api/meetings/calendar', { from: today, to }, signal).then((r) => (Array.isArray(r?.data) ? r.data : null)),
    retry: false,
    staleTime: 60_000,
  });
  const rows = useMeetings('upcoming');
  const items = occ.data ?? rows.data?.rows ?? [];
  const strip = dayStrip(today, 7, items, (s) => dayKey(parseTs(s)), addDays);
  return (
    <div role="group" aria-label="Days" className="grid grid-cols-7 gap-2">
      {strip.map((d) => {
        const on = day === d.day;
        const date = new Date(`${d.day}T12:00:00Z`);
        return (
          <button
            key={d.day}
            type="button"
            aria-pressed={on}
            aria-label={`${dayWordsOf(d.day)}: ${d.count} meeting${d.count === 1 ? '' : 's'}`}
            onClick={() => onDay(on ? null : d.day)}
            className={cx('flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left', on ? 'border-primary bg-selection' : 'border-line bg-surface hover:bg-subtle')}
          >
            <span className="flex flex-col leading-tight">
              <span className="text-[11px] font-semibold uppercase text-ink-3">{d.day === today ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
              <b className="text-[17px] text-ink">{date.getUTCDate()}</b>
            </span>
            <span className={cx('ml-auto text-[12px] font-semibold', d.count ? 'text-primary' : 'text-ink-3')}>{d.count || '—'}</span>
          </button>
        );
      })}
    </div>
  );
}

function MeetingList({ scope, q, day, title, typeFilter, onOpen }: { scope: string; q: string; day?: string | null; title: string; typeFilter?: boolean; onOpen: (id: number) => void }) {
  // "Related to": tender meetings, CRM meetings… (#100, #101) — asked of the server, and held to on the rows.
  const [source, setSource] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const list = useMeetings(scope, { source, type, q, day, page });
  const needle = q.trim().toLowerCase();
  const meta = list.data?.meta ?? null;
  const rows = (list.data?.rows ?? []).filter(
    (m) => matchesSource(m, source) && (!type || m.type === type) && (!day || dayKey(parseTs(m.start_at)) === day) && (!needle || [m.title, m.meeting_no, m.where ?? '', m.source?.label ?? ''].some((v) => (v ?? '').toLowerCase().includes(needle))),
  );
  const pick = (fn: () => void) => (fn(), setPage(1));
  return (
    <section className="flex flex-col rounded-[12px] border border-line bg-surface">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
        <h2 className="flex-1 text-[15px] font-bold text-ink">{title}</h2>
        <Select aria-label="Related to" value={source} onChange={(e) => pick(() => setSource(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
          {SOURCE_FILTERS.map(([k, v]) => <option key={k} value={k}>{k ? `Related to: ${v}` : 'Related to: any'}</option>)}
        </Select>
        {typeFilter ? (
          <Select aria-label="Type" value={type} onChange={(e) => pick(() => setType(e.target.value))} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
            <option value="">Any type</option>
            {TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        ) : null}
      </div>
      {list.isLoading ? <div className="p-4"><Spinner /></div> : list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : null}
      {!list.isLoading && !list.error && !rows.length ? <div className="p-4"><Empty icon="calendar-clock" title="No meetings here" /></div> : null}
      {rows.map((m) => <Row key={m.id} m={m} onOpen={() => onOpen(m.id)} />)}
      {meta && meta.last_page > 1 ? (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-[12px] text-ink-3">
          <span className="flex-1">
            Page {meta.page} of {meta.last_page} · {meta.total} meetings
          </span>
          <Button size="sm" disabled={meta.page <= 1} onClick={() => setPage(meta.page - 1)}>Previous</Button>
          <Button size="sm" disabled={meta.page >= meta.last_page} onClick={() => setPage(meta.page + 1)}>Next</Button>
        </div>
      ) : null}
    </section>
  );
}

/** A meeting's day as the home's date badge shows it: "Oct" over "13", on the reader's calendar. */
export function badgeOf(start: string): [string, string] {
  const ymd = dayKey(parseTs(start));
  const d = new Date(`${ymd}T12:00:00Z`);
  return [d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }), String(d.getUTCDate())];
}

function Row({ m, onOpen }: { m: Meeting; onOpen: () => void }) {
  const [month, date] = badgeOf(m.start_at);
  const live = m.live_status === 'ongoing';
  const [status, tone] = rowChip(m);
  return (
    <button type="button" onClick={onOpen} className={cx('flex items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-0', live ? 'bg-selection' : 'hover:bg-subtle')}>
      <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] border border-line bg-subtle leading-none">
        <span className="text-[10px] font-semibold uppercase text-ink-3">{month}</span>
        <b className="text-[16px] text-ink">{date}</b>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="truncate text-ink">{m.title}</b>
        <span className="truncate text-[12px] text-ink-3">
          {m.source ? (
            <span className="mr-1 rounded-full bg-selection px-1.5 py-px text-[11px] font-semibold text-primary">
              {m.source.kind_label}
              {m.source.label ? ` · ${m.source.label}` : ''}
            </span>
          ) : null}
          {timeLabel(m.start_at)} – {timeLabel(m.end_at)} · {m.where || providerLabel(m)} · <span className={cx('font-semibold', TYPE_COLOUR[m.type] ?? 'text-ink-2')}>{typeLabel(m.type)}</span>
        </span>
      </span>
      <Chip tone={tone}>{status}</Chip>
    </button>
  );
}

function Invitations({ onOpen, compact }: { onOpen: (id: number) => void; compact?: boolean }) {
  const qc = useQueryClient();
  const list = useMeetings('upcoming');
  const answer = useMutation({
    mutationFn: ({ id, rsvp }: { id: number; rsvp: Rsvp }) => apiPost(`/api/meetings/${id}/rsvp`, { rsvp }),
    // Its count here, Home's Waiting for me and the Calendar drop it together (#97).
    onSuccess: () => invitationsChanged(qc),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const rows = (list.data?.rows ?? []).filter((m) => m.my_rsvp === 'no_response' && m.my_role !== 'organizer' && m.can?.rsvp !== false);
  return (
    <section className="flex flex-col rounded-[12px] border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-3 text-[15px] font-bold text-ink">{compact ? 'Invitations' : 'Awaiting your answer'}</h2>
      {list.isLoading ? <div className="p-4"><Spinner /></div> : null}
      {!list.isLoading && !rows.length ? <p className="px-4 py-3 text-ink-3">{compact ? 'Nothing waiting on you.' : 'You have answered every invitation.'}</p> : null}
      {rows.map((m) =>
        compact ? (
          <CompactInvitation key={m.id} m={m} busy={answer.isPending} onOpen={onOpen} send={(rsvp) => answer.mutateAsync({ id: m.id, rsvp })} />
        ) : (
          <InvitationRow key={m.id} m={m} busy={answer.isPending} onOpen={onOpen} send={(rsvp) => answer.mutateAsync({ id: m.id, rsvp })} />
        ),
      )}
    </section>
  );
}

/**
 * An invitation on the home (D01): Going in one click — unless it clashes with something already yours, when it
 * says with what and offers Review, which opens the meeting to answer it there.
 */
function CompactInvitation({ m, busy, onOpen, send }: { m: Meeting; busy: boolean; onOpen: (id: number) => void; send: (rsvp: Rsvp) => Promise<unknown> }) {
  const invitation = useInvitationAnswer('meeting', m.id, (r) => send(r as Rsvp));
  const clash = invitation.waiting?.conflicts[0] ?? null;
  const [time, day] = whenParts(m.start_at);
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 last:border-0">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <button type="button" onClick={() => onOpen(m.id)} className="truncate text-left font-bold text-ink hover:underline">{m.title}</button>
        {clash ? (
          <span className="truncate text-[12px] text-[#9A4A06] dark:text-warning">Clashes with {clash.busy_only ? 'something else' : (clash.title ?? 'something else')}</span>
        ) : (
          <span className="text-[12px] text-ink-3">{day} · {time}</span>
        )}
      </span>
      {clash ? (
        <Button size="sm" onClick={() => onOpen(m.id)}>Review</Button>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => void invitation.answer('accepted')}>{RSVP_LABEL.accepted}</Button>
      )}
      {invitation.dialogs}
    </div>
  );
}

/** An invitation waiting for your answer, flagged when it overlaps something you already have (worksuite-desktop#99). */
function InvitationRow({ m, busy, onOpen, send }: { m: Meeting; busy: boolean; onOpen: (id: number) => void; send: (rsvp: Rsvp) => Promise<unknown> }) {
  const invitation = useInvitationAnswer('meeting', m.id, (r) => send(r as Rsvp));
  const [time, day] = whenParts(m.start_at);
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-4 py-2.5 last:border-0">
      <button type="button" onClick={() => onOpen(m.id)} className="text-left font-bold text-ink hover:underline">{m.title}</button>
      <span className="text-[12px] text-ink-3">{day} · {time} · {m.where || providerLabel(m)}{m.organizer ? ` · from ${m.organizer}` : ''}</span>
      {invitation.flag ? <span className="flex">{invitation.flag}</span> : null}
      <div className="flex flex-wrap gap-1.5">
        {(['accepted', 'tentative', 'declined'] as Rsvp[]).map((r) => (
          <button key={r} type="button" disabled={busy} onClick={() => void invitation.answer(r)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', r === 'accepted' ? 'bg-primary text-white' : 'border border-line text-ink hover:bg-subtle')}>
            {RSVP_LABEL[r]}
          </button>
        ))}
        {invitation.propose ? (
          <button type="button" onClick={invitation.propose} className="h-7 px-1 text-[12px] font-semibold text-primary hover:underline">
            Propose new time
          </button>
        ) : null}
      </div>
      {invitation.dialogs}
    </div>
  );
}

function MyActions({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['meetings', 'action-items'],
    queryFn: ({ signal }) => apiGet<{ action_items: Array<{ id: number; meeting_id: number; meeting: string; title: string; due_date: string | null; status: string; task_id: number | null; mine: boolean }> }>('/api/meetings/action-items', undefined, signal),
  });
  const rows = (q.data?.action_items ?? []).filter((a) => a.mine && a.status !== 'done' && a.status !== 'cancelled').slice(0, 6);
  // An action item that became a task is done when its task is.
  const done = async (taskId: number, title: string) => {
    const r = await call('offline:submit', { module: 'tasks', entity: 'task', entityId: String(taskId), label: `Complete “${title}”`, method: 'PATCH', path: `/api/tasks/${taskId}`, body: { field: 'status', value: 'done' }, queueIfOffline: true });
    if (!r.delivered && !r.queued) toast('error', r.error ?? 'Could not complete the task.');
    void qc.invalidateQueries({ queryKey: ['meetings'] });
  };
  const today = todayInZone();
  return (
    <section className="flex flex-col rounded-[12px] border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-3 text-[15px] font-bold text-ink">Your action items</h2>
      {q.isLoading ? <div className="p-4"><Spinner /></div> : null}
      {!q.isLoading && !rows.length ? <p className="px-4 py-3 text-ink-3">Nothing assigned to you.</p> : null}
      {rows.map((a) => (
        <label key={a.id} className="flex items-start gap-2 border-b border-line px-4 py-2.5 last:border-0">
          <Checkbox disabled={!a.task_id} title={a.task_id ? 'Mark done' : 'The organiser closes this one'} onChange={() => a.task_id && void done(a.task_id, a.title)} className="mt-0.5" />
          <span className="flex min-w-0 flex-col">
            <b className="text-ink">{a.title}</b>
            <button type="button" onClick={() => onOpen(a.meeting_id)} className="text-left text-[11.5px] text-ink-3 hover:underline">
              From: {a.meeting}
            </button>
          </span>
          {a.due_date ? <span className={cx('ml-auto shrink-0 text-[12px]', a.due_date.slice(0, 10) <= today ? 'font-semibold text-danger' : 'text-ink-3')}>{a.due_date.slice(0, 10) === today ? 'Today' : dateLabel(a.due_date)}</span> : null}
        </label>
      ))}
    </section>
  );
}

function RoomsToday({ all }: { all?: boolean }) {
  const q = useQuery({ queryKey: ['meetings', 'rooms'], queryFn: ({ signal }) => apiGet<{ rooms: MeetingRoom[] }>('/api/meetings/rooms', undefined, signal), refetchInterval: 60_000 });
  const rooms = (q.data?.rooms ?? []).filter((r) => r.is_active);
  return (
    <section className="flex flex-col rounded-[12px] border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-3 text-[15px] font-bold text-ink">{all ? 'Meeting rooms' : 'Rooms today'}</h2>
      {q.isLoading ? <div className="p-4"><Spinner /></div> : q.error ? <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
      {!q.isLoading && !rooms.length ? <p className="px-4 py-3 text-ink-3">No meeting rooms are set up.</p> : null}
      {rooms.map((r) => {
        const [text, tone] = (r.in_use ? [`In use${r.current ? ` until ${timeLabel(r.current.until)}` : ''}`, 'danger'] : r.next ? [`Busy ${timeLabel(r.next.at)}`, 'warning'] : ['Free', 'success']) as [string, 'danger' | 'warning' | 'success'];
        return (
          <div key={r.id} className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[12.5px] last:border-0">
            <span className="min-w-0 flex-1 truncate">
              <b className="text-ink">{r.name}</b>
              <span className="text-ink-3"> · {[r.capacity ? `${r.capacity} seats` : null, r.floor ? `Floor ${r.floor}` : null, all ? r.amenities : null].filter(Boolean).join(' · ')}</span>
            </span>
            <Chip tone={tone}>{text}</Chip>
          </div>
        );
      })}
    </section>
  );
}

