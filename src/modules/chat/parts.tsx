import { useEffect, useRef, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { frequentEmoji, noteEmojiUsed, searchEmoji } from './emoji';
import { levelsToWaveform } from './kit/waveform';
import { checkStorage, countdown, VOICE_CONSTRAINTS, VOICE_MAX_MS, voiceRecorderOptions } from './kit/recording';

/** Reactions offered on hover; the full set is in the picker. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export function EmojiPicker({ onPick, onClose, className }: { onPick: (e: string) => void; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [frequent] = useState(frequentEmoji);
  const found = searchEmoji(q);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const pick = (e: string) => {
    noteEmojiUsed(e);
    onPick(e);
  };
  const grid = (list: string[]) => (
    <div className="grid grid-cols-8 gap-0.5">
      {list.map((e) => (
        <button key={e} type="button" aria-label={e} onClick={() => pick(e)} className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[19px] hover:bg-subtle">
          {e}
        </button>
      ))}
    </div>
  );
  return (
    <div ref={ref} role="dialog" aria-label="Emoji" className={cx('z-40 flex w-[300px] flex-col gap-2 rounded-[12px] border border-line bg-surface p-2.5 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.18)]', className)}>
      <label className="flex h-8 items-center gap-2 rounded-[8px] border border-line px-2.5 focus-within:border-primary">
        <Icon name="search" size={14} className="text-ink-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found[0]) {
              e.preventDefault();
              pick(found[0]);
            }
          }}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="bare-focus min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
        />
      </label>
      <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto scroll-thin">
        {q.trim() ? (
          found.length ? grid(found) : <span className="px-1 py-3 text-center text-[12px] text-ink-3">No emoji match “{q.trim()}”</span>
        ) : (
          <>
            <span className="px-0.5 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">FREQUENTLY USED</span>
            {grid(frequent)}
            <span className="px-0.5 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">ALL</span>
            {grid(found)}
          </>
        )}
      </div>
    </div>
  );
}

/** Bars kept for the live level meter while recording. */
const LEVELS = 36;
/** The longest voice message the server keeps. */
const MOST = VOICE_MAX_MS;

/**
 * A voice note, recorded in place of the message box and sent as a chat
 * attachment with `voice: true` (the server keeps up to ten minutes). The
 * microphone is asked for when the person presses record, never before.
 * While it records: a red dot, the time, the live level, ✕ to throw it away
 * and Send; Pause holds it, to listen to what is there (Preview) and then go
 * on or send (#285). Its length is counted here, pauses left out, and its
 * loudness kept as the waveform sent with it, so the message shows both the
 * moment it is sent.
 *
 * Recorded as Opus, mono, 32 kbit/s (AAC in MP4 where Opus can't be), and sent
 * exactly as recorded (#300). Before the microphone opens it checks there is
 * room to keep the recording until it is sent; over the last half minute a
 * countdown shows; and a microphone that is taken away mid-recording (unplugged,
 * permission withdrawn) stops it with what was recorded kept, to send or throw
 * away. `onDone` is told when Send was pressed, for the send timings.
 */
export function VoiceRecorder({ onDone, onCancel, compact }: { onDone: (blob: Blob, ms: number, waveform: number[], pressedAt?: number) => void; onCancel: () => void; compact?: boolean }) {
  const [state, setState] = useState<'starting' | 'recording' | 'paused' | 'stopped' | 'failed'>('starting');
  // The microphone went away mid-recording: why, shown above what was kept.
  const [lost, setLost] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: LEVELS }, () => 0));
  // The recording so far, while Preview plays it.
  const [hearing, setHearing] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  // Every level read, for the waveform.
  const read = useRef<number[]>([]);
  // What was recorded before this stretch, and when this stretch began: a pause ends one.
  const before = useRef(0);
  const since = useRef(0);
  const paused = useRef(false);
  const took = useRef(0);
  const result = useRef<Blob | null>(null);
  const after = useRef<'keep' | 'send' | 'discard'>('keep');
  const pressed = useRef<number | undefined>(undefined);
  // What waits for the recorder to hand over what it holds (Preview while paused).
  const flushed = useRef<(() => void) | null>(null);
  const recorded = () => before.current + (paused.current ? 0 : Date.now() - since.current);
  const finish = (blob: Blob) => onDone(blob, took.current, levelsToWaveform(read.current), pressed.current);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let audio: AudioContext | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    const halt = () => {
      if (tick) clearInterval(tick);
      tick = null;
      stream?.getTracks().forEach((t) => t.stop());
      void audio?.close().catch(() => undefined);
      audio = null;
    };
    void (async () => {
      try {
        // Room to keep it until it is sent, asked before anything is recorded (#300).
        const room = await checkStorage(MOST);
        if (room.kind === 'full') throw new Error('This computer is out of space, so a voice message can\'t be recorded. Free some space and try again.');
        if (room.kind === 'low') toast('warning', `Space on this computer is low: there is room for about ${room.minutes} minute${room.minutes === 1 ? '' : 's'} of recording.`);
        const { granted } = await call('media:access', { kind: 'microphone' });
        if (!granted) throw new Error('WorkSuite is not allowed to use the microphone. Allow it in System Settings → Privacy & Security → Microphone.');
        stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_CONSTRAINTS });
        if (after.current === 'discard') return halt();
        let r: MediaRecorder;
        try {
          r = new MediaRecorder(stream, voiceRecorderOptions());
        } catch {
          // A recorder that refuses the bit rate still records, at its own.
          r = new MediaRecorder(stream);
        }
        // The microphone taken away mid-recording (unplugged, or its permission withdrawn): what was recorded is kept.
        const gone = (why: string) => {
          if (after.current === 'discard' || r.state === 'inactive') return;
          setLost(why);
          r.stop();
        };
        stream.getTracks().forEach((t) => t.addEventListener?.('ended', () => gone('The microphone stopped (unplugged, or its permission was withdrawn). What you recorded is kept: send it or throw it away.')));
        r.onerror = () => gone('Recording stopped because of a problem with the microphone. What you recorded is kept: send it or throw it away.');
        r.ondataavailable = (e) => {
          if (e.data.size) chunks.current.push(e.data);
          const then = flushed.current;
          flushed.current = null;
          then?.();
        };
        r.onstop = () => {
          took.current = recorded();
          halt();
          if (after.current === 'discard' || !chunks.current.length) return;
          result.current = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
          if (after.current === 'send') finish(result.current);
          else setState('stopped');
        };
        // The live level: the loudest moment of the last ~40 ms, read every tenth of a second while recording.
        audio = new AudioContext();
        void audio.resume().catch(() => undefined);
        const analyser = audio.createAnalyser();
        analyser.fftSize = 2048;
        audio.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        rec.current = r;
        since.current = Date.now();
        r.start(250);
        setState('recording');
        tick = setInterval(() => {
          if (paused.current) return;
          setElapsed(recorded());
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
          // A square root, as loudness is heard: quiet speech still moves the bars; the room's hiss does not.
          const level = Math.min(1, Math.sqrt(peak) * 1.3);
          read.current.push(level);
          setLevels((l) => [...l.slice(1), level]);
          if (recorded() >= MOST && r.state === 'recording') r.stop();
        }, 100);
      } catch (e) {
        halt();
        setState('failed');
        toast('error', errorMessage(e));
        onCancel();
      }
    })();
    return () => {
      after.current = 'discard';
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
      halt();
    };
    // Mount once: a new recording is a new recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A preview's address goes with it.
  useEffect(
    () => () => {
      if (hearing) URL.revokeObjectURL(hearing);
    },
    [hearing],
  );

  const pause = () => {
    const r = rec.current;
    if (r?.state !== 'recording') return;
    r.pause();
    before.current += Date.now() - since.current;
    paused.current = true;
    setElapsed(before.current);
    setState('paused');
  };
  const resume = () => {
    const r = rec.current;
    if (r?.state !== 'paused') return;
    setHearing(null);
    since.current = Date.now();
    paused.current = false;
    r.resume();
    setState('recording');
  };
  /** Preview: what is recorded so far, from the start. */
  const listen = () => {
    if (hearing) return setHearing(null);
    const r = rec.current;
    const play = () => {
      const blob = result.current ?? new Blob(chunks.current, { type: r?.mimeType || 'audio/webm' });
      if (blob.size) setHearing(URL.createObjectURL(blob));
    };
    // What the recorder still holds comes out first.
    if (r?.state === 'paused') {
      flushed.current = play;
      r.requestData();
    } else play();
  };
  const send = () => {
    pressed.current = performance.now();
    setHearing(null);
    if (state === 'stopped' && result.current) return finish(result.current);
    after.current = 'send';
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
  };
  const discard = () => {
    setHearing(null);
    after.current = 'discard';
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    onCancel();
  };
  const btn = compact ? 'h-7 w-7' : 'h-8 w-8';
  const tool = cx('flex shrink-0 items-center justify-center rounded-[8px] border border-line text-ink hover:bg-subtle', btn);
  const held = state === 'paused' || state === 'stopped';
  const left = state === 'recording' || state === 'paused' ? countdown(elapsed, MOST) : null;

  return (
    <div className={cx('flex flex-1 items-center', compact ? 'gap-1.5' : 'gap-2.5')} role="group" aria-label="Recording a voice message">
      <button type="button" aria-label="Cancel the voice message" title="Cancel" onClick={discard} className={cx('flex shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-danger', btn)}>
        <Icon name="x" size={compact ? 15 : 16} />
      </button>
      <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', state === 'recording' ? 'animate-pulse bg-danger' : held ? 'bg-ink-3' : 'bg-line')} aria-hidden />
      <span className="w-10 shrink-0 font-mono text-[13px] text-ink tabular" aria-label="Recorded">{formatClock(elapsed / 1000)}</span>
      {left !== null ? (
        <span role="timer" aria-live="polite" aria-label={`${Math.ceil(left / 1000)} seconds left`} className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-danger tabular">
          {formatClock(Math.ceil(left / 1000))} left
        </span>
      ) : null}
      <div className="flex h-7 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden={!lost}>
        {lost ? (
          <span role="alert" className="min-w-0 truncate text-[12px] text-danger" title={lost}>{lost}</span>
        ) : state === 'starting' ? (
          <span className="text-[12.5px] text-ink-3">Starting the microphone…</span>
        ) : (
          levels.map((v, i) => <span key={i} data-level={v.toFixed(2)} className={cx('w-[3px] shrink-0 rounded-full', state === 'recording' ? 'bg-danger' : 'bg-ink-3')} style={{ height: `${Math.max(12, v * 100)}%` }} />)
        )}
      </div>
      {held ? (
        <button type="button" aria-label={hearing ? 'Stop listening' : 'Listen to the recording'} title="Preview" onClick={listen} className={tool}>
          <Icon name={hearing ? 'pause' : 'play'} size={13} className={hearing ? undefined : 'fill-current'} />
        </button>
      ) : null}
      {state === 'recording' ? (
        <button type="button" aria-label="Pause recording" title="Pause" onClick={pause} className={tool}>
          <Icon name="pause" size={13} />
        </button>
      ) : state === 'paused' ? (
        <button type="button" aria-label="Resume recording" title="Resume" onClick={resume} className={cx(tool, 'text-danger')}>
          <Icon name="mic" size={14} />
        </button>
      ) : null}
      <button type="button" aria-label="Send the voice message" title="Send" onClick={send} disabled={state !== 'recording' && !held} className={cx('flex shrink-0 items-center justify-center rounded-[9px] bg-primary text-white hover:bg-primary-hover disabled:opacity-50', btn)}>
        <Icon name="send" size={compact ? 14 : 15} />
      </button>
      {hearing ? <audio src={hearing} autoPlay className="hidden" onEnded={() => setHearing(null)} /> : null}
    </div>
  );
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
