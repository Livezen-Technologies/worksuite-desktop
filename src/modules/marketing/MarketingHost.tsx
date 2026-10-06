import { useEffect } from 'react';
import { call } from '../../core/bridge';
import { useMarketingAccess } from './access';

/**
 * Marketing's part of the main window for someone who has Marketing (D01): tells the main process whether to hold the
 * next-contact shortcut — only while the person may work a call queue (marketing.call.make). The reminders and the
 * tray's counts run in the main process on their own (electron/services/marketing.ts).
 */
export default function MarketingHost() {
  const { call: agent } = useMarketingAccess();
  useEffect(() => {
    void call('marketing:configure', { shortcut: agent }).catch(() => undefined);
  }, [agent]);
  return null;
}
