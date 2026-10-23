import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CalendarPeek } from './CalendarPeek';
import { SidebarMenu, type SidebarMenuEntry } from './SidebarMenu';
import { GUEST_LOCKED_APPS, appRoute, navApps, type AppDefinition } from '@shared/apps';
import { mergeSidebar, moveKey, reorderKeys, sidebarDefaults, type SidebarSection } from '@shared/sidebar-prefs';
import { app, updatePrefs } from '../core/app-state';
import { apiGet } from '../core/api';
import { appLabel, t } from '../core/i18n';
import { hideSidebarItem, orderSidebar, pinSidebarItem, useSidebarPrefs } from '../core/sidebar-prefs';
import { useStore } from '../core/store';
import { navigate, tabsStore } from '../core/tabs';
import { toast } from '../core/toasts';
import { closeOverlay, openOverlay, ui } from '../core/ui';
import { openSignInPanel, useGuest } from '../core/session';
import { text } from '../core/i18n';
import { roleLabel } from '../core/orgs';
import { OrgTile } from '../app/overlays/OrgSwitcher';
import { Icon } from '../components/Icon';
import { CountBadge, cx } from '../components/ui';
import { bytes } from '../core/time';
import { StorageMeter } from '../modules/account/Storage';
import { LocalAiPill } from '../modules/ai/LocalAiPill';

/** Where Settings › Sidebar is: the sidebar's footer and each item's menu open it. */
export const SIDEBAR_SETTINGS_ROUTE = '/settings/sidebar';
/** How long a finger rests on an item before its menu opens, and how far it may move meanwhile. */
export const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
const DRAG_TYPE = 'application/x-worksuite-sidebar';

/** Pinned, or one of the two sections: an item is dragged within its own list only. */
type ListId = 'pinned' | SidebarSection;
type Place = 'before' | 'after';

interface MenuState {
  a: AppDefinition;
  list: ListId;
  x: number;
  y: number;
  trigger: HTMLElement | null;
}

/**
 * Sidebar, 220 px (§4.12, FR-NAV-01, FR-REG-01/05): only the apps this user
 * may open, work apps above the divider and business apps below, unread
 * badges, the files card, Settings pinned to the bottom. Expanded, collapsed
 * or auto-hide.
 *
 * Each person's own (core/sidebar-prefs): apps they pinned in a Pinned section at the top, apps they removed left
 * out, each list in their order. Right-click an item (or press on it a moment, on a touch screen) to pin, unpin or
 * remove it; drag it — or Alt+↑↓ — to move it within its own list. The preferences are laid over the apps already
 * through the access gates: never an app the person cannot open, and a newly given app in its default place.
 */
