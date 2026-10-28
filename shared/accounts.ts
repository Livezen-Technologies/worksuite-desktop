import { z } from 'zod';
import type { BrowserSignIn, CloudPlan, CloudStatus, IdpHint, ProvisioningStatus, StorageUsage } from './cloud';
import { IDP_HINTS } from './cloud';
import type { ConnectRun } from './discovery';
import type { SetupLinkPayload, TrustedConfig } from './trusted-config';

/**
 * Accounts side by side (Connection & Startup §1): Personal (WorkSuite Cloud) and Enterprise accounts on one
 * computer, each with its own profile directory, Electron partitions, database and secrets. The registry lives in
 * `userData/app.db` (electron/services/accounts/registry.ts); account #1 is the existing `profiles/default`,
 * migrated in place.
 *
 * This file is the IPC contract for accounts, connect, browser sign-in and Cloud: the types, the zod inputs
 * (`accountsContract`, spread into shared/ipc/contract.ts) and the answers (`AccountsOutputs`). The channel names
 * are in shared/ipc/accounts-channels.ts.
 */

export type AccountKind = 'personal' | 'enterprise';
export const ACCOUNT_ID = /^acc_[a-z0-9]{20}$/;

export interface AccountRecord {
  id: string;
  kind: AccountKind;
  /** The address people typed or IT configured. */
  serverOrigin: string;
  /** Where the API is (`endpoints.api`'s origin); the same as `serverOrigin` for Core. */
  apiOrigin: string;
  serverId: string | null;
  serverName: string;
  deployment: 'CLOUD' | 'ENTERPRISE' | 'LEGACY';
  organizationId: string | null;
  organizationName: string | null;
  user: { id: string; name: string; email: string; avatar: string | null } | null;
  branding: { logo: string | null; accent: string | null; initials: string };
  /** Hosts whose links belong to this account (deep-link routing). */
  linkHosts: string[];
  /** `default` for account #1, else the account id: `profiles/<profileDir>/`. */
  profileDir: string;
  /** '' (defaultSession) for account #1, else `persist:acct-<id>`. */
  partition: string;
  /** Configured by IT: cannot be removed. */
  managed: boolean;
  trust: TrustedConfig | null;
  signInState: 'signed-in' | 'signed-out' | 'expired' | 'revoked';
  addedAt: string;
  lastUsedAt: string | null;
  discoveredAt: string | null;
  /** The discovery document was signed and verified. */
  signed: boolean;
}

/** An account as the renderer sees it: no paths, no partitions, no trust material. */
export interface AccountView extends Omit<AccountRecord, 'trust' | 'profileDir' | 'partition'> {
  active: boolean;
  /** The "3 new" badge, from the background poller. */
  unread: number;
  pendingChanges: number;
  reachability: 'online' | 'offline' | 'unknown';
  removable: boolean;
  /** "Removal set by IT policy". */
  removalReason: string | null;
  /** "Blocked by your organization" (a personal account under `allowPersonal:false`, a server under `lockServer`). */
  blockedReason: string | null;
  /** "Sync paused while another account is open". */
  syncPaused: boolean;
}

export interface AccountsState {
  accounts: AccountView[];
  activeId: string | null;
  /** The account being opened (the "Opening Livezen Technologies…" overlay). */
  switching: string | null;
  /** The workspace chooser (screen 11) is due at startup. */
  chooserPending: boolean;
  chooserAlways: boolean;
  allowPersonal: boolean;
  allowAddEnterprise: boolean;
  guestAvailable: boolean;
  /**
   * A `worksuite://setup` link that arrived (§4 step 5) and waits for the person: the window opens Add Account ›
   * Enterprise with it filled in, and it still takes a click on Continue. Cleared when an account is added or Add
   * Account is cancelled. Absent from desktops before it.
   */
  pendingSetup?: string | null;
}

