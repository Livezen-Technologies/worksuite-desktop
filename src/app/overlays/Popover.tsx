import { useEffect, useRef, type ReactNode } from 'react';
import { closeOverlay } from '../../core/ui';
import { cx } from '../../components/ui';

/** A title-bar popover: anchored under the bar, closes on Escape or outside click. */
export function Popover({ children, align = 'right', width = 380, offset = 16, label, className }: { children: ReactNode; align?: 'left' | 'right'; width?: number; offset?: number; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeOverlay();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeOverlay();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cx('animate-in fixed top-[58px] z-40 flex max-h-[calc(100vh-90px)] flex-col overflow-hidden bg-surface', className ?? 'rounded-[12px] border border-line shadow-2xl')}
      style={{ width, [align]: offset }}
    >
      {children}
    </div>
  );
}

export function PopoverHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <h2 className="text-[14.5px] font-bold text-ink">{title}</h2>
      {action}
    </div>
  );
}
