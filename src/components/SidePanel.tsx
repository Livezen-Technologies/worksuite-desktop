import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './ui';

const KEY = 'ws.panel.';

function remembered(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(KEY + id);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function remember(id: string, open: boolean): void {
  try {
    localStorage.setItem(KEY + id, open ? '1' : '0');
  } catch {
    // Only a convenience: the panel simply opens again next time.
  }
}

/**
 * A module's side panel — its rail, folder list, outline or details — that
 * can be hidden and shown again. Open, a small handle on the panel's inner
 * edge hides it — shown only while the pointer is over the panel or the
 * handle has keyboard focus, so it never sits over the content (#155); hidden, a narrow strip with the panel icon brings it back.
 * Which panels are hidden is remembered on this computer (a view preference,
 * not data).
 */
export function SidePanel({ id, label, side = 'left', defaultOpen = true, children }: { id: string; label: string; side?: 'left' | 'right'; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => remembered(id, defaultOpen));
  const toggle = () => {
    remember(id, !open);
    setOpen(!open);
  };
  const left = side === 'left';
  if (!open) {
    return (
      <div data-side-panel={id} className={cx('flex w-9 shrink-0 flex-col items-center border-line bg-rail pt-2.5', left ? 'border-r' : 'border-l')}>
        <button type="button" aria-label={`Show ${label}`} title={`Show ${label}`} aria-expanded={false} onClick={toggle} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-2 hover:bg-subtle hover:text-ink">
          <Icon name={left ? 'panel-open' : 'panel-right-open'} size={16} />
        </button>
      </div>
    );
  }
  return (
    <div data-side-panel={id} className="group/panel relative flex min-h-0 shrink-0">
      {children}
      <button
        type="button"
        aria-label={`Hide ${label}`}
        title={`Hide ${label}`}
        aria-expanded
        onClick={toggle}
        className={cx(
          'absolute top-1/2 z-20 flex h-10 w-4 -translate-y-1/2 items-center justify-center border border-line bg-surface text-ink-3 opacity-0 shadow-sm transition-opacity hover:text-ink hover:opacity-100 focus-visible:opacity-100 group-hover/panel:opacity-100',
          left ? '-right-2 rounded-[6px]' : '-left-2 rounded-[6px]',
        )}
      >
        <Icon name={left ? 'chevron-left' : 'chevron-right'} size={12} />
      </button>
    </div>
  );
}
