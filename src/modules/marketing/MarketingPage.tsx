import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Spinner } from '../../components/ui';
import { useTab, useTabTitle } from '../../core/tab-context';
import type { ModuleProps } from '../registry';
import { fetchCampaign, MK, type CampaignStatus } from './api';
import { MarketingNav, SECTIONS, type Section } from './Nav';
import { useMarketingOrg } from './org';
import { Refused } from './parts';

/**
 * Marketing (WS-MKT-SRS-001 v1.1; design "WorkSuite Marketing — Modern UI", DK01–DK14 and D01). Addressed
 * `/marketing/<section>`, as the web's own pages are, so the web's links land on the same screen (shared/links):
 *
 *   /marketing                                DK01 dashboard with the go-live readiness panel
 *   /marketing/contacts[/<id>]                DK02 contacts with the bulk bar · DK03 contact, timeline and ledger
 *   /marketing/organisations[/<id>]           organisations and their contacts
 *   /marketing/lists[/<id>]                   static lists and their members
 *   /marketing/segments[/<id>|/new]           segments · DK04 the segment builder
 *   /marketing/import                         DK05 CSV import with its preview
 *   /marketing/consent[?tab=]                 DK12 suppression, consent ledger, do-not-call, topics
 *   /marketing/campaigns                      DK06 campaigns by state
 *   /marketing/campaigns/new                  a campaign's setup, before it exists
 *   /marketing/campaigns/<id>                 the campaign where it stands: a draft's editor, else review or report
 *   /marketing/campaigns/<id>/content|setup   DK07 the editor (Setup · Content)
 *   /marketing/campaigns/<id>/review          DK08 review & send
 *   /marketing/campaigns/<id>/report          DK09 the campaign report
 *   /marketing/templates · /topics            saved templates · topics and the preference centre
 *   /marketing/calls[/<id>|/new|/<id>/edit]   call campaigns · DK10 the supervisor's view
 *   /marketing/queue[?next=1]                 DK11 the agent's workspace (D01: the call-queue tab)
 *   /marketing/scripts[/<id>|/new]            versioned call scripts
 *   /marketing/reports · /automation          reports · DK14 automation (planned)
 *   /marketing/settings[/<tab>]               DK13 settings
 */
const Dashboard = lazy(() => import('./audience/Dashboard'));
const Contacts = lazy(() => import('./audience/Contacts'));
const ContactDetail = lazy(() => import('./audience/ContactDetail'));
const Organisations = lazy(() => import('./audience/Organisations'));
const Lists = lazy(() => import('./audience/Lists'));
const Segments = lazy(() => import('./audience/Segments'));
const SegmentBuilder = lazy(() => import('./audience/SegmentBuilder'));
const Import = lazy(() => import('./audience/Import'));
const Consent = lazy(() => import('./consent/Consent'));
const Topics = lazy(() => import('./consent/Topics'));
const Campaigns = lazy(() => import('./email/Campaigns'));
const NewCampaign = lazy(() => import('./email/NewCampaign'));
const Editor = lazy(() => import('./email/Editor'));
const ReviewSend = lazy(() => import('./email/ReviewSend'));
const Report = lazy(() => import('./email/Report'));
const Templates = lazy(() => import('./email/Templates'));
const CallCampaigns = lazy(() => import('./calls/CallCampaigns'));
const CallCampaign = lazy(() => import('./calls/CallCampaign'));
const CallCampaignEditor = lazy(() => import('./calls/CallCampaignEditor'));
const Queue = lazy(() => import('./calls/Queue'));
const Scripts = lazy(() => import('./calls/Scripts'));
const Reports = lazy(() => import('./admin/Reports'));
const Automation = lazy(() => import('./admin/Automation'));
const Settings = lazy(() => import('./admin/Settings'));

const TITLES: Record<Section, string> = {
  dashboard: 'Marketing',
  contacts: 'Contacts',
  organisations: 'Organisations',
  lists: 'Lists',
  segments: 'Segments',
  import: 'Import contacts',
  consent: 'Consent & suppression',
  campaigns: 'Email campaigns',
  templates: 'Templates',
  topics: 'Topics & preferences',
  calls: 'Call campaigns',
  queue: 'My call queue',
  scripts: 'Scripts',
  reports: 'Reports',
  automation: 'Automation',
  settings: 'Marketing settings',
};

