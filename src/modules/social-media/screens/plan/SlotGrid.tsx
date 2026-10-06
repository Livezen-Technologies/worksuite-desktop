/**
 * W04 "Weekly posting slots" and the blackout dates behind "Manage" (SMM-SCH-006, SMM-SCH-007, SMM-SCH-010): slots per
 * weekday on the brand's clock, the best hours of the last 90 days starred, a minimum gap per account, and periods in
 * which posting is held or skipped.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
import { Button, cx, Modal, Spinner } from '../../../../components/ui';
import { Icon } from '../../../../components/Icon';
import { errorMessage } from '../../../../core/bridge';
import { parseTs } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { SK, socialApi, useBlackouts, useInvalidate, type Blackout, type QueueInfo, type QueueSlot } from '../../api';
import { ConfirmButton, Field, INPUT, NativeSelect, NotOffered, Panel, Pill, Refused } from '../../parts';
import { addDays, inZone, parseHhmm, WEEKDAYS_SHORT, zonedToUtc } from '../../lib/time';

type Scope = { brand_id: number | null; account_id: number | null };

const sameSlots = (a: QueueSlot[], b: QueueSlot[]) => a.length === b.length && a.every((s, i) => s.weekday === b[i]!.weekday && s.local_time === b[i]!.local_time && s.enabled === b[i]!.enabled);
const sortSlots = (s: QueueSlot[]) => [...s].sort((a, b) => a.weekday - b.weekday || a.local_time.localeCompare(b.local_time));

/** Mount with `key` = the scope, so another brand or account starts from its own saved slots. */
export function SlotGrid({ info, scope, canEdit, canBlackouts }: { info: QueueInfo; scope: Scope; canEdit: boolean; canBlackouts: boolean }) {
  const saved = sortSlots(info.slots);
  const [slots, setSlots] = useState<QueueSlot[]>(saved);
  const [gap, setGap] = useState(String(info.min_gap_minutes));
  const [adding, setAdding] = useState<number | null>(null);
  const [newTime, setNewTime] = useState('');
  const [blackouts, setBlackouts] = useState(false);
  const invalidate = useInvalidate();

  const gapN = Number(gap);
  const gapOk = /^\d{1,4}$/.test(gap) && gapN >= 0;
  const changed = !sameSlots(slots, saved) || (gapOk && gapN !== info.min_gap_minutes);

  const save = useMutation({
    mutationFn: () => socialApi.saveSlots(scope, { slots, min_gap_minutes: gapN }),
    onSuccess: () => {
      invalidate(SK.queueAll);
      toast('success', 'Posting slots saved. Queued posts move to the new slots; timed posts stay where they are.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const add = (weekday: number) => {
    const m = parseHhmm(newTime);
    if (m === null) return toast('warning', 'Enter a time like 09:30.');
    const local = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (!slots.some((s) => s.weekday === weekday && s.local_time === local)) setSlots(sortSlots([...slots, { weekday, local_time: local, enabled: true }]));
    setAdding(null);
    setNewTime('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, weekday: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(weekday);
    } else if (e.key === 'Escape') {
      setAdding(null);
      setNewTime('');
    }
  };

  return (
    <Panel
      title="Weekly posting slots"
      action={
        <span className="flex items-center gap-3">
          <span className="hidden items-center gap-1 text-[12px] text-primary sm:inline-flex">
            <Icon name="star" size={13} /> Best time from the last 90 days of engagement
          </span>
          {canEdit && changed ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSlots(saved);
                  setGap(String(info.min_gap_minutes));
                }}
              >
                Undo
              </Button>
              <Button size="sm" variant="primary" loading={save.isPending} disabled={!gapOk} onClick={() => save.mutate()}>
                Save
              </Button>
            </>
          ) : null}
        </span>
      }
    >
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {WEEKDAYS_SHORT.map((day, i) => {
          const wd = i + 1;
          const mine = slots.filter((s) => s.weekday === wd);
          return (
            <div key={day} className="flex min-w-0 flex-col gap-1.5" role="group" aria-label={day}>
              <span className="text-[12.5px] font-bold text-ink">{day}</span>
              {mine.length ? null : <span className="text-[11.5px] text-ink-3">No slots</span>}
              {mine.map((s) => (
                <span
                  key={s.local_time}
                  title={s.best ? 'Best time from the last 90 days of engagement' : undefined}
                  className={cx('group relative flex h-8 items-center justify-between rounded-[8px] border px-2.5 font-mono text-[12.5px] tabular-nums', s.best ? 'border-primary/30 bg-selection text-ink' : 'border-line bg-surface text-ink')}
                >
                  {s.local_time}
                  <span className="flex items-center">
                    {s.best ? <Icon name="star" size={13} className="text-primary" label="Best time" /> : null}
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`Remove ${day} ${s.local_time}`}
                        title="Remove"
                        onClick={() => setSlots(slots.filter((x) => x !== s))}
                        className="ml-1 hidden h-5 w-5 items-center justify-center rounded-[5px] text-ink-3 group-hover:flex hover:bg-subtle hover:text-danger focus-visible:flex"
                      >
                        <Icon name="x" size={13} />
                      </button>
                    ) : null}
                  </span>
                </span>
              ))}
              {canEdit ? (
                adding === wd ? (
                  <span className="flex gap-1">
                    <input
                      type="time"
                      aria-label={`New slot on ${day}`}
                      autoFocus
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      onKeyDown={(e) => onKey(e, wd)}
                      className={cx(INPUT, 'h-8 px-1.5 font-mono')}
                    />
                    <Button size="sm" onClick={() => add(wd)} aria-label={`Add slot on ${day}`}>
                      Add
                    </Button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Add a slot on ${day}`}
                    onClick={() => {
                      setAdding(wd);
                      setNewTime('');
                    }}
                    className="h-8 rounded-[8px] border border-dashed border-line text-[12px] font-semibold text-ink-2 hover:border-primary hover:text-primary"
                  >
                    + Slot
                  </button>
                )
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <span>
          Time zone: <b className="text-ink-2">{info.timezone}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          Minimum gap per account:
          {canEdit ? (
            <input aria-label="Minimum gap per account, in minutes" inputMode="numeric" value={gap} onChange={(e) => setGap(e.target.value.trim())} className={cx(INPUT, 'h-7 w-16 px-2 text-center font-semibold', !gapOk && 'border-danger')} />
          ) : (
            <b className="text-ink-2">{info.min_gap_minutes}</b>
          )}
          minutes
        </span>
        <span className="inline-flex items-center gap-1.5">
          Blackout dates: <b className="text-ink-2">{info.blackouts_count} set</b> (posting held, owner notified)
          {canBlackouts ? (
            <button type="button" onClick={() => setBlackouts(true)} className="font-semibold text-primary hover:underline">
              Manage
            </button>
          ) : null}
        </span>
      </p>
      {blackouts ? <BlackoutsModal brandId={scope.brand_id} tz={info.timezone} onClose={() => setBlackouts(false)} /> : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */

function blackoutDays(b: Blackout, tz: string): string {
  const start = inZone(b.starts_at, tz).ymd;
  const end = inZone(new Date(parseTs(b.ends_at).getTime() - 60_000), tz).ymd;
  return start === end ? start : `${start} – ${end}`;
}

function BlackoutsModal({ brandId, tz, onClose }: { brandId: number | null; tz: string; onClose: () => void }) {
  const q = useBlackouts();
  const invalidate = useInvalidate();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [mode, setMode] = useState<Blackout['mode']>('hold');
  const [reason, setReason] = useState('');

  const done = () => invalidate(SK.blackouts, SK.queueAll);
  const add = useMutation({
    mutationFn: () => socialApi.addBlackout({ brand_id: brandId, starts_at: zonedToUtc(start, 0, tz), ends_at: zonedToUtc(addDays(end || start, 1), 0, tz), mode, reason: reason.trim() || null }),
    onSuccess: () => {
      done();
      setStart('');
      setEnd('');
      setReason('');
      toast('success', 'Blackout added.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => socialApi.deleteBlackout(id),
    onSuccess: done,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const valid = !!start && (!end || end >= start);

  return (
    <Modal title="Blackout dates" onClose={onClose} width={600} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-ink-3">
          Dates on the brand’s clock ({tz}). <b>Hold</b> keeps posts until the period ends and notifies the owner; <b>Skip</b> moves queued posts to the next free slot after it.
        </p>
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <Refused error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data && !q.data.offered ? (
          <NotOffered what="Blackout dates" compact />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
            {(q.data?.offered ? q.data.data : [])
              .filter((b) => brandId === null || b.brand_id === null || b.brand_id === brandId)
              .map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="font-mono text-[12.5px] text-ink tabular-nums">{blackoutDays(b, tz)}</span>
                  <Pill tone={b.mode === 'hold' ? 'warning' : 'muted'}>{b.mode === 'hold' ? 'Hold' : 'Skip'}</Pill>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{b.reason}</span>
                  <ConfirmButton size="sm" variant="ghost" icon="trash" label="Delete" confirm="Delete" loading={remove.isPending && remove.variables === b.id} onConfirm={() => remove.mutate(b.id)} />
                </li>
              ))}
            {q.data?.offered && !q.data.data.length ? <li className="px-3 py-3 text-[12.5px] text-ink-3">No blackout dates.</li> : null}
          </ul>
        )}
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) add.mutate();
          }}
        >
          <Field label="From">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT} required />
          </Field>
          <Field label="To (inclusive)">
            <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={INPUT} />
          </Field>
          <Field label="Mode">
            <NativeSelect label="Mode" value={mode} onChange={(v) => setMode(v as Blackout['mode'])}>
              <option value="hold">Hold</option>
              <option value="skip">Skip</option>
            </NativeSelect>
          </Field>
          <Field label="Reason" className="sm:col-span-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Deepavali" className={INPUT} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" disabled={!valid} loading={add.isPending} className="w-full">
              Add
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
