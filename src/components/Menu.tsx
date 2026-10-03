import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { text } from '../core/i18n';
import { Icon } from './Icon';
import { cx } from './ui';
import { placeMenu, sheetMode, SHEET_BELOW, type Placement, type Side } from './menuPlacement';

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
 * Placement (menuPlacement): above or beside the trigger, flipped and shifted
 * to stay on screen, no taller than the room it has, scrolling inside. Below
 * `sheetBelow` px of window width the menu is a bottom sheet instead, and a
 * submenu replaces the sheet's list with a Back row.
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
}

export interface MenuSection {
  id: string;
  label?: string;
  items: MenuItem[];
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
}

const SUB_WIDTH = 264;

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function isRtl() {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
}

const visible = (sections: MenuSection[]) => sections.filter((s) => s.items.length > 0);

export function Menu({ sections, label, anchor, avoid, prefer = 'top', align = 'center', onClose, sheetBelow = SHEET_BELOW, width = 288 }: MenuProps) {
  const menuId = useId().replace(/:/g, '');
  const [open, setOpen] = useState<OpenSub[]>([]);
  const [viewport, setViewport] = useState(viewportSize);
  const counter = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
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

  const onKeyDown = (level: number, e: ReactKeyboardEvent<HTMLElement>, list: HTMLElement | null) => {
    const items = list ? Array.from(list.querySelectorAll<HTMLElement>('[data-menu-item]')) : [];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const current = at >= 0 ? levels[level]!.sections.flatMap((s) => s.items).find((i) => domId(level, i.id) === items[at]!.id) : undefined;
    const move = (to: number) => items[(to + items.length) % items.length]?.focus();
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let handled = true;
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
      case 'Enter':
      case ' ':
        if (current) activate(level, current);
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
        // Typeahead: the next item starting with the letter typed.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
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
          viewport={viewport}
          rtl={rtl}
          focus={level === 0 ? true : open[level - 1]!.focus}
          focusKey={level === 0 ? 0 : open[level - 1]!.n}
          contentKey={contentKey(lv.sections)}
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
            />
          )}
        />
      ))}
    </>,
    target,
  );
}

const contentKey = (sections: MenuSection[]) => sections.map((s) => `${s.id}:${s.label ?? ''}:${s.items.map((i) => `${i.id}|${i.label}|${i.description ?? ''}|${i.reason ?? ''}`).join(',')}`).join(';');

function focusFirst(list: HTMLElement | null) {
  const items = list ? Array.from(list.querySelectorAll<HTMLElement>('[data-menu-item]')) : [];
  (items.find((el) => el.getAttribute('aria-disabled') !== 'true') ?? items[0])?.focus({ preventScroll: true });
}

function Floating({
  menuId,
  level,
  anchorEl,
  avoidEl,
  prefer,
  align,
  width,
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
      // A submenu lines its first item up with the item that opened it.
      gap: level === 0 ? 10 : 2,
      avoid: av ? { left: av.left, top: av.top, width: av.width, height: av.height } : null,
    });
    setPlace((p) => (p && p.left === next.left && p.top === next.top && p.maxHeight === next.maxHeight && p.maxWidth === next.maxWidth && p.side === next.side ? p : next));
  }, [viewport, width, prefer, align, rtl, level, contentKey]);

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
}) {
  // The icon column only where some item at this level has an icon: no blank gap before every label (worksuite-desktop#168).
  const iconSlot = sections.some((s) => s.items.some((i) => !!i.icon));
  return (
    <div ref={listRef} id={id} role="menu" aria-label={label} onKeyDown={onKeyDown} className="outline-none">
      {sections.map((s, si) => (
        <div key={s.id} role="group" aria-labelledby={s.label ? `${id}-${s.id}` : undefined} aria-label={s.label ? undefined : label}>
          {si > 0 ? <div role="separator" className="mx-1.5 my-1 h-px bg-line" /> : null}
          {s.label ? (
            <div id={`${id}-${s.id}`} className="px-2.5 pt-2 pb-1 text-[11px] leading-[14px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
              {s.label}
            </div>
          ) : null}
          {s.items.map((item) => (
            <Row key={item.id} item={item} iconSlot={iconSlot} domId={domId(level, item.id)} sheet={sheet} expanded={openId === item.id} rtl={rtl} onActivate={onActivate} onHover={onHover} />
          ))}
        </div>
      ))}
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
      aria-describedby={note ? `${domId}-note` : undefined}
      title={item.disabled && item.reason ? item.reason : undefined}
      onClick={() => onActivate(item)}
      onMouseEnter={(e) => onHover(item, e.currentTarget)}
      className={cx(
        'flex w-full cursor-default items-start gap-2.5 rounded-[8px] px-2.5 text-start text-[13px] leading-[18px] outline-none select-none',
        sheet ? 'min-h-11 py-[11px]' : 'min-h-9 py-[9px]',
        'focus:bg-selection focus-visible:shadow-[inset_0_0_0_2px_var(--ws-focus)]',
        !item.disabled && 'hover:bg-subtle',
        expanded && 'bg-subtle',
        item.disabled ? 'text-ink-3' : item.danger ? 'text-danger' : 'text-ink',
      )}
    >
      {iconSlot || item.icon ? (
        <span className="flex h-[18px] w-4 shrink-0 items-center justify-center">
          {item.icon ? <Icon name={item.icon} size={16} className={cx(item.disabled ? 'text-ink-3 opacity-70' : item.danger ? 'text-danger' : 'text-ink-2')} /> : null}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span id={`${domId}-label`} className={cx('block', item.disabled && 'opacity-80')}>
          {item.label}
        </span>
        {note ? (
          <span id={`${domId}-note`} className={cx('mt-0.5 flex items-start gap-1 text-[11.5px] leading-[16px]', item.disabled && item.reason ? 'text-ink-2' : 'text-ink-3')}>
            {item.disabled && item.reason ? <Icon name="info" size={12} className="mt-[2px] shrink-0" /> : null}
            <span className="min-w-0">{note}</span>
          </span>
        ) : null}
      </span>
      {item.shortcut ? <kbd className="mt-px shrink-0 rounded-[5px] border border-line px-1.5 font-mono text-[11px] leading-[16px] text-ink-3">{item.shortcut}</kbd> : null}
      {item.checked !== undefined ? (
        <span className="flex h-[18px] w-4 shrink-0 items-center justify-center">{item.checked ? <Icon name="check" size={16} className="text-primary" /> : null}</span>
      ) : null}
      {item.submenu ? <Icon name={rtl ? 'chevron-left' : 'chevron-right'} size={16} className="mt-px shrink-0 text-ink-3" /> : null}
    </div>
  );
}
