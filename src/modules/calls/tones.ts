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

/**
 * The website-chat ringtones a person can choose (RING-29, P-01/P-02), the same names the web app offers and the server
 * keeps for every device of theirs. Each moves the notes of the two chat tones — never the rhythm, which is what tells
 * a chat from a call. Classic phone is the tone this app always played.
 */
export const RINGTONES = [
  { id: 'classic', label: 'Classic phone', pitch: 1 },
  { id: 'soft', label: 'Soft', pitch: 2 / 3 },
  { id: 'bright', label: 'Bright', pitch: 4 / 3 },
] as const;

/** A ringtone name the server sent, or Classic phone for one this app does not know. */
export function ringtoneId(id: string | null | undefined): (typeof RINGTONES)[number]['id'] {
  return RINGTONES.find((t) => t.id === id)?.id ?? 'classic';
}

/** Where a ring plays (RING-42): the system's output, and the computer's own speakers too when that is a headset. */
export type RingOn = 'both' | 'default';

const SPEAKERS = /speaker|built-?in|internal/i;

/**
 * The speakers to ring on as well as the system's output (RING-UI-08 "Speakers too, so you hear it with the headset
 * off"): none when the output already is the speakers or the system names no devices; else the first output that
 * looks like the computer's own speakers and is not part of the same device as the output.
 */
export function speakersBesides(devices: ReadonlyArray<Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'groupId' | 'label'>>): string[] {
  const outs = devices.filter((d) => d.kind === 'audiooutput');
  const current = outs.find((d) => d.deviceId === 'default') ?? outs[0];
  if (!current || SPEAKERS.test(current.label)) return [];
  const speakers = outs.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.deviceId !== current.deviceId && (!d.groupId || d.groupId !== current.groupId) && SPEAKERS.test(d.label));
  return speakers ? [speakers.deviceId] : [];
}

async function extraOutputs(): Promise<string[]> {
  try {
    return speakersBesides(await navigator.mediaDevices.enumerateDevices());
  } catch {
    return [];
  }
}

/**
 * Starts a pattern at `volume` (0–1); returns the function that stops it. A website-chat tone takes the person's
 * `ringtone`, and with `ringOn` 'both' plays on the computer's speakers too when the output is a headset.
 */
export function playTone(kind: ToneKind, volume = 1, opts: { ringtone?: string | null; ringOn?: RingOn } = {}): { stop: () => void; setVolume: (v: number) => void } {
  const base = PATTERNS[kind];
  const chat = kind === 'webchat' || kind === 'webchat-strong';
  const pitch = chat ? (RINGTONES.find((t) => t.id === ringtoneId(opts.ringtone))?.pitch ?? 1) : 1;
  const pattern = pitch === 1 ? base : { ...base, notes: base.notes.map((n) => ({ ...n, hz: n.hz.map((hz) => Math.round(hz * pitch)) })) };
  let level = Math.max(0, Math.min(1, volume));
  let stopped = false;
  const outputs: Array<{ ctx: AudioContext; master: GainNode }> = [];
  const open = (sinkId?: string): { ctx: AudioContext; master: GainNode } | null => {
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = level;
      master.connect(ctx.destination);
      if (sinkId) void (ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(sinkId).catch(() => undefined);
      const out = { ctx, master };
      outputs.push(out);
      return out;
    } catch {
      return null;
    }
  };
  if (!open()) return { stop: () => undefined, setVolume: () => undefined };
  const playOn = ({ ctx, master }: { ctx: AudioContext; master: GainNode }) => {
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
  const play = () => {
    for (const out of outputs) playOn(out);
  };
  play();
  const timer = setInterval(play, pattern.every);
  // The speakers join from the next ring on, once the system has said which they are.
  if (chat && (opts.ringOn ?? 'both') === 'both') {
    void extraOutputs().then((ids) => {
      for (const id of ids) if (!stopped) open(id);
    });
  }
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      for (const { ctx } of outputs.splice(0)) void ctx.close();
    },
    setVolume: (v) => {
      level = Math.max(0, Math.min(1, v));
      for (const { master } of outputs) master.gain.value = level;
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
