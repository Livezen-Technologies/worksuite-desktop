// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVEL_BARS, connectionLabel, levelForDelay, summarizeConnection, type ConnectionSample, type ConnectionStats, type SpeedTestResult } from '@shared/connection';
import type { StatusSnapshot } from '@shared/types';

/**
 * Your connection, not the server (worksuite-desktop#265, and #263's "Poor · 309 ms"): the level on the documented
 * thresholds of the network delay alone — bars, word, colour and warnings agreeing with the number beside them; an upper
 * bound from the server check never Poor; a slow WorkSuite server as its own amber marker; the browser's network guess
 * never shown as fact; and the speed test's figures, upload included only where the server takes it.
 */
const calls = vi.hoisted(() => ({ prefs: {} as Record<string, unknown>, speed: null as unknown }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async (channel: string, input?: Record<string, unknown>) => {
    if (channel === 'connection:details') return { host: 'app.worksuite.lk', serverTime: '2026-10-05T17:36:00Z', realtimeHost: 'rt.worksuite.lk' };
    if (channel === 'connection:speedTest') return calls.speed;
    if (channel === 'settings:set') {
      calls.prefs = { ...calls.prefs, ...input };
      return { preferences: { ...calls.prefs }, locks: [] };
    }
    return undefined;
  }),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  hasDesktop: () => true,
  platform: 'linux',
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import { PoorWatcher } from '../../../src/core/connection';
import { ConnectionStatus, networkEstimate, networkLine, probeLine, serverClock, speedFigures, speedNotes } from '../../../src/layouts/ConnectionStrength';
import { ConnectionWarning } from '../../../src/components/ConnectionWarning';

Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });

const NOW = new Date('2026-10-05T17:36:00Z').getTime();
const pings = (ms: (number | null)[], via: ConnectionSample['via'] = 'realtime-echo', upper = false): ConnectionSample[] =>
  ms.map((m, i) => ({ at: NOW - (ms.length - 1 - i) * 10_000, ms: m, via, ...(upper ? { upper: true } : {}) }));
const stats = (samples: ConnectionSample[], extra: Partial<ConnectionStats> = {}): ConnectionStats => ({
  probe: samples.at(-1)?.via ?? null,
  samples,
  reconnects: [],
  lastReconnectAt: null,
  sent: samples.length,
  missed: samples.filter((s) => s.ms === null).length,
  api: { medianMs: 140, p95Ms: 380, count: 20, failed: 0 },
  ...extra,
});
const sum = (s: ConnectionStats) => summarizeConnection({ stats: s, realtime: 'connected', network: 'ONLINE', attempt: 0, now: NOW });
/** The issue's server: 2 s a request, one failed. */
const SLOW_API = { medianMs: 2_012, p95Ms: 2_267, count: 20, failed: 1 };

const snapshot = (s: Partial<StatusSnapshot> = {}): StatusSnapshot => ({
  network: 'ONLINE',
  realtime: 'connected',
  pendingChanges: 0,
  unread: { mail: 0, chat: 0, notifications: 0, tasks: 0 },
  notificationsPausedUntil: null,
  services: {},
  locked: false,
  safeMode: false,
  realtimeDiagnostics: { attempt: 0, lastDisconnect: null },
  ...s,
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  calls.prefs = {};
  calls.speed = null;
  app.set({ status: snapshot({ connection: stats(pings([38, 40, 36], 'tcp-connect'), { api: SLOW_API }) }), prefs: {} as never, sync: null, info: { version: '3.0.0' } as never });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(toast).mockClear();
  Reflect.deleteProperty(navigator, 'connection');
});

