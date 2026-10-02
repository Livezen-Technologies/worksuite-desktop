import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { ApiError, apiGet, apiGetMeta, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { t } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes, dayLabel, greeting, relative, timeLabel, todayInZone, wallTimeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { openAssistant } from '../../core/ui';
import { useCanOpen } from '../../core/access';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, OfflineNote, cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import type { ModuleProps } from '../registry';
import { nowWall, type CalendarEvent, type Destination } from '../calendar/api';
import { awaitingAnswer } from '@shared/meeting-invitations';
import { useWaitingInvitations } from '../calendar/conflicts';
import { WaitingInvitations } from './WaitingInvitations';
import { ALL_TASKS } from '../tasks/queries';
import { FileIcon } from '../files/Thumb';
import { isJunkFile } from '../files/api';
import type { Room } from '../chat/types';
import { assistantSession } from '../ai/session';
import { aiDock } from '../../app/overlays/AiDock';
import { AllAnnouncements, AnnouncementReader, AnnouncementRows, current, forCompany, ranked, toAcknowledge, useMyAnnouncements, type MyAnnouncement } from './Announcements';
import { Agenda } from './Agenda';
import { MoreButton, PopMenu, type MenuAction } from './Menu';
import { TodaysWork } from './TodaysWork';
import { HeaderLink, Widget } from './Widget';
import {
  CARDS,
  DEFAULT_LAYOUT,
  agendaOf,
  cappedCount,
  compactCount,
  loadLayout,
  mainSpans,
  meetingsToday,
  move,
  place,
  resize,
  saveLayout,
  sizeOf,
  taskBuckets,
  toggle,
  waitingBreakdown,
  zoneOf,
  type CardId,
  type Layout,
  type Zone,
} from './today';

/**
 * Home — the desktop shell's dashboard (UI-04, §4.13; modernised in #104; optimized layout). Every card comes from a
 * module the person can open; one they cannot is simply absent (FR-REG-06). Each card asks for its own data and says
 * for itself when it is loading or failed, with Retry, so nothing waits on the slowest. The numbers in the tiles at
 * the top are the lengths of the lists they open.
 */
export interface Dashboard {
  user: { name: string };
  stats: { my_tasks: number; tasks_overdue: number; unread_mail: number; unread_chats: number; notifications_unread: number };
  recent_files: Array<{
    id: number;
    name: string;
    extension: string;
    size: number;
    location: string;
    at: string;
    /** Newer servers (#104): a type to show, a preview, and whether it is still being processed. */
    kind?: string | null;
    mime?: string | null;
    thumbnail?: string | null;
    status?: 'ready' | 'processing' | 'failed' | null;
  }>;
  /** Grouped by the server on newer versions (#104): `count` updates of one kind by one person, as one line. */
  activity: Array<{ id: number; description: string | null; user: string | null; at: string; count?: number; link?: string | null; module?: string | null }>;
}

interface Approval {
  kind: 'leave' | 'request' | 'resignation';
  id: number;
  who: string;
  what: string;
  when: string;
  as: string;
  link: string;
}

interface Summary {
  total: number;
  digest: { text: string | null; reason: string | null; points?: Array<{ text: string; link: string | null }>; sources?: Array<{ label: string; link: string }> };
}

/** Transfer parts and the like are not activity (#104): a line per chunk of an upload says nothing. */
const NOISE = /\b(chunk|part \d+ of \d+|upload(ed)? part|transfer part)\b/i;

/** The span of a main card on the 9-column main grid. */
const SPAN = { full: 'md:col-span-9', major: 'md:col-span-5', minor: 'md:col-span-4' } as const;

/** The clock, a minute at a time: the agenda's "now" line and "in 55 min" move with it. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export default function HomePage(_props: ModuleProps) {
  useTabTitle(t('nav.home'));
  const { navigate, openLink, query, go } = useTab();
  const user = useStore(app, (s) => s.auth?.user);
  const orgId = useStore(app, (s) => s.organizationId);
  const orgs = useStore(app, (s) => s.bootstrap?.organizations ?? []);
  const apps = useStore(app, (s) => s.apps);
  const status = useStore(app, (s) => s.status);
  const has = (id: string) => apps.some((a) => a.id === id);
  const meet = useCanOpen('meet');
  const today = todayInZone();
  const clock = useMinute();
  const now = nowWall(clock).minutes;
  const [customizing, setCustomizing] = useState(false);
  const [layout, setLayoutState] = useState<Layout>(() => loadLayout(user?.id));
  // The company the dashboard is about: the one you work in, or all of yours. Home's own filter — it does not switch the app.
  const [company, setCompany] = useState<string | null>(orgId);
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    saveLayout(user?.id, l);
  };

  const dash = useQuery({ queryKey: ['home', 'dashboard'], queryFn: () => apiGetMeta<Dashboard>('/api/dashboard/home') });
  // The Tasks page's own request: the counts here are the lengths of the lists they open.
  const tasks = useQuery({ ...ALL_TASKS, enabled: has('tasks') });
  const events = useQuery({
    queryKey: ['calendar', today, today],
    queryFn: () => apiGetMeta<{ events: CalendarEvent[] }>('/api/calendar/events', { from: today, to: today }),
    enabled: has('calendar'),
  });
  const invitations = useWaitingInvitations(has('calendar') || has('meetings'));
  const approvals = useQuery({
    queryKey: ['hr', 'approvals'],
    queryFn: () => apiGet<{ count: number; items: Approval[] }>('/api/hr/approvals/pending'),
    enabled: has('hr'),
    retry: false,
  });
  // Chat's own list of conversations (one cache with the Chat page): its mentions are the tile's "N mentions".
  const rooms = useQuery({
    queryKey: ['chat', 'rooms'],
    queryFn: ({ signal }) => apiGetMeta<{ rooms: Room[] }>('/api/chat/rooms', undefined, signal),
    enabled: has('chat'),
    retry: false,
    staleTime: 60_000,
  });
  const announcements = useMyAnnouncements();
  const summary = useQuery({ queryKey: ['home', 'summary'], queryFn: () => apiGet<Summary>('/api/dashboard/summary'), retry: false, staleTime: 10 * 60_000 });

  const reading = Number(query.get('announcement') ?? 0) || null;
  const readingAll = query.get('announcements') === 'all';

  const inCompany = (o: number | null | undefined) => company === null || o === null || o === undefined || String(o) === company;
  const myTasks = (tasks.data?.data.tasks ?? []).filter((x) => inCompany(x.org_id));
  const buckets = taskBuckets(myTasks, today);
  const agenda = events.data?.data.events ?? [];
  const meetings = meetingsToday(agenda);
  const next = agendaOf(agenda, now).next;
  // Announcements: an older server without them, or one refusing, has no card rather than an error.
  const noAnnouncements = announcements.error instanceof ApiError && (announcements.error.status === 404 || announcements.error.forbidden);
  const notices = ranked(current(forCompany(announcements.data ?? [], company)));
  const acks = toAcknowledge(notices);
  const approvalItems = has('hr') ? (approvals.data?.items ?? []) : [];
  const approvalCount = has('hr') ? (approvals.data?.count ?? 0) : 0;
  // Waiting for an answer: one answered — even "maybe" — has left Waiting for me, and stays on the meeting (#97).
  const waiting = (invitations.data ?? []).filter((i) => awaitingAnswer(i.my_rsvp));
  const waitingCount = approvalCount + waiting.length + acks.length;
  const unreadChat = has('chat') ? (status?.unread.chat ?? 0) : 0;
  const unreadMail = has('mail') ? (status?.unread.mail ?? 0) : 0;
  const mentions = (rooms.data?.data.rooms ?? []).reduce((n, r) => n + (r.mentions ?? 0), 0);
  const offlineAt = dash.data?.offline ? dash.data.cachedAt : null;
  const activity = (dash.data?.data.activity ?? []).filter((a) => !NOISE.test(a.description ?? ''));
  const files = (dash.data?.data.recent_files ?? []).filter((f) => !isJunkFile(f.name));
  const open = (to: Destination) => (to.route ? navigate(to.route) : to.web ? void call('app:openInBrowser', { path: to.web }).catch((e) => toast('error', errorMessage(e))) : undefined);

  const available: Record<CardId, boolean> = {
    work: has('tasks'),
    calendar: has('calendar'),
    summary: true,
    waiting: true,
    announcements: !noAnnouncements,
    activity: has('activity'),
    files: has('files'),
  };
  const shown = layout.order.filter((id) => !layout.hidden.includes(id) && available[id]);
  const main = shown.filter((id) => zoneOf(id) === 'main');
  const rail = shown.filter((id) => zoneOf(id) === 'rail');
  const spans = mainSpans(main, layout.wide);
  const onPlace = (moved: CardId, before: CardId) => setLayout(place(layout, moved, before));
  const common = (id: CardId) => ({ id, onPlace, className: zoneOf(id) === 'main' ? SPAN[spans.get(id) ?? 'full'] : undefined });

  const cards: Record<CardId, () => ReactNode> = {
    work: () => (
      <Widget
        {...common('work')}
        title={t('home.todaysWork')}
        action={<HeaderLink onClick={() => navigate('/tasks')}>All tasks</HeaderLink>}
        loading={tasks.isLoading}
        error={tasks.error}
        onRetry={() => void tasks.refetch()}
      >
        <TodaysWork buckets={buckets} today={today} onOpen={(id) => navigate(`/tasks?task=${id}`)} onMore={(scope) => navigate(`/tasks?scope=${scope}`)} onAdd={() => navigate('/tasks?new=1')} />
      </Widget>
    ),
    calendar: () => (
      <Widget
        {...common('calendar')}
        title={t('home.agenda')}
        action={<HeaderLink onClick={() => navigate('/calendar')}>Calendar</HeaderLink>}
        loading={events.isLoading}
        error={events.error}
        onRetry={() => void events.refetch()}
        empty={agenda.length === 0 ? <><Icon name="calendar" size={15} /> Nothing scheduled today.</> : null}
      >
        <Agenda events={agenda} now={now} today={today} canMeet={meet} canMeetings={has('meetings')} onOpen={open} />
      </Widget>
    ),
    summary: () => (
      <Widget
        {...common('summary')}
        title={t('home.brief')}
        icon="sparkles"
        tone="navy"
        aside={summary.dataUpdatedAt ? `Updated ${timeLabel(new Date(summary.dataUpdatedAt).toISOString())}` : null}
        loading={summary.isLoading}
      >
        <DailyBrief
          summary={summary.data}
          error={summary.error}
          facts={{ today: buckets.today.length, overdue: buckets.overdue.length, meetings: meetings.length, unread: unreadChat + unreadMail, waiting: waitingCount }}
          canAsk={has('ai')}
          onOpen={openLink}
        />
      </Widget>
    ),
    waiting: () => (
      <Widget
        {...common('waiting')}
        title={t('home.waiting')}
        count={waitingCount}
        countTone="warning"
        action={
          waiting.length && has('meetings') ? (
            <HeaderLink label="All invitations" onClick={() => navigate('/meetings?tab=invitations')}>All</HeaderLink>
          ) : approvalItems.length ? (
            <HeaderLink label="All approvals" onClick={() => openLink('/hr?tab=approvals')}>All</HeaderLink>
          ) : null
        }
        loading={(has('hr') && approvals.isLoading) || invitations.isLoading}
        error={has('hr') && approvals.error && !(approvals.error instanceof ApiError && approvals.error.forbidden) ? approvals.error : null}
        onRetry={() => void approvals.refetch()}
        empty={waitingCount === 0 ? <><Icon name="check-circle" size={15} /> Nothing waiting for you.</> : null}
      >
        <div className="flex flex-col">
          {waiting.length ? <WaitingInvitations items={waiting} canMeetings={has('meetings')} onOpen={openLink} /> : null}
          {approvalItems.length ? <WaitingApprovals items={approvalItems} onOpen={openLink} /> : null}
          {acks.length ? <WaitingAcknowledgements items={acks} onOpen={(id) => go(`/home?announcement=${id}`)} /> : null}
        </div>
      </Widget>
    ),
    announcements: () => (
      <Widget
        {...common('announcements')}
        title={t('home.announcements')}
        count={notices.filter((a) => !a.read).length}
        countTone="indigo"
        action={notices.length ? <HeaderLink label="See all announcements" onClick={() => go('/home?announcements=all')}>See all</HeaderLink> : null}
        loading={announcements.isLoading}
        error={announcements.error}
        onRetry={() => void announcements.refetch()}
        empty={notices.length === 0 ? <><Icon name="megaphone" size={15} /> No announcements.</> : null}
      >
        <AnnouncementRows items={notices} onOpen={(id) => go(`/home?announcement=${id}`)} limit={3} />
      </Widget>
    ),
    activity: () => (
      <Widget
        {...common('activity')}
        title={t('home.recentActivity')}
        action={<HeaderLink onClick={() => navigate('/activity')}>All activity</HeaderLink>}
        loading={dash.isLoading}
        error={dash.error}
        onRetry={() => void dash.refetch()}
        empty={activity.length === 0 ? <><Icon name="activity" size={15} /> Nothing new.</> : null}
      >
        <ul className="m-0 flex list-none flex-col p-0">
          {activity.slice(0, 5).map((a) => (
            <li key={a.id} className="border-t border-line">
              <button type="button" disabled={!a.link} onClick={() => a.link && openLink(a.link)} className="flex w-full items-center gap-3 rounded-[8px] py-[11px] text-left enabled:hover:bg-subtle">
                <Avatar name={a.user ?? 'WorkSuite'} size={34} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] text-ink-2">
                    {a.user ? <b className="font-semibold text-ink">{a.user} </b> : null}
                    {a.description}
                    {a.count && a.count > 1 ? <span className="ml-1 rounded-full bg-subtle px-1.5 text-[11px] font-bold text-ink-2" title={`${a.count} updates`}>×{compactCount(a.count)}</span> : null}
                  </span>
                  {a.module ? <span className="truncate text-[12px] text-ink-3 capitalize">{a.module}</span> : null}
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">{relative(a.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Widget>
    ),
    files: () => (
      <Widget
        {...common('files')}
        title={t('home.files')}
        action={<HeaderLink onClick={() => navigate('/files')}>My Drive</HeaderLink>}
        loading={dash.isLoading}
        error={dash.error}
        onRetry={() => void dash.refetch()}
        empty={files.length === 0 ? <><Icon name="folder" size={15} /> No recent files.</> : null}
      >
        <ul className="m-0 flex list-none flex-col p-0">
          {files.slice(0, 5).map((f) => (
            <li key={f.id} className="flex items-center gap-1 border-t border-line">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] py-2.5 text-left hover:bg-subtle" onClick={() => navigate(`/files?file=${f.id}`)}>
                <FileIcon f={{ id: f.id, name: f.name, extension: f.extension, has_thumb: !!f.thumbnail }} size={34} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold text-ink" title={f.name}>
                    {f.name}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
                    <span className="truncate">{[f.location || f.kind || f.extension.toUpperCase(), f.size ? bytes(f.size) : null].filter(Boolean).join(' · ')}</span>
                    {f.status === 'processing' ? <Chip tone="indigo" className="shrink-0 text-[11px]">Processing</Chip> : f.status === 'failed' ? <Chip tone="danger" className="shrink-0 text-[11px]">Failed</Chip> : null}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">{relative(f.at)}</span>
              </button>
              <MoreButton
                label={`More actions for ${f.name}`}
                items={[
                  { label: 'Open', icon: 'external', run: () => void call('transfers:download', { fileId: String(f.id), name: f.name, open: true }).catch((e) => toast('error', errorMessage(e))) },
                  { label: 'Show in Drive', icon: 'folder-open', run: () => navigate(`/files?file=${f.id}`) },
                  { label: 'Download', icon: 'download', run: () => void call('transfers:download', { fileId: String(f.id), name: f.name }).catch((e) => toast('error', errorMessage(e))) },
                ]}
              />
            </li>
          ))}
        </ul>
      </Widget>
    ),
  };

  const newItems: MenuAction[] = [
    ...(has('tasks') ? [{ icon: 'tasks', label: 'Task', run: () => navigate('/tasks?new=1') }] : []),
    ...(has('calendar') ? [{ icon: 'calendar-plus', label: 'Event', run: () => navigate('/calendar?new=1') }] : []),
    ...(has('mail') ? [{ icon: 'mail', label: 'Email', run: () => navigate('/mail?compose=1') }] : []),
    ...(has('crm') ? [{ icon: 'users', label: 'Lead', run: () => navigate('/crm?new=1') }] : []),
    ...(has('files') ? [{ icon: 'upload', label: 'Upload file', run: () => navigate('/files?upload=1') }] : []),
    ...(has('hr') ? [{ icon: 'calendar-clock', label: 'Leave request', run: () => navigate('/hr?tab=leave&new=1') }] : []),
  ];

  const tiles = [
    has('tasks') ? (
      <StatTile
        key="due"
        label={t('home.dueToday')}
        n={buckets.today.length}
        note={buckets.overdue.length ? `${buckets.overdue.length.toLocaleString()} overdue` : null}
        noteTone="danger"
        icon="tasks"
        tone="indigo"
        loading={tasks.isLoading}
        onClick={() => navigate('/tasks?scope=today')}
      />
    ) : null,
    has('calendar') ? (
      <StatTile
        key="meetings"
        label={t('home.meetingsToday')}
        n={meetings.length}
        note={next ? (next.live ? 'On now' : `Next at ${wallTimeLabel(next.e.start_at)}`) : meetings.length ? 'None left today' : null}
        icon="calendar"
        tone="green"
        loading={events.isLoading}
        onClick={() => navigate(has('meetings') ? '/meetings' : '/calendar')}
      />
    ) : null,
    <StatTile
      key="waiting"
      label={t('home.waitingForYou')}
      n={waitingCount}
      note={waitingBreakdown({ invitations: waiting.length, approvals: approvalCount, acknowledgements: acks.length }) || null}
      icon="user"
      tone="amber"
      onClick={() => {
        const card = document.querySelector('[data-card="waiting"]');
        if (card) card.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      }}
    />,
    has('chat') || has('mail') ? (
      <StatTile
        key="unread"
        label={t('home.unread')}
        n={unreadChat + unreadMail}
        display={cappedCount(unreadChat + unreadMail)}
        note={mentions ? `${mentions.toLocaleString()} ${mentions === 1 ? 'mention' : 'mentions'}` : null}
        icon="mail"
        tone="red"
        onClick={() => navigate(has('chat') && (unreadChat >= unreadMail || !has('mail')) ? '/chat' : '/mail')}
      />
    ) : null,
  ].filter(Boolean);

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 scroll-thin">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
              <span>{dayLabel(today)}</span>
              {orgs.length > 1 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="relative -ml-1 flex items-center">
                    <select
                      aria-label="Organization"
                      value={company ?? ''}
                      onChange={(e) => setCompany(e.target.value || null)}
                      className="h-6 max-w-[240px] cursor-pointer appearance-none rounded-[6px] border-0 bg-subtle py-0 pr-6 pl-2 text-[13px] font-medium text-ink-2 hover:text-ink"
                    >
                      <option value="">All organizations</option>
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-1.5 text-ink-3" />
                  </span>
                </>
              ) : null}
            </div>
            <h1 className="m-0 truncate text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink">
              {greeting()}, {user?.name.split(' ')[0] ?? ''}
            </h1>
          </div>
          <div className="relative flex flex-wrap items-center gap-2">
            {offlineAt ? <OfflineNote cachedAt={offlineAt} /> : null}
            <Button className="h-[38px] rounded-[10px] px-3.5 font-medium" onClick={() => setCustomizing((v) => !v)} aria-haspopup="dialog" aria-expanded={customizing} icon="sliders">
              {t('home.customize')}
            </Button>
            {customizing ? <Customize layout={layout} available={available} onChange={setLayout} onClose={() => setCustomizing(false)} /> : null}
            {newItems.length ? (
              <PopMenu
                label="New"
                items={newItems}
                trigger={({ open: menuOpen, toggle: flip }) => (
                  <span className="flex h-[38px] items-stretch overflow-hidden rounded-[10px] bg-primary text-[13px] font-semibold text-white">
                    <button type="button" onClick={newItems[0]!.run} title={`New ${newItems[0]!.label.toLowerCase()}`} className="flex items-center gap-2 pr-2.5 pl-3.5 hover:bg-primary-hover">
                      <Icon name="plus" size={16} />
                      {t('home.new')}
                    </button>
                    <span aria-hidden="true" className="my-2.5 w-px bg-white/30" />
                    <button type="button" aria-label="More new items" aria-haspopup="menu" aria-expanded={menuOpen} onClick={flip} className="flex items-center px-2 hover:bg-primary-hover">
                      <Icon name="chevron-down" size={16} />
                    </button>
                  </span>
                )}
              />
            ) : null}
          </div>
        </header>

        {/* One bordered row; the hairlines between tiles are the gaps. An odd one out at two columns takes the row. */}
        <div
          className={cx(
            'grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2 sm:[&>:last-child:nth-child(odd)]:col-span-2',
            tiles.length >= 4 ? 'xl:grid-cols-4 xl:[&>:last-child:nth-child(odd)]:col-span-1' : tiles.length === 3 ? 'xl:grid-cols-3 xl:[&>:last-child:nth-child(odd)]:col-span-1' : '',
          )}
        >
          {tiles}
        </div>

        <div className={cx('grid grid-cols-1 items-start gap-5', main.length && rail.length ? 'xl:grid-cols-12' : '')}>
          {main.length ? (
            <div className={cx('grid min-w-0 grid-cols-1 gap-5 md:grid-cols-9', rail.length > 0 && 'xl:col-span-9')}>
              {main.map((id) => (
                <Fragment key={id}>{cards[id]()}</Fragment>
              ))}
            </div>
          ) : null}
          {rail.length ? (
            <div className={cx('grid min-w-0 grid-cols-1 content-start gap-5', main.length ? 'md:grid-cols-2 xl:col-span-3 xl:grid-cols-1' : 'md:grid-cols-3')}>
              {rail.map((id) => (
                <Fragment key={id}>{cards[id]()}</Fragment>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {reading ? <AnnouncementReader id={reading} onClose={() => go('/home')} /> : null}
      {readingAll ? <AllAnnouncements items={notices} onOpen={(id) => go(`/home?announcement=${id}`)} onClose={() => go('/home')} /> : null}
    </div>
  );
}

/**
 * Which cards Home shows, in what order and how wide (QA-015, #104). Kept on this computer for this person; Reset
 * Layout puts it back as it came. The main cards and the side cards are ordered apart, each in its own place.
 */
function Customize({ layout, available, onChange, onClose }: { layout: Layout; available: Record<CardId, boolean>; onChange: (l: Layout) => void; onClose: () => void }) {
  const label = (id: CardId) => CARDS.find((c) => c.id === id)?.label ?? id;
  const groups: Array<{ zone: Zone; title: string }> = [
    { zone: 'main', title: 'Main' },
    { zone: 'rail', title: 'Side' },
  ];
  return (
    <div role="dialog" aria-label="Customize Home" className="animate-in absolute top-12 right-0 z-20 w-[340px] max-w-[calc(100vw-32px)] rounded-[12px] border border-line bg-surface p-3 shadow-xl" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-bold text-ink">Cards on Home</span>
        <button type="button" onClick={onClose} className="text-[12.5px] font-semibold text-primary hover:underline">
          Done
        </button>
      </div>
      {groups.map((g) => {
        const ids = layout.order.filter((id) => zoneOf(id) === g.zone && available[id]);
        if (!ids.length) return null;
        return (
          <div key={g.zone} className="mb-2">
            <div className="px-1.5 pb-1 text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{g.title}</div>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {ids.map((id, i) => (
                <li key={id} className="flex items-center gap-2 rounded-[8px] px-1.5 py-1 hover:bg-subtle">
                  <Checkbox aria-label={`Show ${label(id)}`} checked={!layout.hidden.includes(id)} onChange={() => onChange(toggle(layout, id))} />
                  <span className={cx('min-w-0 flex-1 text-[13px]', layout.hidden.includes(id) ? 'text-ink-3' : 'text-ink')}>{label(id)}</span>
                  {g.zone === 'main' ? (
                    <button
                      type="button"
                      aria-label={`Make ${label(id)} ${sizeOf(layout, id) === 'wide' ? 'normal width' : 'wide'}`}
                      aria-pressed={sizeOf(layout, id) === 'wide'}
                      title={sizeOf(layout, id) === 'wide' ? 'Wide' : 'Normal'}
                      onClick={() => onChange(resize(layout, id, sizeOf(layout, id) === 'wide' ? 'normal' : 'wide'))}
                      className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold', sizeOf(layout, id) === 'wide' ? 'bg-selection text-primary' : 'text-ink-3 hover:bg-line')}
                    >
                      {sizeOf(layout, id) === 'wide' ? 'Wide' : 'Normal'}
                    </button>
                  ) : null}
                  <button type="button" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => onChange(move(layout, id, -1))} className="rounded p-1 text-ink-2 hover:bg-line disabled:opacity-30">
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button type="button" aria-label={`Move ${label(id)} down`} disabled={i === ids.length - 1} onClick={() => onChange(move(layout, id, 1))} className="rounded p-1 text-ink-2 hover:bg-line disabled:opacity-30">
                    <Icon name="arrow-down" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="mt-1 flex items-center gap-2">
        <p className="m-0 flex-1 text-[11.5px] text-ink-3">Drag a card by its handle to move it. Cards for apps you don't have stay hidden.</p>
        <Button size="sm" onClick={() => onChange(DEFAULT_LAYOUT)}>
          Reset Layout
        </Button>
      </div>
    </div>
  );
}

const TILE_TONES = { indigo: 'bg-selection text-primary', green: 'bg-success-bg text-success', amber: 'bg-warning-bg text-warning', red: 'bg-danger-bg text-danger' };

/** One of the four numbers at the top: what it counts (exact on hover), a word on it, and the list it opens. */
export function StatTile({
  label,
  n,
  display,
  note,
  noteTone,
  icon,
  tone,
  onClick,
  loading,
}: {
  label: string;
  n: number;
  display?: string;
  note?: string | null;
  noteTone?: 'danger';
  icon: string;
  tone: keyof typeof TILE_TONES;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${n}`} className="flex min-w-0 items-center gap-3.5 bg-surface px-5 py-4 text-left hover:bg-well">
      <span aria-hidden="true" className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]', TILE_TONES[tone])}>
        <Icon name={icon} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] text-ink-2">{label}</span>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink tabular" title={n.toLocaleString()}>
            {loading ? '–' : (display ?? compactCount(n))}
          </span>
          {note && !loading ? <span className={cx('truncate text-[12px] font-medium', noteTone === 'danger' ? 'text-danger' : 'text-ink-3')}>{note}</span> : null}
        </span>
      </span>
    </button>
  );
}

/**
 * The daily brief (#104, optimized): short, made of what you can open — each point goes to where it comes from — and
 * nothing guessed about you. A server that sends no points gets the facts Home already has. A question typed below
 * goes to the AI Assistant, ready to send.
 */
function DailyBrief({ summary, error, facts, canAsk, onOpen }: { summary?: Summary; error: unknown; facts: { today: number; overdue: number; meetings: number; unread: number; waiting: number }; canAsk: boolean; onOpen: (link: string) => void }) {
  const [question, setQuestion] = useState('');
  const points = summary?.digest.points?.filter((p) => p.text) ?? [];
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const fallback = [
    facts.overdue ? `${plural(facts.overdue, 'task')} overdue` : null,
    `${plural(facts.today, 'task')} due today`,
    `${plural(facts.meetings, 'meeting')} today`,
    facts.waiting ? `${facts.waiting} waiting for you` : null,
    facts.unread ? `${plural(facts.unread, 'unread message')}` : null,
  ].filter((x): x is string => !!x);
  const ask = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q) {
      assistantSession.store.set({ text: q.slice(0, 4000) });
      aiDock.set({ view: 'ask' });
    }
    openAssistant();
    setQuestion('');
  };
  const bullet = <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal-light" />;
  return (
    <div className="flex flex-col gap-3.5 text-[13px] leading-[1.45]">
      {points.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {points.slice(0, 5).map((p, i) => (
            <li key={i} className="flex gap-2.5">
              {bullet}
              {p.link ? (
                <button type="button" onClick={() => onOpen(p.link!)} className="text-left text-navy-ink hover:text-white hover:underline">
                  {p.text}
                </button>
              ) : (
                <span>{p.text}</span>
              )}
            </li>
          ))}
        </ul>
      ) : summary?.digest.text ? (
        <p className="m-0 line-clamp-6">{summary.digest.text}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {fallback.map((f) => (
            <li key={f} className="flex gap-2.5">
              {bullet}
              <span>{f}.</span>
            </li>
          ))}
        </ul>
      )}
      {summary?.digest.sources?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <span>From:</span>
          {summary.digest.sources.slice(0, 4).map((s) => (
            <button key={s.link} type="button" onClick={() => onOpen(s.link)} className="rounded-full bg-white/10 px-2 py-0.5 text-white hover:bg-white/20">
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {!summary && error && !(error instanceof ApiError && error.forbidden) ? <p className="m-0 text-[12px]">The brief could not be prepared; these are today's numbers.</p> : null}
      {canAsk ? (
        <form onSubmit={ask} className="flex h-10 items-center gap-2 rounded-[10px] border border-white/15 bg-white/[0.08] pr-1.5 pl-3 focus-within:border-white/40">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask AI to summarize, draft, or find…"
            aria-label="Ask AI"
            className="bare-focus min-w-0 flex-1 border-0 bg-transparent text-[13px] text-white outline-none placeholder:text-navy-ink/70"
          />
          <button type="submit" aria-label="Send to AI" title="Send to AI" className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-white text-navy hover:bg-white/90">
            <Icon name="arrow-right" size={16} />
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** Approvals waiting for you: a leave request decided right here, anything else reviewed where it lives. */
function WaitingApprovals({ items, onOpen }: { items: Approval[]; onOpen: (link: string) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const decide = async (a: Approval, decision: 'approved' | 'rejected') => {
    setBusy(a.id);
    try {
      await apiPost(`/api/hr/leave/requests/${a.id}/decide`, { decision });
      toast('success', decision === 'approved' ? `Approved ${a.who}'s ${a.what.toLowerCase()}.` : `Declined ${a.who}'s request.`);
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-label="Approvals waiting for you">
      {items.slice(0, 5).map((a) => (
        <li key={`${a.kind}:${a.id}`} className="flex items-center gap-3 border-t border-line py-3">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-warning-bg text-warning">
            <Icon name="file-text" size={16} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[14px] font-semibold text-ink">{a.what}</span>
            <span className="truncate text-[12px] text-ink-3">{[a.who, a.when].filter(Boolean).join(' · ')}</span>
          </div>
          {a.kind === 'leave' && a.as !== 'responsible' ? (
            <span className="flex shrink-0 gap-1.5">
              <Button size="sm" className="h-8" disabled={busy === a.id} onClick={() => void decide(a, 'rejected')}>
                Decline
              </Button>
              <Button size="sm" className="h-8" variant="success" disabled={busy === a.id} onClick={() => void decide(a, 'approved')}>
                Approve
              </Button>
            </span>
          ) : (
            <Button size="sm" className="h-8 shrink-0 px-3 font-medium" aria-label={`Review ${a.what}`} onClick={() => onOpen(a.link)}>
              Review
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Announcements that ask to be read and acknowledged. */
function WaitingAcknowledgements({ items, onOpen }: { items: MyAnnouncement[]; onOpen: (id: number) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-label="Announcements to acknowledge">
      {items.slice(0, 3).map((a) => (
        <li key={a.id} className="flex items-center gap-3 border-t border-line py-3">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-danger-bg text-danger">
            <Icon name="megaphone" size={16} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[14px] font-semibold text-ink">Read announcement</span>
            <span className="truncate text-[12px] text-ink-3" title={a.title}>
              {[a.title, a.company].filter(Boolean).join(' · ')}
            </span>
          </div>
          <Button size="sm" className="h-8 shrink-0 px-3 font-medium" aria-label={`Open ${a.title}`} onClick={() => onOpen(a.id)}>
            Open
          </Button>
        </li>
      ))}
    </ul>
  );
}