export function Sidebar() {
  const apps = useStore(app, (s) => s.apps);
  const status = useStore(app, (s) => s.status);
  const prefs = useStore(app, (s) => s.prefs);
  const personal = useStore(app, (s) => s.auth?.account?.kind === 'personal');
  const activeApp = useStore(tabsStore, (s) => s.tabs.find((x) => x.id === s.activeId)?.app ?? 'home');
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drag, setDrag] = useState<{ key: string; list: ListId } | null>(null);
  const [drop, setDrop] = useState<{ key: string; place: Place } | null>(null);
  const mode = prefs?.sidebarMode ?? 'expanded';
  // Auto-hide stays open while an item's menu is.
  const collapsed = mode === 'collapsed' || (mode === 'auto-hide' && !hover && !menu);

  // A channel (WhatsApp, in Chat) has no entry of its own: a pin of it from before is Chat's now (#35).
  const listed = useMemo(() => navApps(apps), [apps]);
  // Guest mode (#149): its apps, then the ones that need an account, locked.
  const guest = useGuest();
  const defaults = useMemo(() => sidebarDefaults(listed, guest), [listed, guest]);
  const inDefaults = useMemo(() => new Set(defaults.map((d) => d.item.id)), [defaults]);
  const own = useSidebarPrefs();
  const layout = useMemo(() => mergeSidebar(defaults, listed, own.items), [defaults, listed, own]);
  const locked = guest ? GUEST_LOCKED_APPS : [];

  const badge = (a: AppDefinition): number => {
    if (!status || !a.badge) return 0;
    return status.unread[a.badge] ?? 0;
  };

  const open = (a: AppDefinition) => {
    if (a.surface === 'browser') openOverlay('launcher');
    else navigate(appRoute(a));
  };

  const saveOrder = (list: ListId, keys: string[]) => void orderSidebar(list === 'pinned' ? { scope: 'pinned', keys } : { scope: 'section', section: list, keys });

  /** Out of the sidebar: hidden, for an app that is there by default; unpinned, for one only Pinned brought in. */
  const remove = (a: AppDefinition) => {
    const byDefault = inDefaults.has(a.id);
    void (byDefault ? hideSidebarItem(a.id, true) : pinSidebarItem(a.id, false)).then((ok) => {
      if (ok) toast('info', t('sidebar.removed', { app: appLabel(a) }), { label: t('sidebar.undo'), run: () => void (byDefault ? hideSidebarItem(a.id, false) : pinSidebarItem(a.id, true)) });
    });
  };

  const openMenu = (a: AppDefinition, list: ListId, x: number, y: number, trigger: HTMLElement | null) => {
    setDrag(null);
    setDrop(null);
    setMenu({ a, list, x, y, trigger });
  };

  const menuEntries = (m: MenuState): SidebarMenuEntry[] => {
    const pinned = m.list === 'pinned';
    return [
      { id: pinned ? 'unpin' : 'pin', icon: pinned ? 'pin-off' : 'pin', label: pinned ? t('sidebar.unpin') : t('sidebar.pin'), onSelect: () => void pinSidebarItem(m.a.id, !pinned) },
      { id: 'remove', icon: 'eye-off', label: t('sidebar.remove'), onSelect: () => remove(m.a) },
      'separator',
      { id: 'customize', icon: 'sliders', label: t('nav.customizeSidebar'), onSelect: () => navigate(SIDEBAR_SETTINGS_ROUTE) },
    ];
  };

  const placeOf = (e: DragEvent<HTMLElement>): Place => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };

  /** What an item in `list` needs to be dragged, dropped on, opened a menu on and moved with the keyboard. */
  const custom = (a: AppDefinition, list: ListId): Customise => ({
    pinned: list === 'pinned',
    dragging: drag?.key === a.id,
    indicator: drop?.key === a.id ? drop.place : null,
    onMenu: (x, y, el) => openMenu(a, list, x, y, el),
    onMove: (delta) => {
      const keys = layout[list].map((x) => x.id);
      const next = moveKey(keys, a.id, delta);
      if (next !== keys) saveOrder(list, next);
    },
    drag: {
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.setData(DRAG_TYPE, a.id);
        e.dataTransfer.setData('text/plain', appLabel(a));
        e.dataTransfer.effectAllowed = 'move';
        setMenu(null);
        setDrag({ key: a.id, list });
      },
      onDragEnd: () => {
        setDrag(null);
        setDrop(null);
      },
      onDragOver: (e) => {
        if (!drag) return;
        // Into another list: refused, and no line shows where it would go.
        if (drag.list !== list) {
          e.dataTransfer.dropEffect = 'none';
          if (drop) setDrop(null);
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const place = placeOf(e);
        if (drop?.key !== a.id || drop.place !== place) setDrop({ key: a.id, place });
      },
      onDrop: (e) => {
        const moving = drag;
        setDrag(null);
        setDrop(null);
        if (!moving || moving.list !== list) return;
        e.preventDefault();
        const keys = layout[list].map((x) => x.id);
        const next = reorderKeys(keys, moving.key, a.id, placeOf(e));
        if (next !== keys) saveOrder(list, next);
      },
    },
  });

  const item = (a: AppDefinition, list: ListId) => <Item key={a.id} a={a} active={activeApp === a.id} collapsed={collapsed} badge={badge(a)} onClick={() => open(a)} custom={custom(a, list)} />;

  return (
    <nav
      aria-label="Apps"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cx('flex shrink-0 flex-col bg-navy pb-3 text-navy-ink transition-[width] duration-150', collapsed ? 'w-[68px]' : 'w-[220px]')}
    >
      <OrgCard collapsed={collapsed} />
      <div className={cx('flex-1 overflow-y-auto overflow-x-hidden pt-2', collapsed ? 'scroll-none px-2' : 'scroll-thin px-2.5')}>
        {layout.pinned.length ? (
          <>
            {!collapsed ? (
              <div className="flex h-6 items-center gap-1.5 px-3 text-[11px] font-semibold tracking-[0.06em] text-navy-ink/60 uppercase" aria-hidden>
                <Icon name="pin" size={12} />
                {t('nav.pinned')}
              </div>
            ) : null}
            <ul className={cx('flex flex-col gap-0.5', collapsed && 'rounded-[11px] bg-white/5 py-1')} aria-label={t('nav.pinned')} title={collapsed ? t('nav.pinned') : undefined} data-list="pinned">
              {layout.pinned.map((a) => item(a, 'pinned'))}
            </ul>
            <div className="mx-2 my-3 border-t border-white/10" data-pinned-divider />
          </>
        ) : null}
        <ul className="flex flex-col gap-0.5" data-list="work">
          {layout.work.map((a) => item(a, 'work'))}
        </ul>
        {locked.length ? (
          <>
            <div className="mx-2 my-3 border-t border-white/10" />
            <ul className="flex flex-col gap-0.5" aria-label={text('Needs a WorkSuite account')}>
              {locked.map((a) => (
                <Item key={a.id} a={a} active={false} collapsed={collapsed} badge={0} locked onClick={() => openSignInPanel(a.id)} />
              ))}
            </ul>
          </>
        ) : null}
        {layout.business.length ? <div className="mx-2 my-3 border-t border-white/10" /> : null}
        <ul className="flex flex-col gap-0.5" data-list="business">
          {layout.business.map((a) => item(a, 'business'))}
          <li>
            <button type="button" onClick={() => openOverlay('launcher')} className={cx('flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium hover:bg-white/8 hover:text-white', collapsed && 'h-11 justify-center px-0')} title={collapsed ? t('nav.moreApps') : undefined}>
              <Icon name="grid" size={collapsed ? 22 : 19} />
              {!collapsed && <span>{t('nav.moreApps')}</span>}
            </button>
          </li>
        </ul>
      </div>

      {/* A Personal account's Cloud storage (screen 10) in place of the Drive card; an Enterprise account keeps the card. */}
      {!collapsed ? personal ? <StorageMeter /> : <FilesCard /> : null}

      <div className="px-2.5 pt-2">
        <LocalAiPill collapsed={collapsed} />
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className={cx('flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium hover:bg-white/8 hover:text-white', activeApp === 'settings' && 'bg-primary text-white', collapsed && 'h-11 justify-center px-0')}
          title={collapsed ? t('nav.settings') : undefined}
        >
          <Icon name="settings" size={collapsed ? 22 : 19} />
          {!collapsed && <span>{t('nav.settings')}</span>}
        </button>
        <button
          type="button"
          className={cx('mt-1 flex h-8 w-full items-center gap-3 rounded-[9px] px-3 text-[12px] text-navy-ink/70 hover:bg-white/8', collapsed && 'h-10 justify-center px-0 text-navy-ink/85')}
          onClick={() => navigate(SIDEBAR_SETTINGS_ROUTE)}
          aria-label={collapsed ? t('nav.customizeSidebar') : undefined}
          title={collapsed ? t('nav.customizeSidebar') : undefined}
        >
          <Icon name="sliders" size={collapsed ? 19 : 16} />
          {!collapsed && <span>{t('nav.customizeSidebar')}</span>}
        </button>
        <button
          type="button"
          className={cx('mt-1 flex h-8 w-full items-center gap-3 rounded-[9px] px-3 text-[12px] text-navy-ink/70 hover:bg-white/8', collapsed && 'h-10 justify-center px-0 text-navy-ink/85')}
          onClick={() => void updatePrefs({ sidebarMode: mode === 'expanded' ? 'collapsed' : mode === 'collapsed' ? 'auto-hide' : 'expanded' })}
          aria-label={`Sidebar: ${mode}. Change`}
          title={`Sidebar: ${mode}`}
        >
          <Icon name={collapsed ? 'panel-open' : 'panel-close'} size={collapsed ? 19 : 16} />
          {!collapsed && <span className="capitalize">{mode.replace('-', ' ')}</span>}
        </button>
      </div>
      {menu ? <SidebarMenu key={`${menu.a.id}:${menu.x}:${menu.y}`} at={{ x: menu.x, y: menu.y }} label={t('sidebar.menu', { app: appLabel(menu.a) })} entries={menuEntries(menu)} onClose={() => setMenu(null)} returnFocus={menu.trigger} /> : null}
    </nav>
  );
}

