import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { text } from '../core/i18n';
import { Icon } from './Icon';
import { cx } from './ui';
import { MENU_GAP, placeMenu, sheetMode, SHEET_BELOW, type Placement, type Side } from './menuPlacement';

/**
 * Menu: an accessible action menu (WAI-ARIA menu pattern) for a trigger
 * button. Sections with a heading and a hairline between them; items with an
 * icon, a label, a description under it where it helps, and a shortcut, a
 * check or a submenu arrow lined up on the right. An item that cannot be used
 * stays visible and says why underneath.
 *
 * Keyboard: Up/Down (wrapping), Home/End and typeahead move; Right, Enter or
 * Space opens a submenu and Left or Escape closes it (mirrored right to
 * left); Escape closes the menu and puts focus back on the trigger; Tab
 * closes it. A click outside closes it too.
 *
 * Placement (menuPlacement): above, below or beside the trigger — 6px from
 * it, flipped when the other side has the room, at least 8px inside the
 * window, no taller than the room it has, scrolling inside. Every dropdown,
 * select and right-click menu in the app is placed by the same geometry
 * (worksuite-desktop#208). Below
 * `sheetBelow` px of window width the menu is a bottom sheet instead, and a
 * submenu replaces the sheet's list with a Back row.
 *
 * Selected and focused never look alike (worksuite-desktop#208): the chosen
 * option has a tick and accent text; the item under the pointer or the
 * keyboard has a light background only. Opening a menu focuses the chosen
 * option when there is one, else the first item.
 *
 * A section can be `segmented`: its radio items drawn as one compact row
 * (Reading pane: Right · Below · Hidden), still menu items for the keyboard —
 * Up/Down move through them like any other, Left/Right move within the row.
 *
 * It is drawn into the full-screen element when there is one (so it shows in
 * full screen) and into the body otherwise, in the theme's colours.
 */
export interface MenuItem {
  id: string;
  label: string;
  /** A second line under the label: only where it helps. */
  description?: string;
  icon?: string;
  /** Shown on the right, e.g. "F11". */
  shortcut?: string;
  /** A checkbox item (or radio, with `radio`): the check shows on the right. */
  checked?: boolean;
  radio?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Why a disabled item cannot be used, shown in place of the description. */
  reason?: string;
  onSelect?: () => void;
  /** Opens a submenu instead of acting. */
  submenu?: MenuSection[];
  /** A picture before the label in place of an icon: an organisation's logo or initials. */
  leading?: ReactNode;
  /** A small tag after the label ("Default"). */
  badge?: string;
  /** Small muted text on the right (a count), with what it means for a screen reader. */
  meta?: string;
  metaLabel?: string;
  /**
   * A multi-select row (worksuite-desktop#214): a checkbox before the label. Space or a click on the checkbox calls
   * `onToggle` and the menu stays open; Enter or a click on the row is `onSelect`, as for any item.
   */
  onToggle?: () => void;
  /** In the footer: the main action (Apply), filled in the accent colour. */
  primary?: boolean;
}

export interface MenuSection {
  id: string;
  label?: string;
  items: MenuItem[];
  /** The items as one compact row of choices (radio items with short labels). */
  segmented?: boolean;
}

export type MenuCloseReason = 'select' | 'escape' | 'outside' | 'tab';

interface OpenSub {
  id: string;
  /** Focus moves into it (opened from the keyboard or a click), or stays on its item (opened by hovering). */
  focus: boolean;
  n: number;
}

