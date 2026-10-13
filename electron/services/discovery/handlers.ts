import type { Session } from 'electron';
import type { AccountKind, AccountView } from '@shared/accounts';
import type { ConnectRun, DiscoveredServer } from '@shared/discovery';
import type { TrustedConfig } from '@shared/trusted-config';
import type { IpcRouter } from '../../ipc/router';
import type { PinsFor } from './pinning';
import type { HealthMonitor } from './health';

/**
 * The connect channels (`connect:*`, `accounts:rediscover`) and what the rest of the app needs from discovery.
 * [WP2; registered by electron/main/accounts-wiring.ts]
 *
 * - `connect:start` starts `runDiscovery` and answers its runId at once; progress goes out on `connect:progress`.
 * - `connect:get` / `connect:cancel` read or abort a run; runs are kept in memory for 15 minutes.
 * - `connect:confirm` hands a finished run's `DiscoveredServer` to `createAccount` (the registry, WP1): the account
 *   is created, activated and signed out.
 * - `connect:parseSetup` reads and verifies a setup link (shared/trusted-config.ts `parseSetupLink`, then the
 *   signature): SETUP_LINK_INVALID / SETUP_LINK_EXPIRED.
 * - `connect:copyDetails` copies the failure's "Details for IT".
 * - `accounts:rediscover` runs the pipeline again for an existing account (never signs it out).
 */
export interface DiscoveryDeps {
  /** Pushes an allow-listed event (`connect:progress`) to the windows. */
  emit: (channel: 'connect:progress', run: ConnectRun) => void;
  /** The Electron session a run's requests go through: the new account's network partition, pinning installed. */
  sessionFor: (partition: string) => Session;
  /** The partition a run for `target` will use (a fresh `persist:acct-<id>-net`, or account #1's). */
  partitionFor: (target: AccountKind) => string;
  trusted: () => TrustedConfig;
  rotatedKeys: () => Readonly<Record<string, string>>;
  /** The id of an account already added for this server and organization, else null (`ACCOUNT_EXISTS`). */
  existingAccount: (server: Pick<DiscoveredServer, 'origin' | 'serverId'>) => string | null;
  /** Creates the account from a successful run (WP1 registry). */
  createAccount: (server: DiscoveredServer, target: AccountKind, trust: TrustedConfig | null) => Promise<AccountView>;
  /** An existing account's server and trust, for `accounts:rediscover`. */
  accountServer: (accountId: string) => { input: string; target: AccountKind } | null;
  copyText: (text: string) => void;
  appVersion: string;
  platform: 'windows' | 'macos' | 'linux';
  isPackaged: boolean;
  cloudOrigin: string;
}

/** What WP1 uses from discovery outside IPC. */
export interface DiscoveryHandle {
  /** For `installShellSession`: the pins a host has, managed or from the active run's setup link. */
  pinsFor: PinsFor;
  /** The service banner's monitor; null until WP2 builds it. */
  health: HealthMonitor | null;
  dispose: () => void;
}

/** Registers the connect channels on `router`. Stub: registers nothing (they answer UNSUPPORTED). */
export function registerDiscoveryHandlers(_router: IpcRouter, _deps: DiscoveryDeps): DiscoveryHandle {
  return { pinsFor: () => null, health: null, dispose: () => undefined };
}
