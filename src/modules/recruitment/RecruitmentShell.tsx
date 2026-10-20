import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { SidePanel } from '../../components/SidePanel';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { allowed, dayBounds, fetchApprovals, fetchMyInterviews, K, useMeta } from './api';
import { NATIVE, RecruitmentRail, type RecView } from './Rail';

/**
 * Recruitment on the desktop (gap doc §9.3, D01–D05), addressed as
 * `/recruitment?tab=pipe|review|today|cards|appr`:
 * - `&job=<id>` the job on the pipeline and the review queue;
 * - `&interview=<id>` the interview whose scorecard is open (D04); `&solo=1` that scorecard alone, in a window of its
 *   own beside the Meet call.
 * The notifications' `recruitment.*` keys land here (shared/recruitment.ts). The rest of Recruitment opens on the web.
 */
const Pipeline = lazy(() => import('./Pipeline'));
const Review = lazy(() => import('./Review'));
const Today = lazy(() => import('./Today'));
const Scorecards = lazy(() => import('./Scorecard'));
const Approvals = lazy(() => import('./Approvals'));

const TITLES: Record<RecView, string> = { pipe: 'Pipeline', review: 'Review queue', today: 'Interviews today', cards: 'Scorecards', appr: 'Approvals' };
const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default function RecruitmentShell(_props: ModuleProps) {
  const { query, go } = useTab();
  const meta = useMeta();
  const m = meta.data;
  const asked = query.get('tab') ?? '';
  const view: RecView = NATIVE.has(asked) ? (asked as RecView) : 'pipe';
  const job = num(query.get('job'));
  const interview = num(query.get('interview'));
  const solo = query.get('solo') === '1';
  useTabTitle(`Recruitment · ${TITLES[view]}`);

  const day = dayBounds();
  const today = useQuery({ queryKey: K.interviews(day.day), queryFn: ({ signal }) => fetchMyInterviews(day.from, day.to, signal), enabled: allowed(m, 'interview.view'), refetchInterval: 120_000 });
  const approvals = useQuery({ queryKey: K.approvals, queryFn: ({ signal }) => fetchApprovals(signal), enabled: !!m, refetchInterval: 120_000 });
  const openCards = (today.data ?? []).filter((i) => i.my_role !== 'OBSERVER' && i.my_evaluation?.status !== 'SUBMITTED').length;

  const can = {
    view: allowed(m, 'candidate.view'),
    move: allowed(m, 'candidate.move_stage'),
    evaluate: allowed(m, 'interview.evaluate'),
    createJob: allowed(m, 'job.create'),
    approveReq: allowed(m, 'requisition.approve'),
    approveOffer: allowed(m, 'offer.approve'),
  };
  const web = (path: string) => void call('app:openInBrowser', { path });
  const to = (v: RecView, extra = '') => go(`/recruitment?tab=${v}${job ? `&job=${job}` : ''}${extra}`);

  if (meta.isPending) return <Spinner />;
  if (!m || !allowed(m, 'access')) return <p className="m-6 text-[13px] text-ink-2">Recruitment is not open to you. Ask whoever runs Recruitment for access.</p>;

  // The scorecard alone, in its own window next to the call (D04).
  if (solo && interview) {
    return (
      <Suspense fallback={<Spinner />}>
        <Scorecards interviews={today.data ?? []} interview={interview} solo canEvaluate={can.evaluate} onPick={() => undefined} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="recruitment" label="the Recruitment menu">
        <RecruitmentRail
          view={view}
          onPick={(v) => to(v)}
          onWeb={web}
          counts={{ today: today.data?.length, cards: openCards, appr: approvals.data?.length }}
          can={{ review: can.view, evaluate: can.evaluate, createJob: can.createJob }}
        />
      </SidePanel>
      <main className="min-w-0 flex-1 overflow-hidden bg-ground" aria-label={`Recruitment · ${TITLES[view]}`}>
        <Suspense fallback={<Spinner />}>
          {view === 'pipe' ? (
            can.view ? <Pipeline job={job} canMove={can.move} onJob={(id) => go(`/recruitment?tab=pipe&job=${id}`)} onWeb={web} /> : <Denied />
          ) : view === 'review' ? (
            can.view ? <Review job={job} canMove={can.move} reasons={m.rejection_reasons ?? []} onJob={(id) => go(`/recruitment?tab=review&job=${id}`)} /> : <Denied />
          ) : view === 'today' ? (
            <Today data={today} onScorecard={(id) => to('cards', `&interview=${id}`)} canEvaluate={can.evaluate} />
          ) : view === 'cards' ? (
            <Scorecards interviews={today.data ?? []} interview={interview} canEvaluate={can.evaluate} onPick={(id) => to('cards', id ? `&interview=${id}` : '')} />
          ) : (
            <Approvals data={approvals} can={{ requisition: can.approveReq, offer: can.approveOffer, selection: can.approveOffer || can.approveReq }} onWeb={web} />
          )}
        </Suspense>
      </main>
    </div>
  );
}

function Denied() {
  return <p className="m-6 text-[13px] text-ink-2">You may not see candidates in Recruitment.</p>;
}
