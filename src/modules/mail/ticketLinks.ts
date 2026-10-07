import type { QueryClient } from '@tanstack/react-query';
import type { ConvertedTicket, EmailToConvert } from '../support/ConvertEmailSheet';
import { messageKey } from './localFirst';
import type { MessageDetail, MessageRef, MessageRow } from './types';

/**
 * Mail's side of email → ticket (worksuite-desktop#298): the message as Support's Convert to ticket sheet takes it,
 * and the message marked with its ticket once converted. The sheet itself is Support's (ConvertEmailSheet).
 */

/** A message for the sheet: Mail's uid in its folder and mailbox, and the sender's company to suggest the organization. */
export function emailToConvert(ref: MessageRef, m: Pick<MessageRow, 'subject' | 'from_name' | 'from_email'>, company?: string | null): EmailToConvert {
  return { uid: Number(ref.uid), folder: ref.folder, mailbox: ref.mailbox ?? null, subject: m.subject, from_name: m.from_name || null, from_email: m.from_email, company: company ?? null };
}

/** The open message shows its ticket at once; the list reads `support_ticket` again from the server (the sheet asks). */
export function markTicket(qc: QueryClient, ref: MessageRef, ticket: ConvertedTicket): void {
  qc.setQueryData<{ data?: MessageDetail }>(messageKey(ref), (old) => (old?.data ? { ...old, data: { ...old.data, support_ticket: ticket } } : old));
}
