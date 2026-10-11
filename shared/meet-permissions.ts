/**
 * What the operating system lets a meeting do (Settings › Meet › System
 * permissions, WS-MEET-ENH-01 D05).
 *
 * Five rows — camera, microphone, screen recording, accessibility for remote
 * control, and notifications — gathered in one place, because "remote control
 * is limited on this Mac" is only useful next to the thing that would fix it.
 *
 * Two rules decide what a row says:
 *
 *  - **Not asked for is not the same as denied.** Only macOS gates the camera,
 *   the microphone and screen capture; on Windows and Linux there is no such
 *   permission to grant, and a row reading "Denied" there would send somebody
 *   looking for a switch that does not exist.
 *  - **Unable to verify is its own answer.** The accessibility check can
 *   disagree with itself (the app trusted, its input helper not), and
 *   `docs/MACOS_PERMISSIONS.md` records why: reporting that as denied sends
 *   people to reset permissions that were never the problem.
 */

export type PermissionState = 'granted' | 'denied' | 'unknown' | 'not_required';

/** The System Settings pane that grants it, where the OS has one. */
export type PrivacyPane = 'microphone' | 'camera' | 'screen' | 'accessibility';

export interface MeetPermissionRow {
  id: 'camera' | 'microphone' | 'screen' | 'accessibility' | 'notifications';
  label: string;
  state: PermissionState;
  /** What it means here, in a sentence — empty when the state says it all. */
  detail: string;
  /** Where it is granted; absent when this OS has nothing to open. */
  pane?: PrivacyPane;
}

/** What the main process can find out. */
export interface PermissionFacts {
  platform: string;
  /** `systemPreferences.getMediaAccessStatus`, macOS only. */
  camera?: string | null;
  microphone?: string | null;
  screen?: string | null;
  /** The remote-control service's answer, which has four states of its own. */
  accessibility?: 'granted' | 'denied' | 'unknown' | 'not_required' | 'checking' | null;
  /** Whether notifications reach this computer, as the notification service judges it. */
  notifications?: 'granted' | 'blocked' | 'unsupported' | 'unknown' | null;
}

const mediaState = (value: string | null | undefined): PermissionState => {
  if (value === 'granted') return 'granted';
  // macOS says `denied`, `restricted` (a profile forbids it) or
  // `not-determined` (never asked). Restricted is a denial somebody cannot
  // lift themselves, and is said so in the detail rather than as a fifth state.
  if (value === 'denied' || value === 'restricted') return 'denied';

  return 'unknown';
};

const MEDIA_DETAIL: Record<string, string> = {
  restricted: 'Not allowed by a profile on this computer; your administrator can change it.',
  'not-determined': 'Not asked for yet. WorkSuite asks the first time you join a meeting.',
};

export function meetPermissions(facts: PermissionFacts): MeetPermissionRow[] {
  const mac = facts.platform === 'darwin';
  const media = (id: 'camera' | 'microphone' | 'screen', label: string, pane: PrivacyPane, value: string | null | undefined): MeetPermissionRow =>
    mac
      ? { id, label, state: mediaState(value), detail: MEDIA_DETAIL[value ?? ''] ?? '', pane }
      : { id, label, state: 'not_required', detail: 'This computer does not ask for it.' };

  const rows: MeetPermissionRow[] = [
    media('camera', 'Camera', 'camera', facts.camera),
    media('microphone', 'Microphone', 'microphone', facts.microphone),
    media('screen', 'Screen recording', 'screen', facts.screen),
  ];

  // Accessibility is what lets somebody control this computer; without it a
  // share is view-only. On Windows nothing has to be granted, and Linux has no
  // supported way to inject input at all.
  const ax = facts.accessibility ?? null;

  rows.push(
    ax === 'not_required'
      ? { id: 'accessibility', label: 'Accessibility (remote control)', state: 'not_required', detail: 'This computer does not ask for it.' }
      : {
          id: 'accessibility',
          label: 'Accessibility (remote control)',
          // `checking` is not a state of the permission, so it reads as not yet known.
          state: ax === 'granted' ? 'granted' : ax === 'denied' ? 'denied' : 'unknown',
          detail:
            ax === 'denied'
              ? 'Others can see your screen but cannot control it until this is allowed.'
              : ax === 'granted'
                ? ''
                : 'WorkSuite cannot read this yet. Settings › Remote control checks it in full.',
          ...(mac ? { pane: 'accessibility' as PrivacyPane } : {}),
        },
  );

  const notifications = facts.notifications ?? null;

  rows.push({
    id: 'notifications',
    label: 'Notifications',
    state: notifications === 'granted' ? 'granted' : notifications === 'blocked' || notifications === 'unsupported' ? 'denied' : 'unknown',
    detail:
      notifications === 'blocked'
        ? 'The system refused WorkSuite’s last notification, so an invitation may not reach you.'
        : notifications === 'unsupported'
          ? 'This computer cannot show notifications.'
          : notifications === 'granted'
            ? ''
            : 'WorkSuite cannot read whether the system allows its notifications.',
  });

  return rows;
}

/** What the row's badge reads. */
export const permissionLabel = (state: PermissionState): string =>
  state === 'granted' ? 'Allowed' : state === 'denied' ? 'Not allowed' : state === 'not_required' ? 'Not needed' : 'Unable to verify';

/** How many rows are a problem, for the "1 permission missing" line the design draws. */
export const permissionsMissing = (rows: MeetPermissionRow[]): number => rows.filter((r) => r.state === 'denied').length;

/**
 * The one line Meet's home shows when the system is standing in the way
 * (WS-MEET-ENH-01 D01's amber banner).
 *
 * Only a **denial** earns a banner. "Unable to verify" and "this computer does
 * not ask for it" are not problems, and a home page that warned about them
 * would cry wolf on every Windows machine — the full five rows are a section
 * in Settings for whoever wants them.
 *
 * At most one, worst first: a screen that cannot be captured at all is a
 * larger thing than a screen that can be seen but not controlled.
 */
export function meetHomeWarning(rows: MeetPermissionRow[]): { id: 'screen' | 'accessibility'; title: string; detail: string } | null {
  const denied = (id: 'screen' | 'accessibility'): boolean => rows.some((r) => r.id === id && r.state === 'denied');

  if (denied('screen')) {
    return {
      id: 'screen',
      title: 'Screen sharing is blocked on this computer',
      detail: 'WorkSuite is not allowed to record the screen, so Share screen will show nothing to the others.',
    };
  }

  if (denied('accessibility')) {
    return {
      id: 'accessibility',
      title: 'Remote control is limited on this computer',
      detail: 'Others can see your screen when you share it, but cannot use your mouse or keyboard.',
    };
  }

  return null;
}