export interface MenuProps {
  sections: MenuSection[];
  /** The menu's accessible name, and the sheet's title. */
  label: string;
  anchor: RefObject<HTMLElement | null>;
  /** Kept uncovered when the menu opens above or below: the toolbar the trigger is in. */
  avoid?: RefObject<HTMLElement | null>;
  prefer?: Side;
  align?: 'center' | 'start' | 'end';
  onClose: (reason: MenuCloseReason) => void;
  sheetBelow?: number;
  /** The menu's width before the viewport limits it. */
  width?: number;
  /** Between the trigger and the menu: 6px by default, 0 at the pointer (a right-click menu). */
  gap?: number;
  /**
   * A search box at the top (worksuite-desktop#214). It takes focus when the menu opens; Down moves into the list
   * and a letter typed in the list goes to it. The caller filters `sections` by its value.
   */
  search?: { value: string; onChange: (value: string) => void; label: string; placeholder?: string };
  /** Shown in place of the list when nothing is left in it (a search that matches nothing). */
  empty?: string;
  /**
   * Enter, before the item's own action: return true to take it (applying a multi-selection) and the menu closes.
   * Space still toggles the item.
   */
  onEnter?: () => boolean;
  /** A row of actions held at the menu's foot, still reached with the arrow keys (Manage, Apply). */
  footer?: MenuItem[];
}

const SUB_WIDTH = 264;

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function isRtl() {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
}

const visible = (sections: MenuSection[]) => sections.filter((s) => s.items.length > 0);

