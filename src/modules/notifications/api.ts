import { canOpenLink, categoryVisible, type VisibleApps } from '@shared/access';
import { canFollowLink, refuse } from '../../core/access';
import { apiGet, apiPost } from '../../core/api';
import { call } from '../../core/bridge';
import { openWebLink } from '../../core/tab-context';
import { parseTs } from '../../core/time';
import { openMeeting } from '../meet/api';

/**
 * The notification centre's side of the server (`/api/notifications/centre`,
 * `/{id}/action`, `/bulk`), shared by the bell's drawer and the full centre.
 *
 * What the server does not carry is not invented here: there is no actor and
 * no company on a notification, and no action runs from one, so a row shows
 * its app, opens its record, and offers Join or Reply only where its own link
 * is a meeting or a conversation. Mentions, Approvals and Assigned to me are
 * read from the event's name, which is all the server says about them.
 */
export interface Notice {
  id: number;
  event: string | null;
  category: string | null;
  title: string;
  body: string | null;
  link: string | null;
  icon: string | null;
  level: string | null;
  priority: string;
  /** How many alike were folded into this one (the server groups repeats within a few minutes). */
  count: number;
  image_url: string | null;
  read: boolean;
  archived: boolean;
  pinned: boolean;
  snoozed_until: string | null;
  created_at: string;
}

export interface Centre {
  notifications: Notice[];
  page: number;
  per_page: number;
  total: number;
  counts: { total: number; unread: number; by_category: Record<string, { total: number; unread: number }> };
  categories: Record<string, string>;
}

/** The server's own views, and three read from event names over the inbox. */
export type View = 'inbox' | 'unread' | 'mentions' | 'approvals' | 'assigned' | 'snoozed' | 'archived';
const SERVER_VIEW: Record<View, string> = { inbox: 'inbox', unread: 'unread', mentions: 'inbox', approvals: 'inbox', assigned: 'inbox', snoozed: 'snoozed', archived: 'archived' };

export const K = { all: ['notifications'] as const, centre: (p: unknown) => ['notifications', 'centre', p] as const };

export function fetchCentre(p: { view: View; category?: string | null; q?: string; page?: number; perPage?: number }, signal?: AbortSignal): Promise<Centre> {
  return apiGet<Centre>(
    '/api/notifications/centre',
    {
      view: SERVER_VIEW[p.view],
      per_page: p.perPage ?? (p.view === 'mentions' || p.view === 'approvals' || p.view === 'assigned' ? 100 : 50),
      ...(p.page ? { page: p.page } : {}),
      ...(p.category ? { category: p.category } : {}),
      ...(p.q ? { q: p.q } : {}),
    },
    signal,
  ).then((c) => ({ ...c, notifications: (c.notifications ?? []).filter((n) => inView(n, p.view)) }));
}

/**
 * What the person may see of a list: a row whose link opens in an app they
 * were not given is left out (a row with no link stays). The server stops
 * sending these; this keeps any that arrive — or were cached — out of sight.
 */
export function visibleNotices(list: Notice[], visible: VisibleApps): Notice[] {
  return list.filter((n) => canOpenLink(n.link, visible));
}

/** The "Apps" list: categories of apps the person may open, and those of no app (system, security…). */
export function visibleCategories<T>(entries: Array<[string, T]>, visible: VisibleApps): Array<[string, T]> {
  return entries.filter(([c]) => categoryVisible(c, visible));
}

/** Somebody named you: a chat, a task, a comment, the feed. */
export const isMention = (n: Notice) => /mention/i.test(n.event ?? '');
/** Somebody waits on your decision or your signature. */
export const APPROVAL_EVENTS = new Set([
  'hr.leave_requested',
  'hr.request_submitted',
  'expense.approval_required',
  'expense.approval_stalled',
  'payroll.needs_approval',
  'oms.approval',
  'tender.approval',
  'task.review_requested',
  'profile.picture_review',
  'docs.signature_requested',
]);
export const isApproval = (n: Notice) => APPROVAL_EVENTS.has(n.event ?? '');
/** Something was handed to you. */
export const isAssigned = (n: Notice) => /(^|\.)([a-z_]*_)?assigned$|reviewer_added$/.test(n.event ?? '') && !/unassigned/.test(n.event ?? '');

