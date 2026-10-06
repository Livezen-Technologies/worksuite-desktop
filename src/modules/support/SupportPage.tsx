import { parseSupportRoute } from '@shared/support';
import type { ModuleProps } from '../registry';
import { Inbox } from './Inbox';
import { TicketTab } from './TicketTab';

/**
 * WorkSuite Support on the desktop (WS-SUPPORT-SRS-001 FR-DSK-01): the desk inside the app, not a hand-off to the
 * browser. `/support` is the inbox (D-01); `/support/ticket/{id}` — a deep link, a notification, a row opened from
 * the inbox — is that ticket in a tab of its own (D-02), one tab per ticket (core/tabs.ts).
 */
export default function SupportPage({ route, active }: ModuleProps) {
  const r = parseSupportRoute(route);
  return r.kind === 'ticket' ? <TicketTab key={r.key} ticketKey={r.key} active={active} /> : <Inbox route={route} active={active} />;
}
