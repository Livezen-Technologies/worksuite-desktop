import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CalendarPeek } from './CalendarPeek';
import { GUEST_LOCKED_APPS, appRoute, navApps, type AppDefinition } from '@shared/apps';
import { app, updatePrefs } from '../core/app-state';
import { apiGet } from '../core/api';
import { appLabel, t } from '../core/i18n';
import { useStore } from '../core/store';
import { navigate, tabsStore } from '../core/tabs';
import { closeOverlay, openOverlay, ui } from '../core/ui';
import { openSignInPanel, useGuest } from '../core/session';
import { text } from '../core/i18n';
import { roleLabel } from '../core/orgs';
import { OrgTile } from '../app/overlays/OrgSwitcher';
import { Icon } from '../components/Icon';
import { CountBadge, cx } from '../components/ui';
import { bytes } from '../core/time';

/**
 * Sidebar, 220 px (§4.12, FR-NAV-01, FR-REG-01/05): only the apps this user
 * may open, work apps above the divider and business apps below, unread
 * badges, the files card, Settings pinned to the bottom. Expanded, collapsed
 * or auto-hide.
 */
export function Sidebar() {
  const apps = useStore(app, (s) => s.apps);
  const status = useStore(app, (s) => s.status);
  const prefs = useStore(app, (s) => s.prefs);
  const activeApp = useStore(tabsStore, (s) => s.tabs.find((x) => x.id === s.activeId)?.app ?? 'home');
  const [hover, setHover] = useState(false);
  const mode = prefs?.sidebarMode ?? 'expanded';
  const collapsed = mode === 'collapsed' || (mode === 'auto-hide' && !hover);

  // A channel (WhatsApp, in Chat) has no entry of its own: a pin of it from before is Chat's now (#35).
  const listed = navApps(apps);
  const native = listed.filter((a) => a.surface === 'native');
  const pinnedBrowser = listed.filter((a) => (a.surface === 'browser' || a.channelOf) && prefs?.pinnedApps.includes(a.id));
  // Guest mode (#149): its apps, then the ones that need an account, locked.
  const guest = useGuest();
  const work = guest ? native : native.filter((a) => a.sidebar === 'work');
  const business = guest ? [] : [...native.filter((a) => a.sidebar === 'business'), ...pinnedBrowser];
  const locked = guest ? GUEST_LOCKED_APPS : [];

  const badge = (a: AppDefinition): number => {
    if (!status || !a.badge) return 0;
    return status.unread[a.badge] ?? 0;
  };

  const open = (a: AppDefinition) => {
    if (a.surface === 'browser') openOverlay('launcher');
    else navigate(appRoute(a));
  };

  return (
    <nav
      aria-label="Apps"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cx('flex shrink-0 flex-col bg-navy pb-3 text-navy-ink transition-[width] duration-150', collapsed ? 'w-[64px]' : 'w-[220px]')}
    >
      <OrgCard collapsed={collapsed} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pt-2 scroll-thin">
        <ul className="flex flex-col gap-0.5">
          {work.map((a) => (
            <Item key={a.id} a={a} active={activeApp === a.id} collapsed={collapsed} badge={badge(a)} onClick={() => open(a)} />
          ))}
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
        {business.length ? <div className="mx-2 my-3 border-t border-white/10" /> : null}
        <ul className="flex flex-col gap-0.5">
          {business.map((a) => (
            <Item key={a.id} a={a} active={activeApp === a.id} collapsed={collapsed} badge={badge(a)} onClick={() => open(a)} />
          ))}
          <li>
            <button type="button" onClick={() => openOverlay('launcher')} className={cx('flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium hover:bg-white/8 hover:text-white', collapsed && 'justify-center px-0')} title={collapsed ? t('nav.moreApps') : undefined}>
              <Icon name="grid" size={19} />
              {!collapsed && <span>{t('nav.moreApps')}</span>}
            </button>
          </li>
        </ul>
      </div>

      {!collapsed ? <FilesCard /> : null}

      <div className="px-2.5 pt-2">
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className={cx('flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium hover:bg-white/8 hover:text-white', activeApp === 'settings' && 'bg-primary text-white', collapsed && 'justify-center px-0')}
          title={collapsed ? t('nav.settings') : undefined}
        >
          <Icon name="settings" size={19} />
          {!collapsed && <span>{t('nav.settings')}</span>}
        </button>
        <button
          type="button"
          className={cx('mt-1 flex h-8 w-full items-center gap-3 rounded-[9px] px-3 text-[12px] text-navy-ink/70 hover:bg-white/8', collapsed && 'justify-center px-0')}
          onClick={() => void updatePrefs({ sidebarMode: mode === 'expanded' ? 'collapsed' : mode === 'collapsed' ? 'auto-hide' : 'expanded' })}
          aria-label={`Sidebar: ${mode}. Change`}
          title={`Sidebar: ${mode}`}
        >
          <Icon name={collapsed ? 'panel-open' : 'panel-close'} size={16} />
          {!collapsed && <span className="capitalize">{mode.replace('-', ' ')}</span>}
        </button>
      </div>
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
          'relative flex w-full items-center gap-2.5 rounded-[12px] text-left transition-colors',
          collapsed ? 'h-11 justify-center' : 'h-[54px] border px-2.5',
          !collapsed && (open ? 'border-[#5B79F0] bg-white/10 shadow-[0_0_0_1px_#5B79F0]' : 'border-white/10 bg-white/6 hover:bg-white/10'),
        )}
      >
        <OrgTile id={org?.id ?? 'all'} name={name} all={!org} size={collapsed ? 36 : 32} />
        {collapsed && orgs.length > 1 ? <span className="absolute -right-0.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-navy bg-[#5B79F0] px-0.5 text-[9.5px] font-bold text-white">{orgs.length}</span> : null}
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

