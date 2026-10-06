import { useEffect, useMemo, useRef, useState } from 'react';
import { POOR_TOAST_AFTER_MS, summarizeConnection, summarizeServer, type ConnectionSummary, type ServerSummary } from '@shared/connection';
import type { StatusSnapshot } from '@shared/types';
import { app } from './app-state';
import { createStore, useStore } from './store';
import { toast } from './toasts';

/**
 * Connection strength in the renderer (worksuite-desktop#254, #265): the main process's measurements, on the status
 * snapshot, turned into a level here — your connection's, from the network delay alone, and the WorkSuite server's
 * apart. The window slides with the clock, so the level is re-worked every few seconds even when no new ping has come
 * in.
 */
export const REFRESH_MS = 5_000;

export function summaryOf(status: StatusSnapshot | null | undefined, now: number): ConnectionSummary {
  return summarizeConnection({
    stats: status?.connection,
    realtime: status?.realtime ?? 'idle',
    network: status?.network ?? 'ONLINE',
    internetOnline: status?.internetOnline,
    attempt: status?.realtimeDiagnostics?.attempt ?? 0,
    now,
  });
}

/** The network delay the server is judged net of: a measured one, never an upper bound with the server's time in it. */
const netDelay = (c: ConnectionSummary | null | undefined): number | null => (c && !c.upperBound ? c.delayMs : null);

/** How the WorkSuite server is answering (#265): its own marker, never part of the connection's level. */
export function serverOf(status: StatusSnapshot | null | undefined, connection?: ConnectionSummary | null): ServerSummary {
  return summarizeServer(status?.connection?.api, netDelay(connection));
}

/** A clock that ticks every `ms`. */
export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useConnection(): ConnectionSummary {
  const status = useStore(app, (s) => s.status);
  const now = useTick(REFRESH_MS);
  return useMemo(() => summaryOf(status, now), [status, now]);
}

export function useServer(connection: ConnectionSummary): ServerSummary {
  const api = useStore(app, (s) => s.status?.connection?.api);
  const delay = netDelay(connection);
  return useMemo(() => summarizeServer(api, delay), [api, delay]);
}

/** The status bar's two settings (right-click it): both on unless turned off. */
export function useConnectionPrefs(): { show: boolean; showMs: boolean } {
  const show = useStore(app, (s) => s.prefs?.statusConnectionStrength !== false);
  const showMs = useStore(app, (s) => s.prefs?.statusResponseTime !== false);
  return { show, showMs };
}

export const WEAK_CONNECTION_TOAST = 'Your connection is weak. Messages may be delayed.';

/**
 * Poor for POOR_TOAST_AFTER_MS → one toast, once per episode. An episode ends when the level is anything but Poor
 * (Offline and Reconnecting have their own words in the status bar, and end it too).
 */
export class PoorWatcher {
  private since: number | null = null;
  private told = false;

  /** True exactly once per episode, when the toast is due. */
  update(level: ConnectionSummary['level'], now: number): boolean {
    if (level !== 'poor') {
      this.since = null;
      this.told = false;
      return false;
    }
    this.since ??= now;
    if (!this.told && now - this.since >= POOR_TOAST_AFTER_MS) {
      this.told = true;
      return true;
    }
    return false;
  }
}

export function usePoorConnectionToast(summary: ConnectionSummary): void {
  const watcher = useRef<PoorWatcher | null>(null);
  watcher.current ??= new PoorWatcher();
  const now = useTick(REFRESH_MS);
  useEffect(() => {
    if (watcher.current!.update(summary.level, Date.now())) toast('warning', WEAK_CONNECTION_TOAST, undefined, 8000, { key: 'connection-weak' });
  }, [summary.level, now]);
}

/** A call in this window, for the popover's Meet row (only while one is on). Packet loss when the call exposes it. */
export interface CallQuality {
  quality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
  packetLossPct: number | null;
}
export const callQuality = createStore<{ meet: CallQuality | null }>({ meet: null });
