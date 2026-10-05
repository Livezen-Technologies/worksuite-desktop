import { useEffect, useRef, useState } from 'react';
import { LEVEL_WORD, PING_INTERVAL_MS, connectionLabel, type ConnectionDetails, type ConnectionLevel, type ConnectionStats, type ConnectionSummary, type SpeedTestResult } from '@shared/connection';
import type { StatusSnapshot, SyncStatus } from '@shared/types';
import { app, updatePrefs } from '../core/app-state';
import { call, errorMessage } from '../core/bridge';
import { callQuality, useConnection, useConnectionPrefs, usePoorConnectionToast, type CallQuality } from '../core/connection';
import { currentLocale } from '../core/i18n';
import { queryClient } from '../core/query';
import { useStore } from '../core/store';
import { toast } from '../core/toasts';
import { ContextMenu } from '../components/ContextMenu';
import { cx } from '../components/ui';

/**
 * Connection strength in the status bar (worksuite-desktop#254): four bars and a word — "▂▄▆█ Excellent · 42 ms" —
 * in place of the old dot. The bars, the word and the colour all change with the level, so it reads without colour.
 * Hover or click for the popover (the connection in numbers, the server, the network, each service, Run speed test,
 * Reconnect now, Copy details); right-click for Show connection strength and Show response time in ms.
 */

const TONE: Record<ConnectionLevel, string> = {
  excellent: 'text-success',
  good: 'text-success',
  fair: 'text-warning',
  poor: 'text-danger',
  offline: 'text-ink-3',
  reconnecting: 'text-warning',
  checking: 'text-ink-3',
};

/** Four rising bars, `bars` of them filled; the rest drawn faint. Reconnecting pulses through them. */
export function SignalBars({ summary, className }: { summary: ConnectionSummary; className?: string }) {
  const filled = summary.level === 'checking' ? 4 : summary.bars;
  const animated = summary.level === 'reconnecting';
  return (
    <svg
      viewBox="0 0 16 12"
      width={16}
      height={12}
      aria-hidden
      data-bars={summary.bars}
      data-level={summary.level}
      className={cx('shrink-0', TONE[summary.level], className)}
    >
      {[0, 1, 2, 3].map((i) => {
        const h = 3 + i * 3;
        const on = animated ? true : i < filled;
        return (
          <rect
            key={i}
            x={i * 4}
            y={12 - h}
            width={3}
            height={h}
            rx={0.6}
            fill="currentColor"
            opacity={on ? 1 : 0.22}
            className={animated ? 'animate-pulse' : undefined}
            style={animated ? { animationDelay: `${i * 150}ms` } : undefined}
            data-on={on ? '1' : '0'}
          />
        );
      })}
    </svg>
  );
}

const clockOf = (ms: number): string => new Date(ms).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });

/** "Good · 140 ms average · varies ±35 ms · last reconnect 10:42". */
export function connectionLine(s: ConnectionSummary, stats: ConnectionStats | null | undefined): string {
  if (s.level === 'offline' || s.level === 'reconnecting' || s.level === 'checking') {
    const parts = [connectionLabel(s, false)];
    if (stats?.lastReconnectAt) parts.push(`last reconnect ${clockOf(stats.lastReconnectAt)}`);
    return parts.join(' · ');
  }
  const parts = [LEVEL_WORD[s.level]];
  if (s.avgMs !== null) parts.push(`${s.avgMs} ms average`);
  if (s.jitterMs !== null) parts.push(`varies ±${s.jitterMs} ms`);
  if (s.missed) parts.push(s.missed === 1 ? '1 reply lost' : `${s.missed} replies lost`);
  if (stats?.lastReconnectAt) parts.push(`last reconnect ${clockOf(stats.lastReconnectAt)}`);
  return parts.join(' · ');
}

/** "14:02 (UTC+05:30)" from the server's ISO time. */
export function serverClock(iso: string | null): string | null {
  if (!iso) return null;
  const m = /T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(iso);
  if (!m) return null;
  const off = !m[2] || m[2] === 'Z' ? 'UTC' : `UTC${m[2].length === 5 ? `${m[2].slice(0, 3)}:${m[2].slice(3)}` : m[2]}`;
  return `${m[1]} (${off})`;
}

interface NetInfo {
  type: string | null;
  effectiveType: string | null;
  downlink: number | null;
}

