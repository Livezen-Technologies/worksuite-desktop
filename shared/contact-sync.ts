/**
 * Contact sync on this computer (worksuite-desktop#175): the iCloud, CardDAV and Mac Contacts accounts whose
 * password or data never leave it, and what crosses IPC for them (the typed contract's `contactSync:*` part, spread
 * into shared/ipc/contract.ts).
 *
 * Google and Outlook are synced by WorkSuite itself (OAuth, tokens in the server's vault). iCloud and other CardDAV
 * servers need a password — Apple's app-specific password — which is kept only in the OS keystore here (Keychain on
 * a Mac, through Electron's safeStorage) and used only by the main process; the Mac's own Contacts are read on the
 * Mac. The main process reads each book's changes, relays them to WorkSuite (`/api/contacts/sync/accounts/{id}/ingest`),
 * sends back what WorkSuite asks for, and confirms (`/ack`). The rules — matching, conflicts, deletions — are the
 * server's, the same for every provider.
 */
import { z } from 'zod';

export const DEVICE_PROVIDERS = ['icloud', 'carddav', 'macos'] as const;
export type DeviceProvider = (typeof DEVICE_PROVIDERS)[number];
export type SyncProvider = 'google' | 'microsoft' | DeviceProvider;

export const PROVIDER_LABEL: Record<SyncProvider, string> = {
  google: 'Google',
  microsoft: 'Outlook',
  icloud: 'iCloud',
  carddav: 'CardDAV',
  macos: 'Mac Contacts',
};

export const ICLOUD_CARDDAV = 'https://contacts.icloud.com';

/** The neutral person every provider maps to and from (the server's `FieldMap` card). */
export interface Card {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  company?: string | null;
  job_title?: string | null;
  department?: string | null;
  emails?: Array<{ type: string; value: string }>;
  phones?: Array<{ type: string; value: string }>;
  addresses?: Array<{ type: string; street?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null }>;
  /** `YYYY-MM-DD`, or `--MM-DD` without a year. */
  birthday?: string | null;
  notes?: string | null;
  website?: string | null;
  photo_url?: string | null;
  groups?: string[];
  updated_at?: string | null;
}

/** One provider record as WorkSuite's ingest takes it. */
export interface SyncRecord {
  id: string;
  etag: string | null;
  card: Card;
  raw?: string;
  updated_at?: string | null;
}

/** What WorkSuite asks this computer to do in the provider. */
export interface OutboundOp {
  op: 'create' | 'update' | 'delete';
  link_id: number | null;
  contact_id: number | null;
  external_id: string | null;
  etag: string | null;
  card: Card | null;
  raw: string | null;
}

export interface SyncCounts {
  found: number;
  new: number;
  matched: number;
  duplicates: number;
  updated: number;
  conflicts: number;
  deleted: number;
  archived: number;
  pushed_new: number;
  pushed_updates: number;
  pushed_deletes: number;
  errors: number;
  [k: string]: number;
}

/** "320 found · 210 new · 95 match existing · 15 possible duplicates", before anything is written. */
export interface SyncPreview {
  found: number;
  new: number;
  matched: number;
  duplicates: number;
  to_provider: number;
}

/** Whether the Mac's own Contacts can be read here, and why not. */
export interface MacContactsStatus {
  platform: boolean;
  /** The native Contacts bridge is present in this build. */
  native: boolean;
  permission: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unavailable';
  reason: string | null;
}

export interface DeviceAccountState {
  accountId: number;
  hasSecret: boolean;
  running: boolean;
  lastRun: string | null;
  lastError: string | null;
}

export interface ContactSyncStatus {
  /** The keystore persists secrets (false on Linux without a keyring: the password lasts until the app quits). */
  persistent: boolean;
  accounts: DeviceAccountState[];
  mac: MacContactsStatus;
}

const accountId = z.number().int().positive().max(2 ** 31);
const none = z.undefined().or(z.null()).optional();

export const connectSchema = z.strictObject({
  provider: z.enum(DEVICE_PROVIDERS),
  /** CardDAV only: the server's address (https). iCloud is always contacts.icloud.com. */
  serverUrl: z.string().trim().url().max(255).optional(),
  username: z.string().trim().min(1).max(191).optional(),
  /** The app-specific password: kept in the keystore, never sent to WorkSuite. */
  password: z.string().min(1).max(256).optional(),
  orgId: z.number().int().positive().nullable().optional(),
  settings: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type ConnectInput = z.infer<typeof connectSchema>;

export const contactSyncContract = {
  'contactSync:status': { input: none, session: true },
  'contactSync:connect': { input: connectSchema, session: true, rate: 4, sensitive: true },
  'contactSync:run': { input: z.strictObject({ accountId, preview: z.boolean().optional() }), session: true, rate: 6 },
  'contactSync:setPassword': { input: z.strictObject({ accountId, password: z.string().min(1).max(256) }), session: true, rate: 4, sensitive: true },
  'contactSync:forget': { input: z.strictObject({ accountId }), session: true, rate: 6, sensitive: true },
  'contactSync:macAccess': { input: none, session: true, rate: 2 },
};

export interface ContactSyncOutputs {
  'contactSync:status': ContactSyncStatus;
  'contactSync:connect': { accountId: number };
  'contactSync:run': { preview: SyncPreview | null; counts: SyncCounts | null };
  'contactSync:setPassword': void;
  'contactSync:forget': void;
  'contactSync:macAccess': MacContactsStatus;
}