function Item({ a, active, collapsed, badge, onClick, locked }: { a: AppDefinition; active: boolean; collapsed: boolean; badge: number; onClick: () => void; locked?: boolean }) {
  const label = locked ? text(a.guestLabel ?? a.label) : appLabel(a);
  // Calendar peek (DMO-CAL-05): today's agenda beside the icon, after a short rest on it.
  const peekable = a.id === 'calendar' && !locked;
  const [peek, setPeek] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  useEffect(() => hide, []);
  return (
    <li onMouseLeave={peekable ? hide : undefined}>
      {peek ? <CalendarPeek at={peek} onClose={hide} /> : null}
      <button
        type="button"
        onMouseEnter={peekable ? (e) => show(e.currentTarget, 450) : undefined}
        onFocus={peekable ? (e) => show(e.currentTarget, 0) : undefined}
        onBlur={peekable ? hide : undefined}
        onKeyDown={peekable ? (e) => e.key === 'Escape' && hide() : undefined}
        onClick={() => {
          hide();
          onClick();
        }}
        aria-current={active ? 'page' : undefined}
        title={locked ? text('Sign in to use {app}', { app: label }) : collapsed ? label : undefined}
        aria-label={locked ? `${label} (${text('needs a WorkSuite account')})` : undefined}
        className={cx(
          'relative flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium transition-colors',
          active ? 'bg-primary text-white' : 'hover:bg-white/8 hover:text-white',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon name={a.icon} size={19} />
        {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
        {!collapsed && a.surface === 'browser' && !locked ? <Icon name="external" size={13} className="opacity-60" /> : null}
        {locked ? <Icon name="lock" size={13} className={cx('opacity-70', collapsed && 'absolute right-1.5 bottom-1')} /> : null}
        {badge > 0 ? <CountBadge n={badge} tone={a.id === 'mail' || a.id === 'tasks' ? 'indigo' : 'badge'} className={collapsed ? 'absolute top-0.5 right-1' : ''} /> : null}
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
    <button type="button" onClick={() => navigate('/files')} className="mx-2.5 mt-2 rounded-[10px] bg-white/6 px-3 py-2.5 text-left hover:bg-white/10">
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
