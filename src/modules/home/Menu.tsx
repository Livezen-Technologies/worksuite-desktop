import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

export interface MenuAction {
  label: string;
  icon?: string;
  run: () => void;
}

/**
 * A small menu on a button (Home's New, a meeting's ⋯, a file's ⋯): opens below it, closes on a choice, Escape or a
 * click elsewhere, and gives focus back to its button.
 */
export function PopMenu({ items, label, trigger, className, align = 'right', width = 200 }: { items: MenuAction[]; label: string; trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; className?: string; align?: 'left' | 'right'; width?: number }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    box.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
  };
  return (
    <div ref={box} className={cx('relative', className)} onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), close())}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open ? (
        <div role="menu" aria-label={label} className={cx('animate-in absolute top-full z-30 mt-1 rounded-[10px] border border-line bg-surface p-1 shadow-xl', align === 'right' ? 'right-0' : 'left-0')} style={{ width }}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.run();
              }}
              className="flex h-9 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] text-ink hover:bg-subtle focus:bg-subtle focus:outline-none"
            >
              {it.icon ? <Icon name={it.icon} size={16} className="text-ink-2" /> : null}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The ⋯ button of a row or card. */
export function MoreButton({ label, items, className, size = 30 }: { label: string; items: MenuAction[]; className?: string; size?: number }) {
  if (!items.length) return null;
  return (
    <PopMenu
      label={label}
      items={items}
      className={className}
      trigger={({ open, toggle }) => (
        <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className="flex items-center justify-center rounded-[8px] text-ink-3 hover:bg-subtle hover:text-ink" style={{ width: size, height: size }}>
          <Icon name="more" size={16} />
        </button>
      )}
    />
  );
}
