import type { AccountKind, AccountRecord, AccountsState, AccountView, ConnectionHealth, UnsyncedSummary } from '@shared/accounts';
import type { DiscoveredServer } from '@shared/discovery';
import type { TrustedConfig } from '@shared/trusted-config';
import type { AuthState, ServerInfo } from '@shared/types';
import { DesktopError } from '../../main/errors';
import type { IpcRouter } from '../../ipc/router';
import type { BackgroundAccounts } from './background';
import { DEFAULT_PROFILE_DIR, partitionsFor } from './profile';
import type { AccountRegistry } from './registry';
import { hostOf, kindForOrigin, newAccountId } from './registry';
import type { AccountSwitcher } from './switcher';

/**
 * The accounts channels (`accounts:*` but `accounts:rediscover`, which is discovery's) and what the rest of the app
 * asks of the accounts: the state the switcher, chooser and Settings › Accounts & Servers show, opening, signing out
 * and removing an account, and creating one from a connect run (`connect:confirm`). [WP1]
 */

export const REMOVAL_BY_POLICY = 'Removal set by IT policy';
export const BLOCKED_BY_ORG = 'Blocked by your organization';

export interface AccountsHost {
  registry: AccountRegistry;
  switcher: AccountSwitcher<unknown>;
  background: BackgroundAccounts;
  trusted: () => TrustedConfig;
  session: {
    get: () => AuthState;
    signOut: (wipe: boolean, message: string | null, opts: { discardUnsynced?: boolean }) => Promise<AuthState>;
    setServer: (input: string) => Promise<AuthState>;
    forgetServer: () => AuthState;
  };
  /** The open account's summary is live; another's is read from its own database. */
  unsynced: (account: AccountRecord) => UnsyncedSummary;
  /** Replays the open account's queue and outboxes now. */
  syncNow: () => Promise<void>;
  /** Asks where to save, and writes the zip. */
  exportUnsynced: (account: AccountRecord) => Promise<{ path: string | null }>;
  /** Discard this change: one item of the open account's list, by its id ("office:…", "queue:…", "upload:…"). */
  discardUnsynced?: (itemId: string) => Promise<void>;
  /** Another account's sign-out: its refresh token revoked at its server and deleted from its secrets. */
  signOutOther: (account: AccountRecord) => Promise<void>;
  remove: (account: AccountRecord, keepOfflineFiles: boolean) => Promise<void>;
  /** The open account's server answers (`online`), or not; others are `unknown`. */
  reachable: () => boolean;
  health: (accountId: string) => Promise<ConnectionHealth>;
  /** Writes `server` into the account's database (a new account, before it opens). */
  seedServer: (account: AccountRecord, server: ServerInfo) => void;
  /** Discovery for a legacy `auth:setServer` (WP2), or null when it is not available in this build. */
  discover: (input: string, target: AccountKind) => Promise<DiscoveredServer | null>;
  /** The legacy probe (`probeServer`), for servers and builds without discovery. */
  probe: (input: string) => Promise<ServerInfo>;
  emit: (state: AccountsState) => void;
  showMain: () => void;
  /**
   * A connect run's network partition (`partitionFor`) is queued for removal at the next start as soon as it is
   * handed out (crash-safe: a run never confirmed, cancelled or failed leaves nothing behind), and taken off that
   * queue when the account it was reserved for keeps it (`adoptPartition`).
   */
  reservePartition?: (partition: string) => void;
  adoptPartition?: (partition: string) => void;
}

/** A server record for the account's database (what AuthService and the session read). */
export function serverInfoOf(account: AccountRecord, base?: Partial<ServerInfo>): ServerInfo {
  return {
    origin: account.apiOrigin || account.serverOrigin,
    name: account.serverName,
    api: base?.api ?? 'core',
    minimumVersion: base?.minimumVersion ?? null,
    passkey: base?.passkey ?? null,
    locked: account.managed,
    linkHosts: account.linkHosts,
    accountId: account.id,
    deployment: account.deployment,
    ...(base?.endpoints ? { endpoints: base.endpoints } : {}),
    ...(base?.authMode ? { authMode: base.authMode } : {}),
    ...(base?.browserSignIn !== undefined ? { browserSignIn: base.browserSignIn } : {}),
  };
}

