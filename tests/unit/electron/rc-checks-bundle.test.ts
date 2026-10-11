import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, getVersion: () => '0.2.228', getLocale: () => 'en', isHardwareAccelerationEnabled: () => true },
  Notification: class {
    static isSupported = () => true;
  },
}));

import { DiagnosticsService, type DiagnosticsDeps } from '../../../electron/services/diagnostics';
import type { DiagnosticCheck } from '../../../shared/types';

/**
 * The remote-control checks reach the support bundle too (WS-MEET-ENH-01
 * RC09).
 *
 * Why it matters: somebody reading "my screen cannot be shared" on the phone
 * to support, and the engineer opening their report, have to be looking at the
 * same answer. One gatherer feeds both — and a gatherer that throws must not
 * take the whole health check down with it, because the rest of the report is
 * what tells you why.
 */

const deps = (meet?: DiagnosticsDeps['meet']): DiagnosticsDeps => ({
  serverOrigin: () => null,
  timedFetch: async () => ({ ok: true, status: 200, ms: 1 }),
  signedIn: () => false,
  realtimeState: () => 'idle',
  updaterState: () => ({ state: 'IDLE', error: null, lastCheckedAt: null, channel: 'stable' }),
  services: () => ({}),
  dbCheck: () => 'ok',
  secureStorage: () => ({ available: true, backend: 'keychain', persistent: true }),
  policy: () => null,
  deviceInfo: () => ({}),
  settings: () => ({}),
  offline: () => null,
  crashes: () => ({}),
  safeMode: () => false,
  userDataPath: '/tmp',
  ...(meet ? { meet } : {}),
});

const rows: DiagnosticCheck[] = [
  { id: 'meet-screen', label: 'Screen sharing', status: 'pass', detail: '2 screens can be captured.' },
  { id: 'meet-input', label: 'Remote input', status: 'warn', detail: 'Accessibility is off.' },
];

describe('the health check', () => {
  it('carries the remote-control rows as they were measured', async () => {
    const checks = await new DiagnosticsService(deps(async () => rows)).run();

    expect(checks.filter((c) => c.id.startsWith('meet-'))).toEqual(rows);
  });

  it('keeps the rest of the report when the checks cannot be gathered', async () => {
    const checks = await new DiagnosticsService(
      deps(async () => {
        throw new Error('no capturer in this process');
      }),
    ).run();

    expect(checks.find((c) => c.id === 'meet')).toMatchObject({ status: 'skip', detail: 'no capturer in this process' });
    // The ordinary rows are still there: a failed gatherer is not a failed report.
    expect(checks.map((c) => c.id)).toContain('db');
    expect(checks.map((c) => c.id)).toContain('gpu');
  });

  it('is unchanged on a build with no gatherer wired in', async () => {
    const checks = await new DiagnosticsService(deps()).run();

    expect(checks.some((c) => c.id.startsWith('meet'))).toBe(false);
  });
});
