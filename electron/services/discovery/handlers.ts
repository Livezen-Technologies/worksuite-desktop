import { randomUUID } from 'node:crypto';
import { net, type Session } from 'electron';
import type { AccountKind, AccountView } from '@shared/accounts';
import { CHECK_LABELS, type ConnectRun, type DiscoveredServer } from '@shared/discovery';
import { parseSetupLink, type TrustedConfig } from '@shared/trusted-config';
import type { IpcRouter } from '../../ipc/router';
import { DesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import { createNetFetch } from '../net-fetch';
import { HealthMonitor, type HealthMonitorDeps } from './health';
import { parseEd25519Key } from './keys';
import type { HostPins, PinsFor } from './pinning';
import { discover, type PipelineDeps } from './pipeline';
import { verifySetupLink } from './trusted-config';

const log = logger('discovery.ipc');

/**
 * The connect channels (`connect:*`, `accounts:rediscover`) and what the rest of the app needs from discovery.
 * [WP2; registered by electron/main/accounts-wiring.ts]
 *
 * - `connect:start` starts `runDiscovery` and answers its runId at once; progress goes out on `connect:progress`.
 *   A new start cancels any run still going (one checks screen at a time).
 * - `connect:get` / `connect:cancel` read or abort a run; runs are kept in memory for 15 minutes.
 * - `connect:confirm` hands a finished run's `DiscoveredServer` to `createAccount` (the registry, WP1): the account
 *   is created, activated and signed out. Once per run.
 * - `connect:parseSetup` reads and verifies a setup link (shared/trusted-config.ts `parseSetupLink`, then the
 *   signature when the key is known — v2's own key or the managed one; a v1 link is verified against the server's
 *   key during the run): SETUP_LINK_INVALID / SETUP_LINK_EXPIRED.
 * - `connect:copyDetails` copies the run's "Details for IT".
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
  /** Optional: the setup-link pins existing accounts keep, by host (restrict only). WP1, from the registry. */
  accountPins?: (host: string) => string[];
  /** Optional: builds the service banner's monitor (`DiscoveryHandle.health`); WP1 starts it. */
  health?: HealthMonitorDeps;
}

/** What WP1 uses from discovery outside IPC. */
export interface DiscoveryHandle {
  /** For `installShellSession`: the pins a host has, managed or from the active run's setup link. */
  pinsFor: PinsFor;
  /** The service banner's monitor; null unless `deps.health` was given. */
  health: HealthMonitor | null;
  dispose: () => void;
}

/** Test seams: the fetch a partition's runs use, and extra pipeline deps (DNS, the chain reader). */
export interface DiscoveryOverrides {
  fetchFor?: (partition: string) => PipelineDeps['fetch'];
  pipeline?: Partial<PipelineDeps>;
  now?: () => number;
}

const RUN_TTL_MS = 15 * 60_000;

interface RunEntry {
  run: ConnectRun;
  controller: AbortController;
  trust: TrustedConfig | null;
  createdAt: number;
  confirmed: boolean;
  rediscover: boolean;
  done: Promise<void>;
}

/** The "Details for IT" text of a run. */
export function runDetails(run: ConnectRun, appVersion: string): string {
  const lines = ['WorkSuite Desktop — connection details', `Request ID: ${run.runId}`, `Desktop version: ${appVersion}`, `Address: ${run.host ?? run.input.slice(0, 200)}`];
  if (run.candidates.length) lines.push(`Addresses tried: ${run.candidates.join(', ')}`);
  lines.push(`Result: ${run.state}`);
  const f = run.failure;
  if (f) {
    lines.push(`Error: ${f.code}`, `Message: ${f.message}`, `Step: ${f.step ? CHECK_LABELS[f.step] : '—'}`, `Time: ${f.at}`);
    if (f.tls) {
      lines.push(
        'Certificate:',
        `  Host: ${f.tls.host}:${f.tls.port}`,
        `  Subject: ${f.tls.subject}`,
        `  Issuer: ${f.tls.issuer}`,
        `  Valid: ${f.tls.validFrom} – ${f.tls.validTo}`,
        `  SPKI: ${f.tls.spki}`,
        `  Trust store: ${f.tls.trustStore}`,
        `  Reason: ${f.tls.reason}`,
      );
    }
    if (f.compat) {
      lines.push(`Installed: ${f.compat.installed}`, `Required: ${f.compat.required ?? '—'}`, `Server version: ${f.compat.serverVersion ?? 'not reported'}`, `Supported from: ${f.compat.supportedFrom}`);
    }
  }
  lines.push('Checks:');
  for (const s of run.steps) lines.push(`  ${CHECK_LABELS[s.id]}: ${s.status}${s.ms !== null ? ` (${s.ms} ms)` : ''}${s.note ? ` — ${s.note}` : ''}`);
  return lines.join('\n');
}

