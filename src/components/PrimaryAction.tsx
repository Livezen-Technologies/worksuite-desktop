import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { text } from '../core/i18n';
import { Icon } from './Icon';
import { Menu, type MenuSection } from './Menu';
import { cx } from './ui';

/**
 * The one "New …" action at the top of a module's sidebar (worksuite-desktop#171): 40px high, 10px round,
 * the primary colour with a quiet shadow (no coloured glow), a plus and the label. The shortcut goes in the
 * tooltip ("New email (N)"), never as a chip inside the button.
 *
 * With `menu` (or `onMenu`) it is a split button: the label runs the main action, the ⌄ part opens the
 * menu. With `onMenu` and no `onClick` the whole button opens the menu, as Files' "New" does. In a row beside
 * another button pass `className="flex-1"`; in a column it fills the width by itself.
 */
export interface PrimaryActionProps {
  label: string;
  icon?: string;
  /** Shown in the tooltip and announced as the key shortcut. */
  shortcut?: string;
  /** The tooltip without the shortcut, where it says more than the label. */
  hint?: string;
  onClick?: () => void;
  /** The split part's menu. */
  menu?: MenuSection[];
  /** The split part opens a module's own menu at the button instead. */
  onMenu?: (anchor: HTMLElement) => void;
  menuLabel?: string;
  disabled?: boolean;
  className?: string;
  'data-guide'?: string;
}

const BASE = cx(
  'ws-localized-control flex h-10 items-center gap-2 bg-primary text-[13px] font-bold text-white whitespace-nowrap',
  'shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.18)] transition-colors hover:bg-primary-hover active:brightness-95',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ws-focus)] disabled:cursor-not-allowed disabled:opacity-50',
);

export function PrimaryActionButton({ label, icon = 'plus', shortcut, hint, onClick, menu, onMenu, menuLabel, disabled, className, ...rest }: PrimaryActionProps) {
  const [open, setOpen] = useState(false);
  const split = useRef<HTMLButtonElement>(null);
  const tip = `${hint ?? label}${shortcut ? ` (${shortcut})` : ''}`;
  const hasMenu = !!menu?.length || !!onMenu;
  const showMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (onMenu) onMenu(e.currentTarget);
    else setOpen((o) => !o);
  };

  // The whole button opens the menu: one control with a ⌄ at its end.
  if (!onClick && hasMenu) {
    return (
      <>
        <button type="button" ref={split} data-guide={rest['data-guide']} disabled={disabled} title={tip} aria-label={hint ?? label} aria-haspopup="menu" aria-expanded={open} aria-keyshortcuts={shortcut} onClick={showMenu} className={cx(BASE, 'min-w-0 shrink-0 rounded-[10px] pr-2.5 pl-3.5', className)}>
          <Icon name={icon} size={16} />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <span aria-hidden className="h-[18px] w-px bg-white/30" />
          <Icon name="chevron-down" size={14} />
        </button>
        {open && menu ? <Menu sections={menu} label={menuLabel ?? label} anchor={split} prefer="bottom" align="start" onClose={() => setOpen(false)} /> : null}
      </>
    );
  }

  return (
    <div className={cx('flex min-w-0 shrink-0', className)}>
      <button type="button" data-guide={rest['data-guide']} disabled={disabled} title={tip} aria-keyshortcuts={shortcut} onClick={onClick} className={cx(BASE, 'min-w-0 flex-1 pr-3 pl-3.5', hasMenu ? 'rounded-l-[10px]' : 'justify-center rounded-[10px]')}>
        <Icon name={icon} size={16} />
        <span className={cx('min-w-0 truncate', hasMenu && 'flex-1 text-left')}>{label}</span>
      </button>
      {hasMenu ? (
        <>
          <span aria-hidden className="w-px bg-primary">
            <span className="mt-[11px] block h-[18px] w-px bg-white/30" />
          </span>
          <button type="button" ref={split} disabled={disabled} aria-label={text('More {label} options', { label: label.toLowerCase() })} title={text('More options')} aria-haspopup="menu" aria-expanded={open} onClick={showMenu} className={cx(BASE, 'w-8 shrink-0 justify-center rounded-r-[10px] px-0')}>
            <Icon name="chevron-down" size={14} />
          </button>
          {open && menu ? <Menu sections={menu} label={menuLabel ?? label} anchor={split} prefer="bottom" align="end" onClose={() => setOpen(false)} /> : null}
        </>
      ) : null}
    </div>
  );
}

/** The square button beside the primary action (Upload in Files, Search in Mail): same height, quiet border. */
export function SidebarIconButton({ icon, label, shortcut, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; shortcut?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
      aria-keyshortcuts={shortcut}
      {...rest}
      className={cx(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-primary transition-colors hover:bg-subtle',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ws-focus)] disabled:opacity-50',
        className,
      )}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
