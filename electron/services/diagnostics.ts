import { app, Notification } from 'electron';
import { readFileSync } from 'node:fs';
import { statfsSync } from 'node:fs';
import os from 'node:os';
import type { BundlePreview } from '@shared/ipc/contract';
import { redact, redactString } from '@shared/redact';
import type { DiagnosticCheck } from '@shared/types';
import { logFiles, recentLog, redactionCount } from '../main/log';
import { screenTimings } from './screen-timings';
import type { ZipEntry } from './zip';

/**
 * Help → Diagnostics (FR-DIAG-01/02, WF-29).
 *
 * The checks run against the real services. The bundle is built from logs
 * that were already redacted when written, and is redacted again here; the
 * user sees every file's contents before anything is saved. It never
 * contains tokens, passwords, email bodies or file contents.
 */
export interface DiagnosticsDeps {
  serverOrigin: () => string | null;
  timedFetch: (path: string) => Promise<{ ok: boolean; status: number; ms: number }>;
  signedIn: () => boolean;
  realtimeState: () => string;
  updaterState: () => { state: string; error: string | null; lastCheckedAt: string | null; channel: string };
  /** Every update check, download, install and rollback (worksuite-desktop#205), newest last. */
  updateHistory?: () => Array<{ t: string; event: string; version?: string | null; detail?: string | null }>;
  services: () => Record<string, string>;
  dbCheck: () => string;
  secureStorage: () => { available: boolean; backend: string; persistent: boolean };
  policy: () => unknown;
  deviceInfo: () => unknown;
  accessibility?: () => Promise<unknown>;
  settings: () => unknown;
  offline: () => unknown;
  crashes: () => unknown;
  safeMode: () => boolean;
  userDataPath: string;
}

export class DiagnosticsService {
  constructor(private readonly deps: DiagnosticsDeps) {}

  async run(): Promise<DiagnosticCheck[]> {
    const checks: DiagnosticCheck[] = [];
    const origin = this.deps.serverOrigin();

    if (!origin) {
      checks.push({ id: 'api', label: 'WorkSuite server', status: 'skip', detail: 'No server configured yet.' });
    } else {
      try {
        const r = await this.deps.timedFetch('/api/auth/config');
        checks.push({
          id: 'api',
          label: 'WorkSuite server',
          status: r.ok ? (r.ms > 2000 ? 'warn' : 'pass') : 'fail',
          detail: r.ok ? `${new URL(origin).host} answered in ${r.ms} ms` : `The server answered ${r.status}.`,
          ms: r.ms,
        });
      } catch (e) {
        checks.push({ id: 'api', label: 'WorkSuite server', status: 'fail', detail: redactString(String((e as Error).message ?? e)) });
      }
    }

    checks.push({
      id: 'session',
      label: 'Signed in',
      status: this.deps.signedIn() ? 'pass' : 'warn',
      detail: this.deps.signedIn() ? 'Session active.' : 'Not signed in.',
    });

    const rt = this.deps.realtimeState();
    checks.push({
      id: 'realtime',
      label: 'Realtime connection',
      status: rt === 'connected' ? 'pass' : rt === 'disabled' ? 'skip' : rt === 'idle' ? 'skip' : 'warn',
      detail:
        rt === 'connected'
          ? 'Connected.'
          : rt === 'disabled'
            ? 'This server does not run the realtime gateway; WorkSuite polls instead.'
            : rt === 'idle'
              ? 'Not started.'
              : 'Reconnecting.',
    });

    checks.push({
      id: 'notifications',
      label: 'System notifications',
      status: Notification.isSupported() ? 'pass' : 'warn',
      detail: Notification.isSupported() ? 'Supported by this system.' : 'This system does not support notifications; the in-app list still works.',
    });

    const u = this.deps.updaterState();
    const last = this.deps.updateHistory?.().at(-1);
    checks.push({
      id: 'updater',
      label: 'Updates',
      status: u.state === 'FAILED' ? 'warn' : 'pass',
      detail: `${u.state.toLowerCase()} · ${u.channel} channel${u.lastCheckedAt ? ` · last checked ${u.lastCheckedAt}` : ''}${u.error ? ` · ${u.error}` : ''}${last ? ` · last event: ${last.event}${last.version ? ` ${last.version}` : ''} at ${last.t}` : ''}`,
    });

    checks.push({ id: 'sync', label: 'File sync', status: 'skip', detail: 'WorkSuite Drive sync arrives in a later release; files are available online in Files.' });
    checks.push({ id: 'monitoring', label: 'Monitoring agent', status: 'skip', detail: 'No monitoring policy is assigned to you. Nothing is being recorded.' });

    const svc = this.deps.services();
    const failed = Object.entries(svc).filter(([, h]) => h === 'FAILED');
    checks.push({
      id: 'helpers',
      label: 'Background helpers',
      status: failed.length ? 'fail' : 'pass',
      detail: Object.entries(svc)
        .map(([n, h]) => `${n}: ${h.toLowerCase()}`)
        .join(' · ') || 'None running.',
    });

    try {
      const res = this.deps.dbCheck();
      checks.push({ id: 'db', label: 'Local database', status: res === 'ok' ? 'pass' : 'fail', detail: res === 'ok' ? 'Integrity check passed.' : res });
    } catch (e) {
      checks.push({ id: 'db', label: 'Local database', status: 'fail', detail: String((e as Error).message ?? e) });
    }

    try {
      const s = statfsSync(this.deps.userDataPath);
      const free = Number(s.bavail) * Number(s.bsize);
      const gb = free / 1024 ** 3;
      checks.push({ id: 'disk', label: 'Disk space', status: gb < 1 ? 'fail' : gb < 5 ? 'warn' : 'pass', detail: `${gb.toFixed(1)} GB free` });
    } catch {
      checks.push({ id: 'disk', label: 'Disk space', status: 'skip', detail: 'Not measurable on this system.' });
    }

    const ss = this.deps.secureStorage();
    checks.push({
      id: 'secure-storage',
      label: 'Secure credential storage',
      status: ss.persistent ? 'pass' : 'warn',
      detail: ss.persistent ? `Using ${ss.backend}.` : 'No system keyring found; you will be asked to sign in each time WorkSuite starts.',
    });

    checks.push({
      id: 'gpu',
      label: 'Hardware acceleration',
      status: 'pass',
      detail: this.deps.safeMode() ? 'Off (Safe Mode).' : app.isHardwareAccelerationEnabled() ? 'On.' : 'Off.',
    });
    return checks;
  }

