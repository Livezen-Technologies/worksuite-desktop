/**
 * Meeting invitations (worksuite-desktop#97), read the same way by the
 * notification centre, the OS notification and the views that list them.
 *
 * The server's in-app notice for an invitation or an update carries its own
 * answers (`{label, rsvp, meeting_id}`), a reminder for a meeting held online
 * carries `Join meeting` (`{label, url}`), and both carry `View meeting`
 * (`{label, link}`). Only what is there is offered: a notice from an older
 * server, or one whose actions do not name this meeting, offers nothing.
 */

export type MeetingAnswer = 'accepted' | 'tentative' | 'declined';

export const ANSWER_LABEL: Record<MeetingAnswer, string> = { accepted: 'Going', tentative: 'Maybe', declined: 'Not going' };

/** The notices about the reader's own invitation. */
export const INVITATION_EVENTS = ['meeting.invitation', 'meeting.update', 'meeting.cancellation', 'meeting.reminder'] as const;

export interface MeetingNoticeActions {
  meetingId: number;
  answers: Array<{ label: string; rsvp: MeetingAnswer }>;
  /** Where View meeting goes: the meeting, or its day in the Calendar for somebody without Meetings. */
  view: string | null;
  /** Join meeting, for a reminder of one held online. */
  join: string | null;
}

function list(actions: unknown): unknown[] | null {
  let parsed = actions;
  if (typeof actions === 'string') {
    try {
      parsed = JSON.parse(actions);
    } catch {
      return null;
    }
  }
  return Array.isArray(parsed) ? parsed : null;
}

const isAnswer = (v: unknown): v is MeetingAnswer => v === 'accepted' || v === 'tentative' || v === 'declined';

/** What a meeting notice offers, or null when it is not one (or offers nothing). */
export function meetingNoticeActions(event: string | null | undefined, actions: unknown): MeetingNoticeActions | null {
  if (!event || !(INVITATION_EVENTS as readonly string[]).includes(event)) return null;
  const items = list(actions);
  if (!items) return null;
  let meetingId = 0;
  const answers: MeetingNoticeActions['answers'] = [];
  let view: string | null = null;
  let join: string | null = null;
  for (const a of items) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    const id = Number(x.meeting_id);
    if (!Number.isSafeInteger(id) || id <= 0 || (meetingId && id !== meetingId)) continue;
    meetingId = id;
    if (isAnswer(x.rsvp) && event !== 'meeting.reminder') answers.push({ label: ANSWER_LABEL[x.rsvp], rsvp: x.rsvp });
    else if (typeof x.url === 'string' && /^https?:\/\//i.test(x.url)) join = x.url;
    else if (typeof x.link === 'string' && x.link.startsWith('/')) view = x.link;
  }
  return meetingId && (answers.length || view || join) ? { meetingId, answers, view, join } : null;
}

/** Still waiting for this person's answer — neither answered nor answered maybe. */
export function awaitingAnswer(rsvp: string | null | undefined): boolean {
  return rsvp === 'no_response' || rsvp === 'needs_action';
}

/**
 * A realtime event that changes an invitation somebody is shown: a meeting
 * notice (invited, moved, cancelled, answered) or the person's own answer from
 * another screen or the email (`meeting.rsvp`).
 */
export function touchesInvitations(e: { type: string; event?: unknown }): boolean {
  if (e.type === 'meeting.rsvp') return true;
  return e.type === 'notification' && typeof e.event === 'string' && /^meeting\./.test(e.event);
}
