import { useEffect } from 'react';
import { call } from '../../../core/bridge';

/** The conversation this window last said it shows, so a tab going behind clears only its own. */
let reported: number | null = null;

/**
 * Tell the main process which website conversation is in front (worksuite-desktop#230): while it is, and the window
 * is in front with someone at the keyboard, a visitor's new message there raises no card, chime or notification.
 */
export function useViewing(conversationId: number, showing: boolean): void {
  useEffect(() => {
    if (!showing || !conversationId) return;
    reported = conversationId;
    void call('ring:viewing', { id: conversationId }).catch(() => undefined);
    return () => {
      if (reported !== conversationId) return;
      reported = null;
      void call('ring:viewing', { id: null }).catch(() => undefined);
    };
  }, [conversationId, showing]);
}
