import { Checkbox } from '../../components/Checkbox';
import { checkSummary, deviceCheck } from './precheck';
import { useEffect, useRef, useState } from 'react';
import { createLocalAudioTrack, createLocalVideoTrack, Room, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client';
import { call } from '../../core/bridge';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Avatar, cx } from '../../components/ui';
import { VideoView } from '../calls/parts';
import { CLEAN_AUDIO } from '../calls/session';
import { useMeetT, type MKey } from './i18n';

/**
 * Camera, microphone and speaker before a meeting (worksuite-desktop#67, #69): the devices this computer has, the
 * camera's picture, how loud the microphone is, a tone to test the speaker, and what was chosen — remembered on this
 * computer, and used when joining. Shared by the pre-join screen and Meet Home's "Check camera and microphone".
 */
export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';
type Devices = Record<DeviceKind, MediaDeviceInfo[]>;

export interface DevicePrefs {
  micId: string;
  camId: string;
  speakerId: string;
  mic: boolean;
  cam: boolean;
}

const KEY = 'ws.meet.devices';
const DEFAULTS: DevicePrefs = { micId: '', camId: '', speakerId: '', mic: true, cam: true };

export function readPrefs(): DevicePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DevicePrefs>;
    return {
      micId: typeof v.micId === 'string' ? v.micId : '',
      camId: typeof v.camId === 'string' ? v.camId : '',
      speakerId: typeof v.speakerId === 'string' ? v.speakerId : '',
      mic: typeof v.mic === 'boolean' ? v.mic : true,
      cam: typeof v.cam === 'boolean' ? v.cam : true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Whether the devices chosen here are kept for next time (WS-MEET-ENH-01 D08).
 *
 * On by default, because it always behaved that way and nobody wants to pick
 * their headset every morning. Turned off, what is already remembered is
 * forgotten at once — leaving yesterday's choice behind while promising not to
 * remember would be the worst of both.
 */
const REMEMBER_KEY = 'ws.meet.devices.remember';

export function remembering(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setRemembering(on: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? '1' : '0');
    if (!on) localStorage.removeItem(KEY);
  } catch {
    /* only a convenience */
  }
}

export function savePrefs(p: DevicePrefs): void {
  if (!remembering()) return;

  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* only a convenience */
  }
}

/** What went wrong with a device, as a kind the screen can say something useful about. */
export type DeviceTrouble = { kind: 'blocked' | 'missing' | 'busy' | 'failed'; what: 'camera' | 'microphone' };

export function troubleOf(e: unknown, what: 'camera' | 'microphone'): DeviceTrouble {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'blocked', what };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { kind: 'missing', what };
  if (name === 'NotReadableError' || name === 'AbortError') return { kind: 'busy', what };
  return { kind: 'failed', what };
}

/** A device the saved choice names that is no longer here falls back to the system default. */
export function present(id: string, list: MediaDeviceInfo[]): string {
  return id && list.length && !list.some((d) => d.deviceId === id) ? '' : id;
}

/**
 * The devices, the preview and the meter, while `active`. Changes are remembered as they are made; `prefs` is what
 * to join with.
 */
