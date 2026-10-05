import type { NotificationPermission, Preferences, RingTestNotice } from '@shared/types';

/**
 * Notifications while WorkSuite's app lock is on (worksuite-desktop#114).
 *
 * The lock never stops them: the realtime connection, the poll and the badge
 * all live in the main process and carry on. What changes is what a banner
 * may say, and where clicking it goes:
 *
 * - A message banner says only "New message in WorkSuite." unless this
 *   computer allows the sender's name and/or the message's text while locked
 *   — and then never more than the person's own "What banners show" and the
 *   organization's minimum privacy allow (settings.effective clamps the
 *   latter). Every other banner stays generic.
 * - Clicking a conversation's banner opens the restricted chat window when
 *   "Allow chat while locked" is on; anything else asks for the unlock first,
 *   and opens where the banner pointed once WorkSuite is unlocked.
 */

export const LOCKED_MESSAGE = 'New message in WorkSuite.';

export interface LockedPresented {
  title: string;
  body: string;
}

type LockedPrefs = Pick<Preferences, 'notificationPrivacy' | 'lockedNotificationSender' | 'lockedNotificationPreview'> & Partial<Pick<Preferences, 'lockedShowCallerDetails'>>;

/**
 * What a banner shows while locked. `n.module === 'chat'` with a sender is a
 * message; `n.call` an incoming call, which names the caller only where
 * "Show caller details" allows (worksuite-desktop#113).
 */
export function presentLocked(n: { module: string; category?: string | null; title: string; body: string; sender: string | null; call?: boolean }, prefs: LockedPrefs): LockedPresented {
  if (n.call || n.category === 'incoming-call') return { title: 'WorkSuite', body: prefs.lockedShowCallerDetails && prefs.notificationPrivacy !== 'GENERIC' && n.sender ? `Incoming call from ${n.sender}` : 'Incoming WorkSuite call' };
  if (n.module !== 'chat') return { title: 'WorkSuite', body: 'New WorkSuite notification' };
  const sender = !!prefs.lockedNotificationSender && prefs.notificationPrivacy !== 'GENERIC' && !!n.sender;
  const preview = !!prefs.lockedNotificationPreview && prefs.notificationPrivacy === 'FULL' && !!n.body;
  if (sender && preview) return { title: n.title, body: n.body };
  if (sender) return { title: 'WorkSuite', body: `New message from ${n.sender}` };
  if (preview) return { title: 'New message in WorkSuite', body: n.body };
  return { title: 'WorkSuite', body: LOCKED_MESSAGE };
}

export type LockedClick = { kind: 'restricted-chat'; room: string } | { kind: 'unlock' };

/** Where clicking a banner goes while locked: the restricted chat window for a conversation, when allowed; otherwise the unlock. */
export function lockedClickTarget(link: string | null, prefs: Pick<Preferences, 'lockedAllowChat'>): LockedClick {
  if (!prefs.lockedAllowChat || !link) return { kind: 'unlock' };
  try {
    const u = new URL(link, 'https://locked.invalid');
    const room = u.searchParams.get('room') ?? '';
    if (u.pathname === '/chat' && /^\d+$/.test(room)) return { kind: 'restricted-chat', room };
  } catch {
    /* not a link this app understands */
  }
  return { kind: 'unlock' };
}

/**
 * Whether this computer will show WorkSuite's banners, as far as the app can
 * tell. Electron cannot read the operating system's per-app permission on
 * macOS or Windows, nor Focus / Focus Assist: only whether notifications are
 * supported at all, and — on macOS and Windows — the error the system gave
 * when the last banner failed to show. The explanation says which settings to
 * check, honestly, whatever the app could or could not detect.
 */
export function notificationPermission(platform: NodeJS.Platform, supported: boolean, lastFailure: string | null): NotificationPermission {
  const where =
    platform === 'darwin'
      ? 'System Settings › Notifications › WorkSuite: allow notifications, and check that Focus is not silencing them.'
      : platform === 'win32'
        ? 'Settings › System › Notifications: turn notifications on for WorkSuite, and check that Do not disturb is off.'
        : 'Your desktop’s notification settings, and that a notification service is running.';
  if (!supported) return { state: 'unsupported', detail: `This computer cannot show notifications. Check ${where}`, failure: null };
  if (lastFailure) return { state: 'blocked', detail: `The system refused WorkSuite’s last notification. Check ${where}`, failure: lastFailure.slice(0, 200) };
  return { state: 'unknown', detail: `WorkSuite cannot read whether the system allows its notifications. If none appear, check ${where}`, failure: null };
}

/**
 * What the test chat notification's step says (worksuite-desktop#251), from what the system did with it: shown,
 * refused (macOS and Windows say so), unsupported, or nothing said either way.
 */
export function testNoticeFor(platform: NodeJS.Platform, state: 'shown' | 'failed' | 'unknown' | 'unsupported', failure: string | null): RingTestNotice {
  const where = platform === 'darwin' ? 'System Settings › Notifications › WorkSuite' : platform === 'win32' ? 'Settings › System › Notifications' : 'your desktop’s notification settings';
  const focus = platform === 'darwin' ? 'If it did not appear, a Focus may be holding it.' : platform === 'win32' ? 'If it did not appear, Do not disturb may be holding it.' : null;
  if (state === 'shown') return { state, detail: focus };
  if (state === 'failed') return { state, detail: `Desktop notifications are off for WorkSuite. Turn them on in ${where}.${failure ? ` (${failure.slice(0, 160)})` : ''}` };
  if (state === 'unsupported') return { state, detail: `This computer cannot show notifications. Check ${where}.` };
  return { state, detail: `The system did not say whether it showed it. If you did not see it, check ${where}.` };
}

/** The operating system's own notification settings for WorkSuite (#251), or null where there is no such page. */
export function notificationSettingsUrl(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return 'x-apple.systempreferences:com.apple.preference.notifications';
  if (platform === 'win32') return 'ms-settings:notifications';
  return null;
}
