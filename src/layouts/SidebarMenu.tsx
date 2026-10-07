import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';

export interface SidebarMenuAction {
  id: string;
  icon: string;
  label: string;
  onSelect: () => void;
}
export type SidebarMenuEntry = SidebarMenuAction | 'separator';

/** The menu's width, and how far it keeps from the window's edges. */
export const SIDEBAR_MENU_WIDTH = 224;
const MARGIN = 8;
const ITEM_PX = 34;

/** Where a menu `w`×`h` opened at (x, y) goes: there, or moved back inside the window, `MARGIN` clear of its edges. */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  return { left: Math.max(MARGIN, Math.min(x, vw - w - MARGIN)), top: Math.max(MARGIN, Math.min(y, vh - h - MARGIN)) };
}

const estimate = (entries: SidebarMenuEntry[]) => entries.reduce((h, e) => h + (e === 'separator' ? 9 : ITEM_PX), 12);

/**
 * A sidebar item's own menu (right-click, or a long press on a touch screen): drawn over everything, inside the
 * window. It closes on a click or touch outside it, Esc, any scrolling, the window losing focus or resizing, and
 * after an action is chosen. ↑↓ move between its actions; focus goes back to the item it was opened from.
 */
export function SidebarMenu({ at, label, entries, onClose, returnFocus }: { at: { x: number; y: number }; label: string; entries: SidebarMenuEntry[]; onClose: () => void; returnFocus?: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => clampMenu(at.x, at.y, SIDEBAR_MENU_WIDTH, estimate(entries), window.innerWidth, window.innerHeight));
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // Measured once drawn: kept inside the window whatever its real size.
  const guess = estimate(entries);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    setPos(clampMenu(at.x, at.y, r?.width || SIDEBAR_MENU_WIDTH, r?.height || guess, window.innerWidth, window.innerHeight));
  }, [at.x, at.y, guess]);
  // Opened: its first action has focus, for the keyboard.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    const gone = () => close.current();
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('touchstart', outside, true);
    window.addEventListener('keydown', key, true);
    // Scroll events do not bubble; caught on the way down, they come from anything that scrolls.
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', gone);
    window.addEventListener('blur', gone);
    const el = ref.current;
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('touchstart', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', gone);
      window.removeEventListener('blur', gone);
      // Closed from within (Esc, an action): back to the item it was opened from.
      const active = document.activeElement;
      if (returnFocus?.isConnected && (!active || active === document.body || el?.contains(active))) returnFocus.focus();
    };
  }, [returnFocus]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]!.focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-sidebar-menu
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="no-drag fixed z-[70] rounded-[12px] border border-line bg-surface p-1.5 text-ink shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.2)]"
      style={{ left: pos.left, top: pos.top, width: SIDEBAR_MENU_WIDTH }}
    >
      {entries.map((e, i) =>
        e === 'separator' ? (
          <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line" />
        ) : (
          <button
            key={e.id}
            type="button"
            role="menuitem"
            data-action={e.id}
            onClick={() => {
              close.current();
              e.onSelect();
            }}
            className="flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-start text-[13px] text-ink outline-none hover:bg-subtle focus-visible:bg-subtle"
          >
            <Icon name={e.icon} size={15} className="shrink-0 text-ink-3" />
            <span className="min-w-0 truncate">{e.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
