import { DesktopError } from '../../main/errors';
import type { ConnectRun, DiscoveredServer } from '@shared/discovery';
import type { TrustedConfig } from '@shared/trusted-config';

/**
 * The discovery and verification pipeline behind screen 7 (Connection & Startup §2). [WP2]
 *
 * `runDiscovery` takes what was typed or scanned and runs, one step at a time, each reported through `onProgress`
 * (`connect:progress`), with no proceed-anyway path:
 *
 *  1. Input — `normalize`: an https origin (localhost allowed unpackaged); a work email → DNS TXT
 *     `_worksuite.<domain>` (`v=ws1; url=https://…`), then `https://worksuite.<domain>`, then `https://<domain>`, the
 *     first that passes every check wins (`candidates`); a setup link → its verified trusted configuration.
 *  2. DNS — `dns.promises.lookup`, timed. `DNS_FAILED`.
 *  3. TLS — Chromium's verdict in the target partition (`TLS_UNTRUSTED` / `TLS_EXPIRED` / `TLS_HOSTNAME` /
 *     `TLS_PIN_MISMATCH`), details from pinning.ts `readTlsDetails`.
 *  4. Document — `GET /.well-known/worksuite`, raw bytes kept, `redirect:'error'`, DISCOVERY_MAX_BYTES, parsed with
 *     `discoveryDocumentV1`; on 404 the legacy documents (`legacy-desktop`, `legacy-core`, `deployment:'LEGACY'`).
 *  5. Signature — `GET /.well-known/worksuite.jws`, detached EdDSA over `header + '.' + b64url(rawBytes)`, key per
 *     keys.ts. Unsigned enterprise without `require_signed`: `skipped` ("Not configured"), `signed:false`.
 *  6. Product — `isWorkSuiteV1`, every endpoint https, `endpoints.api` path `/` or `/api`, unsigned → same host.
 *     `NOT_WORKSUITE` / `ORIGIN_MISMATCH`.
 *  7. Version — `desktop.min_version[platform]` (`UPDATE_REQUIRED`), `server_version` vs SERVER_MIN_VERSION
 *     (`SERVER_TOO_OLD`); not reported → `warning`.
 *  8. Health — health.ts, 10 s. `HEALTH_FAILED`.
 * Around it: `PERSONAL_NOT_ALLOWED`, `SERVER_NOT_ALLOWED` (lockServer), `ACCOUNT_EXISTS`.
 */

export interface DiscoveryInput {
  runId: string;
  input: string;
  target: 'personal' | 'enterprise';
}

export interface PipelineDeps {
  /** Chromium's network stack in the partition the account will use (OS trust store, pinning installed). */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** This computer's trusted configuration (managed sources). */
  trusted: () => TrustedConfig;
  /** Rotated Livezen discovery keys from app.db, `kid` → key. */
  rotatedKeys: () => Readonly<Record<string, string>>;
  /** An account already added for this server and organization, by origin or server id. */
  existingAccount: (server: Pick<DiscoveredServer, 'origin' | 'serverId'>) => string | null;
  appVersion: string;
  platform: 'windows' | 'macos' | 'linux';
  /** Unpackaged builds accept http://localhost and WS_CLOUD_ORIGIN. */
  isPackaged: boolean;
  cloudOrigin: string;
  now?: () => number;
}

export type ProgressFn = (run: ConnectRun) => void;

/** Runs every step for one input. Resolves with the finished run (ok, failed or cancelled); never rejects in WP2. */
export async function runDiscovery(_input: DiscoveryInput, _deps: PipelineDeps, _onProgress: ProgressFn, _signal: AbortSignal): Promise<ConnectRun> {
  throw new DesktopError('UNSUPPORTED', 'Connecting to a server this way is not available in this version.');
}

/** Address normalization (step 1). Stub: UNSUPPORTED. */
export type NormalizedInput =
  | { kind: 'origin'; origin: string }
  | { kind: 'email'; domain: string }
  | { kind: 'setup-link'; link: string }
  | { kind: 'invalid'; code: 'INVALID_ADDRESS' | 'HTTPS_REQUIRED' };

export function normalizeInput(_input: string, _opts: { allowLocalhost: boolean }): NormalizedInput {
  throw new DesktopError('UNSUPPORTED', 'Connecting to a server this way is not available in this version.');
}
