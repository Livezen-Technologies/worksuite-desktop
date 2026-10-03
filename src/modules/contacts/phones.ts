import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { toE164 } from '../../core/phone';
import type { ContactType } from './api';

/**
 * phone → contact, kept on this computer (worksuite-desktop#176): every contact this person may see that has a number,
 * from `/api/contacts/phone-index`, indexed by E.164 so naming a number is a map lookup. Under `['contacts', …]`, so
 * every save, merge or delete in Contacts — which invalidates `['contacts']` — re-reads it and the names in WhatsApp
 * (and later Calls and SMS) follow without a reload.
 */
export interface PhoneContact {
  id: number;
  name: string;
  company: string | null;
  job_title?: string | null;
  type: ContactType | string;
  avatar: string | null;
  avatar_color: string | null;
  is_favorite: boolean;
  updated_at: string | null;
  org_id?: number | null;
  phones: string[];
  /** The number in the contact's WhatsApp field, when there is one: the strongest claim on it. */
  whatsapp: string | null;
}

export type PhoneIndex = ReadonlyMap<string, PhoneContact[]>;

export const PHONE_INDEX_KEY = ['contacts', 'phone-index'] as const;

/**
 * Who has each number, best first: the contact whose WhatsApp field holds it, then a favourite, then the most recently
 * changed, then the oldest (so the order never flickers).
 */
export function rankFor(e164: string, list: PhoneContact[]): PhoneContact[] {
  return [...list].sort(
    (a, b) =>
      Number(b.whatsapp === e164) - Number(a.whatsapp === e164) ||
      Number(b.is_favorite) - Number(a.is_favorite) ||
      (b.updated_at ?? '').localeCompare(a.updated_at ?? '') ||
      a.id - b.id,
  );
}

export function buildPhoneIndex(contacts: PhoneContact[]): PhoneIndex {
  const by = new Map<string, PhoneContact[]>();
  for (const c of contacts) {
    for (const p of new Set(c.phones)) {
      const e = toE164(p) ?? p;
      by.set(e, [...(by.get(e) ?? []), c]);
    }
  }
  for (const [e, list] of by) by.set(e, rankFor(e, list));
  return by;
}

/** The contacts with this number (any way it is written), best first. */
export function contactsFor(index: PhoneIndex | undefined, number: string | null | undefined): PhoneContact[] {
  if (!index || !number) return [];
  const e = number.startsWith('+') ? number : toE164(number);
  return e ? (index.get(e) ?? []) : [];
}

const refused = (e: unknown) => e instanceof ApiError && (e.forbidden || e.status === 404);

/** The index, for whoever may open Contacts' numbers; a server without the endpoint yet is no index, not an error. */
export function usePhoneIndex(enabled = true) {
  return useQuery({
    queryKey: PHONE_INDEX_KEY,
    queryFn: ({ signal }) => apiGet<{ region: string; contacts: PhoneContact[] }>('/api/contacts/phone-index', undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    retry: (n, e) => !refused(e) && n < 2,
    select: (d) => buildPhoneIndex(d.contacts),
  });
}

/** Add a number to a contact that already exists ("Link to existing contact"). */
export function addPhoneToContact(contactId: number, phone: string, field?: 'whatsapp' | 'mobile' | 'office_phone' | 'home_phone') {
  return apiPost<{ id: number; field: string; e164: string }>(`/api/contacts/${contactId}/phones`, { phone, source: 'whatsapp', ...(field ? { field } : {}) });
}
