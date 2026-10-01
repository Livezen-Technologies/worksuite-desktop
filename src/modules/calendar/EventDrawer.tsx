import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { canOpenRoute, canOpenWebPath } from '@shared/access';
import { useCanOpen, useVisibleIds } from '../../core/access';
import { ApiError, apiDelete, apiGet, apiGetMeta, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { dayLabel, wallTimeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Avatar, Button, Chip, Modal, Spinner, cx } from '../../components/ui';
import { createMeeting, openMeeting } from '../meet/api';
import { CATEGORIES, colourOf, entryCategory, relatedOf, dayOf, destinationOf, REMINDERS, SWATCHES, toInput, type CalendarEvent, type EventDetail } from './api';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';
import { useConflictGate, useInvitationAnswer } from './conflicts';

export interface Draft {
  start: string;
  end: string;
  allDay: boolean;
  /** A title to start from (a contact's "Schedule"). */
  title?: string;
}

const RSVP: Array<[string, string]> = [
  ['accepted', 'Going'],
  ['tentative', 'Maybe'],
  ['declined', 'Not going'],
];
const STATUS: Record<string, [string, string]> = {
  organizer: ['Organiser', 'text-ink-2'],
  accepted: ['Going', 'text-success'],
  tentative: ['Maybe', 'text-[#9A4A06] dark:text-warning'],
  declined: ['Not going', 'text-danger'],
  needs_action: ['No response', 'text-ink-3'],
};

const field = 'h-8 rounded-[7px] border border-line bg-surface px-2 text-[13px] font-normal text-ink outline-none focus:border-primary disabled:bg-subtle disabled:text-ink-2';
const label = 'flex flex-col gap-[3px] text-[12.5px] font-semibold text-ink';

/**
 * The event drawer (CalendarEvent). A new event, or one of yours to change;
 * anything else in the feed (a meeting, a task, leave, a holiday…) opens as a
 * summary with a way to where it lives.
 */
export function EventDrawer({ event, draft, onClose }: { event: CalendarEvent | null; draft: Draft | null; onClose: () => void }) {
  if (event && event.source !== 'event') return <Summary e={event} onClose={onClose} />;
  return <Editor event={event} draft={draft} onClose={onClose} />;
}

function Shell({ title, colour, extra, onClose, children, footer }: { title: string; colour: string; extra?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  // Escape closes it; the calendar underneath keeps its day, view and filters (#64). A dialog on top handles its own first.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !ev.defaultPrevented && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside aria-label={title} className="absolute top-0 right-0 bottom-0 z-30 flex w-[560px] max-w-full flex-col border-l border-line bg-surface text-[13px] shadow-[-12px_0_36px_rgb(var(--ws-shadow-rgb)/.16)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-[18px] py-3.5">
        <span className="h-3 w-3 rounded-[3px]" style={{ background: colour }} />
        <b className="flex-1 text-[15px] text-ink">{title}</b>
        {extra}
        <button type="button" aria-label="Close" onClick={onClose} className="px-1 text-[16px] text-ink-2 hover:text-ink">×</button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-[18px] py-3.5 scroll-thin">{children}</div>
      {footer ? <div className="flex shrink-0 items-center gap-2 border-t border-line px-[18px] py-3">{footer}</div> : null}
    </aside>
  );
}

function Summary({ e, onClose }: { e: CalendarEvent; onClose: () => void }) {
  const { navigate } = useTab();
  const visible = useVisibleIds();
  // "Open" goes to the app the entry lives in, and a Meet meeting's "Join" to Meet: neither for an app the person was not given.
  const where = destinationOf(e);
  const to = where && (where.route ? canOpenRoute(where.route, visible) : canOpenWebPath(where.web!, visible)) ? where : null;
  const meet = useCanOpen('meet');
  const [checking, setChecking] = useState(false);
  const [gone, setGone] = useState(false);
  /*
   * Before leaving, ask the calendar again whether this entry is still there for
   * this person: the feed answers through the same permissions and deletions, so
   * a record deleted or no longer shared since the calendar loaded says so here,
   * instead of opening onto an empty screen (#64). Offline, it cannot ask: it opens.
   */
  const open = async () => {
    if (!to) return;
    setChecking(true);
    setGone(false);
    try {
      const day = dayOf(e.start_at);
      const r = await apiGetMeta<{ events: CalendarEvent[] }>('/api/calendar/events', { from: day, to: day });
      if (!r.offline && !(r.data?.events ?? []).some((x) => x.source === e.source && String(x.id) === String(e.id))) {
        setGone(true);
        return;
      }
    } catch {
      // Could not ask: open it, and let the record's own screen say what it finds.
    } finally {
      setChecking(false);
    }
    if (to.route) navigate(to.route);
    else void call('app:openInBrowser', { path: to.web! });
  };
  const kind = e.related?.kind_label ?? CATEGORIES.find((c) => c.id === entryCategory(e))?.label ?? 'Entry';
  const related = relatedOf(e);
  const when = e.all_day
    ? dayOf(e.start_at) === dayOf(e.end_at ?? e.start_at)
      ? dayLabel(dayOf(e.start_at))
      : `${dayLabel(dayOf(e.start_at), 'short')} – ${dayLabel(dayOf(e.end_at!), 'short')}`
    : `${dayLabel(dayOf(e.start_at))} · ${wallTimeLabel(e.start_at)}${e.end_at ? `–${wallTimeLabel(e.end_at)}` : ''}`;
  const join = e.source === 'meeting' && e.uuid ? (meet ? () => void openMeeting(e.uuid!, e.title) : null) : e.join_url ? () => void call('app:openExternal', { url: e.join_url! }) : null;
  return (
    <Shell
      title={kind}
      colour={colourOf(e)}
      onClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          {related ? (
            <Button title={related.web ? 'Opens on the web' : undefined} onClick={() => (related.route ? navigate(related.route) : void call('app:openInBrowser', { path: related.web! }))}>
              {related.label}
            </Button>
          ) : null}
          {to ? (
            <Button loading={checking} disabled={gone} title={to.web ? 'Opens on the web' : undefined} onClick={() => void open()}>
              {to.label}
            </Button>
          ) : null}
          {join ? <Button variant="primary" onClick={join}>Join</Button> : null}
        </>
      }
    >
      <h2 className="text-[17px] font-bold text-ink">{e.title}</h2>
      <span className="text-ink-2">{when}</span>
      {e.related?.label ? <span className="text-ink-2">{e.related.label}</span> : null}
      {e.subtitle || e.location ? <span className="text-ink-2">{e.subtitle ?? e.location}</span> : null}
      {e.status ? <Chip>{e.status.replace(/_/g, ' ')}</Chip> : null}
      {e.priority ? <span className="text-ink-3">Priority: {e.priority}</span> : null}
      {e.description ? <p className="whitespace-pre-wrap text-ink selectable">{e.description}</p> : null}
      {gone ? (
        <p role="alert" className="m-0 rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          This has been deleted, or you no longer have access to it.
        </p>
      ) : null}
      <span className="text-[12px] text-ink-3">This comes from {kind.toLowerCase()} and is changed where it lives.</span>
    </Shell>
  );
}

