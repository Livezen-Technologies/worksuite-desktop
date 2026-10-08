import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { isLive, type ListParams, type ManualSource, type Meta, type NewTicketInput, type SupportPriority, type SupportType, type Ticket, type TicketPage } from '@shared/support';
import { text } from '../../core/i18n';
import { readableText } from '../../core/rich';
import { K, type RequesterHit } from './api';
import type { DraftFile } from './Composer';

/**
 * The New ticket form's rules (WS-SUPPORT-SRS-001 FR-CRT-01/02, worksuite-desktop#298), kept apart from the sheet so
 * they are tested on their own: what the form holds, what makes it ready, what `POST tickets` is sent, and where the
 * new ticket shows at once — the lists it belongs in, before the desk's own answer arrives.
 */

/** The requester: a contact found, or somebody new by name, email and phone. */
export interface RequesterChoice {
  mode: 'find' | 'new';
  found: RequesterHit | null;
  name: string;
  email: string;
  phone: string;
}

export interface NewTicketForm {
  requester: RequesterChoice;
  /** Null: not chosen (the only one there is goes without saying). */
  organization: number | null;
  subject: string;
  /** The description as formatted (the editor's HTML, cleaned). */
  html: string;
  /** Uploaded for the description, waiting for it at the server. */
  files: DraftFile[];
  priority: SupportPriority;
  type: SupportType | null;
  category: number | null;
  team: number | null;
  /** Null: unassigned. */
  assignee: number | null;
  tags: string[];
  /** A datetime field's value, on this computer's clock ('' for none). */
  due: string;
  source: ManualSource;
  /** Email the requester its reference: on unless unticked, and only ever with an address to send to. */
  notify: boolean;
}

/** A new form: mine, Normal, in the organization the desk has chosen, by hand, confirming by email. */
export function emptyForm(organization: number | null, me: number | null): NewTicketForm {
  return {
    requester: { mode: 'find', found: null, name: '', email: '', phone: '' },
    organization,
    subject: '',
    html: '',
    files: [],
    priority: 'normal',
    type: null,
    category: null,
    team: null,
    assignee: me,
    tags: [],
    due: '',
    source: 'manual',
    notify: true,
  };
}

/** The organizations I may raise a ticket in (an organization's own `can.create`; one that says nothing is offered). */
export function creatableOrganizations(m: Pick<Meta, 'organizations'> | null | undefined): Array<{ id: number; name: string }> {
  return (m?.organizations ?? []).filter((o) => o.can?.create !== false).map((o) => ({ id: o.id, name: o.name }));
}

/**
 * The organization the form starts in: the one chosen in the rail's company switcher when I may raise tickets there,
 * else the only one I may; otherwise it is chosen.
 */