interface RedirectSeen {
  status: number;
  url: string;
}

/**
 * Chromium's `net` as the pipeline's Fetch, with redirects never followed by Chromium itself: every request runs
 * with `redirect:'manual'` and the redirect is stopped at the 'redirect' event. `redirect:'manual'` callers get the
 * 3xx as a Response with its Location (document.ts decides whether to follow, same origin only); `'error'` callers
 * get an error naming the redirect; `'follow'` is never used by discovery and is treated as `'error'`.
 */
export function netFetchWithRedirects(ses: Session): PipelineDeps['fetch'] {
  const f = createNetFetch((o) => {
    const cr = net.request({ ...o, redirect: 'manual' });
    cr.on('redirect', (status: number, _method: string, url: string) => {
      const r = { status, url };
      const e = Object.assign(new Error(`redirect ${status} to ${url}`), { redirect: r });
      try {
        cr.abort();
      } catch {
        /* already gone */
      }
      cr.emit('error', e);
    });
    return cr;
  }, ses);
  return async (url, init) => {
    try {
      return await f(url, init);
    } catch (e) {
      const r = (e as { redirect?: RedirectSeen }).redirect ?? null;
      if (!r) throw e;
      if (init.redirect === 'manual') return new Response(null, { status: r.status, headers: { location: r.url } });
      throw new Error(`redirect mode is set to error: ${url} redirected to ${r.url}`);
    }
  };
}

