import { useState } from 'react';
import { ANSWER_LABEL, type MeetingAnswer } from '@shared/meeting-invitations';
import { errorMessage } from '../../core/bridge';
import { currentZone, dateLabel, parseTs, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { answerInvitation, useInvitationAnswer, type WaitingInvitation } from '../calendar/conflicts';

/**
 * Home › Waiting for me: the invitations still waiting for an answer (worksuite-desktop#97), each saying who asked,
 * when — on this person's clock, and the zone it was booked in when that is another — and where or the link, with
 * Going, Maybe, Not going and View right there. An answered one leaves the card (Home asks for the list again, and
 * so does every other view that shows it); the meeting itself keeps the answer.
 */

/** "Mon 5 Oct · 10:00–11:00 (Asia/Dubai)", the zone it was booked in added when it is not the reader's. */
export function invitationWhen(i: Pick<WaitingInvitation, 'start_at' | 'end_at' | 'timezone' | 'all_day'>, zone = currentZone()): string {
  const day = dateLabel(i.start_at);
  const time = i.all_day ? 'all day' : `${timeLabel(i.start_at)}–${timeLabel(i.end_at)} (${zone})`;
  const booked = i.timezone && i.timezone !== zone && !i.all_day ? ` · booked in ${i.timezone}` : '';
  return `${day} · ${time}${booked}`;
}

/** Where View goes: the meeting for somebody with Meetings, otherwise its day in the Calendar; an event, itself. */
export function invitationLink(i: Pick<WaitingInvitation, 'source' | 'id' | 'start_at' | 'link'>, canMeetings: boolean): string {
  if (i.source !== 'meeting' || canMeetings) return i.link;
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(parseTs(i.start_at));
  return `/calendar?date=${p}`;
}

const DONE: Record<MeetingAnswer, string> = { accepted: 'You’re going to', tentative: 'You might go to', declined: 'You’re not going to' };

export function WaitingInvitations({ items, canMeetings, onOpen, limit = 4 }: { items: WaitingInvitation[]; canMeetings: boolean; onOpen: (link: string) => void; limit?: number }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0 [&>li]:border-t [&>li]:border-line [&>li]:py-3" aria-label="Invitations waiting for your answer">
      {items.slice(0, limit).map((i) => (
        <InvitationItem key={`${i.source}:${i.id}`} i={i} canMeetings={canMeetings} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function InvitationItem({ i, canMeetings, onOpen }: { i: WaitingInvitation; canMeetings: boolean; onOpen: (link: string) => void }) {
  const [busy, setBusy] = useState(false);
  const send = async (rsvp: string) => {
    setBusy(true);
    try {
      await answerInvitation(i.source, i.id, rsvp);
      toast('success', `${DONE[rsvp as MeetingAnswer] ?? 'Answered'} “${i.title}”.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // Accepting one that overlaps something asks first, with Propose new time (#99); every answer refreshes every view.
  const answer = useInvitationAnswer(i.source, i.id, send);
  const where = i.where ? i.where : i.online_url;
  return (
    <li className="flex flex-col gap-2.5" data-invitation={`${i.source}:${i.id}`}>
      <div className="flex gap-3">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-selection text-primary">
          <Icon name="calendar-check" size={16} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="truncate text-[14px] font-semibold text-ink" title={i.title}>
            {i.title}
          </div>
          <div className="truncate text-[12px] text-ink-2">{i.organizer ? `Invitation from ${i.organizer}` : 'Invitation'}</div>
          <div className="text-[12px] text-ink-3">{invitationWhen(i)}</div>
          {where ? (
            <div className="truncate text-[12px] text-ink-3" title={where}>
              {i.online_url && where.includes(i.online_url) ? 'Online · ' : ''}
              {where.replace(/^Online — /, '')}
            </div>
          ) : null}
          {i.conflicts.length ? <span className="mt-1 self-start">{answer.flag}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-11">
        {(['accepted', 'tentative', 'declined'] as MeetingAnswer[]).map((r) => (
          <Button key={r} size="sm" className="h-8 px-3" variant={r === 'accepted' ? 'primary' : undefined} disabled={busy} onClick={() => void answer.answer(r)}>
            {ANSWER_LABEL[r]}
          </Button>
        ))}
        <button type="button" onClick={() => onOpen(invitationLink(i, canMeetings))} className="h-8 px-1.5 text-[12px] font-semibold text-primary hover:underline">
          {i.source === 'meeting' ? 'View meeting' : 'View event'}
        </button>
      </div>
      {answer.dialogs}
    </li>
  );
}
