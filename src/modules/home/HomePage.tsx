import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { ApiError, apiGet, apiGetMeta, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { t } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dateLabel, dayLabel, greeting, relative, timeLabel, todayInZone, wallMinutes, wallTimeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { openAssistant } from '../../core/ui';
import { useCanOpen } from '../../core/access';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Chip, OfflineNote, cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import type { ModuleProps } from '../registry';
import { CATEGORIES, destinationOf, entryCategory, type CalendarEvent } from '../calendar/api';
import { ConflictFlag, useWaitingInvitations, type WaitingInvitation } from '../calendar/conflicts';
import { openMeeting } from '../meet/api';
import { dueOf, type Task } from '../tasks/api';
import { ALL_TASKS } from '../tasks/queries';
import { FileIcon } from '../files/Thumb';
import { isJunkFile } from '../files/api';
import { AllAnnouncements, AnnouncementReader, AnnouncementRows, forCompany, ranked, toAcknowledge, useMyAnnouncements } from './Announcements';
import { HeaderLink, Widget } from './Widget';
import { CARDS, DEFAULT_LAYOUT, compactCount, loadLayout, meetingsToday, move, place, resize, saveLayout, sizeOf, taskBuckets, toggle, type CardId, type Layout } from './today';

/**
 * Home — the desktop shell's dashboard (UI-04, §4.13; modernised in #104).
 * Every widget comes from a module the person can open; one they cannot is
 * simply absent (FR-REG-06). Each widget asks for its own data and says for
 * itself when it is loading or failed, with Retry, so nothing waits on the
 * slowest. The counts at the top are the lengths of the lists they open.
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
  const [newOpen, setNewOpen] = useState(false);
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
  const announcements = useMyAnnouncements();
  const summary = useQuery({ queryKey: ['home', 'summary'], queryFn: () => apiGet<Summary>('/api/dashboard/summary'), retry: false, staleTime: 10 * 60_000 });

  const reading = Number(query.get('announcement') ?? 0) || null;
  const readingAll = query.get('announcements') === 'all';

  const inCompany = (o: number | null | undefined) => company === null || o === null || o === undefined || String(o) === company;
  const myTasks = (tasks.data?.data.tasks ?? []).filter((x) => inCompany(x.org_id));
  const buckets = taskBuckets(myTasks, today);
  const agenda = events.data?.data.events ?? [];
  const meetings = meetingsToday(agenda);
  // Announcements: an older server without them, or one refusing, has no widget rather than an error.
  const noAnnouncements = announcements.error instanceof ApiError && (announcements.error.status === 404 || announcements.error.forbidden);
  const notices = ranked(forCompany(announcements.data ?? [], company));
  const acks = toAcknowledge(notices);
  const approvalItems = has('hr') ? (approvals.data?.items ?? []) : [];
  const waitingCount = (has('hr') ? (approvals.data?.count ?? 0) : 0) + (invitations.data?.length ?? 0) + acks.length;
  const unreadChat = has('chat') ? (status?.unread.chat ?? 0) : 0;
  const unreadMail = has('mail') ? (status?.unread.mail ?? 0) : 0;
  const offlineAt = dash.data?.offline ? dash.data.cachedAt : null;
  const activity = (dash.data?.data.activity ?? []).filter((a) => !NOISE.test(a.description ?? ''));
  const files = (dash.data?.data.recent_files ?? []).filter((f) => !isJunkFile(f.name));
  const onPlace = (moved: CardId, before: CardId) => setLayout(place(layout, moved, before));
  const common = (id: CardId) => ({ id, size: sizeOf(layout, id), onPlace });

  const cards: Record<CardId, ReactNode> = {
    work: has('tasks') ? (
      <Widget
        {...common('work')}
        title={t('home.todaysWork')}
        icon="tasks"
        count={buckets.overdue.length + buckets.today.length}
        countTone={buckets.overdue.length ? 'danger' : 'indigo'}
        action={<HeaderLink onClick={() => navigate('/tasks')}>All tasks</HeaderLink>}
        loading={tasks.isLoading}
        error={tasks.error}
        onRetry={() => void tasks.refetch()}
        empty={buckets.overdue.length + buckets.today.length + buckets.upcoming.length === 0 ? <><Icon name="check-circle" size={15} /> Nothing due. Enjoy the calm.</> : null}
      >
        <TaskSections buckets={buckets} today={today} onMore={(scope) => navigate(`/tasks?scope=${scope}`)} />
      </Widget>
    ) : null,
    calendar: has('calendar') ? (
      <Widget
        {...common('calendar')}
        title="Agenda"
        icon="calendar"
        count={agenda.length}
        action={<HeaderLink onClick={() => navigate('/calendar')}>Calendar</HeaderLink>}
        loading={events.isLoading}
        error={events.error}
        onRetry={() => void events.refetch()}
        empty={agenda.length === 0 ? <><Icon name="calendar" size={15} /> Nothing scheduled today.</> : null}
      >
        <Agenda events={agenda} canMeet={meet} onOpen={(route) => navigate(route)} />
      </Widget>
    ) : null,
    waiting: (
      <Widget
        {...common('waiting')}
        title={t('home.waiting')}
        icon="inbox"
        count={waitingCount}
        countTone="warning"
        loading={(has('hr') && approvals.isLoading) || invitations.isLoading}
        error={has('hr') && approvals.error && !(approvals.error instanceof ApiError && approvals.error.forbidden) ? approvals.error : null}
        onRetry={() => void approvals.refetch()}
        empty={waitingCount === 0 ? <><Icon name="check-circle" size={15} /> Nothing waiting for you.</> : null}
      >
        <div className="flex flex-col gap-3">
          {invitations.data?.length ? <WaitingInvitations items={invitations.data} onOpen={openLink} /> : null}
          {acks.length ? <AnnouncementRows items={acks} onOpen={(id) => go(`/home?announcement=${id}`)} limit={3} /> : null}
          {approvalItems.length ? <WaitingForMe items={approvalItems} onOpen={openLink} /> : null}
        </div>
      </Widget>
    ),
    announcements: noAnnouncements ? null : (
      <Widget
        {...common('announcements')}
        title="Announcements"
        icon="megaphone"
        count={notices.filter((a) => !a.read).length}
        countTone="indigo"
        action={notices.length ? <HeaderLink onClick={() => go('/home?announcements=all')}>See all</HeaderLink> : null}
        loading={announcements.isLoading}
        error={announcements.error}
        onRetry={() => void announcements.refetch()}
        empty={notices.length === 0 ? <><Icon name="megaphone" size={15} /> No announcements.</> : null}
      >
        <AnnouncementRows items={notices} onOpen={(id) => go(`/home?announcement=${id}`)} />
      </Widget>
    ),
    activity: has('activity') ? (
      <Widget
        {...common('activity')}
        title={t('home.activity')}
        icon="history"
        loading={dash.isLoading}
        error={dash.error}
        onRetry={() => void dash.refetch()}
        empty={activity.length === 0 ? <><Icon name="activity" size={15} /> Nothing new.</> : null}
      >
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {activity.slice(0, 6).map((a) => (
            <li key={a.id}>
              <button type="button" disabled={!a.link} onClick={() => a.link && openLink(a.link)} className="flex w-full gap-2.5 rounded-[8px] text-left enabled:hover:bg-subtle">
                <Avatar name={a.user ?? 'WorkSuite'} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">
                    {a.user ? <b>{a.user} </b> : null}
                    {a.description}
                    {a.count && a.count > 1 ? <span className="ml-1 rounded-full bg-subtle px-1.5 text-[11px] font-bold text-ink-2" title={`${a.count} updates`}>×{compactCount(a.count)}</span> : null}
                  </span>
                  <span className="block text-[12px] text-ink-3">{relative(a.at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Widget>
    ) : null,
    files: has('files') ? (
      <Widget
        {...common('files')}
        title={t('home.files')}
        icon="folder"
        action={<HeaderLink onClick={() => navigate('/files')}>Open Drive</HeaderLink>}
        loading={dash.isLoading}
        error={dash.error}
        onRetry={() => void dash.refetch()}
        empty={files.length === 0 ? <><Icon name="folder" size={15} /> No recent files.</> : null}
      >
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {files.slice(0, 6).map((f) => (
            <li key={f.id}>
              <button type="button" className="flex w-full items-center gap-2.5 rounded-[8px] p-1 text-left hover:bg-subtle" onClick={() => navigate(`/files?file=${f.id}`)}>
                <FileIcon f={{ id: f.id, name: f.name, extension: f.extension, has_thumb: !!f.thumbnail }} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink" title={f.name}>{f.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">{[f.kind ?? f.extension.toUpperCase(), f.location, relative(f.at)].filter(Boolean).join(' · ')}</span>
                </span>
                {f.status === 'processing' ? <Chip tone="warning">Processing</Chip> : f.status === 'failed' ? <Chip tone="danger">Failed</Chip> : null}
              </button>
            </li>
          ))}
        </ul>
      </Widget>
    ) : null,
    summary: (
      <Widget
        {...common('summary')}
        title={t('home.summary')}
        icon="sparkles"
        tone="navy"
        action={has('ai') ? <HeaderLink light onClick={() => openAssistant()}>Ask AI</HeaderLink> : null}
        loading={summary.isLoading}
      >
        <DailySummary summary={summary.data} error={summary.error} facts={{ today: buckets.today.length, overdue: buckets.overdue.length, meetings: meetings.length, unread: unreadChat + unreadMail, waiting: waitingCount }} onOpen={openLink} onNew={() => navigate('/notifications')} />
      </Widget>
    ),
  };

  const shown = layout.order.filter((id) => !layout.hidden.includes(id) && cards[id]);

  return (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 scroll-thin">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-bold tracking-tight text-ink">
              {greeting()}, {user?.name.split(' ')[0] ?? ''}
            </h1>
            <div className="text-[13px] text-ink-3">{dayLabel(today)}</div>
          </div>
          <div className="relative flex flex-wrap items-center gap-2">
            {offlineAt ? <OfflineNote cachedAt={offlineAt} /> : null}
            {orgs.length > 1 ? (
              <select aria-label="Company" value={company ?? ''} onChange={(e) => setCompany(e.target.value || null)} className="h-9 max-w-[220px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink">
                <option value="">All companies</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Button onClick={() => setCustomizing((v) => !v)} aria-haspopup="dialog" aria-expanded={customizing} icon="sliders">
              Customize
            </Button>
            {customizing ? <Customize layout={layout} onChange={setLayout} onClose={() => setCustomizing(false)} /> : null}
            <Button variant="primary" icon="plus" onClick={() => setNewOpen((v) => !v)} aria-haspopup="menu" aria-expanded={newOpen}>
              New
            </Button>
            {newOpen ? (
              <div className="animate-in absolute top-11 right-0 z-20 w-[200px] rounded-[10px] border border-line bg-surface p-1 shadow-xl" role="menu" onMouseLeave={() => setNewOpen(false)}>
                {has('tasks') ? <NewItem icon="tasks" label="Task" onClick={() => navigate('/tasks?new=1')} /> : null}
                {has('calendar') ? <NewItem icon="calendar-plus" label="Event" onClick={() => navigate('/calendar?new=1')} /> : null}
                {has('mail') ? <NewItem icon="mail" label="Email" onClick={() => navigate('/mail?compose=1')} /> : null}
                {has('crm') ? <NewItem icon="users" label="Lead" onClick={() => navigate('/crm?new=1')} /> : null}
                {has('files') ? <NewItem icon="upload" label="Upload file" onClick={() => navigate('/files?upload=1')} /> : null}
                {has('hr') ? <NewItem icon="calendar-clock" label="Leave request" onClick={() => navigate('/hr?tab=leave&new=1')} /> : null}
              </div>
            ) : null}
          </div>
        </header>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {has('tasks') ? (
            <>
              <Counter label="Due today" n={buckets.today.length} icon="tasks" tone="indigo" loading={tasks.isLoading} onClick={() => navigate('/tasks?scope=today')} />
              <Counter label="Overdue" n={buckets.overdue.length} icon="alert" tone="red" loading={tasks.isLoading} onClick={() => navigate('/tasks?scope=overdue')} />
              <Counter label="Upcoming" n={buckets.upcoming.length} icon="clock" tone="teal" loading={tasks.isLoading} onClick={() => navigate('/tasks?scope=upcoming')} />
            </>
          ) : null}
          {has('calendar') ? <Counter label={t('home.meetings')} n={meetings.length} icon="video" tone="teal" loading={events.isLoading} onClick={() => navigate(has('meetings') ? '/meetings' : '/calendar')} /> : null}
          <Counter label="Waiting for me" n={waitingCount} icon="inbox" tone="amber" onClick={() => document.querySelector('[data-card="waiting"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
          {has('chat') || has('mail') ? <Counter label={t('home.unread')} n={unreadChat + unreadMail} icon="chat" tone="red" onClick={() => navigate(has('chat') && (unreadChat >= unreadMail || !has('mail')) ? '/chat' : '/mail')} /> : null}
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {shown.map((id) => (
            <Fragment key={id}>{cards[id]}</Fragment>
          ))}
        </div>
      </div>
      {reading ? <AnnouncementReader id={reading} onClose={() => go('/home')} /> : null}
      {readingAll ? <AllAnnouncements items={notices} onOpen={(id) => go(`/home?announcement=${id}`)} onClose={() => go('/home')} /> : null}
    </div>
  );
}

/**
 * Which cards Home shows, in what order and how wide (QA-015, #104). Kept on
 * this computer for this person; Reset Layout puts it back as it came.
 */
function Customize({ layout, onChange, onClose }: { layout: Layout; onChange: (l: Layout) => void; onClose: () => void }) {
  const label = (id: CardId) => CARDS.find((c) => c.id === id)?.label ?? id;
  return (
    <div role="dialog" aria-label="Customize Home" className="animate-in absolute top-11 right-24 z-20 w-[330px] rounded-[12px] border border-line bg-surface p-3 shadow-xl" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-bold text-ink">Widgets on Home</span>
        <button type="button" onClick={onClose} className="text-[12.5px] font-semibold text-primary hover:underline">
          Done
        </button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {layout.order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-[8px] px-1.5 py-1 hover:bg-subtle">
            <Checkbox aria-label={`Show ${label(id)}`} checked={!layout.hidden.includes(id)} onChange={() => onChange(toggle(layout, id))} />
            <span className={cx('min-w-0 flex-1 text-[13px]', layout.hidden.includes(id) ? 'text-ink-3' : 'text-ink')}>{label(id)}</span>
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
            <button type="button" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => onChange(move(layout, id, -1))} className="rounded p-1 text-ink-2 hover:bg-line disabled:opacity-30">
              <Icon name="arrow-up" size={14} />
            </button>
            <button type="button" aria-label={`Move ${label(id)} down`} disabled={i === layout.order.length - 1} onClick={() => onChange(move(layout, id, 1))} className="rounded p-1 text-ink-2 hover:bg-line disabled:opacity-30">
              <Icon name="arrow-down" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <p className="m-0 flex-1 text-[11.5px] text-ink-3">Drag a widget by its handle to move it. Widgets for apps you don't have stay hidden.</p>
        <Button size="sm" onClick={() => onChange(DEFAULT_LAYOUT)}>
          Reset Layout
        </Button>
      </div>
    </div>
  );
}

function NewItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex h-9 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] text-ink hover:bg-subtle">
      <Icon name={icon} size={16} className="text-ink-2" /> {label}
    </button>
  );
}

