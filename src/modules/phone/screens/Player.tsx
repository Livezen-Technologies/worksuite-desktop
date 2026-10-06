import { useRef, useState } from 'react';
import { apiUrl } from '../../../core/api';
import { app } from '../../../core/app-state';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { phoneApi } from '../api';
import { clock } from '../lib/format';
import { Mono } from '../parts';

/**
 * A recording's address, playable in <audio>. The server signs it as `/media/stream/<token>` at its own root (the
 * page policy allows media from that server only) and logs the play; anything under `/api/` goes through the app's
 * proxy with the session.
 */
export function recordingSrc(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/^https:\/\//i.test(u)) return u;
  if (u.startsWith('/api/')) return apiUrl(u);
  if (u.startsWith('/')) {
    const origin = app.get().auth?.server?.origin;
    return origin ? `${origin}${u}` : null;
  }
  return null;
}

/**
 * The recording player (W05, W06) — keyed by recording by its callers, so a new one starts clean: play, seek, speed, and the call's notes pinned at their seconds. No waveform is
 * drawn — the audio is the server's and is not decoded here — so the bar shows only what is known: time and pins.
 */
export function Player({
  recordingId,
  duration,
  pins = [],
  onTime,
  dark,
  onPlayed,
}: {
  recordingId: number;
  duration: number;
  pins?: Array<{ at: number; label: string }>;
  onTime?: (s: number) => void;
  dark?: boolean;
  onPlayed?: () => void;
}) {
  const el = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [rate, setRate] = useState(1);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(duration);

  const toggle = async () => {
    const a = el.current;
    if (!a) return;
    if (!src) {
      setLoading(true);
      try {
        const r = await phoneApi.play(recordingId);
        const s = recordingSrc(r.url);
        if (!s) throw new Error('The recording’s address could not be read.');
        setSrc(s);
        if (r.duration) setTotal(r.duration);
        a.src = s;
        a.playbackRate = rate;
        await a.play();
        onPlayed?.();
      } catch (e) {
        toast('error', (e as Error).message || 'The recording could not be played.');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (a.paused) void a.play();
    else a.pause();
  };

  const seek = (s: number) => {
    const a = el.current;
    if (!a || !src) return;
    a.currentTime = Math.max(0, Math.min(total || a.duration || 0, s));
  };

  return (
    <div className={cx('flex flex-col gap-2', dark && 'text-white')}>
      <audio
        ref={el}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setTotal(Math.round(e.currentTarget.duration))}
        onTimeUpdate={(e) => {
          const s = e.currentTarget.currentTime;
          setT(s);
          onTime?.(Math.floor(s));
        }}
      />
      <div className="flex items-center gap-3">
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => void toggle()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-hover">
          <Icon name={loading ? 'spinner' : playing ? 'pause' : 'play'} size={18} className={loading ? 'animate-spin-slow' : undefined} />
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(1, total)}
            step={1}
            value={Math.floor(t)}
            disabled={!src}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Position"
            className="w-full accent-[var(--color-primary)]"
          />
          {pins.map((p, i) => (
            <button
              key={i}
              type="button"
              title={`${clock(p.at)} · ${p.label}`}
              aria-label={`Note at ${clock(p.at)}`}
              onClick={() => seek(p.at)}
              style={{ left: `${total > 0 ? Math.min(100, (p.at / total) * 100) : 0}%` }}
              className="absolute -top-1.5 h-3 w-1.5 -translate-x-1/2 rounded-sm bg-warning"
            />
          ))}
        </div>
        <Mono className={cx('shrink-0 text-[12px]', dark ? 'text-white/70' : 'text-ink-2')}>
          {clock(t)} / {clock(total)}
        </Mono>
        <select aria-label="Speed" value={rate} onChange={(e) => {
          const r = Number(e.target.value);
          setRate(r);
          if (el.current) el.current.playbackRate = r;
        }} className="h-8 rounded-[8px] border border-line bg-surface px-1.5 text-[12px] text-ink">
          {[1, 1.25, 1.5, 2].map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
