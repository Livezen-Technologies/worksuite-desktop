import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './ui';

/**
 * A panel whose width the person sets by dragging a divider (worksuite-desktop#34): kept between a minimum and a
 * maximum, remembered on this computer (a view preference, not data), back to its default on a double-click.
 *
 * `max` may be a function, read when the window changes size, so a panel never leaves its neighbour less room than
 * that neighbour needs.
 */
export interface ResizableWidth {
  width: number;
  min: number;
  max: number;
  set: (w: number) => void;
  /** Stored as well as set: the end of a drag, a key press, a reset. */
  commit: (w: number) => void;
  reset: () => void;
  defaultWidth: number;
}

const KEY = 'ws.width.';

function read(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(KEY + id));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function store(id: string, w: number | null): void {
  try {
    if (w === null) localStorage.removeItem(KEY + id);
    else localStorage.setItem(KEY + id, String(Math.round(w)));
  } catch {
    // Only a convenience: the panel opens at its default next time.
  }
}

export function useResizableWidth(id: string, opts: { defaultWidth: number; min: number; max: number | (() => number) }): ResizableWidth {
  const { defaultWidth, min } = opts;
  const maxOf = opts.max;
  const limit = useCallback(() => Math.max(min, typeof maxOf === 'function' ? maxOf() : maxOf), [maxOf, min]);
  const [max, setMax] = useState(limit);
  const clamp = useCallback((w: number) => Math.round(Math.min(limit(), Math.max(min, w))), [limit, min]);
  const [width, setWidth] = useState(() => clamp(read(id) ?? defaultWidth));

  // A smaller window lowers the most the panel may take; it gives the room back when the window grows again.
  useEffect(() => {
    const onResize = () => {
      setMax(limit());
      setWidth((w) => clamp(read(id) ?? w));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp, id, limit]);

  const set = useCallback((w: number) => setWidth(clamp(w)), [clamp]);
  const commit = useCallback(
    (w: number) => {
      const c = clamp(w);
      setWidth(c);
      store(id, c === defaultWidth ? null : c);
    },
    [clamp, defaultWidth, id],
  );
  const reset = useCallback(() => {
    setWidth(clamp(defaultWidth));
    store(id, null);
  }, [clamp, defaultWidth, id]);

  return { width, min, max, set, commit, reset, defaultWidth };
}

/** Arrow keys move the divider this far; with Shift, further. */
const STEP = 16;
const BIG_STEP = 64;

/**
 * The divider on a panel's edge: drag it (mouse, pen or touch), or focus it and use ← → (Shift for bigger steps),
 * Home and End for the limits, Enter or a double-click for the default. It sits over the panel's border, is
 * highlighted on hover, while dragging and when focused, and shows the resize cursor.
 */
export function ResizeDivider({ state, label, side = 'right', className }: { state: ResizableWidth; label: string; side?: 'left' | 'right'; className?: string }) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);
  // The panel grows toward the divider's side: rightwards for a divider on its right edge.
  const dir = side === 'right' ? 1 : -1;

  const end = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    if (d) state.commit(d.last);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={state.width}
      aria-valuemin={state.min}
      aria-valuemax={state.max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-dragging={dragging || undefined}
      className={cx(
        'group/divider absolute inset-y-0 z-10 flex w-[7px] cursor-col-resize touch-none justify-center outline-none',
        side === 'right' ? '-right-[4px]' : '-left-[4px]',
        className,
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, w: state.width, last: state.width };
        setDragging(true);
        // The whole window shows the resize cursor and selects no text while the divider moves.
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = d.w + dir * (e.clientX - d.x);
        state.set(d.last);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => drag.current && end()}
      onDoubleClick={() => state.reset()}
      onKeyDown={(e) => {
        const step = e.shiftKey ? BIG_STEP : STEP;
        const next =
          e.key === 'ArrowRight' ? state.width + dir * step
          : e.key === 'ArrowLeft' ? state.width - dir * step
          : e.key === 'Home' ? state.min
          : e.key === 'End' ? state.max
          : null;
        if (e.key === 'Enter') {
          e.preventDefault();
          state.reset();
        } else if (next !== null) {
          e.preventDefault();
          state.commit(next);
        }
      }}
    >
      <span
        aria-hidden
        className={cx(
          'h-full w-[2px] rounded-full transition-colors',
          dragging ? 'bg-primary' : 'bg-transparent group-hover/divider:bg-primary/60 group-focus-visible/divider:bg-primary',
        )}
      />
    </div>
  );
}
