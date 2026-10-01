import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { useNow } from '../calls/parts';
import { K } from './api';
import { MinutesSheet, MinutesView } from './Minutes';
import { addMeeting, deleteMeeting, fetchMeetings, K2, labelOf, MEETING_KINDS, meetingBody, meetingDraft, MODES, updateMeeting, type Meeting, type MeetingDraft } from './work';
import { Checkbox } from '../../components/Checkbox';

/**
 * The buyer's meetings: pre-bid, site visits, clarifications and the opening.
 * A mandatory one missed can disqualify the bid, so it says so; the deadline
 * for questions, when the buyer set one, is shown beside the meeting it
 * belongs to. Times are shown and typed on the reader's clock and stored as
 * the instant; attendance and the minutes are recorded afterwards — the
 * minutes as notes and the points agreed, each of which can become a task, a
 * reminder or a follow-up meeting.
 */
export default function Meetings({ id, tender = null, canManage }: { id: number; tender?: string | null; canManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K2.meetings(id), queryFn: ({ signal }) => fetchMeetings(id, signal) });
  // Which meetings are behind us; a minute is fine enough for that.
  const now = useNow(60_000);
  const [editing, setEditing] = useState<Meeting | 'new' | null>(null);
  const [minutesOf, setMinutesOf] = useState<Meeting | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K2.meetings(id) });
    void qc.invalidateQueries({ queryKey: K.all });
  };
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const remove = async (m: Meeting) => {
    try {
      await deleteMeeting(m.id);
      toast('success', 'Removed.');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div className="flex justify-end">
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            <Icon name="plus" size={15} /> Add a meeting
          </button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Meetings">
        {q.data.length ? (
          q.data.map((m) => {
            const past = m.scheduled_at ? Date.parse(m.scheduled_at) < now : false;
            return (
              <div key={m.id} data-meeting={m.id} className={cx('flex items-start gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0', past && 'bg-ground/60')}>
                <span className="flex w-[130px] shrink-0 flex-col">
                  <b className="text-ink">{m.scheduled_at ? dateLabel(m.scheduled_at) : 'Not dated'}</b>
                  <span className="text-ink-2">{m.scheduled_at ? timeLabel(m.scheduled_at) : ''}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-[13px] text-ink">{labelOf(MEETING_KINDS, m.kind)}</b>
                    {m.mandatory ? <Pill tone={past && !m.attended ? 'red' : 'amber'}>Attendance is mandatory</Pill> : null}
                    {past ? m.attended ? <Pill tone="green">Attended</Pill> : <Pill>Not recorded as attended</Pill> : null}
                  </span>
                  <span className="text-[11.5px] text-ink-3">
                    {[labelOf(MODES, m.mode), m.venue].filter((x) => x && x !== '—').join(' · ')}
                    {m.link ? (
                      <>
                        {' · '}
                        <button type="button" className="text-primary hover:underline" title={m.link} onClick={() => /^https?:\/\//i.test(m.link!) && void call('app:openExternal', { url: m.link! })}>
                          Join link
                        </button>
                      </>
                    ) : null}
                  </span>
                  {m.questions_due_at ? (
                    <span className="text-[12px] text-ink-2">
                      Questions due {dateLabel(m.questions_due_at)}, {timeLabel(m.questions_due_at)}
                    </span>
                  ) : null}
                  {m.attended_by ? <span className="text-[12px] text-ink-2">Went: {m.attended_by}</span> : null}
                  <MinutesView minutes={m.minutes} />
                </span>
                {canManage ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button type="button" aria-label="Minutes of the meeting" title="Minutes: notes, and points to make into tasks, reminders or follow-ups" className={btnSmall + ' !h-7 gap-1 !px-2 !text-[12px]'} onClick={() => setMinutesOf(m)}>
                      <Icon name="tasks" size={13} /> Minutes
                    </button>
                    <button type="button" aria-label="Edit the meeting" title="Edit" className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} onClick={() => setEditing(m)}>
                      <Icon name="compose" size={13} />
                    </button>
                    <button type="button" aria-label="Remove the meeting" title="Remove" className={btnSmall + ' !h-7 !w-7 justify-center !px-0 !text-danger'} onClick={() => void remove(m)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })
        ) : (
          <Empty text="No meetings recorded." />
        )}
      </div>
      {minutesOf ? <MinutesSheet tenderId={id} tender={tender} meeting={minutesOf} onClose={() => setMinutesOf(null)} onSaved={refresh} /> : null}
      {editing ? <MeetingSheet tenderId={id} meeting={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </div>
  );
}

function MeetingSheet({ tenderId, meeting, onClose, onSaved }: { tenderId: number; meeting: Meeting | null; onClose: () => void; onSaved: () => void }) {
  const before = meeting ? meetingDraft(meeting) : null;
  const [d, setD] = useState<MeetingDraft>(() => meetingDraft(meeting));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const out = meetingBody(d, before);
  const nothing = !!before && !!out.body && !Object.keys(out.body).length;
  const save = async () => {
    if (!out.body) return setError(out.error);
    setBusy(true);
    setError(null);
    try {
      if (meeting) await updateMeeting(meeting.id, out.body);
      else await addMeeting(tenderId, out.body);
      toast('success', meeting ? 'Saved.' : 'Meeting recorded.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof MeetingDraft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Sheet
      title={meeting ? 'Edit the meeting' : 'Add a meeting'}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || nothing} onClick={() => void save()}>
            {busy ? 'Saving…' : meeting ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="What">
          <Select<string> aria-label="What" value={d.kind} onValueChange={(v) => setD({ ...d, kind: v })} options={MEETING_KINDS.map(([value, label]) => ({ value, label }))} className={input} />
        </Field>
        <Field label="How">
          <Select<string> aria-label="How" value={d.mode} onValueChange={(v) => setD({ ...d, mode: v })} options={MODES.map(([value, label]) => ({ value, label }))} className={input} />
        </Field>
        <Field label="When">
          <span className="flex gap-1.5">
            <input type="date" aria-label="Meeting date" value={d.date} onChange={set('date')} className={input} />
            <input type="time" aria-label="Meeting time" value={d.time} onChange={set('time')} className={input + ' !w-[110px]'} />
          </span>
        </Field>
        <Field label="Questions due" hint={d.qDate && !d.qTime ? 'A day alone means by the end of it.' : undefined}>
          <span className="flex gap-1.5">
            <input type="date" aria-label="Questions due date" value={d.qDate} onChange={(e) => setD({ ...d, qDate: e.target.value, ...(e.target.value ? {} : { qTime: '' }) })} className={input} />
            <input type="time" aria-label="Questions due time" disabled={!d.qDate} value={d.qTime} onChange={set('qTime')} className={input + ' !w-[110px]'} />
          </span>
        </Field>
        <Field label="Where">
          <input aria-label="Where" value={d.venue} onChange={set('venue')} maxLength={250} className={input} />
        </Field>
        <Field label="Link">
          <input aria-label="Link" value={d.link} onChange={set('link')} maxLength={500} placeholder="https://" className={input} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <Checkbox checked={d.mandatory} onChange={(e) => setD({ ...d, mandatory: e.target.checked })} />
        Attendance is mandatory
      </label>
      {meeting ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex items-center gap-2 pt-5 text-[12.5px] font-semibold text-ink">
              <Checkbox checked={d.attended} onChange={(e) => setD({ ...d, attended: e.target.checked })} />
              We attended
            </label>
            <Field label="Who went">
              <input aria-label="Who went" value={d.attended_by} onChange={set('attended_by')} maxLength={250} className={input} />
            </Field>
          </div>
        </>
      ) : null}
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
