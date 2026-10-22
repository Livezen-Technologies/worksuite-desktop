import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { OrgSwitcher } from '../../components/OrgSwitcher';
import { PrimaryActionButton } from '../../components/PrimaryAction';
import { Planned } from './parts';
import type { Sending } from './types';

/**
 * The Marketing rail (the SRS's §19 design, the same as the web's): New
 * campaign, the organisation filter, and four sections — Audience, Email,
 * Calls, Insights — with the counts that matter (contacts, campaigns sending
 * now, contacts waiting in my call queue). "Sending via relay" sits at its foot
 * so where bulk mail leaves is never a mystery.
 */
export type MarketingView =
  | 'dashboard' | 'contacts' | 'companies' | 'lists' | 'segments' | 'import' | 'consent' | 'quality'
  | 'campaigns' | 'templates' | 'topics' | 'calls' | 'queue' | 'scripts' | 'reports' | 'automation' | 'settings' | 'deliverability' | 'forms' | 'scoring'
  /* WS-D */
  | 'channels' | 'analytics' | 'calendar' | 'budgets' | 'webhooks';

export const VIEWS = new Set<MarketingView>([
  'dashboard', 'contacts', 'companies', 'lists', 'segments', 'import', 'consent', 'quality',
  'campaigns', 'templates', 'topics', 'calls', 'queue', 'scripts', 'reports', 'automation', 'settings', 'deliverability', 'forms', 'scoring',
  'channels', 'analytics', 'calendar', 'budgets', 'webhooks',
]);

interface Item {
  id: MarketingView;
  label: string;
  icon: string;
  badge?: number;
  planned?: boolean;
}

export interface RailCounts {
  contacts?: number;
  sending?: number;
  queue?: number;
}

export interface RailMay {
  dashboard: boolean;
  import: boolean;
  campaigns: boolean;
  create: boolean;
  calls: boolean;
  callMake: boolean;
  scripts: boolean;
  reports: boolean;
  settings: boolean;
  /* WS-D. Optional: absent is "may not". */
  channels?: boolean;
  analytics?: boolean;
  budgets?: boolean;
  webhooks?: boolean;
}

export function MarketingRail({ view, onPick, onNewCampaign, counts, may, companies, org, onOrg, sending }: {
  view: MarketingView;
  onPick: (v: MarketingView) => void;
  onNewCampaign: () => void;
  counts: RailCounts;
  may: RailMay;
  companies: Array<{ id: number; name: string }>;
  org: string[];
  onOrg: (ids: string[]) => void;
  sending: Sending | undefined;
}) {
  const sections: Array<{ label: string | null; items: Item[] }> = [
    { label: null, items: may.dashboard ? [{ id: 'dashboard', label: 'Dashboard', icon: 'home' }] : [] },
    {
      label: 'Audience',
      items: [
        { id: 'contacts', label: 'Contacts', icon: 'users', badge: counts.contacts },
        { id: 'companies', label: 'Organisations', icon: 'building' },
        { id: 'lists', label: 'Lists', icon: 'list' },
        { id: 'segments', label: 'Segments', icon: 'filter' },
        ...(may.import ? [{ id: 'import' as const, label: 'Import', icon: 'upload' }] : []),
        { id: 'consent', label: 'Consent & suppression', icon: 'shield-check' },
        { id: 'quality', label: 'Data quality', icon: 'grid' },
      ],
    },
    {
      label: may.campaigns ? 'Email' : null,
      items: may.campaigns
        ? [
          { id: 'campaigns', label: 'Campaigns', icon: 'mail', badge: counts.sending },
          { id: 'templates', label: 'Templates', icon: 'file-text' },
          { id: 'topics', label: 'Topics & preferences', icon: 'tag' },
          { id: 'deliverability', label: 'Deliverability', icon: 'check-circle' },
        ]
        : [],
    },
    {
      label: may.channels || may.analytics ? 'WhatsApp & SMS' : null,
      items: may.channels || may.analytics ? [{ id: 'channels' as const, label: 'Campaigns', icon: 'message-circle' }] : [],
    },
    {
      label: may.calls || may.callMake ? 'Calls' : null,
      items: [
        ...(may.calls ? [{ id: 'calls' as const, label: 'Call campaigns', icon: 'phone' }] : []),
        ...(may.callMake ? [{ id: 'queue' as const, label: 'My call queue', icon: 'list-todo', badge: counts.queue }] : []),
        ...(may.scripts ? [{ id: 'scripts' as const, label: 'Scripts', icon: 'file-text' }] : []),
      ],
    },
    {
      label: 'Insights',
      items: [
        ...(may.reports ? [{ id: 'reports' as const, label: 'Reports', icon: 'trending-up' }] : []),
        ...(may.analytics ? [{ id: 'analytics' as const, label: 'Analytics', icon: 'chart' }] : []),
        { id: 'calendar', label: 'Calendar', icon: 'calendar' },
        ...(may.budgets || may.analytics ? [{ id: 'budgets' as const, label: 'Budgets & ROI', icon: 'banknote' }] : []),
        /* WS-C: automation is real — journeys, forms and pages, lead scoring. */
        { id: 'automation', label: 'Journeys', icon: 'zap' },
        { id: 'forms', label: 'Forms & pages', icon: 'file-text' },
        { id: 'scoring', label: 'Lead scoring', icon: 'star' },
        ...(may.webhooks ? [{ id: 'webhooks' as const, label: 'Webhooks', icon: 'zap' }] : []),
        ...(may.settings ? [{ id: 'settings' as const, label: 'Settings', icon: 'settings' }] : []),
      ],
    },
  ];

  const item = (i: Item) => {
    const on = i.id === view;
    return (
      <button
        key={i.id}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick(i.id)}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={i.icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{i.label}</span>
        {i.planned ? <Planned /> : null}
        {i.badge ? (
          <span className={cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums', on ? 'bg-surface text-primary' : 'bg-selection text-primary')}>{i.badge.toLocaleString()}</span>
        ) : null}
      </button>
    );
  };

  return (
    <nav aria-label="Marketing" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        {may.create ? <PrimaryActionButton label="New campaign" onClick={onNewCampaign} /> : null}
        {companies.length > 1 ? (
          <OrgSwitcher variant="field" orgs={companies.map((c) => ({ id: String(c.id), name: c.name }))} value={org} onChange={onOrg} />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {sections
          .filter((s) => s.items.length > 0)
          .map((s) => (
            <div key={s.label ?? 'top'} className="flex flex-col">
              {s.label ? <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{s.label}</div> : null}
              {s.items.map(item)}
            </div>
          ))}
      </div>
      {sending ? (
        <div className="m-2.5 rounded-[9px] border border-line bg-surface p-2.5 text-[11.5px] leading-snug text-ink-2">
          <b className="block text-ink">{sending.route === 'none' ? 'No mail route yet' : 'Sending via relay'}</b>
          {sending.route_label} · priority {sending.priority} · {sending.pace.toLocaleString()}/h.{' '}
          {may.settings ? (
            <button type="button" onClick={() => onPick('settings')} className="font-bold text-primary hover:underline">
              Settings
            </button>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
