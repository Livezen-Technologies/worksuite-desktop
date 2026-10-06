import type { NetworkStatus, RealtimeState, StatusSnapshot } from './types';

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
  /** Support tickets needing me (optional for older callers). */
  unreadSupport?: number;
}): string {
  const parts: string[] = [];
  if (s.error) parts.push(s.error);
  if (s.offline) parts.push(s.pending > 0 ? `Offline — ${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : 'Offline');
  if (s.monitoring) parts.push(`Work session active ${s.monitoring}`);
  if (s.syncing > 0) parts.push(`Syncing ${s.syncing} file${s.syncing === 1 ? '' : 's'}`);
  const unread = s.unreadChat + s.unreadMail + s.unreadOther;
  if (unread > 0) parts.push(`${unread} unread (${s.unreadChat} chat, ${s.unreadMail} mail)`);
  if (s.unreadSupport) parts.push(`${s.unreadSupport} support ticket${s.unreadSupport === 1 ? '' : 's'} waiting`);
  if (parts.length === 0) return 'WorkSuite — all up to date';
  return `WorkSuite — ${parts.join(' · ')}`;
}

/**
 * The count on the tray, the taskbar and the Dock: unread chat and unread
 * notifications — the two red counts on the title bar. Mail is not in it: its
 * count is every unread message in every inbox the person can open, shared
 * mailboxes included, which the sidebar shows as information.
 */
export function attentionCount(chat: number, notifications: number, support = 0, supportNotices = 0): number {
  // Support tickets count by the desk's own measure (unread or newly assigned, FR-DSK-04): their notifications in the
  // bell are not counted again.
  return Math.max(0, chat || 0) + Math.max(0, (notifications || 0) - Math.max(0, supportNotices || 0)) + Math.max(0, support || 0);
}

/** OS offline evidence is separate from failure to reach the configured server. */
export function connectionLabel(status: Pick<StatusSnapshot, 'network' | 'realtime' | 'internetOnline'> | null): string {
  if (!status) return 'Checking connection…';
  if (status.internetOnline === false) return 'Internet Offline';
  if (status.network === 'OFFLINE') return 'Server Unavailable';
  if (status.realtime === 'connected') return 'Connected';
  if (status.realtime === 'disabled') return 'Connected — polling';
  if (status.realtime === 'idle') return 'Server reachable — live updates off';
  return status.network === 'LIMITED' ? 'Server Unavailable — live updates' : 'Reconnecting…';
}
