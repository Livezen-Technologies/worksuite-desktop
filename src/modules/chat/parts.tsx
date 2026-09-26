import { useEffect, useRef, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { frequentEmoji, noteEmojiUsed, searchEmoji } from './emoji';

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

/**
 * A voice note, recorded in place of the message box and sent as a chat
 * attachment with `voice: true` (the server keeps up to ten minutes). The
 * microphone is asked for when the person presses record, never before. Stop
 * keeps the recording to send or throw away; send stops and sends at once.
 */
export function VoiceRecorder({ onDone, onCancel, compact }: { onDone: (blob: Blob, ms: number) => void; onCancel: () => void; compact?: boolean }) {
  const [state, setState] = useState<'starting' | 'recording' | 'stopped' | 'failed'>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: LEVELS }, () => 0));
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const took = useRef(0);
  const result = useRef<Blob | null>(null);
  const after = useRef<'keep' | 'send' | 'discard'>('keep');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let audio: AudioContext | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    let limit: ReturnType<typeof setTimeout> | null = null;
    const halt = () => {
      if (tick) clearInterval(tick);
      if (limit) clearTimeout(limit);
      tick = limit = null;
      stream?.getTracks().forEach((t) => t.stop());
      void audio?.close().catch(() => undefined);
      audio = null;
    };
    void (async () => {
      try {
        const { granted } = await call('media:access', { kind: 'microphone' });
        if (!granted) throw new Error('WorkSuite is not allowed to use the microphone. Allow it in System Settings → Privacy & Security → Microphone.');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (after.current === 'discard') return halt();
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
        const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        r.onstop = () => {
          took.current = Date.now() - started.current;
          halt();
          if (after.current === 'discard' || !chunks.current.length) return;
          result.current = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
          if (after.current === 'send') onDone(result.current, took.current);
          else setState('stopped');
        };
        // The live level: the loudest moment of the last ~40 ms, read every tenth of a second.
        audio = new AudioContext();
        void audio.resume().catch(() => undefined);
        const analyser = audio.createAnalyser();
        analyser.fftSize = 2048;
        audio.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        rec.current = r;
        started.current = Date.now();
        r.start(250);
        setState('recording');
        tick = setInterval(() => {
          setElapsed(Date.now() - started.current);
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
          // A square root, as loudness is heard: quiet speech still moves the bars; the room's hiss does not.
          const level = Math.min(1, Math.sqrt(peak) * 1.3);
          setLevels((l) => [...l.slice(1), level]);
        }, 100);
        limit = setTimeout(() => r.state === 'recording' && r.stop(), 10 * 60_000);
      } catch (e) {
        halt();
        setState('failed');
        toast('error', errorMessage(e));
        onCancel();
      }
    })();
    return () => {
      after.current = 'discard';
      if (rec.current?.state === 'recording') rec.current.stop();
      halt();
    };
    // Mount once: a new recording is a new recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    after.current = 'keep';
    if (rec.current?.state === 'recording') rec.current.stop();
  };
  const send = () => {
    if (state === 'stopped' && result.current) return onDone(result.current, took.current);
    after.current = 'send';
    if (rec.current?.state === 'recording') rec.current.stop();
  };
  const discard = () => {
    after.current = 'discard';
    if (rec.current?.state === 'recording') rec.current.stop();
    onCancel();
  };
  const btn = compact ? 'h-7 w-7' : 'h-8 w-8';

  return (
    <div className={cx('flex flex-1 items-center', compact ? 'gap-1.5' : 'gap-2.5')} role="group" aria-label="Recording a voice message">
      <button type="button" aria-label="Delete the voice message" title="Delete" onClick={discard} className={cx('flex shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-danger', btn)}>
        <Icon name="trash" size={compact ? 15 : 16} />
      </button>
      <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', state === 'recording' ? 'animate-pulse bg-danger' : state === 'stopped' ? 'bg-ink-3' : 'bg-line')} aria-hidden />
      <span className="w-10 shrink-0 font-mono text-[13px] text-ink tabular" aria-label="Recorded">{formatClock(elapsed / 1000)}</span>
      <div className="flex h-7 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
        {state === 'starting' ? (
          <span className="text-[12.5px] text-ink-3">Starting the microphone…</span>
        ) : (
          levels.map((v, i) => <span key={i} data-level={v.toFixed(2)} className={cx('w-[3px] shrink-0 rounded-full', state === 'recording' ? 'bg-danger' : 'bg-ink-3')} style={{ height: `${Math.max(12, v * 100)}%` }} />)
        )}
      </div>
      {state === 'recording' ? (
        <button type="button" aria-label="Stop recording" title="Stop" onClick={stop} className={cx('flex shrink-0 items-center justify-center rounded-[8px] border border-line text-ink hover:bg-subtle', btn)}>
          <Icon name="stop" size={13} className="fill-current" />
        </button>
      ) : null}
      <button type="button" aria-label="Send the voice message" title="Send" onClick={send} disabled={state !== 'recording' && state !== 'stopped'} className={cx('flex shrink-0 items-center justify-center rounded-[9px] bg-primary text-white hover:bg-primary-hover disabled:opacity-50', btn)}>
        <Icon name="send" size={compact ? 14 : 15} />
      </button>
    </div>
  );
}

/**
 * A voice note's player. The bars are a picture, not the recording's real
 * levels: reading the audio would mean fetching it outside the page's media
 * rules. They are the same for a note every time it is shown.
 */
export function VoicePlayer({ src, ms, seed, own, bare }: { src: string; ms: number | null; seed: number; own: boolean; /** Inside a bubble (the chat drawer): no box of its own, a solid play button. */ bare?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState((ms ?? 0) / 1000);
  const bars = Array.from({ length: 28 }, (_, i) => 30 + (((seed * 9301 + i * 49297) % 233280) / 233280) * 70);
  const done = total > 0 ? pos / total : 0;
  return (
    <div className={cx('flex items-center gap-2.5', bare ? 'w-[230px] px-1 py-0.5 text-ink' : cx('w-[260px] rounded-[14px] px-3 py-2', own ? 'bg-primary text-white' : 'border border-line bg-surface text-ink'))}>
      <button
        type="button"
        aria-label={playing ? 'Pause the voice note' : 'Play the voice note'}
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) void a.play();
          else a.pause();
        }}
        className={cx('flex shrink-0 items-center justify-center rounded-full', bare ? 'h-[34px] w-[34px] bg-primary text-white' : cx('h-8 w-8', own ? 'bg-white/20' : 'bg-subtle'))}
      >
        <Icon name={playing ? 'pause' : 'play'} size={15} />
      </button>
      <div className="flex h-7 flex-1 items-center gap-[2px]" aria-hidden>
        {bars.map((h, i) => (
          <span key={i} className={cx('w-[3px] rounded-full', done > 0 && i / bars.length < done ? (own && !bare ? 'bg-white' : cx('bg-primary', own && 'dark:bg-[#B4C3FF]')) : own && !bare ? 'bg-white/40' : 'bg-[#9AA6D6] dark:bg-white/25')} style={{ height: `${h}%` }} />
        ))}
      </div>
      <span className="font-mono text-[11.5px] tabular opacity-80">{formatClock(playing || pos ? pos : total)}</span>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setTotal(e.currentTarget.duration)}
      />
    </div>
  );
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