export function useMeetDevices(active: boolean, opts: { camAllowed?: boolean; startOff?: boolean; camOff?: boolean } = {}) {
  const [prefs, setPrefs] = useState<DevicePrefs>(() => {
    const p = readPrefs();
    // Off for this join only: what is remembered stays as it was until the person changes it here.
    if (opts.startOff) return { ...p, mic: false, cam: false };
    // Answered "Audio only" (WS-MEET-ENH-01 D04): the microphone as remembered,
    // the camera off — not remembered as off, because the next meeting is not
    // this one.
    if (opts.camOff) return { ...p, cam: false };
    return opts.camAllowed === false ? { ...p, cam: false } : p;
  });
  const [devices, setDevices] = useState<Devices>({ audioinput: [], videoinput: [], audiooutput: [] });
  const [video, setVideo] = useState<LocalVideoTrack | null>(null);
  const [level, setLevel] = useState(0);
  const [audioSettings, setAudioSettings] = useState<{ noiseSuppression?: boolean; echoCancellation?: boolean } | null>(null);
  const [trouble, setTrouble] = useState<DeviceTrouble | null>(null);
  const [attempt, setAttempt] = useState(0);
  const update = (patch: Partial<DevicePrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });

  // Permission first (macOS asks once), then the lists have names; again when a device is plugged in or out.
  useEffect(() => {
    if (!active) return;
    let gone = false;
    const list = async () => {
      const [a, v, o] = await Promise.all([Room.getLocalDevices('audioinput'), Room.getLocalDevices('videoinput'), Room.getLocalDevices('audiooutput').catch(() => [])]);
      if (!gone) setDevices({ audioinput: a, videoinput: v, audiooutput: o.filter((d) => d.deviceId !== 'default') });
    };
    void (async () => {
      await call('media:access', { kind: 'microphone' }).catch(() => undefined);
      await call('media:access', { kind: 'camera' }).catch(() => undefined);
      await list();
    })().catch(() => undefined);
    const onChange = () => void list().catch(() => undefined);
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      gone = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    };
  }, [active, attempt]);

  const camId = present(prefs.camId, devices.videoinput);
  const micId = present(prefs.micId, devices.audioinput);
  const speakerId = present(prefs.speakerId, devices.audiooutput);

  // The camera's picture, while it is meant to be on.
  useEffect(() => {
    if (!active || !prefs.cam) return;
    let track: LocalVideoTrack | null = null;
    let gone = false;
    void createLocalVideoTrack({ deviceId: camId || undefined }).then(
      (t) => {
        if (gone) return t.stop();
        track = t;
        setVideo(t);
        setTrouble((x) => (x?.what === 'camera' ? null : x));
      },
      (e) => !gone && setTrouble(troubleOf(e, 'camera')),
    );
    return () => {
      gone = true;
      track?.stop();
      setVideo(null);
    };
  }, [active, prefs.cam, camId, attempt]);

  // How loud the microphone is, so a silent one shows before anybody else hears it.
  const raf = useRef(0);
  useEffect(() => {
    if (!active || !prefs.mic) return;
    let track: LocalAudioTrack | null = null;
    let ctx: AudioContext | null = null;
    let gone = false;
    void createLocalAudioTrack({ ...CLEAN_AUDIO, deviceId: micId || undefined }).then(
      (t) => {
        if (gone) return t.stop();
        track = t;
        setTrouble((x) => (x?.what === 'microphone' ? null : x));
        // What the device actually gave us, not what was asked for: the point
        // of a check is to find out before everybody is listening (D08).
        try {
          const got = t.mediaStreamTrack.getSettings();

          setAudioSettings({ noiseSuppression: got.noiseSuppression, echoCancellation: got.echoCancellation });
        } catch {
          setAudioSettings(null);
        }
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        ctx.createMediaStreamSource(new MediaStream([t.mediaStreamTrack])).connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
          setLevel(Math.min(8, Math.round((peak / 128) * 16)));
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      },
      (e) => !gone && setTrouble(troubleOf(e, 'microphone')),
    );
    return () => {
      gone = true;
      cancelAnimationFrame(raf.current);
      track?.stop();
      void ctx?.close();
      setLevel(0);
    };
  }, [active, prefs.mic, micId, attempt]);

  return { prefs: { ...prefs, camId, micId, speakerId }, update, devices, video, level, trouble, audioSettings, retry: () => (setTrouble(null), setAttempt((n) => n + 1)) };
}

export type MeetDevices = ReturnType<typeof useMeetDevices>;

/** Plays a short chime on the chosen speaker. */
async function chime(speakerId: string): Promise<void> {
  const ctx = new AudioContext();
  try {
    const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (speakerId && sink.setSinkId) await sink.setSinkId(speakerId).catch(() => undefined);
    const now = ctx.currentTime;
    [660, 880, 990].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.22);
      g.gain.linearRampToValueAtTime(0.25, now + i * 0.22 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.22);
      o.stop(now + i * 0.22 + 0.45);
    });
    await new Promise((r) => setTimeout(r, 1000));
  } finally {
    void ctx.close();
  }
}

