/**
 * Remote support, the parts worth deciding once (WS-MEET-ENH-01 RC10, RC11,
 * RC17).
 *
 * The server owns this feature — it starts the session, mints the code,
 * redeems it, drafts with AI and ends the session. What is here is only what a
 * screen has to work out for itself: how a code reads, how long it has left,
 * what the session's state means in a sentence, and which of the agent's
 * actions are available at all.
 *
 * **A code is a credential.** It opens one session for one person, once, for a
 * few minutes. Everything here treats it that way: it is never inferred,
 * never guessed at, and an expiry that has passed is expired even if the
 * server has not said so yet, because the clock on this computer running ahead
 * is a better reason to ask for a new code than to offer a dead one.
 */

export type SupportOutcome = 'resolved' | 'unresolved' | 'follow_up';

export const SUPPORT_OUTCOMES: Array<{ id: SupportOutcome; label: string; hint: string }> = [
  { id: 'resolved', label: 'Resolved', hint: 'The problem is fixed.' },
  { id: 'unresolved', label: 'Not resolved', hint: 'It could not be fixed in this session.' },
  { id: 'follow_up', label: 'Needs a follow-up', hint: 'Something is still outstanding.' },
];

/** `847291663` → `847 291 663`. Nine digits or it is not a support code. */
export function codeDisplay(code: string): string {
  const digits = code.replace(/\D/g, '');

  return digits.length === 9 ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : digits;
}

/** What somebody typed, as a code — or null when it cannot be one. */
export function readCode(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  return digits.length === 9 ? digits : null;
}

/**
 * The link the invitation carries. The web app serves `/support/join`, so a
 * desktop invitation points at the same address: whoever receives it may not
 * have WorkSuite installed, and a link only this app could open would be no
 * invitation at all.
 */
export function joinLink(code: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/support/join?code=${encodeURIComponent(code)}`;
}

/** The invitation, as a sentence somebody can paste anywhere. */
export function inviteText(code: string, origin: string, agent: string | null): string {
  const who = agent ? `${agent} from support` : 'Support';

  return [
    `${who} would like to look at your screen.`,
    '',
    `Open ${joinLink(code, origin)}`,
    `or go to WorkSuite Meet and enter the code ${codeDisplay(code)}.`,
    '',
    'The code works once and expires in a few minutes. Nobody can see your screen until you share it, and nobody can use your mouse or keyboard until you allow it.',
  ].join('\n');
}

/**
 * Seconds left of a code, never negative, and rounded **down**.
 *
 * Down because the two ways of being wrong are not equal: rounding up shows
 * "10:01" for a ten-minute code, which is a claim of time the code does not
 * have, and in the last second it offers a code the server may already have
 * stopped accepting. Rounding down loses at most a second of a code's life
 * and never over-promises.
 */
export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}

/** "4:58", or "expired". */
export function expiryLabel(expiresAt: number, now: number): string {
  const left = secondsLeft(expiresAt, now);

  if (left <= 0) return 'expired';

  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export interface ControlFacts {
  status: string;
  caps_label: string;
  approved_at: string | null;
  approved_by: string | null;
  mfa_passed: boolean;
  duration: string | null;
}

/**
 * What the Session tab says about control, in one line.
 *
 * `null` is not "no control" the way a reader might fear — a support session
 * begins before anybody asks for control, and most of them never need it. It
 * says so plainly rather than leaving an empty row to be read as a failure.
 */
export function controlLine(control: ControlFacts | null): { state: 'none' | 'live' | 'paused'; text: string } {
  if (!control) return { state: 'none', text: 'Nobody is controlling this computer. The agent can ask; you answer on your own computer, each time.' };

  const paused = control.status === 'CONTROL_PAUSED';
  const who = control.approved_by ? ` Allowed by ${control.approved_by}.` : '';
  const mfa = control.mfa_passed ? ' Confirmed with a second factor.' : '';
  const asked = control.duration ? ` Asked for ${control.duration}.` : '';

  return {
    state: paused ? 'paused' : 'live',
    text: `${paused ? 'Control is paused.' : 'Control is active.'} ${control.caps_label}.${who}${mfa}${asked}`.replace(/\s+/g, ' ').trim(),
  };
}

/** What a transferred file's state reads as in the Session tab's list. */
export function fileState(status: string): string {
  switch (status) {
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'blocked':
      return 'Blocked by policy';
    case 'infected':
      return 'Refused: the scan found something';
    case 'offered':
      return 'Waiting for an answer';
    default:
      return status;
  }
}

/**
 * A support session reduces the meeting to what the work needs (RC-SUP-03, in
 * the server's own words: "the screen, Chat, Files, Session and AI assist").
 *
 * Q&A, polls, the whiteboard, the meeting's notes and the room's settings
 * belong to a meeting with an audience; a support call is two people and a
 * problem. AI assist is not in this list because it is inside the Session tab,
 * where the notes it reads are.
 */
export const SUPPORT_TABS: readonly string[] = ['Chat', 'Files', 'Session'];

/** Which of a meeting's tabs a support session keeps, in the order given. */
export const supportTabs = <T extends { id: string }>(tabs: T[]): T[] =>
  SUPPORT_TABS.map((id) => tabs.find((t) => t.id === id)).filter((t): t is T => !!t);
