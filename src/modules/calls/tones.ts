/**
 * Call sounds, synthesised (no audio files to ship): the ringtone an incoming
 * call plays, and the ringback a caller hears while it rings.
 */
type Note = { hz: number[]; at: number; len: number };

export type ToneKind = 'ring' | 'ringback' | 'webchat' | 'webchat-strong' | 'hand' | 'reply';

const PATTERNS: Record<ToneKind, { every: number; notes: Note[]; level: number }> = {
  // Two rising notes, twice, then a pause.
  ring: {
    every: 2_400,
    level: 0.22,
    notes: [
      { hz: [659], at: 0, len: 0.16 },
      { hz: [880], at: 0.2, len: 0.22 },
      { hz: [659], at: 0.6, len: 0.16 },
      { hz: [880], at: 0.8, len: 0.22 },
    ],
  },
  // A website chat waiting (RING-21): about two seconds of ring, three of pause.
  webchat: {
    every: 5_000,
    level: 0.2,
    notes: [
      { hz: [784], at: 0, len: 0.18 },
      { hz: [988], at: 0.24, len: 0.24 },
      { hz: [784], at: 1.0, len: 0.18 },
      { hz: [988], at: 1.24, len: 0.3 },
    ],
  },
  // At risk, or a high, urgent or VIP chat: the stronger tone, closer together.
  'webchat-strong': {
    every: 2_600,
    level: 0.3,
    notes: [
      { hz: [880, 1175], at: 0, len: 0.2 },
      { hz: [1175, 1397], at: 0.26, len: 0.24 },
      { hz: [880, 1175], at: 0.62, len: 0.2 },
      { hz: [1175, 1397], at: 0.88, len: 0.3 },
    ],
  },
  // A hand raised in a meeting (worksuite-desktop#92): one soft rising pair, for the hosts. Played once.
  hand: {
    every: 60_000,
    level: 0.14,
    notes: [
      { hz: [660], at: 0, len: 0.12 },
      { hz: [990], at: 0.14, len: 0.2 },
    ],
  },
  // A visitor wrote again in my chat while I was away from it (worksuite-desktop#230): a short falling chime, three
  // notes, unlike the rising new-chat ring. Played once.
  reply: {
    every: 60_000,
    level: 0.16,
    notes: [
      { hz: [1319], at: 0, len: 0.1 },
      { hz: [1047], at: 0.12, len: 0.1 },
      { hz: [784], at: 0.24, len: 0.22 },
    ],
  },
  // The familiar two-tone ringback, quietly.
  ringback: { every: 4_000, level: 0.05, notes: [{ hz: [440, 480], at: 0, len: 1.6 }] },
};

/** Starts a pattern at `volume` (0–1); returns the function that stops it. */
export function playTone(kind: ToneKind, volume = 1): { stop: () => void; setVolume: (v: number) => void } {
  const pattern = PATTERNS[kind];
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume));
    master.connect(ctx.destination);
  } catch {
    return { stop: () => undefined, setVolume: () => undefined };
  }
  const play = () => {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + 0.05;
    for (const n of pattern.notes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + n.at);
      g.gain.linearRampToValueAtTime(pattern.level, t0 + n.at + 0.02);
      g.gain.setValueAtTime(pattern.level, t0 + n.at + n.len - 0.04);
      g.gain.linearRampToValueAtTime(0, t0 + n.at + n.len);
      g.connect(master);
      for (const hz of n.hz) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = hz;
        o.connect(g);
        o.start(t0 + n.at);
        o.stop(t0 + n.at + n.len + 0.02);
      }
    }
  };
  play();
  const timer = setInterval(play, pattern.every);
  return {
    stop: () => {
      clearInterval(timer);
      void ctx?.close();
      ctx = null;
    },
    setVolume: (v) => {
      if (master) master.gain.value = Math.max(0, Math.min(1, v));
    },
  };
}

/** A pattern played once, not repeated: a notice rather than a ring. */
export function playOnce(kind: ToneKind, volume = 1): void {
  const t = playTone(kind, volume);
  setTimeout(t.stop, 1_500);
}

const VOLUME_KEY = 'ws.ringtone.volume';

/** The ringtone volume this person chose on this computer (a convenience, not a setting). */
export function ringVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && localStorage.getItem(VOLUME_KEY) !== null ? Math.max(0, Math.min(1, v)) : 0.7;
  } catch {
    return 0.7;
  }
}

export function saveRingVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    /* private storage unavailable: the choice lasts this ring only */
  }
}