describe('the documented thresholds, on the network delay alone', () => {
  it('under 100 Excellent, 100–250 Good, 250–600 Fair, over 600 Poor — at the edges too', () => {
    expect([99, 100, 250, 251, 600, 601].map(levelForDelay)).toEqual(['excellent', 'good', 'good', 'fair', 'fair', 'poor']);
    for (const [ms, level] of [[99, 'excellent'], [100, 'good'], [250, 'good'], [251, 'fair'], [600, 'fair'], [601, 'poor']] as const) {
      const s = sum(stats(pings([ms, ms, ms])));
      expect(s).toMatchObject({ level, bars: LEVEL_BARS[level], delayMs: ms });
    }
  });

  it('312 ms is never Poor — not with three reconnects in 5 min and a lost reply either (#265)', () => {
    const s = sum(stats(pings([312, null, 312]), { reconnects: [NOW - 30_000, NOW - 90_000, NOW - 200_000] }));
    expect(s).toMatchObject({ level: 'fair', bars: 2, delayMs: 312, stable: false });
    expect(s.reasons).toEqual(['1 reply lost', '3 reconnects in 5 min']);
    expect(connectionLabel(s, true)).toBe('Fair · 312 ms');
    expect(new PoorWatcher().update(s.level, 0)).toBe(false);
  });

  it('the bars, the word, the colour and the composer warning agree with "309 ms" (#263)', () => {
    act(() => app.set({ status: snapshot({ connection: stats(pings([309, 309, 309]), { reconnects: [NOW - 60_000, NOW - 70_000, NOW - 80_000] }) }) }));
    render(
      <>
        <ConnectionStatus plain={{ text: '', dot: '' }} />
        <ConnectionWarning />
      </>,
    );
    expect(screen.getByTestId('connection-label').textContent).toBe('Fair · 309 ms');
    const bars = screen.getByTestId('connection-status').querySelector('svg')!;
    expect(bars.querySelectorAll('rect[data-on="1"]')).toHaveLength(2);
    expect(bars.getAttribute('class')).toContain('text-warning');
    expect(screen.queryByTestId('connection-warning')).toBeNull();
  });

  it('the server check alone is an upper bound: "≤", the fastest answer, and never Poor', () => {
    const slow = sum(stats(pings([312, 556, 1_400], 'http-health', true)));
    expect(slow).toMatchObject({ level: 'fair', upperBound: true, delayMs: 312, jitterMs: null });
    expect(connectionLabel(slow, true)).toBe('Fair · ≤ 312 ms');
    expect(sum(stats(pings([2_000, 2_300], 'http-health', true)))).toMatchObject({ level: 'fair', delayMs: 2_000 });
    expect(sum(stats(pings([80, 95], 'http-health', true))).level).toBe('excellent');
    // Server checks that all went unanswered (a server slower than 5 s): no delay to judge, so not Poor either.
    expect(sum(stats(pings([null, null], 'http-health', true)))).toMatchObject({ level: 'checking', delayMs: null, reasons: ['2 replies lost'] });
    // A real measurement in the window wins over the bound.
    expect(sum(stats([...pings([900], 'http-health', true), { at: NOW, ms: 40, via: 'tcp-connect' }]))).toMatchObject({ delayMs: 40, upperBound: false });
    expect(probeLine(stats(pings([312], 'http-health', true)))).toBe("Server check (HTTP) every 10 s — includes the server's own time, so the delay is at most this");
    expect(probeLine(stats(pings([40], 'http-health')))).toBe("Server check (HTTP) every 10 s, less the server's own time");
    expect(probeLine(stats(pings([38], 'tcp-connect')))).toBe('Network round trip (TCP connect) every 10 s');
    expect(probeLine(stats(pings([38])))).toBe('Realtime ping every 10 s');
  });
});

