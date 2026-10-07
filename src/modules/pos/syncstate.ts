import type { PosTillStatus } from '@shared/pos';
import type { PosKey } from './i18n';

/**
 * What the till bar's pill says (worksuite-desktop#296): offline and how many sales wait; sending; the catalogue being
 * synced, with how far; a catalogue that has not been brought up to date for two of its intervals (or never); and only
 * then "Online · synced" — sales and catalogue both. Pure, so the rules are tested without a screen.
 */
export interface Pill {
  key: PosKey;
  vars: Record<string, string | number>;
  /** Green only when everything is up to date. */
  tone: 'online' | 'busy' | 'offline';
}

export function tillPill(s: PosTillStatus, offline: boolean): Pill {
  const online = !offline && s.reachable;
  if (!online) return { key: 'pos.bar.offline', vars: { n: s.waiting }, tone: 'offline' };
  if (s.waiting) return { key: 'pos.bar.sending', vars: { n: s.waiting }, tone: 'busy' };
  if (s.syncing) return { key: 'pos.bar.syncing', vars: { pct: s.syncing.total ? `${Math.min(99, Math.floor((s.syncing.done / Math.max(1, s.syncing.total)) * 100))}%` : '…' }, tone: 'busy' };
  if (!s.catalogue || s.catalogue.stale) return { key: 'pos.bar.stale', vars: {}, tone: 'busy' };
  return { key: 'pos.bar.online', vars: {}, tone: 'online' };
}

/** A time as the bar and the drawer show it, or null. */
export function clockOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
