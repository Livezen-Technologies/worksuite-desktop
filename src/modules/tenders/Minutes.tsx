import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { addDays, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, Sheet } from '../../components/PageKit';
import { PRIORITIES } from '../tasks/api';
import { wallParts } from './api';
import { convertedLabel, parseMinutes, POINT_MAX, saveMinutes, toFollowUp, toReminder, toTask, writeMinutes, type Context, type Converted, type Minutes, type Point } from './minutesText';
import { useDirectory } from './people';
import { labelOf, MEETING_KINDS, type Meeting } from './work';

const ICON: Record<Converted['kind'], string> = { task: 'tasks', reminder: 'bell', followup: 'repeat' };

/** Where a converted point goes when it is clicked: the task, or the day in the calendar. */
function openConverted(c: Converted) {
  if (c.kind === 'task') navigate(`/tasks?task=${c.id}`);
  else if (c.kind === 'reminder') navigate(`/calendar?date=${c.at.slice(0, 10)}`);
}

export function ConvertedChip({ c }: { c: Converted }) {
  const clickable = c.kind !== 'followup';
  const body = (
    <>
      <Icon name={ICON[c.kind]} size={11} /> {convertedLabel(c)}
    </>
  );
  const cls = 'inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary';
  return clickable ? (
    <button type="button" className={cx(cls, 'hover:underline')} title={c.kind === 'task' ? 'Open the task' : 'Open the day in the calendar'} onClick={() => openConverted(c)}>
      {body}
    </button>
  ) : (
    <span className={cls} title="A meeting on this tender">
      {body}
    </span>
  );
}

