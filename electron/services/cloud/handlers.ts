import type { AccountRecord, AccountView } from '@shared/accounts';
import type { BrowserSignIn, CloudStatus } from '@shared/cloud';
import type { IpcRouter } from '../../ipc/router';
import type { LicenceSource } from '../bootstrap';
import type { HttpClient } from '../http';
import type { Tokens } from '../auth-tokens';

/**
 * The browser sign-in and Cloud channels (`signin:*`, `cloud:*`). [WP3; registered by
 * electron/main/accounts-wiring.ts]
 *
 * - `signin:start` builds the OIDC authorize URL (oidc.ts) — or Core's AppHandoff page for an enterprise
 *   `browser_sign_in` — opens it, and answers the attempt (browser-signin.ts); `signin:changed` follows it.
 * - The callback (deep link or loopback) is exchanged for tokens, handed to `acceptTokens` (WP1 `AuthService`), then
 *   provisioning.ts takes the account from `/me` to ready.
 * - `cloud:*` read and act on the active Personal account; `cloud:changed` follows `CloudStatus`.
 */
export interface CloudDeps {
  /** Pushes an allow-listed event to the windows. */
  emit: {
    (channel: 'signin:changed', attempt: BrowserSignIn | null): void;
    (channel: 'cloud:changed', status: CloudStatus): void;
  };
  /** An account by id (any kind: an enterprise `browser_sign_in` uses the same flow). */
  account: (accountId: string) => AccountRecord | null;
  /** The active account, when it is a Personal one. */
  activePersonal: () => AccountRecord | null;
  /** The active account's HTTP client (tokens, `X-WS-Org`, error mapping). */
  http: () => HttpClient | null;
  /** Plain network for OneAuth (no credentials), in the account's network partition. */
  fetchFor: (accountId: string) => (url: string, init: RequestInit) => Promise<Response>;
  /** Signs the account in with tokens from the browser (WP1: AuthService.acceptTokens, then the session). */
  acceptTokens: (accountId: string, tokens: Tokens) => Promise<AccountView>;
  /** The bootstrap's licence hook (BootstrapService.setLicenceSource). */
  setLicenceSource: (source: LicenceSource | null) => void;
  openExternal: (url: string) => Promise<boolean>;
  copyText: (text: string) => void;
  /** `app.isDefaultProtocolClient('worksuite')`: the redirect is `worksuite://auth/oidc`, else loopback. */
  isDefaultProtocolClient: () => boolean;
  focused: () => boolean;
  now?: () => number;
}

/** What WP1 uses from Cloud outside IPC. */
export interface CloudHandle {
  /** A `worksuite://auth/oidc` / `worksuite://auth/callback` link: whether a browser sign-in took it. */
  handleCallback: (url: string) => boolean;
  /** The active Personal account's Cloud side, for `AuthState.cloud`; null when none. */
  status: () => CloudStatus | null;
  /** Gateway `ORG_SUSPENDED` / `ORG_NOT_FOUND`: fetch /me again. */
  refetchMe: () => void;
  dispose: () => void;
}

/** Registers the sign-in and Cloud channels on `router`. Stub: registers nothing (they answer UNSUPPORTED). */
export function registerCloudHandlers(_router: IpcRouter, _deps: CloudDeps): CloudHandle {
  return { handleCallback: () => false, status: () => null, refetchMe: () => undefined, dispose: () => undefined };
}
