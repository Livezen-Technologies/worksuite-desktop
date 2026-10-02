import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Icon } from '../../../components/Icon';
import { Menu, type MenuSection } from '../../../components/Menu';
import { cx } from '../../../components/ui';
import { text } from '../../../core/i18n';

/**
 * CoreCallControls: the one control bar a call surface shows — a compact
 * toolbar floating over the bottom of the stage. The floating card has its
 * own smaller set (FloatingCard); the two are never on screen together.
 *
 * Buttons are icons with a name on hover. A few open a menu (components/Menu)
 * above them (sharing, layout, more) — placed so it never covers the bar,
 * a bottom sheet in a narrow window. Up or Down on such a button opens it
 * too. The workspace fades the bar when the mouse is still; while the
 * pointer is on it, a menu is open or a button has focus, it stays.
 */
export interface ControlButton {
  id: string;
  icon: string;
  label: string;
  /** Pressed look: on (camera on) or needing attention (muted). */
  tone?: 'on' | 'warn' | 'active';
  onClick?: () => void;
  /** A short list (sharing options, layout): headings and separators become sections. */
  menu?: MenuEntry[];
  /** A grouped menu with submenus (More). */
  sections?: MenuSection[];
  badge?: number;
  disabled?: boolean;
}

export type MenuEntry = { label: string; hint?: string; icon?: string; checked?: boolean; radio?: boolean; danger?: boolean; disabled?: boolean; reason?: string; onClick: () => void } | { heading: string } | 'sep';

/** A flat list of entries as menu sections: each heading or separator starts the next one. */
export function entriesToSections(entries: MenuEntry[], prefix = 'm'): MenuSection[] {
  const out: MenuSection[] = [];
  let current: MenuSection | null = null;
  const next = (label?: string) => {
    current = { id: `${prefix}-${out.length}`, label, items: [] };
    out.push(current);
    return current;
  };
  entries.forEach((e, i) => {
    if (e === 'sep') next();
    else if ('heading' in e) next(e.heading);
    else {
      const section: MenuSection = current ?? next();
      section.items.push({ id: `${prefix}-${i}`, label: e.label, description: e.hint, icon: e.icon, checked: e.checked, radio: e.radio, danger: e.danger, disabled: e.disabled, reason: e.reason, onSelect: e.onClick });
    }
  });
  return out.filter((sec) => sec.items.length > 0);
}

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
  const endMenu = useRef<HTMLButtonElement>(null);

  useEffect(() => onHold(open !== null), [open, onHold]);

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
          <BarButton key={b.id} b={b} size={size} compact={compact} open={open === b.id} onOpen={(v) => setOpen(v ? b.id : null)} bar={bar} />
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
              <button ref={endMenu} type="button" aria-label="More ways to leave" aria-haspopup="menu" aria-expanded={open === 'end'} onKeyDown={openKey(() => setOpen('end'))} onClick={() => setOpen(open === 'end' ? null : 'end')} className="flex w-6 items-center justify-center rounded-r-[13px] border-l border-white/20 bg-[#E5484D] text-white hover:bg-[#D93D42]" style={{ height: size }}>
                <Icon name="chevron-down" size={14} />
              </button>
              {open === 'end' ? <Menu sections={entriesToSections(end.menu, 'end')} label={text('More ways to leave')} anchor={endMenu} avoid={bar} align="end" onClose={() => setOpen(null)} /> : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Up or Down on a menu button opens its menu (and focus moves into it).
const openKey = (open: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    open();
  }
};

function BarButton({ b, size, compact, open, onOpen, bar }: { b: ControlButton; size: number; compact: boolean; open: boolean; onOpen: (open: boolean) => void; bar: RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const sections: MenuSection[] | null = b.sections ?? (b.menu ? entriesToSections(b.menu, b.id) : null);
  return (
    <div className="relative">
      <button
        ref={ref}
        type="button"
        aria-label={b.label}
        title={b.label}
        aria-pressed={b.tone ? true : undefined}
        aria-haspopup={sections ? 'menu' : undefined}
        aria-expanded={sections ? open : undefined}
        disabled={b.disabled}
        onKeyDown={sections ? openKey(() => onOpen(true)) : undefined}
        onClick={() => (sections ? onOpen(!open) : (onOpen(false), b.onClick?.()))}
        className={cx(
          'relative flex items-center justify-center rounded-[13px] transition-colors disabled:opacity-40',
          b.tone === 'warn' ? 'bg-white text-[#B42318]' : b.tone === 'on' ? 'bg-white text-[#0F1B3D]' : b.tone === 'active' ? 'bg-[#3B5BDB] text-white' : 'text-[#E6ECFA] hover:bg-white/12',
          open && !b.tone && 'bg-white/16',
        )}
        style={{ width: size, height: size }}
      >
        <Icon name={b.icon} size={compact ? 18 : 20} />
        {b.badge ? <span className="absolute -top-1 -right-1 min-w-[17px] rounded-full bg-[#E0522F] px-1 text-[10.5px] leading-[17px] font-bold text-white">{b.badge}</span> : null}
      </button>
      {open && sections ? <Menu sections={sections} label={b.label} anchor={ref} avoid={bar} onClose={() => onOpen(false)} /> : null}
    </div>
  );
}
