import { app, BrowserWindow, clipboard, session, shell, type Session } from 'electron';
import type { AccountsEventChannel } from '@shared/ipc/accounts-channels';
import type { AccountKind, AccountRecord, AccountsEvents, AccountView } from '@shared/accounts';
import { CLOUD_ORIGIN } from '@shared/discovery';
import { EMPTY_TRUSTED_CONFIG, type TrustedConfig } from '@shared/trusted-config';
import type { ServerInfo } from '@shared/types';
import type { IpcRouter } from '../ipc/router';
import type { Tokens } from '../services/auth-tokens';
import type { Database } from '../services/db';
import type { EnterpriseConfig } from '../services/enterprise';
import type { HttpClient } from '../services/http';
import { registerAccountsHandlers, serverInfoOf, type AccountsService } from '../services/accounts/handlers';
import type { AccountRegistry } from '../services/accounts/registry';
import { registerCloudHandlers, type CloudDeps, type CloudHandle } from '../services/cloud/handlers';
import { registerDiscoveryHandlers, type DiscoveryDeps, type DiscoveryHandle } from '../services/discovery/handlers';
import type { HealthMonitorDeps } from '../services/discovery/health';
import { parseEd25519Key } from '../services/discovery/keys';
import { readTrustedConfig } from '../services/discovery/trusted-config';
import type { AppContext } from './context';
import { DesktopError } from './errors';
import { broadcast } from './events';

/**
 * The seam between index.ts and accounts side by side (Connection & Startup §7.1). [WP1]
 *
 * index.ts calls `installAccounts` once, after its own handlers and before `router.install()`. It registers the
 * `accounts:*` channels (WP1: the registry, switcher, unsynced, removal), and through `registerDiscoveryHandlers`
 * (WP2) and `registerCloudHandlers` (WP3) the `connect:*`, `signin:*` and `cloud:*` ones, each with the
 * registry-backed dependencies below (`createAccount`, `existingAccount`, `acceptTokens`…). Every channel nobody
 * registered answers UNSUPPORTED through `IpcRouter.install()`.
 */

/**
 * What index.ts hands over: the accounts service and the registry, the partitions and network per account, and
 * signing an account in with tokens from the browser. Absent (the seam's own tests): no `accounts:*` channel is
 * registered and discovery and Cloud get the stand-ins they had before accounts.
 */
export interface AccountsRuntime {
  service: AccountsService;
  registry: AccountRegistry;
  trusted: () => TrustedConfig;
  /** A partition, through `installShellSession` (pinning included) before first use. */
  sessionFor: (partition: string) => Session;
  /** The partition connect runs use (the server is not an account yet). */
  connectPartition: string;
  /** Plain network (no credentials) in an account's network partition. */
  fetchFor: (accountId: string) => (url: string, init: RequestInit) => Promise<Response>;
  /** AuthService.acceptTokens, then the session (registration, bootstrap). */
  acceptTokens: (accountId: string, tokens: Tokens) => Promise<AccountView>;
  /** Rotated Livezen discovery keys kept in app.db (`setDiscoveryKeysSink`). */
  rotatedKeys?: () => Readonly<Record<string, string>>;
  /** A fresh `persist:acct-<id>-net` for a connect run; the account it confirms takes that id. */
  partitionFor?: (target: AccountKind) => string;
  /** The setup-link pins accounts keep for a host (restrict only). */
  accountPins?: (host: string) => string[];
  /** The service banner's monitor, built by discovery (`DiscoveryHandle.health`). */
  health?: HealthMonitorDeps;
}

export interface AccountsWiringDeps {
  router: IpcRouter;
  ctx: AppContext;
  accounts?: AccountsRuntime;
}

export interface AccountsWiring {
  discovery: DiscoveryHandle;
  cloud: CloudHandle;
  /** Where the browser sign-in callbacks go first (`worksuite://auth/oidc`, `worksuite://auth/callback`). */
  handleAuthCallback: (url: string) => boolean;
  /**
   * The organization a Personal account works in (Cloud `/me` `active_organization_id`): sent as `X-WS-Org` from
   * then on. For WP3's provisioning to call once it knows it.
   */
  setOrganization: (accountId: string, organizationId: string | null, organizationName?: string | null) => void;
  dispose: () => void;
}

/** Pushes an accounts event, typed by what it carries. */
export function emitAccounts<C extends AccountsEventChannel>(channel: C, payload: AccountsEvents[C]): void {
  broadcast(channel, payload);
}

/** WorkSuite Cloud's origin: WS_CLOUD_ORIGIN in unpackaged builds only (the mock-cloud e2e), never when packaged. */
export function cloudOrigin(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const o = env.WS_CLOUD_ORIGIN;
  if (isPackaged || !o) return CLOUD_ORIGIN;
  try {
    return new URL(o).origin;
  } catch {
    return CLOUD_ORIGIN;
  }
}

function platformName(): 'windows' | 'macos' | 'linux' {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}

/**
 * The computer's trusted configuration, with the managed server the existing enterprise sources name (registry,
 * policy.json, enterprise.json: `server_url`, `disable_server_change`) when discovery's own reader has none.
 */
