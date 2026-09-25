import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AppDefinition } from '@shared/apps';
import { app, updatePrefs } from '../core/app-state';
import { apiGet } from '../core/api';
import { appLabel, t } from '../core/i18n';
import { useStore } from '../core/store';
import { navigate, tabsStore } from '../core/tabs';
import { openOverlay } from '../core/ui';
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

  const native = apps.filter((a) => a.surface === 'native');
  const pinnedBrowser = apps.filter((a) => a.surface === 'browser' && prefs?.pinnedApps.includes(a.id));
  const work = native.filter((a) => a.sidebar === 'work');
  const business = [...native.filter((a) => a.sidebar === 'business'), ...pinnedBrowser];

  const badge = (a: AppDefinition): number => {
    if (!status || !a.badge) return 0;
    return status.unread[a.badge] ?? 0;
  };

  const open = (a: AppDefinition) => {
    if (a.surface === 'browser') openOverlay('launcher');
    else navigate(`/${a.id}`);
  };

  return (
    <nav
      aria-label="Apps"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cx('flex shrink-0 flex-col bg-navy pb-3 text-navy-ink transition-[width] duration-150', collapsed ? 'w-[64px]' : 'w-[220px]')}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pt-2 scroll-thin">
        <ul className="flex flex-col gap-0.5">
          {work.map((a) => (
            <Item key={a.id} a={a} active={activeApp === a.id} collapsed={collapsed} badge={badge(a)} onClick={() => open(a)} />
          ))}
        </ul>
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

function Item({ a, active, collapsed, badge, onClick }: { a: AppDefinition; active: boolean; collapsed: boolean; badge: number; onClick: () => void }) {
  const label = appLabel(a);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? label : undefined}
        className={cx(
          'relative flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium transition-colors',
          active ? 'bg-primary text-white' : 'hover:bg-white/8 hover:text-white',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon name={a.icon} size={19} />
        {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
        {!collapsed && a.surface === 'browser' ? <Icon name="external" size={13} className="opacity-60" /> : null}
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