const TROUBLE: Record<DeviceTrouble['kind'], MKey> = { blocked: 'dev.blocked', missing: 'dev.missing', busy: 'dev.busy', failed: 'dev.failed' };

/** The camera's picture (kept in proportion; the person's avatar when it is off) with the microphone and camera switches. */
export function Preview({ d, name, className }: { d: MeetDevices; name: string; className?: string }) {
  const t = useMeetT();
  const { mic, cam } = d.prefs;
  const toggle = 'flex h-11 w-11 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white';
  return (
    <div className={cx('relative aspect-video w-full overflow-hidden rounded-[16px] bg-[#16254F]', className)}>
      {cam && d.video ? (
        <VideoView track={d.video} mirror className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-[13px] text-[#C3CEEA]">
          <Avatar name={name || '?'} size={88} />
          {cam ? t('dev.cameraStarting') : t('dev.cameraOff')}
        </div>
      )}
      <span className="absolute start-3 top-3 rounded-[8px] bg-[rgba(11,18,38,.7)] px-2.5 py-1 text-[12.5px] font-semibold text-white">{t('dev.you')}</span>
      <div className="absolute bottom-3.5 left-1/2 flex -translate-x-1/2 gap-3">
        <button type="button" aria-pressed={mic} aria-label={mic ? t('dev.micOn') : t('dev.micOff')} title={mic ? t('dev.micOn') : t('dev.micOff')} onClick={() => d.update({ mic: !mic })} className={cx(toggle, mic ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-danger text-white hover:opacity-90')}>
          <Icon name={mic ? 'mic' : 'mic-off'} size={19} />
        </button>
        <button type="button" aria-pressed={cam} aria-label={cam ? t('dev.camOn') : t('dev.camOff')} title={cam ? t('dev.camOn') : t('dev.camOff')} onClick={() => d.update({ cam: !cam })} className={cx(toggle, cam ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-danger text-white hover:opacity-90')}>
          <Icon name={cam ? 'video' : 'video-off'} size={19} />
        </button>
      </div>
    </div>
  );
}

/** The three selectors, the microphone meter, Test speaker, and what is wrong with a device and how to fix it. */
export function DeviceSettings({ d }: { d: MeetDevices }) {
  const t = useMeetT();
  const [playing, setPlaying] = useState(false);
  const select = 'h-[36px] w-full rounded-[9px] border border-line bg-surface px-2 text-[13px] text-ink';
  const field = (label: string, icon: string, kind: DeviceKind, value: string, set: (id: string) => void) => (
    <label className="flex min-w-0 flex-col gap-1.5 text-[12.5px] font-semibold text-ink">
      <span className="flex items-center gap-1.5">
        <Icon name={icon} size={14} className="text-ink-3" /> {label}
      </span>
      <Select value={value} onChange={(e) => set(e.target.value)} className={select} aria-label={label}>
        <option value="">{t('dev.default')}</option>
        {d.devices[kind].map((x) => (
          <option key={x.deviceId} value={x.deviceId}>
            {x.label || label}
          </option>
        ))}
      </Select>
    </label>
  );
  const bars = 8;
  const meter = !d.prefs.mic ? t('dev.micMuted') : d.level > 1 ? t('dev.micWorking') : t('dev.micSilent');
  const words = d.trouble ? { what: t(d.trouble.what === 'camera' ? 'dev.camera' : 'dev.microphone') } : null;
  return (
    <section aria-label={t('dev.settings')} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-3.5">
      <div className="grid gap-3 sm:grid-cols-3">
        {field(t('dev.camera'), 'video', 'videoinput', d.prefs.camId, (camId) => d.update({ camId }))}
        {field(t('dev.microphone'), 'mic', 'audioinput', d.prefs.micId, (micId) => d.update({ micId }))}
        {field(t('dev.speaker'), 'volume', 'audiooutput', d.prefs.speakerId, (speakerId) => d.update({ speakerId }))}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-ink-2">
        <span className="flex gap-[3px]" role="meter" aria-label={t('dev.microphone')} aria-valuemin={0} aria-valuemax={bars} aria-valuenow={d.prefs.mic ? d.level : 0}>
          {Array.from({ length: bars }, (_, i) => (
            <span key={i} className={cx('h-3.5 w-[5px] rounded-[2px] transition-colors', d.prefs.mic && i < d.level ? 'bg-primary' : 'bg-line')} />
          ))}
        </span>
        <span>{meter}</span>
        <span className="flex-1" />
        <button
          type="button"
          disabled={playing}
          onClick={() => {
            setPlaying(true);
            void chime(d.prefs.speakerId).finally(() => setPlaying(false));
          }}
          className="flex items-center gap-1.5 rounded-[7px] px-2 py-1 font-semibold text-primary hover:bg-selection disabled:opacity-60"
        >
          <Icon name="play" size={13} /> {playing ? t('dev.playing') : t('dev.testSpeaker')}
        </button>
      </div>
      {d.trouble && words ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <Icon name="alert" size={14} />
          <span className="min-w-0 flex-1">{t(TROUBLE[d.trouble.kind], words)}</span>
          {d.trouble.kind === 'blocked' ? (
            <button type="button" className="font-bold underline" onClick={() => void call('media:privacySettings', { pane: d.trouble!.what })}>
              {t('dev.openSettings')}
            </button>
          ) : null}
          <button type="button" className="font-bold underline" onClick={d.retry}>
            {t('dev.tryAgain')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The device check on the pre-join screen (WS-MEET-ENH-01 D08): what the
 * camera is actually sending, what the microphone was actually opened with,
 * and whether a share of this screen could be controlled.
 *
 * The design's network row is absent, and `precheck.ts` says why: it draws a
 * measurement of the path to the media server, and nothing here measures that.
 */
export function DeviceCheck({ d }: { d: MeetDevices }) {
  const t = useMeetT();
  const [keep, setKeep] = useState(remembering);
  /*
   * Asked for directly rather than through react-query: the pre-join is also
   * drawn in a guest window, which has no query client, and a device check
   * must not be the reason a screen needs a provider it otherwise does without.
   */
  const [remote, setRemote] = useState<{ available?: boolean; accessibility?: string | null } | null>(null);

  useEffect(() => {
    let gone = false;

    void call('rc:state')
      .then((r) => {
        if (!gone) setRemote({ available: r.support?.available, accessibility: r.support?.accessibility ?? null });
      })
      // No answer is "checking", not "denied": the row says so.
      .catch(() => undefined);

    return () => {
      gone = true;
    };
  }, []);
  const camera = (() => {
    try {
      return d.video?.mediaStreamTrack.getSettings() ?? null;
    } catch {
      return null;
    }
  })();
  const rows = deviceCheck({
    cameraOn: d.prefs.cam,
    camera,
    micOn: d.prefs.mic,
    audio: d.prefs.mic ? d.audioSettings : null,
    remote,
  });
  const summary = checkSummary(rows);

  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <b className="text-[12.5px] text-ink">{t('lobby.check')}</b>
        <span
          className={cx(
            'rounded-[5px] px-1.5 py-px text-[11px] font-semibold',
            summary === 'ok' ? 'bg-success-bg text-success' : summary === 'warn' ? 'bg-warning-bg text-warning' : 'bg-subtle text-ink-3',
          )}
        >
          {summary === 'ok' ? t('lobby.checkReady') : summary === 'warn' ? t('lobby.checkAttention') : t('lobby.checkChecking')}
        </span>
      </div>
      <dl className="m-0 flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.id} className="flex items-baseline gap-2 text-[12px]">
            <dt className="w-[108px] shrink-0 text-ink-3">{r.label}</dt>
            <dd className={cx('m-0 min-w-0 flex-1', r.state === 'warn' ? 'font-semibold text-warning' : 'text-ink-2')}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <label className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-[12px] text-ink-2">
        <Checkbox checked={keep} onChange={(e) => (setRemembering(e.target.checked), setKeep(e.target.checked))} />
        {t('lobby.remember')}
      </label>
    </div>
  );
}
