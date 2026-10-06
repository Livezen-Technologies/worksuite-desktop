import { useQuery, type QueryClient } from '@tanstack/react-query';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../core/api';
import { WEBSITE, type WebsiteRow } from './api';

/**
 * Returning visitors (worksuite-desktop#222), the agent's side: one person, one profile, one ongoing conversation.
 *
 * How we know somebody, strongest first: signed in on the website (its user id, signed), a verified email (a one-time
 * code), a returning browser (the widget's own token), or new. An email or phone somebody merely typed only ever
 * SUGGESTS that two visitors are the same person; merging is an agent's decision, shown first, logged, and undoable.
 */

export type IdentityLevel = 'signed' | 'verified' | 'returning' | 'new';

export const IDENTITY_LABEL: Record<IdentityLevel, string> = {
  signed: 'Signed in',
  verified: 'Verified email',
  returning: 'Returning browser',
  new: 'New',
};

export const IDENTITY_HINT: Record<IdentityLevel, string> = {
  signed: 'The website told us who this is, signed: recognised on any device.',
  verified: 'Confirmed their email with a one-time code: recognised on their other devices.',
  returning: 'This browser has been here before.',
  new: 'Nothing is known about this visitor yet.',
};

export interface VisitorDevice {
  id: number;
  label: string;
  browser: string | null;
  os: string | null;
  device: string | null;
  last_seen: string | null;
  first_seen: string | null;
  primary: boolean;
}

export interface VisitorSuggestion {
  visitor_id: number;
  label: string;
  name: string | null;
  email: string | null;
  reason: 'same email' | 'same phone';
  chats: number;
  last_seen: string | null;
}

export interface VisitorMerge {
  id: number;
  kind: 'signed' | 'verified' | 'manual';
  reason: string | null;
  at: string;
  by: string | null;
  merged: { id: number; label: string | null; name: string | null };
  undone_at: string | null;
  can_undo: boolean;
}

export interface LinkedContact {
  id: number;
  name: string;
  company: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  deals: Array<{ id: number; name: string; amount: number; currency: string; state: 'open' | 'won' | 'lost' }>;
}

export interface VisitorProfile {
  profile: {
    id: number;
    label: string;
    /** The contact's name, else the name they gave; null when nothing is known (show the label). */
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    identity: IdentityLevel;
    visits: number;
    /** "3rd": which visit this is. */
    visit: string;
    first_seen: string | null;
    last_seen: string | null;
  };
  devices: VisitorDevice[];
  identifiers: Array<{ kind: 'user_id' | 'email' | 'phone'; value: string; verified: boolean; source: string | null }>;
  chats: Array<{ id: number; status: string; started_at: string | null; closed_at: string | null; rating: number | null; closed_reason: string | null }>;
  suggestions: VisitorSuggestion[];
  merges: VisitorMerge[];
  contact: LinkedContact | null;
  contact_matches: Array<{ id: number; name: string; company: string | null }>;
  can: { merge: boolean; link: boolean; erase: boolean };
}

export interface MergePreview {
  keep: { id: number; label: string; name: string | null };
  merge: { id: number; label: string; name: string | null };
  name: string;
  chats_moving: number;
  chats_total: number;
  closes: { id: number; started_at: string | null } | null;
}

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const s = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
}

/** The inbox row's badge (#222): "Returning · 3rd visit"; nothing on a first visit, or from a server without it. */
export function returningBadge(r: Pick<WebsiteRow, 'visits' | 'identity'>): string | null {
  const n = r.visits ?? 0;
  if (n > 1) return `Returning · ${ordinal(n)} visit`;
  return null;
}

/** The name an agent sees: the contact's or the one given; "Visitor E5C9" only when nothing is known. */
export function knownName(p: Pick<VisitorProfile['profile'], 'name' | 'label'>): string {
  return p.name || p.label;
}

export const profileKey = (visitorId: number) => ['website', 'visitor-profile', visitorId] as const;

/**
 * A visitor's profile. A server without returning visitors answers 404, which is not an error here: the panel keeps
 * its older Previous chats list.
 */
