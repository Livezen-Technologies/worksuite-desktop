import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

export type MenuItem =
  | { sep: true }
  | {
      label: string;
      hint?: string;
      icon?: string;
      tag?: { text: string; tone: string };
      danger?: boolean;
      strong?: boolean;
      disabled?: boolean;
      run: () => void;
      /** A submenu (Open with ▸): opened by hovering, clicking or → instead of `run`. */
      submenu?: MenuItem[];
    };

/**
 * A menu at a point (right-click) or under a button: arrow keys move, Enter
 * picks, Esc or a click elsewhere closes. It stays inside the window.
 */
/**
 * A menu at a point. `stacked` gives each item an icon tile beside its title, with the hint as a description
 * underneath (worksuite-desktop#90): for a few choices that each need a sentence, like New meeting's.
 */
export function PopMenu({ at, items, label, onClose, width = 280, head, stacked = false }: { at: MenuAt; items: MenuItem[]; label: string; onClose: () => void; width?: number; head?: ReactNode; stacked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(at);
  // One choice per opening: a second click or a repeated Enter before the menu is gone does nothing.
  const chosen = useRef(false);
  // The open submenu (Open with ▸): which item, and where its panel sits.
  const [sub, setSub] = useState<{ index: number; at: MenuAt; focus: boolean } | null>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const subOf = useRef<HTMLButtonElement | null>(null);
  const openSub = (index: number, el: HTMLButtonElement, focus: boolean) => {
    const r = el.getBoundingClientRect();
    subOf.current = el;
    setSub({ index, at: { x: r.right - 4, y: r.top - 6 }, focus });
  };
  const pick = (m: Extract<MenuItem, { label: string }>) => {
    if (chosen.current) return;
    chosen.current = true;
    onClose();
    m.run();
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Below the button when it fits; above it when it does not and there is room there; otherwise as far up as needed.
    const fitsBelow = at.y + r.height <= window.innerHeight - 8;
    const y = !fitsBelow && at.above !== undefined && at.above - r.height >= 8 ? at.above - r.height : Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8));
    setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y });
    el.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
  }, [at]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inSub = !!subRef.current?.contains(document.activeElement);
      if (e.key === 'Escape' || (e.key === 'ArrowLeft' && inSub)) {
        e.stopPropagation();
        e.preventDefault();
        // A submenu closes first, back to the item that opened it.
        if (inSub || (e.key === 'Escape' && subRef.current)) {
          setSub(null);
          subOf.current?.focus();
          return;
        }
        onClose();
        return;
      }
      if (e.key === 'ArrowRight' && !inSub) {
        const el = document.activeElement as HTMLButtonElement | null;
        const index = Number(el?.dataset.submenu ?? NaN);
        if (el && Number.isInteger(index)) {
          e.preventDefault();
          openSub(index, el, true);
        }
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const host = inSub ? subRef.current : ref.current;
      const list = [...(host?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <>
      <div className="no-drag fixed inset-0 z-40" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        className={cx(
          'no-drag fixed z-50 flex max-h-[calc(100vh-16px)] flex-col overflow-y-auto rounded-[12px] border border-line bg-surface text-[13px] scroll-thin',
          stacked ? 'gap-0.5 p-1.5 shadow-[0_8px_24px_rgb(var(--ws-shadow-rgb)/.12)]' : 'p-1.5 shadow-[0_18px_44px_rgb(var(--ws-shadow-rgb)/.25)]',
        )}
        style={{ left: pos.x, top: pos.y, width: `min(${width}px, calc(100vw - 16px))` }}
      >
        {head}
        {items.map((m, i) =>
          'sep' in m ? (
            <div key={`s${i}`} className="mx-1.5 my-1 h-px shrink-0 bg-line" />
          ) : stacked ? (
            <button
              key={m.label}
              type="button"
              role="menuitem"
              disabled={m.disabled}
              // The pointer moves the keyboard's place too, so only one item is ever highlighted.
              onMouseEnter={(e) => !m.disabled && e.currentTarget.focus()}
              onClick={() => {
                if (chosen.current) return;
                chosen.current = true;
                onClose();
                m.run();
              }}
              className={cx('flex shrink-0 items-start gap-3 rounded-[9px] px-2.5 py-2.5 text-left outline-none focus:bg-selection disabled:opacity-45', m.danger ? 'text-danger' : 'text-ink')}
            >
              <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]', m.danger ? 'bg-danger-bg' : 'bg-subtle text-primary')}>{m.icon ? <Icon name={m.icon} size={16} /> : null}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] leading-[18px] font-semibold">{m.label}</span>
                {m.hint ? <span className="text-[12px] leading-[16px] text-ink-3">{m.hint}</span> : null}
              </span>
            </button>
          ) : (
            <button
              key={m.label}
              type="button"
              role="menuitem"
              disabled={m.disabled}
              aria-haspopup={m.submenu ? 'menu' : undefined}
              aria-expanded={m.submenu ? sub?.index === i : undefined}
              data-submenu={m.submenu ? i : undefined}
              onMouseEnter={(e) => (m.submenu && !m.disabled ? openSub(i, e.currentTarget, false) : sub && setSub(null))}
              onClick={(e) => (m.submenu ? openSub(i, e.currentTarget, true) : pick(m))}
              className={cx(
                'flex min-h-[30px] shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-left outline-none hover:bg-ground focus:bg-selection disabled:opacity-45',
                m.danger ? 'text-danger' : 'text-ink',
                m.strong && 'font-semibold',
                sub?.index === i && 'bg-ground',
              )}
            >
              {m.tag ? <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[8.5px] font-bold', m.tag.tone)}>{m.tag.text}</span> : m.icon ? <Icon name={m.icon} size={15} className={m.danger ? '' : 'text-ink-2'} /> : null}
              <span className="flex-1">{m.label}</span>
              {m.hint ? <span className="text-[11px] text-ink-3">{m.hint}</span> : null}
              {m.submenu ? <Icon name="chevron-right" size={14} className="text-ink-3" /> : null}
            </button>
          ),
        )}
      </div>
      {sub && (() => {
        const parent = items[sub.index];
        return parent && !('sep' in parent) && parent.submenu ? <SubMenu ref={subRef} at={sub.at} focus={sub.focus} label={parent.label} items={parent.submenu} onPick={pick} /> : null;
      })()}
    </>
  );
}

/** A submenu's panel, beside its item (to the left when there is no room on the right). */
function SubMenu({ ref, at, focus, label, items, onPick }: { ref: RefObject<HTMLDivElement | null>; at: MenuAt; focus: boolean; label: string; items: MenuItem[]; onPick: (m: Extract<MenuItem, { label: string }>) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number }>(at);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = at.x + r.width <= window.innerWidth - 8 ? at.x : Math.max(8, at.x - r.width - (el.previousElementSibling?.getBoundingClientRect().width ?? 0) + 8);
    setPos({ x, y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
    if (focus) el.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
  }, [at, focus, ref]);
  return (
    <div ref={ref} role="menu" aria-label={label} className="no-drag fixed z-50 flex max-h-[calc(100vh-16px)] w-[260px] flex-col overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 text-[13px] shadow-[0_18px_44px_rgb(var(--ws-shadow-rgb)/.25)] scroll-thin" style={{ left: pos.x, top: pos.y }}>
      {items.map((m, i) =>
        'sep' in m ? (
          <div key={`s${i}`} className="mx-1.5 my-1 h-px shrink-0 bg-line" />
        ) : (
          <button key={m.label} type="button" role="menuitem" disabled={m.disabled} title={m.hint} onClick={() => onPick(m)} className={cx('flex min-h-[30px] shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-left outline-none hover:bg-ground focus:bg-selection disabled:opacity-45', m.danger ? 'text-danger' : 'text-ink', m.strong && 'font-semibold')}>
            {m.icon ? <Icon name={m.icon} size={15} className="text-ink-2" /> : null}
            <span className="flex-1">{m.label}</span>
            {m.hint ? <span className="max-w-[45%] truncate text-[11px] text-ink-3">{m.hint}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}

/** Where a menu sits: a point, and for a menu opened from a button, the line just above the button to flip up to. */
export interface MenuAt {
  x: number;
  y: number;
  above?: number;
}

/** Where a menu opened from a button should sit: under it, right-aligned when asked, above it when there is no room below. */
export function below(el: HTMLElement, align: 'left' | 'right' = 'left', width = 280): MenuAt {
  const r = el.getBoundingClientRect();
  return { x: align === 'right' ? r.right - width : r.left, y: r.bottom + 4, above: r.top - 4 };
}
