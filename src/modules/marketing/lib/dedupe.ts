/**
 * The dedupe keys of MKT-AUD-02 / MKT-IMP-02, as the server builds them: the normalised email, then the phone's last
 * nine digits (so `+94 77 123 4521` and `0771234521` are one person), then the name at the organisation. Within one
 * company only; the server decides, this mirrors it for previews and tests. Pure.
 */

export type MatchKey = 'email_key' | 'phone_key' | 'name_org';

/** Trimmed and lower-cased; null when it is not an address (`ravi@@mail`). */
export function emailKey(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(e) ? e : null;
}

/** Digits only, the last nine; null under nine digits. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

const fold = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** "shalini mendis@lanka pack"; null without both a name and an organisation. */
export function nameOrgKey(name: string | null | undefined, organisation: string | null | undefined): string | null {
  const n = fold(name);
  const o = fold(organisation);
  return n && o ? `${n}@${o}` : null;
}

export interface Keyed {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  organisation?: string | null;
}

/** The key two records share, tried in the server's order: email, then phone, then name at organisation. */
export function matchKey(a: Keyed, b: Keyed): MatchKey | null {
  const email = emailKey(a.email);
  if (email && email === emailKey(b.email)) return 'email_key';
  const phone = phoneKey(a.phone);
  if (phone && phone === phoneKey(b.phone)) return 'phone_key';
  const nameOrg = nameOrgKey(a.name, a.organisation);
  if (nameOrg && nameOrg === nameOrgKey(b.name, b.organisation)) return 'name_org';
  return null;
}
