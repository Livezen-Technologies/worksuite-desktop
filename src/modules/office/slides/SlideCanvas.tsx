import { useEffect, useRef, useState } from 'react';
import { cx } from '../../../components/ui';
import type { Deck } from './render';

/** The screen's pixel ratio, followed as the window moves to another screen (2× on Retina). */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const on = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [dpr]);
  return dpr;
}

/**
 * One slide, painted at `width` CSS pixels wide and the screen's full resolution. `lazy`: painted only once it comes
 * near the view (a long deck's thumbnails).
 */
export function SlideCanvas({ deck, index, width, className, lazy = false, label }: { deck: Deck; index: number; width: number; className?: string; lazy?: boolean; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  const [near, setNear] = useState(() => !lazy || typeof IntersectionObserver === 'undefined');
  const height = Math.round((width * deck.height) / Math.max(1, deck.width));

  useEffect(() => {
    const el = canvas.current;
    if (near || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !near || width < 1) return;
    void deck.paint(el, index, width, dpr).catch(() => undefined);
  }, [deck, index, width, dpr, near]);

  return <canvas ref={canvas} role="img" aria-label={label ?? `Slide ${index + 1}`} style={{ width, height }} className={cx('block bg-white', className)} />;
}
