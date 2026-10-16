import { apiDelete, apiGetMeta, apiPost, apiPut } from '../../../core/api';
import { call } from '../../../core/bridge';
import type { ProjectDossierFormat } from '@shared/projects';
import { API } from '../api';

/**
 * A project's client side (server Project module 2.6.0, ClientAccessController): external members — a client's
 * contact, a partner company's engineer, a consultant, none of them staff of the project's company (G-01) — the
 * password-protected status links they follow the project through, the updates written for them, and the whole
 * project's report as PDF or Excel.
 *
 * Reading needs only to reach the project (READ_CACHE answers it offline); every write needs WorkSuite and is
 * disabled offline. External members and links need `can_manage`; client updates `can_post_updates` (the project's
 * manager, a lead, or project.manage). A link's address is answered once, when it is made — only its hash is kept.
 */

export type GuestRole = 'client' | 'collaborator' | 'observer';
export const GUEST_ROLES: GuestRole[] = ['client', 'collaborator', 'observer'];
export const GUEST_ROLE: Record<GuestRole, { label: string; tone: string }> = {
  client: { label: 'Client', tone: 'bg-selection text-primary' },
  collaborator: { label: 'Collaborator', tone: 'bg-success-bg text-success' },
  observer: { label: 'Observer', tone: 'border border-line text-ink-2' },
};

export type LinkSection = 'progress' | 'milestones' | 'timeline' | 'updates' | 'tasks';
export const LINK_SECTIONS: Array<{ key: LinkSection; label: string }> = [
  { key: 'progress', label: 'Progress' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'updates', label: 'Updates' },
  { key: 'tasks', label: 'Tasks' },
];
/** What a new link shows unless changed (the server's own default). */
export const DEFAULT_SECTIONS: LinkSection[] = ['progress', 'milestones', 'timeline', 'updates'];
export const MIN_PASSWORD = 8;

export interface Guest {
  id: number;
  name: string;
  email: string;
  company: string | null;
  role: GuestRole;
  note: string | null;
  user_id: number | null;
  invited_at: string | null;
  removed_at: string | null;
  external: true;
}

export type LinkState = 'active' | 'expired' | 'revoked';
export const LINK_STATE: Record<LinkState, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-success-bg text-success' },
  expired: { label: 'Expired', tone: 'bg-warning-bg text-warning-ink' },
  revoked: { label: 'Withdrawn', tone: 'bg-subtle text-ink-3' },
};

export interface ShareLink {
  id: number;
  label: string;
  token_prefix: string;
  guest_id: number | null;
  guest: { id: number; name: string; email: string } | null;
  sections: string[];
  expires_at: string | null;
  views: number;
  last_viewed_at: string | null;
  created_at: string | null;
  revoked_at: string | null;
  state: LinkState;
}

export interface ClientUpdate {
  id: number;
  title: string;
  body: string | null;
  posted_by: number | null;
  posted_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ClientAccess {
  guests: Guest[];
  links: ShareLink[];
  updates: ClientUpdate[];
  sections: string[];
  can_manage: boolean;
  can_post_updates: boolean;
}

export interface GuestCandidate {
  user_id: number;
  name: string;
  email: string;
  company: string | null;
}

export interface GuestInput {
  name?: string;
  email?: string;
  company?: string;
  role?: GuestRole;
  note?: string;
  user_id?: number;
}

export interface NewLinkInput {
  password: string;
  label?: string;
  guest_id?: number;
  sections: LinkSection[];
  expires_on?: string;
  send_email?: boolean;
}

export interface NewLinkAnswer {
  link: ShareLink;
  url: string;
  emailed: boolean;
  warning: string | null;
}

type Signal = { signal?: AbortSignal };

/** Under qk.all, so the module's one invalidate refreshes it too. */
export const ck = {
  access: (id: number) => ['projects', 'client-access', id] as const,
  candidates: (id: number, q: string) => ['projects', 'guest-candidates', id, q] as const,
};

export const cread = {
  access: (id: number, { signal }: Signal = {}) => apiGetMeta<ClientAccess>(`${API}/${id}/client-access`, undefined, signal),
  /** WorkSuite people NOT at the project's company; the server answers nothing under 2 characters. */
  candidates: (id: number, q: string, { signal }: Signal = {}) => apiGetMeta<{ people: GuestCandidate[] }>(`${API}/${id}/guest-candidates`, { q }, signal),
};

export const cwrite = {
  addGuest: (id: number, body: GuestInput) => apiPost<{ guest: Guest }>(`${API}/${id}/guests`, body),
  updateGuest: (id: number, guestId: number, body: Pick<GuestInput, 'name' | 'company' | 'role' | 'note'>) => apiPut<{ guest: Guest }>(`${API}/${id}/guests/${guestId}`, body),
  removeGuest: (id: number, guestId: number) => apiDelete(`${API}/${id}/guests/${guestId}`),
  createLink: (id: number, body: NewLinkInput) => apiPost<NewLinkAnswer>(`${API}/${id}/share-links`, body),
  /** A new password ends the views open with the old one. */
  updateLink: (id: number, linkId: number, body: { password?: string; label?: string; sections?: LinkSection[]; expires_on?: string }) => apiPut<{ link: ShareLink }>(`${API}/${id}/share-links/${linkId}`, body),
  revokeLink: (id: number, linkId: number) => apiDelete(`${API}/${id}/share-links/${linkId}`),
  postUpdate: (id: number, body: { title: string; body?: string }) => apiPost<{ update: ClientUpdate }>(`${API}/${id}/updates`, body),
  editUpdate: (id: number, updateId: number, body: { title?: string; body?: string }) => apiPut<{ update: ClientUpdate }>(`${API}/${id}/updates/${updateId}`, body),
  deleteUpdate: (id: number, updateId: number) => apiDelete(`${API}/${id}/updates/${updateId}`),
};

/**
 * The whole project's report saved on this computer as the server renders it: through the download manager
 * (`transfers:download` with `projectReport`), like the Reports screen's exports, so it shows in Transfers — and
 * opened once it is there. The main process builds the address from the project and the format.
 */
export function exportProjectReport(p: { project: number; code: string; format: ProjectDossierFormat }) {
  const code = p.code.replace(/[^A-Za-z0-9._-]+/g, '-') || String(p.project);
  return call('transfers:download', { projectReport: { project: p.project, format: p.format }, name: `project-report-${code}.${p.format}`, open: true });
}

const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!#$%*+-=?@';

/** A strong password for a link: 16 characters, every kind, nothing easily misread (no 0/O, 1/l/I). */
export function generatePassword(length = 16): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const pick = (set: string, n: number) => {
    const r = new Uint32Array(n);
    crypto.getRandomValues(r);
    return Array.from(r, (x) => set[x % set.length]!);
  };
  const chars = [...pick(LOWER, 1), ...pick(UPPER, 1), ...pick(DIGITS, 1), ...pick(SYMBOLS, 1), ...pick(all, Math.max(0, length - 4))];
  // Shuffle so the guaranteed kinds are not always first (Fisher–Yates on random words).
  const r = new Uint32Array(chars.length);
  crypto.getRandomValues(r);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = r[i]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
