import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { on } from './bridge';

/**
 * Server state. REST is authoritative (FR-RT-03): realtime events and a
 * reconnect only tell queries to refetch; nothing is patched from the socket.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 422)) return false;
        return count < 2;
      },
    },
  },
});

/** Website chat (the visitor widget): refresh its inbox and the conversation named. */
const WEBSITE_EVENTS = new Set(['chat.widget.message', 'chat.widget.activity', 'chat.incoming', 'chat.taken', 'chat.assigned', 'chat.at_risk']);

/** Events that change nothing a list or thread shows; refetching every message on each keystroke was waste. */
const QUIET_CHAT_EVENTS = /^chat\.(typing\.|presence$|call\.)/;

export function wireQueryInvalidation(): void {
  on('realtime:resync', () => void queryClient.invalidateQueries());
  on('organization:changed', () => void queryClient.invalidateQueries());
  on<{ type: string; room_id?: number; conversation_id?: number }>('realtime:event', (e) => {
    if (WEBSITE_EVENTS.has(e.type)) {
      void queryClient.invalidateQueries({ queryKey: ['website', 'inbox'] });
      if (e.conversation_id !== undefined) void queryClient.invalidateQueries({ queryKey: ['website', 'conversation', String(e.conversation_id)] });
    } else if (e.type === 'chat.presence') {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'presence'] });
    } else if (e.type.startsWith('chat.') && !QUIET_CHAT_EVENTS.test(e.type)) {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'rooms'] });
      if (e.room_id !== undefined) void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', String(e.room_id)] });
    }
    if (e.type === 'notification') void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    if (e.type === 'activity.new') void queryClient.invalidateQueries({ queryKey: ['home'] });
    if (e.type === 'hr.attendance.changed') void queryClient.invalidateQueries({ queryKey: ['hr'] });
    // Hotel PMS's live nudges (`pms.room`, `pms.hk_task`, `pms.request`): the rack and the desk's lists ask again (PMS-ARC-030).
    if (e.type.startsWith('pms.')) void queryClient.invalidateQueries({ queryKey: ['pms', 'live'] });
  });
  on('notifications:changed', () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }));
  on('offline:changed', () => void queryClient.invalidateQueries({ queryKey: ['offline'] }));
}