export function trustedWithEnterprise(trusted: TrustedConfig, enterprise: EnterpriseConfig): TrustedConfig {
  if (trusted.source || !enterprise.server_url) return trusted;
  return { ...EMPTY_TRUSTED_CONFIG, spkiPins: [], source: 'enterprise.json', serverUrl: enterprise.server_url, lockServer: !!enterprise.disable_server_change };
}

/**
 * The key a server's signed policy is verified with (§7.2 "per-account policy key"): the account's trusted
 * `discovery_key` (Core signs both with its policy key), else the build's pinned one.
 */
export function policyKeyFor(account: Pick<AccountRecord, 'trust'> | null, fallback: string | null): string | null {
  const key = account?.trust?.discoveryKey;
  if (!key) return fallback;
  const parsed = parseEd25519Key(key);
  return parsed ? String(parsed.export({ type: 'spki', format: 'pem' })) : fallback;
}

/**
 * The account's server in its own database (what AuthService and the session read), when it is not there yet: a
 * new account, a managed one. A server already there — account #1's, as the legacy desktop left it — is kept.
 */
export function seedServerConfig(db: Pick<Database, 'getConfig' | 'setConfig'>, account: AccountRecord): void {
  const had = db.getConfig<ServerInfo>('server');
  if (had && typeof had.origin === 'string') {
    if (had.accountId !== account.id || (had.locked ?? false) !== account.managed) db.setConfig('server', { ...had, accountId: account.id, locked: account.managed });
    return;
  }
  db.setConfig('server', serverInfoOf(account));
}

const notYet = (what: string) => new DesktopError('UNSUPPORTED', `${what} is not available in this version.`);

export function installAccounts(deps: AccountsWiringDeps): AccountsWiring {
  const { router, ctx, accounts } = deps;
  const copyText = (text: string) => clipboard.writeText(text);
  const openExternal = (url: string) => shell.openExternal(url).then(
    () => true,
    () => false,
  );

  if (accounts) {
    registerAccountsHandlers(router, accounts.service);
    // The legacy server step (Onboarding's ServerStep) as connect and confirm.
    ctx.accounts = { setServer: (url) => accounts.service.setServer(url), forgetServer: () => accounts.service.forgetServer() };
  }

  const discoveryDeps: DiscoveryDeps = {
    emit: (channel, run) => emitAccounts(channel, run),
    sessionFor: (partition) => (accounts ? accounts.sessionFor(partition) : session.fromPartition(partition)),
    partitionFor: (target) => accounts?.partitionFor?.(target) ?? accounts?.connectPartition ?? 'persist:ws-net',
    trusted: accounts?.trusted ?? readTrustedConfig,
    rotatedKeys: accounts?.rotatedKeys ?? (() => ({})),
    existingAccount: (server) => accounts?.service.existing(server) ?? null,
    createAccount: (server, target, trust) => (accounts ? accounts.service.createAccount(server, target, trust) : Promise.reject(notYet('Adding an account'))),
    accountServer: (accountId) => {
      const a = accounts?.registry.get(accountId);
      return a ? { input: a.serverOrigin, target: a.kind } : null;
    },
    copyText,
    appVersion: app.getVersion(),
    platform: platformName(),
    isPackaged: app.isPackaged,
    cloudOrigin: cloudOrigin(app.isPackaged),
    ...(accounts?.accountPins ? { accountPins: accounts.accountPins } : {}),
    ...(accounts?.health ? { health: accounts.health } : {}),
  };
  const cloudDeps: CloudDeps = {
    emit: ((channel: 'signin:changed' | 'cloud:changed', payload: unknown) => broadcast(channel, payload)) as CloudDeps['emit'],
    account: (accountId) => accounts?.registry.get(accountId) ?? null,
    activePersonal: () => {
      const a = accounts?.registry.active() ?? null;
      return a?.kind === 'personal' ? a : null;
    },
    http: (): HttpClient | null => ctx.http,
    fetchFor: (accountId) => (accounts ? accounts.fetchFor(accountId) : (url, init) => fetch(url, init)),
    acceptTokens: (accountId, tokens) => (accounts ? accounts.acceptTokens(accountId, tokens) : Promise.reject(notYet('Signing in through the browser'))),
    setLicenceSource: (source) => ctx.bootstrap.setLicenceSource(source),
    openExternal,
    copyText,
    isDefaultProtocolClient: () => app.isDefaultProtocolClient('worksuite'),
    focused: () => BrowserWindow.getFocusedWindow() !== null,
  };

  const discovery = registerDiscoveryHandlers(router, discoveryDeps);
  const cloud = registerCloudHandlers(router, cloudDeps);
  return {
    discovery,
    cloud,
    handleAuthCallback: (url) => cloud.handleCallback(url),
    setOrganization: (accountId, organizationId, organizationName) => {
      if (!accounts) return;
      accounts.registry.update(accountId, { organizationId, ...(organizationName !== undefined ? { organizationName } : {}) });
      accounts.service.emit();
    },
    dispose: () => {
      cloud.dispose();
      discovery.dispose();
    },
  };
}
