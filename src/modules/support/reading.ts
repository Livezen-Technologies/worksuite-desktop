import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { TicketShow } from '@shared/support';
import { call } from '../../core/bridge';
import { K, markRead } from './api';

/**
 * Read markers (FR-COM-10). Tickets are fetched with `peek`, so passing over one — j/k down the list, a background
 * tab refreshing — reads nothing. A ticket shown for a moment is read: the marker moves to its newest message, its
 * row loses its bold, and the counts and the badge are asked again.
 *
 * The marker the ticket was opened with is kept on screen until it is fetched again, so "New since you last viewed"
 * stays where it was while it is being read; a message arriving later is fetched with the moved marker, and the line
 * then sits above it.
 */
export const READ_AFTER_MS = 1500;

export function useMarkRead(id: number | null, show: (TicketShow & { offline?: boolean }) | undefined, active: boolean): void {
  const qc = useQueryClient();
  const last = show?.messages.at(-1)?.id ?? 0;
  const unread = show?.ticket.unread ?? 0;
  // An as-built server keeps no markers; a saved copy is not the server's to mark.
  const markable = !!show && !show.legacy && !show.offline;
  useEffect(() => {
    if (!id || !active || !unread || !markable) return;
    const timer = setTimeout(() => {
      void markRead(id, last || undefined).then(
        () => {
          qc.setQueryData<TicketShow>(K.ticket(id), (d) => (d ? { ...d, ticket: { ...d.ticket, unread: 0 } } : d));
          void qc.invalidateQueries({ queryKey: K.lists });
          void qc.invalidateQueries({ queryKey: ['support', 'views'] });
          void qc.invalidateQueries({ queryKey: K.badges });
          // And the rail's, the Dock's and the tray's count, which the main process keeps (support-notices.ts).
          void call('notifications:refresh').catch(() => undefined);
        },
        () => undefined,
      );
    }, READ_AFTER_MS);
    return () => clearTimeout(timer);
  }, [id, active, unread, last, markable, qc]);
}
