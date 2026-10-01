import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { closeOverlay, openOverlay, ui } from '../../core/ui';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import {
  attendanceBreak,
  attendanceTime as wall,
  breakSecondsNow,
  clockAttendance,
  clockDigits,
  clockError,
  companyDateLabel,
  dayPhase,
  hoursMinutes,
  openBreak,
  openBreakSeconds,
  requiredMinutes,
  shiftLine,
  useAttendance,
  useNow,
  workedSeconds,
  type DayPhase,
  type NoteType,
} from '../../modules/hr/attendance';
import { Popover } from './Popover';
import { Checkbox } from '../../components/Checkbox';

/**
 * Clock in / clock out in the title bar (ClockIn), for anybody linked to an
 * employee record in an organization that has HR: a pill that says where the
 * day has got to — "Clock In", the time worked, "On break · 14m", or the day's
 * total — and "Today's attendance" under it.
 *
 * Clocking in asks where you are working (the company's work locations) in
 * the same click that opens the popover; clocking OUT is a second, confirmed
 * step, because an accidental clock-out ends the working day on the record and
 * a misplaced click in the title bar is easy. Breaks start and end from here.
 */
let anchorRight = 300;

const PILL: Record<DayPhase, string> = {
  none: 'bg-[#1B2B57] text-white',
  working: 'bg-[#123D33] text-[#9EE6C3]',
  break: 'bg-[#3A3413] text-[#FDE68A]',
  done: 'bg-[#1B2B57] text-[#C9D3EE]',
};

export function ClockControl() {
  const hasHr = useStore(app, (s) => s.apps.some((a) => a.id === 'hr'));
  const overlay = useStore(ui, (s) => s.overlay);
  const { a, today, clockedIn, countedAt } = useAttendance(hasHr);
  const now = useNow();

  if (!hasHr || !a?.linked) return null;
  const phase = dayPhase(today);
  const worked = workedSeconds(today, clockedIn, now, countedAt);
  const label =
    phase === 'working'
      ? `Working, ${hoursMinutes(worked)}. Open attendance.`
      : phase === 'break'
        ? `On break for ${hoursMinutes(openBreakSeconds(today, now, countedAt))}. Open attendance.`
        : phase === 'done'
          ? `Clocked out after ${hoursMinutes(worked)}. Open attendance.`
          : 'Clock in';

  return (
    <button
      type="button"
      data-clock-pill
      onMouseDown={(e) => overlay === 'clock' && e.stopPropagation()}
      onClick={(e) => {
        if (overlay === 'clock') return closeOverlay();
        const r = e.currentTarget.getBoundingClientRect();
        anchorRight = Math.max(8, window.innerWidth - r.right);
        openOverlay('clock');
      }}
      aria-haspopup="dialog"
      aria-expanded={overlay === 'clock'}
      aria-label={label}
      className={cx('no-drag flex h-8 shrink-0 items-center gap-2 rounded-full border border-white/12 px-3 text-[12.5px] font-bold tabular-nums hover:brightness-110', PILL[phase], overlay === 'clock' && 'ring-1 ring-white/30')}
    >
      {phase === 'working' ? <span className="h-2 w-2 rounded-full bg-[#3DD68C] shadow-[0_0_0_4px_rgba(61,214,140,.25)]" /> : null}
      {phase === 'break' ? <span className="h-2 w-2 rounded-full bg-[#F5B53D]" /> : null}
      {phase === 'none' ? <Icon name="clock" size={15} /> : null}
      {phase === 'done' ? <Icon name="check" size={14} /> : null}
      {phase === 'working' ? hoursMinutes(worked) : phase === 'break' ? `On break · ${Math.floor(openBreakSeconds(today, now, countedAt) / 60)}m` : phase === 'done' ? hoursMinutes(worked) : 'Clock In'}
    </button>
  );
}

