import { useEffect, useRef, useState } from 'react';
import {
  LEVEL_WORD,
  PING_INTERVAL_MS,
  SPEED_TEST_LIMITS,
  TRANSPORT_WORD,
  connectionLabel,
  delayText,
  durationText,
  serverLabel,
  summarizeServer,
  type ConnectionDetails,
  type ConnectionLevel,
  type ConnectionStats,
  type ConnectionSummary,
  type ServerSummary,
  type SpeedTestResult,
} from '@shared/connection';
import type { StatusSnapshot, SyncStatus } from '@shared/types';
import { app, updatePrefs } from '../core/app-state';
import { call, errorMessage } from '../core/bridge';
import { callQuality, serverOf, useConnection, useConnectionPrefs, usePoorConnectionToast, useServer, type CallQuality } from '../core/connection';
import { currentLocale } from '../core/i18n';
import { queryClient } from '../core/query';
import { useStore } from '../core/store';
import { toast } from '../core/toasts';
import { ContextMenu } from '../components/ContextMenu';
import { Icon } from '../components/Icon';
import { cx } from '../components/ui';

/**
 * Connection strength in the status bar (worksuite-desktop#254, #265): four bars and a word — "▂▄▆█ Excellent · 42 ms" —
 * in place of the old dot. The bars, the word and the colour all change with the level, so it reads without colour.
 * They are YOUR CONNECTION's, from the network delay alone; a slow WorkSuite server has its own amber marker beside
 * them — "Connection Excellent · 38 ms | Server slow · 2.1 s" — and never makes the connection Poor (#265).
 * Hover or click for the popover (your connection, the WorkSuite server, each service, Run speed test, Reconnect now,
 * Copy details); right-click for Show connection strength and Show response time in ms.
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

/**
 * Your connection in a line: "Good · 140 ms average · varies ±33 ms", "Fair · ≤ 312 ms (server check)" where only the
 * server check answered, "Poor · 2 of 3 replies lost". Stability is its own line (`stabilityLine`).
 */
export function connectionLine(s: ConnectionSummary, stats?: ConnectionStats | null): string {
  if (s.level === 'offline' || s.level === 'reconnecting' || s.level === 'checking') {
    const parts = [connectionLabel(s, false)];
    if (stats?.lastReconnectAt) parts.push(`last reconnect ${clockOf(stats.lastReconnectAt)}`);
    return parts.join(' · ');
  }
  if (s.lossy) return connectionLabel(s, true);
  const parts = [LEVEL_WORD[s.level]];
  if (s.upperBound) parts.push(`${delayText(s)} (server check)`);
  else if (s.delayMs !== null) parts.push(`${s.delayMs} ms average`);
  if (s.jitterMs !== null) parts.push(`varies ±${s.jitterMs} ms`);
  return parts.join(' · ');
}

/** "Steady", or what is not: "3 reconnects in 5 min, 1 reply lost · last reconnect 10:42". */
export function stabilityLine(s: ConnectionSummary, stats?: ConnectionStats | null): string {
  if (s.level === 'offline') return 'Offline';
  if (!s.samples) return 'Measuring…';
  const parts = [s.reasons.length ? s.reasons.join(', ') : 'Steady'];
  if (stats?.lastReconnectAt) parts.push(`last reconnect ${clockOf(stats.lastReconnectAt)}`);
  return parts.join(' · ');
}

/**
 * The server's clock in this computer's own time and zone, by name: "23:06 Sri Lanka Time" — not the server's UTC
 * (#265). `timeZone` and `locale` are for tests; null when the server has not said its time.
 */
export function serverClock(iso: string | null, opts: { timeZone?: string; locale?: string } = {}): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const locale = opts.locale ?? currentLocale();
  const base: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) };
  try {
    // "Sri Lanka Time", "New York Time": the zone's generic name (an engine without it says the offset instead).
    return new Intl.DateTimeFormat(locale, { ...base, timeZoneName: 'shortGeneric' }).format(at);
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, { ...base, timeZoneName: 'short' }).format(at);
    } catch {
      return null;
    }
  }
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

/**
 * The kind of network this computer says it is on (Wi-Fi, Ethernet…); null when it does not say. The browser's
 * "3G-class · about 0.4 Mbps" is NOT shown as a fact (#265): it is a guess from how slowly recent requests came back,
 * so a slow server makes a fast line look like 3G. The speed test measures instead; Copy details keeps the guess,
 * labelled (`networkEstimate`).
 */
