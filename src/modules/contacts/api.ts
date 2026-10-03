import { formatPhone, toE164 } from '../../core/phone';
import { addDays, dateLabel, dayKey, parseTs, timeLabel, todayInZone } from '../../core/time';
import type { ContactLink } from './sync/api';

/**
 * Contacts (`/api/contacts`, `/api/contact-groups`, `/api/data/contacts`).
 * Contacts, groups, notes and activity are each person's own. Stamps are UTC
 * without a zone; a birthday is a date. Labels go up as a comma string and
 * come back as a list; `social` is replaced whole on every save.
 */
export type ContactType = 'personal' | 'employee' | 'customer' | 'vendor' | 'supplier' | 'partner' | 'organization' | 'team' | 'emergency' | 'shared';

export interface Contact {
  id: number;
  user_id: number | null;
  type: ContactType;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department: string | null;
  company: string | null;
  work_email: string | null;
  personal_email: string | null;
  email: string | null;
  mobile: string | null;
  office_phone: string | null;
  phone: string | null;
  avatar_color: string | null;
  labels: string[];
  is_favorite: boolean;
  is_archived: boolean;
  /** Where it is synced: google, microsoft, icloud, carddav, macos (worksuite-desktop#175). */
  sources?: string[];
  updated_at?: string | null;
}

/** Emails, numbers and addresses beyond the columns, from a synced account. */
export interface ContactExtras {
  emails?: Array<{ type: string; value: string }>;
  phones?: Array<{ type: string; value: string }>;
  addresses?: Array<{ type: string; street?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null }>;
  photo_url?: string;
}

export type Social = Partial<Record<(typeof SOCIAL)[number]['key'], string>>;

export interface ContactDetail extends Contact {
  home_phone: string | null;
  website: string | null;
  birthday: string | null;
  gender: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  zip: string | null;
  street: string | null;
  customer_id: string | null;
  employee_id: string | null;
  vendor_id: string | null;
  tax_number: string | null;
  notes: string | null;
  social: Social;
  created_at: string | null;
  groups: Array<{ id: number; name: string; color: string | null }>;
  extras?: ContactExtras;
  links?: ContactLink[];
}

export interface Group {
  id: number;
  name: string;
  color: string | null;
  parent_id: number | null;
  count: number;
}

export interface Stats {
  total: number;
  employees: number;
  customers: number;
  vendors: number;
  favorites: number;
  groups: number;
  birthdays: number;
}

