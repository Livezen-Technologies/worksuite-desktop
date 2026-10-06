import { useEffect, useRef } from 'react';
import { PRIORITY_LABEL, SUPPORT_API, statusLabel, type KbSuggestion, type Ticket } from '@shared/support';
import { ApiError, request } from '../../core/api';
import { isMac } from '../../core/bridge';
import { registerCommand, type Command } from '../../core/commands';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { listTickets, openQuickReply, ticketArticles } from './api';

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
 *  - Knowledge (D-10): the KB & AI panel (⌘J) and "Insert KB link…" are the ticket's commands too, and the search
 *    finds articles — for the ticket in front, ranked for it, and ↵ puts one into its composer (a public article's
 *    link, an internal one's text); with no ticket in front, published articles, opened on the web.
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

/** The ticket in front, its actions, and how an article goes into its composer, for the palette's search. */
export interface TicketInFront {
  id: number;
  reference: string;
  actions: Command[];
  insertArticle: ((a: KbSuggestion, mode: 'link' | 'text') => void) | null;
}
let inFront: TicketInFront | null = null;
export function ticketInFront(): TicketInFront | null {
  return inFront;
}

/**
 * The palette's knowledge results: for the ticket in front, the articles for it (`GET tickets/{id}/kb?q=`); otherwise
 * published articles (`GET kb/articles`). None for somebody without the knowledge base, or a server without it.
 */
export async function searchArticles(q: string, signal?: AbortSignal): Promise<{ ticket: { id: number; reference: string } | null; articles: KbSuggestion[] }> {
  const term = q.trim();
  if (term.length < 2) return { ticket: null, articles: [] };
  const front = inFront;
  try {
    if (front) return { ticket: { id: front.id, reference: front.reference }, articles: (await ticketArticles(front.id, term, signal)).slice(0, 5) };
    const r = await request<{ articles?: Array<{ id: number; title: string; excerpt?: string | null; visibility: string; language: string | null }> }>('GET', `${SUPPORT_API}/kb/articles`, { query: { q: term, status: 'published', per: 5 }, signal });
    return { ticket: null, articles: (r.data.articles ?? []).slice(0, 5).map((a) => ({ id: a.id, title: a.title, excerpt: a.excerpt ?? null, visibility: a.visibility, language: a.language, url: null })) };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 405 || e.status === 501)) return { ticket: null, articles: [] };
    throw e;
  }
}

/** What an article result says under its title. */
export function articleSubtitle(a: KbSuggestion, ticketRef: string | null): string {
  const internal = a.visibility !== 'public';
  return [internal ? text('Internal') : text('Public'), a.language ? a.language.toUpperCase() : null, ticketRef ? (internal ? text('Insert text into {ref}', { ref: ticketRef }) : text('Insert link into {ref}', { ref: ticketRef })) : text('Knowledge base')].filter(Boolean).join(' · ');
}

export interface TicketActions {
  id: number;
  reference: string;
  /** Take it — or, assigned to somebody else and allowed to assign, reassign it to me. Null: neither is allowed. */
  take: { label: string; run: () => void } | null;
  resolve: (() => void) | null;
  canned: (() => void) | null;
  /** Open or close the KB & AI panel (⌘J). */
  assist?: (() => void) | null;
  /** The panel's knowledge search, to insert a link. Null: the ticket takes no reply. */
  kbLink?: (() => void) | null;
  /** An article from the palette's search into the composer. */
  insertArticle?: ((a: KbSuggestion, mode: 'link' | 'text') => void) | null;
}

/** The palette's commands for a ticket: what this ticket allows now, nothing else. */
export function ticketCommands(a: TicketActions): Command[] {
  const out: Command[] = [];
  const key = (k: string) => `support-${k}`;
  const kw = `${a.reference} ticket support`;
  if (a.take) out.push({ id: key('take'), label: a.take.label, group: 'Module', source: 'module', keywords: `${kw} assign me take`, run: a.take.run });
  if (a.resolve) out.push({ id: key('resolve'), label: text('Resolve {ref}', { ref: a.reference }), group: 'Module', source: 'module', keywords: `${kw} close`, hint: 'E', run: a.resolve });
  if (a.canned) out.push({ id: key('canned'), label: text('Insert canned response…'), group: 'Module', source: 'module', keywords: `${kw} canned reply template`, hint: '/', run: a.canned });
  if (a.kbLink) out.push({ id: key('kb-link'), label: text('Insert KB link…'), group: 'Module', source: 'module', keywords: `${kw} knowledge base article kb link insert`, run: a.kbLink });
  if (a.assist) out.push({ id: key('assist'), label: text('KB & AI panel'), group: 'Module', source: 'module', keywords: `${kw} knowledge ai summary suggest reply`, hint: isMac ? '⌘J' : 'Ctrl+J', run: a.assist });
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
  const shape = `${a.id}:${a.reference}:${a.take?.label ?? ''}:${!!a.resolve}:${!!a.canned}:${!!a.assist}:${!!a.kbLink}:${!!a.insertArticle}`;
  useEffect(() => {
    if (!active) return;
    // Each command runs what the ticket allows as it now stands (the latest closure), registered once per shape.
    const commands = ticketCommands(latest.current).map((c) => ({ ...c, run: () => ticketCommands(latest.current).find((x) => x.id === c.id)?.run() }));
    const offs = commands.map((c) => registerCommand(c));
    const mine: TicketInFront = {
      id: latest.current.id,
      reference: latest.current.reference,
      actions: commands,
      insertArticle: latest.current.insertArticle ? (art, mode) => latest.current.insertArticle?.(art, mode) : null,
    };
    inFront = mine;
    return () => {
      offs.forEach((off) => off());
      if (inFront === mine) inFront = null;
    };
  }, [active, shape]);
}
