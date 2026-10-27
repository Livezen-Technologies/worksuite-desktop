import { useEffect, useState } from 'react';
import type { ButtonLayout, WindowButton } from '@shared/window-controls';
import { call, on } from '../core/bridge';
import { t } from '../core/i18n';
import { cx } from './ui';

/**
 * Where this window's own buttons go, and whether it is maximised (Linux, #409). Null where the system draws the
 * buttons (macOS, Windows) — or outside the desktop app.
 */
export function useWindowButtons(): { layout: ButtonLayout | null; maximized: boolean } {
  const [layout, setLayout] = useState<ButtonLayout | null>(null);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let live = true;
    void call('windows:state').then(
      (s) => {
        if (!live) return;
        setLayout(s.buttonLayout ?? null);
        setMaximized(!!s.maximized);
      },
      () => undefined,
    );
    const off = on<boolean>('window:maximized', (v) => setMaximized(!!v));
    return () => {
      live = false;
      off();
    };
  }, []);
  return { layout, maximized };
}

/**
 * Minimise, maximise / restore and close, drawn by the title bar itself on Linux (#409) in the desktop's order. Each
 * is a fixed 32 px square hit area, out of the drag region, with crisp 10 px glyphs at any scale; they never shrink,
 * so the bar's other items give way instead of covering them.
 */
export function WindowControls({ layout, maximized, height = 32, className }: { layout: ButtonLayout; maximized: boolean; height?: number; className?: string }) {
  if (!layout.buttons.length) return null;
  return (
    <div className={cx('no-drag flex shrink-0 items-center gap-1.5', className)} data-testid="window-controls">
      {layout.buttons.map((b) => (
        <ControlButton key={b} button={b} maximized={maximized} size={height} />
      ))}
    </div>
  );
}

function ControlButton({ button, maximized, size }: { button: WindowButton; maximized: boolean; size: number }) {
  const label = button === 'minimize' ? t('window.minimize') : button === 'close' ? t('common.close') : maximized ? t('window.restore') : t('window.maximize');
  const act = () => {
    if (button === 'minimize') void call('windows:minimize').catch(() => undefined);
    else if (button === 'maximize') void call('windows:toggleMaximize').catch(() => undefined);
    else void call('windows:close').catch(() => undefined);
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={act}
      // A double-click on a button is two clicks, not the bar's maximise.
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ width: size, height: size }}
      className={cx('no-drag flex shrink-0 items-center justify-center rounded-full text-navy-ink hover:bg-white/12 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60', button === 'close' && 'hover:bg-red hover:text-white')}
    >
      <Glyph button={button} maximized={maximized} />
    </button>
  );
}

function Glyph({ button, maximized }: { button: WindowButton; maximized: boolean }) {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden="true" shapeRendering="geometricPrecision">
      {button === 'minimize' ? <path d="M1 5.5h8" /> : null}
      {button === 'maximize' && !maximized ? <rect x={1.1} y={1.1} width={7.8} height={7.8} rx={1} /> : null}
      {button === 'maximize' && maximized ? (
        <>
          <rect x={1.1} y={3.1} width={5.8} height={5.8} rx={1} />
          <path d="M3.1 3.1V2.1a1 1 0 0 1 1-1h3.8a1 1 0 0 1 1 1v3.8a1 1 0 0 1-1 1h-1" />
        </>
      ) : null}
      {button === 'close' ? <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /> : null}
    </svg>
  );
}