export interface ContactNote {
  id: number;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface Activity {
  id: number;
  type: string;
  title: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface DirectoryPerson {
  id: number;
  name: string;
  email: string | null;
  avatar: string | null;
  phone: string | null;
  is_me: boolean;
  saved: boolean;
}

export const TYPES: Array<{ id: ContactType; label: string; tone: string }> = [
  { id: 'personal', label: 'Personal', tone: 'bg-[#F1F3F8] text-[#3A4158] dark:bg-subtle dark:text-ink-2' },
  { id: 'employee', label: 'Employee', tone: 'bg-[#E6F6EE] text-[#1F7A4D] dark:bg-success-bg dark:text-success' },
  { id: 'customer', label: 'Customer', tone: 'bg-[#FEF3E2] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' },
  { id: 'vendor', label: 'Vendor', tone: 'bg-[#F1EAFB] text-[#5B2FA0] dark:bg-subtle dark:text-[#B69CF0]' },
  { id: 'supplier', label: 'Supplier', tone: 'bg-[#F1EAFB] text-[#5B2FA0] dark:bg-subtle dark:text-[#B69CF0]' },
  { id: 'partner', label: 'Partner', tone: 'bg-[#E1F2F4] text-[#0B6770] dark:bg-subtle dark:text-[#5CC6CF]' },
  { id: 'organization', label: 'Organization', tone: 'bg-selection text-primary' },
  { id: 'team', label: 'Team', tone: 'bg-selection text-primary' },
  { id: 'emergency', label: 'Emergency', tone: 'bg-danger-bg text-danger' },
  { id: 'shared', label: 'Shared', tone: 'bg-[#F1F3F8] text-[#3A4158] dark:bg-subtle dark:text-ink-2' },
];
export const typeOf = (t: string) => TYPES.find((x) => x.id === t) ?? TYPES[0]!;
/** What a card's pill says: a personal contact is just a "Contact". */
export const pillOf = (t: string) => (t === 'personal' ? 'Contact' : typeOf(t).label);

export const SOCIAL = [
  { key: 'linkedin', label: 'LinkedIn', url: (v: string) => (/^https?:/.test(v) ? v : `https://www.linkedin.com/${v.replace(/^\/+/, '')}`) },
  { key: 'facebook', label: 'Facebook', url: (v: string) => (/^https?:/.test(v) ? v : `https://www.facebook.com/${v.replace(/^@/, '')}`) },
  { key: 'instagram', label: 'Instagram', url: (v: string) => (/^https?:/.test(v) ? v : `https://www.instagram.com/${v.replace(/^@/, '')}`) },
  { key: 'x', label: 'X', url: (v: string) => (/^https?:/.test(v) ? v : `https://x.com/${v.replace(/^@/, '')}`) },
  { key: 'github', label: 'GitHub', url: (v: string) => (/^https?:/.test(v) ? v : `https://github.com/${v.replace(/^@/, '')}`) },
  { key: 'youtube', label: 'YouTube', url: (v: string) => (/^https?:/.test(v) ? v : `https://www.youtube.com/${v.startsWith('@') ? v : `@${v}`}`) },
  { key: 'whatsapp', label: 'WhatsApp', url: (v: string) => `https://wa.me/${digits(v)}` },
  { key: 'telegram', label: 'Telegram', url: (v: string) => (/^https?:/.test(v) ? v : `https://t.me/${v.replace(/^@/, '')}`) },
  { key: 'teams', label: 'Teams', url: (v: string) => (/^https?:/.test(v) ? v : `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(v)}`) },
] as const;

export const COUNTRIES = ['Sri Lanka', 'India', 'Maldives', 'Bangladesh', 'Pakistan', 'Nepal', 'Singapore', 'Malaysia', 'Australia', 'New Zealand', 'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Netherlands', 'United States', 'Canada', 'Japan', 'China'];

export const GROUP_COLORS = ['#E0522F', '#B45309', '#0E7C86', '#1F7A4D', '#7C3AED', '#23349E', '#DB2777', '#94A3B8'];

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

/** A number as every screen shows it: `+94 77 123 4567` (#176), or as typed when it cannot be read as one. */
export function phoneLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  return formatPhone(toE164(raw)) || raw;
}

/**
 * "Procurement lead · CreativeFX", or how to reach them when there is neither. Never the name again: an organisation
 * whose company is its own name, or a title that repeats it, says nothing under the name.
 */
export function subLine(c: Pick<Contact, 'job_title' | 'company' | 'email'> & { phone?: string | null; display_name?: string | null }): string {
  const name = (c.display_name ?? '').trim().toLowerCase();
  const parts = [c.job_title, c.company].filter((v): v is string => !!v && v.trim().toLowerCase() !== name);
  return [...new Set(parts)].join(' · ') || c.email || phoneLabel(c.phone) || '—';
}

/** Matches what the server's search looks at, over the rows already here (term lower-cased). */
export function matches(c: Contact, term: string): boolean {
  if (!term) return true;
  return [c.display_name, c.first_name, c.last_name, c.work_email, c.personal_email, c.company, c.job_title, c.mobile, c.office_phone, ...c.labels].some((v) => v && v.toLowerCase().includes(term));
}

export function digits(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

/** "12 Flower Rd, Colombo 07, Western 00700, Sri Lanka". */
export function addressOf(c: Pick<ContactDetail, 'street' | 'city' | 'state' | 'zip' | 'country'>): string {
  return [c.street, c.city, [c.state, c.zip].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ');
}

/** "Today, 9:14 AM", "Yesterday, 3:00 PM", "24 Sep 2026, 4:12 PM". */
export function stampLabel(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '';
  const day = dayKey(d);
  const word = day === todayInZone() ? 'Today' : day === addDays(todayInZone(), -1) ? 'Yesterday' : dateLabel(stamp);
  return `${word}, ${timeLabel(stamp)}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "14 October" (a birthday is a day of the year, not an age). */
export function birthdayOf(ymd: string | null | undefined): string {
  const m = ymd ? /^\d{4}-(\d{2})-(\d{2})/.exec(ymd) : null;
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : '';
}

/** The form's fields, as `PUT /api/contacts/{id}` and `POST /api/contacts` take them. */
export interface ContactForm {
  first_name: string;
  last_name: string;
  display_name: string;
  type: ContactType;
  birthday: string;
  job_title: string;
  department: string;
  company: string;
  work_email: string;
  personal_email: string;
  mobile: string;
  office_phone: string;
  home_phone: string;
  website: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  customer_id: string;
  employee_id: string;
  vendor_id: string;
  tax_number: string;
  labels: string;
  notes: string;
  social: Record<string, string>;
  group_ids: number[];
}

export function formOf(c: ContactDetail | null, defaults: Partial<ContactForm> = {}): ContactForm {
  const s = (v: string | null | undefined) => v ?? '';
  return {
    first_name: s(c?.first_name),
    last_name: s(c?.last_name),
    display_name: c && c.display_name !== [c.first_name, c.last_name].filter(Boolean).join(' ') ? c.display_name : '',
    type: c?.type ?? 'personal',
    birthday: s(c?.birthday).slice(0, 10),
    job_title: s(c?.job_title),
    department: s(c?.department),
    company: s(c?.company),
    work_email: s(c?.work_email),
    personal_email: s(c?.personal_email),
    mobile: s(c?.mobile),
    office_phone: s(c?.office_phone),
    home_phone: s(c?.home_phone),
    website: s(c?.website),
    street: s(c?.street),
    city: s(c?.city),
    state: s(c?.state),
    zip: s(c?.zip),
    country: s(c?.country),
    customer_id: s(c?.customer_id),
    employee_id: s(c?.employee_id),
    vendor_id: s(c?.vendor_id),
    tax_number: s(c?.tax_number),
    labels: (c?.labels ?? []).join(', '),
    notes: s(c?.notes),
    social: Object.fromEntries(SOCIAL.map((x) => [x.key, s(c?.social?.[x.key])])),
    group_ids: (c?.groups ?? []).map((g) => g.id),
    ...defaults,
  };
}

/** What a save sends: the name worked out, labels as a string, social only where filled. */
export function bodyOf(f: ContactForm): Record<string, unknown> {
  const social = Object.fromEntries(Object.entries(f.social).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  const { social: _s, group_ids, ...rest } = f;
  return {
    ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])),
    display_name: f.display_name.trim() || [f.first_name, f.last_name].map((x) => x.trim()).filter(Boolean).join(' '),
    social,
    group_ids,
  };
}