export function useVisitorProfile(visitorId: number | null | undefined) {
  return useQuery({
    queryKey: profileKey(visitorId ?? 0),
    queryFn: ({ signal }) => apiGet<VisitorProfile>(`${WEBSITE}/visitors/${visitorId}/profile`, undefined, signal),
    enabled: !!visitorId,
    staleTime: 15_000,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.forbidden)) && n < 2,
  });
}

export const identity = {
  preview: (keep: number, other: number) => apiPost<{ preview: MergePreview }>(`${WEBSITE}/visitors/${keep}/merge`, { other_id: other, preview: true }).then((r) => r.preview),
  merge: (keep: number, other: number) => apiPost<{ merge_id: number; visitor_id: number }>(`${WEBSITE}/visitors/${keep}/merge`, { other_id: other }),
  undo: (mergeId: number) => apiPost<{ visitor_id: number; kept_id: number }>(`${WEBSITE}/visitor-merges/${mergeId}/undo`, {}),
  dismiss: (visitorId: number, other: number) => apiPost(`${WEBSITE}/visitors/${visitorId}/dismiss`, { other_id: other }),
  link: (visitorId: number, contactId: number | null) => apiPost<{ contact: LinkedContact | null }>(`${WEBSITE}/visitors/${visitorId}/contact`, { contact_id: contactId }),
  erase: (visitorId: number) => apiDelete<{ visitors: number; conversations: number; messages: number }>(`${WEBSITE}/visitors/${visitorId}/data`),
};

/** After a merge, an unmerge or a deletion: the lists, the open threads and the profiles read again. */
export function refreshAfterIdentity(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['website'] });
}

// ---- a widget's settings ---------------------------------------------------------------------------------------------

export interface IdentitySettings {
  reopen_window_days: number;
  device_continuation: 'off' | 'email_code';
  auto_link_contacts: boolean;
  cookie_days: number;
  retention_days: number;
  has_secret: boolean;
}

export interface IdentityPayload {
  settings: IdentitySettings;
  /** Only for somebody who may configure widgets. */
  secret: string | null;
  can_manage: boolean;
  /** Whether the server can send email, which "Continue on another device" needs. */
  mail: boolean;
}

export function useIdentitySettings(widgetId: number) {
  return useQuery({
    queryKey: ['website', 'widget', widgetId, 'identity'],
    queryFn: ({ signal }) => apiGet<IdentityPayload>(`${WEBSITE}/widgets/${widgetId}/identity`, undefined, signal),
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.forbidden)) && n < 2,
  });
}

export const saveIdentitySettings = (widgetId: number, patch: Partial<Omit<IdentitySettings, 'has_secret'>> & { regenerate_secret?: boolean }) =>
  apiPut<IdentityPayload>(`${WEBSITE}/widgets/${widgetId}/identity`, patch);

/**
 * The site's server-side line that signs a user id, in the languages the guide shows. The secret is read from the
 * site's own configuration (here WORKSUITE_CHAT_SECRET), never written into a page.
 */
export const SIGNING_SNIPPETS: Array<{ id: string; label: string; code: string }> = [
  { id: 'php', label: 'PHP', code: "$userHash = hash_hmac('sha256', (string) $user->id, getenv('WORKSUITE_CHAT_SECRET'));" },
  { id: 'node', label: 'Node.js', code: "const userHash = crypto.createHmac('sha256', process.env.WORKSUITE_CHAT_SECRET).update(String(user.id)).digest('hex');" },
  { id: 'python', label: 'Python', code: "user_hash = hmac.new(os.environ['WORKSUITE_CHAT_SECRET'].encode(), str(user.id).encode(), hashlib.sha256).hexdigest()" },
];

/** What the page calls once the visitor is signed in, and on sign-out. */
export const IDENTIFY_SNIPPET = `<script>
  window.WorkSuiteChat = window.WorkSuiteChat || { q: [] };
  ['identify', 'logout', 'consent', 'open', 'close'].forEach(function (m) {
    window.WorkSuiteChat[m] = window.WorkSuiteChat[m] || function () { window.WorkSuiteChat.q.push([m, arguments]); };
  });
  // Signed in: who, with the hash your server made.
  WorkSuiteChat.identify({ userId: '42', userHash: '<?= $userHash ?>', name: 'Kamal Perera', email: 'kamal@example.com' });
  // On sign-out:
  // WorkSuiteChat.logout();
</script>`;
