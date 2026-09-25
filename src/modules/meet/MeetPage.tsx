import { useEffect, useSyncExternalStore } from 'react';
import type { ModuleProps } from '../registry';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Button, Empty, Spinner } from '../../components/ui';
import { openMeeting } from './api';
import { MeetHome } from './MeetHome';
import { MeetLobby } from './MeetLobby';
import { MeetRoom } from './MeetRoom';
import { meet } from './session';

/**
 * Meet. In a tab: the home (`/meet`); a meeting link (`/meet/<uuid>`, from a
 * notification or a chat card) opens that meeting in its window. In the
 * meeting's own window: the lobby, then the room.
 */
export default function MeetPage({ tabId }: ModuleProps) {
  const { path, go } = useTab();
  const uuid = path[1] ?? null;
  const inWindow = tabId.startsWith('window-meet');

  useEffect(() => {
    if (!inWindow && uuid) {
      void openMeeting(uuid);
      go('/meet');
    }
  }, [inWindow, uuid, go]);

  if (inWindow && uuid) return <MeetingWindow uuid={uuid} />;
  return <MeetHome />;
}

function MeetingWindow({ uuid }: { uuid: string }) {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  useEffect(() => {
    void meet.load(uuid);
  }, [uuid]);
  useTabTitle(meet.info?.title ? `${meet.info.title} · WorkSuite Meet` : 'WorkSuite Meet');

  switch (meet.phase) {
    case 'loading':
      return <Spinner />;
    case 'error':
      return <Empty icon="video" title={meet.error ?? 'This meeting could not be opened'} action={<Button onClick={() => void call('windows:close')}>Close</Button>} />;
    case 'lobby':
    case 'joining':
    case 'waiting':
      return <MeetLobby />;
    case 'in':
      return meet.room ? <MeetRoom /> : <Spinner />;
    default:
      return (
        <Empty
          icon="video"
          title={meet.farewell ?? 'You left the meeting.'}
          action={
            <div className="flex gap-2">
              {meet.phase === 'left' ? <Button onClick={() => void meet.load(uuid).then(() => undefined)}>Rejoin</Button> : null}
              <Button variant="primary" onClick={() => void call('windows:close')}>
                Close
              </Button>
            </div>
          }
        />
      );
  }
}
