import { PROVIDER_LABEL, type SyncProvider } from '@shared/contact-sync';
import type { ContactType } from '../api';

/**
 * Contacts › Accounts & sync (`/api/contacts/sync/*`, worksuite-desktop#175). Google and Outlook are synced by
 * WorkSuite (OAuth, in the browser); iCloud, CardDAV and Mac Contacts by this computer (`contactSync:*` IPC), which
 * keeps their password in the OS keystore.
 */
export interface SyncSettings {
  default_type: ContactType;
  conflicts: 'recent' | 'review';
  on_local_delete: 'ask' | 'always' | 'never';
  export: 'all' | 'linked';
  interval: number;
}

export interface SyncAccount {
  id: number;
  provider: SyncProvider;
  provider_label: string;
  mode: 'server' | 'device';
  email: string | null;
  label: string | null;
  server_url: string | null;
  device_id: string | null;
  org_id: number | null;
  status: 'new' | 'active' | 'syncing' | 'backoff' | 'error' | 'disconnected';
  error: string | null;
  contact_count: number;
  open_conflicts: number;
  last_synced_at: string | null;
  next_sync_at: string | null;
  backoff_until: string | null;
  settings: SyncSettings;
  created_at: string | null;
}

export interface SyncProviders {
  server: Array<'google' | 'microsoft'>;
  device: Array<'icloud' | 'carddav' | 'macos'>;
  labels: Record<string, string>;
  redirect_uri: string;
  ready: boolean;
}

export interface ContactLink {
  id: number;
  account_id: number;
  provider: SyncProvider;
  provider_label: string;
  email: string | null;
  mine: boolean;
  last_synced_at: string | null;
}

export interface SyncLogRow {
  id: number;
  action: 'created' | 'updated' | 'deleted' | 'archived' | 'linked' | 'unlinked' | 'conflict' | 'pushed' | 'error' | 'sync';
  detail: string | null;
  created_at: string;
  contact_id: number | null;
  contact_name: string | null;
}

export interface SyncConflict {
  id: number;
  account_id: number;
  provider: SyncProvider;
  provider_label: string;
  account_email: string | null;
  contact_id: number;
  contact_name: string | null;
  field: string;
  local_value: string | null;
  remote_value: string | null;
  kept: 'local' | 'remote';
  created_at: string;
}

export interface DuplicateSide {
  id: number;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  type: ContactType;
  company: string | null;
  job_title: string | null;
  department: string | null;
  work_email: string | null;
  personal_email: string | null;
  mobile: string | null;
  office_phone: string | null;
  home_phone: string | null;
  website: string | null;
  birthday: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  customer_id: string | null;
  employee_id: string | null;
  vendor_id: string | null;
  tax_number: string | null;
  notes: string | null;
  extras: { emails?: Array<{ type: string; value: string }>; phones?: Array<{ type: string; value: string }> };
  updated_at: string | null;
  sources: SyncProvider[];
}

export interface DuplicatePair {
  a: DuplicateSide;
  b: DuplicateSide;
  reasons: string[];
}

/** The fields the merge screen offers, in the order it shows them. */
export const MERGE_FIELDS: Array<{ key: keyof DuplicateSide; label: string }> = [
  { key: 'display_name', label: 'Name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'type', label: 'Type' },
  { key: 'company', label: 'Company' },
  { key: 'job_title', label: 'Job title' },
  { key: 'department', label: 'Department' },
  { key: 'work_email', label: 'Work email' },
  { key: 'personal_email', label: 'Personal email' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'office_phone', label: 'Office phone' },
  { key: 'home_phone', label: 'Home phone' },
  { key: 'website', label: 'Website' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'street', label: 'Street' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'customer_id', label: 'Customer ID' },
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'vendor_id', label: 'Vendor ID' },
  { key: 'tax_number', label: 'Tax number' },
  { key: 'notes', label: 'Notes' },
];

/** Which side each field is taken from by default: the kept contact's, unless it is empty and the other's is not. */
export function defaultChoices(keep: DuplicateSide, other: DuplicateSide): Record<string, 'keep' | 'other'> {
  const out: Record<string, 'keep' | 'other'> = {};
  for (const f of MERGE_FIELDS) {
    const k = keep[f.key];
    const o = other[f.key];
    out[f.key] = (k === null || k === undefined || String(k).trim() === '') && o !== null && o !== undefined && String(o).trim() !== '' ? 'other' : 'keep';
  }
  return out;
}

/** Only the fields the two disagree on are worth a choice. */
export function differing(a: DuplicateSide, b: DuplicateSide): Array<(typeof MERGE_FIELDS)[number]> {
  const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
  return MERGE_FIELDS.filter((f) => norm(a[f.key]) !== norm(b[f.key]));
}

export function providerLabel(p: string): string {
  return PROVIDER_LABEL[p as SyncProvider] ?? p;
}

/** "Synced with Google, iCloud". */
export function syncedWith(links: Array<Pick<ContactLink, 'provider'>>): string {
  const names = [...new Set(links.map((l) => providerLabel(l.provider)))];
  return names.length ? `Synced with ${names.join(', ')}` : '';
}

/** "320 found · 210 new · 95 match existing · 15 possible duplicates". */
export function previewLine(p: { found: number; new: number; matched: number; duplicates: number }): string {
  return [`${p.found.toLocaleString()} found`, `${p.new.toLocaleString()} new`, `${p.matched.toLocaleString()} match existing`, `${p.duplicates.toLocaleString()} possible duplicate${p.duplicates === 1 ? '' : 's'}`].join(' · ');
}

/** What an account's status line says. */
export function statusLine(a: Pick<SyncAccount, 'status' | 'error' | 'backoff_until'>): { text: string; tone: 'success' | 'warning' | 'danger' | 'muted' | 'indigo' } {
  switch (a.status) {
    case 'new':
      return { text: 'Waiting for its first sync', tone: 'indigo' };
    case 'syncing':
      return { text: 'Syncing…', tone: 'indigo' };
    case 'backoff':
      return { text: 'Paused: the provider asked to slow down', tone: 'warning' };
    case 'error':
      return { text: a.error ?? 'Sync failed', tone: 'danger' };
    case 'disconnected':
      return { text: 'Disconnected', tone: 'muted' };
    default:
      return { text: 'Up to date', tone: 'success' };
  }
}
