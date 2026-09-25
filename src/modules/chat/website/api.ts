import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, request } from '../../../core/api';

/**
 * Website chat (UI-08: "group, direct and website-chat conversations") — the
 * staff side of WorkSuite's visitor widget, served by
 * `/api/chat/widget-admin/*`.
 *
 * There is no realtime event for an agent's reply or for a visitor typing, so
 * an open thread is polled, as the web does; new visitor messages, incoming
 * chats and hand-overs arrive as `chat.widget.message`, `chat.incoming`,
 * `chat.taken` and `chat.assigned`, which refresh these queries early.
 * Stamps are true UTC without a zone.
 */
export const WEBSITE = '/api/chat/widget-admin';

export interface WebsiteRow {
  id: number;
  widget: string | null;
  widget_id: number;
  site: string | null;
  online: boolean;
  inactive: boolean;
  label: string;
  visitor_name: string | null;
  email: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  current_url: string | null;
  last_seen: string | null;
  status: string;
  is_offline: boolean;
  priority: string;
  updated_at: string;
  agent: string | null;
  assigned_to: number | null;
  started_at: string | null;
  last_visitor_at: string | null;
  waiting_since: string | null;
  at_risk: boolean;
  awaiting_reply: boolean;
  rating: number | null;
  is_starred: boolean;
  tags: string[] | null;
}

export interface WebsiteCan {
  view: boolean;
  reply: boolean;
  manage: boolean;
}

export interface WebsiteMessage {
  id: number;
  body: string | null;
  from: 'visitor' | 'agent' | 'bot' | 'system';
  agent: string | null;
  at: string;
  file: { url: string; filename: string; mime: string; size: number; is_image: boolean } | null;
}

export interface WebsiteVisitor {
  id: number;
  label: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  language: string | null;
  timezone: string | null;
  country: string | null;
  city: string | null;
  landing_page: string | null;
  current_url: string | null;
  current_title: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  visits: number | null;
  first_seen: string | null;
  last_seen: string | null;
  is_blocked: boolean;
}

export interface WebsiteConversation {
  conversation: {
    id: number;
    widget: string | null;
    website: string | null;
    status: string;
    is_offline: boolean;
    inactive: boolean;
    assigned_to: number | null;
    visitor_typing: boolean;
    started_at: string | null;
    closed_at: string | null;
    rating: number | null;
    rating_comment: string | null;
    tags: string[] | null;
    is_starred: boolean;
    priority?: string;
  };
  visitor: WebsiteVisitor | null;
  messages: WebsiteMessage[];
  journey?: Array<{ url: string | null; title: string | null; at: string }>;
  history?: Array<{ id: number; status: string; started_at: string | null; rating: number | null; other_device: boolean }>;
  can?: WebsiteCan;
}

export const PRIORITIES: Array<{ id: string; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'vip', label: 'VIP' },
];

/** The workspace's sections (WebChatInbox, left). */
export type Section = 'inbox' | 'live' | 'offline' | 'missed' | 'mine' | 'unassigned' | 'awaiting' | 'starred' | 'closed';

/** Which open rows a section shows. */
export function sectionRows(rows: WebsiteRow[], section: Section, me: number | null): WebsiteRow[] {
  switch (section) {
    case 'live':
      return rows.filter((r) => r.online && !r.is_offline);
    case 'offline':
      return rows.filter((r) => r.is_offline);
    case 'mine':
      return rows.filter((r) => me !== null && r.assigned_to === me);
    case 'unassigned':
      return rows.filter((r) => r.assigned_to === null);
    case 'awaiting':
      return rows.filter((r) => r.awaiting_reply);
    case 'starred':
      return rows.filter((r) => r.is_starred);
    default:
      return rows;
  }
}

export type WebsiteFilter = 'waiting' | 'mine' | 'open' | 'closed';