const DAY_KINDS: Array<[NoteType, string]> = [
  ['normal', 'Office work'],
  ['customer_visit', 'Client visit'],
  ['off_site', 'Off site'],
  ['wfh', 'Work from home'],
  ['overtime', 'Overtime'],
  ['early_departure', 'Leaving early'],
  ['technical_issue', 'Technical issue'],
  ['other', 'Other'],
];

const BADGE: Record<DayPhase, [string, string]> = {
  none: ['Not clocked in', 'bg-subtle text-ink-2'],
  working: ['Working', 'bg-success-bg text-success'],
  break: ['On break', 'bg-warning-bg text-warning'],
  done: ['Complete', 'bg-selection text-primary'],
};

/** The day as a ring: how much of it is done. */
export function Ring({ size, fraction, tone, children }: { size: number; fraction: number; tone: 'green' | 'amber' | 'blue'; children: React.ReactNode }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={10} className="stroke-[#EEF0F5] dark:stroke-line" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${(c * f).toFixed(1)} ${c.toFixed(1)}`} className={tone === 'green' ? 'stroke-[#1F9D5C]' : tone === 'amber' ? 'stroke-[#E9A23B]' : 'stroke-primary'} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-px rounded-[12px] bg-well px-2.5 py-[9px]">
      <span className="text-[11px] text-ink-3">{label}</span>
      <b className="text-[14px] text-ink tabular-nums">{value}</b>
      {sub !== undefined ? <span className="truncate text-[10.5px] text-ink-3">{sub ?? ''}</span> : null}
    </div>
  );
}

const big = 'flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[14px] font-bold disabled:opacity-60';

export function ClockPopover() {
  const { a, today, clockedIn, needNote, countedAt } = useAttendance();
  const now = useNow(1_000);
  const phase = dayPhase(today);
  const [step, setStep] = useState<'main' | 'out' | 'again'>('main');
  const [where, setWhere] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<NoteType | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offset] = useState(() => anchorRight);

  const policy = a?.policy;
  const tz = a?.timezone ?? '';
  const required = requiredMinutes(a, today);
  const worked = workedSeconds(today, clockedIn, now, countedAt);
  const breakAll = breakSecondsNow(today, now, countedAt);
  const breakOpen = openBreakSeconds(today, now, countedAt);
  const open = openBreak(today);
  const overtime = (today?.overtime_minutes ?? 0) * 60;
  const resumeAt = policy?.resume_locations ?? [];
  const choices = step === 'again' ? resumeAt : (a?.locations ?? []);
  const place = where && choices.includes(where) ? where : (choices.find((l) => l === today?.work_location) ?? choices[0] ?? null);
  const locMode = policy?.location_mode ?? 'off';
  const needReason = locMode === 'required';

  const act = async (what: 'in' | 'out' | 'break' | 'resume') => {
    setBusy(true);
    try {
      if (what === 'in') {
        await clockAttendance('in', { note, workLocation: place, geoNote: needReason ? reason : undefined });
        toast('success', 'Clocked in. Have a good day.');
      } else if (what === 'out') {
        await clockAttendance('out', { note, noteType: kind, geoNote: needReason ? reason : undefined });
        toast('success', 'Clocked out. Have a good evening.');
      } else {
        await attendanceBreak(what === 'break' ? 'start' : 'end');
        toast('success', what === 'break' ? 'Break started.' : 'Welcome back.');
      }
      setStep('main');
      setNote('');
      setConfirmed(false);
    } catch (e) {
      toast('error', clockError(e));
    } finally {
      setBusy(false);
    }
  };

  const showing: DayPhase | 'out' | 'again' = step === 'out' && phase === 'working' ? 'out' : step === 'again' && phase === 'done' ? 'again' : phase;
  const badge = BADGE[showing === 'out' ? 'working' : showing === 'again' ? 'done' : showing];

  const whereBlock = (
    <>
      {choices.length ? (
        <>
          <b className="text-[12.5px] text-ink">Where are you working?</b>
          <div role="radiogroup" aria-label="Where are you working?" className="flex flex-wrap gap-1.5">
            {choices.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={l === place}
                onClick={() => setWhere(l)}
                className={cx('flex h-8 items-center rounded-full border px-3 text-[12.5px] font-semibold', l === place ? 'border-[#1F9D5C] bg-success-bg text-success' : 'border-line text-ink-2 hover:text-ink')}
              >
                {l}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {locMode !== 'off' ? <Location required={needReason} reason={reason} setReason={setReason} skips={policy?.location_skips_30d ?? 0} /> : null}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={policy?.checkin_note_required ? 'A note is required' : 'Optional — e.g. “working from home today”.'}
        aria-label="Clock-in note"
        maxLength={255}
        className="h-[42px] rounded-full border border-line bg-ground px-3.5 text-[13px] text-ink outline-none focus:border-primary"
      />
      <div className="flex">
        <button type="button" disabled={busy || (!!policy?.checkin_note_required && !note.trim()) || (needReason && !reason.trim())} onClick={() => void act('in')} className={cx(big, 'bg-[#1F9D5C] text-white hover:bg-[#1A8A50]')}>
          {busy ? <Icon name="spinner" size={17} className="animate-spin-slow" /> : <Icon name="clock" size={17} />}
          {showing === 'again' ? 'Clock In again' : 'Clock In'}
        </button>
      </div>
    </>
  );

  return (
    <Popover label="Today's attendance" width={340} offset={offset} className="rounded-[22px] shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.22),0_0_0_1px_var(--ws-edge)]">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-1.5">
        <b className="flex-1 text-[15px] text-ink">Today's attendance</b>
        <span className={cx('rounded-[10px] px-2.5 py-[3px] text-[11.5px] font-bold', badge[1])}>{badge[0]}</span>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-2 pb-3.5 scroll-thin">
        {showing === 'none' || showing === 'again' ? (
          <>
            <div className="flex items-center gap-3.5">
              <Ring size={120} fraction={showing === 'again' && required ? worked / (required * 60) : 0} tone="green">
                <b className="text-[26px] text-ink tabular-nums">{companyClock(now, tz)}</b>
                <span className="text-[11px] text-ink-3">Current time</span>
              </Ring>
              <div className="flex min-w-0 flex-col gap-1">
                <b className="text-[14px] text-ink">{showing === 'again' ? 'Back to work?' : 'Not clocked in yet'}</b>
                <span className="text-[12px] text-ink-3">{shiftLine(a, today)}</span>
                {showing === 'again' ? <span className="text-[12px] text-ink-3">{hoursMinutes(worked)} worked so far today</span> : required ? <span className="text-[12px] text-ink-3">{hoursMinutes(required * 60)} required</span> : null}
              </div>
            </div>
            {whereBlock}
            {showing === 'again' ? (
              <button type="button" onClick={() => setStep('main')} className="-mt-1 text-[12.5px] font-semibold text-ink-3 hover:text-ink">
                Cancel
              </button>
            ) : null}
          </>
        ) : null}

        {showing === 'working' ? (
          <>
            <div className="flex items-center gap-4">
              <Ring size={128} fraction={required ? worked / (required * 60) : 0} tone="green">
                <b className="text-[24px] text-ink tabular-nums">{clockDigits(worked)}</b>
                <span className="text-[11px] text-ink-3">Working time</span>
              </Ring>
              <div className="flex min-w-0 flex-col gap-1 text-[12px] text-ink-3">
                {required ? (
                  <span>
                    of <b className="text-ink">{hoursMinutes(required * 60)}</b> today
                  </span>
                ) : null}
                <span>{shiftLine(a, today)}</span>
                {required ? <span className="font-semibold text-success">{worked < required * 60 ? `${hoursMinutes(required * 60 - worked)} to go` : `${hoursMinutes(worked - required * 60)} over`}</span> : null}
              </div>
            </div>
            <div className="flex gap-1.5">
              <Tile label="Clocked in" value={wall(today?.check_in)} sub={today?.work_location} />
              <Tile label="Break" value={hoursMinutes(breakAll)} sub={(today?.breaks?.length ?? 0) ? `${today!.breaks!.length} recorded` : 'none yet'} />
              <Tile label="Overtime" value={hoursMinutes(overtime)} sub="" />
            </div>
            <div className="flex gap-2">
              {policy?.break_tracking !== false ? (
                <button type="button" disabled={busy} onClick={() => void act('break')} className={cx(big, 'bg-[#FFF4E0] text-[#9A4A06] hover:bg-[#FDEBCC] dark:bg-warning-bg dark:text-warning')}>
                  <Icon name="coffee" size={17} />
                  Break
                </button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => setStep('out')} className={cx(big, 'bg-[#E5484D] text-white hover:bg-[#D93D42]')}>
                Clock Out
              </button>
            </div>
          </>
        ) : null}

        {showing === 'break' ? (
          <>
            <div className="flex items-center gap-4">
              <Ring size={128} fraction={breakOpen / Math.max(60, (a?.rules?.break_minutes || 60) * 60)} tone="amber">
                <b className="text-[24px] text-ink tabular-nums">{clockDigits(breakOpen)}</b>
                <span className="text-[11px] text-ink-3">Break</span>
              </Ring>
              <div className="flex min-w-0 flex-col gap-1 text-[12px] text-ink-3">
                {open ? <span>since {wall(open.started_at)}</span> : null}
                <span>
                  Working time paused at <b className="text-ink">{hoursMinutes(worked)}</b>
                </span>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Tile label="Clocked in" value={wall(today?.check_in)} sub={today?.work_location} />
              <Tile label="Break" value={hoursMinutes(breakOpen)} sub={open ? `since ${wall(open.started_at)}` : ''} />
              <Tile label="Overtime" value={hoursMinutes(overtime)} sub="" />
            </div>
            <div className="flex">
              <button type="button" disabled={busy} onClick={() => void act('resume')} className={cx(big, 'bg-[#1F9D5C] text-white hover:bg-[#1A8A50]')}>
                {busy ? <Icon name="spinner" size={17} className="animate-spin-slow" /> : <Icon name="play" size={16} />}
                Resume
              </button>
            </div>
          </>
        ) : null}

        {showing === 'out' ? (
          <>
            <div className="flex gap-1.5">
              <Tile label="Clocked in" value={wall(today?.check_in)} />
              <Tile label="Working time" value={hoursMinutes(worked)} />
              <Tile label="Break" value={hoursMinutes(breakAll)} />
            </div>
            <div className="flex flex-col gap-0.5">
              <b className="text-[12.5px] text-ink">What kind of day was it?</b>
              <span className="text-[11.5px] text-ink-3">Optional, and useful in reports later.</span>
            </div>
            <div role="radiogroup" aria-label="What kind of day was it?" className="flex flex-wrap gap-1.5">
              {DAY_KINDS.map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(kind === k ? null : k)} className={cx('flex h-[30px] items-center rounded-full border px-[11px] text-[12px] font-semibold', kind === k ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8] dark:bg-selection dark:text-primary' : 'border-line text-ink-2 hover:text-ink')}>
                  {l}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={needNote ? 'A note is required — what did you work on today?' : 'Add a note about today’s work…'}
              aria-label="Clock-out note"
              maxLength={255}
              className="h-16 resize-none rounded-[16px] border border-line bg-ground px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-primary"
            />
            {needReason ? <Location required reason={reason} setReason={setReason} skips={policy?.location_skips_30d ?? 0} /> : null}
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-ink">
              <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I confirm that I am clocking out.
            </label>
            <span className="-mt-1.5 text-[11.5px] text-ink-3">Today’s hours are recorded when you confirm.</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => (setStep('main'), setConfirmed(false))} className="h-12 rounded-full bg-subtle px-[18px] font-bold text-ink hover:bg-line">
                Cancel
              </button>
              <button type="button" disabled={busy || !confirmed || (needNote && !note.trim()) || (needReason && !reason.trim())} onClick={() => void act('out')} className={cx(big, 'bg-[#E5484D] text-white hover:bg-[#D93D42]')}>
                {busy ? <Icon name="spinner" size={17} className="animate-spin-slow" /> : null}
                Clock Out
              </button>
            </div>
          </>
        ) : null}

        {showing === 'done' ? (
          <>
            <div className="flex items-center gap-4">
              <Ring size={128} fraction={1} tone="blue">
                <span className="text-primary">
                  <Icon name="check-circle" size={18} />
                </span>
                <b className="text-[22px] text-ink tabular-nums">{hoursMinutes(worked)}</b>
                <span className="text-[11px] text-ink-3">Worked today</span>
              </Ring>
              <div className="flex min-w-0 flex-col gap-1 text-[12px] text-ink-3">
                <span>{shiftLine(a, today)}</span>
                {required ? (
                  worked >= required * 60 ? (
                    <span className="font-semibold text-success">{Math.round((worked - required * 60) / 60)}m over the required {hoursMinutes(required * 60).replace(' 00m', '')}</span>
                  ) : (
                    <span className="font-semibold text-warning">{hoursMinutes(required * 60 - worked)} short of the required {hoursMinutes(required * 60).replace(' 00m', '')}</span>
                  )
                ) : null}
              </div>
            </div>
            <div className="flex gap-1.5">
              <Tile label="Clocked in" value={wall(today?.check_in)} sub={today?.work_location} />
              <Tile label="Clocked out" value={wall(today?.check_out)} sub={today?.work_location} />
              <Tile label="Overtime" value={hoursMinutes(overtime)} sub="" />
            </div>
            <div className="flex items-center gap-2 rounded-[12px] bg-success-bg px-3 py-[9px] text-[12.5px] text-success">
              <Icon name="check-circle" size={15} />
              Clocked out · have a good evening.
            </div>
            {resumeAt.length ? (
              <button type="button" onClick={() => setStep('again')} className="text-left text-[12.5px] font-semibold text-primary hover:underline">
                Clock in again…
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="flex items-center justify-between border-t border-line bg-well px-4 py-2.5">
        <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => (closeOverlay(), navigate('/hr'))}>
          Open HR
        </button>
        <span className="text-[11.5px] text-ink-3">{[companyDateLabel(a?.date), tz].filter(Boolean).join(' · ')}</span>
      </div>
    </Popover>
  );
}

function Location({ required, reason, setReason, skips }: { required: boolean; reason: string; setReason: (v: string) => void; skips: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-well px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
          <Icon name="map-pin" size={16} />
        </span>
        <span className="flex min-w-0 flex-col">
          <b className="text-[12.5px] text-ink">Your location</b>
          <span className="text-[11.5px] text-ink-3">{required ? 'Your organisation asks where you clock in. This computer cannot share a location, so say why.' : 'Your organisation records where you clock in. This computer does not share one.'}</span>
        </span>
      </div>
      {required ? (
        <>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Why no location — e.g. “on the office desktop”" aria-label="Why no location" className="h-9 rounded-[10px] border border-line bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-primary" />
          {skips ? <span className="text-[11px] text-ink-3">You gave a reason {skips} {skips === 1 ? 'time' : 'times'} in the last 30 days.</span> : null}
        </>
      ) : null}
    </div>
  );
}

/** The time now on the company's clock (attendance runs on it). */
function companyClock(now: number, tz: string): string {
  try {
    return new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, ...(tz ? { timeZone: tz } : {}) });
  } catch {
    return new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
}
