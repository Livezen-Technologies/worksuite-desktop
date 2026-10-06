import { useQuery } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { apiGet } from '../../core/api';
import { useStore } from '../../core/store';
import { dayWords } from '../../core/time';
import type { WaitingInvitation } from '../calendar/conflicts';
import { fetchQueue, QK, type QueueItem } from '../expenses/approvals-api';
import { money } from '../expenses/api';
import type { ApprovalsResponse, CoverAsk, Sheet as TimeSheet } from '../hr/api';
import { minutesLabel } from '../hr/dates';
import type { MyAnnouncement } from './Announcements';

/**
 * Waiting for me (worksuite-desktop#263): everything that needs the person, from every app Home can ask — leave to
 * approve, colleagues' cover to answer, timesheets and expense claims to review, other HR approvals, meeting and
 * event invitations, and announcements to acknowledge — as one list of items, each saying what it is in its title
 * ("Nimal Perera · Annual leave") and the rest in its subtitle ("Oct 9 · 1 day · Personal matter"), and each opening
 * itself rather than a list. The Home card shows the first few; "All ›" opens them all, with filters.
 *
 * Purchase requests, tender approvals and documents to sign are not here: no server list says which wait on this
 * person yet.
 */

/** `/api/hr/approvals/pending`: HR's own list of what waits on the person. */
export interface Approval {
  kind: string;
  id: number;
  who: string;
  what: string;
  when: string;
  /** "responsible" when named on the request, otherwise the approver's role. */
  as: string;
  link: string;
  /** Newer servers may say which organisation it is in. */
  org_id?: number | string | null;
  org?: string | null;
}

export type WaitingKind = 'cover' | 'leave' | 'request' | 'resignation' | 'timesheet' | 'expense' | 'invitation' | 'announcement' | 'other';

/** The kinds in the order they are listed: what blocks somebody else first. */
export const KINDS: Array<{ id: WaitingKind; label: string }> = [
  { id: 'cover', label: 'Cover to answer' },
  { id: 'leave', label: 'Leave' },
  { id: 'timesheet', label: 'Timesheets' },
  { id: 'expense', label: 'Expenses' },
  { id: 'request', label: 'HR requests' },
  { id: 'resignation', label: 'Resignations' },
  { id: 'other', label: 'Other approvals' },
  { id: 'invitation', label: 'Invitations' },
  { id: 'announcement', label: 'Announcements' },
];