/** A legacy probe's answer as a connect run's server. */
export function discoveredFromProbe(info: ServerInfo): DiscoveredServer {
  const host = hostOf(info.origin);
  return {
    origin: info.origin,
    apiOrigin: info.origin,
    serverId: null,
    name: info.name,
    deployment: 'LEGACY',
    schema: info.api === 'desktop-v1' ? 'legacy-desktop' : 'legacy-core',
    signed: false,
    authMode: 'legacy',
    signup: false,
    oidc: null,
    browserSignIn: null,
    passkey: info.passkey ?? null,
    branding: { logo: null, accent: null },
    endpoints: { realtime: null, files: null, office: null, ai: null, health: null },
    linkHosts: host ? [host] : [],
    minimumVersion: info.minimumVersion,
    serverVersion: null,
    plans: null,
    discoveryKey: null,
    trustSource: null,
  };
}

export class AccountsService {
  private pendingByAccount = new Map<string, number>();
  /** The id a connect run's partition was made for (`partitionFor`), taken by the account it confirms. */
  private reserved: { target: AccountKind; id: string } | null = null;
  private chooserDone = false;
  /** A setup link waiting for Add Account › Enterprise (`AccountsState.pendingSetup`). */
  private pendingSetup: string | null = null;

  constructor(private readonly h: AccountsHost) {}

  // ── the state ──────────────────────────────────────────────────────────

  blockedReason(a: AccountRecord, t: TrustedConfig = this.h.trusted()): string | null {
    if (a.kind === 'personal' && !t.allowPersonal) return BLOCKED_BY_ORG;
    if (a.kind === 'enterprise' && t.lockServer && !a.managed) return BLOCKED_BY_ORG;
    return null;
  }

  /** "N pending changes kept" for an account not open now, remembered when it was put in the background. */
  rememberPending(id: string, n: number): void {
    this.pendingByAccount.set(id, n);
  }

  view(a: AccountRecord, activeId: string | null, t: TrustedConfig = this.h.trusted()): AccountView {
    const { trust: _trust, profileDir: _dir, partition: _partition, ...rest } = a;
    const active = a.id === activeId;
    let pendingChanges = this.pendingByAccount.get(a.id) ?? 0;
    if (active) {
      try {
        pendingChanges = this.h.unsynced(a).items.reduce((n, i) => n + (i.count ?? 1), 0);
      } catch {
        /* the count is a convenience */
      }
    }
    return {
      ...rest,
      active,
      unread: active ? 0 : this.h.background.unread(a.id),
      pendingChanges,
      reachability: active ? (this.h.reachable() ? 'online' : 'offline') : 'unknown',
      removable: !a.managed,
      removalReason: a.managed ? REMOVAL_BY_POLICY : null,
      blockedReason: this.blockedReason(a, t),
      syncPaused: !active && a.signInState === 'signed-in',
    };
  }

  /** The workspace chooser at start (screen 11): two accounts or more, and "always", or the last one cannot open. */
  private chooserPending(list: AccountRecord[], active: AccountRecord | null): boolean {
    if (this.chooserDone || list.length < 2) return false;
    if (this.h.registry.chooserAlways()) return true;
    return !active || active.signInState !== 'signed-in' || !!this.blockedReason(active);
  }

