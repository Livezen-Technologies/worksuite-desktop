import { Icon } from '../../components/Icon';
import { OrgSwitcher } from '../../components/OrgSwitcher';
import { PrimaryActionButton } from '../../components/PrimaryAction';
import { cx } from '../../components/ui';
import { useDashboard, useQueue } from './api';
import { useMarketingAccess } from './access';
import { count } from './lib/format';
import { setMarketingOrg, useCompanies, useMarketingOrg } from './org';

/**
 * Marketing's module rail (design "Shell · Marketing module rail", 240 px): New campaign, the company, Dashboard,
 * then Audience · Email · Calls · Insights, and at the foot how mail leaves (relay route, priority, pace). One
 * component for every screen, as the design's shared `Shell.dc.html` with its `active` property.
 */
export type Section =
  | 'dashboard'
  | 'contacts'
  | 'organisations'
  | 'lists'
  | 'segments'
  | 'import'
  | 'consent'
  | 'campaigns'
  | 'templates'
  | 'topics'
  | 'calls'
  | 'queue'
  | 'scripts'
  | 'reports'
  | 'automation'
  | 'settings';

type Item = { id: Section; label: string; icon: string };

export const GROUPS: Array<{ head: string | null; items: Item[] }> = [
  { head: null, items: [{ id: 'dashboard', label: 'Dashboard', icon: 'home' }] },
  {
    head: 'Audience',
    items: [
      { id: 'contacts', label: 'Contacts', icon: 'users' },
      { id: 'organisations', label: 'Organisations', icon: 'building' },
      { id: 'lists', label: 'Lists', icon: 'list' },
      { id: 'segments', label: 'Segments', icon: 'filter' },
      { id: 'import', label: 'Import', icon: 'upload' },
      { id: 'consent', label: 'Consent & suppression', icon: 'shield-check' },
    ],
  },
  {
    head: 'Email',
    items: [
      { id: 'campaigns', label: 'Campaigns', icon: 'mail' },
      { id: 'templates', label: 'Templates', icon: 'panel-top' },
      { id: 'topics', label: 'Topics & preferences', icon: 'tag' },
    ],
  },
  {
    head: 'Calls',
    items: [
      { id: 'calls', label: 'Call campaigns', icon: 'phone' },
      { id: 'queue', label: 'My call queue', icon: 'list-todo' },
      { id: 'scripts', label: 'Scripts', icon: 'file-text' },
    ],
  },
  {
    head: 'Insights',
    items: [
      { id: 'reports', label: 'Reports', icon: 'chart' },
      { id: 'automation', label: 'Automation', icon: 'git-branch' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

export const SECTIONS: readonly Section[] = GROUPS.flatMap((g) => g.items.map((i) => i.id));

export function MarketingNav({ section, onPick, onNewCampaign }: { section: Section; onPick: (s: Section) => void; onNewCampaign: () => void }) {
  const access = useMarketingAccess();
  const org = useMarketingOrg();
  const companies = useCompanies();
  const dash = useDashboard();
  const queue = useQueue(access.call);
  const sending = (dash.data?.recent_campaigns ?? []).filter((c) => c.status === 'sending').length;
  const send = dash.data?.sending ?? null;

  const badge = (id: Section): { n: string; tone: 'muted' | 'indigo' } | null => {
    if (id === 'contacts' && dash.data) return { n: count(dash.data.contacts.total), tone: 'muted' };
    if (id === 'campaigns' && sending) return { n: String(sending), tone: 'muted' };
    if (id === 'queue' && queue.data?.waiting) return { n: count(queue.data.waiting), tone: 'indigo' };
    return null;
  };

  return (
    <nav aria-label="Marketing" className="flex w-[240px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-3 pt-3.5 pb-1">
        <PrimaryActionButton label="New campaign" onClick={onNewCampaign} />
        {companies.length > 1 ? (
          <OrgSwitcher variant="field" allowAll={false} label="Company" orgs={companies.map((c) => ({ id: c.id, name: c.name }))} value={org ? [org] : []} onChange={(ids) => ids[0] && setMarketingOrg(ids[0])} />
        ) : companies[0] ? (
          <div className="flex h-8 items-center gap-2 truncate rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink-2">
            <Icon name="building" size={14} className="shrink-0 text-ink-3" />
            <span className="truncate">{companies[0].name}</span>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2 scroll-thin">
        {GROUPS.map((g) => (
          <div key={g.head ?? 'top'} className="flex flex-col">
            {g.head ? <div className="mt-3 flex h-6 shrink-0 items-center px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{g.head}</div> : <div className="h-1" />}
            {g.items.map((it) => {
              const active = it.id === section;
              const b = badge(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onPick(it.id)}
                  className={cx('relative flex h-8 shrink-0 items-center gap-2.5 rounded-[8px] pr-2 pl-2.5 text-left', active ? 'bg-selection font-semibold text-primary' : 'font-medium text-ink-2 hover:bg-subtle hover:text-ink')}
                >
                  <span className={cx('absolute top-[7px] bottom-[7px] left-0 w-[3px] rounded-r-[3px]', active ? 'bg-primary' : 'bg-transparent')} />
                  <Icon name={it.icon} size={16} className={cx('shrink-0', active ? 'text-primary' : 'text-ink-3')} />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.id === 'automation' ? <span className="rounded-full bg-[#F3E8FF] px-1.5 py-px text-[10px] font-bold text-[#6D28D9] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]">Planned</span> : null}
                  {b ? (
                    <span className={cx('rounded-full px-1.5 py-px font-mono text-[10.5px] font-bold tabular-nums', b.tone === 'indigo' ? 'bg-selection text-primary' : 'bg-subtle text-ink-2')}>{b.n}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="m-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[11.5px] leading-snug text-ink-3">
        <b className="block text-[12px] text-ink">{send?.control_plane ? 'Sending via mail control plane' : 'Sending via relay'}</b>
        {send ? `${send.route} · priority ${send.priority} · ${count(send.hourly_pace)}/h. ` : 'Marketing route · below transactional mail. '}
        <button type="button" className="font-semibold text-primary underline" onClick={() => onPick('settings')}>
          Settings
        </button>
      </div>
    </nav>
  );
}