export function inView(n: Notice, v: View): boolean {
  if (v === 'mentions') return isMention(n);
  if (v === 'approvals') return isApproval(n);
  if (v === 'assigned') return isAssigned(n);
  return true;
}

const URGENT = new Set(['high', 'critical', 'emergency']);
/** Waiting on you: unread, and either a decision for you or sent as urgent. */
export const needsYou = (n: Notice) => !n.read && !n.archived && (isApproval(n) || URGENT.has(n.priority) || n.level === 'critical');

export type Section = 'needs' | 'today' | 'earlier';
export const SECTION_LABEL: Record<Section, string> = { needs: 'Needs you', today: 'Today', earlier: 'Earlier' };

export function sectionOf(n: Notice, now = new Date()): Section {
  if (needsYou(n)) return 'needs';
  const d = parseTs(n.created_at);
  return d.toDateString() === now.toDateString() ? 'today' : 'earlier';
}

export function sectioned(list: Notice[], now = new Date()): Array<{ section: Section; items: Notice[] }> {
  const by: Record<Section, Notice[]> = { needs: [], today: [], earlier: [] };
  for (const n of list) by[sectionOf(n, now)].push(n);
  return (['needs', 'today', 'earlier'] as const).filter((s) => by[s].length).map((s) => ({ section: s, items: by[s] }));
}

