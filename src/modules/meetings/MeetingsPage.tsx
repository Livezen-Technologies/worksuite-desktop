import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ModuleProps } from '../registry';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { addDays, dateLabel, dayKey, parseTs, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { providerLabel, RSVP_LABEL, TYPE_COLOUR, TYPES, typeLabel, type Can, type Meeting, type MeetingRoom, type Rsvp } from './api';
import { MeetingDetail } from './MeetingDetail';
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
  const tab = (TABS.find(([k]) => k === query.get('tab'))?.[0] ?? 'dashboard') as Tab;
  const [q, setQ] = useState('');
  const [scheduling, setScheduling] = useState(false);
  useTabTitle(selected ? null : 'Meetings');
  const dash = useQuery({ queryKey: ['meetings', 'dashboard'], queryFn: ({ signal }) => apiGet<Dashboard>('/api/meetings/dashboard', undefined, signal), refetchInterval: 60_000 });

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
            <div className="grid gap-4 [grid-template-columns:1.6fr_1fr]">
              <MeetingList scope="upcoming" q={q} title="Upcoming meetings" typeFilter onOpen={(id) => go(`/meetings?meeting=${id}`)} />
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

function useMeetings(scope: string, source = '') {
  return useQuery({
    queryKey: ['meetings', 'list', scope, source],
    queryFn: ({ signal }) => apiGet<{ meetings: Meeting[]; can: Can }>('/api/meetings', source ? { scope, source } : { scope }, signal),
    refetchInterval: 60_000,
  });
}

function MeetingList({ scope, q, title, typeFilter, onOpen }: { scope: string; q: string; title: string; typeFilter?: boolean; onOpen: (id: number) => void }) {
  const list = useMeetings(scope);
  const [type, setType] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = (list.data?.meetings ?? []).filter((m) => (!type || m.type === type) && (!needle || [m.title, m.meeting_no, m.where ?? ''].some((v) => v.toLowerCase().includes(needle))));
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
      <div className="flex items-center">
        <h2 className="flex-1 text-[15px] font-bold text-ink">{title}</h2>
        {typeFilter ? (
          <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
            <option value="">Any type</option>
            {TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        ) : null}
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {!list.isLoading && !rows.length ? <Empty icon="calendar-clock" title="No meetings here" /> : null}
      {rows.map((m) => <Row key={m.id} m={m} onOpen={() => onOpen(m.id)} />)}
    </section>
  );
}

function statusOf(m: Meeting): [string, string] {
  if (m.live_status === 'ongoing') return ['Happening now', 'text-danger'];
  if (m.live_status === 'cancelled') return ['Cancelled', 'text-ink-3'];
  if (m.my_role === 'organizer' || m.my_role === 'host') return ['You host', 'text-primary'];
  const r = (m.my_rsvp ?? 'no_response') as Rsvp;
  return [RSVP_LABEL[r], r === 'accepted' ? 'text-success' : r === 'declined' ? 'text-ink-3' : 'text-[#9A4A06] dark:text-warning'];
}

function Row({ m, onOpen }: { m: Meeting; onOpen: () => void }) {
  const [time, day] = whenParts(m.start_at);
  const live = m.live_status === 'ongoing';
  const [status, tone] = statusOf(m);
  return (
    <button type="button" onClick={onOpen} className={cx('flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left', live ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}>
      <span className="flex w-[84px] shrink-0 flex-col">
        <b className="text-ink">{time}</b>
        <span className="text-[11.5px] text-ink-3">{day}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-ink">{m.title}</b>
        <span className="truncate text-[11.5px] text-ink-3">
          {m.source ? (
            <span className="mr-1 rounded-full bg-selection px-1.5 py-px text-[11px] font-semibold text-primary">
              {m.source.kind_label}
              {m.source.label ? ` · ${m.source.label}` : ''}
            </span>
          ) : null}
          <span className={cx('font-semibold', TYPE_COLOUR[m.type] ?? 'text-ink-2')}>{typeLabel(m.type)}</span> · {m.where || '—'}
        </span>
      </span>
      <span className="hidden w-40 shrink-0 truncate text-[12px] text-ink-2 xl:block">{providerLabel(m)}</span>
      <span className={cx('w-28 shrink-0 text-right text-[12px] font-semibold', tone)}>{status}</span>
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
  const rows = (list.data?.meetings ?? []).filter((m) => m.my_rsvp === 'no_response' && m.my_role !== 'organizer');
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
      <h2 className="text-[15px] font-bold text-ink">Awaiting your answer</h2>
      {list.isLoading ? <Spinner /> : null}
      {!list.isLoading && !rows.length ? <p className="text-ink-3">{compact ? 'Nothing waiting on you.' : 'You have answered every invitation.'}</p> : null}
      {rows.map((m) => (
        <InvitationRow key={m.id} m={m} busy={answer.isPending} onOpen={onOpen} send={(rsvp) => answer.mutateAsync({ id: m.id, rsvp })} />
      ))}
    </section>
  );
}

/** An invitation waiting for your answer, flagged when it overlaps something you already have (worksuite-desktop#99). */
function InvitationRow({ m, busy, onOpen, send }: { m: Meeting; busy: boolean; onOpen: (id: number) => void; send: (rsvp: Rsvp) => Promise<unknown> }) {
  const invitation = useInvitationAnswer('meeting', m.id, (r) => send(r as Rsvp));
  const [time, day] = whenParts(m.start_at);
  return (
    <div className="flex flex-col gap-1.5 border-b border-line pb-2.5 last:border-0">
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
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
      <h2 className="text-[15px] font-bold text-ink">Your action items</h2>
      {q.isLoading ? <Spinner /> : null}
      {!q.isLoading && !rows.length ? <p className="text-ink-3">Nothing assigned to you.</p> : null}
      {rows.map((a) => (
        <label key={a.id} className="flex items-start gap-2">
          <Checkbox disabled={!a.task_id} title={a.task_id ? 'Mark done' : 'The organiser closes this one'} onChange={() => a.task_id && void done(a.task_id, a.title)} className="mt-0.5" />
          <span className="flex min-w-0 flex-col">
            <b className="text-ink">{a.title}</b>
            <button type="button" onClick={() => onOpen(a.meeting_id)} className="text-left text-[11.5px] text-ink-3 hover:underline">
              From: {a.meeting}{a.due_date ? ` · due ${dateLabel(a.due_date)}` : ''}
            </button>
          </span>
        </label>
      ))}
    </section>
  );
}

function RoomsToday({ all }: { all?: boolean }) {
  const q = useQuery({ queryKey: ['meetings', 'rooms'], queryFn: ({ signal }) => apiGet<{ rooms: MeetingRoom[] }>('/api/meetings/rooms', undefined, signal), refetchInterval: 60_000 });
  const rooms = (q.data?.rooms ?? []).filter((r) => r.is_active);
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
      <h2 className="text-[15px] font-bold text-ink">{all ? 'Meeting rooms' : 'Meeting rooms today'}</h2>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !rooms.length ? <p className="text-ink-3">No meeting rooms are set up.</p> : null}
      {rooms.map((r) => {
        const [text, tone] = r.in_use ? [`In use${r.current ? ` until ${timeLabel(r.current.until)}` : ''}`, 'text-danger'] : r.next ? [`Booked ${timeLabel(r.next.at)}`, 'text-[#9A4A06] dark:text-warning'] : ['Free', 'text-success'];
        return (
          <div key={r.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              <b className="text-ink">{r.name}</b>
              <span className="text-ink-3"> · {[r.capacity ? `${r.capacity} seats` : null, r.floor ? `Floor ${r.floor}` : null, all ? r.amenities : null].filter(Boolean).join(' · ')}</span>
            </span>
            <span className={cx('text-[12px] font-semibold', tone)}>{text}</span>
          </div>
        );
      })}
    </section>
  );
}