/** A meeting's minutes on its row: the notes, then the points and what each became. */
export function MinutesView({ minutes }: { minutes: string | null }) {
  const m = parseMinutes(minutes);
  if (!m.notes && !m.points.length) return null;
  return (
    <div className="mt-0.5 flex flex-col gap-1" aria-label="Minutes">
      {m.notes ? <span className="text-[12px] whitespace-pre-wrap text-ink">{m.notes}</span> : null}
      {m.points.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {m.points.map((p, i) => (
            <li key={i} className="flex flex-wrap items-start gap-1.5 text-[12px] text-ink">
              <span className={cx('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', p.done ? 'bg-primary' : 'bg-ink-3')} />
              <span className="min-w-0 flex-1">{p.text}</span>
              {p.done ? <ConvertedChip c={p.done} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type Converting = { index: number; kind: Converted['kind'] };

/**
 * Writing the minutes: notes, and the points agreed. A point can be made a
 * task (for anyone, with a due date), a reminder (in your own calendar), or a
 * follow-up meeting on this tender. Converting saves the minutes at once, so
 * the point shows what it became for everyone.
 */
export function MinutesSheet({ tenderId, tender, meeting, onClose, onSaved }: { tenderId: number; tender: string | null; meeting: Meeting; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState<Minutes>(() => parseMinutes(meeting.minutes));
  const [saved, setSaved] = useState(() => writeMinutes(parseMinutes(meeting.minutes)));
  const [adding, setAdding] = useState('');
  const [converting, setConverting] = useState<Converting | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = meeting.scheduled_at ? wallParts(meeting.scheduled_at).date || null : null;
  const ctx: Context = { tenderId, tender, meeting, day };
  const withAdded = (x: Minutes): Minutes => (adding.trim() ? { ...x, points: [...x.points, { text: adding.trim().slice(0, POINT_MAX), done: null }] } : x);
  const changed = writeMinutes(withAdded(m)) !== saved;

  const setPoint = (i: number, p: Partial<Point>) => setM((x) => ({ ...x, points: x.points.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
  const add = () => {
    if (!adding.trim()) return;
    setM(withAdded(m));
    setAdding('');
  };
  const remove = (i: number) => {
    setM((x) => ({ ...x, points: x.points.filter((_, j) => j !== i) }));
    setConverting((c) => (c && c.index === i ? null : c && c.index > i ? { ...c, index: c.index - 1 } : c));
  };

  const persist = async (next: Minutes) => {
    await saveMinutes(meeting.id, next);
    setSaved(writeMinutes(next));
    onSaved();
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = withAdded(m);
      await persist(next);
      toast('success', 'Minutes saved.');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const convert = async (i: number, run: (point: string) => Promise<Converted>, word: string) => {
    const point = m.points[i];
    if (!point || point.done) return;
    setBusy(true);
    setError(null);
    let done: Converted;
    try {
      done = await run(point.text);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      return;
    }
    // The task (or reminder, or meeting) exists now; the minutes say so.
    const next: Minutes = { ...m, points: m.points.map((q, j) => (j === i ? { ...q, done } : q)) };
    setM(next);
    setConverting(null);
    try {
      await persist(next);
      toast('success', `${word} created.`);
    } catch (e) {
      setError(`${word} created, but the minutes were not saved: ${errorMessage(e)}. Save them again.`);
    } finally {
      setBusy(false);
    }
  };

  const title = `Minutes · ${labelOf(MEETING_KINDS, meeting.kind)}${day ? ` · ${day}` : ''}`;
  return (
    <Sheet
      title={title}
      width={640}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            {changed ? 'Cancel' : 'Close'}
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !changed} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Field label="Notes">
        <textarea
          aria-label="Notes"
          value={m.notes}
          onChange={(e) => setM({ ...m, notes: e.target.value })}
          rows={4}
          placeholder="What was said, who was there, anything worth keeping"
          className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-normal text-ink outline-none focus:border-primary"
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-ink">Points agreed</span>
        {m.points.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Points agreed">
            {m.points.map((p, i) => (
              <li key={i} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-subtle/40 px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  {p.done ? (
                    <span className="min-w-0 flex-1 text-[13px] text-ink">{p.text}</span>
                  ) : (
                    <input aria-label={`Point ${i + 1}`} value={p.text} maxLength={POINT_MAX} onChange={(e) => setPoint(i, { text: e.target.value })} className={input + ' !h-[30px] flex-1'} />
                  )}
                  {p.done ? (
                    <ConvertedChip c={p.done} />
                  ) : (
                    <span className="flex shrink-0 items-center gap-1" role="group" aria-label={`Make point ${i + 1} into`}>
                      {(
                        [
                          ['task', 'Task'],
                          ['reminder', 'Reminder'],
                          ['followup', 'Follow-up'],
                        ] as Array<[Converted['kind'], string]>
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={converting?.index === i && converting.kind === k}
                          disabled={busy || !p.text.trim()}
                          onClick={() => setConverting(converting?.index === i && converting.kind === k ? null : { index: i, kind: k })}
                          className={cx(btnSmall, '!h-[28px] gap-1 !px-2 !text-[12px]', converting?.index === i && converting.kind === k && '!border-primary !text-primary')}
                        >
                          <Icon name={ICON[k]} size={12} /> {label}
                        </button>
                      ))}
                    </span>
                  )}
                  {p.done ? null : (
                    <button type="button" aria-label={`Remove point ${i + 1}`} title="Remove" disabled={busy} onClick={() => remove(i)} className="px-1 text-[16px] leading-none text-ink-3 hover:text-danger">
                      ×
                    </button>
                  )}
                </div>
                {converting?.index === i && !p.done ? (
                  <ConvertForm
                    kind={converting.kind}
                    busy={busy}
                    meeting={meeting}
                    onCancel={() => setConverting(null)}
                    onTask={(o) => void convert(i, (t) => toTask(t, ctx, o), 'Task')}
                    onReminder={(o) => void convert(i, (t) => toReminder(t, ctx, o), 'Reminder')}
                    onFollowUp={(o) => void convert(i, (t) => toFollowUp(t, ctx, o), 'Follow-up meeting')}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <span className="flex gap-1.5">
          <input
            aria-label="A new point"
            value={adding}
            maxLength={POINT_MAX}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="A decision or an action — Enter to add it"
            className={input}
          />
          <button type="button" className={btn} disabled={!adding.trim()} onClick={add}>
            <Icon name="plus" size={14} /> Add
          </button>
        </span>
        <span className="text-[11.5px] text-ink-3">Making a point into a task, a reminder or a follow-up saves the minutes straight away.</span>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

function ConvertForm({
  kind,
  busy,
  meeting,
  onCancel,
  onTask,
  onReminder,
  onFollowUp,
}: {
  kind: Converted['kind'];
  busy: boolean;
  meeting: Meeting;
  onCancel: () => void;
  onTask: (o: { assignee: number | null; due: string; priority: string }) => void;
  onReminder: (o: { date: string; time: string }) => void;
  onFollowUp: (o: { date: string; time: string; kind: string }) => void;
}) {
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const people = useDirectory();
  const tomorrow = addDays(todayInZone(), 1);
  const [assignee, setAssignee] = useState<string>(me ? String(me) : '');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('medium');
  const [date, setDate] = useState(kind === 'followup' ? addDays(todayInZone(), 7) : tomorrow);
  const [time, setTime] = useState(kind === 'followup' ? (wallParts(meeting.scheduled_at).time || '10:00') : '09:00');
  const [followKind, setFollowKind] = useState(meeting.kind === 'opening' ? 'other' : 'clarification');
  const past = !!date && !!time && `${date}T${time}` < `${todayInZone()}T00:00`;

  const go = () => {
    if (kind === 'task') onTask({ assignee: assignee ? Number(assignee) : null, due, priority });
    else if (kind === 'reminder') onReminder({ date, time });
    else onFollowUp({ date, time, kind: followKind });
  };
  const ready = kind === 'task' ? true : !!date && !!time && !past;
  const verb = kind === 'task' ? 'Create the task' : kind === 'reminder' ? 'Set the reminder' : 'Add the follow-up';

  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-line bg-surface p-2.5" aria-label={verb}>
      {kind === 'task' ? (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Assign to">
            <Select<string>
              aria-label="Assign to"
              value={assignee}
              onValueChange={setAssignee}
              options={[...(me ? [{ value: String(me), label: 'Me' }] : []), ...people.filter((u) => u.id !== me).map((u) => ({ value: String(u.id), label: u.name }))]}
              className={input}
            />
          </Field>
          <Field label="Due">
            <input type="date" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
          </Field>
          <Field label="Priority">
            <Select<string> aria-label="Priority" value={priority} onValueChange={setPriority} options={PRIORITIES.filter((p) => p.id !== 'none').map((p) => ({ value: p.id, label: p.label }))} className={input} />
          </Field>
        </div>
      ) : (
        <div className={cx('grid gap-2', kind === 'followup' ? 'grid-cols-3' : 'grid-cols-2')}>
          <Field label={kind === 'reminder' ? 'Remind me on' : 'Meet on'} hint={past ? 'That is already past.' : undefined}>
            <input type="date" aria-label={kind === 'reminder' ? 'Reminder date' : 'Follow-up date'} value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </Field>
          <Field label="At">
            <input type="time" aria-label={kind === 'reminder' ? 'Reminder time' : 'Follow-up time'} value={time} onChange={(e) => setTime(e.target.value)} className={input} />
          </Field>
          {kind === 'followup' ? (
            <Field label="What">
              <Select<string> aria-label="Follow-up kind" value={followKind} onValueChange={setFollowKind} options={MEETING_KINDS.map(([value, label]) => ({ value, label }))} className={input} />
            </Field>
          ) : null}
        </div>
      )}
      <span className="text-[11.5px] text-ink-3">
        {kind === 'task'
          ? 'A task in Tasks, tagged “tender”, with a link back to this tender.'
          : kind === 'reminder'
            ? 'An event in your own calendar; WorkSuite reminds you when it comes.'
            : `Another meeting on this tender, ${labelOf([['physical', 'in person'], ['online', 'online'], ['hybrid', 'hybrid']], meeting.mode ?? 'physical')} like this one, with this point as its first line.`}
      </span>
      <span className="flex justify-end gap-1.5">
        <button type="button" className={btnSmall} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={cx(btnSmall, '!border-primary !bg-primary !text-white hover:!bg-primary-hover')} disabled={busy || !ready} onClick={go}>
          {busy ? 'Working…' : verb}
        </button>
      </span>
    </div>
  );
}
