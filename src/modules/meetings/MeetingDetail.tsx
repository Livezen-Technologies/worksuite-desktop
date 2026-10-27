import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCanOpen } from '../../core/access';
import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes, dateLabel, relative, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Chip, Empty, ErrorNote, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { useNow } from '../../components/CallKit';
import { openMeeting } from '../meet/api';
import { RecordingProgress } from '../meet/RecordingProgress';
import type { Stroke } from '../meet/session';
import { abilitiesOf, meetingProblem, openRelatedLabel, providerLabel, RSVP_LABEL, serverAbilities, typeLabel, zoneNote, type Delivery, type Detail, type MeetingAbilities, type Person, type Rsvp } from './api';
import { elapsedOf, mmss } from './agenda';
import { Select } from '../../components/Select';
import { MinutesEditor } from './minutes/MinutesEditor';
import { TranscriptsTab } from './transcripts/TranscriptsTab';
import { QaPollsTab } from './QaPollsTab';
import { latestTranscriptText } from './transcripts/material';
import { invitationsChanged, useInvitationAnswer } from '../calendar/conflicts';
import type { ChatMessage } from '../chat/types';

const TABS = ['Summary', 'Agenda', 'People', 'Minutes', 'Transcripts', 'Q&A & Polls', 'Files', 'Board', 'Activity'] as const;
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

export { elapsedOf };

/** Opens the always-on-top agenda window (D08) for a meeting; one window per meeting. */
export function openAgendaWindow(id: number, title: string): void {
  void call('windows:open', { kind: 'agenda', route: `/meetings?agenda=${id}`, title: `Agenda · ${title}`.slice(0, 200), alwaysOnTop: true }).catch((e) => toast('error', errorMessage(e)));
}

