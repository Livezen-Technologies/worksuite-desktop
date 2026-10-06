import { lazy, Suspense } from 'react';
import { Spinner } from '../../components/ui';
import { useTab, useTabTitle } from '../../core/tab-context';
import type { ModuleProps } from '../registry';
import { usePhoneAccess } from './access';
import { PhoneNav, SECTIONS, visibleSections, type Section } from './Nav';
import { NotOffered } from './parts';

/**
 * Phone (WS-VOIP-SRS-001; design "WorkSuite Phone (VoIP) — Modern UI", 23 artboards). Addressed `/phone/<section>`:
 *
 *   /phone                 W01 dial pad & recents — or W02 the call in progress
 *   /phone/calls[/<id>]    W04 history, W05 call detail
 *   /phone/voicemail       W06        /phone/forwarding  W07
 *   /phone/live            A01        /phone/reports     A10        /phone/recordings  A11
 *   /phone/extensions      A02, A03   /phone/servers[/<id>|/new]  A04, A05
 *   /phone/trunks          A06        /phone/inbound     A07        /phone/queues      A08
 *   /phone/dialplan        A09        /phone/settings    A12        /phone/setup       the cloud FreePBX wizard
 *   /phone/compact         D01, the compact always-on-top window
 *
 * The web's `/voip` and `/phone` links land here (shared/links).
 */
const Dialer = lazy(() => import('./screens/Dialer'));
const History = lazy(() => import('./screens/History'));
const CallDetail = lazy(() => import('./screens/CallDetail'));
const Voicemail = lazy(() => import('./screens/Voicemail'));
const Forwarding = lazy(() => import('./screens/Forwarding'));
const LiveBoard = lazy(() => import('./admin/LiveBoard'));
const Reports = lazy(() => import('./admin/Reports'));
const Recordings = lazy(() => import('./admin/Recordings'));
const Extensions = lazy(() => import('./admin/Extensions'));
const Servers = lazy(() => import('./admin/Servers'));
const ServerEditor = lazy(() => import('./admin/ServerEditor'));
const Trunks = lazy(() => import('./admin/Trunks'));
const Inbound = lazy(() => import('./admin/Inbound'));
const Queues = lazy(() => import('./admin/Queues'));
const DialPlan = lazy(() => import('./admin/DialPlan'));
const Settings = lazy(() => import('./admin/Settings'));
const SetupWizard = lazy(() => import('./admin/SetupWizard'));
const CompactPhone = lazy(() => import('./CompactPhone'));

const TITLES: Record<Section, string> = {
  dial: 'Phone',
  calls: 'Calls',
  voicemail: 'Voicemail',
  forwarding: 'Forwarding & DND',
  live: 'Live board',
  reports: 'Call reports',
  recordings: 'Recordings',
  extensions: 'Extensions',
  servers: 'PBX servers',
  trunks: 'Trunks & routes',
  inbound: 'Inbound & IVR',
  queues: 'Queues & ring groups',
  dialplan: 'Dial plan',
  settings: 'Telephony settings',
};

/** `/phone/<x>` → the section it belongs to. */
export function sectionOf(path: readonly string[]): Section {
  const s = path[1] ?? 'dial';
  if (s === 'call' || s === '' || s === 'dial') return 'dial';
  if (s === 'setup') return 'servers';
  return (SECTIONS as readonly string[]).includes(s) ? (s as Section) : 'dial';
}

export default function PhonePage(_props: ModuleProps) {
  const { path, go } = useTab();
  const access = usePhoneAccess();
  const section = sectionOf(path);
  const allowed = visibleSections(access).includes(section);
  useTabTitle(TITLES[section]);
  if (path[1] === 'compact') {
    return (
      <Suspense fallback={<Spinner />}>
        <CompactPhone />
      </Suspense>
    );
  }
  const sub = path[2] ?? null;
  const pick = (s: Section) => go(s === 'dial' ? '/phone' : `/phone/${s}`);
  return (
    <div className="flex h-full min-h-0">
      <PhoneNav section={section} onPick={pick} />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-ground">
        <Suspense fallback={<Spinner />}>
          {!allowed ? (
            <NotAllowed />
          ) : section === 'dial' ? (
            <Dialer />
          ) : section === 'calls' ? (
            sub && /^\d+$/.test(sub) ? <CallDetail id={Number(sub)} /> : <History />
          ) : section === 'voicemail' ? (
            <Voicemail />
          ) : section === 'forwarding' ? (
            <Forwarding />
          ) : section === 'live' ? (
            <LiveBoard />
          ) : section === 'reports' ? (
            <Reports />
          ) : section === 'recordings' ? (
            <Recordings />
          ) : section === 'extensions' ? (
            <Extensions />
          ) : section === 'servers' ? (
            path[1] === 'setup' ? <SetupWizard /> : sub === 'new' ? <ServerEditor id={null} /> : sub && /^\d+$/.test(sub) ? <ServerEditor id={Number(sub)} /> : <Servers />
          ) : section === 'trunks' ? (
            <Trunks />
          ) : section === 'inbound' ? (
            <Inbound />
          ) : section === 'queues' ? (
            <Queues />
          ) : section === 'dialplan' ? (
            <DialPlan />
          ) : section === 'settings' ? (
            <Settings />
          ) : (
            <NotOffered what="This screen" />
          )}
        </Suspense>
      </main>
    </div>
  );
}

function NotAllowed() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <div className="text-[15px] font-bold text-ink">You don’t have access to this part of the Phone</div>
        <p className="mt-1 text-[12.5px] text-ink-3">Supervising needs voip.reports or voip.supervise; administering needs voip.manage. Ask your administrator.</p>
      </div>
    </div>
  );
}