  state(): AccountsState {
    const t = this.h.trusted();
    const list = this.h.registry.list();
    const activeId = this.h.registry.activeId();
    const active = list.find((a) => a.id === activeId) ?? null;
    return {
      accounts: list.map((a) => this.view(a, activeId, t)),
      activeId,
      switching: this.h.switcher.switching(),
      chooserPending: this.chooserPending(list, active),
      chooserAlways: this.h.registry.chooserAlways(),
      allowPersonal: t.allowPersonal,
      allowAddEnterprise: !t.lockServer,
      guestAvailable: true,
      pendingSetup: this.pendingSetup,
    };
  }

  emit(): AccountsState {
    const s = this.state();
    this.h.emit(s);
    return s;
  }

  private need(id: string): AccountRecord {
    const a = this.h.registry.get(id);
    if (!a) throw new DesktopError('NOT_FOUND', 'That account is no longer on this computer.');
    return a;
  }

  // ── opening ────────────────────────────────────────────────────────────

  async switchTo(id: string): Promise<{ switched: true; ms: number }> {
    const a = this.need(id);
    const why = this.blockedReason(a);
    if (why) throw new DesktopError('POLICY_DENIED', `${a.serverName}: ${why.toLowerCase()}.`);
    this.chooserDone = true;
    try {
      return await this.h.switcher.switchTo(id);
    } finally {
      this.emit();
    }
  }

  async startupChoice(id: string | null): Promise<AccountsState> {
    this.chooserDone = true;
    if (id && id !== this.h.registry.activeId()) await this.switchTo(id);
    return this.emit();
  }

  setChooser(always: boolean): AccountsState {
    this.h.registry.setChooserAlways(always);
    return this.emit();
  }

  // ── unsynced, sign-out, removal ────────────────────────────────────────

  unsynced(id: string): UnsyncedSummary {
    return this.h.unsynced(this.need(id));
  }

  async syncNow(id: string): Promise<UnsyncedSummary> {
    const a = this.need(id);
    if (a.id === this.h.registry.activeId()) await this.h.syncNow();
    return this.h.unsynced(a);
  }

  exportUnsynced(id: string): Promise<{ path: string | null }> {
    return this.h.exportUnsynced(this.need(id));
  }

  /** Discard this change (the person confirmed): only the open account's, whose services hold the item. */
  async discardUnsynced(id: string, itemId: string): Promise<UnsyncedSummary> {
    const a = this.need(id);
    if (a.id !== this.h.registry.activeId() || !this.h.discardUnsynced) throw new DesktopError('UNSUPPORTED', 'Switch to this account to discard its changes.');
    await this.h.discardUnsynced(itemId);
    return this.h.unsynced(a);
  }

  async signOut(input: { accountId: string; removeCachedData: boolean; keepOfflineFiles: boolean; discardUnsynced: boolean }): Promise<AccountsState> {
    const a = this.need(input.accountId);
    if (a.id === this.h.registry.activeId()) {
      const before = this.h.unsynced(a);
      await this.h.session.signOut(!input.keepOfflineFiles, null, { discardUnsynced: input.discardUnsynced });
      const kept = input.discardUnsynced ? 0 : before.items.reduce((n, i) => n + (i.count ?? 1), 0);
      this.rememberPending(a.id, kept);
    } else {
      await this.h.signOutOther(a);
    }
    this.h.background.release(a.id).catch(() => undefined);
    this.h.registry.update(a.id, { signInState: 'signed-out' });
    return this.emit();
  }

  async remove(input: { accountId: string; keepOfflineFiles: boolean }): Promise<AccountsState> {
    const a = this.need(input.accountId);
    if (a.managed) throw new DesktopError('POLICY_DENIED', `${REMOVAL_BY_POLICY}.`);
    await this.h.background.release(a.id);
    await this.h.remove(a, input.keepOfflineFiles);
    this.pendingByAccount.delete(a.id);
    return this.emit();
  }

  health(id: string | undefined): Promise<ConnectionHealth> {
    const accountId = id ?? this.h.registry.activeId();
    if (!accountId) throw new DesktopError('NOT_FOUND', 'No account is open.');
    this.need(accountId);
    return this.h.health(accountId);
  }

