import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { PopMenu, below, type MenuItem } from '../files/Menu';

/** The AI tools of a screen, behind one sparkles button (worksuite-desktop#53). */
export function AiMenuButton({ items, className, label = 'AI', compact, ariaLabel = 'AI tools', iconClassName }: {
  items: MenuItem[];
  className?: string;
  label?: string;
  compact?: boolean;
  /** The button's name, where a surface calls it something else (a website chat's "Writing assistant", P-04). */
  ariaLabel?: string;
  iconClassName?: string;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={(e) => setAt(below(e.currentTarget, 'left', 240))}
        className={cx('inline-flex items-center justify-center gap-1.5 rounded-[8px] font-semibold text-ink hover:bg-subtle', compact ? 'h-[30px] w-[30px] text-ink-2' : 'h-8 border border-line bg-surface px-3 text-[13px]', className)}
      >
        <Icon name="sparkles" size={compact ? 16 : 15} className={iconClassName ?? 'text-primary'} />
        {compact ? null : label}
      </button>
      {at ? <PopMenu at={at} width={240} label={ariaLabel} items={items} onClose={() => setAt(null)} /> : null}
    </>
  );
}
