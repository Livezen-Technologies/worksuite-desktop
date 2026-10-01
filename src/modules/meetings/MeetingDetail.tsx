import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCanOpen } from '../../core/access';
import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes, dateLabel, parseTs, relative, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Chip, Empty, ErrorNote, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { useNow } from '../calls/parts';
import { openMeeting } from '../meet/api';
import type { Stroke } from '../meet/session';
import { providerLabel, RSVP_LABEL, typeLabel, type AgendaItem, type Detail, type Person, type Rsvp } from './api';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';

const TABS = ['Summary', 'Agenda', 'People', 'Minutes', 'Files', 'Board', 'Activity'] as const;
type Tab = (typeof TABS)[number];

const MAY: Array<[string, string]> = [
  ['speak', 'Speak'],
  ['share_screen', 'share their screen'],
  ['upload', 'upload'],
  ['edit_agenda', 'edit the agenda'],
  ['edit_minutes', 'edit minutes'],
  ['create_actions', 'create actions'],
];

const ROLE: Record<string, string> = { organizer: 'Organiser', host: 'Host', presenter: 'Presenter', required: 'Required attendee', optional: 'Optional attendee' };

/** Seconds spent on an item: what was banked, plus the stretch running now. */
export function elapsedOf(item: AgendaItem, now: number): number {
  const banked = item.elapsed_seconds ?? 0;
  if (item.status !== 'running' || !item.started_at) return banked;
  return banked + Math.max(0, (now - parseTs(item.started_at).getTime()) / 1000);
}

