import { useLayoutEffect, useRef, useState } from 'react';
import { text } from '../core/i18n';
import { Icon } from './Icon';
import { Menu, type MenuSection } from './Menu';
import { Button, cx } from './ui';

/**
 * The one banner for tips, setup steps and notices (worksuite-desktop#210): one quiet row,
 * `[icon] [title · one-line description] … [actions] [×]`, 56–64px tall, a 12px gap all round so it
 * never runs into what is under it. One primary action; the rest secondary, the same height. A step
 * already done shows a tick and can't be pressed again.
 *
 * It sizes itself by its own width, not the window's: the description goes below 1100px and the
 * secondary actions move into More; below 760px it takes two rows. Dismissing collapses it in 150ms
 * (no jump below; reduced motion just removes it) before `onDismiss` runs.
 */
export interface BannerAction {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  /** Done already: a tick, and it can't be pressed. */
  done?: boolean;
  title?: string;
}

export interface InfoBannerProps {
  /** Names the region for screen readers; usually the title. */
  label?: string;
  title: string;
  description?: string;
  /** The icon in its 32px tile. */
  icon?: string;
  tone?: 'success' | 'primary' | 'warning';
  primary?: BannerAction;
  secondary?: BannerAction[];
  moreLabel?: string;
  onDismiss?: () => void;
  className?: string;
}

/** Widths (of the banner itself) below which it tightens. */
export const BANNER_COMPACT = 1100;
export const BANNER_STACKED = 760;

const TONE = { success: 'bg-success-bg text-success', primary: 'bg-selection text-primary', warning: 'bg-warning-bg text-warning' } as const;

export function InfoBanner({ label, title, description, icon = 'info', tone = 'primary', primary, secondary = [], moreLabel, onDismiss, className }: InfoBannerProps) {
  const root = useRef<HTMLElement>(null);
  const more = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [menu, setMenu] = useState(false);
  const [closing, setClosing] = useState(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    // Not laid out yet (width 0) counts as wide, so everything shows until the real width is known.
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = width > 0 && width < BANNER_COMPACT;
  const stacked = width > 0 && width < BANNER_STACKED;
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;

  const dismiss = () => {
    if (!onDismiss) return;
    if (reduced) return onDismiss();
    setClosing(true);
    window.setTimeout(onDismiss, 150);
  };

  const menuSections: MenuSection[] = [
    {
      id: 'more',
      items: secondary.map((a) => ({ id: a.id, label: a.label, icon: a.done ? 'check' : a.icon, disabled: a.done, reason: a.done ? text('Done') : undefined, onSelect: a.onClick })),
    },
  ];

  const button = (a: BannerAction, variant: 'primary' | 'secondary') => (
    <Button
      key={a.id}
      size="sm"
      variant={variant === 'primary' && !a.done ? 'primary' : 'secondary'}
      icon={a.done ? 'check' : a.icon}
      disabled={a.done}
      title={a.done ? text('Done') : a.title}
      onClick={a.onClick}
      className="h-[34px] rounded-[9px] px-3 text-[13px]"
    >
      {a.label}
    </Button>
  );

  return (
    <div data-closing={closing || undefined} className={cx('grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none', closing ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100')}>
      <div className="min-h-0 overflow-hidden">
        <section
          ref={root}
          aria-label={label ?? title}
          data-layout={stacked ? 'stacked' : compact ? 'compact' : 'wide'}
          className={cx('m-3 flex min-h-14 min-w-0 items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-ink', stacked && 'flex-wrap', className)}
        >
          <span aria-hidden className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]', TONE[tone])}>
            <Icon name={icon} size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{title}</span>
            {description && !compact ? <span className="block truncate text-[13px] text-ink-3">{description}</span> : null}
          </span>
          <span className={cx('flex shrink-0 items-center gap-2', stacked && 'order-last w-full')}>
            {primary ? button(primary, 'primary') : null}
            {secondary.length && compact ? (
              <>
                <span ref={more} className="inline-flex">
                  <Button size="sm" icon="more" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="h-[34px] rounded-[9px] px-3 text-[13px]">
                    {text('More')}
                  </Button>
                </span>
                {menu ? <Menu sections={menuSections} label={moreLabel ?? text('More actions')} anchor={more} prefer="bottom" align="end" width={240} onClose={() => setMenu(false)} /> : null}
              </>
            ) : (
              secondary.map((a) => button(a, 'secondary'))
            )}
          </span>
          {onDismiss ? (
            <button
              type="button"
              onClick={dismiss}
              aria-label={text('Dismiss')}
              title={text('Dismiss')}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ws-focus)]"
            >
              <Icon name="x" size={15} />
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
