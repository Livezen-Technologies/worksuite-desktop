import type { MouseEvent } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The Assets rail (D04's sub-navigation): Overview, Movement, Upkeep, Inventory, Governance and Admin. ⌘-click
 * (Ctrl-click) opens a screen in a new tab. Screens a person may not use are left out, not shown greyed.
 */
export type AssetView =
  | 'dashboard' | 'register' | 'asset' | 'new' | 'edit' | 'mine' | 'bookings' | 'scan'
  | 'requests' | 'transfers' | 'maintenance' | 'plans' | 'licences' | 'stock'
  | 'audits' | 'disposals' | 'reports' | 'activity' | 'lookups' | 'import' | 'labels' | 'settings' | 'unfiled';

export const VIEWS = new Set<string>(['dashboard', 'register', 'asset', 'new', 'edit', 'mine', 'bookings', 'scan', 'requests', 'transfers', 'maintenance', 'plans', 'licences', 'stock', 'audits', 'disposals', 'reports', 'activity', 'lookups', 'import', 'labels', 'settings', 'unfiled']);

const UNDER: Partial<Record<AssetView, AssetView>> = { asset: 'register', new: 'register', edit: 'register', unfiled: 'dashboard' };

export interface RailAccess {
  manage: boolean;
  assign: boolean;
  settings: boolean;
  staff: boolean;
}

export function AssetsRail({ view, counts, access, cached, onPick }: {
  view: AssetView;
  counts: Partial<Record<AssetView, number>>;
  access: RailAccess;
  /** "Offline-ready: 184 assets cached" — what this computer keeps. */
  cached?: number | null;
  onPick: (v: AssetView, newTab: boolean) => void;
}) {
  const at = UNDER[view] ?? view;
  const item = (id: AssetView, label: string, icon: string, show = true) => {
    if (!show) return null;
    const on = at === id;
    const n = counts[id];
    return (
      <button
        key={id}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={(e: MouseEvent) => onPick(id, e.metaKey || e.ctrlKey)}
        className={cx('flex h-[30px] shrink-0 items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left', on ? 'bg-[#EEF1FD] font-bold text-[#3B5BDB] dark:bg-selection dark:text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}
      >
        <Icon name={icon} size={15} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {n ? <span className="shrink-0 rounded-[9px] bg-[#EAEDFB] px-1.5 text-[11px] font-bold text-[#23349E] tabular-nums dark:bg-primary/15 dark:text-primary">{n}</span> : null}
      </button>
    );
  };
  const head = (label: string, show = true) => (show ? <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div> : null);
  const s = access.staff;

  return (
    <nav aria-label="Assets" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="px-4 pt-3.5 pb-1 text-[15px] font-extrabold">Assets</div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-1 pb-2.5 scroll-thin">
        {head('Overview')}
        {item('dashboard', 'Dashboard', 'home', s)}
        {item('register', 'All assets', 'list', s)}
        {item('mine', 'My assets', 'user')}
        {item('bookings', 'Bookings', 'calendar')}
        {item('scan', 'Scan station', 'scan', access.assign)}
        {head('Movement')}
        {item('requests', 'Requests', 'inbox')}
        {item('transfers', 'Transfers', 'repeat', s)}
        {head('Upkeep', s)}
        {item('maintenance', 'Maintenance', 'wrench', s)}
        {item('plans', 'Plans', 'calendar-clock', s)}
        {head('Inventory', s)}
        {item('licences', 'Licences', 'key', s)}
        {item('stock', 'Consumables', 'package', s)}
        {head('Governance', s)}
        {item('audits', 'Audits', 'check', s)}
        {item('disposals', 'Disposal', 'trash', s)}
        {item('reports', 'Reports', 'chart', s)}
        {item('activity', 'Activity', 'activity', s)}
        {head('Admin', access.manage || access.settings)}
        {item('lookups', 'Lists & fields', 'tag', access.manage)}
        {item('import', 'Import & export', 'upload', access.manage)}
        {item('labels', 'Labels', 'printer', access.assign || access.manage)}
        {item('settings', 'Settings', 'settings', access.settings || access.manage)}
        {cached ? <div className="mx-1 mt-3 rounded-[8px] bg-[#EFFAF4] px-2.5 py-2 text-[11px] text-[#13734A] dark:bg-success/10 dark:text-success">{`Offline-ready: ${cached} assets cached. Read-only until you reconnect.`}</div> : null}
      </div>
      <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Open in new tab · ⌘-click</div>
    </nav>
  );
}
