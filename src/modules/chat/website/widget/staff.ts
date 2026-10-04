import { apiDelete, apiGet, apiPost } from '../../../../core/api';
import { text } from '../../../../core/i18n';
import { WEBSITE } from '../api';

/**
 * Widget settings › Staff (S-04; WS-WCHAT X-UI-17, UX-SET-06; STF-01…03): who answers this widget, what each of them
 * is doing now, priority, voice calls, active or suspended, and the people who lost "See website chats".
 *
 * The server's staff list (`widgets/{id}/staff`, which needs "Assign website chat staff"): adding or changing somebody
 * is `POST` with only the flags being changed (the server keeps the other one), taking them off is `DELETE`.
 */

export type StaffStatus = 'available' | 'busy' | 'away' | 'offline';

export interface StaffMember {
  id: number;
  user_id: number;
  name: string;
  email: string;
  priority: boolean;
  /** False is Suspended: they keep their history but get no chats. */
  is_active: boolean;
  /** Still holds "See website chats" (STF-02); without it they are skipped for notifications. */
  permitted: boolean;
  /** Fields from S-04; a server from before it sends none of them. */
  role?: string | null;
  avatar?: string | null;
  status?: StaffStatus;
  open_chats?: number;
  /** Takes website voice calls. */
  voice?: boolean;
}

export interface StaffPayload {
  staff: StaffMember[];
  /** People who can see website chats and are not on this widget yet. */
  available: Array<{ id: number; name: string; email: string; role?: string | null }>;
}

export const staffOf = (id: number, signal?: AbortSignal) => apiGet<StaffPayload>(`${WEBSITE}/widgets/${id}/staff`, undefined, signal);
export const assignStaff = (id: number, userId: number, flags: { priority?: boolean; is_active?: boolean }) => apiPost<{ staff: StaffMember[] }>(`${WEBSITE}/widgets/${id}/staff`, { user_id: userId, ...flags });
export const removeStaff = (id: number, userId: number) => apiDelete<{ staff: StaffMember[] }>(`${WEBSITE}/widgets/${id}/staff/${userId}`);

const chats = (n: number) => (n === 1 ? '1 chat' : text('{n} chats', { n }));

/** The NOW column: "Online · 2 chats", "Busy · 3 chats", "Away", "Offline", and its tone. */
export function nowOf(m: Pick<StaffMember, 'status' | 'open_chats'>): { label: string; tone: 'success' | 'warning' | 'muted' } {
  const n = m.open_chats ?? 0;
  const withChats = (word: string) => (n > 0 ? `${word} · ${chats(n)}` : word);
  switch (m.status) {
    case 'available':
      return { label: withChats('Online'), tone: 'success' };
    case 'busy':
      return { label: withChats('Busy'), tone: 'warning' };
    case 'away':
      return { label: withChats('Away'), tone: 'muted' };
    default:
      return { label: 'Offline', tone: 'muted' };
  }
}
