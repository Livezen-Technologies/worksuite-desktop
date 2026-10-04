import type { NetworkStatus } from '@shared/types';

export type ShownPresence = 'online' | 'busy' | 'dnd' | 'away' | 'offline';

const SHOWN = new Set<ShownPresence>(['online', 'busy', 'dnd', 'away', 'offline']);
/** What the person chose in Show me as, as it shows. */
const CHOSEN: Record<string, ShownPresence> = { available: 'online', busy: 'busy', dnd: 'dnd', away: 'away', offline: 'offline' };

/** How each shown status is said and coloured: the account menu, and the tray's mini-dashboard header (MAP-UI-05). */
export const PRESENCE_SHOWN: Record<ShownPresence, { label: string; dot: string }> = {
  online: { label: 'Online', dot: '#22A861' },
  busy: { label: 'Busy', dot: '#D92D20' },
  dnd: { label: 'Do not disturb', dot: '#D92D20' },
  away: { label: 'Away', dot: '#F79009' },
  offline: { label: 'Offline', dot: '#8A91A5' },
};

/**
 * How the account menu shows the person (worksuite-desktop#150), from the same connection the title bar's pill reads:
 *
 *  · not connected (the pill says Offline): Offline;
 *  · connected, the server's status for them — except that it says offline only when they chose Appear offline.
 *    Otherwise "offline" just means the server has not yet had this computer's presence heartbeat (it was signed in or
 *    unlocked a moment ago, or was locked), so what they chose is shown, never a grey Offline beside an Online pill.
 *
 * Nothing when there is no presence (no Chat app).
 */
export function shownPresence(presence: { status?: string | null; choice?: string | null } | null | undefined, network: NetworkStatus | null | undefined): ShownPresence | null {
  if (!presence) return null;
  if (network === 'OFFLINE') return 'offline';
  const status = SHOWN.has(presence.status as ShownPresence) ? (presence.status as ShownPresence) : null;
  const chosen = CHOSEN[presence.choice ?? 'available'] ?? 'online';
  if (status === 'offline' || status === null) return chosen;
  return status;
}
