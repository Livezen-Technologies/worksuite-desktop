import { lazy, Suspense, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Spinner } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import type { ModuleProps } from '../registry';
import { dataOf, NOT_OFFERED, SK, socialApi, useInvalidate, useModuleStatus } from './api';
import { useSocialAccess } from './access';
import { SECTION_TITLE, SECTIONS, SocialNav, visibleSections, type Section } from './Nav';
import { Notice } from './parts';

/**
 * Social Media Manager (WS-SMM-SRS-001 v1.1; design "WorkSuite Social Media Manager — UI", 18 artboards). The same
 * layout and theme as the web app (SMM-DSK-001): the module rail, then the screen. Addressed `/social-media/<section>`:
 *
 *   /social-media                    W01 Overview
 *   /social-media/compose            W02 / D02 Create post (`?account=`, `?file=`, `?date=`, `?campaign=` prefill)
 *   /social-media/posts/<id>         the post in the composer (published ones read-only, with results)
 *   /social-media/calendar           W03 / D01 Calendar (`?view=month|week|list&date=`)
 *   /social-media/queue              W04 Queue & posting slots
 *   /social-media/approvals[/<id>]   W05 Approvals
 *   /social-media/inbox[/<id>]       W06 / D03 Unified inbox
 *   /social-media/analytics          W07        /social-media/library    W08     /social-media/campaigns[/<id>]  W09
 *   /social-media/accounts           A01        /social-media/settings[/<section>]  A02   /social-media/log  A03
 *
 * Mod+N in this tab (the shell's "New (in this app)") lands on `?new=1`: a new post. The web's `/social-media/…`
 * links land here too (shared/links, by the catalogue's webPath).
 */
const Overview = lazy(() => import('./screens/Overview'));
const Composer = lazy(() => import('./composer/Composer'));
const Calendar = lazy(() => import('./screens/Calendar'));
const Queue = lazy(() => import('./screens/Queue'));
const Approvals = lazy(() => import('./screens/Approvals'));
const Inbox = lazy(() => import('./screens/Inbox'));
const Analytics = lazy(() => import('./screens/Analytics'));
const Library = lazy(() => import('./screens/Library'));
const Campaigns = lazy(() => import('./screens/Campaigns'));
const Accounts = lazy(() => import('./admin/Accounts'));
const Settings = lazy(() => import('./admin/Settings'));
const PublishLog = lazy(() => import('./admin/PublishLog'));

/** `/social-media/<x>/…` → the section it belongs to. */
export function sectionOf(path: readonly string[], query?: URLSearchParams): Section {
  if (query?.get('new') === '1') return 'compose';
  const s = path[1] ?? '';
  if (s === '' || s === 'overview') return 'overview';
  if (s === 'posts') return 'compose';
  return (SECTIONS as readonly string[]).includes(s) ? (s as Section) : 'overview';
}

/** A numeric id in the route (`/social-media/inbox/42`), else null. */
function idAt(path: readonly string[], i: number): number | null {
  const v = path[i];
  return v && /^\d{1,12}$/.test(v) ? Number(v) : null;
}

export default function SocialMediaPage(_props: ModuleProps) {
  const { path, query, go } = useTab();
  const statusQ = useModuleStatus();
  const status = dataOf(statusQ.data);
  const access = useSocialAccess(status?.permissions);
  const section = sectionOf(path, query);
  const visible = visibleSections(access);
  const allowed = visible.includes(section);
  const postId = path[1] === 'posts' ? idAt(path, 2) : null;
  useTabTitle(section === 'compose' && postId ? 'Post' : SECTION_TITLE[section]);

  // "New (in this app)" from the shell: drop the flag once the composer is showing, so a reload doesn't start over.
  useEffect(() => {
    if (query.get('new') === '1') go('/social-media/compose');
  }, [query, go]);

  const pick = (s: Section) => go(s === 'overview' ? '/social-media' : `/social-media/${s}`);

  return (
    <div className="flex h-full min-h-0">
      <SocialNav section={section} onPick={pick} access={access} />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-ground">
        {statusQ.data && !statusQ.data.offered ? <ModuleMissing /> : null}
        {status?.paused_all ? <PausedBanner canResume={access.settings} pausedBy={status.paused_by?.name ?? null} /> : null}
        <Suspense fallback={<Spinner />}>
          {!allowed ? (
            <NotAllowed />
          ) : section === 'overview' ? (
            <Overview />
          ) : section === 'compose' ? (
            <Composer key={postId ?? 'new'} postId={postId} />
          ) : section === 'calendar' ? (
            <Calendar />
          ) : section === 'queue' ? (
            <Queue />
          ) : section === 'approvals' ? (
            <Approvals postId={idAt(path, 2)} />
          ) : section === 'inbox' ? (
            <Inbox threadId={idAt(path, 2)} />
          ) : section === 'analytics' ? (
            <Analytics />
          ) : section === 'library' ? (
            <Library />
          ) : section === 'campaigns' ? (
            <Campaigns campaignId={idAt(path, 2)} />
          ) : section === 'accounts' ? (
            <Accounts />
          ) : section === 'log' ? (
            <PublishLog />
          ) : (
            <Settings section={path[2] ?? null} />
          )}
        </Suspense>
      </main>
    </div>
  );
}

/** The server has no Social Media module at all: every screen still draws, and says so where its data would be. */
function ModuleMissing() {
  return (
    <div className="shrink-0 border-b border-line bg-surface px-5 py-2.5">
      <Notice tone="warning" icon="server">
        <b>Social Media Manager isn’t on this WorkSuite server yet.</b> {NOT_OFFERED} The screens show where your accounts, posts and inbox will appear.
      </Notice>
    </div>
  );
}

/** "Pause all publishing" is on (SMM-SCH-008, WF-16): scheduling still works, nothing goes out. */
function PausedBanner({ canResume, pausedBy }: { canResume: boolean; pausedBy: string | null }) {
  const invalidate = useInvalidate();
  const resume = useMutation({
    mutationFn: () => socialApi.pauseAll(false),
    onSuccess: () => {
      invalidate(SK.status, SK.postsAll, SK.queueAll);
      toast('success', 'Publishing resumed. Posts whose time passed while paused are waiting for your choice in the calendar.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="shrink-0 border-b border-line bg-surface px-5 py-2.5">
      <Notice
        tone="danger"
        icon="pause"
        action={
          canResume ? (
            <Button size="sm" variant="danger" loading={resume.isPending} onClick={() => resume.mutate()}>
              Resume publishing
            </Button>
          ) : null
        }
      >
        <b>All publishing is paused{pausedBy ? ` by ${pausedBy}` : ''}.</b> Posts can still be scheduled; nothing is published until it is resumed.
      </Notice>
    </div>
  );
}

function NotAllowed() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <div className="text-[15px] font-bold text-ink">You don’t have access to this part of Social Media</div>
        <p className="mt-1 text-[12.5px] text-ink-3">Each screen needs its social.* permission (composing needs social.post.create, the inbox social.inbox.view, settings social.settings.manage). Ask your Social Admin.</p>
      </div>
    </div>
  );
}
