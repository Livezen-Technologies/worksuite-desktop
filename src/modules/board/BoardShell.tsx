import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { call, on } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { SidePanel } from '../../components/SidePanel';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { allowed, bodiesOf, fetchApprovals, fetchActions, fetchMeeting, isLive, K, roleOf, useDashboard, useMeta } from './api';
import { BoardRail, NATIVE, type BoardView } from './Rail';

/**
 * WorkSuite Board on the desktop (SRS-BOARD-001 §13.2 D-01..D-13, FR-DX), addressed as `/board?view=…`:
 *  - `&meeting=<id>` the current meeting (agenda, comments, annotations, room, minutes, reader);
 *  - `&item=<id>` an agenda item (comments, reader); `&circular=<id>` an approval to open.
 * The `board.*` notifications land here (shared/board.ts). Setup, pack building and registers open on the web.
 */
const Home = lazy(() => import('./Home'));
const Calendar = lazy(() => import('./Calendar'));
const Agenda = lazy(() => import('./Agenda'));
const Comments = lazy(() => import('./Comments'));
const Packs = lazy(() => import('./Packs'));
const Annotations = lazy(() => import('./Annotations'));
const Search = lazy(() => import('./Search'));
const Approvals = lazy(() => import('./Approvals'));
const Actions = lazy(() => import('./Actions'));
const Archive = lazy(() => import('./Archive'));
const Room = lazy(() => import('./Room'));
const Minutes = lazy(() => import('./Minutes'));
const Reader = lazy(() => import('./Reader'));

const TITLES: Record<BoardView, string> = {
  home: 'Home', calendar: 'Calendar', agenda: 'Agenda', packs: 'Board packs', comments: 'Comments', annotations: 'Annotations', approvals: 'Approvals',
  actions: 'My actions', archive: 'Archive', search: 'Search', room: 'Meeting room', minutes: 'Live minutes', reader: 'Reader',
};
const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default function BoardShell(_props: ModuleProps) {
  const { query, go } = useTab();
  const qc = useQueryClient();
  const asked = query.get('view') ?? '';
  const view: BoardView = NATIVE.has(asked) ? (asked as BoardView) : 'home';
  const meetingId = num(query.get('meeting'));
  const item = num(query.get('item'));
  const circular = num(query.get('circular'));
  useTabTitle(`Board · ${TITLES[view]}`);

  const dash = useDashboard();
  const meta = useMeta();
  const meeting = useQuery({ queryKey: K.meeting(meetingId ?? 0), queryFn: ({ signal }) => fetchMeeting(meetingId!, signal), enabled: !!meetingId });
  const approvals = useQuery({ queryKey: K.approvals, queryFn: ({ signal }) => fetchApprovals(signal), enabled: !!dash.data, refetchInterval: 120_000 });
  const actions = useQuery({ queryKey: K.actions, queryFn: ({ signal }) => fetchActions(signal), enabled: !!dash.data });
  const vault = useQuery({ queryKey: K.vault, queryFn: () => call('board:vaultStatus') });
  useEffect(() => on('board:vaultChanged', () => void qc.invalidateQueries({ queryKey: K.vault })), [qc]);

  const to = (v: BoardView, extra: Record<string, number | null | undefined> = {}) => {
    const p = new URLSearchParams({ view: v });
    const m = extra.meeting !== undefined ? extra.meeting : meetingId;
    if (m) p.set('meeting', String(m));
    for (const [k, val] of Object.entries(extra)) if (k !== 'meeting' && val) p.set(k, String(val));
    go(`/board?${p.toString()}`);
  };
  const web = (path: string) => void call('app:openInBrowser', { path });

  if (dash.isPending) return <Spinner />;
  // Offline with nothing from the server: the packs kept on this computer still open (FR-OFF-01).
  const offlineOnly = !dash.data;
  if (meta.data?.can && !allowed(meta.data, 'access')) return <p className="m-6 text-[13px] text-ink-2">Board is not open to you. Ask your company secretary for access.</p>;
  const m = meeting.data ?? null;
  const live = isLive(m);
  const role = roleOf(m);
  const bodies = bodiesOf(dash.data);

  const shown: BoardView = offlineOnly && !['packs', 'reader', 'search', 'approvals'].includes(view) ? 'packs' : view;

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="board" label="the Board menu">
        <BoardRail
          view={shown}
          onPick={(v) => to(v)}
          onWeb={web}
          counts={{ approvals: approvals.data?.length, actions: actions.data?.filter((a) => a.status !== 'VERIFIED' && a.status !== 'COMPLETED').length }}
          meeting={m ? (m.meeting_number ?? m.title) : null}
          packsReady={vault.data?.packs.filter((p) => p.state === 'ready').length ?? 0}
        />
      </SidePanel>
      <main className="min-w-0 flex-1 overflow-hidden bg-ground" aria-label={`Board · ${TITLES[shown]}`}>
        <Suspense fallback={<Spinner />}>
          {shown === 'home' ? (
            <Home data={dash.data!} onMeeting={(id) => to('agenda', { meeting: id })} onGo={(v) => to(v)} />
          ) : shown === 'calendar' ? (
            <Calendar bodies={bodies} onMeeting={(id) => to('agenda', { meeting: id })} />
          ) : shown === 'packs' ? (
            <Packs status={vault.data ?? null} meetings={dash.data?.upcoming ?? []} onOpen={(id) => to('reader', { meeting: id })} />
          ) : shown === 'search' ? (
            <Search offline={offlineOnly} onOpen={(id) => to('agenda', { meeting: id })} />
          ) : shown === 'approvals' ? (
            <Approvals circular={circular} offline={offlineOnly} />
          ) : shown === 'actions' ? (
            <Actions onWeb={web} />
          ) : shown === 'archive' ? (
            <Archive bodies={bodies} onOpen={(id) => to('reader', { meeting: id })} />
          ) : !meetingId ? (
            <p className="m-6 text-[13px] text-ink-2">Choose a meeting on Home or in the calendar first.</p>
          ) : shown === 'agenda' ? (
            <Agenda meeting={m} meetingId={meetingId} onItem={(id) => to('reader', { item: id })} onComments={(id) => to('comments', { item: id })} onRoom={() => to(role === 'secretary' ? 'minutes' : 'room')} />
          ) : shown === 'comments' ? (
            <Comments meetingId={meetingId} item={item} participants={m?.participants ?? []} canComment={!live || !['invitee', 'observer'].includes(role)} onItem={(id) => to('comments', { item: id })} />
          ) : shown === 'annotations' ? (
            <Annotations meetingId={meetingId} packVersion={m?.pack?.current_version ?? null} />
          ) : shown === 'room' ? (
            <Room meetingId={meetingId} onMinutes={() => to('minutes')} />
          ) : shown === 'minutes' ? (
            <Minutes meetingId={meetingId} onRoom={() => to('room')} />
          ) : (
            <Reader meetingId={meetingId} item={item} meeting={m} />
          )}
        </Suspense>
      </main>
    </div>
  );
}
