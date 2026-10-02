import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { meetingNoticeActions } from '@shared/meeting-invitations';
import { call, errorMessage } from '../../core/bridge';
import { openWebLink } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Button } from '../../components/ui';
import { answerInvitation, invitationsChanged } from '../calendar/conflicts';
import { act, K, type Notice } from './api';

/**
 * A meeting invitation answered from the notification itself (worksuite-desktop#97): Going, Maybe and Not going,
 * View meeting — and Join meeting on a reminder for one held online. Answering marks it read, and every view that
 * shows the invitation or counts them is asked again.
 */
export function MeetingInviteActions({ notice }: { notice: Notice }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const a = meetingNoticeActions(notice.event, notice.actions);
  if (!a) return null;
  const answer = async (rsvp: string, label: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await answerInvitation('meeting', a.meetingId, rsvp);
      if (!notice.read) await act(notice.id, 'read');
      invitationsChanged(qc);
      void qc.invalidateQueries({ queryKey: K.all });
      toast('success', `Answered “${label}”.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="pointer-events-auto flex flex-wrap gap-1" data-meeting-actions={a.meetingId}>
      {a.join ? (
        <Button size="sm" variant="primary" onClick={() => void call('app:openExternal', { url: a.join! }).catch((e) => toast('error', errorMessage(e)))}>
          Join meeting
        </Button>
      ) : null}
      {a.answers.map((x) => (
        <Button key={x.rsvp} size="sm" variant={x.rsvp === 'accepted' ? 'primary' : undefined} disabled={busy} onClick={() => void answer(x.rsvp, x.label)}>
          {x.label}
        </Button>
      ))}
      {a.view ? (
        <Button size="sm" onClick={() => openWebLink(a.view)}>
          View meeting
        </Button>
      ) : null}
    </span>
  );
}
