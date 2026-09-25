import type { NetworkStatus, RealtimeState } from './types';

/**
 * Network status (FR-OFF-05, §6 state models):
 *   ONLINE        API reachable and realtime connected (or intentionally off)
 *   RECONNECTING  API reachable, realtime being re-established
 *   LIMITED       API reachable, realtime down for a while
 *   OFFLINE       API unreachable
 *
 * An installation that does not run the realtime gateway is ONLINE: nothing
 * is missing, the app polls instead.
 */
export function networkStatus(apiReachable: boolean, realtime: RealtimeState, realtimeDownSinceMs: number | null, now = Date.now()): NetworkStatus {
  if (!apiReachable) return 'OFFLINE';
  if (realtime === 'connected' || realtime === 'disabled' || realtime === 'idle') return 'ONLINE';
  if (realtime === 'connecting') return 'RECONNECTING';
  // down
  if (realtimeDownSinceMs !== null && now - realtimeDownSinceMs > 60_000) return 'LIMITED';
  return 'RECONNECTING';
}

/** Tray icon state priority (§4.7): Error > Offline > Monitoring > Syncing > Unread > Normal. */
export type TrayState = 'error' | 'offline' | 'monitoring' | 'syncing' | 'unread' | 'normal';

export function trayState(s: { error: boolean; offline: boolean; monitoring: boolean; syncing: boolean; unread: number }): TrayState {
  if (s.error) return 'error';
  if (s.offline) return 'offline';
  if (s.monitoring) return 'monitoring';
  if (s.syncing) return 'syncing';
  if (s.unread > 0) return 'unread';
  return 'normal';
}

export function trayTooltip(s: {
  error: string | null;
  offline: boolean;
  pending: number;
  monitoring: string | null;
  syncing: number;
  unreadChat: number;
  unreadMail: number;
  unreadOther: number;
}): string {
  const parts: string[] = [];
  if (s.error) parts.push(s.error);
  if (s.offline) parts.push(s.pending > 0 ? `Offline — ${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : 'Offline');
  if (s.monitoring) parts.push(`Work session active ${s.monitoring}`);
  if (s.syncing > 0) parts.push(`Syncing ${s.syncing} file${s.syncing === 1 ? '' : 's'}`);
  const unread = s.unreadChat + s.unreadMail + s.unreadOther;
  if (unread > 0) parts.push(`${unread} unread (${s.unreadChat} chat, ${s.unreadMail} mail)`);
  if (parts.length === 0) return 'WorkSuite — all up to date';
  return `WorkSuite — ${parts.join(' · ')}`;
}
