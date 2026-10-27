import { lazy, Suspense } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { useOrgSelection } from '../../core/org-prefs';
import { Spinner } from '../../components/ui';
import { SidePanel } from '../../components/SidePanel';
import type { ModuleProps } from '../registry';
import { mayAny, useOptions, usePulse } from './api';
import { MarketingRail, VIEWS, type MarketingView } from './Rail';
import { FILTER_KEYS, type ConsentTab, type Filter, type Go, type QueueTab } from './routes';
import { useOfflineReadOnly } from '../../core/offline-read';
import { OfflineReadOnlyBanner } from '../../components/OfflineReadOnly';

/**
 * Marketing (WS-MKT-SRS-001 v1.1, the DK01–DK14 designs): the rail, and the
 * screen it points at — the same fourteen screens as the web client, in the
 * WorkSuite Desktop shell.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WEB'S ADDRESSES, SO EVERY LINK LANDS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A server notification, a search hit or a link in an email carries the web
 * client's address — `/marketing?view=campaigns&campaign=12`. Once Marketing is
 * native that address opens in this tab as it is (shared/links.ts), so the
 * shell reads exactly the web's grammar: `view`, `contact`, `segment`,
 * `campaign` and `step`, `call`, `tab`, and the contact list's filters. A path
 * (`/marketing/queue`, what a deep link and the tray use) names the view too,
 * and `claim=<nonce>` — what the global Next contact shortcut sends — takes the
 * next contact in my call queue.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Contacts = lazy(() => import('./Contacts'));
const ContactPage = lazy(() => import('./ContactPage'));
const Companies = lazy(() => import('./Companies'));
const Lists = lazy(() => import('./Lists'));
const Segments = lazy(() => import('./Segments'));
const SegmentBuilder = lazy(() => import('./SegmentBuilder'));
const Import = lazy(() => import('./Import'));
const Consent = lazy(() => import('./Consent'));
const DataQuality = lazy(() => import('./DataQuality'));
const Campaigns = lazy(() => import('./Campaigns'));
const CampaignView = lazy(() => import('./CampaignView'));
const Templates = lazy(() => import('./Templates'));
const Topics = lazy(() => import('./Topics'));
const CallCampaigns = lazy(() => import('./CallCampaigns'));
const CallCampaignView = lazy(() => import('./CallCampaignView'));
const MyQueue = lazy(() => import('./MyQueue'));
const Scripts = lazy(() => import('./Scripts'));
const Reports = lazy(() => import('./Reports'));
const Automation = lazy(() => import('./Automation'));
const Forms = lazy(() => import('./Forms'));
const Scoring = lazy(() => import('./Scoring'));
const Settings = lazy(() => import('./Settings'));
const Deliverability = lazy(() => import('./Deliverability'));
/* WS-D */
const Channels = lazy(() => import('./Channels'));
const Analytics = lazy(() => import('./Analytics'));
const MarketingCalendar = lazy(() => import('./Planning').then((m) => ({ default: m.MarketingCalendar })));
const Budgets = lazy(() => import('./Planning').then((m) => ({ default: m.Budgets })));
const Webhooks = lazy(() => import('./Webhooks'));

const TITLES: Record<MarketingView, string> = {
  quality: 'Data quality',
  dashboard: 'Dashboard', contacts: 'Contacts', companies: 'Organisations', lists: 'Lists', segments: 'Segments', import: 'Import',
  consent: 'Consent & suppression', campaigns: 'Campaigns', templates: 'Templates', topics: 'Topics & preferences',
  calls: 'Call campaigns', queue: 'My call queue', scripts: 'Scripts', reports: 'Reports', automation: 'Journeys', settings: 'Settings', forms: 'Forms & pages', scoring: 'Lead scoring',
  deliverability: 'Deliverability',
  channels: 'WhatsApp & SMS', analytics: 'Analytics', calendar: 'Calendar', budgets: 'Budgets & ROI', webhooks: 'Webhooks',
};

/** Older addresses, still followed: a link in a notification or a bookmark outlives the screen it named. */
const ALIASES: Record<string, [MarketingView, string | null]> = { suppression: ['consent', 'suppression'], callbacks: ['queue', 'callbacks'] };

const CONSENT_TABS: ConsentTab[] = ['suppression', 'ledger', 'dnc', 'topics'];
const QUEUE_TABS: QueueTab[] = ['queue', 'callbacks', 'work'];
const CONTACT_HOSTS: MarketingView[] = ['contacts', 'consent', 'queue', 'dashboard', 'quality'];
const QUALITY_TABS = ['duplicates', 'merges', 'fields'] as const;
type QualityTab = (typeof QUALITY_TABS)[number];