function Editor({ event, draft, onClose }: { event: CalendarEvent | null; draft: Draft | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { navigate } = useTab();
  // Meeting notes are made in Notes, and a video meeting in Meet: each only for whoever has that app.
  const notesApp = useCanOpen('notes');
  const meetApp = useCanOpen('meet');
  const id = event?.id ?? null;
  const detail = useQuery({ queryKey: ['calendar', 'event', id], queryFn: ({ signal }) => apiGet<EventDetail>(`/api/calendar/events/${id}`, undefined, signal), enabled: id !== null });
  const e = detail.data ?? event;
  const editable = !e || e.editable;
  const owner = !e || !!e.can_manage;
  const [title, setTitle] = useState(e?.title ?? draft?.title ?? '');
  const [allDay, setAllDay] = useState(e ? e.all_day : (draft?.allDay ?? false));
  const [start, setStart] = useState(e ? (e.all_day ? dayOf(e.start_at) : toInput(e.start_at)) : (draft?.start ?? ''));
  const [end, setEnd] = useState(e ? (e.all_day ? dayOf(e.end_at ?? e.start_at) : toInput(e.end_at)) : (draft?.end ?? ''));
  const [repeat, setRepeat] = useState(e?.recur_freq ?? '');
  const [until, setUntil] = useState(e?.recur_until ?? '');
  const [remind, setRemind] = useState<number | null>(e ? (e.remind_minutes ?? null) : 15);
  const [category, setCategory] = useState(e?.category ?? '');
  const [colour, setColour] = useState(e?.color && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : SWATCHES[0]!);
  const [location, setLocation] = useState(e?.location ?? '');
  const [description, setDescription] = useState(e?.description ?? '');
  const [meetUuid, setMeetUuid] = useState<string | null>(e?.meeting_uuid ?? null);
  const [invite, setInvite] = useState<Array<{ id: number; name: string }>>([]);
  const [inviteAs, setInviteAs] = useState<'viewer' | 'editor'>('viewer');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loaded, setLoaded] = useState(!id);
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<{ users: Array<{ id: number; name: string; email?: string }> }>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000, enabled: owner && editable });

  // The feed row is enough to draw; the full record fills in when it arrives.
  // Its times are the series' own: an occurrence's times, saved back, would
  // move the whole series to start on the day that was clicked.
  if (detail.data && !loaded) {
    setLoaded(true);
    setAllDay(detail.data.all_day);
    setStart(detail.data.all_day ? dayOf(detail.data.start_at) : toInput(detail.data.start_at));
    setEnd(detail.data.all_day ? dayOf(detail.data.end_at ?? detail.data.start_at) : toInput(detail.data.end_at));
    setTitle(detail.data.title);
    setDescription(detail.data.description ?? '');
    setLocation(detail.data.location ?? '');
    setCategory(detail.data.category ?? '');
    setRemind(detail.data.remind_minutes ?? null);
    setRepeat(detail.data.recur_freq ?? '');
    setUntil(detail.data.recur_until ?? '');
    setMeetUuid(detail.data.meeting_uuid ?? null);
  }

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const participants = detail.data?.participants ?? [];
  // Schedule conflicts (worksuite-desktop#99): checked before saving, for you and everybody on the event; and an
  // invitation waiting for your answer says what it overlaps, and asks before you accept it.
  const startField = useRef<HTMLInputElement>(null);
  const gate = useConflictGate('Save anyway', () => startField.current?.focus());
  const eventId = id !== null && /^\d+$/.test(String(id)) ? Number(id) : null;
  const conflictQuery = () => {
    const b = body();
    return {
      start: b.start,
      end: b.end,
      all_day: b.all_day,
      event_id: eventId ?? undefined,
      user_ids: [...participants.map((p) => p.user_id), ...invite.map((x) => x.id)],
      recur_freq: b.recur_freq,
      recur_until: b.recur_until,
    };
  };

  const taken = new Set(participants.map((p) => p.user_id));
  const needle = q.trim().toLowerCase();
  const matches = needle ? (directory.data?.users ?? []).filter((u) => !taken.has(u.id) && !invite.some((x) => x.id === u.id) && u.name.toLowerCase().includes(needle)).slice(0, 6) : [];

  const body = () => ({
    title: title.trim() || 'Untitled event',
    description,
    category,
    location,
    color: colour,
    start: allDay ? start.slice(0, 10) : start,
    end: allDay ? (end || start).slice(0, 10) : end || start,
    all_day: allDay,
    remind_minutes: remind,
    recur_freq: repeat || null,
    recur_until: repeat && until ? until : null,
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let saved: CalendarEvent;
      if (id) saved = await apiPut<CalendarEvent>(`/api/calendar/events/${id}`, { ...body(), meeting_uuid: meetUuid });
      else {
        saved = await apiPost<CalendarEvent>('/api/calendar/events', body());
        // Create takes neither a video meeting nor people; they follow at once.
        if (meetUuid) await apiPut(`/api/calendar/events/${saved.id}`, { ...body(), meeting_uuid: meetUuid });
      }
      if (invite.length) await apiPost(`/api/calendar/events/${saved.id}/invite`, { user_ids: invite.map((x) => x.id), role: inviteAs });
      toast('success', id ? 'Event saved.' : 'Event added.');
      refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const addMeet = async () => {
    try {
      const m = await createMeeting({ title: title.trim() || 'Meeting', later: true });
      setMeetUuid(m.uuid);
      if (id) {
        await apiPut(`/api/calendar/events/${id}`, { ...body(), meeting_uuid: m.uuid });
        refresh();
      }
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast('success', done);
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      void qc.invalidateQueries({ queryKey: ['calendar', 'event', id] });
      refresh();
    }
  };
  const invitation = useInvitationAnswer('event', e?.invited && !owner ? eventId : null, (v) => act(() => apiPost(`/api/calendar/events/${id}/rsvp`, { status: v })));

  const notes = async () => {
    try {
      const r = await apiPost<{ id: number }>('/api/notes/from', {
        title: `${title.trim() || 'Meeting'} — notes`,
        body: '<h2>Agenda</h2><p></p><h2>Decisions</h2><p></p><h2>Action items</h2><ul><li></li></ul>',
        link_type: 'event',
        link_id: id,
      });
      onClose();
      navigate(`/notes?note=${r.id}`);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const occurrence = e?.recurring && e.occurrence_date ? e.occurrence_date : null;
  return (
    <Shell
      title={id ? 'Event' : 'New event'}
      colour={colour}
      onClose={onClose}
      footer={
        <>
          {id && owner ? (
            <button type="button" onClick={() => setDeleting(true)} className="h-9 rounded-[8px] border border-[#F1B8A8] bg-surface px-3 font-bold text-danger hover:bg-danger-bg">
              Delete event
            </button>
          ) : null}
          <span className="flex-1" />
          <Button onClick={onClose}>{editable ? 'Cancel' : 'Close'}</Button>
          {editable ? <Button variant="primary" loading={busy} disabled={!start} onClick={() => void gate.guard(conflictQuery(), save)}>Save</Button> : null}
        </>
      }
    >
      {id && detail.isLoading && !event ? <Spinner /> : null}
      {/* Deleted, or no longer shared, since the calendar loaded (#64): say so, rather than a form for nothing. */}
      {id && detail.error instanceof ApiError && (detail.error.status === 404 || detail.error.status === 403) ? (
        <p role="alert" className="m-0 rounded-[9px] bg-warning-bg px-3 py-2 text-warning">
          This event has been deleted, or you no longer have access to it.
        </p>
      ) : null}
      {e?.edit_block && !editable ? <div className="rounded-[9px] bg-subtle px-3 py-2 text-ink-2">{e.edit_block}</div> : null}
      {event?.recurring && event.occurrence_date && editable ? (
        <div className="rounded-[9px] bg-selection px-3 py-2 text-ink-2">
          This repeats. You opened {dayLabel(event.occurrence_date, 'short')}; the times below are the series' own, and a change here changes every occurrence.
        </div>
      ) : null}
      <input value={title} onChange={(ev) => setTitle(ev.target.value)} disabled={!editable} aria-label="Event title" placeholder="Add a title" autoFocus={!id} className="h-[38px] rounded-[8px] border border-line bg-surface px-2.5 text-[16px] font-bold text-ink outline-none focus:border-primary disabled:bg-surface" />
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          Start
          <input ref={startField} type={allDay ? 'date' : 'datetime-local'} value={allDay ? start.slice(0, 10) : start} onChange={(ev) => setStart(ev.target.value)} disabled={!editable} className={field} />
        </label>
        <label className={label}>
          End
          <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? end.slice(0, 10) : end} min={allDay ? start.slice(0, 10) : start} onChange={(ev) => setEnd(ev.target.value)} disabled={!editable} className={field} />
        </label>
        <label className={label}>
          Repeat
          <Select value={repeat} onChange={(ev) => setRepeat(ev.target.value)} disabled={!editable} className={field}>
            <option value="">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </Select>
        </label>
        {repeat ? (
          <label className={label}>
            Until
            <input type="date" value={until} onChange={(ev) => setUntil(ev.target.value)} disabled={!editable} className={field} />
          </label>
        ) : (
          <label className={label}>
            Reminder
            <Select value={remind === null ? '' : String(remind)} onChange={(ev) => setRemind(ev.target.value === '' ? null : Number(ev.target.value))} disabled={!editable} className={field}>
              {REMINDERS.map(([v, l]) => <option key={l} value={v === null ? '' : String(v)}>{l}</option>)}
            </Select>
          </label>
        )}
        {repeat ? (
          <label className={label}>
            Reminder
            <Select value={remind === null ? '' : String(remind)} onChange={(ev) => setRemind(ev.target.value === '' ? null : Number(ev.target.value))} disabled={!editable} className={field}>
              {REMINDERS.map(([v, l]) => <option key={l} value={v === null ? '' : String(v)}>{l}</option>)}
            </Select>
          </label>
        ) : null}
        <label className={label}>
          Category
          <input value={category} onChange={(ev) => setCategory(ev.target.value)} disabled={!editable} placeholder="Meeting, Personal…" className={field} />
        </label>
        <div className={label}>
          Colour
          <div className="flex h-8 items-center gap-1.5" role="radiogroup" aria-label="Colour">
            {SWATCHES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={c} disabled={!editable} onClick={() => setColour(c)} className="h-[22px] w-[22px] rounded-full" style={{ background: c, boxShadow: colour === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }} />
            ))}
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 text-ink">
        <Checkbox checked={allDay} disabled={!editable} onChange={(ev) => setAllDay(ev.target.checked)} />
        All day
      </label>
      <div className="flex gap-2">
        <input value={location} onChange={(ev) => setLocation(ev.target.value)} disabled={!editable} aria-label="Location" placeholder="Add location" className={cx(field, 'flex-1')} />
        {!meetApp ? null : meetUuid ? (
          <button type="button" onClick={() => void openMeeting(meetUuid, title)} className="flex items-center gap-1.5 rounded-[7px] bg-success-bg px-2.5 font-bold text-success" title="Join the video meeting">
            Video meeting added · Join
          </button>
        ) : editable ? (
          <button type="button" onClick={() => void addMeet()} className="rounded-[7px] border border-line px-2.5 font-semibold text-ink hover:bg-subtle">
            Add video meeting
          </button>
        ) : null}
      </div>
      <textarea value={description} onChange={(ev) => setDescription(ev.target.value)} disabled={!editable} aria-label="Description" placeholder="Add a description" rows={3} className="resize-none rounded-[7px] border border-line bg-surface p-2 text-[13px] text-ink outline-none focus:border-primary disabled:bg-subtle" />
      <div className="relative flex flex-col gap-1.5">
        <div className="flex items-center">
          <b className="flex-1 text-ink">Attendees · {participants.length + invite.length}</b>
          {owner && editable ? (
            <Select aria-label="Invite as" value={inviteAs} onChange={(ev) => setInviteAs(ev.target.value as 'viewer' | 'editor')} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink">
              <option value="viewer">Invite as Viewer</option>
              <option value="editor">Invite as Editor</option>
            </Select>
          ) : null}
        </div>
        {participants.map((p) => {
          const [st, tone] = STATUS[p.status] ?? [p.status, 'text-ink-3'];
          return (
            <div key={p.user_id} className="flex items-center gap-2">
              <Avatar name={p.name} size={26} />
              <span className="flex-1 text-ink">
                <b>{p.is_you ? 'You' : p.name}</b> <span className="text-ink-3">· {p.status === 'organizer' ? 'Organiser' : p.role === 'editor' ? 'Editor' : 'Viewer'}</span>
              </span>
              {owner && id && p.status !== 'organizer' ? (
                <Select aria-label={`Role for ${p.name}`} value={p.role ?? 'viewer'} onChange={(ev) => void act(() => apiPut(`/api/calendar/events/${id}/role`, { user_id: p.user_id, role: ev.target.value }))} className="h-7 rounded-[7px] border border-line bg-surface px-1 text-[12px] text-ink">
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </Select>
              ) : null}
              <span className={cx('text-[11.5px] font-bold', tone)}>{st}</span>
            </div>
          );
        })}
        {invite.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <Avatar name={p.name} size={26} />
            <span className="flex-1 text-ink"><b>{p.name}</b> <span className="text-ink-3">· {inviteAs === 'editor' ? 'Editor' : 'Viewer'} · invited on save</span></span>
            <button type="button" aria-label={`Do not invite ${p.name}`} onClick={() => setInvite(invite.filter((x) => x.id !== p.id))} className="text-ink-3 hover:text-danger">×</button>
          </div>
        ))}
        {owner && editable ? (
          <input value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="Invite people" placeholder="Invite people…" className={field} />
        ) : null}
        {matches.length ? (
          <div className="absolute top-full right-0 left-0 z-10 mt-1 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
            {matches.map((u) => (
              <button key={u.id} type="button" onClick={() => (setInvite([...invite, { id: u.id, name: u.name }]), setQ(''))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-subtle">
                <Avatar name={u.name} size={22} /> {u.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {id && e?.invited && !owner ? (
        <div className="flex items-center gap-1.5">
          <b className="w-[110px] text-ink">Your response</b>
          {RSVP.map(([v, l]) => (
            <button key={v} type="button" aria-pressed={e.my_rsvp === v} onClick={() => void invitation.answer(v)} className={cx('h-[30px] rounded-[7px] px-3 font-semibold', e.my_rsvp === v ? 'bg-success text-white' : 'border border-line text-ink hover:bg-subtle')}>
              {l}
            </button>
          ))}
          {invitation.flag}
        </div>
      ) : null}
      {gate.dialog}
      {invitation.dialogs}
      {id && notesApp ? (
        <div className="flex flex-col gap-1.5 rounded-[10px] bg-subtle px-3 py-2.5">
          <b className="text-ink">Meeting notes</b>
          <span className="text-ink-2">Agenda · Decisions · Action items</span>
          <Button size="sm" className="self-start" onClick={() => void notes()}>Create meeting notes</Button>
        </div>
      ) : null}
      {error ? <div className="rounded-[8px] bg-danger-bg px-3 py-2 text-danger" role="alert">{error}</div> : null}
      {deleting ? (
        <Modal
          title={occurrence ? 'Delete this event?' : `Delete “${title || 'this event'}”?`}
          onClose={() => setDeleting(false)}
          width={440}
          footer={
            <>
              <Button onClick={() => setDeleting(false)}>Keep it</Button>
              {occurrence ? <Button onClick={() => void act(() => apiPost(`/api/calendar/events/${id}/skip`, { date: occurrence }), 'This date is skipped.').then(onClose)}>Only {dayLabel(occurrence, 'short')}</Button> : null}
              <Button variant="danger" onClick={() => void act(() => apiDelete(`/api/calendar/events/${id}`), 'Event deleted.').then(onClose)}>{occurrence ? 'The whole series' : 'Delete'}</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">{occurrence ? 'This event repeats. Skip just this date, or delete every occurrence?' : 'Everyone invited loses it from their calendar.'}</p>
        </Modal>
      ) : null}
    </Shell>
  );
}
