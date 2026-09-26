import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { Track } from 'livekit-client';
import { Icon } from '../../components/Icon';
import { initials, cx } from '../../components/ui';

/** Re-renders every second while mounted: call clocks. */
export function useNow(every = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** A LiveKit video track in a <video>, attached while mounted. */
export function VideoView({ track, className, mirror }: { track: Track; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={className} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />;
}

/** The round control of the call designs: dark when off, white when it needs attention. */
export function Pill({ on, warn, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; warn?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'no-drag h-11 min-w-[76px] shrink-0 rounded-full px-3 text-[12px] font-bold disabled:opacity-50',
        warn ? 'bg-white text-[#B42318]' : on ? 'bg-white text-[#151A2D]' : 'bg-[#2A3A66] text-white hover:bg-[#344777]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A person's initials on the call designs' pale disc, glowing while they speak or ring. */
export function CallAvatar({ name, size, glow }: { name: string | null | undefined; size: number; glow?: 'ring' | 'incoming' | 'speaking' | null }) {
  const shadow = glow === 'ring' ? '0 0 0 10px rgba(127,162,255,.18), 0 0 0 20px rgba(127,162,255,.08)' : glow === 'incoming' ? '0 0 0 6px rgba(61,214,140,.22)' : glow === 'speaking' ? '0 0 0 4px #3DD68C' : 'none';
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-[#E3F4F5] font-bold text-[#0B6770] transition-shadow" style={{ width: size, height: size, fontSize: Math.round(size * 0.31), boxShadow: shadow }} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** A round call control with its name under it (CallWindow, CallVoice). */
export function RoundButton({ icon, label, onClick, tone = 'dim', size = 56, disabled, pressed }: { icon: string; label: string; onClick: () => void; tone?: 'dim' | 'white' | 'red' | 'green'; size?: number; disabled?: boolean; pressed?: boolean }) {
  return (
    <span className="flex w-[74px] flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        title={label}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          'no-drag flex items-center justify-center rounded-full disabled:opacity-50',
          tone === 'white' && 'bg-white text-[#0F1B3D]',
          tone === 'dim' && 'bg-white/12 text-white hover:bg-white/20',
          tone === 'red' && 'bg-[#E5484D] text-white shadow-[0_10px_24px_rgba(229,72,77,.4)] hover:bg-[#D93D42]',
          tone === 'green' && 'bg-[#22A861] text-white shadow-[0_8px_20px_rgba(34,168,97,.35)] hover:bg-[#1E9656]',
        )}
        style={{ width: size, height: size }}
      >
        <Icon name={icon} size={size >= 60 ? 26 : 22} />
      </button>
      <span className="text-[11px] whitespace-nowrap text-[#C9D3EE]">{label}</span>
    </span>
  );
}

const WAVE = [6, 12, 20, 14, 8, 18, 24, 12, 6, 10, 16, 8, 14, 6];

/** The voice bars under the name: moving while someone speaks, flat while muted. */
export function Wave({ live, muted }: { live: boolean; muted: boolean }) {
  return (
    <div aria-hidden className="flex h-[26px] items-center gap-[3px]">
      {WAVE.map((h, i) => (
        <span
          key={i}
          className={cx('w-1 rounded-[2px] bg-[#3DD68C]', live && !muted && 'animate-wave')}
          style={{ height: muted ? 4 : h, opacity: muted ? 0.35 : 0.9, animationDelay: `${(i % 5) * 0.12}s` }}
        />
      ))}
    </div>
  );
}
