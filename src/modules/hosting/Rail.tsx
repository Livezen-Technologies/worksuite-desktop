import type { MouseEvent } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * Hosting's 88 px module rail (HDM-DSK-02, the DModRail board): Overview, Domains, Expiring, DNS, Certificates,
 * Servers, Monitors, Costs, Accounts and Sync history, icon over label, with counts. ⌘-click (Ctrl-click) opens a
 * screen in a new tab.
 */
export type HostingView = 'overview' | 'domains' | 'expiring' | 'dns' | 'certificates' | 'servers' | 'monitors' | 'costs' | 'accounts' | 'history' | 'domain' | 'server' | 'new';

export const RAIL: Array<{ id: HostingView; label: string; icon: string; key: string }> = [
  { id: 'overview', label: 'Overview', icon: 'grid', key: '1' },
  { id: 'domains', label: 'Domains', icon: 'globe', key: '2' },
  { id: 'expiring', label: 'Expiring', icon: 'hourglass', key: '3' },
  { id: 'dns', label: 'DNS', icon: 'list', key: '4' },
  { id: 'certificates', label: 'Certificates', icon: 'lock', key: '5' },
  { id: 'servers', label: 'Servers', icon: 'server', key: '6' },
  { id: 'monitors', label: 'Monitors', icon: 'activity', key: '7' },
  { id: 'costs', label: 'Costs', icon: 'wallet', key: '8' },
  { id: 'accounts', label: 'Accounts', icon: 'key', key: '9' },
  { id: 'history', label: 'Sync history', icon: 'history', key: '0' },
];

export const VIEWS = new Set<string>([...RAIL.map((r) => r.id), 'domain', 'server', 'new']);
const UNDER: Partial<Record<HostingView, HostingView>> = { domain: 'domains', server: 'servers', new: 'domains' };

export function HostingRail({ view, counts, onPick }: { view: HostingView; counts: Partial<Record<HostingView, number>>; onPick: (v: HostingView, newTab: boolean) => void }) {
  const at = UNDER[view] ?? view;
  return (
    <nav aria-label="Hosting" className="flex w-[88px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-[#FBFBFD] px-1.5 py-2 scroll-thin dark:bg-surface">
      {RAIL.map((r) => {
        const on = r.id === at;
        const n = counts[r.id];
        return (
          <button
            key={r.id}
            type="button"
            aria-current={on ? 'page' : undefined}
            title={r.label}
            onClick={(e: MouseEvent) => onPick(r.id, e.metaKey || e.ctrlKey)}
            className={cx('relative flex flex-col items-center gap-1 rounded-[10px] px-0.5 py-2 text-center text-[10.5px] leading-tight', on ? 'bg-[#E6F6F9] font-semibold text-[#0E7490] dark:bg-[#0891B2]/20 dark:text-[#67D4EA]' : 'text-ink-2 hover:bg-subtle')}
          >
            <Icon name={r.icon} size={18} className={on ? 'text-[#0891B2] dark:text-[#67D4EA]' : 'text-ink-3'} />
            <span className="max-w-full truncate">{r.label}</span>
            {n ? <span className="absolute top-1 right-2 min-w-[16px] rounded-full bg-[#B42318] px-1 text-[10px] font-bold text-white tabular-nums">{n > 99 ? '99+' : n}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
