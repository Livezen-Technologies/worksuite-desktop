import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { Track } from 'livekit-client';
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
