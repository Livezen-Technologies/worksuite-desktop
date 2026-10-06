import { parseSupportRoute } from '@shared/support';
import type { ModuleProps } from '../registry';
import { Inbox } from './Inbox';
import { QuickReply } from './QuickReply';
import { UrgentRing } from './UrgentRing';
import { TicketTab } from './TicketTab';

/**
 * WorkSuite Support on the desktop (WS-SUPPORT-SRS-001 FR-DSK-01): the desk inside the app, not a hand-off to the
 * browser. `/support` is the inbox (D-01); `/support/ticket/{id}` — a deep link, a notification, a row opened from
 * the inbox — is that ticket in a tab of its own (D-02), one tab per ticket (core/tabs.ts). `/support/quick/{id}` is its
 * quick-reply window (D-04), and `/support/ring/{id}` an urgent ticket ringing (D-07), each in a window of its own.
 */
export default function SupportPage({ route, active }: ModuleProps) {
  const r = parseSupportRoute(route);
  if (r.kind === 'quick') return <QuickReply key={r.key} ticketKey={r.key} />;
  if (r.kind === 'ring') return <UrgentRing key={r.key} ticketKey={r.key} />;
  return r.kind === 'ticket' ? <TicketTab key={r.key} ticketKey={r.key} active={active} /> : <Inbox route={route} active={active} />;
}
