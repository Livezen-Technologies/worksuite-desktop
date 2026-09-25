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

export function wireQueryInvalidation(): void {
  on('realtime:resync', () => void queryClient.invalidateQueries());
  on('organization:changed', () => void queryClient.invalidateQueries());
  on<{ type: string; room_id?: number }>('realtime:event', (e) => {
    if (e.type.startsWith('chat.')) {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'rooms'] });
      if (e.room_id !== undefined) void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', String(e.room_id)] });
    }
    if (e.type === 'notification') void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    if (e.type === 'activity.new') void queryClient.invalidateQueries({ queryKey: ['home'] });
    if (e.type === 'hr.attendance.changed') void queryClient.invalidateQueries({ queryKey: ['hr'] });
  });
  on('notifications:changed', () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }));
  on('offline:changed', () => void queryClient.invalidateQueries({ queryKey: ['offline'] }));
}
