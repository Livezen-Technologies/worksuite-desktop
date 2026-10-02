import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../core/api';
import type { MeetingPreset } from '../meetings/api';

/**
 * A tender's contact persons (`/api/tenders/{id}/contacts`): the buyer's
 * procurement officer, their technical contact, a supplier's representative —
 * people outside the bid team, kept in Contacts and linked here.
 *
 * A LINK, NOT A COPY. Name, title, organisation, email and phone are the
 * Contacts record's, read afresh every time; only the role on this tender and
 * the Primary Contact flag belong to the link. "Add new contact" makes a real
 * Contacts record, and unlinking leaves it where it is.
 *
 * Seeing the tender shows the list; somebody Contacts does not let read a
 * person's details gets the row and its role only (`restricted`). Being listed
 * gives the person no sight of the tender.
 */

export type Role = 'PROCUREMENT_OFFICER' | 'TECHNICAL_CONTACT' | 'SUPPLIER_REPRESENTATIVE' | 'OTHER';

export const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'PROCUREMENT_OFFICER', label: 'Procurement Officer' },
  { value: 'TECHNICAL_CONTACT', label: 'Technical Contact' },
  { value: 'SUPPLIER_REPRESENTATIVE', label: 'Supplier Representative' },
  { value: 'OTHER', label: 'Other' },
];

export interface PersonDetails {
  id: number;
  display_name: string;
  job_title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  org_id: number | null;
}

export interface ContactPerson {
  id: number;
  contact_id: number;
  role: Role;
  role_other: string | null;
  role_label: string;
  is_primary: boolean;
  /** Deleted in Contacts; listed until somebody unlinks it. */
  missing: boolean;
  /** In Contacts, but not somebody this person may read. */
  restricted: boolean;
  contact: PersonDetails | null;
}

export interface ContactPersons {
  count: number;
  items: ContactPerson[];
  can: { manage: boolean };
}

export interface Candidate extends PersonDetails {
  linked: boolean;
  matched_on?: Array<'email' | 'phone' | 'name_organization'>;
}

export interface NewPerson {
  display_name: string;
  job_title: string;
  company: string;
  email: string;
  phone: string;
}

export interface RoleDraft {
  role: Role | '';
  role_other: string;
}

export const K3 = {
  persons: (id: number) => ['tenders', 'contact-persons', id] as const,
  search: (id: number, q: string) => ['tenders', 'contact-persons', id, 'search', q] as const,
};

const int = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function details(r: Record<string, unknown> | null | undefined): PersonDetails | null {
  if (!r) return null;
  return { id: int(r.id) ?? 0, display_name: String(r.display_name ?? ''), job_title: str(r.job_title), company: str(r.company), email: str(r.email), phone: str(r.phone), org_id: int(r.org_id) };
}

export function toPerson(r: Record<string, unknown>): ContactPerson {
  return {
    id: int(r.id) ?? 0,
    contact_id: int(r.contact_id) ?? 0,
    role: (String(r.role ?? 'OTHER') as Role) || 'OTHER',
    role_other: str(r.role_other),
    role_label: String(r.role_label ?? ''),
    is_primary: !!r.is_primary,
    missing: !!r.missing,
    restricted: !!r.restricted,
    contact: details(r.contact as Record<string, unknown> | null),
  };
}

const toCandidate = (r: Record<string, unknown>): Candidate => ({
  ...details(r)!,
  linked: !!r.linked,
  ...(Array.isArray(r.matched_on) ? { matched_on: r.matched_on as Candidate['matched_on'] } : {}),
});

export async function fetchContactPersons(id: number, signal?: AbortSignal): Promise<ContactPersons> {
  const d = await apiGet<{ count?: number | string; items?: Array<Record<string, unknown>>; can?: { manage?: boolean } }>(`/api/tenders/${id}/contacts`, undefined, signal);
  const items = (d.items ?? []).map(toPerson);
  return { count: int(d.count) ?? items.length, items, can: { manage: !!d.can?.manage } };
}

export const searchContacts = (id: number, q: string, signal?: AbortSignal) => apiGet<Array<Record<string, unknown>>>(`/api/tenders/${id}/contacts/search`, { q }, signal).then((r) => (r ?? []).map(toCandidate));

