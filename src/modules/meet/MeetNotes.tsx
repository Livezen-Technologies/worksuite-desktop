import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { Button, Empty, Spinner } from '../../components/ui';
import type { ChatMessage } from '../chat/types';
import { MinutesEditor } from '../meetings/minutes/MinutesEditor';
import { meet } from './session';

/**
 * Notes & Minutes in the meeting (worksuite-desktop#80): the same minutes as the meeting's details, written while
 * the call is on. A meeting scheduled in Meetings already has its record; a meeting started in Meet gets one the
 * first time its host or a co-host opens Notes, so the minutes stay in the meeting's details after the call.
 */
export function MeetNotes() {
  const uuid = meet.uuid;
  const q = useQuery({
    queryKey: ['meet', uuid, 'record'],
    queryFn: () => apiPost<{ id: number }>('/api/meetings/for-meet', { uuid }),
    retry: false,
    staleTime: Infinity,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const notYet = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Empty
        icon="file-text"
        title={notYet ? 'No notes yet' : 'The notes could not be opened'}
        hint={notYet ? 'The host or a co-host starts the notes. They appear here once they have.' : errorMessage(q.error)}
        action={<Button onClick={() => void q.refetch()}>Try again</Button>}
      />
    );
  }
  // The meeting's chat is part of what the minutes are drafted from.
  const material = async () => {
    const roomId = meet.info?.room_id;
    if (!roomId) return '';
    const r = await apiGet<{ messages: ChatMessage[] }>('/api/chat/messages', { room_id: roomId });
    const chat = r.messages.filter((x) => !x.deleted && x.message?.trim() && x.type !== 'system').slice(-80).map((x) => `${x.sender_name}: ${x.message!.replace(/\s+/g, ' ').trim()}`).join('\n');
    return chat ? `The meeting's chat:\n${chat}` : '';
  };
  return <MinutesEditor meetingId={q.data.id} compact material={material} />;
}
