import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supportHint } from '@shared/support';
import { app } from '../../core/app-state';
import { on } from '../../core/bridge';
import { useStore } from '../../core/store';
import { K } from './api';

/**
 * The desk kept current by the realtime gateway instead of polling (WS-SUPPORT-SRS-001 FR-NTF-04, §12.2).
 *
 * The main process fans the socket out to every window as `realtime:event`. Of those:
 *
 *  - `support.changed` — something on a desk changed, with no ticket id: the lists, the view counts and the badges
 *    are asked again. A burst of them (a bulk action, a busy desk) is asked once, not once each.
 *  - `support.ticket` — a ticket I am on changed: that ticket is asked again, and the lists whose order it may move.
 *  - `support.presence` — who else is on a ticket now: that is the answer, as given.
 *
 * Hints are hints. Nothing is patched from the socket except presence (which is itself the answer); everything else
 * is fetched again through the API, so permissions are checked again on the way. A reconnect makes every query
 * fetch again already (core/query.ts). Without the gateway, the screens poll (`FALLBACK_POLL_MS`).
 */

/** How long a burst of desk hints is gathered before the desk is asked once. */
export const DESK_DEBOUNCE_MS = 400;

/** How often a view or a ticket is asked again while the gateway is not connected. */
export const FALLBACK_POLL_MS = 30_000;

/** Live while the realtime socket is connected: the header says "live", and nothing polls. */
export function useRealtimeLive(): boolean {
  return useStore(app, (s) => s.status?.realtime === 'connected');
}

/** The poll interval for a support query: none while live, the fallback otherwise. */
export function usePollInterval(): number | false {
  return useRealtimeLive() ? false : FALLBACK_POLL_MS;
}

function listen(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const desk = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void qc.invalidateQueries({ queryKey: K.lists });
      void qc.invalidateQueries({ queryKey: ['support', 'views'] });
      void qc.invalidateQueries({ queryKey: K.badges });
    }, DESK_DEBOUNCE_MS);
  };
  const off = on('realtime:event', (e) => {
    const h = supportHint(e);
    if (!h) return;
    if (h.type === 'support.changed') desk();
    else if (h.type === 'support.ticket') {
      void qc.invalidateQueries({ queryKey: K.ticket(h.ticket_id) });
      desk();
    } else qc.setQueryData(K.presence(h.ticket_id), h.present);
  });
  return () => {
    off();
    if (timer) clearTimeout(timer);
  };
}

/** One listener for however many support tabs are open, per query client. */
const listening = new Map<QueryClient, { count: number; off: () => void }>();

/** Keeps the support screens current while any of them is mounted. */
export function useSupportLive(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const held = listening.get(qc);
    if (held) held.count += 1;
    else listening.set(qc, { count: 1, off: listen(qc) });
    return () => {
      const h = listening.get(qc);
      if (!h) return;
      h.count -= 1;
      if (h.count <= 0) {
        h.off();
        listening.delete(qc);
      }
    };
  }, [qc]);
}