  private async entries(): Promise<ZipEntry[]> {
    const checks = await this.run();
    const json = (v: unknown) => Buffer.from(JSON.stringify(redact(v), null, 2), 'utf8');
    const manifest = {
      product: 'WorkSuite Desktop',
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      os: `${os.type()} ${os.release()} ${process.arch}`,
      locale: app.getLocale(),
      safe_mode: this.deps.safeMode(),
      created_at: new Date().toISOString(),
      server: this.deps.serverOrigin() ? new URL(this.deps.serverOrigin()!).host : null,
      redacted: 'Tokens, passwords, email addresses, email bodies and file contents are removed.',
    };
    const out: ZipEntry[] = [
      { name: 'manifest.json', data: json(manifest) },
      { name: 'health.json', data: json(checks) },
      { name: 'device.json', data: json(this.deps.deviceInfo()) },
      ...(this.deps.accessibility ? [{ name: 'accessibility.json', data: json(await this.deps.accessibility()) }] : []),
      { name: 'policy.json', data: json(this.deps.policy()) },
      { name: 'settings.json', data: json(this.deps.settings()) },
      { name: 'offline.json', data: json(this.deps.offline()) },
      { name: 'crashes.json', data: json(this.deps.crashes()) },
      // The update log: every check, download, install and rollback (#205).
      ...(this.deps.updateHistory ? [{ name: 'updates.json', data: json({ state: this.deps.updaterState(), history: this.deps.updateHistory() }) }] : []),
      { name: 'services.json', data: json(this.deps.services()) },
      // Request, server and render times from the screens (worksuite-desktop#252): where a slow list spent its time.
      { name: 'timings.json', data: json(screenTimings.report()) },
    ];
    for (const file of logFiles()) {
      try {
        const text = readFileSync(file, 'utf8')
          .split('\n')
          .map((l) => redactString(l))
          .join('\n');
        out.push({ name: `logs/${file.split(/[\\/]/).pop()}`, data: Buffer.from(text, 'utf8') });
      } catch {
        /* unreadable log: skip */
      }
    }
    if (out.every((e) => !e.name.startsWith('logs/'))) {
      out.push({ name: 'logs/recent.log', data: Buffer.from(recentLog().join('\n'), 'utf8') });
    }
    return out;
  }

  async preview(): Promise<BundlePreview> {
    const entries = await this.entries();
    return {
      files: entries.map((e) => ({ name: e.name, size: e.data.length, preview: e.data.toString('utf8').slice(0, 4000) })),
      redactions: redactionCount(),
    };
  }

  async bundle(): Promise<ZipEntry[]> {
    return this.entries();
  }
}
