import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { currentZone, dateLabel, parseTs, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Modal, cx } from '../../components/ui';

/**
 * Schedule conflicts (worksuite-desktop#99): what else is on at a time, asked of the server before an event or a
 * meeting is saved, an invitation is accepted, or people are invited. Advisory: the person may go ahead anyway.
 */

export interface Conflict {
  user_id: number;
  source: 'meeting' | 'event';
  /** 0 when the person asking may not see it: then it is only "Busy". */
  id: number;
  title: string | null;
  busy_only: boolean;
  start_at: string;
  end_at: string;
  all_day: boolean;
  status: 'organizer' | 'accepted' | 'tentative' | 'no_response';
  tentative: boolean;
  /** For a time that repeats: the occurrence of it that clashes. */
  occurrence?: string;
}

export interface ConflictPerson {
  user_id: number;
  name: string;
  busy: boolean;
  tentative_only: boolean;
}

/** Someone whose time could not be checked (outside the companies the person asking shares with them). */
export interface UnknownPerson {
  user_id?: number;
  id?: number;
  email?: string;
  name?: string | null;
}

export interface ConflictResult {
  conflicts: Conflict[];
  duplicates: Conflict[];
  people: ConflictPerson[];
  checked: number;
  /** Newer servers: the invited people whose availability is not known, said rather than left out. */
  unknown?: UnknownPerson[];
}

export interface ConflictQuery {
  start: string;
  end: string;
  all_day?: boolean;
  timezone?: string;
  user_ids?: number[];
  include_me?: boolean;
  meeting_id?: number;
  event_id?: number;
  recur_freq?: string | null;
  recur_interval?: number;
  recur_until?: string | null;
}

export interface WaitingInvitation {
  source: 'meeting' | 'event';
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  my_rsvp: string;
  conflicts: Conflict[];
  /** A meeting that also arrived as a calendar invitation: shown once. */
  duplicate: boolean;
  link: string;
}

/** What overlaps. Null when it could not be asked (offline, or a server without it): saving is never held up by that. */
export async function checkConflicts(q: ConflictQuery): Promise<ConflictResult | null> {
  try {
    return await apiPost<ConflictResult>('/api/calendar/conflicts', { timezone: currentZone(), ...q });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) throw e;
    return null;
  }
}