/** One thing not yet on the server, listed on screen 14. */
export interface UnsyncedItem {
  id: string;
  source: 'queue' | 'office' | 'upload' | 'projects' | 'desk';
  module: string;
  label: string;
  at: string;
  count?: number;
  /** Why the last try to send it failed ("The copy on this computer was moved or deleted."), when it did. */
  error?: string | null;
  /** It can be discarded from the sign-out list (Discard this change); a desk outbox is reviewed in its own app. */
  discardable?: boolean;
}

export interface UnsyncedSummary {
  accountId: string;
  items: UnsyncedItem[];
  offlineFiles: { count: number; bytes: number };
  cachedBytes: number;
}

export type HealthState = 'healthy' | 'degraded' | 'down' | 'unknown';
export type HealthComponent = 'api' | 'auth' | 'realtime' | 'files' | 'office' | 'sync';

/** Settings › Accounts & Servers › Connection health (screen 15). */
export interface ConnectionHealth {
  accountId: string;
  checkedAt: string;
  components: Record<HealthComponent, { state: HealthState; detail: string }>;
}

/** The service banner (screen 16), on `StatusSnapshot.service`. */
export interface ServiceHealthState {
  state: 'ok' | 'degraded' | 'unavailable' | 'unreachable' | 'offline';
  label: string;
  since: string | null;
  nextRetryAt: string | null;
  workOffline: boolean;
}

/** Where a link goes: the active account, another known one, or a server not added (screen 16). */
export type LinkRoute = { kind: 'active' } | { kind: 'account'; accountId: string } | { kind: 'unknown'; host: string; label: string | null };

/** `accounts:unknownLink`: a link to a server that is not added. Nothing was fetched from it. */
export interface UnknownLink {
  url: string;
  host: string;
  /** What the link points at, when the link itself says ("Tender #123"). */
  label: string | null;
}

/** The renderer's "add account" flow (screens 1, 2, 6). */
export interface AddingAccount {
  step: 'choose' | 'personal' | 'enterprise';
  /** An address or setup link to start from (a `worksuite://setup` link, a managed server). */
  prefill?: string;
}

// ── IPC inputs ─────────────────────────────────────────────────────────────

const none = z.undefined().or(z.null()).optional();
const accountId = z.string().regex(ACCOUNT_ID);
const runId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const attemptId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const accountKind = z.enum(['personal', 'enterprise']);
const idpHint = z.enum(IDP_HINTS as [IdpHint, ...IdpHint[]]);