export function Menu({ sections, label, anchor, avoid, prefer = 'top', align = 'center', onClose, sheetBelow = SHEET_BELOW, width = 288, gap = MENU_GAP, search, empty, onEnter, footer }: MenuProps) {
  const menuId = useId().replace(/:/g, '');
  const [open, setOpen] = useState<OpenSub[]>([]);
  const [viewport, setViewport] = useState(viewportSize);
  const counter = useRef(0);
  const closeRef = useRef(onClose);
  const enterRef = useRef(onEnter);
  useEffect(() => {
    closeRef.current = onClose;
    enterRef.current = onEnter;
  });
  const foot = footer ?? [];
  const sheet = sheetMode(viewport.width, sheetBelow);
  const rtl = isRtl();

  useEffect(() => {
    const resize = () => setViewport(viewportSize());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // A press anywhere else closes the menu; the trigger toggles it itself.
  useEffect(() => {
    const away = (e: Event) => {
      const target = e.target as Element | null;
      if (!target || !(target instanceof Node)) return;
      if (target instanceof Element && target.closest(`[data-menu-root="${menuId}"]`)) return;
      if (anchor.current?.contains(target)) return;
      closeRef.current('outside');
    };
    document.addEventListener('mousedown', away, true);
    document.addEventListener('touchstart', away, true);
    return () => {
      document.removeEventListener('mousedown', away, true);
      document.removeEventListener('touchstart', away, true);
    };
  }, [menuId, anchor]);

  // The levels open now: the menu, then each submenu.
  const levels: Array<{ sections: MenuSection[]; label: string; item: MenuItem | null }> = [{ sections: visible(sections), label, item: null }];
  for (const sub of open) {
    const parent = levels[levels.length - 1]!;
    const item = parent.sections.flatMap((s) => s.items).find((i) => i.id === sub.id);
    if (!item?.submenu) break;
    levels.push({ sections: visible(item.submenu), label: item.label, item });
  }

  const domId = useCallback((level: number, itemId: string) => `${menuId}-${level}-${itemId.replace(/[^\w-]/g, '_')}`, [menuId]);

  const finish = useCallback(
    (reason: MenuCloseReason) => {
      if (reason !== 'outside') anchor.current?.focus();
      closeRef.current(reason);
    },
    [anchor],
  );

  const openSub = (level: number, id: string, focus: boolean) => {
    counter.current += 1;
    setOpen((o) => [...o.slice(0, level), { id, focus, n: counter.current }]);
  };
  // Going back from a submenu puts focus on the item that opened it.
  const returnTo = useRef<string | null>(null);
  const closeTo = (level: number) => {
    const parent = open[level];
    setOpen((o) => o.slice(0, level));
    const el = parent ? document.getElementById(domId(level, parent.id)) : null;
    if (el) el.focus();
    else returnTo.current = parent ? domId(level, parent.id) : null;
  };

  // In a sheet the item is drawn again once the submenu has gone: focus it then (after the sheet's own focus).
  useEffect(() => {
    const back = returnTo.current ? document.getElementById(returnTo.current) : null;
    returnTo.current = null;
    back?.focus();
  }, [open]);

  const activate = (level: number, item: MenuItem) => {
    if (item.disabled) return;
    if (item.submenu) {
      openSub(level, item.id, true);
      return;
    }
    finish('select');
    item.onSelect?.();
  };

  const itemsAt = (level: number) => [...levels[level]!.sections.flatMap((s) => s.items), ...(level === 0 ? foot : [])];

  const onKeyDown = (level: number, e: ReactKeyboardEvent<HTMLElement>, list: HTMLElement | null) => {
    const items = list ? Array.from(list.querySelectorAll<HTMLElement>('[data-menu-item]')) : [];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const current = at >= 0 ? itemsAt(level).find((i) => domId(level, i.id) === items[at]!.id) : undefined;
    const move = (to: number) => items[(to + items.length) % items.length]?.focus();
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let handled = true;
    // In a segmented row, Left and Right move between its choices.
    const row = at >= 0 ? items[at]!.closest('[data-menu-segmented]') : null;
    if (row && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const seg = Array.from(row.querySelectorAll<HTMLElement>('[data-menu-item]'));
      const i = seg.indexOf(items[at]!);
      seg[(i + ((e.key === forward) ? 1 : -1) + seg.length) % seg.length]?.focus();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        move(at + 1);
        break;
      case 'ArrowUp':
        move(at < 0 ? -1 : at - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(-1);
        break;
      case forward:
        if (current?.submenu && !current.disabled) openSub(level, current.id, true);
        break;
      case back:
        if (level > 0) closeTo(level - 1);
        break;
      case ' ':
        if (current?.onToggle && !current.disabled) current.onToggle();
        else if (current) activate(level, current);
        break;
      case 'Enter':
        if (level === 0 && enterRef.current?.() === true) finish('select');
        else if (current) activate(level, current);
        break;
      case 'Escape':
        if (level > 0) closeTo(level - 1);
        else finish('escape');
        break;
      case 'Tab':
        finish('tab');
        break;
      default:
        handled = false;
        if (level === 0 && search && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // A letter typed with a search box goes to it.
          search.onChange(search.value + e.key);
          list?.parentElement?.querySelector<HTMLElement>('[data-menu-search]')?.focus();
          handled = true;
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
          // Typeahead: the next item starting with the letter typed.
          const key = e.key.toLocaleLowerCase();
          const labels = levels[level]!.sections.flatMap((s) => s.items).map((i) => i.label.toLocaleLowerCase());
          for (let step = 1; step <= items.length; step++) {
            const i = (Math.max(at, 0) + step) % items.length;
            if (labels[i]?.startsWith(key)) {
              items[i]!.focus();
              break;
            }
          }
          handled = true;
        }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // The search box: Down into the list, Enter applies or takes the first item, Escape and Tab close.
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>, list: HTMLElement | null) => {
    const items = list ? Array.from(list.querySelectorAll<HTMLElement>('[data-menu-item]')) : [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      (e.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus();
    } else if (e.key === 'Enter') {
      if (enterRef.current?.() === true) finish('select');
      else {
        const first = levels[0]!.sections.flatMap((s) => s.items).find((i) => !i.disabled && !i.submenu);
        if (first) activate(0, first);
      }
    } else if (e.key === 'Escape') finish('escape');
    else if (e.key === 'Tab') finish('tab');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const hover = (level: number, item: MenuItem, el: HTMLElement) => {
    if (sheet) return;
    el.focus({ preventScroll: true });
    if (item.submenu && !item.disabled) {
      if (open[level]?.id !== item.id) openSub(level, item.id, false);
    } else if (open.length > level) setOpen((o) => o.slice(0, level));
  };

  const target = (typeof document !== 'undefined' && document.fullscreenElement) || document.body;

  if (sheet) {
    const level = levels.length - 1;
    const here = levels[level]!;
    return createPortal(
      <>
        <div aria-hidden="true" className="no-drag fixed inset-0 z-[60] bg-[rgb(var(--ws-shadow-rgb)/.45)]" />
        <Sheet
          menuId={menuId}
          title={here.label}
          level={level}
          onBack={() => closeTo(level - 1)}
          focusKey={level === 0 ? 0 : (open[level - 1]?.n ?? 0)}
          render={(list) => (
            <MenuList
              id={`${menuId}-list-${level}`}
              label={here.label}
              sections={here.sections}
              level={level}
              sheet
              domId={domId}
              openId={null}
              rtl={rtl}
              listRef={list}
              onKeyDown={(e) => onKeyDown(level, e, list.current)}
              onActivate={(item) => activate(level, item)}
              onHover={() => undefined}
              search={level === 0 ? search : undefined}
              onSearchKey={(e) => onSearchKey(e, list.current)}
              empty={empty}
              footer={level === 0 ? foot : []}
            />
          )}
        />
      </>,
      target,
    );
  }

  return createPortal(
    <>
      {levels.map((lv, level) => (
        <Floating
          key={level === 0 ? 'root' : `sub-${level}-${open[level - 1]!.id}`}
          menuId={menuId}
          level={level}
          anchorEl={() => (level === 0 ? anchor.current : document.getElementById(domId(level - 1, open[level - 1]!.id)))}
          avoidEl={() => (level === 0 ? (avoid?.current ?? null) : null)}
          prefer={level === 0 ? prefer : 'end'}
          align={level === 0 ? align : 'start'}
          width={level === 0 ? width : SUB_WIDTH}
          gap={level === 0 ? gap : 2}
          viewport={viewport}
          rtl={rtl}
          focus={level === 0 ? true : open[level - 1]!.focus}
          focusKey={level === 0 ? 0 : open[level - 1]!.n}
          contentKey={level === 0 ? `${contentKey(lv.sections)}#${contentKey([{ id: 'foot', items: foot }])}` : contentKey(lv.sections)}
          render={(list) => (
            <MenuList
              id={`${menuId}-list-${level}`}
              label={lv.label}
              sections={lv.sections}
              level={level}
              sheet={false}
              domId={domId}
              openId={open[level]?.id ?? null}
              rtl={rtl}
              listRef={list}
              onKeyDown={(e) => onKeyDown(level, e, list.current)}
              onActivate={(item) => activate(level, item)}
              onHover={(item, el) => hover(level, item, el)}
              search={level === 0 ? search : undefined}
              onSearchKey={(e) => onSearchKey(e, list.current)}
              empty={empty}
              footer={level === 0 ? foot : []}
            />
          )}
        />
      ))}
    </>,
    target,
  );
}

const contentKey = (sections: MenuSection[]) => sections.map((s) => `${s.id}:${s.label ?? ''}:${s.items.map((i) => `${i.id}|${i.label}|${i.description ?? ''}|${i.reason ?? ''}`).join(',')}`).join(';');

/** The search box when there is one; else the chosen option (the first radio that is checked), else the first item that can be used. */
function focusFirst(list: HTMLElement | null) {
  const box = list?.parentElement?.querySelector<HTMLElement>('[data-menu-search]');
  if (box) return box.focus({ preventScroll: true });
  const items = list ? Array.from(list.querySelectorAll<HTMLElement>('[data-menu-item]')) : [];
  const usable = items.filter((el) => el.getAttribute('aria-disabled') !== 'true');
  const chosen = usable.find((el) => el.getAttribute('role') === 'menuitemradio' && el.getAttribute('aria-checked') === 'true');
  (chosen ?? usable[0] ?? items[0])?.focus({ preventScroll: true });
}

function Floating({
  menuId,
  level,
  anchorEl,
  avoidEl,
  prefer,
  align,
  width,
  gap,
  viewport,
  rtl,
  focus,
  focusKey,
  contentKey,
  render,
}: {
  menuId: string;
  level: number;
  anchorEl: () => HTMLElement | null;
  avoidEl: () => HTMLElement | null;
  prefer: Side;
  align: 'center' | 'start' | 'end';
  width: number;
  gap: number;
  viewport: { width: number; height: number };
  rtl: boolean;
  focus: boolean;
  focusKey: number;
  /** Changes when what the menu shows changes: it is measured and placed again. */
  contentKey: string;
  render: (list: RefObject<HTMLDivElement | null>) => ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const anchorRef = useRef(anchorEl);
  const avoidRef = useRef(avoidEl);
  useEffect(() => {
    anchorRef.current = anchorEl;
    avoidRef.current = avoidEl;
  });

  useLayoutEffect(() => {
    const el = panel.current;
    const a = anchorRef.current();
    if (!el || !a) return;
    const r = a.getBoundingClientRect();
    const av = avoidRef.current()?.getBoundingClientRect() ?? null;
    const next = placeMenu({
      trigger: { left: r.left, top: r.top, width: r.width, height: r.height },
      menu: { width, height: el.scrollHeight },
      viewport,
      prefer,
      align,
      rtl,
      gap,
      avoid: av ? { left: av.left, top: av.top, width: av.width, height: av.height } : null,
    });
    setPlace((p) => (p && p.left === next.left && p.top === next.top && p.maxHeight === next.maxHeight && p.maxWidth === next.maxWidth && p.side === next.side ? p : next));
  }, [viewport, width, prefer, align, rtl, level, gap, contentKey]);

  // Once it is placed (an element hidden while it is measured cannot take focus).
  const placed = place !== null;
  useEffect(() => {
    if (focus && placed) focusFirst(list.current);
  }, [focus, focusKey, placed]);

  return (
    <div
      ref={panel}
      data-menu-root={menuId}
      data-menu-level={level}
      data-side={place?.side}
      className="no-drag scroll-thin fixed z-[60] overflow-y-auto overscroll-contain rounded-[12px] border border-line bg-surface p-1.5 text-ink shadow-[0_16px_40px_rgb(var(--ws-shadow-rgb)/.28)]"
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        width,
        maxWidth: place?.maxWidth,
        maxHeight: place?.maxHeight,
        visibility: place ? 'visible' : 'hidden',
      }}
    >
      {render(list)}
    </div>
  );
}

function Sheet({
  menuId,
  title,
  level,
  onBack,
  focusKey,
  render,
}: {
  menuId: string;
  title: string;
  level: number;
  onBack: () => void;
  focusKey: number;
  render: (list: RefObject<HTMLDivElement | null>) => ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusFirst(list.current);
  }, [level, focusKey]);
  return (
    <div
      data-menu-root={menuId}
      data-menu-sheet=""
      className="no-drag fixed inset-x-0 bottom-0 z-[61] flex max-h-[85vh] flex-col rounded-t-[16px] border-t border-line bg-surface pb-[max(8px,env(safe-area-inset-bottom))] text-ink shadow-[0_-12px_36px_rgb(var(--ws-shadow-rgb)/.24)]"
    >
      <span aria-hidden="true" className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-line" />
      <div className="flex min-h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        {level > 0 ? (
          <button type="button" tabIndex={-1} onClick={onBack} aria-label={text('Back')} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
            <Icon name="chevron-left" size={18} className="rtl:rotate-180" />
          </button>
        ) : null}
        <b className="min-w-0 flex-1 truncate px-2 text-[14px] font-semibold">{title}</b>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{render(list)}</div>
    </div>
  );
}

function MenuList({
  id,
  label,
  sections,
  level,
  sheet,
  domId,
  openId,
  rtl,
  listRef,
  onKeyDown,
  onActivate,
  onHover,
  search,
  onSearchKey,
  empty,
  footer,
}: {
  id: string;
  label: string;
  sections: MenuSection[];
  level: number;
  sheet: boolean;
  domId: (level: number, itemId: string) => string;
  openId: string | null;
  rtl: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onActivate: (item: MenuItem) => void;
  onHover: (item: MenuItem, el: HTMLElement) => void;
  search?: MenuProps['search'];
  onSearchKey?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  empty?: string;
  footer?: MenuItem[];
}) {
  // The icon column only where some item at this level has an icon: no blank gap before every label (worksuite-desktop#168).
  const iconSlot = sections.some((s) => !s.segmented && s.items.some((i) => !!i.icon));
  const nothing = sections.every((s) => s.items.length === 0);
  return (
    <>
      {search ? (
        <div className={cx('sticky top-0 z-[1] bg-surface pb-1', !sheet && '-mx-1.5 -mt-1.5 px-1.5 pt-1.5')}>
          <label className="flex h-8 items-center gap-2 rounded-[8px] border border-line bg-well px-2 text-ink-3 focus-within:border-primary">
            <Icon name="search" size={14} className="shrink-0" />
            <input
              data-menu-search=""
              type="text"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              onKeyDown={onSearchKey}
              aria-label={search.label}
              aria-controls={id}
              placeholder={search.placeholder ?? search.label}
              className="bare-focus min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
            />
          </label>
        </div>
      ) : null}
    <div ref={listRef} id={id} role="menu" aria-label={label} onKeyDown={onKeyDown} className="outline-none">
      {nothing && empty ? <p className="m-0 px-2.5 py-3 text-center text-[12.5px] text-ink-3">{empty}</p> : null}
      {sections.map((s, si) => (
        <div key={s.id} role="group" aria-labelledby={s.label ? `${id}-${s.id}` : undefined} aria-label={s.label ? undefined : label}>
          {si > 0 ? <div role="separator" className="mx-1.5 my-1 h-px bg-line" /> : null}
          {s.label ? (
            <div id={`${id}-${s.id}`} className="px-2.5 pt-2 pb-1 text-[11px] leading-[14px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
              {s.label}
            </div>
          ) : null}
          {s.segmented ? (
            <Segmented items={s.items} level={level} domId={domId} sheet={sheet} onActivate={onActivate} onHover={onHover} />
          ) : (
            s.items.map((item) => <Row key={item.id} item={item} iconSlot={iconSlot} domId={domId(level, item.id)} sheet={sheet} expanded={openId === item.id} rtl={rtl} onActivate={onActivate} onHover={onHover} />)
          )}
        </div>
      ))}
      {footer?.length ? <Footer items={footer} level={level} domId={domId} sheet={sheet} onActivate={onActivate} onHover={onHover} /> : null}
    </div>
    </>
  );
}

/**
 * The menu's foot (worksuite-desktop#214): a link on the start side (Manage organisations) and the main action on the
 * end (Apply), held at the bottom while the list scrolls. Menu items still: the arrow keys reach them.
 */
function Footer({ items, level, domId, sheet, onActivate, onHover }: { items: MenuItem[]; level: number; domId: (level: number, itemId: string) => string; sheet: boolean; onActivate: (item: MenuItem) => void; onHover: (item: MenuItem, el: HTMLElement) => void }) {
  return (
    <div role="group" aria-label={text('Actions')} data-menu-footer="" className={cx('sticky bottom-0 z-[1] mt-1 flex items-center gap-2 border-t border-line bg-surface pt-1.5', !sheet && '-mx-1.5 -mb-1.5 px-1.5 pb-1.5')}>
      {items.map((item) => (
        <div
          key={item.id}
          id={domId(level, item.id)}
          role="menuitem"
          tabIndex={-1}
          data-menu-item=""
          aria-disabled={item.disabled ? true : undefined}
          onClick={() => onActivate(item)}
          onMouseEnter={(e) => onHover(item, e.currentTarget)}
          className={cx(
            'flex min-w-0 cursor-default items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-semibold outline-none select-none focus-visible:shadow-[inset_0_0_0_2px_var(--ws-focus)]',
            sheet ? 'h-10' : 'h-8',
            item.primary ? 'ms-auto shrink-0 bg-primary text-[var(--ws-on-primary)] hover:bg-primary-hover focus:bg-primary-hover' : 'text-primary hover:bg-subtle focus:bg-subtle',
            item.disabled && 'opacity-50',
          )}
        >
          {item.icon ? <Icon name={item.icon} size={14} className="shrink-0" /> : null}
          <span className="truncate">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A segmented row: radio choices side by side. The chosen one is a raised
 * segment in accent text with a tick; focus and hover are a light tint only.
 */
function Segmented({ items, level, domId, sheet, onActivate, onHover }: { items: MenuItem[]; level: number; domId: (level: number, itemId: string) => string; sheet: boolean; onActivate: (item: MenuItem) => void; onHover: (item: MenuItem, el: HTMLElement) => void }) {
  return (
    <div data-menu-segmented="" className="mx-1.5 mb-1 flex gap-0.5 rounded-[9px] bg-subtle p-0.5">
      {items.map((item) => {
        const id = domId(level, item.id);
        return (
          <div
            key={item.id}
            id={id}
            role="menuitemradio"
            tabIndex={-1}
            data-menu-item=""
            aria-checked={!!item.checked}
            aria-disabled={item.disabled ? true : undefined}
            aria-label={item.label}
            title={item.disabled && item.reason ? item.reason : undefined}
            onClick={() => onActivate(item)}
            onMouseEnter={(e) => onHover(item, e.currentTarget)}
            className={cx(
              'flex min-w-0 flex-1 cursor-default items-center justify-center gap-1 rounded-[7px] px-1.5 text-[12.5px] outline-none select-none',
              sheet ? 'h-10' : 'h-7',
              'focus-visible:shadow-[inset_0_0_0_2px_var(--ws-focus)]',
              item.checked ? 'bg-surface font-semibold text-primary shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.15)]' : 'text-ink-2 hover:bg-surface/60 hover:text-ink focus:bg-surface/60',
              item.disabled && 'opacity-50',
            )}
          >
            {item.checked ? <Icon name="check" size={13} className="shrink-0 text-primary" /> : null}
            <span className="truncate">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Row({ item, iconSlot = true, domId, sheet, expanded, rtl, onActivate, onHover }: { item: MenuItem; iconSlot?: boolean; domId: string; sheet: boolean; expanded: boolean; rtl: boolean; onActivate: (item: MenuItem) => void; onHover: (item: MenuItem, el: HTMLElement) => void }) {
  const role = item.checked === undefined ? 'menuitem' : item.radio ? 'menuitemradio' : 'menuitemcheckbox';
  const note = item.disabled && item.reason ? item.reason : item.description;
  return (
    <div
      id={domId}
      role={role}
      tabIndex={-1}
      data-menu-item=""
      aria-checked={item.checked === undefined ? undefined : item.checked}
      aria-disabled={item.disabled ? true : undefined}
      aria-haspopup={item.submenu ? 'menu' : undefined}
      aria-expanded={item.submenu && !sheet ? expanded : undefined}
      aria-labelledby={`${domId}-label`}
      aria-describedby={[item.badge ? `${domId}-badge` : null, note ? `${domId}-note` : null].filter(Boolean).join(' ') || undefined}
      title={item.disabled && item.reason ? item.reason : undefined}
      onClick={() => onActivate(item)}
      onMouseEnter={(e) => onHover(item, e.currentTarget)}
      className={cx(
        'flex w-full cursor-default gap-2.5 rounded-[8px] px-2.5 text-start text-[13px] leading-[18px] outline-none select-none',
        sheet ? 'min-h-11 py-[11px]' : 'min-h-9 py-[9px]',
        item.leading || item.onToggle ? 'items-center' : 'items-start',
        // Focus and hover: a light background only. Chosen: a tick and accent text, never a background (#208).
        'focus:bg-subtle focus-visible:shadow-[inset_0_0_0_2px_var(--ws-focus)]',
        !item.disabled && 'hover:bg-subtle',
        expanded && 'bg-subtle',
        item.disabled ? 'text-ink-3' : item.danger ? 'text-danger' : item.checked && !item.onToggle ? 'font-semibold text-primary' : 'text-ink',
      )}
      data-checked={item.checked ? '' : undefined}
    >
      {item.onToggle ? (
        <span
          aria-hidden="true"
          data-menu-check=""
          onClick={(e) => {
            e.stopPropagation();
            if (!item.disabled) item.onToggle?.();
          }}
          className="-my-1 -ms-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] hover:bg-line/60"
        >
          <span className={cx('flex h-4 w-4 items-center justify-center rounded-[4px] border', item.checked ? 'border-primary bg-primary text-[var(--ws-on-primary)]' : 'border-ink-3/60 bg-surface')}>{item.checked ? <Icon name="check" size={11} /> : null}</span>
        </span>
      ) : null}
      {item.leading ? <span className="-my-0.5 flex shrink-0 items-center">{item.leading}</span> : null}
      {!item.leading && (iconSlot || item.icon) ? (
        <span className="flex h-[18px] w-4 shrink-0 items-center justify-center">
          {item.icon ? <Icon name={item.icon} size={16} className={cx(item.disabled ? 'text-ink-3 opacity-70' : item.danger ? 'text-danger' : item.checked ? 'text-primary' : 'text-ink-2')} /> : null}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {item.badge ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span id={`${domId}-label`} className={cx('min-w-0 truncate', item.disabled && 'opacity-80')}>
              {item.label}
            </span>
            <span id={`${domId}-badge`} data-menu-badge="" className="inline-flex h-[17px] shrink-0 items-center rounded-full bg-subtle px-1.5 text-[10.5px] leading-none font-semibold text-ink-2">
              {item.badge}
            </span>
          </span>
        ) : (
          <span id={`${domId}-label`} className={cx('block', item.disabled && 'opacity-80')}>
            {item.label}
          </span>
        )}
        {note ? (
          <span id={`${domId}-note`} className={cx('mt-0.5 flex items-start gap-1 text-[11.5px] leading-[16px]', item.disabled && item.reason ? 'text-ink-2' : 'text-ink-3')}>
            {item.disabled && item.reason ? <Icon name="info" size={12} className="mt-[2px] shrink-0" /> : null}
            <span className="min-w-0">{note}</span>
          </span>
        ) : null}
      </span>
      {item.shortcut ? <kbd className="mt-px shrink-0 rounded-[5px] border border-line px-1.5 font-mono text-[11px] leading-[16px] text-ink-3">{item.shortcut}</kbd> : null}
      {item.meta ? (
        <span className="mt-px shrink-0 text-[11.5px] leading-[16px] font-medium text-ink-3 tabular-nums" aria-label={item.metaLabel} title={item.metaLabel}>
          {item.meta}
        </span>
      ) : null}
      {item.checked !== undefined && !item.onToggle ? (
        <span className="flex h-[18px] w-4 shrink-0 items-center justify-center">{item.checked ? <Icon name="check" size={16} className="text-primary" /> : null}</span>
      ) : null}
      {item.submenu ? <Icon name={rtl ? 'chevron-left' : 'chevron-right'} size={16} className="mt-px shrink-0 text-ink-3" /> : null}
    </div>
  );
}