/** The role as the server takes it; null with the reason when it is not ready to send. */
export function roleBody(d: RoleDraft): { body: { role: Role; role_other?: string } | null; error: string | null } {
  if (!d.role) return { body: null, error: 'Choose their role on this tender.' };
  if (d.role !== 'OTHER') return { body: { role: d.role }, error: null };
  const other = d.role_other.trim();
  if (!other) return { body: null, error: 'Say what their role is.' };
  if (other.length > 120) return { body: null, error: 'Keep the role to 120 characters.' };
  return { body: { role: 'OTHER', role_other: other }, error: null };
}

/** A new person as the server takes it; null with the reason when it is not ready to send. */
export function newPersonBody(p: NewPerson): { body: Record<string, string> | null; error: string | null } {
  const name = p.display_name.trim();
  if (!name) return { body: null, error: 'A name is required.' };
  const email = p.email.trim();
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return { body: null, error: 'That email address does not look right.' };
  const body: Record<string, string> = { display_name: name };
  for (const k of ['job_title', 'company', 'email', 'phone'] as const) if (p[k].trim()) body[k] = p[k].trim();
  return { body, error: null };
}

export const linkContact = (id: number, contactId: number, role: { role: Role; role_other?: string }, primary = false) =>
  apiPost<{ link: Record<string, unknown>; count: number }>(`/api/tenders/${id}/contacts`, { contact_id: contactId, ...role, ...(primary ? { is_primary: true } : {}) });

/**
 * Create the person in Contacts and link them. When they look like somebody already in Contacts the server refuses
 * with the matches (`DuplicateFound`) unless `force` says this is somebody else.
 */
export async function createContactPerson(id: number, person: Record<string, string>, role: { role: Role; role_other?: string }, opts: { force?: boolean; primary?: boolean } = {}) {
  try {
    return await apiPost<{ link: Record<string, unknown>; count: number }>(`/api/tenders/${id}/contacts`, { ...person, ...role, ...(opts.primary ? { is_primary: true } : {}), ...(opts.force ? { force: true } : {}) });
  } catch (e) {
    const found = matchesOf(e);
    if (found) throw new DuplicateFound(found, e instanceof Error ? e.message : '');
    throw e;
  }
}

export class DuplicateFound extends Error {
  constructor(
    readonly matches: Candidate[],
    message: string,
  ) {
    super(message || 'This looks like a contact you already have.');
    this.name = 'DuplicateFound';
  }
}

/** The possible duplicates a 409 carried, or null. */
export function matchesOf(e: unknown): Candidate[] | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !e.data || typeof e.data !== 'object') return null;
  const m = (e.data as { matches?: unknown }).matches;
  return Array.isArray(m) && m.length ? (m as Array<Record<string, unknown>>).map(toCandidate) : null;
}

export const updateContactPerson = (id: number, linkId: number, body: { role?: Role; role_other?: string | null; is_primary?: boolean }) =>
  apiPatch<{ link: Record<string, unknown> }>(`/api/tenders/${id}/contacts/${linkId}`, body);

export const unlinkContactPerson = (id: number, linkId: number) => apiDelete<{ count: number; primary_link_id: number | null }>(`/api/tenders/${id}/contacts/${linkId}`);

// ── what the tab shows ─────────────────────────────────────────────────

/** "Contact Persons · 3", or the bare name while nobody is listed or the count is not known. */
export const tabLabel = (count: number | null | undefined) => (count ? `Contact Persons · ${count}` : 'Contact Persons');

export const MATCHED: Record<string, string> = { email: 'same email', phone: 'same phone', name_organization: 'same name and organization' };

/** Why a suggestion was made: "same email, same phone". */
export const matchedWords = (c: Candidate) => (c.matched_on ?? []).map((m) => MATCHED[m] ?? m).join(', ');

/** A phone number as a tel: link — its digits, and a leading + when it had one. */
export function telUrl(phone: string): string | null {
  const t = phone.trim();
  const digits = t.replace(/\D/g, '');
  return digits.length < 3 ? null : `tel:${t.startsWith('+') ? '+' : ''}${digits}`;
}

/** What scheduling a meeting with a contact person fills in: about this tender, with them invited as an external guest. */
export function meetingPreset(tender: { id: number; title: string; reference?: string | null }, person: PersonDetails): MeetingPreset {
  return {
    title: tender.title,
    type: 'client',
    source_type: 'tender',
    source_id: tender.id,
    label: `Tender · ${tender.reference ? `${tender.reference} · ` : ''}${tender.title}`,
    ...(person.email ? { guests: [person.email] } : {}),
  };
}
