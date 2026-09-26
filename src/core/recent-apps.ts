/**
 * The apps this person opened lately, newest first (App Launcher "Recent").
 * Kept on this computer only, per user: it is a convenience, and without it the
 * launcher simply shows no Recent row.
 */
export interface RecentApp {
  id: string;
  at: number;
}

const MAX = 8;
const key = (user: string | number) => `ws.recentApps.${user}`;

export function readRecentApps(user: string | number | null | undefined): RecentApp[] {
  if (user == null) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key(user)) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((r): r is RecentApp => !!r && typeof r.id === 'string' && typeof r.at === 'number') : [];
  } catch {
    return [];
  }
}

/** Puts `id` first, once; the list is capped. */
export function withRecent(list: RecentApp[], id: string, at: number): RecentApp[] {
  return [{ id, at }, ...list.filter((r) => r.id !== id)].slice(0, MAX);
}

export function noteRecentApp(user: string | number | null | undefined, id: string, at = Date.now()): void {
  if (user == null || !id) return;
  const list = readRecentApps(user);
  if (list[0]?.id === id && at - list[0].at < 60_000) return;
  try {
    localStorage.setItem(key(user), JSON.stringify(withRecent(list, id, at)));
  } catch {
    // Storage full or blocked: the Recent row is optional.
  }
}

/** "2 min ago", "1 h ago", "Yesterday", or the weekday. */
export function agoLabel(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  const today = new Date(now);
  const then = new Date(at);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000);
  if (days === 0) return `${h} h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString([], { weekday: 'long' });
  return then.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