export interface WaitingItem {
  key: string;
  kind: WaitingKind;
  id: number;
  title: string;
  subtitle: string;
  /** All of it, for the tooltip. */
  detail: string;
  /** The organisations it is in; none when the server does not say. */
  orgs: Array<{ id: string; name: string | null }>;
  /** Where opening it goes, when it is not opened on Home itself (the leave review, the announcement). */
  link: string | null;
  /** A leave approval: decided here as an approver (not only named on it). */
  decides?: boolean;
  invitation?: WaitingInvitation;
  expense?: QueueItem;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "Oct 9", "Oct 9 – Oct 11": calendar days, on no clock. */
export function spanWords(from: string, to?: string | null): string {
  return !to || to === from ? dayWords(from) : `${dayWords(from)} – ${dayWords(to)}`;
}

export function daysWords(days: number | string): string {
  const n = Math.round(Number(days) * 100) / 100;
  return Number.isFinite(n) ? `${n} ${n === 1 ? 'day' : 'days'}` : '';
}

const join = (parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(' · ');

function approvalKind(a: Approval): WaitingKind {
  return a.kind === 'leave' ? 'leave' : a.kind === 'request' ? 'request' : a.kind === 'resignation' ? 'resignation' : 'other';
}

/**
 * Where an approval opens: its own record. Leave opens its review on Home. The generic approvals address the server
 * links to is Timesheet approvals on the desktop, so anything else that only has that goes to HR's Waiting on me.
 */
function approvalLink(a: Approval): string | null {
  if (a.kind === 'leave') return null;
  if (a.kind === 'resignation') return `/hr?tab=resignations&resignation=${a.id}`;
  const generic = !a.link || /^\/?hr(\/approvals|\?tab=approvals)\b/.test(a.link.replace(/^https?:\/\/[^/]+/, ''));
  return generic ? '/hr?tab=waiting' : a.link;
}

export interface Sources {
  approvals: Approval[];
  /** HR's leave queue, for each leave request's dates, length and reason. */
  leave: ApprovalsResponse['leave'];
  cover: CoverAsk[];
  timesheets: TimeSheet[];
  expenses: QueueItem[];
  invitations: WaitingInvitation[];
  acknowledgements: MyAnnouncement[];
}

/** One list of what waits, in the order of `KINDS`; a leave the person is only asked to cover is listed once, as cover. */
export function waitingItems(s: Sources): WaitingItem[] {
  const covering = new Set(s.cover.map((c) => Number(c.id)));
  const items: WaitingItem[] = [];
  for (const c of s.cover) {
    const title = `Accept cover for ${c.employee_name} · ${spanWords(c.starts_on, c.ends_on)}`;
    const subtitle = join([c.type_name, daysWords(c.days), c.reason]);
    items.push({ key: `cover:${c.id}`, kind: 'cover', id: Number(c.id), title, subtitle, detail: `${c.employee_name} asked you to cover their ${(c.type_name || 'leave').toLowerCase()}.\n${join([spanWords(c.starts_on, c.ends_on), daysWords(c.days)])}${c.reason ? `\n“${c.reason}”` : ''}`, orgs: [], link: null });
  }
  for (const a of s.approvals) {
    const kind = approvalKind(a);
    if (kind === 'leave' && a.as === 'responsible' && covering.has(Number(a.id))) continue;
    const orgs = a.org_id !== null && a.org_id !== undefined && a.org_id !== '' ? [{ id: String(a.org_id), name: a.org ?? null }] : [];
    const l = kind === 'leave' ? s.leave.find((x) => Number(x.id) === Number(a.id)) : undefined;
    const title = l ? `${l.employee} · ${l.type}` : join([a.who, a.what]);
    const subtitle = l ? join([spanWords(l.starts_on, l.ends_on), daysWords(l.days), l.reason]) : a.when;
    const role = kind === 'leave' ? (a.as === 'responsible' ? 'You are named on it' : 'Waiting for your approval') : null;
    items.push({ key: `${a.kind}:${a.id}`, kind, id: Number(a.id), title, subtitle, detail: join([title, subtitle]) + (role ? `\n${role}` : ''), orgs, link: approvalLink(a), decides: kind === 'leave' && a.as !== 'responsible' });
  }
  for (const t of s.timesheets) {
    const title = `${t.employee ?? 'Someone'} · Timesheet`;
    const subtitle = join([spanWords(t.starts_on, t.ends_on), `${minutesLabel(Number(t.minutes))} logged`]);
    items.push({ key: `timesheet:${t.id}`, kind: 'timesheet', id: Number(t.id), title, subtitle, detail: `${title}\n${subtitle}${t.note ? `\n“${t.note}”` : ''}`, orgs: [], link: '/hr?tab=approvals' });
  }
  for (const e of s.expenses) {
    const what = e.entity_type === 'advance' ? 'Advance' : 'Expense claim';
    const title = `${e.claimant ?? 'Someone'} · ${what}`;
    // An advance's amount is labelled in its own currency but held in the company's: left to the Expenses screen.
    const amount = e.entity_type === 'claim' && e.base_amount ? money(e.base_amount, e.base_currency ?? '') : null;
    const subtitle = join([e.ref, amount, e.description]);
    const waited = e.days_waiting > 0 ? `Waiting ${plural(e.days_waiting, 'day')}` : 'Waiting since today';
    items.push({
      key: `expense:${e.key}`,
      kind: 'expense',
      id: e.entity_id,
      title,
      subtitle,
      detail: join([title, e.org]) + `\n${subtitle}\n${join([e.label, waited])}`,
      orgs: [{ id: String(e.org_id), name: e.org }],
      link: e.entity_type === 'advance' ? `/expenses?tab=advances&advance=${e.entity_id}` : `/expenses?tab=team&claim=${e.entity_id}`,
      expense: e,
    });
  }
  for (const i of s.invitations) {
    items.push({ key: `invitation:${i.source}:${i.id}`, kind: 'invitation', id: i.id, title: i.title, subtitle: i.organizer ? `Invitation from ${i.organizer}` : 'Invitation', detail: i.title, orgs: [], link: i.link, invitation: i });
  }
  for (const n of s.acknowledgements) {
    const orgs = n.companies?.length ? n.companies.map((c) => ({ id: String(c.id), name: c.name })) : [];
    items.push({ key: `announcement:${n.id}`, kind: 'announcement', id: n.id, title: n.title, subtitle: join(['Read and acknowledge', n.company]), detail: join([n.title, n.author, n.company]) + (n.preview ? `\n${n.preview}` : ''), orgs, link: null });
  }
  const rank = (k: WaitingKind) => KINDS.findIndex((x) => x.id === k);
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.kind) - rank(b.it.kind) || a.i - b.i).map(({ it }) => it);
}