export function registerDiscoveryHandlers(router: IpcRouter, deps: DiscoveryDeps, overrides: DiscoveryOverrides = {}): DiscoveryHandle {
  const now = overrides.now ?? Date.now;
  const runs = new Map<string, RunEntry>();
  /** Pins a running setup-link run set for its host (restrict only). */
  const runPins = new Map<string, HostPins>();

  const pinsFor: PinsFor = (host) => {
    const h = host.toLowerCase();
    try {
      const t = deps.trusted();
      if (t.serverUrl && t.spkiPins.length && new URL(t.serverUrl).hostname === h) return { pins: t.spkiPins, managed: true };
    } catch {
      /* unreadable managed configuration: no managed pins */
    }
    const run = runPins.get(h);
    const kept = deps.accountPins?.(h) ?? [];
    const pins = [...new Set([...(run?.pins ?? []), ...kept])];
    return pins.length ? { pins, managed: false } : null;
  };

  const sweep = () => {
    const t = now();
    for (const [id, e] of runs) if (t - e.createdAt > RUN_TTL_MS && e.run.state !== 'running') runs.delete(id);
  };

  const fetchFor = (partition: string): PipelineDeps['fetch'] => {
    if (overrides.fetchFor) return overrides.fetchFor(partition);
    return netFetchWithRedirects(deps.sessionFor(partition));
  };

  const start = (input: string, target: AccountKind, rediscover = false): RunEntry => {
    sweep();
    // One checks screen at a time; a background rediscovery never interrupts it.
    if (!rediscover) for (const e of runs.values()) if (e.run.state === 'running' && !e.rediscover) e.controller.abort();
    const runId = randomUUID();
    const controller = new AbortController();
    const entry: RunEntry = {
      run: { runId, input, target, host: null, candidates: [], steps: [], state: 'running', server: null, failure: null },
      controller,
      trust: null,
      createdAt: now(),
      confirmed: false,
      rediscover,
      done: Promise.resolve(),
    };
    runs.set(runId, entry);
    const pipelineDeps: PipelineDeps = {
      fetch: fetchFor(deps.partitionFor(target)),
      trusted: deps.trusted,
      rotatedKeys: deps.rotatedKeys,
      existingAccount: deps.existingAccount,
      appVersion: deps.appVersion,
      platform: deps.platform,
      isPackaged: deps.isPackaged,
      cloudOrigin: deps.cloudOrigin,
      now,
      pinsFor: (host) => {
        const kept = deps.accountPins?.(host) ?? [];
        return kept.length ? { pins: kept, managed: false } : null;
      },
      runPins: (host, pins) => {
        if (pins) runPins.set(host.toLowerCase(), pins);
        else runPins.delete(host.toLowerCase());
      },
      rediscover,
      ...overrides.pipeline,
    };
    const onProgress = (run: ConnectRun) => {
      if (runs.get(runId) !== entry) return;
      entry.run = run;
      deps.emit('connect:progress', run);
    };
    entry.done = discover({ runId, input, target }, pipelineDeps, onProgress, controller.signal).then(
      (out) => {
        entry.run = out.run;
        entry.trust = out.trust;
      },
      (e: unknown) => {
        log.error('discovery run failed', { runId, error: String(e) });
      },
    );
    return entry;
  };

  const entryFor = (runId: string): RunEntry => {
    const e = runs.get(runId);
    if (!e) throw new DesktopError('NOT_FOUND', 'That connection attempt has ended. Start again.');
    return e;
  };

  router.handle('connect:start', ({ input, target }) => ({ runId: start(input, target).run.runId }));

  router.handle('connect:get', ({ runId }) => entryFor(runId).run);

  router.handle('connect:cancel', ({ runId }) => {
    const e = runs.get(runId);
    if (e && e.run.state === 'running') e.controller.abort();
  });

  router.handle('connect:confirm', async ({ runId }) => {
    const e = entryFor(runId);
    if (e.rediscover || e.run.state !== 'ok' || !e.run.server) throw new DesktopError('CONFLICT', 'This server has not passed every check.');
    if (e.confirmed) throw new DesktopError('CONFLICT', 'This server is already being added.');
    e.confirmed = true;
    try {
      return await deps.createAccount(e.run.server, e.run.target, e.trust);
    } catch (err) {
      e.confirmed = false;
      throw err;
    }
  });

  router.handle('connect:parseSetup', ({ link }) => {
    const parsed = parseSetupLink(link, now());
    if (!parsed.ok) {
      throw parsed.reason === 'expired'
        ? new DesktopError('SETUP_LINK_EXPIRED', 'This setup link has expired. Ask your administrator for a new one.')
        : new DesktopError('SETUP_LINK_INVALID', 'This is not a valid WorkSuite setup link.');
    }
    const origin = new URL(parsed.payload.server_url).origin;
    const t = deps.trusted();
    const managedKey = t.source && (t.serverUrl === null || t.serverUrl === origin) ? t.discoveryKey : null;
    const key = managedKey ?? (parsed.payload.discovery_key && parseEd25519Key(parsed.payload.discovery_key) ? parsed.payload.discovery_key : null);
    if (key && !verifySetupLink(parsed, key)) throw new DesktopError('SETUP_LINK_INVALID', 'This setup link is not signed correctly. Ask your administrator for a new one.');
    return { payload: parsed.payload };
  });

  router.handle('connect:copyDetails', ({ runId }) => {
    deps.copyText(runDetails(entryFor(runId).run, deps.appVersion));
    return true;
  });

  router.handle('accounts:rediscover', async ({ accountId }) => {
    const a = deps.accountServer(accountId);
    if (!a) throw new DesktopError('NOT_FOUND', 'That account is not on this computer.');
    const e = start(a.input, a.target, true);
    await e.done;
    return e.run;
  });

  const health = deps.health ? new HealthMonitor(deps.health) : null;

  return {
    pinsFor,
    health,
    dispose: () => {
      for (const e of runs.values()) e.controller.abort();
      runs.clear();
      runPins.clear();
      health?.stop();
    },
  };
}