export const accountsContract = {
  'accounts:state': { input: none, whileLocked: true },
  'accounts:switch': { input: z.strictObject({ accountId }), sensitive: true, rate: 2 },
  /** null: guest mode. */
  'accounts:startupChoice': { input: z.strictObject({ accountId: accountId.nullable() }) },
  'accounts:setChooser': { input: z.strictObject({ always: z.boolean() }) },
  'accounts:unsynced': { input: z.strictObject({ accountId }) },
  'accounts:syncNow': { input: z.strictObject({ accountId }) },
  'accounts:exportUnsynced': { input: z.strictObject({ accountId }), sensitive: true },
  'accounts:discardUnsynced': { input: z.strictObject({ accountId, itemId: z.string().min(1).max(200) }), sensitive: true },
  'accounts:signOut': {
    input: z.strictObject({ accountId, removeCachedData: z.boolean(), keepOfflineFiles: z.boolean(), discardUnsynced: z.boolean() }),
    sensitive: true,
    whileLocked: true,
  },
  'accounts:remove': { input: z.strictObject({ accountId, keepOfflineFiles: z.boolean() }), sensitive: true },
  'accounts:health': { input: z.strictObject({ accountId: accountId.optional() }).nullish() },
  'accounts:rediscover': { input: z.strictObject({ accountId }), rate: 1 },
  'accounts:addStart': { input: z.strictObject({ kind: accountKind.optional() }).nullish() },
  'accounts:addCancel': { input: none },
  'connect:start': { input: z.strictObject({ input: z.string().min(1).max(2048), target: accountKind }), rate: 2 },
  'connect:get': { input: z.strictObject({ runId }) },
  'connect:cancel': { input: z.strictObject({ runId }) },
  'connect:confirm': { input: z.strictObject({ runId }), sensitive: true },
  'connect:parseSetup': { input: z.strictObject({ link: z.string().min(1).max(8192) }) },
  'connect:copyDetails': { input: z.strictObject({ runId }) },
  'signin:start': {
    input: z.strictObject({
      accountId,
      method: idpHint.nullable(),
      purpose: z.enum(['sign-in', 'sign-up', 'reauth']),
      loginHint: z.string().max(320).optional(),
    }),
    rate: 2,
  },
  'signin:reopen': { input: z.strictObject({ attemptId }) },
  'signin:copyLink': { input: z.strictObject({ attemptId }) },
  'signin:cancel': { input: z.strictObject({ attemptId }) },
  /* Creating an account inside the app (ENH-AUTH-01 §4); only when the server publishes signup.mode = in_app. */
  'signup:start': {
    input: z.strictObject({
      accountId,
      firstName: z.string().trim().min(1).max(60),
      lastName: z.string().trim().min(1).max(60),
      email: z.string().trim().max(320),
      password: z.string().max(256),
      country: z.string().trim().length(2),
      timezone: z.string().max(64).optional(),
    }),
    rate: 2,
  },
  'signup:resend': { input: z.strictObject({ accountId }), rate: 1 },
  'signup:verify': { input: z.strictObject({ accountId, code: z.string().trim().max(12) }), rate: 4 },
  'signup:cancel': { input: none },
  'cloud:status': { input: none },
  'cloud:refresh': { input: none, rate: 2 },
  'cloud:resendVerification': { input: none, rate: 1 },
  'cloud:retryProvisioning': { input: none, rate: 1 },
  'cloud:storage': { input: none, session: true },
  'cloud:plans': { input: none },
  'cloud:openWeb': { input: z.strictObject({ page: z.enum(['storage', 'upgrade', 'privacy', 'support', 'verify', 'forgot']) }) },
};

export interface AccountsOutputs {
  'accounts:state': AccountsState;
  'accounts:switch': { switched: true; ms: number };
  'accounts:startupChoice': AccountsState;
  'accounts:setChooser': AccountsState;
  'accounts:unsynced': UnsyncedSummary;
  'accounts:syncNow': UnsyncedSummary;
  /** The zip's path, or null when the save dialog was cancelled. */
  'accounts:exportUnsynced': { path: string | null };
  /** The list again, without the change discarded. */
  'accounts:discardUnsynced': UnsyncedSummary;
  'accounts:signOut': AccountsState;
  'accounts:remove': AccountsState;
  'accounts:health': ConnectionHealth;
  'accounts:rediscover': ConnectRun;
  'accounts:addStart': void;
  'accounts:addCancel': void;
  'connect:start': { runId: string };
  'connect:get': ConnectRun;
  'connect:cancel': void;
  /** The new account, activated and signed out. */
  'connect:confirm': AccountView;
  'connect:parseSetup': { payload: SetupLinkPayload };
  'connect:copyDetails': boolean;
  'signin:start': BrowserSignIn;
  'signin:reopen': boolean;
  'signin:copyLink': { url: string };
  'signin:cancel': void;
  /** The address the code went to, and how long the sign-up stays open (seconds). */
  'signup:start': { email: string; expiresIn: number };
  'signup:resend': { email: string };
  'signup:verify': { done: true };
  'signup:cancel': void;
  'cloud:status': CloudStatus;
  'cloud:refresh': CloudStatus;
  /** When Resend may be pressed again (epoch ms). */
  'cloud:resendVerification': { nextAt: number };
  'cloud:retryProvisioning': ProvisioningStatus;
  'cloud:storage': StorageUsage;
  'cloud:plans': CloudPlan[];
  'cloud:openWeb': boolean;
}

/** What each event carries. */
export interface AccountsEvents {
  'accounts:changed': AccountsState;
  'accounts:unknownLink': UnknownLink;
  'connect:progress': ConnectRun;
  'signin:changed': BrowserSignIn | null;
  'cloud:changed': CloudStatus;
}
