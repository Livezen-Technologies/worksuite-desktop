// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionLabel, summarizeConnection, type ConnectionSample, type ConnectionStats } from '@shared/connection';
import type { StatusSnapshot } from '@shared/types';

/**
 * Connection strength in the status bar (worksuite-desktop#254): the level from the last 30 s of pings and its
 * thresholds, the bars and label, the popover (services, Run speed test, Reconnect now, Copy details), the weak
 * connection toast after 30 s of Poor, the composer and call bar warning, and the two right-click settings.
 */
const calls = vi.hoisted(() => ({ prefs: {} as Record<string, unknown> }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async (channel: string, input?: Record<string, unknown>) => {
    if (channel === 'connection:details') return { host: 'ws.example.com', serverTime: '2026-10-05T14:02:11+05:30', realtimeHost: 'rt.example.com' };
    if (channel === 'connection:speedTest') return { downloadMbps: 92.4, uploadMbps: 31.2, downloadBytes: 25 * 1024 * 1024, uploadBytes: 10 * 1024 * 1024, streams: 4, source: 'probe', uploadSupported: true, delayMs: 140, jitterMs: 33, delayUpperBound: false, error: null };
    if (channel === 'connection:reconnect') return undefined;
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

import { call } from '../../../src/core/bridge';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import { callQuality, PoorWatcher, WEAK_CONNECTION_TOAST } from '../../../src/core/connection';
import { ConnectionStatus, connectionLine, detailsText, serverClock, serviceRows } from '../../../src/layouts/ConnectionStrength';
import { ConnectionWarning } from '../../../src/components/ConnectionWarning';
import { StatusBar } from '../../../src/layouts/StatusBar';

Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });

const NOW = new Date('2026-10-05T10:00:00Z').getTime();
const pings = (ms: (number | null)[], gap = 10_000, end = NOW): ConnectionSample[] => ms.map((m, i) => ({ at: end - (ms.length - 1 - i) * gap, ms: m, via: 'realtime-echo' }));
const stats = (ms: (number | null)[], extra: Partial<ConnectionStats> = {}): ConnectionStats => ({ probe: 'realtime-echo', samples: pings(ms), reconnects: [], lastReconnectAt: null, sent: ms.length, missed: ms.filter((m) => m === null).length, api: { medianMs: 120, count: 20, failed: 0 }, ...extra });
const level = (ms: (number | null)[], extra: Partial<ConnectionStats> = {}, rt: StatusSnapshot['realtime'] = 'connected', network: StatusSnapshot['network'] = 'ONLINE', attempt = 0) =>
  summarizeConnection({ stats: stats(ms, extra), realtime: rt, network, attempt, now: NOW });

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
  app.set({ status: snapshot({ connection: stats([40, 44, 42]) }), prefs: {} as never, sync: null, info: { version: '3.0.0' } as never });
  callQuality.set({ meet: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(toast).mockClear();
  vi.mocked(call).mockClear();
});

describe('the level', () => {
  it('follows the thresholds: Excellent, Good, Fair, Poor', () => {
    expect(level([40, 44, 42])).toMatchObject({ level: 'excellent', bars: 4, delayMs: 42 });
    expect(level([140, 150, 130])).toMatchObject({ level: 'good', bars: 3, delayMs: 140 });
    expect(level([300, 320, 310])).toMatchObject({ level: 'fair', bars: 2 });
    expect(level([700, 650, 800])).toMatchObject({ level: 'poor', bars: 1 });
  });

  // #263, #265: the level is the delay's alone, so the word always matches the number; stability is said apart.
  it('says a reconnect in 5 min, a lost reply or uneven replies as stability, without moving the level', () => {
    expect(level([40, 44, 42], { reconnects: [NOW - 60_000] })).toMatchObject({ level: 'excellent', stable: false, reasons: ['1 reconnect in 5 min'] });
    expect(level([40, null, 42])).toMatchObject({ level: 'excellent', stable: false, reasons: ['1 reply lost'] });
    expect(level([20, 200, 30])).toMatchObject({ level: 'excellent', delayMs: 83, stable: false, reasons: ['Uneven replies'] }); // varies by far more than half the average
    expect(level([40, 44, 42])).toMatchObject({ stable: true, reasons: [] });
  });

  it('is Poor when most replies are lost, said in words rather than a delay', () => {
    expect(level([40, 44, 42], { reconnects: [NOW - 60_000, NOW - 120_000, NOW - 200_000] }).level).toBe('excellent');
    const lost = level([40, null, null]);
    expect(lost).toMatchObject({ level: 'poor', lossy: true });
    expect(connectionLabel(lost, true)).toBe('Poor · 2 of 3 replies lost');
    expect(connectionLabel(level([null]), true)).toBe('Poor · no replies');
  });

  it('says Offline and Reconnecting before anything measured, with the attempt', () => {
    const off = level([40], {}, 'down', 'OFFLINE');
    expect(off).toMatchObject({ level: 'offline', bars: 0 });
    expect(connectionLabel(off, true)).toBe('Offline · working from saved data');
    const again = level([40], {}, 'down', 'RECONNECTING', 2);
    expect(again).toMatchObject({ level: 'reconnecting', bars: 0 });
    expect(connectionLabel(again, true)).toBe('Reconnecting… (attempt 2)');
  });

  it('is smoothed over the last 30 s: one slow reply does not drop it to Poor, and older pings no longer count', () => {
    // 40, 40 and one 700 ms spike: the 30 s average is 260 — Fair, not Poor.
    expect(level([40, 40, 700]).level).toBe('fair');
    // A slow minute ago is forgotten: only the window's pings count.
    const s = summarizeConnection({ stats: { ...stats([]), samples: [...pings([900, 900], 10_000, NOW - 40_000), ...pings([40, 42, 44])] }, realtime: 'connected', network: 'ONLINE', attempt: 0, now: NOW });
    expect(s).toMatchObject({ level: 'excellent', samples: 3 });
  });

  it('puts the label as "Excellent · 42 ms", without ms when that is off', () => {
    expect(connectionLabel(level([40, 44, 42]), true)).toBe('Excellent · 42 ms');
    expect(connectionLabel(level([40, 44, 42]), false)).toBe('Excellent');
    expect(connectionLine(level([100, 140, 180]), stats([100, 140, 180]))).toBe('Good · 140 ms average · varies ±33 ms');
  });
});

describe('the status bar', () => {
  it('shows the bars and the label in place of the dot, and they change with the level — not only the colour', async () => {
    render(<StatusBar />);
    const label = screen.getByTestId('connection-label');
    expect(label.textContent).toBe('Excellent · 42 ms');
    const bars = () => screen.getByTestId('connection-status').querySelector('svg')!;
    expect(bars().getAttribute('data-bars')).toBe('4');
    expect(bars().querySelectorAll('rect[data-on="1"]')).toHaveLength(4);
    act(() => app.set({ status: snapshot({ connection: stats([700, 650, 800]) }) }));
    expect(screen.getByTestId('connection-label').textContent).toBe('Poor · 717 ms');
    expect(bars().querySelectorAll('rect[data-on="1"]')).toHaveLength(1);
    expect(bars().getAttribute('class')).toContain('text-danger');
    act(() => app.set({ status: snapshot({ network: 'OFFLINE', realtime: 'down' }) }));
    expect(screen.getByTestId('connection-label').textContent).toBe('Offline · working from saved data');
    expect(bars().querySelectorAll('rect[data-on="1"]')).toHaveLength(0);
    act(() => app.set({ status: snapshot({ network: 'RECONNECTING', realtime: 'connecting', realtimeDiagnostics: { attempt: 2, lastDisconnect: null } }) }));
    expect(screen.getByTestId('connection-label').textContent).toBe('Reconnecting… (attempt 2)');
    expect(bars().querySelector('rect')!.getAttribute('class')).toContain('animate-pulse');
  });

  it('opens the popover on click: the connection, the server and its clock, the services, and its three buttons', async () => {
    app.set({ status: snapshot({ connection: stats([100, 140, 180], { lastReconnectAt: NOW - 60_000 }) }) });
    render(<ConnectionStatus plain={{ text: 'Realtime connected', dot: 'bg-success' }} />);
    fireEvent.click(screen.getByTestId('connection-status'));
    const dialog = await screen.findByRole('dialog', { name: 'Connection details' });
    expect(within(dialog).getByTestId('connection-line').textContent).toBe('Good · 140 ms average · varies ±33 ms');
    expect(within(dialog).getByTestId('connection-stability').textContent).toMatch(/^Steady · last reconnect /);
    await waitFor(() => expect(within(dialog).getByText('ws.example.com')).toBeTruthy());
    expect(within(dialog).getByTestId('server-time').textContent).toBe(serverClock('2026-10-05T14:02:11+05:30'));
    expect(within(dialog).getByTestId('server-line').textContent).toContain('Responding normally · 120 ms median');
    expect(within(dialog).getByTestId('service-realtime').textContent).toContain('Connected · rt.example.com');
    expect(within(dialog).queryByTestId('service-api')).toBeNull();
    expect(within(dialog).getByTestId('service-mail')).toBeTruthy();
    expect(within(dialog).getByTestId('service-files')).toBeTruthy();
    // Meet only while a call is on.
    expect(within(dialog).queryByTestId('service-meet')).toBeNull();
    act(() => callQuality.set({ meet: { quality: 'good', packetLossPct: null } }));
    expect(within(dialog).getByTestId('service-meet').textContent).toContain('Good call quality');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Run speed test' }));
    await waitFor(() => expect(within(dialog).getByTestId('speed-result').textContent).toContain('Download 92.4 Mbps · 25.0 MB over 4 connections'));
    expect(within(dialog).getByTestId('speed-result').textContent).toContain('Upload 31.2 Mbps · 10.0 MB over 4 connections');
    expect(within(dialog).getByTestId('speed-result').textContent).toContain('Delay 140 ms · varies ±33 ms');
    expect(within(dialog).getByTestId('connection-speed').textContent).toBe('Download 92.4 Mbps · 25.0 MB over 4 connections · Upload 31.2 Mbps · 10.0 MB over 4 connections');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reconnect now' }));
    expect(call).toHaveBeenCalledWith('connection:reconnect');
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy details' }));
    expect(write).toHaveBeenCalledTimes(1);
    const copied = (write.mock.calls[0] as unknown as [string])[0];
    expect(copied).toContain('Your connection: Good · 140 ms average');
    expect(copied).toContain('Stability: Steady');
    expect(copied).toContain('WorkSuite server: Responding normally · 120 ms median');
    expect(copied).toContain(`Server: ws.example.com · server time ${serverClock('2026-10-05T14:02:11+05:30')} (2026-10-05T14:02:11+05:30)`);
    expect(copied).toContain('Realtime: OK · Connected · rt.example.com');
    expect(copied).toContain('Speed test: Download 92.4 Mbps');
  });

  it('opens on hover too, and closes when the pointer leaves', async () => {
    render(<ConnectionStatus plain={{ text: 'Realtime connected', dot: 'bg-success' }} />);
    fireEvent.mouseEnter(screen.getByTestId('connection-status').parentElement!);
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(screen.getByRole('dialog', { name: 'Connection details' })).toBeTruthy();
    fireEvent.mouseLeave(screen.getByTestId('connection-status').parentElement!);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('right-click: Show connection strength and Show response time in ms, saved in preferences', async () => {
    const { rerender } = render(<ConnectionStatus plain={{ text: 'Realtime connected', dot: 'bg-success' }} />);
    fireEvent.contextMenu(screen.getByTestId('connection-status'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Show response time in ms/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('settings:set', { statusResponseTime: false }));
    rerender(<ConnectionStatus plain={{ text: 'Realtime connected', dot: 'bg-success' }} />);
    expect(screen.getByTestId('connection-label').textContent).toBe('Excellent');
    fireEvent.contextMenu(screen.getByTestId('connection-status'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Show connection strength/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('settings:set', { statusConnectionStrength: false }));
    expect(screen.getByTestId('connection-label').textContent).toBe('Realtime connected');
    expect(screen.getByTestId('connection-status').querySelector('svg')).toBeNull();
  });
});

describe('warnings', () => {
  it('toasts once after 30 s of Poor, and again only in a new episode', () => {
    const w = new PoorWatcher();
    expect(w.update('poor', 0)).toBe(false);
    expect(w.update('poor', 29_999)).toBe(false);
    expect(w.update('poor', 30_000)).toBe(true);
    expect(w.update('poor', 90_000)).toBe(false);
    expect(w.update('good', 95_000)).toBe(false);
    expect(w.update('poor', 100_000)).toBe(false);
    expect(w.update('poor', 130_000)).toBe(true);
  });

  it('the status bar shows the toast after 30 s of Poor, not before', async () => {
    app.set({ status: snapshot({ connection: { ...stats([]), samples: pings([700, 800, 900]) } }) });
    render(<ConnectionStatus plain={{ text: '', dot: '' }} />);
    // The pings keep coming: keep the window full while time goes by.
    const keep = (t: number) => app.set({ status: snapshot({ connection: { ...stats([]), samples: pings([700, 800, 900], 10_000, t) } }) });
    for (let s = 5; s <= 25; s += 5) {
      await act(async () => {
        keep(Date.now() + 5_000);
        await vi.advanceTimersByTimeAsync(5_000);
      });
    }
    expect(toast).not.toHaveBeenCalled();
    for (let s = 30; s <= 60; s += 5) {
      await act(async () => {
        keep(Date.now() + 5_000);
        await vi.advanceTimersByTimeAsync(5_000);
      });
    }
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('warning', WEAK_CONNECTION_TOAST, undefined, 8000, { key: 'connection-weak' });
  });

  it('the chats composer and the Meet call bar warn when Poor or Offline, and say nothing otherwise', () => {
    const { rerender } = render(<ConnectionWarning />);
    expect(screen.queryByTestId('connection-warning')).toBeNull();
    act(() => app.set({ status: snapshot({ connection: stats([700, 800, 900]) }) }));
    rerender(<ConnectionWarning />);
    expect(screen.getByTestId('connection-warning').textContent).toBe('Weak connection — messages may be delayed');
    act(() => app.set({ status: snapshot({ network: 'OFFLINE', realtime: 'down' }) }));
    rerender(<ConnectionWarning tone="dark" />);
    expect(screen.getByTestId('connection-warning').textContent).toBe('Offline — messages send when you are back online');
  });
});

describe('the popover’s parts', () => {
  it('says the server’s clock in this computer’s time and zone, by name (#265)', () => {
    const lk = { timeZone: 'Asia/Colombo', locale: 'en-GB' };
    expect(serverClock('2026-10-05T17:36:00Z', lk)).toBe('23:06 Sri Lanka Time');
    expect(serverClock('2026-10-05T14:02:11+05:30', lk)).toBe('14:02 Sri Lanka Time');
    expect(serverClock('2026-10-05T14:02:11+05:30', { timeZone: 'Europe/London', locale: 'en-GB' })).toBe('09:32 United Kingdom Time');
    expect(serverClock(null)).toBeNull();
    expect(serverClock('not a time')).toBeNull();
  });

  it('marks each service in words as well as a sign', () => {
    const rows = serviceRows({ status: snapshot({ realtime: 'disabled', connection: stats([40], { api: { medianMs: 90, count: 7, failed: 1 } }) }), sync: null, mail: { failed: 1, syncing: 0, total: 3 }, meet: null });
    // The API is the WorkSuite server's own section now (#265), not a service.
    expect(rows.map((r) => [r.id, r.mark])).toEqual([
      ['realtime', 'off'],
      ['mail', 'bad'],
      ['files', 'ok'],
    ]);
    const text = detailsText({ summary: level([40]), stats: stats([40], { api: { medianMs: 90, p95Ms: 300, count: 7, failed: 1 } }), details: null, net: null, services: rows, speed: null });
    expect(text).toContain('Mail sync: Problem · 1 of 3 accounts failed');
    expect(text).toContain('Network: Not reported by this computer');
    expect(text).toContain('WorkSuite server: Responding normally · 90 ms median (90 ms median · slowest 5% 300 ms · last 7 requests · 1 failed)');
  });
});
