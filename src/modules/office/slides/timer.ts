/**
 * The presenter view's timer and clock, and the slideshow's control bar that fades (worksuite-desktop#321). Pure:
 * every function takes the time it is asked at, so it is tested without waiting.
 */

/** The control bar fades this long after the mouse last moved. */
export const CONTROLS_HIDE_MS = 2000;

export function controlsShown(lastMove: number | null, now: number, hovering = false): boolean {
  if (hovering) return true;
  return lastMove !== null && now - lastMove < CONTROLS_HIDE_MS;
}

/** A stopwatch that can pause: started when the show starts, paused and reset from the presenter view. */
export interface TimerState {
  /** When it was last started or resumed; null while paused. */
  since: number | null;
  /** Time counted before `since`. */
  banked: number;
}

export const timerStart = (now: number): TimerState => ({ since: now, banked: 0 });

export function timerElapsed(t: TimerState, now: number): number {
  return t.banked + (t.since === null ? 0 : Math.max(0, now - t.since));
}

export function timerPause(t: TimerState, now: number): TimerState {
  return t.since === null ? t : { since: null, banked: timerElapsed(t, now) };
}

export function timerResume(t: TimerState, now: number): TimerState {
  return t.since === null ? { since: now, banked: t.banked } : t;
}

export const timerReset = (now: number, running: boolean): TimerState => ({ since: running ? now : null, banked: 0 });

/** "04:07", or "1:02:09" past an hour. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** The wall clock: "14:05", or "2:05 PM" where the system uses a 12-hour clock. */
export function formatClock(d: Date, hour12 = false): string {
  const m = String(d.getMinutes()).padStart(2, '0');
  if (!hour12) return `${String(d.getHours()).padStart(2, '0')}:${m}`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** Whether this computer shows a 12-hour clock. */
export function uses12Hour(): boolean {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;
  } catch {
    return false;
  }
}