function mmss(s: number): string {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

export function MeetingDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { navigate } = useTab();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  // Its conversation is in Chat and its video call in Meet: each offered only to whoever has that app.
  const canChat = useCanOpen('chat');
  const canMeet = useCanOpen('meet');
  const [tab, setTab] = useState<Tab>('Agenda');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['meetings', 'detail', id], queryFn: ({ signal }) => apiGet<Detail>(`/api/meetings/${id}`, undefined, signal), refetchInterval: 30_000 });
  useTabTitle(q.data ? `Meeting · ${q.data.meeting.title}` : 'Meeting');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['meetings'] });
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      refresh();
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const m = d.meeting;
  const mine = d.participants.find((p) => p.user_id === me) ?? null;
  const organiser = m.organizer_id === me;
  const canEdit = organiser || d.can.manage || mine?.role === 'host';
  const joinable = m.live_status !== 'cancelled' && m.live_status !== 'completed' && (m.meet_uuid ? canMeet : m.online_url);
  const rsvps = d.participants.reduce<Record<string, number>>((n, p) => ((n[p.rsvp] = (n[p.rsvp] ?? 0) + 1), n), {});
  const btn = 'h-9 rounded-[8px] border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle';

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <main className="flex flex-col gap-4 px-7 py-6 text-[13px]">
        <button type="button" onClick={onBack} className="self-start font-semibold text-primary hover:underline">‹ Meetings</button>
        <div className="flex flex-wrap items-start gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold text-ink">{m.title}</h1>
              <Chip tone="indigo">{typeLabel(m.type)}</Chip>
              {m.priority === 'high' || m.priority === 'urgent' ? <Chip tone="danger">{m.priority === 'urgent' ? 'Urgent' : 'High priority'}</Chip> : null}
              {m.live_status === 'ongoing' ? <Chip tone="danger">Happening now</Chip> : m.live_status === 'cancelled' ? <Chip>Cancelled</Chip> : m.live_status === 'completed' ? <Chip tone="success">Completed</Chip> : null}
            </div>
            <span className="text-ink-2">
              {dateLabel(m.start_at)} {timeLabel(m.start_at)}–{timeLabel(m.end_at)} · {m.where || providerLabel(m)} · {organiser ? 'organised by you' : `organised by ${m.organizer ?? 'someone'}`}
              {m.project ? ` · Project: ${m.project}` : ''}
            </span>
          </div>
          {d.chat?.room_id && canChat ? <button type="button" className={btn} onClick={() => navigate(`/chat?room=${d.chat!.room_id}`)}>Open in Chat</button> : null}
          {canEdit ? <button type="button" className={btn} title="Opens on the web" onClick={() => void call('app:openInBrowser', { path: `/meetings?meeting=${m.id}` })}>Edit ↗</button> : null}
          {canEdit && m.live_status !== 'cancelled' && m.live_status !== 'completed' ? (
            <button type="button" className="h-9 rounded-[8px] border border-[#F1B8A8] bg-surface px-3 font-semibold text-danger hover:bg-danger-bg" onClick={() => setCancelling(true)}>Cancel meeting</button>
          ) : null}
          {joinable ? (
            <button
              type="button"
              className="h-9 rounded-[8px] bg-primary px-4 font-bold text-white hover:bg-primary-hover"
              onClick={() => {
                void apiPost(`/api/meetings/${m.id}/attend`, { action: 'join' }).catch(() => undefined);
                if (m.meet_uuid) void openMeeting(m.meet_uuid, m.title);
                else if (m.online_url) void call('app:openExternal', { url: m.online_url });
              }}
            >
              Join
            </button>
          ) : null}
        </div>
        <div role="tablist" className="flex border-b border-line">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('h-10 px-3', tab === t ? 'font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]' : 'font-medium text-ink-2')}>
              {t}
            </button>
          ))}
        </div>
        <div className="grid items-start gap-4 [grid-template-columns:1fr_300px]">
          <section className="flex min-w-0 flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
            {tab === 'Summary' ? <SummaryTab d={d} /> : null}
            {tab === 'Agenda' ? <AgendaTab d={d} canEdit={canEdit || !!mine?.permissions?.edit_agenda} act={act} /> : null}
            {tab === 'People' ? <PeopleTab d={d} canEdit={canEdit} act={act} /> : null}
            {tab === 'Minutes' ? <MinutesTab d={d} canEdit={canEdit || !!mine?.permissions?.edit_minutes} act={act} /> : null}
            {tab === 'Files' ? <FilesTab d={d} act={act} /> : null}
            {tab === 'Board' ? <BoardTab uuid={m.meet_uuid} /> : null}
            {tab === 'Activity' ? <ActivityTab id={m.id} /> : null}
          </section>
          <aside className="flex flex-col gap-3">
            {mine && !organiser ? (
              <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5">
                <b className="text-ink">Your answer</b>
                <div className="flex gap-1.5">
                  {(['accepted', 'tentative', 'declined'] as Rsvp[]).map((r) => (
                    <button key={r} type="button" aria-pressed={mine.rsvp === r} onClick={() => void act(() => apiPost(`/api/meetings/${m.id}/rsvp`, { rsvp: r }))} className={cx('h-8 flex-1 rounded-[8px] text-[12px] font-semibold', mine.rsvp === r ? 'bg-primary text-white' : 'border border-line text-ink hover:bg-subtle')}>
                      {RSVP_LABEL[r]}
                    </button>
                  ))}
                </div>
                <span className="text-[12px] text-ink-3">Answers: {rsvps.accepted ?? 0} going · {rsvps.tentative ?? 0} maybe · {rsvps.no_response ?? 0} awaiting</span>
              </section>
            ) : (
              <section className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface p-3.5">
                <b className="text-ink">Answers</b>
                <span className="text-[12px] text-ink-2">{rsvps.accepted ?? 0} going · {rsvps.tentative ?? 0} maybe · {rsvps.declined ?? 0} not going · {rsvps.no_response ?? 0} awaiting</span>
              </section>
            )}
            <section className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface p-3.5">
              <b className="text-ink">Where</b>
              <span className="break-words text-ink">{m.where || providerLabel(m)}</span>
              {m.online_url && !(m.where ?? '').includes(m.online_url) ? <span className="truncate text-[12px] text-ink-3">Online: {m.online_url.replace(/^https?:\/\//, '')}</span> : null}
            </section>
            <section className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface p-3.5">
              <b className="text-ink">Files</b>
              <span className="text-[12px] text-ink-2">{d.files.length ? d.files.slice(0, 4).map((f) => f.filename).join(' · ') : 'None yet'}</span>
              <button type="button" className="self-start text-[12px] font-semibold text-primary hover:underline" onClick={() => setTab('Files')}>Add files</button>
            </section>
          </aside>
        </div>
      </main>
      {cancelling ? (
        <Modal
          title="Cancel this meeting?"
          onClose={() => setCancelling(false)}
          width={440}
          footer={
            <>
              <Button onClick={() => setCancelling(false)}>Keep it</Button>
              <Button variant="danger" onClick={() => (setCancelling(false), void act(() => apiPost(`/api/meetings/${m.id}/cancel`, { reason: reason.trim() || undefined }), 'Meeting cancelled; everyone is told.'))}>
                Cancel meeting
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
            Reason (sent with the cancellation)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2.5 font-normal outline-none focus:border-primary" />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<void>;

function SummaryTab({ d }: { d: Detail }) {
  const q = useQuery({ queryKey: ['meetings', 'summary', d.meeting.id], queryFn: ({ signal }) => apiGet<Record<string, number>>(`/api/meetings/${d.meeting.id}/summary`, undefined, signal) });
  const m = d.meeting;
  const facts: Array<[string, string | number | undefined]> = [
    ['Invited', q.data?.invited],
    ['Attended', q.data?.attended],
    ['Agenda items', q.data ? `${q.data.agenda_done ?? 0} of ${q.data.agenda ?? 0} done` : undefined],
    ['Planned', q.data ? `${q.data.planned_minutes ?? 0} min` : undefined],
    ['Actions', q.data ? `${q.data.actions_open ?? 0} open · ${q.data.actions_done ?? 0} done` : undefined],
    ['Tasks created', q.data?.tasks_created],
  ];
  return (
    <>
      <h2 className="text-[15px] font-bold text-ink">Summary</h2>
      <span className="text-ink-2">
        {typeLabel(m.type)} · priority {m.priority} · {m.recur_freq === 'none' ? 'does not repeat' : `repeats ${m.recur_freq}`}
        {m.project ? ` · Project ${m.project}` : ''}
        {m.client ? ` · ${m.client}` : ''}
      </span>
      {m.description ? <p className="whitespace-pre-wrap text-ink selectable">{m.description}</p> : null}
      {q.isLoading ? <Spinner /> : (
        <div className="grid grid-cols-3 gap-2">
          {facts.map(([k, v]) => (
            <div key={k} className="rounded-[10px] bg-subtle px-3 py-2">
              <span className="block text-[11.5px] text-ink-3">{k}</span>
              <b className="text-ink">{v ?? '—'}</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AgendaTab({ d, canEdit, act }: { d: Detail; canEdit: boolean; act: Act }) {
  const [adding, setAdding] = useState('');
  const now = useNow();
  const id = d.meeting.id;
  const planned = d.agenda.reduce((n, a) => n + (a.minutes || 0), 0);
  return (
    <>
      <div className="flex items-center">
        <h2 className="flex-1 text-[15px] font-bold text-ink">Agenda · {planned} of {d.meeting.duration_minutes} min planned</h2>
      </div>
      {!d.agenda.length ? <p className="text-ink-3">No agenda yet.</p> : null}
      {d.agenda.map((a, i) => {
        const status = a.status ?? 'pending';
        const spent = elapsedOf(a, now);
        return (
          <div key={a.id} className={cx('flex items-center gap-3 rounded-[10px] border px-3 py-2.5', status === 'running' ? 'border-primary bg-selection' : 'border-line')}>
            <span className={cx('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold', status === 'done' ? 'bg-success text-white' : status === 'running' ? 'bg-primary text-white' : 'bg-subtle text-ink-2')}>
              {status === 'done' ? '✓' : i + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className={cx('truncate text-ink', status === 'skipped' && 'line-through opacity-60')}>{a.title}</b>
              <span className="text-[11.5px] text-ink-3">{a.presenter ?? ''}</span>
            </span>
            <span className={cx('font-mono text-[12px]', status === 'running' ? 'font-semibold text-[#B45309] dark:text-warning' : 'text-ink-2')}>
              {spent > 0 || status === 'running' ? `${mmss(spent)} / ` : ''}{a.minutes} min
            </span>
            {canEdit ? (
              <span className="flex shrink-0 gap-2 text-[12px] font-semibold text-primary">
                {status === 'running' ? (
                  <>
                    <button type="button" className="hover:underline" onClick={() => void act(() => apiPost(`/api/meetings/${id}/agenda/${a.id}/timer`, { action: 'pause' }))}>Pause</button>
                    <button type="button" className="hover:underline" onClick={() => void act(() => apiPost(`/api/meetings/${id}/agenda/${a.id}/timer`, { action: 'done' }))}>Done</button>
                  </>
                ) : status === 'done' || status === 'skipped' ? (
                  <button type="button" className="text-ink-3 hover:underline" onClick={() => void act(() => apiPost(`/api/meetings/${id}/agenda/${a.id}/timer`, { action: 'reset' }))}>Reset</button>
                ) : (
                  <>
                    <button type="button" className="hover:underline" onClick={() => void act(() => apiPost(`/api/meetings/${id}/agenda/${a.id}/timer`, { action: 'start' }))}>{spent > 0 ? 'Resume' : 'Start this item'}</button>
                    <button type="button" className="text-ink-3 hover:underline" onClick={() => void act(() => apiPost(`/api/meetings/${id}/agenda/${a.id}/timer`, { action: 'skip' }))}>Skip</button>
                  </>
                )}
              </span>
            ) : null}
          </div>
        );
      })}
      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const title = adding.trim();
            if (!title) return;
            setAdding('');
            void act(() => apiPost(`/api/meetings/${id}/agenda`, { title }));
          }}
        >
          <input value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add an agenda item" placeholder="Add an agenda item" className="h-9 w-full rounded-[8px] border border-dashed border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
        </form>
      ) : null}
    </>
  );
}

function PeopleTab({ d, canEdit, act }: { d: Detail; canEdit: boolean; act: Act }) {
  const id = d.meeting.id;
  const [q, setQ] = useState('');
  const cands = useQuery({
    queryKey: ['meetings', 'candidates', id, q.trim()],
    queryFn: ({ signal }) => apiGet<Record<'users' | 'contacts' | 'departments', Array<{ key: string; kind: string; id: number; name: string; sub: string | null; taken: boolean }>>>(`/api/meetings/${id}/people/candidates`, { q: q.trim() }, signal),
    enabled: canEdit && q.trim().length >= 2,
  });
  const options = cands.data ? [...cands.data.users, ...cands.data.contacts, ...cands.data.departments].filter((c) => !c.taken).slice(0, 8) : [];
  const may = (p: Person) => {
    if (p.role === 'organizer' || p.role === 'host') return 'Speak, share, record';
    const perms = p.permissions;
    if (!perms) return 'Speak';
    const yes = MAY.filter(([k]) => perms[k] !== false).map(([, v]) => v);
    return yes.length ? yes.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'View only';
  };
  return (
    <>
      <div className="relative flex items-center gap-2">
        <h2 className="flex-1 text-[15px] font-bold text-ink">People · attendance</h2>
        {canEdit ? <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Add people" placeholder="Search people, contacts or departments" className="h-8 w-72 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-primary" /> : null}
        {options.length ? (
          <div className="absolute top-full right-0 z-10 mt-1 w-72 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
            {options.map((c) => (
              <button key={c.key} type="button" onClick={() => (setQ(''), void act(() => apiPost(`/api/meetings/${id}/people`, { people: [{ kind: c.kind, id: c.id }], role: 'required' }), `${c.name} added.`))} className="block w-full px-3 py-1.5 text-left hover:bg-subtle">
                <b className="text-ink">{c.name}</b> <span className="text-[11.5px] text-ink-3">{c.sub ?? c.kind}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-[1.4fr_1fr_1.3fr_120px] gap-2 border-b border-line pb-1.5 text-[11px] font-bold tracking-[0.5px] text-ink-3">
        <span>ATTENDEE</span>
        <span>ROLE</span>
        <span>THEY MAY</span>
        <span>ATTENDANCE</span>
      </div>
      {d.participants.map((p) => (
        <div key={p.id} className="grid grid-cols-[1.4fr_1fr_1.3fr_120px] items-center gap-2 border-b border-line py-1.5 last:border-0">
          <span className="flex min-w-0 flex-col">
            <b className="truncate text-ink">{p.name || p.email}</b>
            <span className="truncate text-[11.5px] text-ink-3">{p.external ? `${p.email ?? ''} · guest` : RSVP_LABEL[p.rsvp]}</span>
          </span>
          <span className="text-ink">{ROLE[p.role] ?? p.role}</span>
          <span className="text-[12px] text-ink-2">{may(p)}</span>
          <Select
            aria-label={`Attendance for ${p.name || p.email}`}
            disabled={!canEdit}
            value={p.attendance ?? ''}
            onChange={(e) => void act(() => apiPut(`/api/meetings/${id}/people/${p.id}`, { attendance: e.target.value || null }))}
            className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink disabled:opacity-70"
          >
            <option value="">—</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
            <option value="excused">Excused</option>
          </Select>
        </div>
      ))}
    </>
  );
}

function MinutesTab({ d, canEdit, act }: { d: Detail; canEdit: boolean; act: Act }) {
  const id = d.meeting.id;
  const [summary, setSummary] = useState(d.minutes?.summary ?? '');
  const [decisions, setDecisions] = useState(d.minutes?.decisions ?? '');
  const [notes, setNotes] = useState(d.minutes?.notes ?? '');
  const [picked, setPicked] = useState<number[]>(() => d.action_items.filter((a) => !a.task_id).map((a) => a.id));
  const [action, setAction] = useState('');
  const final = !!d.minutes?.finalised_at;
  const area = 'rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary disabled:bg-subtle';
  const save = useMutation({
    mutationFn: (finalise: boolean) => apiPut(`/api/meetings/${id}/minutes`, { summary, decisions, notes, finalise }),
    onSuccess: (_r, finalise) => toast('success', finalise ? 'Minutes finalised.' : 'Notes saved.'),
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[15px] font-bold text-ink">Minutes</h2>
        {final ? <Chip tone="success">Final · {dateLabel(d.minutes!.finalised_at)}</Chip> : null}
      </div>
      <b className="text-ink">Decisions</b>
      <textarea value={decisions} disabled={!canEdit || final} onChange={(e) => setDecisions(e.target.value)} rows={3} className={area} />
      <b className="text-ink">Discussion summary</b>
      <textarea value={summary} disabled={!canEdit || final} onChange={(e) => setSummary(e.target.value)} rows={3} className={area} />
      <b className="text-ink">Notes</b>
      <textarea value={notes} disabled={!canEdit || final} onChange={(e) => setNotes(e.target.value)} rows={3} className={area} />
      <b className="text-ink">Actions</b>
      {!d.action_items.length ? <p className="text-ink-3">No actions yet.</p> : null}
      {d.action_items.map((a) => (
        <label key={a.id} className="flex items-center gap-2.5">
          <Checkbox disabled={!!a.task_id || !canEdit} checked={!!a.task_id || picked.includes(a.id)} onChange={() => setPicked(picked.includes(a.id) ? picked.filter((x) => x !== a.id) : [...picked, a.id])} />
          <span className={cx('flex-1 text-ink', a.status === 'done' && 'line-through opacity-60')}>{a.title}</span>
          <span className="text-[12px] text-ink-3">{[a.assignee, a.due_date ? dateLabel(a.due_date) : null, a.task_id ? 'task' : null].filter(Boolean).join(' · ')}</span>
          {canEdit && !a.task_id ? <button type="button" aria-label={`Remove ${a.title}`} onClick={() => void act(() => apiDelete(`/api/meetings/${id}/actions/${a.id}`))} className="text-ink-3 hover:text-danger">×</button> : null}
        </label>
      ))}
      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!action.trim()) return;
            const title = action.trim();
            setAction('');
            void act(() => apiPost(`/api/meetings/${id}/actions`, { title, priority: 'normal', status: 'open' }));
          }}
        >
          <input value={action} onChange={(e) => setAction(e.target.value)} aria-label="Add an action" placeholder="Add an action" className="h-9 w-full rounded-[8px] border border-dashed border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
        </form>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button disabled={!picked.filter((x) => d.action_items.some((a) => a.id === x && !a.task_id)).length} onClick={() => void act(() => apiPost(`/api/meetings/${id}/actions/bulk-task`, { ids: picked }), 'Tasks created.')}>
            Create actions as tasks
          </Button>
          {!final ? (
            <>
              <Button loading={save.isPending} onClick={() => save.mutate(false)}>Save notes</Button>
              <Button variant="primary" onClick={() => save.mutate(true)}>Finalise minutes</Button>
            </>
          ) : (
            <Button onClick={() => void act(() => apiPost(`/api/meetings/${id}/summary`), 'Minutes emailed to everyone.')}>Email the minutes</Button>
          )}
        </div>
      ) : null}
    </>
  );
}

function FilesTab({ d, act }: { d: Detail; act: Act }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const form = new FormData();
      form.append('file', f, f.name);
      form.append('kind', 'attachment');
      void act(() => request('POST', `/api/meetings/${d.meeting.id}/files`, { body: form }), `${f.name} uploaded.`);
    }
  };
  return (
    <div
      className="flex flex-col gap-2"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      <h2 className="text-[15px] font-bold text-ink">Files</h2>
      {!d.files.length ? <Empty icon="file" title="No files yet" hint="Drag files here or upload them." /> : null}
      {d.files.map((f) => (
        <div key={f.id} className="flex items-center gap-2.5 rounded-[9px] border border-line px-3 py-2">
          <FileBadge name={f.filename} size={30} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{f.filename}</b>
            <span className="text-[11.5px] text-ink-3">{bytes(f.size)} · {relative(f.at)}</span>
          </span>
        </div>
      ))}
      <input ref={input} type="file" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
      <button type="button" onClick={() => input.current?.click()} className="h-9 self-start rounded-[8px] border border-line px-3 font-semibold text-ink hover:bg-subtle">Upload files</button>
    </div>
  );
}

function BoardTab({ uuid }: { uuid: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const q = useQuery({ queryKey: ['meet', 'board', uuid], queryFn: ({ signal }) => apiGet<{ strokes: Stroke[] | null; updated_at: string | null }>(`/api/meet/${uuid}/whiteboard`, undefined, signal), enabled: !!uuid, retry: false });
  const strokes = q.data?.strokes;
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * devicePixelRatio);
    c.height = Math.round(height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    for (const s of strokes ?? []) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)));
      ctx.stroke();
    }
  }, [strokes]);
  if (!uuid) return <Empty icon="grid" title="No whiteboard" hint="Meetings held on the built-in Meet keep their whiteboard here." />;
  return (
    <>
      <h2 className="text-[15px] font-bold text-ink">Board</h2>
      <span className="text-ink-3">The whiteboard used during the meeting{q.data?.updated_at ? `, as saved ${relative(q.data.updated_at)}` : ''}.</span>
      {q.isLoading ? <Spinner /> : !strokes?.length ? <p className="text-ink-3">Nothing was drawn.</p> : null}
      <canvas ref={canvas} aria-label="Saved whiteboard" className={cx('aspect-[16/10] w-full rounded-[10px] border border-line bg-white', !strokes?.length && 'hidden')} />
    </>
  );
}

function ActivityTab({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['meetings', 'activity', id], queryFn: ({ signal }) => apiGet<{ activity: Array<{ id: number; description: string; who: string | null; created_at: string }> }>(`/api/meetings/${id}/activity`, undefined, signal) });
  return (
    <>
      <h2 className="text-[15px] font-bold text-ink">Activity</h2>
      {q.isLoading ? <Spinner /> : null}
      {(q.data?.activity ?? []).map((a) => (
        <div key={a.id} className="flex gap-2 border-b border-line py-1.5 last:border-0">
          <span className="flex-1 text-ink">{a.who ? <b>{a.who} </b> : null}{a.description}</span>
          <span className="shrink-0 text-[12px] text-ink-3">{relative(a.created_at)}</span>
        </div>
      ))}
      {!q.isLoading && !q.data?.activity.length ? <p className="text-ink-3">Nothing yet.</p> : null}
    </>
  );
}