export function networkLine(n: NetInfo | null): string | null {
  if (!n?.type || n.type === 'unknown') return null;
  return ({ wifi: 'Wi-Fi', ethernet: 'Ethernet', cellular: 'Mobile data', none: 'None' } as Record<string, string>)[n.type] ?? n.type;
}

/** The browser's own guess, said as one: "browser estimate, not measured: 3G-class, about 0.4 Mbps". */
export function networkEstimate(n: NetInfo | null): string | null {
  const parts = [n?.effectiveType ? `${n.effectiveType.toUpperCase()}-class` : null, n?.downlink != null ? `about ${n.downlink} Mbps` : null].filter(Boolean);
  return parts.length ? `browser estimate, not measured: ${parts.join(', ')}` : null;
}

export type Mark = 'ok' | 'warn' | 'bad' | 'off';
export interface ServiceRow {
  id: 'realtime' | 'mail' | 'files' | 'meet';
  name: string;
  mark: Mark;
  detail: string;
}

/**
 * The popover's Services, worked out from what the window already knows. Meet only while a call is on. The API is not
 * one of them: it is the WorkSuite server's section (#265).
 */
export function serviceRows(input: { status: StatusSnapshot | null; sync: SyncStatus | null; mail: { failed: number; syncing: number; total: number } | null; meet: CallQuality | null; realtimeHost?: string | null }): ServiceRow[] {
  const { status } = input;
  const rows: ServiceRow[] = [];
  const offline = status?.network === 'OFFLINE';
  const rt = status?.realtime ?? 'idle';
  // How it is connected (plan 2.7): WebSocket, its SSE fallback, or the built-in service.
  const transport = status?.connection?.transport;
  const via = transport ? ` · ${TRANSPORT_WORD[transport]}` : '';
  rows.push({
    id: 'realtime',
    name: 'Realtime',
    mark: rt === 'connected' ? 'ok' : rt === 'disabled' || rt === 'idle' ? 'off' : 'warn',
    detail:
      rt === 'connected'
        ? `Connected${input.realtimeHost ? ` · ${input.realtimeHost}` : ''}${via}`
        : rt === 'disabled'
          ? `Not on this server — checking for news on a schedule${via}`
          : rt === 'idle'
            ? 'Turned off'
            : 'Reconnecting',
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

/** How the delay is measured, in words: an HTTP check says that it includes the server's own time. */
export function probeLine(stats: ConnectionStats | null | undefined): string {
  const every = `every ${Math.round(PING_INTERVAL_MS / 1000)} s`;
  if (stats?.probe === 'realtime-echo') return `Realtime ping ${every}`;
  if (stats?.probe === 'tcp-connect') return `Network round trip (TCP connect) ${every}`;
  if (stats?.probe === 'http-health') {
    const last = stats.samples.at(-1);
    return last && !last.upper && last.ms !== null ? `Server check (HTTP) ${every}, less the server's own time` : `Server check (HTTP) ${every} — includes the server's own time, so the delay is at most this`;
  }
  return 'Not measured yet';
}

/** The WorkSuite server in a line: "Server slow · 2.1 s median", "Responding normally · 180 ms median". */
export function serverLine(s: ServerSummary): string {
  switch (s.state) {
    case 'slow':
      return `Server slow · ${durationText(s.medianMs ?? 0)} median`;
    case 'errors':
      return `Server errors · ${s.failed} of the last ${s.count} requests failed`;
    case 'ok':
      return s.medianMs !== null ? `Responding normally · ${durationText(s.medianMs)} median` : 'Responding normally';
    default:
      return 'Not enough requests yet';
  }
}

/** "2.0 s median · slowest 5% 4.3 s · last 50 requests · 1 failed". */
export function serverTimesLine(s: ServerSummary): string | null {
  if (s.medianMs === null && !s.count) return null;
  const parts: string[] = [];
  if (s.medianMs !== null) parts.push(`${durationText(s.medianMs)} median`);
  if (s.p95Ms != null) parts.push(`slowest 5% ${durationText(s.p95Ms)}`);
  parts.push(`last ${s.count} ${s.count === 1 ? 'request' : 'requests'}`);
  parts.push(s.failed ? `${s.failed} failed` : 'none failed');
  return parts.join(' · ');
}

const SERVER_MARK: Record<ServerSummary['state'], Mark> = { ok: 'ok', slow: 'warn', errors: 'warn', unknown: 'off' };

const sizeText = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

/**
 * The speed test's figures, a line each: download, upload (or why there is none — never a made-up number), and the
 * delay with how much it varies (left out with `delay: false`).
 */
export function speedFigures(r: SpeedTestResult, opts: { delay?: boolean } = {}): string[] {
  const lines: string[] = [];
  const over = r.streams && r.streams > 1 ? ` over ${r.streams} connections` : '';
  if (r.downloadMbps !== null) lines.push(`Download ${r.downloadMbps} Mbps · ${sizeText(r.downloadBytes)}${over}`);
  if (r.uploadSupported === false) lines.push('Upload test needs a newer server');
  else if (r.uploadMbps !== null) lines.push(`Upload ${r.uploadMbps} Mbps · ${sizeText(r.uploadBytes)}${over}`);
  else if (r.downloadMbps !== null) lines.push("Upload couldn't be measured");
  const delay = opts.delay !== false && r.delayMs != null ? delayText({ delayMs: r.delayMs, upperBound: !!r.delayUpperBound }) : null;
  if (delay) lines.push(`Delay ${delay}${r.jitterMs != null ? ` · varies ±${r.jitterMs} ms` : ''}`);
  return lines;
}

/** What to know about the figures: a server without a test download of its own, or no answer at all. */
export function speedNotes(r: SpeedTestResult): string[] {
  const notes: string[] = [];
  if (r.source === 'static' && r.downloadMbps !== null) notes.push('This server has no speed test download yet, so a small file was fetched again and again: a fast connection reads lower than it is.');
  if (r.error) notes.push(r.error);
  return notes;
}

/** The result in one line, for Copy details. */
export function speedLine(r: SpeedTestResult): string {
  return [...speedFigures(r), ...speedNotes(r)].join(' · ');
}

/** Copy details: the popover as plain text, for a ticket or a colleague. */
export function detailsText(input: { summary: ConnectionSummary; server?: ServerSummary; stats: ConnectionStats | null | undefined; details: ConnectionDetails | null; net: NetInfo | null; services: ServiceRow[]; speed: SpeedTestResult | null; version?: string }): string {
  const clock = serverClock(input.details?.serverTime ?? null);
  const network = [networkLine(input.net), networkEstimate(input.net)].filter(Boolean).join(' · ');
  const server = input.server ?? summarizeServer(input.stats?.api, input.summary.upperBound ? null : input.summary.delayMs);
  const times = serverTimesLine(server);
  const lines = [
    `Your connection: ${connectionLine(input.summary, input.stats)}`,
    `Measured by: ${probeLine(input.stats)}${input.stats ? ` · ${input.stats.sent} sent, ${input.stats.missed} lost since start` : ''}`,
    `Stability: ${stabilityLine(input.summary, input.stats)}`,
    `Network: ${network || 'Not reported by this computer'}`,
    `WorkSuite server: ${serverLine(server)}${times ? ` (${times})` : ''}`,
    `Server: ${input.details?.host ?? 'unknown'}${clock ? ` · server time ${clock}${input.details?.serverTime ? ` (${input.details.serverTime})` : ''}` : ''}`,
    ...input.services.map((s) => `${s.name}: ${MARK[s.mark].word} · ${s.detail}`),
  ];
  if (input.speed) lines.push(`Speed test: ${speedLine(input.speed) || 'no result'}`);
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

function Heading({ children }: { children: string }) {
  return <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{children}</div>;
}

function MarkSign({ mark }: { mark: Mark }) {
  return (
    <span className={cx('w-3 shrink-0 text-center font-bold', MARK[mark].tone)} aria-label={MARK[mark].word}>
      {MARK[mark].sign}
    </span>
  );
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
  const server = serverOf(status, summary);
  const net = networkInfo();
  const network = networkLine(net);
  const services = serviceRows({ status, sync, mail: mailSyncFromCache(), meet: meetQ, realtimeHost: details?.realtimeHost ?? null });
  const clock = serverClock(details?.serverTime ?? null);
  const times = serverTimesLine(server);

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
    const textOut = detailsText({ summary, server, stats, details, net, services, speed, version });
    void navigator.clipboard.writeText(textOut).then(
      () => toast('success', 'Connection details copied.'),
      () => toast('error', "Couldn't copy the details."),
    );
  };
  // Speed: the last test's download and upload; the delay is the line above.
  const speedRow = speed ? speedFigures(speed, { delay: false }).join(' · ') || "Couldn't be measured" : testing ? 'Measuring…' : 'Not measured — run a speed test';

  return (
    <div
      role="dialog"
      aria-label="Connection details"
      className="absolute bottom-full left-0 z-50 mb-1.5 w-[400px] max-w-[calc(100vw-32px)] rounded-[10px] border border-line bg-surface p-3.5 text-[12.5px] text-ink shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.28)]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <Heading>Your connection</Heading>
      <div className="flex items-center gap-2">
        <SignalBars summary={summary} />
        <span data-testid="connection-line">{connectionLine(summary, stats)}</span>
      </div>
      <div className="mt-0.5 text-[11.5px] text-ink-3" data-testid="connection-probe">
        {probeLine(stats)}
      </div>
      <dl className="mt-2 grid grid-cols-[84px_1fr] gap-x-2 gap-y-1">
        <dt className="text-ink-3">Stability</dt>
        <dd className="min-w-0" data-testid="connection-stability">
          {stabilityLine(summary, stats)}
        </dd>
        <dt className="text-ink-3">Speed</dt>
        <dd className="min-w-0" data-testid="connection-speed">
          {speedRow}
        </dd>
        {network ? (
          <>
            <dt className="text-ink-3">Network</dt>
            <dd className="min-w-0">{network}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-3">
        <Heading>WorkSuite server</Heading>
      </div>
      <div className="flex items-baseline gap-2" data-testid="server-line">
        <MarkSign mark={SERVER_MARK[server.state]} />
        <span>{serverLine(server)}</span>
      </div>
      <dl className="mt-1 grid grid-cols-[84px_1fr] gap-x-2 gap-y-1">
        <dt className="text-ink-3">Host</dt>
        <dd className="min-w-0 truncate">{details?.host ?? '…'}</dd>
        {clock ? (
          <>
            <dt className="text-ink-3">Server time</dt>
            <dd className="min-w-0" data-testid="server-time">
              {clock}
            </dd>
          </>
        ) : null}
        {times ? (
          <>
            <dt className="text-ink-3">Responses</dt>
            <dd className="min-w-0" data-testid="server-times">
              {times}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="mt-3">
        <Heading>Services</Heading>
      </div>
      <ul className="space-y-1">
        {services.map((s) => (
          <li key={s.id} className="flex items-baseline gap-2" data-testid={`service-${s.id}`}>
            <MarkSign mark={s.mark} />
            <span className="w-[72px] shrink-0">{s.name}</span>
            <span className="min-w-0 text-ink-2">{s.detail}</span>
          </li>
        ))}
      </ul>

      {speed ? (
        <div className="mt-3 space-y-0.5 rounded-[7px] bg-subtle px-2.5 py-1.5 text-[12px]" role="status" data-testid="speed-result">
          {speedFigures(speed).map((line) => (
            <div key={line}>{line}</div>
          ))}
          {speedNotes(speed).map((line) => (
            <div key={line} className="text-ink-3">
              {line}
            </div>
          ))}
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
      <div className="mt-2 text-[11px] text-ink-3">{SPEED_TEST_LIMITS}</div>
    </div>
  );
}

/** The status bar's item: bars and label, the server's own marker, the popover on hover or click, and the right-click settings. */
export function ConnectionStatus({ plain }: { plain: { text: string; dot: string } }) {
  const summary = useConnection();
  const server = useServer(summary);
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
  // The server's marker while the connection is up (offline or reconnecting, the server cannot be judged).
  const measured = summary.level !== 'offline' && summary.level !== 'reconnecting';
  const serverMark = prefs.show && measured ? serverLabel(server, prefs.showMs) : null;
  // Beside the server's marker, the connection says it is the connection: "Connection Excellent · 38 ms | Server slow · 2.1 s".
  const label = `${serverMark ? 'Connection ' : ''}${connectionLabel(summary, prefs.showMs)}`;
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
        aria-label={`${prefs.show ? `Your connection: ${connectionLabel(summary, prefs.showMs)}${serverMark ? `. WorkSuite server: ${serverMark}` : ''}` : `Connection: ${plain.text}`}. Show details`}
        data-testid="connection-status"
        onClick={() => setOpen((o) => (o === 'pinned' ? null : 'pinned'))}
      >
        {/* Connection strength turned off: the realtime dot and words from before (#254). */}
        {prefs.show ? <SignalBars summary={summary} /> : <span className={cx('h-2 w-2 rounded-full', plain.dot)} />}
        <span data-testid="connection-label">{prefs.show ? label : plain.text}</span>
        {serverMark ? (
          <>
            <span aria-hidden className="text-ink-3">
              |
            </span>
            <span data-testid="server-marker" data-state={server.state} className="flex items-center gap-1 font-medium text-warning">
              <Icon name="warning" size={12} className="shrink-0" />
              {serverMark}
            </span>
          </>
        ) : null}
      </button>
      {open ? <ConnectionPopover summary={summary} onClose={() => setOpen(null)} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} sections={sections} label="Status bar" onClose={() => setMenu(null)} /> : null}
    </span>
  );
}
