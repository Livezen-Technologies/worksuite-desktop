import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import type { SyncStatus } from './types';

/** How often the app asks for a step while mailboxes are due. */
const EVERY_MS = 30_000;
/** Sooner while a first sync still has folders to go. */
const MORE_MS = 12_000;

interface Step { ran: boolean; more: boolean; reason?: string; mailbox?: number }

/**
 * Keeps mail moving while the server's sync service is not running (`SyncBackground` on the server).
 *
 * Without the service a mailbox moved only when somebody pressed Sync: "Headers 8 of 27 folders" for a day, and
 * new-mail notifications only after a click. While sync status says `background.step`, the app asks for a step
 * every half a minute (sooner while there is more to do); each step is one due mailbox's pass, under the same lease
 * the service takes. Once the service runs, status says so and nothing is asked. Renders nothing; mounted in the
 * main window beside the mail reminders, so it runs on every screen, not only in Mail.
 */
export function MailBackgroundSync() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['mail', 'sync'],
    queryFn: () => apiGet<SyncStatus>('/api/mail/sync/status'),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const wanted = !!status.data?.background?.step && !offline;

  useEffect(() => {
    if (!wanted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      let next = EVERY_MS;
      try {
        const d = await apiPost<Step>('/api/mail/sync/step', {});
        if (d?.ran) {
          void qc.invalidateQueries({ queryKey: ['mail', 'sync'] });
          void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
          void qc.invalidateQueries({ queryKey: ['mail', 'views'] });
          void qc.invalidateQueries({ queryKey: ['mail', 'all'] });
        }
        // The service came back, sync was switched off, or nothing is due: status says whether to go on.
        if (d && !d.ran && !d.more) void qc.invalidateQueries({ queryKey: ['mail', 'sync'] });
        if (d?.more) next = MORE_MS;
      } catch {
        next = EVERY_MS * 2;
      }
      if (!stopped) timer = setTimeout(() => void tick(), next);
    };

    timer = setTimeout(() => void tick(), 2_000);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [wanted, qc]);

  return null;
}