/**
 * The organisation you are working in, at the top of the sidebar (sidebar
 * designs 1–3): the title bar keeps search. Opens the switcher under it — or
 * beside it, collapsed to its tile.
 */
function OrgCard({ collapsed }: { collapsed: boolean }) {
  const b = useStore(app, (s) => s.bootstrap);
  const current = useStore(app, (s) => s.organizationId);
  const overlay = useStore(ui, (s) => s.overlay);
  const orgs = b?.organizations ?? [];
  if (!b || orgs.length === 0) return null;
  const single = orgs.length === 1;
  const org = current ? orgs.find((o) => o.id === current) : single ? orgs[0] : undefined;
  const index = org ? orgs.indexOf(org) + 1 : 0;
  const name = org?.name ?? 'All organizations';
  const sub = !org ? `${orgs.length} organizations` : single ? (roleLabel(org.role) ?? 'Organization') : `Organization · ${index} of ${orgs.length}`;
  const open = overlay === 'org';
  const toggle = () => (open ? closeOverlay() : openOverlay('org'));
  return (
    <div className="px-2.5 pt-2.5 pb-1">
      <button
        type="button"
        data-org-card
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Organization: ${name}. Change organization`}
        title={collapsed ? `${name} — ${sub}` : undefined}
        className={cx(
          'relative flex w-full items-center gap-2.5 rounded-[12px] text-start transition-colors',
          collapsed ? 'h-11 justify-center' : 'h-[54px] border px-2.5',
          !collapsed && (open ? 'border-[#5B79F0] bg-white/10 shadow-[0_0_0_1px_#5B79F0]' : 'border-white/10 bg-white/6 hover:bg-white/10'),
        )}
      >
        <OrgTile id={org?.id ?? 'all'} name={name} all={!org} size={collapsed ? 36 : 32} />
        {collapsed && orgs.length > 1 ? <span className="absolute -end-0.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-navy bg-[#5B79F0] px-0.5 text-[9.5px] font-bold text-white">{orgs.length}</span> : null}
        {!collapsed ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[13.5px] text-white">{name}</b>
              <span className="truncate text-[11.5px] text-navy-ink/80">{sub}</span>
            </span>
            {!single ? <Icon name="chevrons-up-down" size={15} className="shrink-0 text-navy-ink/70" /> : null}
          </>
        ) : null}
      </button>
    </div>
  );
}

/** An item's part in the person's own sidebar; absent on a locked item (guest mode), which only opens sign-in. */
interface Customise {
  pinned: boolean;
  dragging: boolean;
  /** Where a dragged item would go, against this one. */
  indicator: Place | null;
  onMenu: (x: number, y: number, el: HTMLElement) => void;
  onMove: (delta: -1 | 1) => void;
  drag: {
    draggable: true;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
  };
}

function Item({ a, active, collapsed, badge, onClick, locked, custom }: { a: AppDefinition; active: boolean; collapsed: boolean; badge: number; onClick: () => void; locked?: boolean; custom?: Customise }) {
  const label = locked ? text(a.guestLabel ?? a.label) : appLabel(a);
  // Calendar peek (DMO-CAL-05): today's agenda beside the icon, after a short rest on it.
  const peekable = a.id === 'calendar' && !locked;
  const [peek, setPeek] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A long press on a touch screen: its timer and where it began; `fired` keeps the tap that ends it from opening the app.
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean } | null>(null);
  const show = (el: HTMLElement, wait: number) => {
    if (!peekable) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      setPeek({ top: Math.max(8, r.top - 8), left: r.right + 8 });
    }, wait);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPeek(null);
  };
  const endPress = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    if (press.current) press.current.timer = null;
  };
  useEffect(
    () => () => {
      hide();
      endPress();
    },
    [],
  );

  const onContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!custom) return;
    e.preventDefault();
    hide();
    const el = e.currentTarget;
    // From the keyboard (the menu key, Shift+F10) there is no pointer: under the item.
    if (e.clientX === 0 && e.clientY === 0) {
      const r = el.getBoundingClientRect();
      custom.onMenu(r.left + r.width / 2, r.bottom, el);
    } else custom.onMenu(e.clientX, e.clientY, el);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!custom || (e.pointerType !== 'touch' && e.pointerType !== 'pen')) return;
    endPress();
    const el = e.currentTarget;
    const { clientX: x, clientY: y } = e;
    const p = { timer: null as ReturnType<typeof setTimeout> | null, x, y, fired: false };
    p.timer = setTimeout(() => {
      p.timer = null;
      p.fired = true;
      hide();
      custom.onMenu(x, y, el);
    }, LONG_PRESS_MS);
    press.current = p;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (p?.timer && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) endPress();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (peekable && e.key === 'Escape') hide();
    // Alt+↑/↓: the keyboard's way to move an item within its list.
    if (custom && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      custom.onMove(e.key === 'ArrowUp' ? -1 : 1);
    }
  };

  return (
    <li onMouseLeave={peekable ? hide : undefined} className="relative" data-key={custom ? a.id : undefined}>
      {peek ? <CalendarPeek at={peek} onClose={hide} /> : null}
      {custom?.indicator ? <span aria-hidden data-drop-indicator={custom.indicator} className={cx('pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-[#5B79F0]', custom.indicator === 'before' ? '-top-0.5' : '-bottom-0.5')} /> : null}
      <button
        type="button"
        {...custom?.drag}
        onMouseEnter={peekable ? (e) => show(e.currentTarget, 450) : undefined}
        onFocus={peekable ? (e) => show(e.currentTarget, 0) : undefined}
        onBlur={peekable ? hide : undefined}
        onKeyDown={onKeyDown}
        onContextMenu={custom ? onContextMenu : undefined}
        onPointerDown={custom ? onPointerDown : undefined}
        onPointerMove={custom ? onPointerMove : undefined}
        onPointerUp={custom ? endPress : undefined}
        onPointerCancel={custom ? endPress : undefined}
        onPointerLeave={custom ? endPress : undefined}
        onClick={() => {
          hide();
          if (press.current?.fired) {
            press.current = null;
            return;
          }
          onClick();
        }}
        aria-current={active ? 'page' : undefined}
        title={locked ? text('Sign in to use {app}', { app: label }) : collapsed ? label : undefined}
        aria-label={locked ? `${label} (${text('needs a WorkSuite account')})` : undefined}
        className={cx(
          'relative flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium transition-colors',
          active ? 'bg-primary text-white' : 'hover:bg-white/8 hover:text-white',
          // Collapsed (#387): a full-size square target and a larger icon, not the expanded row's icon left alone.
          collapsed && 'h-11 justify-center px-0',
          custom?.dragging && 'opacity-50',
        )}
      >
        <Icon name={a.icon} size={collapsed ? 22 : 19} />
        {!collapsed && <span className="flex-1 truncate text-start">{label}</span>}
        {!collapsed && a.surface === 'browser' && !locked ? <Icon name="external" size={13} className="opacity-60" /> : null}
        {locked ? <Icon name="lock" size={13} className={cx('opacity-70', collapsed && 'absolute end-1.5 bottom-1')} /> : null}
        {badge > 0 ? (
          <CountBadge
            n={badge}
            tone={a.id === 'mail' || a.id === 'tasks' ? 'indigo' : 'badge'}
            // Collapsed, the count sits on the icon's top-right corner, small and ringed in the sidebar colour, so the icon stays readable.
            className={collapsed ? 'absolute top-0.5 start-[calc(50%+3px)] !h-4 !min-w-4 !px-1 !text-[9.5px] ring-2 ring-navy' : ''}
          />
        ) : null}
      </button>
    </li>
  );
}

function FilesCard() {
  const apps = useStore(app, (s) => s.apps);
  const hasFiles = apps.some((a) => a.id === 'files');
  const network = useStore(app, (s) => s.status?.network);
  const q = useQuery({
    queryKey: ['home', 'storage'],
    queryFn: () => apiGet<{ stats?: { storage_used?: number; storage_quota?: number } }>('/api/dashboard/home'),
    staleTime: 5 * 60_000,
    enabled: hasFiles,
  });
  if (!hasFiles) return null;
  const used = q.data?.stats?.storage_used ?? 0;
  const quota = q.data?.stats?.storage_quota ?? 0;
  const offline = network === 'OFFLINE';
  return (
    // Off in a short window (Windows display scaling of 150% and over on Full HD): the apps above need the room more,
    // and Files is one of them.
    <button type="button" onClick={() => navigate('/files')} className="mx-2.5 mt-2 rounded-[10px] bg-white/6 px-3 py-2.5 text-start hover:bg-white/10 [@media(max-height:760px)]:hidden">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
        <Icon name={offline ? 'cloud-off' : 'cloud'} size={15} className={offline ? 'text-[#8A90A2]' : 'text-[#43B581]'} />
        {offline ? 'Files offline' : 'WorkSuite Drive'}
      </div>
      <div className="mt-1 text-[11.5px] leading-snug text-navy-ink/75">
        {quota > 0 ? `${bytes(used)} of ${bytes(quota)} used` : used > 0 ? `${bytes(used)} used` : 'Files are available online'}
        <br />
        Local sync arrives with Drive sync
      </div>
    </button>
  );
}