/** Each app's look in lists: its icon, a short name, and its colours (accent, dark tint, light tint). */
export const APPS: Record<string, { short: string; icon: string; acc: string; tint: string; tintLight: string }> = {
  projects: { short: 'Projects', icon: 'tasks', acc: '#6C8CFF', tint: '#16203E', tintLight: '#E8EDFF' },
  chat: { short: 'Chat', icon: 'chat', acc: '#34C38F', tint: '#12291F', tintLight: '#E3F6EE' },
  mail: { short: 'Mail', icon: 'mail', acc: '#6C8CFF', tint: '#16203E', tintLight: '#E8EDFF' },
  expenses: { short: 'Expenses', icon: 'receipt', acc: '#F0A43A', tint: '#2A2213', tintLight: '#FDF1DF' },
  billing: { short: 'Invoices', icon: 'receipt', acc: '#9B7CF6', tint: '#1F1836', tintLight: '#F1ECFE' },
  calendar: { short: 'Calendar & Meet', icon: 'calendar', acc: '#E0629B', tint: '#2A1624', tintLight: '#FCE7F1' },
  files: { short: 'Drive', icon: 'folder', acc: '#F0A43A', tint: '#2A2213', tintLight: '#FDF1DF' },
  hr: { short: 'HR', icon: 'id-card', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  payroll: { short: 'Payroll', icon: 'wallet', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  crm: { short: 'CRM', icon: 'handshake', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  system: { short: 'System', icon: 'settings', acc: '#AFC0FF', tint: '#1B2542', tintLight: '#EEF1FB' },
  security: { short: 'Security', icon: 'shield', acc: '#FF8A7A', tint: '#2B1515', tintLight: '#FCE9E4' },
  organization: { short: 'People & access', icon: 'users', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  marketing: { short: 'Marketing', icon: 'megaphone', acc: '#E0629B', tint: '#2A1624', tintLight: '#FCE7F1' },
  inventory: { short: 'Inventory', icon: 'package', acc: '#F0A43A', tint: '#2A2213', tintLight: '#FDF1DF' },
  oms: { short: 'Sales orders', icon: 'cart', acc: '#34C38F', tint: '#12291F', tintLight: '#E3F6EE' },
  tenders: { short: 'Tenders', icon: 'briefcase', acc: '#9B7CF6', tint: '#1F1836', tintLight: '#F1ECFE' },
  hosting: { short: 'Hosting', icon: 'server', acc: '#AFC0FF', tint: '#1B2542', tintLight: '#EEF1FB' },
  customer_subscriptions: { short: 'Subscriptions', icon: 'repeat', acc: '#9B7CF6', tint: '#1F1836', tintLight: '#F1ECFE' },
  support: { short: 'Support', icon: 'help', acc: '#6C8CFF', tint: '#16203E', tintLight: '#E8EDFF' },
  appointments: { short: 'Appointments', icon: 'calendar-check', acc: '#E0629B', tint: '#2A1624', tintLight: '#FCE7F1' },
  amc: { short: 'AMC', icon: 'wrench', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  social: { short: 'Social', icon: 'megaphone', acc: '#6C8CFF', tint: '#16203E', tintLight: '#E8EDFF' },
  voip: { short: 'Calls', icon: 'phone', acc: '#34C38F', tint: '#12291F', tintLight: '#E3F6EE' },
  pms: { short: 'Hotel PMS', icon: 'bed', acc: '#3FB7C8', tint: '#10262B', tintLight: '#E1F4F6' },
  events: { short: 'Events', icon: 'ticket', acc: '#F59E0B', tint: '#2B2210', tintLight: '#FEF3E2' },
  documents: { short: 'Documents', icon: 'file-text', acc: '#9B7CF6', tint: '#1F1836', tintLight: '#F1ECFE' },
  other: { short: 'Other', icon: 'bell', acc: '#AFC0FF', tint: '#1B2542', tintLight: '#EEF1FB' },
};
const OTHER = { short: '', icon: 'bell', acc: '#AFC0FF', tint: '#1B2542', tintLight: '#EEF1FB' };

export function appOf(category: string | null | undefined, labels?: Record<string, string>) {
  const a = APPS[category ?? ''] ?? OTHER;
  return { ...a, short: a.short || (category && labels?.[category]) || (category ? category.charAt(0).toUpperCase() + category.slice(1) : 'WorkSuite') };
}

/** A meeting's own link, `/meet/<uuid>`. */
export const meetUuid = (link: string | null | undefined) => /^\/meet\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(link ?? '')?.[1] ?? null;
const isChatLink = (link: string | null | undefined) => /^\/chat(\/|\?|$)/.test(link ?? '');

/** Opens what a notification is about: a meeting in its window, anything else where it lives. */
export function openNotice(n: Pick<Notice, 'link' | 'title'>): void {
  const uuid = meetUuid(n.link);
  if (uuid && !canFollowLink(n.link)) refuse();
  else if (uuid) void openMeeting(uuid, n.title);
  else if (n.link) openWebLink(n.link);
}

/** The buttons a row offers, from what its link is. */
export function quickActions(n: Notice): Array<{ label: string; primary?: boolean; go: true }> {
  if (!n.link) return [];
  if (meetUuid(n.link)) return [{ label: 'Join', primary: true, go: true }];
  if (isChatLink(n.link)) return [{ label: 'Reply', primary: true, go: true }];
  return [{ label: isApproval(n) ? 'Review' : 'Open', primary: isApproval(n), go: true }];
}

export async function act(id: number, action: 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze' | 'unsnooze' | 'pin' | 'unpin', minutes?: number): Promise<void> {
  await apiPost(`/api/notifications/${id}/action`, { action, ...(minutes ? { minutes } : {}) });
  void call('notifications:refresh').catch(() => undefined);
}

export async function bulk(ids: number[], action: 'read' | 'unread' | 'archive' | 'delete'): Promise<void> {
  if (!ids.length) return;
  await apiPost('/api/notifications/bulk', { ids: ids.slice(0, 500), action });
  void call('notifications:refresh').catch(() => undefined);
}

export async function markAllRead(): Promise<void> {
  await call('notifications:markAllRead');
}

/** Snooze choices, as minutes from now (the server keeps 5 minutes to 30 days). */
export function snoozeChoices(now = new Date()): Array<{ label: string; minutes: number }> {
  const at = (d: Date) => Math.max(5, Math.round((d.getTime() - now.getTime()) / 60_000));
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  monday.setHours(9, 0, 0, 0);
  return [
    { label: '1 hour', minutes: 60 },
    { label: '3 hours', minutes: 180 },
    { label: 'Tomorrow, 9:00', minutes: at(tomorrow) },
    { label: 'Monday, 9:00', minutes: at(monday) },
  ];
}

export function snoozedLabel(minutes: number, now = new Date()): string {
  const d = new Date(now.getTime() + minutes * 60_000);
  const sameDay = d.toDateString() === now.toDateString();
  return `Snoozed until ${sameDay ? '' : d.toLocaleDateString([], { weekday: 'long' }) + ' '}${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
