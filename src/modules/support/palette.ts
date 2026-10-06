import { useEffect, useRef } from 'react';
import { PRIORITY_LABEL, statusLabel, type Ticket } from '@shared/support';
import { registerCommand, type Command } from '../../core/commands';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { listTickets, openQuickReply } from './api';

/**
 * Support in the command palette (WS-SUPPORT-SRS-001 D-08, FR-SRC-01/04, FR-WSP-06, FR-DSK-05).
 *
 *  - Ticket results: ⌘K's search asks the desk too (`GET tickets?view=all&q=`, where "tkt 128" finds TKT-000128
 *    and the subject, requester, email and phone match), shown with their status and priority; ↵ opens the ticket's
 *    tab, ⌘↵ its own window, ⌘⇧C copies its deep link.
 *  - Actions on the ticket in front: while a ticket's tab is in front, its commands — take it (or reassign it to me),
 *    resolve, insert a canned response into its composer, a quick-reply window, copy its link — are the palette's
 *    (`>`), and are offered beside its search results. Each honours the ticket's permissions and state machine: an
 *    action the ticket does not allow is not listed.
 */

/** A ticket's deep link: opening it focuses the desktop app on that ticket (FR-DSK-05). */
export function ticketDeepLink(id: number): string {
  return `worksuite://support/ticket/${id}`;
}

/** The palette's search of the desk: the best few, from every ticket the person may see. */
export async function searchTickets(q: string, signal?: AbortSignal): Promise<Ticket[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return (await listTickets({ view: 'all', q: term, limit: 6 }, signal)).items;
}

/** What a ticket result says under its title: status, priority (when it matters), requester, and whose it is. */
export function ticketSubtitle(t: Ticket, me: number | null): string {
  const requester = t.requester.name || t.requester.email || null;
  const owner = !t.assignee ? text('Unassigned') : me !== null && t.assignee.id === me ? text('assigned to you') : t.assignee.name;
  return [text(statusLabel(t.status)), t.priority === 'urgent' || t.priority === 'high' ? text(PRIORITY_LABEL[t.priority]) : null, requester, owner].filter(Boolean).join(' · ');
}

/** Copies a ticket's deep link, and says so. */
export function copyTicketLink(id: number, reference: string): void {
  void navigator.clipboard.writeText(ticketDeepLink(id)).then(
    () => toast('success', text('Copied {link}', { link: ticketDeepLink(id) })),
    () => toast('error', text('Could not copy the link to {ref}.', { ref: reference })),
  );
}

/** The ticket in front and its actions, for the palette's search (where they show beside its result). */
let inFront: { id: number; reference: string; actions: Command[] } | null = null;
export function ticketInFront(): { id: number; reference: string; actions: Command[] } | null {
  return inFront;
}

export interface TicketActions {
  id: number;
  reference: string;
  /** Take it — or, assigned to somebody else and allowed to assign, reassign it to me. Null: neither is allowed. */
  take: { label: string; run: () => void } | null;
  resolve: (() => void) | null;
  canned: (() => void) | null;
}

/** The palette's commands for a ticket: what this ticket allows now, nothing else. */
export function ticketCommands(a: TicketActions): Command[] {
  const out: Command[] = [];
  const key = (k: string) => `support-${k}`;
  const kw = `${a.reference} ticket support`;
  if (a.take) out.push({ id: key('take'), label: a.take.label, group: 'Module', source: 'module', keywords: `${kw} assign me take`, run: a.take.run });
  if (a.resolve) out.push({ id: key('resolve'), label: text('Resolve {ref}', { ref: a.reference }), group: 'Module', source: 'module', keywords: `${kw} close`, hint: 'E', run: a.resolve });
  if (a.canned) out.push({ id: key('canned'), label: text('Insert canned response…'), group: 'Module', source: 'module', keywords: `${kw} canned reply template`, hint: '/', run: a.canned });
  out.push({ id: key('quick'), label: text('Quick reply window for {ref}', { ref: a.reference }), group: 'Module', source: 'module', keywords: `${kw} quick reply window`, run: () => openQuickReply(a.id) });
  out.push({ id: key('copy-link'), label: text('Copy link to {ref}', { ref: a.reference }), group: 'Module', source: 'module', keywords: `${kw} copy deep link`, run: () => copyTicketLink(a.id, a.reference) });
  return out;
}

/** The ticket's actions in the palette while its tab is in front (FR-WSP-06). */
export function useTicketCommands(active: boolean, a: TicketActions): void {
  const latest = useRef(a);
  useEffect(() => {
    latest.current = a;
  });
  const shape = `${a.id}:${a.reference}:${a.take?.label ?? ''}:${!!a.resolve}:${!!a.canned}`;
  useEffect(() => {
    if (!active) return;
    // Each command runs what the ticket allows as it now stands (the latest closure), registered once per shape.
    const commands = ticketCommands(latest.current).map((c) => ({ ...c, run: () => ticketCommands(latest.current).find((x) => x.id === c.id)?.run() }));
    const offs = commands.map((c) => registerCommand(c));
    const mine = { id: latest.current.id, reference: latest.current.reference, actions: commands };
    inFront = mine;
    return () => {
      offs.forEach((off) => off());
      if (inFront === mine) inFront = null;
    };
  }, [active, shape]);
}