/** The invitations waiting for this person's answer, each with what it overlaps. */
export function useWaitingInvitations(enabled = true) {
  return useQuery({
    queryKey: ['calendar', 'conflicts', 'invitations'],
    queryFn: ({ signal }) => apiGet<{ invitations: WaitingInvitation[] }>('/api/calendar/conflicts/invitations', undefined, signal).then((r) => r.invitations),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/** The waiting invitation for this meeting or event, when there is one. */
export function useInvitationConflicts(source: 'meeting' | 'event', id: number | null): WaitingInvitation | null {
  const q = useWaitingInvitations(id !== null);
  return (q.data ?? []).find((i) => i.source === source && i.id === id) ?? null;
}

function span(c: Pick<Conflict, 'start_at' | 'end_at' | 'all_day'>): string {
  if (c.all_day) return `${dateLabel(c.start_at)}, all day`;
  const sameDay = dateLabel(c.start_at) === dateLabel(c.end_at);
  return `${dateLabel(c.start_at)}, ${timeLabel(c.start_at)}–${sameDay ? timeLabel(c.end_at) : `${dateLabel(c.end_at)} ${timeLabel(c.end_at)}`}`;
}

const STATUS: Record<Conflict['status'], string | null> = { organizer: null, accepted: null, tentative: 'tentative', no_response: 'not answered yet' };

/** "Budget review · 10 Mar, 9:30–10:30 · tentative", or "Busy · …" for what the person asking may not see. */
export function conflictLine(c: Conflict): string {
  return [c.busy_only ? 'Busy' : c.title || 'Untitled', span(c), STATUS[c.status]].filter(Boolean).join(' · ');
}

/** The same meeting seen twice (as a meeting and as a calendar invitation) is one commitment, and said so. */
export function duplicateLine(duplicates: Conflict[]): string {
  return `This is already in the calendar once (${[...new Set(duplicates.map((d) => d.title ?? 'the same meeting'))].join(', ')}): it is not counted twice.`;
}

export function unknownLine(unknown: UnknownPerson[]): string {
  const names = unknown.map((u) => u.name || u.email).filter(Boolean) as string[];
  const who = names.length === unknown.length && names.length <= 3 ? names.join(', ') : `${unknown.length} ${unknown.length === 1 ? 'person' : 'people'}`;
  return `Availability could not be checked for ${who}.`;
}

const linkOf = (c: Conflict) => (c.source === 'meeting' ? `/meetings?meeting=${c.id}` : `/calendar?event=${c.id}`);

/** A short flag on an invitation that clashes with something. */
export function ConflictFlag({ conflicts, className }: { conflicts: Conflict[]; className?: string }) {
  if (!conflicts.length) return null;
  const firm = conflicts.filter((c) => !c.tentative);
  const first = conflicts[0]!;
  const text = conflicts.length === 1 ? `Overlaps ${first.busy_only ? 'something else' : `“${first.title}”`}` : `Overlaps ${conflicts.length} other commitments`;
  return (
    <span role="note" title={conflicts.map(conflictLine).join('\n')} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold', firm.length ? 'bg-warning-bg text-warning' : 'bg-subtle text-ink-2', className)}>
      ⚠ {text}{firm.length ? '' : ' (tentative)'}
    </span>
  );
}

/** The conflicts, by person: yours first. */
export function ConflictList({ conflicts, people, onView }: { conflicts: Conflict[]; people?: ConflictPerson[]; onView?: (link: string) => void }) {
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const name = (uid: number) => (uid === me ? 'You' : (people?.find((p) => p.user_id === uid)?.name ?? 'Someone'));
  const users = [...new Set(conflicts.map((c) => c.user_id))].sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
  return (
    <ul className="flex flex-col gap-2">
      {users.map((uid) => (
        <li key={uid} className="flex flex-col gap-1">
          <b className="text-[12.5px] text-ink">{name(uid)}</b>
          {conflicts
            .filter((c) => c.user_id === uid)
            .map((c, i) => (
              <div key={`${c.source}:${c.id}:${c.start_at}:${i}`} className={cx('flex items-center gap-2 rounded-[8px] border px-2.5 py-1.5 text-[12.5px]', c.tentative ? 'border-dashed border-line text-ink-2' : 'border-[#F3C78B] bg-warning-bg text-ink')}>
                <span className="min-w-0 flex-1 truncate">{conflictLine(c)}</span>
                {onView && !c.busy_only && c.id ? (
                  <button type="button" onClick={() => onView(linkOf(c))} className="shrink-0 text-[12px] font-semibold text-primary hover:underline">
                    View conflict
                  </button>
                ) : null}
              </div>
            ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * Schedule Conflict: what overlaps, and what to do about it — choose another time, propose one (an invitation, where
 * the organiser can be asked), or go ahead anyway.
 */
export function ConflictDialog({
  result,
  action,
  onContinue,
  onChooseAnother,
  onPropose,
  onClose,
}: {
  result: Pick<ConflictResult, 'conflicts' | 'duplicates' | 'people' | 'unknown'>;
  /** What going ahead does: "Save anyway", "Accept anyway". */
  action: string;
  onContinue: () => void;
  onChooseAnother?: () => void;
  onPropose?: () => void;
  onClose: () => void;
}) {
  const view = (link: string) => {
    onClose();
    navigate(link);
  };
  return (
    <Modal
      title="Schedule conflict"
      onClose={onClose}
      width={520}
      footer={
        <>
          {onChooseAnother ? <Button onClick={() => (onClose(), onChooseAnother())}>Choose another time</Button> : <Button onClick={onClose}>Cancel</Button>}
          {onPropose ? <Button onClick={() => (onClose(), onPropose())}>Propose new time</Button> : null}
          <Button variant="primary" onClick={() => (onClose(), onContinue())}>
            {action}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-ink-2">This overlaps other commitments. You can keep the overlap if it is on purpose.</p>
        <ConflictList conflicts={result.conflicts} people={result.people} onView={view} />
        {result.duplicates.length ? <p className="rounded-[8px] bg-subtle px-2.5 py-1.5 text-[12px] text-ink-2">{duplicateLine(result.duplicates)}</p> : null}
        {result.unknown?.length ? <p className="text-[12px] text-ink-3">{unknownLine(result.unknown)}</p> : null}
      </div>
    </Modal>
  );
}

/**
 * Warn before saving: `guard(query, save)` asks what overlaps, and saves straight away when nothing does; otherwise
 * the Schedule Conflict dialog (rendered from `dialog`) lets the person choose. `onChooseAnother` keeps them in the
 * form they were in.
 */
export function useConflictGate(action = 'Save anyway', onChooseAnother?: () => void) {
  const [pending, setPending] = useState<{ result: ConflictResult; go: () => void } | null>(null);
  const guard = async (q: ConflictQuery, go: () => void | Promise<void>): Promise<void> => {
    let result: ConflictResult | null = null;
    try {
      result = await checkConflicts(q);
    } catch (e) {
      toast('error', errorMessage(e));
      return;
    }
    if (!result || result.conflicts.length === 0) {
      await go();
      if (result?.duplicates.length) toast('info', duplicateLine(result.duplicates));
      return;
    }
    setPending({ result, go: () => void go() });
  };
  const dialog: ReactNode = pending ? <ConflictDialog result={pending.result} action={action} onContinue={pending.go} onChooseAnother={onChooseAnother ?? (() => undefined)} onClose={() => setPending(null)} /> : null;
  return { guard, dialog };
}

/** Propose another time for a meeting (the organiser is told; the meeting does not move). */
export function ProposeTimeDialog({ meetingId, start, end, onClose, onSent }: { meetingId: number; start: string; end: string; onClose: () => void; onSent?: () => void }) {
  // The form's digits are on the WorkSuite clock, which is what `timezone` tells the server.
  const toLocal = (s: string) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: currentZone(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(parseTs(s));
    const g = (k: string) => p.find((x) => x.type === k)?.value ?? '00';
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
  };
  const [from, setFrom] = useState(() => toLocal(start));
  const [to, setTo] = useState(() => toLocal(end));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/meetings/${meetingId}/propose`, { start_at: from, end_at: to, timezone: currentZone(), message: message.trim() || undefined });
      toast('success', 'Your proposal was sent to the organiser.');
      onSent?.();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = 'h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink';
  return (
    <Modal
      title="Propose new time"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!from || !to || to <= from} onClick={() => void send()}>
            Send proposal
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-ink-2">The organiser is told the time you suggest. The meeting stays as it is unless they move it.</p>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Starts
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Ends
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Message (optional)
          <textarea value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} rows={3} className="rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink" />
        </label>
      </div>
    </Modal>
  );
}

/**
 * Answering an invitation (worksuite-desktop#99): accepting one that overlaps something else asks first, with
 * Propose new time for a meeting; the conflicts are asked again after any answer.
 */
export function useInvitationAnswer(source: 'meeting' | 'event', id: number | null, send: (rsvp: string) => Promise<unknown> | void) {
  const qc = useQueryClient();
  const waiting = useInvitationConflicts(source, id);
  const [asking, setAsking] = useState(false);
  const [proposing, setProposing] = useState(false);
  const again = () => void qc.invalidateQueries({ queryKey: ['calendar', 'conflicts'] });
  const [fresh, setFresh] = useState<Pick<ConflictResult, 'conflicts' | 'duplicates' | 'people' | 'unknown'> | null>(null);
  // Accepting asks again (what is in the calendar may have changed since the list was read); unanswered, the list's own answer stands.
  const answer = async (rsvp: string) => {
    if (rsvp !== 'accepted' || !waiting || id === null) return void Promise.resolve(send(rsvp)).then(again);
    const now = await checkConflicts({ start: waiting.start_at, end: waiting.end_at, ...(source === 'meeting' ? { meeting_id: id } : { event_id: id }) }).catch(() => null);
    const result = now && Array.isArray(now.conflicts) ? now : { conflicts: waiting.conflicts, duplicates: [], people: [] };
    if (!result.conflicts.length) return void Promise.resolve(send(rsvp)).then(again);
    setFresh(result);
    setAsking(true);
  };
  const propose = source === 'meeting' && waiting && id !== null ? () => setProposing(true) : null;
  const dialogs: ReactNode = (
    <>
      {asking && waiting ? (
        <ConflictDialog
          result={fresh ?? { conflicts: waiting.conflicts, duplicates: [], people: [] }}
          action="Accept anyway"
          onContinue={() => void Promise.resolve(send('accepted')).then(again)}
          onPropose={propose ?? undefined}
          onClose={() => setAsking(false)}
        />
      ) : null}
      {proposing && waiting && id !== null ? <ProposeTimeDialog meetingId={id} start={waiting.start_at} end={waiting.end_at} onClose={() => setProposing(false)} onSent={again} /> : null}
    </>
  );
  return { waiting, answer, propose, dialogs, flag: waiting ? <ConflictFlag conflicts={waiting.conflicts} /> : null };
}
