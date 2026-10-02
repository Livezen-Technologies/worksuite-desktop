import type { Preferences } from './types';

/**
 * Why this computer is not showing notification banners, in words — or null
 * when it is (worksuite-desktop#97).
 *
 * A banner that never appears looks exactly like a notification that was never
 * sent. Every reason the desktop holds one back is a choice somebody made (here
 * or on the system), so the settings say which, and what undoes it, instead of
 * leaving the person to guess why a meeting invitation only reached the bell.
 */

/** Whether `now` falls inside a do-not-disturb window that may cross midnight. */
export function inDnd(from: string, to: string, now: Date): boolean {
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const f = toMin(from);
  const t = toMin(to);
  const n = now.getHours() * 60 + now.getMinutes();
  if (f === t) return false;
  return f < t ? n >= f && n < t : n >= f || n < t;
}

export interface BannerState {
  /** The operating system lets this app show notifications at all. */
  supported: boolean;
  pausedUntil: string | null;
  now: Date;
}

type BannerPrefs = Pick<Preferences, 'notificationsEnabled' | 'backgroundServices' | 'dndEnabled' | 'dndFrom' | 'dndTo' | 'moduleNotifications'>;

/**
 * Why banners are blocked, for everything or — given `category` — for that
 * kind of notification (`calendar` for meeting invitations and reminders).
 */
export function bannerBlock(p: BannerPrefs, s: BannerState, category?: string): string | null {
  if (!s.supported) return 'This computer’s system settings do not let WorkSuite show notifications. Allow them for WorkSuite in the system’s notification settings.';
  if (!p.notificationsEnabled) return 'Banners are switched off on this computer. Turn on “Show banners” below.';
  if (!p.backgroundServices.notifications) return 'Background notifications are switched off on this computer, so nothing can show a banner. Turn them on under Settings › Advanced.';
  if (category && p.moduleNotifications[`cat:${category}`] === false) return `Banners for ${category === 'calendar' ? 'Calendar and meetings' : category} are switched off in the “This computer” column above.`;
  if (s.pausedUntil && Date.parse(s.pausedUntil) > s.now.getTime()) return `Notifications are paused until ${new Date(s.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. They still arrive in the notification center.`;
  if (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, s.now)) return `Do not disturb is on until ${p.dndTo}. Notifications still arrive in the notification center; urgent ones still show.`;
  return null;
}
