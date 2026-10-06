import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { dataOf, rowsOf, useAccounts, useBrands, useModuleStatus } from './api';
import type { SocialAccess } from './access';
import { needsAttention } from './lib/status';

/**
 * The module rail (design "Shared module rail", Shell.dc.html): 240 px, "Social Media" and Create post on top, then
 * Publish · Engage · Plan · Administer, the same on the web and in WorkSuite Desktop (SMM-DSK-001). Sections someone
 * cannot use are left out (§14); the foot counts the accounts and brands they can see.
 */
export type Section = 'overview' | 'compose' | 'calendar' | 'queue' | 'approvals' | 'inbox' | 'analytics' | 'library' | 'campaigns' | 'accounts' | 'log' | 'settings';

type Item = { id: Section; label: string; icon: string; need: (a: SocialAccess) => boolean };

const GROUPS: Array<{ head: string; items: Item[] }> = [
  {
    head: 'Publish',
    items: [
      { id: 'overview', label: 'Overview', icon: 'grid', need: (a) => a.view },
      { id: 'compose', label: 'Compose', icon: 'plus', need: (a) => a.create },
      { id: 'calendar', label: 'Calendar', icon: 'calendar', need: (a) => a.view },
      { id: 'queue', label: 'Queue & slots', icon: 'list', need: (a) => a.publish },
      { id: 'approvals', label: 'Approvals', icon: 'check', need: (a) => a.create || a.approve },
    ],
  },
  {
    head: 'Engage',
    items: [
      { id: 'inbox', label: 'Inbox', icon: 'inbox', need: (a) => a.inbox },
      { id: 'analytics', label: 'Analytics', icon: 'chart', need: (a) => a.analytics },
    ],
  },
  {
    head: 'Plan',
    items: [
      { id: 'library', label: 'Content library', icon: 'image', need: (a) => a.create || a.library },
      { id: 'campaigns', label: 'Campaigns', icon: 'flag', need: (a) => a.view },
    ],
  },
  {
    head: 'Administer',
    items: [
      { id: 'accounts', label: 'Accounts', icon: 'users', need: (a) => a.view },
      { id: 'log', label: 'Publishing log', icon: 'list-todo', need: (a) => a.audit },
      { id: 'settings', label: 'Module settings', icon: 'sliders', need: (a) => a.settings },
    ],
  },
];

export const SECTIONS: readonly Section[] = GROUPS.flatMap((g) => g.items.map((i) => i.id));

export function visibleSections(a: SocialAccess): Section[] {
  return GROUPS.flatMap((g) => g.items.filter((i) => i.need(a)).map((i) => i.id));
}

export const SECTION_TITLE: Record<Section, string> = {
  overview: 'Overview',
  compose: 'Create post',
  calendar: 'Calendar',
  queue: 'Queue & posting slots',
  approvals: 'Approvals',
  inbox: 'Inbox',
  analytics: 'Analytics',
  library: 'Content library',
  campaigns: 'Campaigns',
  accounts: 'Accounts',
  log: 'Publishing log',
  settings: 'Module settings',
};

const BADGE = {
  new: 'bg-primary text-white',
  warn: 'bg-warning-bg text-warning',
  muted: 'bg-subtle text-ink-2',
} as const;

export function SocialNav({ section, onPick, access }: { section: Section; onPick: (s: Section) => void; access: SocialAccess }) {
  const status = dataOf(useModuleStatus().data);
  const accounts = rowsOf(useAccounts().data);
  const brands = rowsOf(useBrands().data);
  const counts = status?.counts;
  const attention = counts?.accounts_attention ?? accounts.filter((a) => needsAttention(a.status)).length;
  const badgeOf = (id: Section): { n: number; tone: keyof typeof BADGE } | null => {
    if (id === 'approvals' && counts?.approvals_waiting) return { n: counts.approvals_waiting, tone: 'muted' };
    if (id === 'inbox' && counts?.inbox_open) return { n: counts.inbox_open, tone: 'new' };
    if (id === 'accounts' && attention) return { n: attention, tone: 'warn' };
    return null;
  };
  const nAccounts = counts?.accounts ?? accounts.length;
  const nBrands = counts?.brands ?? brands.length;
  const foot = nAccounts || nBrands ? `${nAccounts} account${nAccounts === 1 ? '' : 's'} in ${nBrands} brand${nBrands === 1 ? '' : 's'}` : status ? 'No accounts connected yet' : 'Social Media Manager';

  return (
    <nav aria-label="Social Media" className="flex w-[240px] shrink-0 flex-col overflow-hidden border-r border-line bg-surface text-[13px] text-ink">
      <div className="flex flex-col gap-3 px-3.5 pt-4 pb-2.5">
        <b className="px-1.5 text-[15px]">Social Media</b>
        {access.create ? (
          <button
            type="button"
            onClick={() => onPick('compose')}
            className="flex h-[38px] items-center justify-center gap-2 rounded-[10px] bg-primary text-[13.5px] font-semibold text-white hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ws-focus)]"
            aria-keyshortcuts="Control+N Meta+N"
          >
            <Icon name="plus" size={16} />
            Create post
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2 scroll-thin">
        {GROUPS.map((g) => {
          const items = g.items.filter((i) => i.need(access));
          if (!items.length) return null;
          return (
            <div key={g.head} className="flex flex-col gap-0.5">
              <div className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-[.06em] text-ink-3 uppercase">{g.head}</div>
              {items.map((it) => {
                const active = it.id === section;
                const badge = badgeOf(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onPick(it.id)}
                    className={cx('flex h-[34px] shrink-0 items-center gap-2.5 rounded-[8px] px-2.5 text-left', active ? 'bg-selection font-semibold text-primary' : 'font-medium text-ink-2 hover:bg-subtle hover:text-ink')}
                  >
                    <Icon name={it.icon} size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {badge ? <span className={cx('min-w-[20px] rounded-full px-[7px] py-px text-center text-[11px] font-bold tabular-nums', BADGE[badge.tone])}>{badge.n > 99 ? '99+' : badge.n}</span> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="truncate border-t border-line px-4 py-3 text-[12px] text-ink-3">{foot}</div>
    </nav>
  );
}