const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default function MarketingShell(_props: ModuleProps) {
  const { path, query, go } = useTab();
  // Offline (D-G14): read-only from this computer's copy; a new campaign waits for the connection.
  const { readOnly } = useOfflineReadOnly('marketing');
  const pulseAll = useOptions('');
  const known = (pulseAll.data?.companies ?? []).map((c) => String(c.id));
  const [orgIds, setOrgIds] = useOrgSelection('marketing', known, []);
  const org = orgIds.join(',');
  const options = useOptions(org);
  const pulse = usePulse(org, options.isSuccess);
  const o = options.data;

  const asked = query.get('view') ?? path[1] ?? '';
  const [aliasView, aliasTab] = ALIASES[asked] ?? [null, null];
  const may = {
    dashboard: mayAny(o, 'dashboard'),
    import: mayAny(o, 'import'),
    campaigns: mayAny(o, 'campaigns'),
    create: mayAny(o, 'campaign_create'),
    calls: mayAny(o, 'calls'),
    callMake: mayAny(o, 'call_make'),
    scripts: mayAny(o, 'call_manage') || mayAny(o, 'call_make'),
    reports: mayAny(o, 'analytics') || mayAny(o, 'calls'),
    settings: mayAny(o, 'settings'),
    channels: mayAny(o, 'channels'),
    analytics: mayAny(o, 'analytics'),
    budgets: mayAny(o, 'budgets'),
    webhooks: mayAny(o, 'webhooks'),
  };
  const fallback: MarketingView = may.dashboard || options.isLoading ? 'dashboard' : 'contacts';
  const view: MarketingView = aliasView ?? (VIEWS.has(asked as MarketingView) ? (asked as MarketingView) : fallback);
  const tab = query.get('tab') ?? aliasTab;
  const contact = num(query.get('contact'));
  const campaign = num(query.get('campaign'));
  const call = num(query.get('call'));
  const segment = query.get('segment');
  const claim = query.get('claim');
  const consentTab: ConsentTab = CONSENT_TABS.includes(tab as ConsentTab) ? (tab as ConsentTab) : 'suppression';
  const queueTab: QueueTab = claim ? 'work' : QUEUE_TABS.includes(tab as QueueTab) ? (tab as QueueTab) : 'queue';
  const filter: Filter = Object.fromEntries(FILTER_KEYS.filter((k) => query.get(k)).map((k) => [k, query.get(k) as string]));
  useTabTitle(`Marketing · ${contact && CONTACT_HOSTS.includes(view) ? 'Contact' : TITLES[view]}`);

  /** An address in the web's grammar: the view, then what is open over it. */
  const to = (v: MarketingView, extra: Record<string, string | number | null | undefined> = {}) => {
    const q = new URLSearchParams({ view: v });
    for (const [k, val] of Object.entries(extra)) if (val !== null && val !== undefined && val !== '') q.set(k, String(val));
    return `/marketing?${q.toString()}`;
  };
  /** This address with one key set or cleared, the rest kept: a contact opened over the filtered list comes back to that list. */
  const setKey = (k: string, v: string | number | null) => {
    const q = new URLSearchParams(query);
    if (!q.get('view')) q.set('view', view);
    if (v === null || v === '') q.delete(k);
    else q.set(k, String(v));
    go(`/marketing?${q.toString()}`);
  };
  const onGo = (g: Go) => {
    if (g.view === 'contacts') go(to('contacts', g.filter ?? {}));
    else if (g.view === 'campaign') go(to('campaigns', { campaign: g.id, step: g.step }));
    else go(to(g.view));
  };
  const setFilter = (f: Filter) => {
    const q = new URLSearchParams(query);
    FILTER_KEYS.forEach((k) => q.delete(k));
    Object.entries(f).forEach(([k, v]) => v && q.set(k, v));
    q.set('view', 'contacts');
    go(`/marketing?${q.toString()}`);
  };

  if (options.isError || pulseAll.isError) {
    return (
      <main className="grid h-full place-items-center bg-ground p-6 text-center">
        <div className="max-w-sm">
          <p className="m-0 text-[14px] font-bold text-ink">Marketing is not open to you.</p>
          <p className="m-0 mt-1 text-[12.5px] text-ink-3">{(options.error ?? pulseAll.error)?.message || 'It may be switched off, or your role may not include it. An administrator can change either.'}</p>
        </div>
      </main>
    );
  }

  const screen = () => {
    if (!o) return <Spinner />;
    if (contact && CONTACT_HOSTS.includes(view)) {
      return <ContactPage key={contact} id={contact} options={o} onBack={() => setKey('contact', null)} onOpen={(id) => setKey('contact', id)} onCampaign={(id) => go(to('campaigns', { campaign: id }))} />;
    }
    switch (view) {
      case 'dashboard': return <Dashboard org={org} options={o} onGo={onGo} />;
      case 'contacts': return <Contacts org={org} options={o} filter={filter} onFilter={setFilter} onOpen={(id) => setKey('contact', id)} />;
      case 'companies': return <Companies org={org} options={o} onContacts={(id) => go(to('contacts', { company: id }))} onOpenContact={(id) => go(to('contacts', { contact: id }))} />;
      case 'quality': {
        const qt: QualityTab = (QUALITY_TABS as readonly string[]).includes(tab ?? '') ? (tab as QualityTab) : 'duplicates';
        return <DataQuality org={org} options={o} tab={qt} onTab={(t) => setKey('tab', t)} onContact={(id) => go(to('quality', { tab: qt, contact: id }))} />;
      }
      case 'lists': return <Lists org={org} options={o} onContacts={(id) => go(to('contacts', { list: id }))} />;
      case 'segments':
        return segment
          ? <SegmentBuilder key={segment} id={num(segment)} org={org} options={o} onBack={() => setKey('segment', null)} onSaved={(id) => setKey('segment', id)} onList={(id) => go(to('contacts', { list: id }))} />
          : <Segments org={org} options={o} onContacts={(id) => go(to('contacts', { segment: id }))} onEdit={(id) => setKey('segment', id)} />;
      case 'import': return <Import org={org} options={o} />;
      case 'consent': return <Consent org={org} options={o} tab={consentTab} onTab={(t) => setKey('tab', t)} onContact={(id) => go(to('consent', { tab: consentTab, contact: id }))}
        onCampaign={(id) => go(to('campaigns', { campaign: id, step: 'setup' }))} />;
      case 'campaigns':
        return campaign
          ? <CampaignView key={campaign} id={campaign} options={o} step={query.get('step')} onStep={(s) => setKey('step', s)} onBack={() => go(to('campaigns'))} onOpen={(id) => go(to('campaigns', { campaign: id }))} />
          : <Campaigns org={org} options={o} onOpen={(id) => go(to('campaigns', { campaign: id }))} creating={query.get('new') === '1' && !readOnly} onCreating={(v) => setKey('new', v ? '1' : null)} />;
      case 'templates': return <Templates org={org} options={o} />;
      case 'topics': return <Topics org={org} options={o} />;
      case 'deliverability': return <Deliverability org={org} options={o} />;
      case 'calls':
        return call
          ? <CallCampaignView key={call} id={call} options={o} onBack={() => go(to('calls'))} onQueue={(id) => go(to('queue', { call: id }))} />
          : <CallCampaigns org={org} options={o} onOpen={(id) => go(to('calls', { call: id }))} onQueue={(id) => go(to('queue', { call: id }))} />;
      case 'queue':
        return (
          <MyQueue options={o} campaignId={call} tab={queueTab} claim={claim} onTab={(t) => go(to('queue', { call, tab: t }))}
            onClaimed={() => go(to('queue', { call, tab: 'work' }))} onContact={(id) => go(to('queue', { call, tab: queueTab, contact: id }))}
            onCampaign={(id) => go(to('queue', { call: id, tab: queueTab }))} />
        );
      case 'scripts': return <Scripts options={o} />;
      case 'reports': return <Reports org={org} options={o} onCampaign={(id) => go(to('campaigns', { campaign: id, step: 'report' }))} onCall={(id) => go(to('calls', { call: id }))} onAnalytics={() => go(to('analytics'))} />;
      case 'automation': return <Automation org={org} options={o} journeyId={num(query.get('journey'))} onOpen={(id) => go(to('automation', { journey: id }))} onBack={() => go(to('automation'))} />;
      case 'forms': return <Forms org={org} options={o} />;
      case 'scoring': return <Scoring org={org} options={o} />;
      case 'channels': return <Channels org={org} options={o} />;
      case 'analytics': return <Analytics org={org} options={o} />;
      case 'calendar': return <MarketingCalendar org={org} options={o} />;
      case 'budgets': return <Budgets org={org} options={o} />;
      case 'webhooks': return <Webhooks org={org} options={o} />;
      case 'settings': return <Settings org={org} options={o} section={tab} onSection={(s) => setKey('tab', s)} />;
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="marketing" label="the Marketing menu">
        <MarketingRail
          view={view}
          onPick={(v) => go(to(v))}
          onNewCampaign={() => go(to('campaigns', { new: 1 }))}
          counts={{ contacts: pulse.data?.contacts, sending: pulse.data?.sending.length || undefined, queue: pulse.data?.queue?.waiting || undefined }}
          may={may}
          companies={pulseAll.data?.companies ?? []}
          org={orgIds}
          onOrg={setOrgIds}
          sending={o?.sending}
        />
      </SidePanel>
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-ground px-[22px] py-[18px] scroll-thin">
        <OfflineReadOnlyBanner module="marketing" className="-mx-[22px] -mt-[18px] mb-3 sticky top-[-18px] z-10" />
        <Suspense fallback={<Spinner />}>{screen()}</Suspense>
      </main>
    </div>
  );
}
