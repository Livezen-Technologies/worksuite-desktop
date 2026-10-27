import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '../../core/api';
import { listStamp } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import { describeCall, type CallRow, type Kind } from '../calls/log';
import { answerCall, startCall } from '../calls/start';
import { roomPerson, type Room } from './types';

/**
 * Chat › Calls (ChatDrawerCalls): every call this person made, took or missed,
 * newest first, with Call back / Call again — in the chat drawer and in Chat
 * itself (worksuite-desktop#113). Calls only: a Meet meeting is Meet's.
 */
export type CallFilter = 'All' | 'Missed' | 'Incoming' | 'Outgoing';
export const CALL_FILTERS: CallFilter[] = ['All', 'Missed', 'Incoming', 'Outgoing'];

const GLYPH: Record<Kind, [string, string]> = {
  missed: ['↙', 'text-danger'],
  in: ['↙', 'text-success'],
  out: ['↗', 'text-primary'],
  live: ['●', 'text-success'],
};

export function useCallLog(active: boolean) {
  return useQuery({
    queryKey: ['chat', 'calls', 'history'],
    queryFn: ({ signal }) => apiGet<CallRow[]>('/api/chat/calls/history', undefined, signal),
    refetchInterval: active ? 30_000 : 120_000,
    retry: false,
  });
}

/** Who a call was with, as the list names it. */
export function callName(c: CallRow, rooms: Room[]): string {
  return c.room_name ?? rooms.find((r) => r.id === c.room_id)?.name ?? c.caller_name;
}

export function filterCalls(rows: CallRow[], filter: CallFilter, needle: string, rooms: Room[]): CallRow[] {
  return rows.filter((c) => {
    const k = describeCall(c).kind;
    if (filter === 'Missed' && k !== 'missed') return false;
    if (filter === 'Incoming' && c.direction !== 'incoming') return false;
    if (filter === 'Outgoing' && c.direction !== 'outgoing') return false;
    return !needle || callName(c, rooms).toLowerCase().includes(needle);
  });
}

export function CallLogList({ log, rooms, filter, needle }: { log: ReturnType<typeof useCallLog>; rooms: Room[]; filter: CallFilter; needle: string }) {
  const shown = filterCalls(log.data ?? [], filter, needle, rooms);
  return (
    <>
      {log.isLoading ? <Spinner /> : log.error ? (
        log.error instanceof ApiError && log.error.status === 404 ? <Empty icon="phone" title="Call history needs a newer WorkSuite" /> : <div className="p-3"><ErrorNote error={log.error} onRetry={() => void log.refetch()} /></div>
      ) : !shown.length ? <Empty icon="phone" title="No calls" /> : null}
      {shown.map((c) => {
        const d = describeCall(c);
        const room = rooms.find((r) => r.id === c.room_id);
        const group = !!room && room.type !== 'direct';
        const name = callName(c, rooms);
        return (
          <div key={c.uuid} className="flex items-center gap-3 rounded-[12px] pr-2 pl-2.5">
            <UserAvatar userId={roomPerson(room)} name={room?.avatar_name || name} size={42} className={group ? '!rounded-[13px]' : ''} />
            <span className="flex min-w-0 flex-1 items-center gap-2 border-b border-line py-[11px]">
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <b className={cx('truncate text-[14px]', d.kind === 'missed' ? 'text-danger' : 'text-ink')}>{name}</b>
                <span className="flex items-center gap-[5px] text-[12px] text-ink-3">
                  <span className={cx('font-bold', GLYPH[d.kind][1])} aria-hidden>{GLYPH[d.kind][0]}</span>
                  <span className="truncate">{d.line}</span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11.5px] text-ink-3">{d.kind === 'live' ? 'now' : listStamp(c.started_at)}</span>
                {d.kind !== 'live' ? <span className="text-[11.5px] font-semibold whitespace-nowrap text-primary">{d.action}</span> : null}
              </span>
              <button
                type="button"
                aria-label={`${d.action} ${name}`}
                title={d.action}
                onClick={() => (d.kind === 'live' ? void answerCall(c.uuid, String(c.room_id), false, name) : void startCall(c.room_id, c.mode, name))}
                className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', d.kind === 'live' ? 'bg-green text-white' : 'bg-selection text-primary hover:brightness-95')}
              >
                <Icon name={c.mode === 'video' ? 'video' : 'phone'} size={16} />
              </button>
            </span>
          </div>
        );
      })}
    </>
  );
}
