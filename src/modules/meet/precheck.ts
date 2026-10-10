/**
 * The device check on the pre-join screen (WS-MEET-ENH-01 D08).
 *
 * Every row is something this computer has actually measured or been told —
 * the camera's own settings, the constraints the microphone was opened with,
 * and the remote-control service's answer. Nothing is inferred from what was
 * asked for: a camera asked for 720p and giving 480 should read 480, because
 * the whole point of a check is to find out before everyone is watching.
 *
 * **The design's network row is deliberately absent.** It draws "42 ms ·
 * 28 Mbps", which is a measurement of the path to the media server, and
 * nothing in this app measures that. The nearest available number — a round
 * trip to the API — is a different thing wearing the same label, and a
 * reassuring 40 ms there says nothing about whether video will arrive.
 */

export type CheckState = 'ok' | 'warn' | 'unknown';

export interface CheckRow {
  id: 'camera' | 'microphone' | 'remote';
  label: string;
  state: CheckState;
  /** What was found, in as few words as the row can carry. */
  value: string;
}

export interface CheckFacts {
  /** Whether the camera is on at all for this join. */
  cameraOn: boolean;
  /** `MediaStreamTrack.getSettings()` of the live preview track. */
  camera?: { width?: number; height?: number; frameRate?: number } | null;
  micOn: boolean;
  /** The constraints the microphone was actually opened with. */
  audio?: { noiseSuppression?: boolean; echoCancellation?: boolean } | null;
  /** What the remote-control service says this computer can do. */
  remote?: { available?: boolean; accessibility?: string | null } | null;
}

/**
 * "1080p", "720p", or the height itself.
 *
 * Only an exact height gets a name. A 540-line picture is not 480p, and
 * rounding it down to the nearest familiar label would be the check telling a
 * comfortable story about what the camera gave — which is the one thing it
 * exists not to do.
 */
const NAMED: Record<number, string> = { 2160: '2160p', 1440: '1440p', 1080: '1080p', 720: '720p', 540: '540p', 480: '480p', 360: '360p', 240: '240p' };

export function videoLabel(settings: CheckFacts['camera']): string {
  const height = Math.round(settings?.height ?? 0);
  const fps = Math.round(settings?.frameRate ?? 0);

  if (height <= 0) return '';

  const size = NAMED[height] ?? `${height}p`;

  return fps > 0 ? `${size} · ${fps} fps` : size;
}

export function deviceCheck(facts: CheckFacts): CheckRow[] {
  const rows: CheckRow[] = [];
  const video = facts.cameraOn ? videoLabel(facts.camera) : '';

  rows.push({
    id: 'camera',
    label: 'Camera',
    // Off is a choice, not a fault: somebody joining with the camera off does
    // not want a warning about it.
    state: !facts.cameraOn ? 'ok' : video ? 'ok' : 'unknown',
    value: !facts.cameraOn ? 'Off' : video || 'Starting…',
  });

  const noise = facts.audio?.noiseSuppression === true;

  rows.push({
    id: 'microphone',
    label: 'Microphone',
    state: !facts.micOn ? 'ok' : facts.audio ? 'ok' : 'unknown',
    value: !facts.micOn ? 'Muted' : !facts.audio ? 'Starting…' : noise ? 'Noise cancellation on' : 'Noise cancellation off',
  });

  // Not a fault either, and said in terms of what it costs rather than which
  // permission is missing: the person reading this is about to join a meeting,
  // not about to fix a Mac.
  const remote = facts.remote ?? null;

  rows.push({
    id: 'remote',
    label: 'Remote control',
    state: remote === null ? 'unknown' : remote.available ? 'ok' : 'warn',
    value:
      remote === null
        ? 'Checking…'
        : remote.available
          ? 'Others can ask to control your screen'
          : remote.accessibility === 'denied'
            ? 'Accessibility off · your screen can be seen, not controlled'
            : 'View only · your screen can be seen, not controlled',
  });

  return rows;
}

/** Whether the check as a whole is worth a word at the top of it. */
export const checkSummary = (rows: CheckRow[]): CheckState =>
  rows.some((r) => r.state === 'warn') ? 'warn' : rows.some((r) => r.state === 'unknown') ? 'unknown' : 'ok';
