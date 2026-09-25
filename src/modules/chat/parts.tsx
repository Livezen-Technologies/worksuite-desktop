import { useEffect, useRef, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { IconButton, cx } from '../../components/ui';

/** Reactions offered on hover; the full set is in the picker. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const EMOJI = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '😘', '😋', '😜',
  '🤔', '🤗', '🤩', '😎', '🥳', '😏', '😐', '🙄', '😬', '😮', '😯', '😲', '😢', '😭', '😤', '😡',
  '🥺', '😴', '🤒', '🤯', '👍', '👎', '👏', '🙌', '🙏', '🤝', '👌', '✌️', '🤞', '💪', '👋', '👀',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💯', '🔥', '✨', '🎉', '🎂', '☕', '🍵', '✅', '❌',
  '⚠️', '📌', '📎', '📅', '📞', '💡', '🚀', '⭐',
];

export function EmojiPicker({ onPick, onClose, className }: { onPick: (e: string) => void; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
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
  return (
    <div ref={ref} role="dialog" aria-label="Emoji" className={cx('z-40 grid w-[296px] grid-cols-8 gap-0.5 rounded-[12px] border border-line bg-surface p-2 shadow-xl', className)}>
      {EMOJI.map((e) => (
        <button key={e} type="button" aria-label={e} onClick={() => onPick(e)} className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[19px] hover:bg-subtle">
          {e}
        </button>
      ))}
    </div>
  );
}

/**
 * A voice note, recorded here and sent as a chat attachment with `voice: true`
 * (the server keeps up to ten minutes). The microphone is asked for when the
 * person presses record, never before.
 */
export function VoiceRecorder({ onDone, onCancel }: { onDone: (blob: Blob, ms: number) => void; onCancel: () => void }) {
  const [state, setState] = useState<'starting' | 'recording' | 'failed'>('starting');
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const keep = useRef(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    let limit: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      try {
        const { granted } = await call('media:access', { kind: 'microphone' });
        if (!granted) throw new Error('WorkSuite is not allowed to use the microphone. Allow it in System Settings → Privacy & Security → Microphone.');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
        const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        r.onstop = () => {
          stream?.getTracks().forEach((t) => t.stop());
          if (keep.current && chunks.current.length) onDone(new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }), Date.now() - started.current);
        };
        rec.current = r;
        started.current = Date.now();
        r.start(250);
        setState('recording');
        tick = setInterval(() => setElapsed(Date.now() - started.current), 250);
        limit = setTimeout(() => r.state === 'recording' && r.stop(), 10 * 60_000);
      } catch (e) {
        setState('failed');
        toast('error', errorMessage(e));
        onCancel();
      }
    })();
    return () => {
      if (tick) clearInterval(tick);
      if (limit) clearTimeout(limit);
      keep.current = false;
      if (rec.current?.state === 'recording') rec.current.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // Mount once: a new recording is a new recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = (send: boolean) => {
    keep.current = send;
    if (rec.current?.state === 'recording') rec.current.stop();
    if (!send) onCancel();
  };

  return (
    <div className="flex flex-1 items-center gap-3 py-1" role="group" aria-label="Recording a voice note">
      <span className={cx('h-2.5 w-2.5 rounded-full', state === 'recording' ? 'animate-pulse bg-danger' : 'bg-line')} />
      <span className="font-mono text-[13px] text-ink tabular">{formatClock(elapsed / 1000)}</span>
      <span className="flex-1 text-[12.5px] text-ink-3">{state === 'starting' ? 'Starting the microphone…' : 'Recording — send when you are done'}</span>
      <IconButton icon="trash" label="Discard the voice note" onClick={() => stop(false)} />
      <IconButton icon="send" label="Send the voice note" onClick={() => stop(true)} disabled={state !== 'recording'} className="!text-primary" />
    </div>
  );
}

/**
 * A voice note's player. The bars are a picture, not the recording's real
 * levels: reading the audio would mean fetching it outside the page's media
 * rules. They are the same for a note every time it is shown.
 */
export function VoicePlayer({ src, ms, seed, own }: { src: string; ms: number | null; seed: number; own: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState((ms ?? 0) / 1000);
  const bars = Array.from({ length: 28 }, (_, i) => 30 + (((seed * 9301 + i * 49297) % 233280) / 233280) * 70);
  const done = total > 0 ? pos / total : 0;
  return (
    <div className={cx('flex w-[260px] items-center gap-2.5 rounded-[14px] px-3 py-2', own ? 'bg-primary text-white' : 'border border-line bg-surface text-ink')}>
      <button
        type="button"
        aria-label={playing ? 'Pause the voice note' : 'Play the voice note'}
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) void a.play();
          else a.pause();
        }}
        className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', own ? 'bg-white/20' : 'bg-subtle')}
      >
        <Icon name={playing ? 'pause' : 'play'} size={15} />
      </button>
      <div className="flex h-7 flex-1 items-center gap-[2px]" aria-hidden>
        {bars.map((h, i) => (
          <span key={i} className={cx('w-[3px] rounded-full', i / bars.length <= done ? (own ? 'bg-white' : 'bg-primary') : own ? 'bg-white/40' : 'bg-line')} style={{ height: `${h}%` }} />
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