/** `navigator.connection`, when the platform has it. */
export function networkInfo(): NetInfo | null {
  const c = (globalThis.navigator as Navigator & { connection?: { type?: string; effectiveType?: string; downlink?: number } } | undefined)?.connection;
  if (!c) return null;
  return { type: c.type ?? null, effectiveType: c.effectiveType ?? null, downlink: typeof c.downlink === 'number' ? c.downlink : null };
}

export function networkLine(n: NetInfo | null): string {
  if (!n) return 'Not reported by this computer';
  const kind = n.type && n.type !== 'unknown' ? ({ wifi: 'Wi-Fi', ethernet: 'Ethernet', cellular: 'Mobile data', none: 'None' } as Record<string, string>)[n.type] ?? n.type : null;
  const parts = [kind, n.effectiveType ? `${n.effectiveType.toUpperCase()}-class` : null, n.downlink !== null ? `about ${n.downlink} Mbps down` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Not reported by this computer';
}

export type Mark = 'ok' | 'warn' | 'bad' | 'off';
export interface ServiceRow {
  id: 'realtime' | 'api' | 'mail' | 'files' | 'meet';
  name: string;
  mark: Mark;
  detail: string;
}

/** The popover's Services, worked out from what the window already knows. Meet only while a call is on. */
export function serviceRows(input: { status: StatusSnapshot | null; sync: SyncStatus | null; mail: { failed: number; syncing: number; total: number } | null; meet: CallQuality | null; realtimeHost?: string | null }): ServiceRow[] {
  const { status } = input;
  const rows: ServiceRow[] = [];
  const offline = status?.network === 'OFFLINE';
  const rt = status?.realtime ?? 'idle';
  rows.push({
    id: 'realtime',
    name: 'Realtime',
    mark: rt === 'connected' ? 'ok' : rt === 'disabled' || rt === 'idle' ? 'off' : 'warn',
    detail:
      rt === 'connected'
        ? `Connected${input.realtimeHost ? ` · ${input.realtimeHost}` : ''}`
        : rt === 'disabled'
          ? 'Not on this server — checking for news on a schedule'
          : rt === 'idle'
            ? 'Turned off'
            : 'Reconnecting',
  });
  const api = status?.connection?.api;
  rows.push({
    id: 'api',
    name: 'API',
    mark: offline ? 'bad' : api && api.failed > api.count / 2 ? 'warn' : 'ok',
    detail: offline ? 'Unreachable' : api?.medianMs != null ? `${api.medianMs} ms median of the last ${Math.min(api.count, 20)} requests${api.failed ? ` · ${api.failed} failed` : ''}` : 'Reachable',
  });
  const m = input.mail;
  rows.push({
    id: 'mail',
    name: 'Mail sync',
    mark: !m ? 'off' : offline ? 'warn' : m.failed ? 'bad' : 'ok',
    detail: !m ? 'Shown once Mail has been opened' : offline ? 'Waiting for the connection' : m.failed ? `${m.failed} of ${m.total} accounts failed` : m.syncing ? `Syncing ${m.syncing} of ${m.total} accounts` : m.total ? 'Up to date' : 'No accounts sync',
  });
  const s = input.sync;
  const filesBad = s?.state === 'error' || s?.state === 'blocked' || s?.state === 'disconnected';
  rows.push({
    id: 'files',
    name: 'Files',
    mark: offline ? 'warn' : filesBad ? 'bad' : s?.state === 'paused' ? 'off' : 'ok',
    detail: offline ? 'Waiting for the connection' : !s || !s.available || !s.folders.length ? 'Online' : filesBad ? 'Sync needs attention' : s.state === 'paused' ? 'Sync paused' : s.state === 'syncing' ? 'Syncing' : 'Up to date',
  });
  if (input.meet) {
    const q = input.meet.quality;
    rows.push({
      id: 'meet',
      name: 'Meet',
      mark: q === 'excellent' || q === 'good' ? 'ok' : q === 'poor' ? 'warn' : q === 'lost' ? 'bad' : 'off',
      detail: `${{ excellent: 'Excellent', good: 'Good', poor: 'Poor', lost: 'Lost', unknown: 'Measuring' }[q]} call quality${input.meet.packetLossPct !== null ? ` · ${input.meet.packetLossPct}% packet loss` : ''}`,
    });
  }
  return rows;
}

const MARK: Record<Mark, { sign: string; word: string; tone: string }> = {
  ok: { sign: '✓', word: 'OK', tone: 'text-success' },
  warn: { sign: '!', word: 'Warning', tone: 'text-warning' },
  bad: { sign: '✕', word: 'Problem', tone: 'text-danger' },
  off: { sign: '–', word: 'Off', tone: 'text-ink-3' },
};

export function probeLine(stats: ConnectionStats | null | undefined): string {
  const every = `every ${Math.round(PING_INTERVAL_MS / 1000)} s`;
  if (stats?.probe === 'realtime-echo') return `Realtime ping ${every}`;
  if (stats?.probe === 'http-health') return `Server check (HTTP) ${every}`;
  return 'Not measured yet';
}

export function speedLine(r: SpeedTestResult): string {
  const parts: string[] = [];
  if (r.downloadMbps !== null) parts.push(`Download ${r.downloadMbps} Mbps (${Math.round(r.downloadBytes / 1024)} KB)`);
  if (r.uploadMbps !== null) parts.push(`Upload ${r.uploadMbps} Mbps (${Math.round(r.uploadBytes / 1024)} KB)`);
  return parts.join(' · ');
}

/** Copy details: the popover as plain text, for a ticket or a colleague. */
export function detailsText(input: { summary: ConnectionSummary; stats: ConnectionStats | null | undefined; details: ConnectionDetails | null; net: NetInfo | null; services: ServiceRow[]; speed: SpeedTestResult | null; version?: string }): string {
  const lines = [
    `Connection: ${connectionLine(input.summary, input.stats)}`,
    `Measured by: ${probeLine(input.stats)}${input.stats ? ` · ${input.stats.sent} sent, ${input.stats.missed} lost since start` : ''}`,
    `Server: ${input.details?.host ?? 'unknown'}${serverClock(input.details?.serverTime ?? null) ? ` · server time ${serverClock(input.details?.serverTime ?? null)}` : ''}`,
    `Network: ${networkLine(input.net)}`,
    ...input.services.map((s) => `${s.name}: ${MARK[s.mark].word} · ${s.detail}`),
  ];
  if (input.speed) lines.push(`Speed test: ${speedLine(input.speed) || input.speed.error || 'no result'}`);
  if (input.version) lines.push(`WorkSuite Desktop ${input.version}`);
  lines.push(`At: ${new Date().toISOString()}`);
  return lines.join('\n');
}

/** Mail sync as Mail last read it (its own query), without asking the server for it from here. */
function mailSyncFromCache(): { failed: number; syncing: number; total: number } | null {
  const data = queryClient.getQueryData<{ accounts?: { paused: boolean; running: boolean; last_result: string }[] }>(['mail', 'sync']);
  const accounts = data?.accounts;
  if (!accounts) return null;
  const active = accounts.filter((a) => !a.paused);
  return { failed: active.filter((a) => !a.running && a.last_result === 'failed').length, syncing: active.filter((a) => a.running).length, total: active.length };
}

export function ConnectionPopover({ summary, onClose }: { summary: ConnectionSummary; onClose: () => void }) {
  const status = useStore(app, (s) => s.status);
  const sync = useStore(app, (s) => s.sync);
  const version = useStore(app, (s) => s.info?.version);
  const meetQ = useStore(callQuality, (s) => s.meet);
  const [details, setDetails] = useState<ConnectionDetails | null>(null);
  const [speed, setSpeed] = useState<SpeedTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    let live = true;
    call('connection:details').then(
      (d) => live && setDetails(d),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const stats = status?.connection;
  const net = networkInfo();
  const services = serviceRows({ status, sync, mail: mailSyncFromCache(), meet: meetQ, realtimeHost: details?.realtimeHost ?? null });
  const clock = serverClock(details?.serverTime ?? null);

  const runSpeed = () => {
    setTesting(true);
    call('connection:speedTest').then(
      (r) => {
        setSpeed(r);
        setTesting(false);
      },
      (e) => {
        setTesting(false);
        toast('error', errorMessage(e));
      },
    );
  };
  const reconnect = () => {
    setReconnecting(true);
    call('connection:reconnect').then(
      () => setReconnecting(false),
      (e) => {
        setReconnecting(false);
        toast('error', errorMessage(e));
      },
    );
  };
  const copy = () => {
    const textOut = detailsText({ summary, stats, details, net, services, speed, version });
    void navigator.clipboard.writeText(textOut).then(
      () => toast('success', 'Connection details copied.'),
      () => toast('error', "Couldn't copy the details."),
    );
  };

  return (
    <div
      role="dialog"
      aria-label="Connection details"
      className="absolute bottom-full left-0 z-50 mb-1.5 w-[380px] max-w-[calc(100vw-32px)] rounded-[10px] border border-line bg-surface p-3.5 text-[12.5px] text-ink shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.28)]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Connection</div>
      <div className="flex items-center gap-2">
        <SignalBars summary={summary} />
        <span data-testid="connection-line">{connectionLine(summary, stats)}</span>
      </div>
      <div className="mt-0.5 text-[11.5px] text-ink-3">{probeLine(stats)}{summary.reasons.length && summary.level !== 'offline' && summary.level !== 'reconnecting' ? ` · ${summary.reasons.join(', ')}` : ''}</div>

      <dl className="mt-3 grid grid-cols-[80px_1fr] gap-x-2 gap-y-1">
        <dt className="text-ink-3">Server</dt>
        <dd className="min-w-0 truncate">{details?.host ?? '…'}{clock ? ` · ${clock}` : ''}</dd>
        <dt className="text-ink-3">Network</dt>
        <dd className="min-w-0">{networkLine(net)}</dd>
      </dl>

      <div className="mt-3 mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Services</div>
      <ul className="space-y-1">
        {services.map((s) => (
          <li key={s.id} className="flex items-baseline gap-2" data-testid={`service-${s.id}`}>
            <span className={cx('w-3 shrink-0 text-center font-bold', MARK[s.mark].tone)} aria-label={MARK[s.mark].word}>
              {MARK[s.mark].sign}
            </span>
            <span className="w-[72px] shrink-0">{s.name}</span>
            <span className="min-w-0 text-ink-2">{s.detail}</span>
          </li>
        ))}
      </ul>

      {speed ? (
        <div className="mt-3 rounded-[7px] bg-subtle px-2.5 py-1.5 text-[12px]" role="status">
          {speedLine(speed) ? <div>{speedLine(speed)}</div> : null}
          {speed.error ? <div className="text-ink-3">{speed.error}</div> : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" className="h-7 rounded-[7px] border border-line px-2.5 font-semibold hover:bg-subtle disabled:opacity-60" disabled={testing} onClick={runSpeed}>
          {testing ? 'Testing…' : 'Run speed test'}
        </button>
        <button type="button" className="h-7 rounded-[7px] border border-line px-2.5 font-semibold hover:bg-subtle disabled:opacity-60" disabled={reconnecting} onClick={reconnect}>
          Reconnect now
        </button>
        <button type="button" className="h-7 rounded-[7px] border border-line px-2.5 font-semibold hover:bg-subtle" onClick={copy}>
          Copy details
        </button>
      </div>
      <div className="mt-2 text-[11px] text-ink-3">The speed test is small: about 0.5 MB down and 0.2 MB up.</div>
    </div>
  );
}

/** The status bar's item: bars and label, the popover on hover or click, and the right-click settings. */
export function ConnectionStatus({ plain }: { plain: { text: string; dot: string } }) {
  const summary = useConnection();
  const prefs = useConnectionPrefs();
  usePoorConnectionToast(summary);
  const [open, setOpen] = useState<'hover' | 'pinned' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open !== 'pinned') return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const hover = (on: boolean) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen((o) => (o === 'pinned' ? o : on ? 'hover' : null)), on ? 350 : 200);
  };
  const label = connectionLabel(summary, prefs.showMs);
  const sections = [
    {
      id: 'connection',
      items: [
        { id: 'strength', label: 'Show connection strength', checked: prefs.show, onSelect: () => void updatePrefs({ statusConnectionStrength: !prefs.show }).catch((e: unknown) => toast('error', errorMessage(e))) },
        { id: 'ms', label: 'Show response time in ms', checked: prefs.showMs, disabled: !prefs.show, onSelect: () => void updatePrefs({ statusResponseTime: !prefs.showMs }).catch((e: unknown) => toast('error', errorMessage(e))) },
      ],
    },
  ];

  return (
    <span
      ref={root}
      className="relative flex items-center"
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(null);
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 hover:text-ink"
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-label={`Connection: ${prefs.show ? label : plain.text}. Show details`}
        data-testid="connection-status"
        onClick={() => setOpen((o) => (o === 'pinned' ? null : 'pinned'))}
      >
        {/* Connection strength turned off: the realtime dot and words from before (#254). */}
        {prefs.show ? <SignalBars summary={summary} /> : <span className={cx('h-2 w-2 rounded-full', plain.dot)} />}
        <span data-testid="connection-label">{prefs.show ? label : plain.text}</span>
      </button>
      {open ? <ConnectionPopover summary={summary} onClose={() => setOpen(null)} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} sections={sections} label="Status bar" onClose={() => setMenu(null)} /> : null}
    </span>
  );
}