/** A summary card: what it counts, compactly (the exact number on hover), and the list it opens. */
export function Counter({ label, n, icon, tone, onClick, loading }: { label: string; n: number; icon: string; tone: 'indigo' | 'teal' | 'amber' | 'red'; onClick: () => void; loading?: boolean }) {
  const tones = { indigo: 'bg-selection text-primary', teal: 'bg-teal/10 text-teal', amber: 'bg-warning-bg text-warning', red: 'bg-danger-bg text-badge' };
  return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${n}`} className="flex min-w-0 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left hover:border-primary/40">
      <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]', tones[tone])}>
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-[18px] leading-tight font-bold text-ink tabular" title={n.toLocaleString()}>
          {loading ? '–' : compactCount(n)}
        </span>
        <span className="block truncate text-[12px] text-ink-3">{label}</span>
      </span>
    </button>
  );
}

/** Overdue, due today and upcoming, apart, each with a way to the whole list. */
function TaskSections({ buckets, today, onMore }: { buckets: ReturnType<typeof taskBuckets>; today: string; onMore: (scope: 'overdue' | 'today' | 'upcoming') => void }) {
  const sections: Array<{ id: 'overdue' | 'today' | 'upcoming'; label: string; items: Task[]; tone: string }> = [
    { id: 'overdue', label: 'Overdue', items: buckets.overdue, tone: 'text-danger' },
    { id: 'today', label: 'Due today', items: buckets.today, tone: 'text-primary' },
    { id: 'upcoming', label: 'Upcoming', items: buckets.upcoming, tone: 'text-ink-2' },
  ];
  return (
    <div className="flex flex-col gap-3">
      {sections
        .filter((s) => s.items.length)
        .map((s) => (
          <section key={s.id} aria-label={s.label}>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold tracking-[0.5px] uppercase">
              <span className={s.tone}>{s.label}</span>
              <span className="text-ink-3" title={String(s.items.length)}>{compactCount(s.items.length)}</span>
              <span className="flex-1" />
              {s.items.length > 4 ? (
                <button type="button" onClick={() => onMore(s.id)} className="text-[11.5px] font-semibold tracking-normal text-primary normal-case hover:underline">
                  View all
                </button>
              ) : null}
            </div>
            <TaskRows tasks={s.items.slice(0, 4)} today={today} />
          </section>
        ))}
    </div>
  );
}

function TaskRows({ tasks, today }: { tasks: Task[]; today: string }) {
  const qc = useQueryClient();
  const { navigate } = useTab();
  const complete = useMutation({
    mutationFn: async (task: Task) => {
      const done = task.status !== 'done';
      const r = await call('offline:submit', {
        module: 'tasks',
        entity: 'task',
        entityId: String(task.id),
        label: `${done ? 'Complete' : 'Reopen'} “${task.title}”`,
        method: 'PATCH',
        path: `/api/tasks/${task.id}`,
        body: { field: 'status', value: done ? 'done' : 'todo' },
        queueIfOffline: true,
      });
      if (!r.delivered && !r.queued) throw new Error(r.error ?? 'Could not update the task.');
      return r;
    },
    onSuccess: (r) => {
      if (r.queued) toast('info', 'Offline — the change will sync when you reconnect.');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {tasks.map((task) => {
        const due = dueOf(task, today);
        return (
          <li key={task.id} className="flex items-center gap-2.5">
            <Checkbox checked={task.status === 'done'} onChange={() => complete.mutate(task)} aria-label={`Mark “${task.title}” done`} />
            <button type="button" onClick={() => navigate(`/tasks?task=${task.id}`)} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{task.title}</span>
              <span className={cx('shrink-0 text-[12px]', due.tone === 'overdue' ? 'text-danger' : 'text-ink-3')}>{due.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Today in order: time, what kind of entry, and its actions — open the record, join the meeting. */
function Agenda({ events, canMeet, onOpen }: { events: CalendarEvent[]; canMeet: boolean; onOpen: (route: string) => void }) {
  const [now] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const sorted = [...events].sort((a, b) => Number(b.all_day) - Number(a.all_day) || wallMinutes(a.start_at) - wallMinutes(b.start_at));
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {sorted.slice(0, 7).map((e) => {
        const to = destinationOf(e);
        const end = e.end_at ? wallMinutes(e.end_at) : wallMinutes(e.start_at) + 60;
        const live = !e.all_day && wallMinutes(e.start_at) <= now + 10 && end >= now;
        const past = !e.all_day && end < now;
        const kind = e.related?.kind_label ?? CATEGORIES.find((c) => c.id === entryCategory(e))?.label.replace(/s$/, '') ?? 'Event';
        const join = e.source === 'meeting' && e.uuid ? (canMeet ? () => void openMeeting(e.uuid!, e.title) : null) : e.join_url ? () => void call('app:openExternal', { url: e.join_url! }) : null;
        return (
          <li key={`${e.source}:${e.id}:${e.start_at}`} className={cx('flex items-center gap-2.5 rounded-[8px] px-2 py-1.5', live ? 'bg-selection' : 'hover:bg-subtle', past && 'opacity-60')}>
            <span className="w-[52px] shrink-0 text-[12.5px] font-semibold text-primary tabular">{e.all_day ? 'All day' : wallTimeLabel(e.start_at)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{e.title}</span>
              <span className="block truncate text-[12px] text-ink-3">{[kind, e.location].filter(Boolean).join(' · ')}</span>
            </span>
            {join && !past ? (
              <Button size="sm" variant={live ? 'primary' : 'secondary'} icon="video" onClick={join}>
                Join
              </Button>
            ) : null}
            {to?.route ? (
              <button type="button" aria-label={`${to.label}: ${e.title}`} title={to.label} onClick={() => onOpen(to.route!)} className="shrink-0 rounded-[6px] p-1 text-ink-2 hover:bg-line">
                <Icon name="chevron-right" size={15} />
              </button>
            ) : to?.web ? (
              <button type="button" aria-label={`${to.label}: ${e.title}`} title={to.label} onClick={() => void call('app:openInBrowser', { path: to.web! })} className="shrink-0 rounded-[6px] p-1 text-ink-2 hover:bg-line">
                <Icon name="external" size={14} />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The summary (#104): short, made of what you can open — each point goes to
 * where it comes from — and nothing guessed about you. A server that sends no
 * points gets the facts Home already has.
 */
function DailySummary({ summary, error, facts, onOpen, onNew }: { summary?: Summary; error: unknown; facts: { today: number; overdue: number; meetings: number; unread: number; waiting: number }; onOpen: (link: string) => void; onNew: () => void }) {
  const points = summary?.digest.points?.filter((p) => p.text) ?? [];
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const fallback = [
    facts.overdue ? `${plural(facts.overdue, 'task')} overdue` : null,
    `${plural(facts.today, 'task')} due today`,
    `${plural(facts.meetings, 'meeting')} today`,
    facts.waiting ? `${facts.waiting} waiting for you` : null,
    facts.unread ? `${plural(facts.unread, 'unread message')}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-navy-ink">
      {points.length ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
          {points.slice(0, 5).map((p, i) => (
            <li key={i}>
              {p.link ? (
                <button type="button" onClick={() => onOpen(p.link!)} className="text-left text-white hover:underline">
                  {p.text}
                </button>
              ) : (
                p.text
              )}
            </li>
          ))}
        </ul>
      ) : summary?.digest.text ? (
        <p className="m-0 line-clamp-5">{summary.digest.text}</p>
      ) : (
        <p className="m-0">{fallback.join(', ')}.</p>
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
      {!summary && error && !(error instanceof ApiError && error.forbidden) ? <p className="m-0 text-[12px]">The summary could not be prepared; these are today's numbers.</p> : null}
      <div>
        <button type="button" className="rounded-[8px] border border-white/20 px-2.5 py-1 text-[12.5px] font-semibold text-white hover:bg-white/10" onClick={onNew}>
          What's new
        </button>
      </div>
    </div>
  );
}

/** Invitations to answer, the ones that clash flagged. */
function WaitingInvitations({ items, onOpen }: { items: WaitingInvitation[]; onOpen: (link: string) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.slice(0, 4).map((i) => (
        <li key={`${i.source}:${i.id}`} className="flex items-center gap-2.5">
          <Icon name="calendar-check" size={16} className="shrink-0 text-ink-3" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="truncate text-[13px] font-semibold text-ink">Invitation · {i.title}</div>
            <div className="truncate text-[12px] text-ink-3">
              {dateLabel(i.start_at)} · {timeLabel(i.start_at)}
            </div>
            {i.conflicts.length ? <ConflictFlag conflicts={i.conflicts} className="self-start" /> : null}
          </div>
          <Button size="sm" onClick={() => onOpen(i.link)}>
            Answer
          </Button>
        </li>
      ))}
    </ul>
  );
}

function WaitingForMe({ items, onOpen }: { items: Approval[]; onOpen: (link: string) => void }) {
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
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.slice(0, 5).map((a) => (
        <li key={`${a.kind}:${a.id}`} className="flex items-center gap-2.5">
          <Icon name="check-check" size={16} className="shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-ink">
              {a.what} · {a.who}
            </div>
            <div className="truncate text-[12px] text-ink-3">{a.when}</div>
          </div>
          {a.kind === 'leave' && a.as !== 'responsible' ? (
            <>
              <Button size="sm" disabled={busy === a.id} onClick={() => void decide(a, 'rejected')}>
                Decline
              </Button>
              <Button size="sm" variant="success" disabled={busy === a.id} onClick={() => void decide(a, 'approved')}>
                Approve
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => onOpen(a.link)}>
              Review
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
