import { Track, type Participant } from 'livekit-client';

/**
 * One person in a call as the call surface draws them. Camera, microphone
 * and screen are separate tracks — a person can share their screen AND keep
 * their camera on, and starting a share never takes the camera's place.
 */
export interface CallPerson {
  id: string;
  name: string;
  self: boolean;
  speaking: boolean;
  micOn: boolean;
  /** The camera, when it is on (a muted camera is no picture). */
  camera: Track | null;
  /** Their shared screen, when they are sharing. */
  screen: Track | null;
  /** Sharing, but paused: the others see "Screen sharing paused". */
  screenPaused: boolean;
  host?: boolean;
  guest?: boolean;
  /** A raised hand in a meeting (worksuite-desktop#92): its place in the queue, and how to say so. */
  hand?: { position: number; label: string } | null;
}

export function personOf(p: Participant, self: boolean, extra: { host?: boolean; guest?: boolean; hand?: CallPerson['hand'] } = {}): CallPerson {
  const cam = p.getTrackPublication(Track.Source.Camera);
  const scr = p.getTrackPublication(Track.Source.ScreenShare);
  return {
    id: p.identity,
    name: self ? 'You' : p.name || 'Guest',
    self,
    speaking: p.isSpeaking,
    micOn: p.isMicrophoneEnabled,
    camera: cam?.track && !cam.isMuted ? cam.track : null,
    screen: scr?.track ?? null,
    screenPaused: !!scr?.isMuted,
    ...extra,
  };
}

/**
 * Who the PiP box or the big picture shows: the person sharing (their face
 * beside their screen), else whoever spoke last, else the first other person.
 * `last` is the previous choice, so the picture does not flick between two
 * people talking over each other.
 */
export function featured(people: CallPerson[], last: string | null): CallPerson | null {
  const others = people.filter((p) => !p.self);
  if (others.length === 0) return people[0] ?? null;
  const sharer = others.find((p) => p.screen);
  if (sharer) return sharer;
  const speaking = others.find((p) => p.speaking);
  if (speaking) return speaking;
  return others.find((p) => p.id === last) ?? others[0]!;
}

/** Preview our own share first; otherwise follow the remote presenter. */
export function screenPresenter(people: CallPerson[]): CallPerson | null {
  return people.find((p) => p.self && p.screen) ?? people.find((p) => p.screen) ?? null;
}