export const WEBSITE_FILTERS: Array<{ id: WebsiteFilter; label: string }> = [
  { id: 'waiting', label: 'Waiting' },
  { id: 'mine', label: 'Mine' },
  { id: 'open', label: 'All open' },
  { id: 'closed', label: 'Closed' },
];

/** The rows a filter shows, from the open list (or the closed one). */
export function filterRows(rows: WebsiteRow[], filter: WebsiteFilter, me: number | null): WebsiteRow[] {
  if (filter === 'waiting') return rows.filter((r) => r.awaiting_reply);
  if (filter === 'mine') return rows.filter((r) => me !== null && r.assigned_to === me);
  return rows;
}

/** Oldest waiting first while waiting matters; most recent first otherwise. */
export function sortRows(rows: WebsiteRow[], filter: WebsiteFilter): WebsiteRow[] {
  const key = (r: WebsiteRow) => (filter === 'waiting' ? (r.waiting_since ?? r.last_visitor_at ?? r.started_at ?? '') : r.updated_at);
  return [...rows].sort((a, b) => (filter === 'waiting' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))));
}

export function useWebsiteInbox(closed: boolean, enabled = true) {
  return useQuery({
    queryKey: ['website', 'inbox', closed ? 'closed' : 'open'],
    queryFn: ({ signal }) => apiGet<{ conversations: WebsiteRow[]; can: WebsiteCan }>(`${WEBSITE}/conversations`, closed ? { status: 'closed' } : undefined, signal),
    enabled,
    // Somebody who does not staff website chat is told once, not every 15 s.
    refetchInterval: (query) => (query.state.error instanceof ApiError && (query.state.error.forbidden || query.state.error.status === 404) ? false : 15_000),
    retry: (n, e) => !(e instanceof ApiError && (e.forbidden || e.status === 404)) && n < 2,
  });
}

/**
 * Whether this person staffs website chat at all. The server's own answer —
 * a refusal hides the website tab rather than showing a page of errors.
 */
export function useWebsiteAccess(): boolean {
  const q = useWebsiteInbox(false);
  return q.isSuccess && q.data.can?.view !== false;
}

export function useWebsiteConversation(id: string) {
  return useQuery({
    queryKey: ['website', 'conversation', id],
    queryFn: ({ signal }) => apiGet<WebsiteConversation>(`${WEBSITE}/conversations/${id}`, undefined, signal),
    // No realtime event for replies or visitor typing: poll, slower in the background.
    refetchInterval: () => (document.visibilityState === 'visible' ? 5_000 : 30_000),
  });
}

export function useAgents(enabled: boolean) {
  return useQuery({
    queryKey: ['website', 'agents'],
    queryFn: ({ signal }) => apiGet<{ agents: Array<{ id: number; name: string; email: string }> }>(`${WEBSITE}/agents`, undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCanned(enabled: boolean) {
  return useQuery({
    queryKey: ['website', 'canned'],
    queryFn: ({ signal }) => apiGet<{ responses: Array<{ id: number; shortcut: string | null; title: string; body: string }> }>(`${WEBSITE}/canned`, undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export async function websiteAction(id: number | string, action: string, extra: Record<string, unknown> = {}): Promise<void> {
  await request('POST', `${WEBSITE}/conversations/${id}/action`, { body: { action, ...extra } });
}

export async function websiteAttach(id: number | string, file: File, caption?: string): Promise<void> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (caption) form.append('caption', caption);
  await request('POST', `${WEBSITE}/conversations/${id}/attach`, { body: form });
}

/** What a visitor is doing, in the list's one word. */
export function visitorStatus(v: { conversation_status: string | null; idle_seconds: number }): ['Chatting' | 'Active' | 'Inactive', string] {
  if (v.conversation_status === 'open' || v.conversation_status === 'pending') return ['Chatting', 'text-primary'];
  return v.idle_seconds < 120 ? ['Active', 'text-success'] : ['Inactive', 'text-ink-3'];
}
