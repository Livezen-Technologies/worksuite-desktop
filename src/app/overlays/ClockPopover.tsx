import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { closeOverlay, openOverlay, ui } from '../../core/ui';
import { duration } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { attendanceTime, clockAttendance, clockError, useAttendance, useNow, workedSeconds } from '../../modules/hr/attendance';
import { Popover, PopoverHeader } from './Popover';

/**
 * Clock in / clock out in the title bar, for anybody linked to an employee
 * record in an organization that has HR.
 *
 * Clocking IN is one click, because it is the first thing somebody does and
 * a dialog in the way of it is a reason not to. Clocking OUT always opens the
 * popover first: an accidental clock-out ends the working day on the record,
 * and a misplaced click in the title bar is easy. A policy that asks for a note
 * opens the popover either way.
 */
export function ClockControl() {
  const hasHr = useStore(app, (s) => s.apps.some((a) => a.id === 'hr'));
  const overlay = useStore(ui, (s) => s.overlay);
  const { a, today, clockedIn, needNote, countedAt } = useAttendance(hasHr);
  const now = useNow();
  const [busy, setBusy] = useState(false);

  if (!hasHr || !a?.linked) return null;

  const clockIn = async () => {
    setBusy(true);
    try {
      await clockAttendance('in');
      toast('success', 'Clocked in. Have a good day.');
    } catch (e) {
      toast('error', clockError(e));
    } finally {
      setBusy(false);
    }
  };

  const onClick = () => {
    if (clockedIn || needNote) openOverlay('clock');
    else void clockIn();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-haspopup={clockedIn || needNote ? 'dialog' : undefined}
      aria-label={clockedIn ? `Clocked in for ${duration(workedSeconds(today, true, now, countedAt))}. Clock out` : 'Clock in'}
      className={cx(
        'no-drag flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold disabled:opacity-60',
        clockedIn ? 'bg-[#43B581]/12 text-[#7EE2B0] hover:bg-[#43B581]/20' : 'bg-white/7 text-navy-ink hover:bg-white/12 hover:text-white',
        overlay === 'clock' && 'ring-1 ring-white/25',
      )}
    >
      {busy ? <Icon name="spinner" size={15} className="animate-spin-slow" /> : <Icon name={clockedIn ? 'timer' : 'clock'} size={15} />}
      {clockedIn ? <span className="font-mono tabular">{duration(workedSeconds(today, true, now, countedAt))}</span> : today?.check_out ? 'Clock in again' : 'Clock in'}
    </button>
  );
}

export function ClockPopover() {
  const { a, today, clockedIn, needNote, countedAt } = useAttendance();
  const now = useNow();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async () => {
    setBusy(true);
    try {
      await clockAttendance(clockedIn ? 'out' : 'in', note);
      toast('success', clockedIn ? 'Clocked out.' : 'Clocked in. Have a good day.');
      closeOverlay();
    } catch (e) {
      toast('error', clockError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover label="Attendance" width={320} offset={300}>
      <PopoverHeader title="Attendance" />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className={cx('flex h-10 w-10 items-center justify-center rounded-full', clockedIn ? 'bg-success-bg text-success' : 'bg-subtle text-ink-3')}>
            <Icon name={clockedIn ? 'timer' : 'clock'} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-ink">{clockedIn ? 'Clocked in' : today?.check_out ? 'Clocked out' : 'Not clocked in yet'}</div>
            <div className="text-[12px] text-ink-3">
              {today?.check_in ? `In at ${attendanceTime(today.check_in)}` : 'Your day has not started'}
              {today?.check_out ? ` · out at ${attendanceTime(today.check_out)}` : ''}
            </div>
          </div>
          <div className="font-mono text-[17px] font-semibold text-ink tabular">{duration(workedSeconds(today, clockedIn, now, countedAt))}</div>
        </div>
        {a?.linked ? (
          <>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={needNote ? 'A note is required' : 'Note (optional)'}
              aria-label="Attendance note"
              maxLength={500}
              className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary"
            />
            <Button variant={clockedIn ? 'danger' : 'success'} size="lg" loading={busy} disabled={needNote && !note.trim()} onClick={() => void act()}>
              {clockedIn ? 'Clock out' : today?.check_out ? 'Clock in again' : 'Clock in'}
            </Button>
          </>
        ) : null}
        <button type="button" className="text-left text-[12.5px] font-semibold text-primary hover:underline" onClick={() => (closeOverlay(), navigate('/hr'))}>
          Open HR
        </button>
      </div>
    </Popover>
  );
}