describe('your connection and the WorkSuite server, apart', () => {
  it('a fast line on a slow server: "Connection Excellent · 38 ms | Server slow · 2.0 s", the bars the connection’s', () => {
    render(
      <>
        <ConnectionStatus plain={{ text: '', dot: '' }} />
        <ConnectionWarning />
      </>,
    );
    expect(screen.getByTestId('connection-label').textContent).toBe('Connection Excellent · 38 ms');
    const marker = screen.getByTestId('server-marker');
    expect(marker.textContent).toBe('Server slow · 2.0 s');
    expect(marker.className).toContain('text-warning');
    expect(screen.getByTestId('connection-status').querySelector('svg')!.querySelectorAll('rect[data-on="1"]')).toHaveLength(4);
    expect(screen.getByTestId('connection-status').getAttribute('aria-label')).toBe('Your connection: Excellent · 38 ms. WorkSuite server: Server slow · 2.0 s. Show details');
    expect(screen.queryByTestId('connection-warning')).toBeNull();
  });

  it('no marker for a server that answers in time, or while offline; without ms when that is off', async () => {
    act(() => app.set({ status: snapshot({ connection: stats(pings([38, 40, 36], 'tcp-connect')) }) }));
    const { rerender } = render(<ConnectionStatus plain={{ text: '', dot: '' }} />);
    expect(screen.getByTestId('connection-label').textContent).toBe('Excellent · 38 ms');
    expect(screen.queryByTestId('server-marker')).toBeNull();
    act(() => app.set({ status: snapshot({ network: 'OFFLINE', realtime: 'down', connection: stats(pings([38]), { api: SLOW_API }) }) }));
    expect(screen.queryByTestId('server-marker')).toBeNull();
    act(() => app.set({ status: snapshot({ connection: stats(pings([38, 40, 36], 'tcp-connect'), { api: SLOW_API }) }), prefs: { statusResponseTime: false } as never }));
    rerender(<ConnectionStatus plain={{ text: '', dot: '' }} />);
    expect(screen.getByTestId('connection-label').textContent).toBe('Connection Excellent');
    expect(screen.getByTestId('server-marker').textContent).toBe('Server slow');
  });

  it('the popover: your connection, then the WorkSuite server with its median, slowest 5% and errors, and its time in this computer’s zone', async () => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { effectiveType: '3g', downlink: 0.4 } });
    render(<ConnectionStatus plain={{ text: '', dot: '' }} />);
    fireEvent.click(screen.getByTestId('connection-status'));
    const dialog = await screen.findByRole('dialog', { name: 'Connection details' });
    expect(within(dialog).getByText('Your connection')).toBeTruthy();
    expect(within(dialog).getByText('WorkSuite server')).toBeTruthy();
    expect(within(dialog).getByTestId('connection-line').textContent).toBe('Excellent · 38 ms average · varies ±2 ms');
    expect(within(dialog).getByTestId('connection-probe').textContent).toBe('Network round trip (TCP connect) every 10 s');
    expect(within(dialog).getByTestId('connection-stability').textContent).toBe('Steady');
    expect(within(dialog).getByTestId('connection-speed').textContent).toBe('Not measured — run a speed test');
    const server = within(dialog).getByTestId('server-line');
    expect(server.textContent).toContain('Server slow · 2.0 s median');
    expect(within(server).getByLabelText('Warning')).toBeTruthy();
    expect(within(dialog).getByTestId('server-times').textContent).toBe('2.0 s median · slowest 5% 2.3 s · last 20 requests · 1 failed');
    await waitFor(() => expect(within(dialog).getByTestId('server-time')).toBeTruthy());
    expect(within(dialog).getByTestId('server-time').textContent).toBe(serverClock('2026-10-05T17:36:00Z'));
    // The browser's guess is not shown as fact.
    expect(dialog.textContent).not.toMatch(/3G|0\.4 Mbps/);
  });

  it('the speed test: download over four connections; no upload figure without the server’s sink — said so', async () => {
    calls.speed = { downloadMbps: 2.9, uploadMbps: null, downloadBytes: 6 * 1024 * 1024, uploadBytes: 0, streams: 4, source: 'static', uploadSupported: false, delayMs: 38, jitterMs: 2, delayUpperBound: false, error: null } satisfies SpeedTestResult;
    render(<ConnectionStatus plain={{ text: '', dot: '' }} />);
    fireEvent.click(screen.getByTestId('connection-status'));
    const dialog = await screen.findByRole('dialog', { name: 'Connection details' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run speed test' }));
    await waitFor(() => expect(within(dialog).getByTestId('speed-result')).toBeTruthy());
    const result = within(dialog).getByTestId('speed-result').textContent!;
    expect(result).toContain('Download 2.9 Mbps · 6.0 MB over 4 connections');
    expect(result).toContain('Upload test needs a newer server');
    expect(result).toContain('Delay 38 ms · varies ±2 ms');
    expect(result).toContain('This server has no speed test download yet');
    expect(result).not.toMatch(/Upload \d/);
    expect(within(dialog).getByTestId('connection-speed').textContent).toBe('Download 2.9 Mbps · 6.0 MB over 4 connections · Upload test needs a newer server');
    expect(within(dialog).getByText(/downloads up to 25 MB and uploads up to 20 MB over 4 connections, 8 s at most each way/)).toBeTruthy();
  });
});

describe('the parts', () => {
  it('shows the kind of network only when the computer says it, and the browser’s guess only labelled as one', () => {
    expect(networkLine({ type: null, effectiveType: '3g', downlink: 0.4 })).toBeNull();
    expect(networkLine({ type: 'wifi', effectiveType: '3g', downlink: 0.4 })).toBe('Wi-Fi');
    expect(networkEstimate({ type: null, effectiveType: '3g', downlink: 0.4 })).toBe('browser estimate, not measured: 3G-class, about 0.4 Mbps');
    expect(networkEstimate(null)).toBeNull();
  });

  it('the speed figures say an upload that failed, a bounded delay, and a test that reached nothing', () => {
    const base: SpeedTestResult = { downloadMbps: 92.4, uploadMbps: null, downloadBytes: 25 * 1024 * 1024, uploadBytes: 0, streams: 4, source: 'probe', uploadSupported: true, delayMs: 312, jitterMs: null, delayUpperBound: true, error: null };
    expect(speedFigures(base)).toEqual(['Download 92.4 Mbps · 25.0 MB over 4 connections', "Upload couldn't be measured", 'Delay ≤ 312 ms']);
    expect(speedNotes(base)).toEqual([]);
    const none: SpeedTestResult = { ...base, downloadMbps: null, downloadBytes: 0, source: null, uploadSupported: null, delayMs: null, error: "Couldn't reach the server for a speed test." };
    expect(speedFigures(none)).toEqual([]);
    expect(speedNotes(none)).toEqual(["Couldn't reach the server for a speed test."]);
  });
});