export function MeetingDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { navigate, query, openLink } = useTab();
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  // Its conversation is in Chat and its video call in Meet: each offered only to whoever has that app.
  const canChat = useCanOpen('chat');
  const canMeet = useCanOpen('meet');
  // A link may name the tab: `?tab=Transcripts`, or a transcript (`?transcript=`, from a transcript's email — #81).
  const [tab, setTab] = useState<Tab>(() => {
    const asked = query.get('tab') ?? (query.get('transcript') ? 'Transcripts' : null);
    return (TABS as readonly string[]).includes(asked ?? '') ? (asked as Tab) : 'Summary';
  });
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['meetings', 'detail', id], queryFn: ({ signal }) => apiGet<Detail>(`/api/meetings/${id}`, undefined, signal), refetchOnMount: 'always', refetchInterval: (query) => query.state.data?.recordings?.some(r => !['ready', 'failed'].includes(r.status)) ? 10_000 : 30_000 });
  useTabTitle(q.data ? `Meeting · ${q.data.meeting.title}` : 'Meeting');
  // A cancelled or moved meeting no longer overlaps anything: the calendar and its conflict answers are read again (#99),
  // and an answer here leaves Home's Waiting for me and Meetings' Invitations at once (#97).
  const refresh = () => invitationsChanged(qc);
  const act: Act = async (fn, done) => {
    try {
      await fn();
      if (done) toast('success', done);
      return true;
    } catch (e) {
      // The meeting moved on meanwhile — cancelled or completed elsewhere, or over (409, 410): said, and shown as it is now.
      const problem = meetingProblem(e);
      toast(problem ? 'info' : 'error', problem?.message ?? errorMessage(e));
      return false;
    } finally {
      refresh();
    }
  };
  // Your answer, when it is an invitation still waiting: accepting one that overlaps something asks first (#99).
  const invitation = useInvitationAnswer('meeting', id, (r) => act(() => apiPost(`/api/meetings/${id}/rsvp`, { rsvp: r })));
  // Propose time from an invitation's banner (D07) opens the meeting with its dialog.
  const proposeAsked = query.get('propose') === '1';
  const proposed = useRef(false);
  const propose = invitation.propose;
  useEffect(() => {
    if (proposeAsked && !proposed.current && propose) {
      proposed.current = true;
      propose();
    }
  }, [proposeAsked, propose]);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;
  const d = q.data;
  const m = d.meeting;
  const mine = d.participants.find((p) => p.user_id === me) ?? null;
  const organiser = m.organizer_id === me;
  // What this person may do here: the server's word when it gives it (MTG-U03), else as this app always worked it out.
  const can = abilitiesOf(m, { me, mine, manage: d.can.manage });
  const told = serverAbilities(m);
  const open = m.live_status !== 'cancelled' && m.live_status !== 'completed';
  const joinable = open && can.attend && (m.meet_uuid ? canMeet : m.online_url);
  // Booked on another clock (a tender's meeting, on the buyer's company's): the time there as well (#100).
  const booked = zoneNote(m.start_at, m.timezone);
  const btn = 'h-9 rounded-[8px] border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle';
  const status = (action: 'start' | 'complete') => act(() => apiPost(`/api/meetings/${m.id}/${action}`), action === 'start' ? 'Meeting started.' : 'Meeting completed.');
  const remove = async () => {
    setConfirm(null);
    if (await act(() => apiDelete(`/api/meetings/${m.id}`), 'Meeting deleted.')) onBack();
  };

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <main className="flex flex-col gap-4 px-7 py-6 text-[13px]">
        <button type="button" onClick={onBack} className="self-start font-semibold text-primary hover:underline">‹ Meetings</button>
        <div className="flex flex-wrap items-start gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold text-ink">{m.title}</h1>
              <Chip tone="indigo">{typeLabel(m.type)}</Chip>
              {m.source ? <Chip tone="teal">{m.source.kind_label}{m.source.label ? ` · ${m.source.label}` : ''}</Chip> : null}
              {m.priority === 'high' || m.priority === 'urgent' ? <Chip tone="danger">{m.priority === 'urgent' ? 'Urgent' : 'High priority'}</Chip> : null}
              {m.live_status === 'ongoing' ? <Chip tone="danger">Happening now</Chip> : m.live_status === 'cancelled' ? <Chip>Cancelled</Chip> : m.live_status === 'completed' ? <Chip tone="success">Completed</Chip> : m.live_status === 'draft' ? <Chip tone="warning">Draft</Chip> : null}
            </div>
            <span className="text-ink-2">
              {dateLabel(m.start_at)} {timeLabel(m.start_at)}–{timeLabel(m.end_at)}
              {booked ? ` (${booked})` : ''} · {m.where || providerLabel(m)} · {organiser ? 'organised by you' : `organised by ${m.organizer ?? 'someone'}`}
              {m.project ? ` · Project: ${m.project}` : ''}
            </span>
          </div>
          {/* The header offers only what this person may do (MTG-U03): each control behind its own flag. */}
          {m.source?.can_open && m.source.link ? (
            // The record it is about (#100, #101) — offered only to someone who may open it.
            <button type="button" className={btn} onClick={() => openLink(m.source!.link!)}>
              {openRelatedLabel(m.source)}
            </button>
          ) : null}
          {d.chat?.room_id && canChat ? <button type="button" className={btn} onClick={() => navigate(`/chat?room=${d.chat!.room_id}`)}>Open in Chat</button> : null}
          {can.edit ? <button type="button" className={btn} title="Opens on the web" onClick={() => void call('app:openInBrowser', { path: `/meetings?meeting=${m.id}` })}>Edit ↗</button> : null}
          {told && can.reschedule && open ? <button type="button" className={btn} title="Opens on the web" onClick={() => void call('app:openInBrowser', { path: `/meetings?meeting=${m.id}&reschedule=1` })}>Reschedule ↗</button> : null}
          {can.start ? <button type="button" className={btn} onClick={() => void status('start')}>Start</button> : null}
          {can.complete ? <button type="button" className={btn} onClick={() => void status('complete')}>Complete</button> : null}
          {can.cancel && open ? (
            <button type="button" className="h-9 rounded-[8px] border border-danger-line bg-surface px-3 font-semibold text-danger hover:bg-danger-bg" onClick={() => setConfirm('cancel')}>Cancel meeting</button>
          ) : null}
          {can.delete ? (
            <button type="button" className="h-9 rounded-[8px] border border-danger-line bg-surface px-3 font-semibold text-danger hover:bg-danger-bg" onClick={() => setConfirm('delete')}>Delete</button>
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
        {tab === 'Summary' ? (
          <SummaryTab d={d} can={can} mine={mine} invitation={invitation} act={act} onTab={setTab} />
        ) : (
          <section className="flex min-w-0 flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
            {tab === 'Agenda' ? <AgendaTab d={d} canRun={can.run_agenda && open} act={act} /> : null}
            {tab === 'People' ? <PeopleTab d={d} canInvite={can.invite && open} canMark={can.edit} act={act} /> : null}
            {tab === 'Minutes' ? <MinutesTab d={d} /> : null}
            {tab === 'Transcripts' ? <TranscriptsTab d={d} /> : null}
            {tab === 'Q&A & Polls' ? <QaPollsTab d={d} /> : null}
            {tab === 'Files' ? <FilesTab d={d} canUpload={can.upload} act={act} /> : null}
            {tab === 'Board' ? <BoardTab uuid={m.meet_uuid} /> : null}
            {tab === 'Activity' ? <ActivityTab id={m.id} /> : null}
          </section>
        )}
      </main>
      {confirm === 'cancel' ? (
        <Modal
          title="Cancel this meeting?"
          onClose={() => setConfirm(null)}
          width={440}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Keep it</Button>
              <Button variant="danger" onClick={() => (setConfirm(null), void act(() => apiPost(`/api/meetings/${m.id}/cancel`, { reason: reason.trim() || undefined }), 'Meeting cancelled; everyone is told.'))}>
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
      {confirm === 'delete' ? (
        <Modal
          title="Delete this meeting?"
          onClose={() => setConfirm(null)}
          width={440}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Keep it</Button>
              <Button variant="danger" onClick={() => void remove()}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">The meeting, its agenda, minutes and files are removed. People who were invited are not told; cancel it instead to tell them.</p>
        </Modal>
      ) : null}
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;
type Invitation = ReturnType<typeof useInvitationAnswer>;

const ANSWER_TONE: Record<Rsvp, 'success' | 'warning' | 'muted' | 'danger'> = { accepted: 'success', tentative: 'warning', declined: 'muted', no_response: 'danger' };

/**
 * The meeting's summary (D02): when, where, who runs it and what it is about; your answer; the agenda at a glance —
 * and beside them the invitation emails, your recording and the reminder this computer gives.
 */
function SummaryTab({ d, can, mine, invitation, act, onTab }: { d: Detail; can: MeetingAbilities; mine: Person | null; invitation: Invitation; act: Act; onTab: (t: Tab) => void }) {
  const q = useQuery({ queryKey: ['meetings', 'summary', d.meeting.id], queryFn: ({ signal }) => apiGet<Record<string, number>>(`/api/meetings/${d.meeting.id}/summary`, undefined, signal) });
  const m = d.meeting;
  const open = m.live_status !== 'cancelled' && m.live_status !== 'completed';
  const host = d.participants.find((p) => p.role === 'host' && p.user_id !== m.organizer_id);
  const rsvps = d.participants.reduce<Record<string, number>>((n, p) => ((n[p.rsvp] = (n[p.rsvp] ?? 0) + 1), n), {});
  const facts: Array<[string, string | number | undefined]> = [
    ['Invited', q.data?.invited],
    ['Attended', q.data?.attended],
    ['Agenda items', q.data ? `${q.data.agenda_done ?? 0} of ${q.data.agenda ?? 0} done` : undefined],
    ['Planned', q.data ? `${q.data.planned_minutes ?? 0} min` : undefined],
    ['Actions', q.data ? `${q.data.actions_open ?? 0} open · ${q.data.actions_done ?? 0} done` : undefined],
    ['Tasks created', q.data?.tasks_created],
  ];
  const card = 'flex flex-col rounded-[12px] border border-line bg-surface';
  const head = 'flex items-center gap-2 border-b border-line px-4 py-3';
  const kv: Array<[string, ReactNode]> = [
    ['When', <>{dateLabel(m.start_at)}, {timeLabel(m.start_at)} – {timeLabel(m.end_at)}{m.timezone ? ` · booked in ${m.timezone}` : ''}{m.recur_freq && m.recur_freq !== 'none' ? ` · repeats ${m.recur_freq}` : ''}</>],
    ['Where', <>{m.where || providerLabel(m)}{m.online_url && !(m.where ?? '').includes(m.online_url) ? ` · ${m.online_url.replace(/^https?:\/\//, '')}` : ''}</>],
    ['Organiser', <>{m.organizer ?? '—'}{host ? ` · host ${host.name ?? host.email}` : m.host && m.host !== m.organizer ? ` · host ${m.host}` : ''}</>],
  ];
  if (m.source) kv.push(['Related', <>{m.source.kind_label}{m.source.label ? ` · ${m.source.label}` : ''}</>]);
  if (m.project || m.client) kv.push(['For', [m.project ? `Project ${m.project}` : null, m.client].filter(Boolean).join(' · ')]);
  return (
    <div className="flex items-start gap-4">
      <div className="flex min-w-0 flex-[2] flex-col gap-3.5">
        <section className={cx(card, 'p-4')}>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
            {kv.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-ink-3">{k}</dt>
                <dd className="m-0 text-ink selectable">{v}</dd>
              </Fragment>
            ))}
          </dl>
          {m.description ? <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-ink selectable">{m.description}</p> : null}
        </section>
        {mine && can.rsvp ? (
          <section className={card} aria-label="Your answer">
            <div className={head}>
              <h2 className="flex-1 text-[15px] font-bold text-ink">Your answer</h2>
              <Chip tone={ANSWER_TONE[mine.rsvp]}>{mine.rsvp === 'no_response' ? 'Waiting for you' : RSVP_LABEL[mine.rsvp]}</Chip>
            </div>
            <div className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['accepted', 'tentative', 'declined'] as Rsvp[]).map((r) => (
                  <Button key={r} size="sm" variant={mine.rsvp === r ? 'primary' : 'secondary'} aria-pressed={mine.rsvp === r} disabled={!open} onClick={() => void invitation.answer(r)}>
                    {RSVP_LABEL[r]}
                  </Button>
                ))}
                {invitation.propose && open ? (
                  <Button size="sm" variant="ghost" onClick={invitation.propose}>
                    Propose new time
                  </Button>
                ) : null}
              </div>
              {invitation.flag}
              <span className="text-[12px] text-ink-3">Answers: {rsvps.accepted ?? 0} going · {rsvps.tentative ?? 0} maybe · {rsvps.no_response ?? 0} awaiting</span>
              {invitation.dialogs}
            </div>
          </section>
        ) : (
          <section className={cx(card, 'gap-1 px-4 py-3')}>
            <b className="text-ink">Answers</b>
            <span className="text-[12px] text-ink-2">{rsvps.accepted ?? 0} going · {rsvps.tentative ?? 0} maybe · {rsvps.declined ?? 0} not going · {rsvps.no_response ?? 0} awaiting</span>
          </section>
        )}
        <section className={card}>
          <div className={head}>
            <h2 className="flex-1 text-[15px] font-bold text-ink">Agenda</h2>
            {open && d.agenda.length ? <Button size="sm" onClick={() => openAgendaWindow(m.id, m.title)} title="A small window that stays on top, with the shared timer and quick notes">Agenda window</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => onTab('Agenda')}>Open agenda</Button>
          </div>
          {!d.agenda.length ? <p className="px-4 py-3 text-ink-3">No agenda yet.</p> : null}
          {d.agenda.map((a, i) => (
            <div key={a.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
              <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold', a.status === 'done' ? 'bg-success text-white' : a.status === 'running' ? 'bg-primary text-white' : 'bg-subtle text-ink-2')}>{a.status === 'done' ? '✓' : i + 1}</span>
              <span className={cx('min-w-0 flex-1 truncate text-ink', a.status === 'skipped' && 'line-through opacity-60')}>{a.title}</span>
              <span className="font-mono text-[12px] text-ink-2">{a.minutes}′</span>
            </div>
          ))}
        </section>
        <section className={cx(card, 'p-4')}>
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
        </section>
      </div>
      <aside className="flex min-w-0 flex-1 flex-col gap-3.5">
        {d.deliveries?.rows.length ? <Deliveries meetingId={m.id} rows={d.deliveries.rows} act={act} /> : null}
        {d.recordings?.length ? (
          <section className={card}>
            <h2 className={cx(head, 'text-[15px] font-bold text-ink')}>Recording</h2>
            <div className="flex flex-col gap-2 px-4 py-3">
              {d.recordings.map((r) => (
                // The same status, words and actions as in Meet (worksuite-desktop#89).
                <div key={r.id} className="flex flex-col gap-1 text-[12.5px]">
                  <span className="min-w-0 truncate text-ink">{r.title}</span>
                  <RecordingProgress recording={{ ...r, ready: r.playable === true }} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className={card}>
          <div className={head}>
            <h2 className="flex-1 text-[15px] font-bold text-ink">Files</h2>
            {can.upload ? <Button size="sm" variant="ghost" onClick={() => onTab('Files')}>Add files</Button> : null}
          </div>
          <span className="px-4 py-3 text-[12px] text-ink-2">{d.files.length ? d.files.slice(0, 4).map((f) => f.filename).join(' · ') : 'None yet'}</span>
        </section>
        {open ? (
          <section className={cx(card, 'gap-1 px-4 py-3 text-[12.5px]')}>
            <b className="text-ink">Reminder</b>
            <span className="text-ink-2">Its reminder comes to this computer with Join, Snooze 5 min and Open{can.rsvp ? '; a change to it with Going and Maybe' : ''}. Quiet hours and your notification settings apply.</span>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function AgendaTab({ d, canRun, act }: { d: Detail; canRun: boolean; act: Act }) {
  const [adding, setAdding] = useState('');
  const now = useNow();
  const id = d.meeting.id;
  const open = d.meeting.live_status !== 'cancelled' && d.meeting.live_status !== 'completed';
  const planned = d.agenda.reduce((n, a) => n + (a.minutes || 0), 0);
  const timer = (itemId: number, action: string) => act(() => apiPost(`/api/meetings/${id}/agenda/${itemId}/timer`, { action }));
  return (
    <>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[15px] font-bold text-ink">Agenda · {planned} of {d.meeting.duration_minutes} min planned</h2>
        {open && d.agenda.length ? (
          <Button size="sm" onClick={() => openAgendaWindow(id, d.meeting.title)} title="A small window that stays on top, with the shared timer and quick notes">
            Agenda window
          </Button>
        ) : null}
      </div>
      {!d.agenda.length ? <p className="text-ink-3">No agenda yet.</p> : null}
      {d.agenda.map((a, i) => {
        const status = a.status ?? 'pending';
        const spent = elapsedOf(a, now);
        const over = (a.minutes || 0) > 0 && spent > a.minutes * 60;
        return (
          <div key={a.id} className={cx('flex items-center gap-3 rounded-[10px] border px-3 py-2.5', status === 'running' ? 'border-primary bg-selection' : 'border-line')}>
            <span className={cx('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold', status === 'done' ? 'bg-success text-white' : status === 'running' ? 'bg-primary text-white' : 'bg-subtle text-ink-2')}>
              {status === 'done' ? '✓' : i + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className={cx('truncate text-ink', status === 'skipped' && 'line-through opacity-60')}>{a.title}</b>
              <span className="text-[11.5px] text-ink-3">{a.presenter ?? ''}</span>
            </span>
            <span className={cx('font-mono text-[12px]', over ? 'font-semibold text-danger' : status === 'running' ? 'font-semibold text-warning dark:text-warning' : 'text-ink-2')}>
              {spent > 0 || status === 'running' ? `${mmss(spent)} / ` : ''}{a.minutes} min
            </span>
            {canRun ? (
              <span className="flex shrink-0 gap-2 text-[12px] font-semibold text-primary">
                {status === 'running' ? (
                  <>
                    <button type="button" className="hover:underline" onClick={() => void timer(a.id, 'pause')}>Pause</button>
                    <button type="button" className="hover:underline" onClick={() => void timer(a.id, 'done')}>Done</button>
                  </>
                ) : status === 'done' || status === 'skipped' ? (
                  <button type="button" className="text-ink-3 hover:underline" onClick={() => void timer(a.id, 'reset')}>Reset</button>
                ) : (
                  <>
                    <button type="button" className="hover:underline" onClick={() => void timer(a.id, 'start')}>{spent > 0 ? 'Resume' : 'Start this item'}</button>
                    <button type="button" className="text-ink-3 hover:underline" onClick={() => void timer(a.id, 'skip')}>Skip</button>
                  </>
                )}
              </span>
            ) : null}
          </div>
        );
      })}
      {canRun ? (
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

function PeopleTab({ d, canInvite, canMark, act }: { d: Detail; canInvite: boolean; canMark: boolean; act: Act }) {
  const id = d.meeting.id;
  const [q, setQ] = useState('');
  const cands = useQuery({
    queryKey: ['meetings', 'candidates', id, q.trim()],
    queryFn: ({ signal }) => apiGet<Record<'users' | 'contacts' | 'departments', Array<{ key: string; kind: string; id: number; name: string; sub: string | null; taken: boolean }>>>(`/api/meetings/${id}/people/candidates`, { q: q.trim() }, signal),
    enabled: canInvite && q.trim().length >= 2,
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
        {canInvite ? <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Add people" placeholder="Search people, contacts or departments" className="h-8 w-72 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-primary" /> : null}
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
            disabled={!canMark}
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

/**
 * Notes & Minutes (worksuite-desktop#80): the shared editor, drafted from the agenda and the meeting's chat as well
 * as what is written.
 */
function MinutesTab({ d }: { d: Detail }) {
  const material = async () => {
    const agenda = d.agenda.length ? `Agenda items:\n${d.agenda.map((a, i) => `${i + 1}. ${a.title}${a.notes ? ` — ${a.notes}` : ''}`).join('\n')}` : '';
    let chat = '';
    if (d.chat?.room_id && d.chat.member) {
      const r = await apiGet<{ messages: ChatMessage[] }>('/api/chat/messages', { room_id: d.chat.room_id }).catch(() => ({ messages: [] as ChatMessage[] }));
      chat = r.messages.filter((x) => !x.deleted && x.message?.trim() && x.type !== 'system').slice(-80).map((x) => `${x.sender_name}: ${x.message!.replace(/\s+/g, ' ').trim()}`).join('\n');
    }
    // The transcript, when there is one, is what the minutes are best drafted from (worksuite-desktop#81).
    const transcript = await latestTranscriptText(d.meeting.id);
    return [agenda, transcript ? `The meeting's transcript:\n${transcript}` : '', chat ? `The meeting's chat:\n${chat}` : ''].filter(Boolean).join('\n\n');
  };
  return <MinutesEditor meetingId={d.meeting.id} material={material} />;
}

/**
 * A file's address to open: a short-lived signed link from a newer server (MTG-U06, `GET …/files/{id}/link`), else
 * the address the list gave. Null when there is neither.
 */
export async function fileLink(meetingId: number, f: { id: number; url?: string | null }): Promise<string | null> {
  try {
    const r = await apiGet<{ url?: string | null }>(`/api/meetings/${meetingId}/files/${f.id}/link`);
    // The server signs a path on itself (`/api/meetings/signed-files/…`), or a whole address.
    if (r?.url && (/^https?:\/\//i.test(r.url) || r.url.startsWith('/'))) return r.url;
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    // Refused (403, 404): not to be opened by another way either.
    if (status === 403) throw e;
    if (status !== 404 && status !== 405) throw e;
  }
  return f.url && /^https?:\/\//i.test(f.url) ? f.url : null;
}

function FilesTab({ d, canUpload, act }: { d: Detail; canUpload: boolean; act: Act }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = (files: FileList | null) => {
    if (!canUpload) return;
    for (const f of Array.from(files ?? [])) {
      const form = new FormData();
      form.append('file', f, f.name);
      form.append('kind', 'attachment');
      void act(() => request('POST', `/api/meetings/${d.meeting.id}/files`, { body: form }), `${f.name} uploaded.`);
    }
  };
  const openFile = async (f: Detail['files'][number]) => {
    try {
      const url = await fileLink(d.meeting.id, f);
      if (url?.startsWith('/')) await call('app:openInBrowser', { path: url });
      else if (url) await call('app:openExternal', { url });
      else toast('info', 'This file cannot be opened from here.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div
      className="flex flex-col gap-2"
      onDragOver={(e) => canUpload && e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      {d.recordings?.length ? (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-line p-2.5">
          <b className="text-ink">Your recordings</b>
          {d.recordings.map((r) => (
            // The same status, words and actions as in Meet (worksuite-desktop#89).
            <div key={r.id} className="flex flex-col gap-1 text-[12.5px]">
              <span className="min-w-0 truncate text-ink">{r.title}</span>
              <RecordingProgress recording={{ ...r, ready: r.playable === true }} />
            </div>
          ))}
          <span className="text-[11.5px] text-ink-3">In your Drive, shared with nobody until you share them.</span>
        </div>
      ) : null}
      <h2 className="text-[15px] font-bold text-ink">Files</h2>
      {!d.files.length ? <Empty icon="file" title="No files yet" hint={canUpload ? 'Drag files here or upload them.' : undefined} /> : null}
      {d.files.map((f) => (
        <div key={f.id} className="flex items-center gap-2.5 rounded-[9px] border border-line px-3 py-2">
          <FileBadge name={f.filename} size={30} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{f.filename}</b>
            <span className="text-[11.5px] text-ink-3">{bytes(f.size)} · {relative(f.at ?? f.created_at ?? '')}</span>
          </span>
          <Button size="sm" onClick={() => void openFile(f)}>Open</Button>
        </div>
      ))}
      {canUpload ? (
        <>
          <input ref={input} type="file" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
          <button type="button" onClick={() => input.current?.click()} className="h-9 self-start rounded-[8px] border border-line px-3 font-semibold text-ink hover:bg-subtle">Upload files</button>
        </>
      ) : null}
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

/** What minutes are drafted from (worksuite-desktop#53): the meeting, who came, the agenda and its notes, what is written so far, and its chat. */
export function minutesMaterial(d: Detail, written: { summary: string; decisions: string; notes: string }, chat: string): string {
  const m = d.meeting;
  const came = d.participants.filter((p) => p.attendance === 'present' || p.attendance === 'attended' || (p.attended_minutes ?? 0) > 0).map((p) => p.name);
  const lines = [
    `Meeting: ${m.title}`,
    m.start_at ? `When: ${dateLabel(m.start_at)} ${timeLabel(m.start_at)}` : null,
    `Participants: ${(came.length ? came : d.participants.map((p) => p.name)).join(', ') || 'not recorded'}`,
    m.description ? `Purpose: ${m.description}` : null,
    d.agenda.length ? `Agenda:\n${d.agenda.map((a, i) => `${i + 1}. ${a.title}${a.presenter ? ` (${a.presenter})` : ''}${a.notes?.trim() ? `\n   Notes: ${a.notes.trim()}` : ''}`).join('\n')}` : null,
    written.decisions.trim() ? `Decisions noted so far:\n${written.decisions.trim()}` : null,
    written.summary.trim() ? `Summary written so far:\n${written.summary.trim()}` : null,
    written.notes.trim() ? `Notes:\n${written.notes.trim()}` : null,
    d.action_items.length ? `Actions already recorded:\n${d.action_items.map((a) => `- ${a.title}${a.assignee ? ` (${a.assignee})` : ''}`).join('\n')}` : null,
    chat ? `The meeting's chat:\n${chat}` : null,
  ];
  return lines.filter(Boolean).join('\n\n');
}

const DELIVERY_KIND: Record<string, string> = { invitation: 'Invitation', update: 'Update', cancellation: 'Cancellation', reminder: 'Reminder', summary: 'Summary' };

/**
 * What the invitation emails did (worksuite-desktop#97), for whoever runs the meeting: how many went, which are
 * still on their way, and each one that failed — with why, and Retry.
 */
export function Deliveries({ meetingId, rows, act }: { meetingId: number; rows: Delivery[]; act: (fn: () => Promise<unknown>, done?: string) => Promise<unknown> }) {
  const mail = rows.filter((r) => r.channel === 'email');
  if (!mail.length) return null;
  const failed = mail.filter((r) => r.state === 'failed');
  const sent = mail.filter((r) => r.state === 'sent').length;
  const waiting = mail.filter((r) => r.state === 'queued' || r.state === 'sending').length;
  return (
    <section className="flex flex-col rounded-[12px] border border-line bg-surface" data-deliveries>
      <h2 className="border-b border-line px-4 py-3 text-[15px] font-bold text-ink">Emails</h2>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-[12px] last:border-0">
        <span className="flex-1 text-ink-2">
          {sent} sent{waiting ? ` · ${waiting} on the way` : ''}{failed.length ? ` · ${failed.length} not delivered` : ''}
        </span>
        {waiting ? <Chip tone="indigo">Sending</Chip> : <Chip tone="success">Sent</Chip>}
      </div>
      {failed.map((r) => (
        <div key={r.id} className="flex items-center gap-2 border-b border-line px-4 py-2 text-[12px] last:border-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ink">
              <b>{DELIVERY_KIND[r.kind] ?? r.kind}</b> to {r.name || r.email}
            </span>
            {r.error ? <span className="truncate text-ink-3">{r.error}</span> : null}
          </span>
          <Chip tone="danger">Failed</Chip>
          <Button size="sm" onClick={() => void act(() => apiPost(`/api/meetings/${meetingId}/deliveries/${r.id}/retry`), 'It will be sent again in a minute.')}>
            Retry
          </Button>
        </div>
      ))}
    </section>
  );
}