export function defaultOrganization(selected: number | null, choices: Array<{ id: number }>): number | null {
  if (selected !== null && choices.some((o) => o.id === selected)) return selected;
  return choices.length === 1 ? choices[0]!.id : null;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** The requester as the server takes it: a contact's own details (and id), or what was typed — blanks as null. */
export function requesterOf(r: RequesterChoice): NewTicketInput['requester'] {
  if (r.mode === 'find' && r.found) {
    return { name: r.found.name, email: r.found.email, phone: r.found.phone, contact_id: r.found.kind === 'contact' ? r.found.id : null };
  }
  const v = (s: string) => s.trim() || null;
  return { name: v(r.name), email: v(r.email), phone: v(r.phone) };
}

/** The address the confirmation would go to, or null when there is none. */
export function requesterEmail(r: RequesterChoice): string | null {
  const e = r.mode === 'find' ? (r.found?.email ?? '') : r.email.trim();
  return e && EMAIL.test(e) ? e : null;
}

/**
 * The description as the thread shows it: its text, a line per paragraph — a bulleted item with "• ", a numbered one
 * with its number — so nothing typed as a list reads as run-on lines.
 */
export function descriptionText(html: string): string {
  if (!html.trim()) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  for (const list of Array.from(doc.querySelectorAll('ol, ul'))) {
    Array.from(list.children)
      .filter((li) => li.tagName === 'LI')
      .forEach((li, i) => li.insertBefore(doc.createTextNode(list.tagName === 'OL' ? `${i + 1}. ` : '• '), li.firstChild));
  }
  return readableText(doc.body.innerHTML);
}

export type FormErrors = Partial<Record<'subject' | 'requester' | 'email' | 'organization' | 'description', string>>;

/** What stops the form from being sent, field by field, in words. */
export function validate(f: NewTicketForm, opts: { organizations: number }): FormErrors {
  const out: FormErrors = {};
  if (!f.subject.trim()) out.subject = text('Give the ticket a subject.');
  const r = f.requester;
  if (r.mode === 'find' && !r.found) out.requester = text('Find the requester among your contacts, or add a new one.');
  if (r.mode === 'new') {
    if (!r.name.trim() && !r.email.trim() && !r.phone.trim()) out.requester = text('Give the requester a name, an email address or a phone number.');
    if (r.email.trim() && !EMAIL.test(r.email.trim())) out.email = text('That is not an email address.');
  }
  if (opts.organizations > 1 && f.organization === null) out.organization = text('Choose the company.');
  if (f.files.length && !descriptionText(f.html)) out.description = text('Describe the problem: the files go with the description.');
  return out;
}

/** "2026-10-07T14:30" on this computer's clock as an instant; null for nothing or nonsense. */
export function dueAt(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** What `POST tickets` is sent for the form (NewTicketInput): only what was given, the files under both names. */
export function newTicketInput(f: NewTicketForm): NewTicketInput {
  const description = descriptionText(f.html);
  const ids = f.files.map((x) => x.id);
  const due = dueAt(f.due);
  return {
    subject: f.subject.trim(),
    ...(description ? { description, description_html: f.html } : {}),
    requester: requesterOf(f.requester),
    ...(f.organization !== null ? { organization_id: f.organization } : {}),
    source: f.source,
    priority: f.priority,
    ...(f.type ? { type: f.type } : {}),
    ...(f.category !== null ? { category_id: f.category } : {}),
    ...(f.team !== null ? { team_id: f.team } : {}),
    assigned_to: f.assignee,
    ...(f.tags.length ? { tags: f.tags } : {}),
    ...(due ? { due_at: due } : {}),
    ...(ids.length ? { attachment_ids: ids, attachments: ids } : {}),
    notify_requester: f.notify && requesterEmail(f.requester) !== null,
  };
}

/** A list's question as the inbox keys it (`K.list`): the list's parameters and the saved view it is, if one. */
export type ListKey = Partial<ListParams> & { saved?: number | null };

/**
 * Whether a ticket just raised belongs in a list, as far as the desktop can tell without the server: the views whose
 * rule is plain (mine, unassigned, assigned, open and pending, all, a status), under the status, priority, channel and
 * organization filters. A search or a saved view's other filters only the server can answer: not guessed.
 */
export function fitsList(t: Ticket, p: ListKey, me: number | null): boolean {
  if ((p.saved !== null && p.saved !== undefined) || p.q?.trim()) return false;
  if (Object.keys(p.extra ?? {}).some((k) => k !== 'organization')) return false;
  if (p.status?.length && !p.status.includes(t.status)) return false;
  if (p.priority?.length && !p.priority.includes(t.priority)) return false;
  if (p.source?.length && !p.source.includes(t.source)) return false;
  const orgs = p.organization?.length ? p.organization : p.extra?.organization ? p.extra.organization.split(',') : [];
  if (orgs.length && !orgs.includes(String(t.organization?.id ?? ''))) return false;
  const live = isLive(t.status);
  switch (p.view) {
    case 'mine':
      return live && me !== null && t.assignee?.id === me;
    case 'unassigned':
      return live && !t.assignee;
    case 'assigned':
      return live && !!t.assignee;
    case 'live':
      return live;
    case 'all':
      return true;
    case 'escalated':
    case 'resolved':
    case 'closed':
      return t.status === p.view;
    case 'pending':
      return t.status === 'pending_customer' || t.status === 'pending_internal';
    case 'needs_organization':
      return !t.organization;
    default:
      return false;
  }
}

/**
 * The new ticket shown at once (#298): at the top of every list already read that it belongs in — no list is asked
 * again for it — and every list marked out of date, so one not on screen is asked when it is next shown. The desk's
 * own hint (`support.changed`, live.ts) or the poll then brings the server's order. The rail's counts and the
 * badges are asked again.
 */
export function showCreated(qc: QueryClient, t: Ticket, me: number | null): void {
  for (const [key, data] of qc.getQueriesData<InfiniteData<TicketPage, unknown>>({ queryKey: K.lists })) {
    const p = (key[2] ?? {}) as ListKey;
    const first = data?.pages?.[0];
    if (!data || !first || !fitsList(t, p, me)) continue;
    if (data.pages.some((pg) => pg.items.some((x) => x.id === t.id))) continue;
    qc.setQueryData<InfiniteData<TicketPage, unknown>>(key, { ...data, pages: [{ ...first, items: [t, ...first.items] }, ...data.pages.slice(1)] });
  }
  void qc.invalidateQueries({ queryKey: K.lists, refetchType: 'none' });
  void qc.invalidateQueries({ queryKey: ['support', 'views'] });
  void qc.invalidateQueries({ queryKey: K.badges });
}