  // ── adding ─────────────────────────────────────────────────────────────

  addStart(kind: AccountKind | undefined): void {
    const t = this.h.trusted();
    if (kind === 'personal' && !t.allowPersonal) throw new DesktopError('PERSONAL_NOT_ALLOWED', 'Your organization does not allow personal accounts on this computer.');
    if (kind === 'enterprise' && t.lockServer) throw new DesktopError('POLICY_DENIED', 'Your organization manages the server this computer connects to.');
    this.h.showMain();
  }

  /**
   * A `worksuite://setup` link arrived (§4 step 5): it waits in the state for the window, which opens Add Account ›
   * Enterprise with it filled in. Nothing connects until the person clicks Continue. False, and nothing kept, when the
   * organization manages the server (no other enterprise server may be added) or the link is not one.
   */
  setupLink(link: string): boolean {
    const v = link.trim();
    if (!/^worksuite:\/\/setup\?/i.test(v) || v.length > 8192) return false;
    if (this.h.trusted().lockServer) return false;
    this.pendingSetup = v;
    this.h.showMain();
    this.emit();
    return true;
  }

  /** Add Account cancelled (`accounts:addCancel`): a waiting setup link is let go. */
  addCancel(): void {
    if (this.pendingSetup === null) return;
    this.pendingSetup = null;
    this.emit();
  }

  /** A fresh network partition for a connect run: `persist:acct-<id>-net`, the id kept for the account it makes. */
  partitionFor(target: AccountKind): string {
    this.reserved = { target, id: newAccountId() };
    const partition = partitionsFor({ id: this.reserved.id, partition: `persist:acct-${this.reserved.id}` }).net;
    this.h.reservePartition?.(partition);
    return partition;
  }

  /** The account already added for this server and organization, by origin or server id (`ACCOUNT_EXISTS`). */
  existing(server: Pick<DiscoveredServer, 'origin' | 'serverId'>): string | null {
    return this.h.registry.findServer({ origin: server.origin, serverId: server.serverId })?.id ?? null;
  }

  /**
   * A successful connect run becomes an account (`connect:confirm`), opened signed out. The first account on a
   * computer takes `profiles/default` and the default session, so it opens in the window already showing.
   *
   * Partitions: the account takes the id its run's partition was reserved under. A later account keeps that
   * partition as its own network partition (`persist:acct-<id>-net`, taken off the removal queue). The first account
   * (`profiles/default`) uses account #1's partitions (`''`, `persist:ws-net`, `persist:ws-bulk`) — the record's
   * `partition: ''` is what `partitionsFor` reads, so record and partitions agree — and the reserved run partition
   * stays queued, so its folder goes at the next start instead of being stranded.
   */
  async createAccount(server: DiscoveredServer, target: AccountKind, trust: TrustedConfig | null, base?: Partial<ServerInfo>): Promise<AccountView> {
    const t = this.h.trusted();
    const kind: AccountKind = server.deployment === 'CLOUD' ? 'personal' : target === 'personal' && server.deployment !== 'ENTERPRISE' ? kindForOrigin(server.origin) : 'enterprise';
    if (kind === 'personal' && !t.allowPersonal) throw new DesktopError('PERSONAL_NOT_ALLOWED', 'Your organization does not allow personal accounts on this computer.');
    const existing = this.h.registry.findServer({ origin: server.origin, serverId: server.serverId }, trust?.organizationId ?? null);
    if (existing) {
      if (existing.id !== this.h.registry.activeId()) await this.switchTo(existing.id);
      return this.view(this.need(existing.id), this.h.registry.activeId());
    }
    if (kind === 'enterprise' && t.lockServer) throw new DesktopError('POLICY_DENIED', 'Your organization manages the server this computer connects to.');
    const free = !this.h.registry.byProfile(DEFAULT_PROFILE_DIR);
    const reserved = this.reserved?.target === target ? this.reserved.id : undefined;
    this.reserved = null;
    const record = this.h.registry.build(server, kind, trust, { useDefaultProfile: free, id: reserved });
    this.h.registry.insert(record);
    if (reserved && record.id === reserved && record.partition !== '') this.h.adoptPartition?.(partitionsFor(record).net);
    this.h.seedServer(record, serverInfoOf(record, { passkey: server.passkey, minimumVersion: server.minimumVersion, endpoints: server.endpoints, authMode: server.authMode, browserSignIn: server.browserSignIn, api: base?.api ?? (server.schema === 'legacy-desktop' ? 'desktop-v1' : 'core') }));
    try {
      await this.h.switcher.switchTo(record.id);
    } catch (e) {
      // Not opened (a call is on, the app is locked): the account stays, to be opened from the switcher.
      this.emit();
      throw e;
    }
    this.chooserDone = true;
    // The setup link that brought the person here (or one they chose not to use) is done with.
    this.pendingSetup = null;
    this.emit();
    return this.view(this.need(record.id), this.h.registry.activeId());
  }