/** In an organisation chosen; one the server does not place in any is in all of them (as Home treats it). */
export function inOrgs(item: Pick<WaitingItem, 'orgs'>, chosen: string[]): boolean {
  return !chosen.length || !item.orgs.length || item.orgs.some((o) => chosen.includes(o.id));
}

/** How many of each kind, and in each organisation named: each count is the length of the list it filters to. */
export function facets(items: WaitingItem[], kind: WaitingKind | '', org: string): { kinds: Array<{ id: WaitingKind; label: string; n: number }>; orgs: Array<{ id: string; name: string | null; n: number }> } {
  const inOrg = items.filter((i) => inOrgs(i, org ? [org] : []));
  const kinds = KINDS.map((k) => ({ ...k, n: inOrg.filter((i) => i.kind === k.id).length })).filter((k) => k.n > 0);
  const named = new Map<string, string | null>();
  for (const i of items) for (const o of i.orgs) if (!named.has(o.id) || (!named.get(o.id) && o.name)) named.set(o.id, o.name);
  const ofKind = items.filter((i) => !kind || i.kind === kind);
  const orgs = [...named].map(([id, name]) => ({ id, name, n: ofKind.filter((i) => inOrgs(i, [id])).length }));
  return { kinds, orgs };
}

/** Everything waiting, from each app the person has: the sources asked for separately, so one slow app holds up nothing. */
export function useWaitingSources(has: (app: string) => boolean, enabled = true) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const hr = enabled && has('hr');
  const approvals = useQuery({ queryKey: ['hr', 'approvals'], queryFn: () => apiGet<{ count: number; items: Approval[] }>('/api/hr/approvals/pending'), enabled: hr, retry: false });
  const leave = useQuery({ queryKey: ['hr', 'leave-approvals'], queryFn: ({ signal }) => apiGet<ApprovalsResponse>('/api/hr/leave/approvals', undefined, signal), enabled: hr && (approvals.data?.items ?? []).some((a) => a.kind === 'leave'), retry: false, staleTime: 30_000 });
  const cover = useQuery({ queryKey: ['hr', 'cover', 'mine'], queryFn: ({ signal }) => apiGet<{ requests: CoverAsk[] }>('/api/hr/leave/cover/mine', undefined, signal), enabled: hr, retry: false, staleTime: 30_000 });
  // Timesheets only for whoever reviews them: hr.manage, or a line manager, which only the server knows.
  const access = useQuery({ queryKey: ['hr', 'access'], queryFn: ({ signal }) => apiGet<{ timesheets?: { review?: boolean } }>('/api/hr/access', undefined, signal), enabled: hr, retry: false, staleTime: 300_000 });
  const reviews = !!perms && (perms.includes('*') || perms.includes('hr.manage') || access.data?.timesheets?.review === true);
  const timesheets = useQuery({ queryKey: ['hr', 'timesheets', 'all', 'submitted'], queryFn: ({ signal }) => apiGet<TimeSheet[]>('/api/hr/timesheets', { scope: 'all', status: 'submitted' }, signal), enabled: hr && reviews, retry: false, staleTime: 30_000 });
  const expenses = useQuery({ queryKey: QK.queue, queryFn: ({ signal }) => fetchQueue(signal), enabled: enabled && has('expenses'), retry: false, staleTime: 30_000 });
  return {
    approvals,
    sources: {
      approvals: hr ? (approvals.data?.items ?? []) : [],
      leave: hr ? (leave.data?.leave ?? []) : [],
      cover: hr ? (cover.data?.requests ?? []) : [],
      timesheets: hr && reviews ? (Array.isArray(timesheets.data) ? timesheets.data.filter((t) => t.can_decide && t.status === 'submitted') : []) : [],
      expenses: enabled && has('expenses') ? (expenses.data ?? []) : [],
    },
    /** What the server counts beyond the approvals it lists. */
    unlisted: hr ? Math.max(0, (approvals.data?.count ?? 0) - (approvals.data?.items ?? []).length) : 0,
  };
}