/** `/marketing/<x>` → the rail's section. */
export function sectionOf(path: readonly string[]): Section {
  const s = path[1] ?? 'dashboard';
  if (s === '' || s === 'dashboard') return 'dashboard';
  return (SECTIONS as readonly string[]).includes(s) ? (s as Section) : 'dashboard';
}

const isId = (s: string | undefined): s is string => !!s && /^\d+$/.test(s);

export default function MarketingPage(_props: ModuleProps) {
  const { path, go } = useTab();
  const section = sectionOf(path);
  const sub = path[2];
  const sub2 = path[3];
  useTabTitle(TITLES[section]);
  const pick = (s: Section) => go(s === 'dashboard' ? '/marketing' : `/marketing/${s}`);

  // The editor (DK07) has the window to itself, as in the design: the campaign is the whole screen.
  const editing = section === 'campaigns' && isId(sub) && (sub2 === 'content' || sub2 === 'setup');
  if (editing) {
    return (
      <main className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-ground">
        <Suspense fallback={<Spinner />}>
          <Editor id={Number(sub)} step={sub2 === 'setup' ? 'setup' : 'content'} />
        </Suspense>
      </main>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <MarketingNav section={section} onPick={pick} onNewCampaign={() => go('/marketing/campaigns/new')} />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-ground">
        <Suspense fallback={<Spinner />}>
          {section === 'dashboard' ? (
            <Dashboard />
          ) : section === 'contacts' ? (
            isId(sub) ? <ContactDetail id={Number(sub)} /> : <Contacts />
          ) : section === 'organisations' ? (
            <Organisations id={isId(sub) ? Number(sub) : null} />
          ) : section === 'lists' ? (
            <Lists id={isId(sub) ? Number(sub) : null} />
          ) : section === 'segments' ? (
            sub === 'new' ? <SegmentBuilder id={null} /> : isId(sub) ? <SegmentBuilder id={Number(sub)} /> : <Segments />
          ) : section === 'import' ? (
            <Import />
          ) : section === 'consent' ? (
            <Consent />
          ) : section === 'campaigns' ? (
            sub === 'new' ? (
              <NewCampaign />
            ) : isId(sub) && sub2 === 'review' ? (
              <ReviewSend id={Number(sub)} />
            ) : isId(sub) && sub2 === 'report' ? (
              <Report id={Number(sub)} />
            ) : isId(sub) ? (
              <CampaignOpen id={Number(sub)} />
            ) : (
              <Campaigns />
            )
          ) : section === 'templates' ? (
            <Templates />
          ) : section === 'topics' ? (
            <Topics />
          ) : section === 'calls' ? (
            sub === 'new' ? <CallCampaignEditor id={null} /> : isId(sub) && sub2 === 'edit' ? <CallCampaignEditor id={Number(sub)} /> : isId(sub) ? <CallCampaign id={Number(sub)} /> : <CallCampaigns />
          ) : section === 'queue' ? (
            <Queue />
          ) : section === 'scripts' ? (
            <Scripts id={sub === 'new' ? 'new' : isId(sub) ? Number(sub) : null} />
          ) : section === 'reports' ? (
            <Reports />
          ) : section === 'automation' ? (
            <Automation />
          ) : (
            <Settings tab={sub ?? null} />
          )}
        </Suspense>
      </main>
    </div>
  );
}

/** Where a campaign opens when a link names only the campaign (a notification, a deep link): by its state (§6.1). */
export function campaignRoute(id: number, status: CampaignStatus): string {
  if (status === 'draft') return `/marketing/campaigns/${id}/content`;
  if (status === 'scheduled') return `/marketing/campaigns/${id}/review`;
  return `/marketing/campaigns/${id}/report`;
}

function CampaignOpen({ id }: { id: number }) {
  const { go } = useTab();
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.campaign(org, id), queryFn: ({ signal }) => fetchCampaign(id, signal) });
  const status = q.data?.status;
  useEffect(() => {
    if (status) go(campaignRoute(id, status));
  }, [go, id, status]);
  if (q.error) return <Refused error={q.error} what="This campaign" onRetry={() => void q.refetch()} />;
  return <Spinner />;
}