  // ── the legacy server step (Onboarding's ServerStep, `auth:setServer`) ─────

  /**
   * `auth:setServer` as it was, re-implemented as connect and confirm: the open account's own server is probed again
   * as before; another address is discovered (or probed, without discovery) and becomes an account, opened signed out.
   */
  async setServer(input: string): Promise<AuthState> {
    const active = this.h.registry.active();
    const state = this.h.session.get();
    if (state.server?.locked) throw new DesktopError('POLICY_DENIED', 'Your organization manages the server address.');
    const probed = await this.h.probe(input);
    if (active && (active.apiOrigin === probed.origin || active.serverOrigin === probed.origin)) return this.h.session.setServer(input);
    let server: DiscoveredServer | null = null;
    try {
      server = await this.h.discover(probed.origin, kindForOrigin(probed.origin));
    } catch {
      server = null;
    }
    await this.createAccount(server ?? discoveredFromProbe(probed), kindForOrigin(probed.origin), null, { api: probed.api, passkey: probed.passkey, minimumVersion: probed.minimumVersion });
    return this.h.session.get();
  }

  /**
   * "Change server" on the sign-in screen: an account that was never signed in (made by the server step just now)
   * goes; any other stays on this computer, and none is open.
   */
  forgetServer(): AuthState {
    const active = this.h.registry.active();
    if (active?.managed) throw new DesktopError('POLICY_DENIED', 'Your organization manages the server address.');
    const out = this.h.session.forgetServer();
    if (active) {
      if (!active.user && active.signInState !== 'signed-in') this.h.registry.remove(active.id);
      else this.h.registry.setActive(null);
    }
    this.emit();
    return out;
  }
}

export function registerAccountsHandlers(router: IpcRouter, s: AccountsService): void {
  router.handle('accounts:state', () => s.state());
  router.handle('accounts:switch', (input) => s.switchTo(input.accountId));
  router.handle('accounts:startupChoice', (input) => s.startupChoice(input.accountId));
  router.handle('accounts:setChooser', (input) => s.setChooser(input.always));
  router.handle('accounts:unsynced', (input) => s.unsynced(input.accountId));
  router.handle('accounts:syncNow', (input) => s.syncNow(input.accountId));
  router.handle('accounts:exportUnsynced', (input) => s.exportUnsynced(input.accountId));
  router.handle('accounts:discardUnsynced', (input) => s.discardUnsynced(input.accountId, input.itemId));
  router.handle('accounts:signOut', (input) => s.signOut(input));
  router.handle('accounts:remove', (input) => s.remove(input));
  router.handle('accounts:health', (input) => s.health(input?.accountId));
  router.handle('accounts:addStart', (input) => s.addStart(input?.kind));
  router.handle('accounts:addCancel', () => s.addCancel());
}
