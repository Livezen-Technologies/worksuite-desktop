import type { DiagnosticCheck } from './types';

/**
 * The checks behind Settings › Remote control (WS-MEET-ENH-01 RC09), and the
 * same rows in the support bundle.
 *
 * Every row is something this computer was able to find out: how many screens
 * the capturer offers, how many displays the system reports, what the input
 * service says, what the organisation's policy allows. Nothing here is a
 * guess dressed as a measurement.
 *
 * **Two of the artboard's rows are deliberately `skip` rather than green.**
 * It draws a *firewall UDP* row and a *WebRTC/TURN* row with a tick. This app
 * cannot honestly produce either from a settings page: the media server's
 * address and its ICE servers arrive **in a meeting**, from the signalling
 * connection, and the media ports are never known to the client at all. A row
 * that turned that into a tick would be the diagnostics lying about the one
 * thing somebody opens them to find out. They say what is not known, and
 * where it is known instead.
 */

export interface MeetDiagFacts {
  platform: string;
  /** macOS `getMediaAccessStatus('screen')`; absent elsewhere. */
  screenPermission?: string | null;
  /** Screens the capturer offers, or null when it could not be asked. */
  sources?: number | null;
  /** What the system reports, one entry per display. */
  displays?: Array<{ width: number; height: number; scale: number; primary: boolean }> | null;
  /** The remote-control service's own answer. */
  accessibility?: 'granted' | 'denied' | 'unknown' | 'not_required' | 'checking' | null;
  /** How input would reach this computer, when anything can. */
  method?: 'sendinput' | 'cgevent' | 'xdotool' | null;
  /** The display server, which decides whether injecting is possible at all. */
  displayServer?: 'win32' | 'quartz' | 'x11' | 'wayland' | null;
  /** The organisation's clipboard policy for remote control. */
  clipboard?: 'off' | 'text_only' | 'text_and_files' | null;
  /** The realtime gateway's state, as the app's own health check reads it. */
  realtime?: string | null;
}

const px = (d: { width: number; height: number; scale: number }): string => `${d.width}×${d.height}${d.scale !== 1 ? ` @${d.scale}×` : ''}`;

export function meetDiagnostics(facts: MeetDiagFacts): DiagnosticCheck[] {
  const rows: DiagnosticCheck[] = [];
  const mac = facts.platform === 'darwin';
  const sources = facts.sources ?? null;
  const denied = mac && (facts.screenPermission === 'denied' || facts.screenPermission === 'restricted');

  rows.push({
    id: 'meet-screen',
    label: 'Screen sharing',
    status: denied ? 'fail' : sources === null ? 'skip' : sources > 0 ? 'pass' : 'fail',
    detail: denied
      ? 'macOS has not allowed WorkSuite to record the screen, so a share would show nothing. Settings › Meet › System permissions opens the pane that grants it.'
      : sources === null
        ? 'This computer could not be asked what it can capture.'
        : sources > 0
          ? `${sources === 1 ? 'One screen' : `${sources} screens`} can be captured.`
          : 'Nothing can be captured. On Wayland the system asks for a screen each time; elsewhere this usually means a permission is missing.',
  });

  const displays = facts.displays ?? null;

  rows.push({
    id: 'meet-displays',
    label: 'Displays',
    status: displays === null ? 'skip' : 'pass',
    detail:
      displays === null
        ? 'Not readable on this computer.'
        : displays.length <= 1
          ? `One display, ${px(displays[0] ?? { width: 0, height: 0, scale: 1 })}.`
          : // Not a warning: more than one screen is normal. It is said because
            // the picker offers them separately and people share the wrong one.
            `${displays.length} displays — ${displays.map(px).join(', ')}. The share picker offers each one separately, so check which is highlighted before you share.`,
  });

  const ax = facts.accessibility ?? null;
  const wayland = facts.displayServer === 'wayland';

  rows.push({
    id: 'meet-input',
    label: 'Remote input',
    status: wayland ? 'warn' : ax === 'granted' || ax === 'not_required' ? 'pass' : ax === 'denied' ? 'warn' : 'skip',
    detail: wayland
      ? 'Wayland has no supported way for WorkSuite to move your pointer, so your screen can be seen but not controlled.'
      : ax === 'granted'
        ? `Allowed${facts.method ? ` · using ${facts.method}` : ''}. Nobody controls this computer until you approve their request, each time.`
        : ax === 'denied'
          ? 'Accessibility is off, so your screen can be seen but not controlled. The banner above has the way to fix it.'
          : ax === 'not_required'
            ? `This computer does not ask for a permission${facts.method ? ` · using ${facts.method}` : ''}.`
            : 'Not checked yet.',
  });

  const clip = facts.clipboard ?? null;

  rows.push({
    id: 'meet-clipboard',
    label: 'Clipboard while controlled',
    // A policy is not a fault, whichever way it is set: 'off' is somebody's
    // deliberate choice, and a warning would read as something to fix.
    status: clip === null ? 'skip' : 'pass',
    detail:
      clip === null
        ? 'No policy has reached this computer yet.'
        : clip === 'off'
          ? 'Off, by your organisation’s policy: a controller cannot put anything on your clipboard.'
          : clip === 'text_only'
            ? 'Text only, by your organisation’s policy. You are told each time something is put on your clipboard.'
            : 'Text and files, by your organisation’s policy. You are told each time, and a file always waits for your answer.',
  });

  const rt = facts.realtime ?? null;

  rows.push({
    id: 'meet-realtime',
    label: 'Realtime connection',
    status: rt === 'connected' ? 'pass' : rt === 'disabled' || rt === 'idle' || rt === null ? 'skip' : 'warn',
    detail:
      rt === 'connected'
        ? 'Connected — this is how a request to control your screen reaches you.'
        : rt === 'disabled'
          ? 'This server does not run the realtime gateway; WorkSuite asks it instead, so a request can take a few seconds longer.'
          : rt === 'idle' || rt === null
            ? 'Not started.'
            : 'Reconnecting. A request to control your screen may be slow to arrive until it is back.',
  });

  rows.push({
    id: 'meet-media',
    label: 'Media path (UDP and TURN)',
    status: 'skip',
    detail:
      'Not knowable from here: WorkSuite is told the media server’s address and its relays when it joins a meeting, and never learns which UDP ports the media itself uses. The pre-join screen of a real meeting is where this shows up — and the call itself reports its connection quality while you are in it.',
  });

  return rows;
}

/** The one word at the top of the list. */
export const meetDiagnosticsSummary = (rows: DiagnosticCheck[]): 'pass' | 'warn' | 'fail' =>
  rows.some((r) => r.status === 'fail') ? 'fail' : rows.some((r) => r.status === 'warn') ? 'warn' : 'pass';
