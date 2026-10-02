import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';

/**
 * CoreCallControls: the one control bar a call surface shows — a compact
 * toolbar floating over the bottom of the stage. The floating card has its
 * own smaller set (FloatingCard); the two are never on screen together.
 *
 * Buttons are icons with a name on hover. A few open a small menu above them
 * (sharing, layout, more). The workspace fades the bar when the mouse is
 * still; while the pointer is on it, a menu is open or a button has focus,
 * it stays.
 */
export interface ControlButton {
  id: string;
  icon: string;
  label: string;
  /** Pressed look: on (camera on) or needing attention (muted). */
  tone?: 'on' | 'warn' | 'active';
  onClick?: () => void;
  menu?: MenuEntry[];
  badge?: number;
  disabled?: boolean;
}

export type MenuEntry = { label: string; hint?: string; icon?: string; checked?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void } | { heading: string } | 'sep';

export function CoreCallControls({
  buttons,
  end,
  visible,
  compact,
  onHold,
  status,
}: {
  buttons: ControlButton[];
  end: { label: string; onClick: () => void; menu?: MenuEntry[] };
  visible: boolean;
  compact: boolean;
  /** The bar is being used (pointer on it, menu open): the workspace must not fade it. */
  onHold: (held: boolean) => void;
  /** A line above the buttons: "Sharing Screen 1". */
  status?: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => onHold(open !== null), [open, onHold]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const size = compact ? 40 : 44;
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Call controls"
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(open !== null)}
      onFocusCapture={() => onHold(true)}
      className={cx(
        'no-drag absolute bottom-5 left-1/2 z-[40] flex -translate-x-1/2 flex-col items-center gap-1.5 transition-opacity duration-300',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {status ? <div className="rounded-full bg-[rgba(11,18,38,.82)] px-3 py-1 text-[12px] font-semibold text-[#E6ECFA] backdrop-blur">{status}</div> : null}
      <div className="flex items-center gap-1 rounded-[18px] border border-white/10 bg-[rgba(15,27,61,.88)] p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.45)] backdrop-blur-md">
        {buttons.map((b) => (
          <div key={b.id} className="relative">
            <button
              type="button"
              aria-label={b.label}
              title={b.label}
              aria-pressed={b.tone ? true : undefined}
              aria-haspopup={b.menu ? 'menu' : undefined}
              aria-expanded={b.menu ? open === b.id : undefined}
              disabled={b.disabled}
              onClick={() => (b.menu ? setOpen(open === b.id ? null : b.id) : (setOpen(null), b.onClick?.()))}
              className={cx(
                'relative flex items-center justify-center rounded-[13px] transition-colors disabled:opacity-40',
                b.tone === 'warn' ? 'bg-white text-[#B42318]' : b.tone === 'on' ? 'bg-white text-[#0F1B3D]' : b.tone === 'active' ? 'bg-[#3B5BDB] text-white' : 'text-[#E6ECFA] hover:bg-white/12',
                open === b.id && !b.tone && 'bg-white/16',
              )}
              style={{ width: size, height: size }}
            >
              <Icon name={b.icon} size={compact ? 18 : 20} />
              {b.badge ? <span className="absolute -top-1 -right-1 min-w-[17px] rounded-full bg-[#E0522F] px-1 text-[10.5px] leading-[17px] font-bold text-white">{b.badge}</span> : null}
            </button>
            {open === b.id && b.menu ? <Menu entries={b.menu} onDone={() => setOpen(null)} /> : null}
          </div>
        ))}
        <span className="mx-1 h-7 w-px bg-white/14" />
        <div className="relative flex">
          <button
            type="button"
            aria-label={end.label}
            title={end.label}
            onClick={() => (setOpen(null), end.onClick())}
            className={cx('flex items-center justify-center bg-[#E5484D] text-white hover:bg-[#D93D42]', end.menu ? 'rounded-l-[13px]' : 'rounded-[13px]')}
            style={{ width: size + 12, height: size }}
          >
            <Icon name="phone-off" size={compact ? 18 : 20} />
          </button>
          {end.menu ? (
            <>
              <button type="button" aria-label="More ways to leave" aria-haspopup="menu" aria-expanded={open === 'end'} onClick={() => setOpen(open === 'end' ? null : 'end')} className="flex w-6 items-center justify-center rounded-r-[13px] border-l border-white/20 bg-[#E5484D] text-white hover:bg-[#D93D42]" style={{ height: size }}>
                <Icon name="chevron-down" size={14} />
              </button>
              {open === 'end' ? <Menu entries={end.menu} onDone={() => setOpen(null)} right /> : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Menu({ entries, onDone, right }: { entries: MenuEntry[]; onDone: () => void; right?: boolean }) {
  return (
    <div role="menu" className={cx('absolute bottom-[calc(100%+10px)] z-[50] w-[240px] rounded-[12px] border border-white/10 bg-[#16254F] p-1.5 text-[13px] text-[#E6ECFA] shadow-[0_16px_40px_rgba(0,0,0,.5)]', right ? 'right-0' : 'left-1/2 -translate-x-1/2')}>
      {entries.map((e, i) =>
        e === 'sep' ? (
          <span key={i} className="mx-1.5 my-1 block h-px bg-white/10" />
        ) : 'heading' in e ? (
          <span key={i} className="block px-2.5 pt-1.5 pb-1 text-[11px] font-bold tracking-[0.4px] text-[#AFC0E8] uppercase">
            {e.heading}
          </span>
        ) : (
          <button
            key={i}
            type="button"
            role={e.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={e.checked}
            disabled={e.disabled}
            onClick={() => (onDone(), e.onClick())}
            className={cx('flex min-h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left hover:bg-white/10 disabled:opacity-40 disabled:cursor-wait', e.danger && 'text-[#FFB4A2]')}
          >
            {e.icon ? <Icon name={e.icon} size={15} className="shrink-0 text-[#AFC0E8]" /> : null}
            <span className="min-w-0 flex-1">
              {e.label}
              {e.hint ? <span className="block text-[11.5px] text-[#AFC0E8]">{e.hint}</span> : null}
            </span>
            {e.checked ? <Icon name="check" size={15} className="shrink-0 text-[#9EE6C3]" /> : null}
          </button>
        ),
      )}
    </div>
  );
}
