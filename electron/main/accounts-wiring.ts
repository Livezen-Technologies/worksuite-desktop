import { app, BrowserWindow, clipboard, session, shell } from 'electron';
import type { AccountsEventChannel } from '@shared/ipc/accounts-channels';
import type { AccountsEvents } from '@shared/accounts';
import { CLOUD_ORIGIN } from '@shared/discovery';
import type { IpcRouter } from '../ipc/router';
import { registerCloudHandlers, type CloudDeps, type CloudHandle } from '../services/cloud/handlers';
import { registerDiscoveryHandlers, type DiscoveryDeps, type DiscoveryHandle } from '../services/discovery/handlers';
import { readTrustedConfig } from '../services/discovery/trusted-config';
import type { AppContext } from './context';
import { DesktopError } from './errors';
import { broadcast } from './events';

/**
 * The seam between index.ts and accounts side by side (Connection & Startup §7.1). [WP1]
 *
 * index.ts calls `installAccounts` once, after its own handlers and before `router.install()`. It registers the
 * `accounts:*` channels (WP1: the registry, switcher, unsynced, removal), and through `registerDiscoveryHandlers`
 * (WP2) and `registerCloudHandlers` (WP3) the `connect:*`, `signin:*` and `cloud:*` ones. Every channel nobody
 * registered answers UNSUPPORTED through `IpcRouter.install()`, so until the packages land the app behaves as before.
 */
export interface AccountsWiringDeps {
  router: IpcRouter;
  ctx: AppContext;
}

export interface AccountsWiring {
  discovery: DiscoveryHandle;
  cloud: CloudHandle;
  /** Where the browser sign-in callbacks go first (`worksuite://auth/oidc`, `worksuite://auth/callback`). */
  handleAuthCallback: (url: string) => boolean;
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

const notYet = (what: string) => new DesktopError('UNSUPPORTED', `${what} is not available in this version.`);

export function installAccounts(deps: AccountsWiringDeps): AccountsWiring {
  const { router, ctx } = deps;
  const copyText = (text: string) => clipboard.writeText(text);
  const openExternal = (url: string) => shell.openExternal(url).then(
    () => true,
    () => false,
  );

  // WP1 replaces the registry-backed parts (existingAccount, createAccount, accountServer, account, acceptTokens).
  const discoveryDeps: DiscoveryDeps = {
    emit: (channel, run) => emitAccounts(channel, run),
    sessionFor: (partition) => session.fromPartition(partition),
    partitionFor: () => 'persist:ws-net',
    trusted: readTrustedConfig,
    rotatedKeys: () => ({}),
    existingAccount: () => null,
    createAccount: () => Promise.reject(notYet('Adding an account')),
    accountServer: () => null,
    copyText,
    appVersion: app.getVersion(),
    platform: platformName(),
    isPackaged: app.isPackaged,
    cloudOrigin: cloudOrigin(app.isPackaged),
  };
  const cloudDeps: CloudDeps = {
    emit: ((channel: 'signin:changed' | 'cloud:changed', payload: unknown) => broadcast(channel, payload)) as CloudDeps['emit'],
    account: () => null,
    activePersonal: () => null,
    http: () => ctx.http,
    fetchFor: () => (url, init) => fetch(url, init),
    acceptTokens: () => Promise.reject(notYet('Signing in through the browser')),
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
    dispose: () => {
      cloud.dispose();
      discovery.dispose();
    },
  };
}
