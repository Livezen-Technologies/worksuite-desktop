import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { app, organizationName } from '../../core/app-state';
import { ApiError, apiGet, apiGetMeta, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { t } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dateLabel, dayLabel, greeting, relative, timeLabel, todayInZone, wallMinutes, wallTimeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { openAssistant } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { Avatar, Button, Card, CountBadge, Empty, ErrorNote, FileBadge, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import type { CalendarEvent } from '../calendar/api';
import type { Task } from '../tasks/api';
import { CARDS, dueToday as dueTodayOf, loadLayout, meetingsToday, mergeTasks, move, saveLayout, todaysWork, toggle, type CardId, type Layout } from './today';
import { Checkbox } from '../../components/Checkbox';
import { ConflictFlag, useWaitingInvitations, type WaitingInvitation } from '../calendar/conflicts';

/**
 * Home — the desktop shell's dashboard (UI-04, §4.13). Every widget comes
 * from a module the user can open; one they cannot is simply absent
 * (FR-REG-06).
 */
interface Dashboard {
  user: { name: string };
  stats: { my_tasks: number; tasks_overdue: number; unread_mail: number; unread_chats: number; notifications_unread: number };
  pending_tasks: Array<{ id: number; title: string; status: string; priority: string; due_date: string | null; overdue: boolean }>;
  recent_files: Array<{ id: number; name: string; extension: string; size: number; location: string; at: string }>;
  activity: Array<{ id: number; description: string | null; user: string | null; at: string }>;
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

export default function HomePage(_props: ModuleProps) {
  useTabTitle(t('nav.home'));
  const { navigate, openLink } = useTab();
  const user = useStore(app, (s) => s.auth?.user);
  const orgId = useStore(app, (s) => s.organizationId);
  const apps = useStore(app, (s) => s.apps);
  const status = useStore(app, (s) => s.status);
  const has = (id: string) => apps.some((a) => a.id === id);
  const today = todayInZone();
  const [newOpen, setNewOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [layout, setLayoutState] = useState<Layout>(() => loadLayout(user?.id));
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    saveLayout(user?.id, l);
  };

  const dash = useQuery({ queryKey: ['home', 'dashboard'], queryFn: () => apiGetMeta<Dashboard>('/api/dashboard/home') });
  const tasks = useQuery({
    queryKey: ['tasks', 'today', orgId],
    // Yours, and those you were added to afterwards — which only `shared` returns (QA-014).
    queryFn: async () => {
      const [mine, shared] = await Promise.all([
        apiGetMeta<{ tasks: Task[] }>('/api/tasks', { filter: 'active', org: orgId }),
        apiGetMeta<{ tasks: Task[] }>('/api/tasks', { filter: 'shared' }).catch(() => null),
      ]);
      return { ...mine, data: { tasks: mergeTasks(mine.data.tasks ?? [], shared?.data.tasks ?? []) } };
    },
    enabled: has('tasks'),
  });
  const events = useQuery({
    queryKey: ['calendar', today, today],
    queryFn: () => apiGetMeta<{ events: CalendarEvent[] }>('/api/calendar/events', { from: today, to: today }),
    enabled: has('calendar'),
  });
  // Invitations waiting for your answer, flagged when they overlap something you have (worksuite-desktop#99).
  const invitations = useWaitingInvitations(has('calendar') || has('meetings'));
  const approvals = useQuery({
    queryKey: ['hr', 'approvals'],
    queryFn: () => apiGet<{ count: number; items: Approval[] }>('/api/hr/approvals/pending'),
    enabled: has('hr'),
    retry: false,
  });
  const summary = useQuery({
    queryKey: ['home', 'summary'],
    queryFn: () => apiGet<{ total: number; digest: { text: string | null; reason: string | null } }>('/api/dashboard/summary'),
    retry: false,
    staleTime: 10 * 60_000,
  });

  const dueToday = dueTodayOf(tasks.data?.data.tasks ?? [], today);
  const meetings = meetingsToday(events.data?.data.events ?? []);
  // Unread counts only of the apps the person has: someone without Mail is not told about mail.
  const unreadChat = has('chat') ? (status?.unread.chat ?? 0) : 0;
  const unreadMail = has('mail') ? (status?.unread.mail ?? 0) : 0;
  const unread = unreadChat + unreadMail;
  const offlineAt = dash.data?.offline ? dash.data.cachedAt : null;

  const cards: Record<CardId, ReactNode> = {
    work: has('tasks') ? (
          <Card title={t('home.todaysWork')} action={<LinkButton onClick={() => navigate('/tasks')}>All tasks</LinkButton>} className="min-h-[300px]">
            <TodaysWork loading={tasks.isLoading} error={tasks.error} tasks={todaysWork(tasks.data?.data.tasks ?? [], today).slice(0, 8)} today={today} />
          </Card>
    ) : null,
    calendar: has('calendar') ? (
          <Card title={t('home.calendar')} action={<span className="text-[13px] text-ink-3">Today</span>} className="min-h-[300px]">
            <TodayCalendar loading={events.isLoading} events={events.data?.data.events ?? []} />
          </Card>
    ) : null,
    waiting: (has('hr') && approvals.data) || invitations.data?.length ? (
          <Card title={t('home.waiting')} action={approvals.data?.count ? <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[12px] font-semibold text-warning">{approvals.data.count} approvals</span> : null} className="min-h-[300px]">
            {invitations.data?.length ? <WaitingInvitations items={invitations.data} onOpen={openLink} /> : null}
            {has('hr') && approvals.data && (approvals.data.items.length || !invitations.data?.length) ? <WaitingForMe items={approvals.data.items} onOpen={openLink} /> : null}
          </Card>
    ) : null,
    activity: has('activity') ? (
        <Card title={t('home.activity')} className="min-h-[260px]">
          {dash.isLoading ? <Spinner /> : dash.error ? <ErrorNote error={dash.error} onRetry={() => void dash.refetch()} /> : null}
          {(dash.data?.data.activity ?? []).length === 0 && !dash.isLoading ? <Empty icon="activity" title="Nothing new" /> : null}
          <ul className="flex flex-col gap-3">
            {(dash.data?.data.activity ?? []).slice(0, 5).map((a) => (
              <li key={a.id} className="flex gap-3">
                <Avatar name={a.user ?? 'WorkSuite'} size={32} />
                <div className="min-w-0">
                  <div className="text-[13.5px] text-ink">
                    {a.user ? <span className="font-semibold">{a.user} </span> : null}
                    {a.description}
                  </div>
                  <div className="text-[12.5px] text-ink-3">{relative(a.at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
    ) : null,
    files: has('files') ? (
          <Card title={t('home.files')} action={<LinkButton onClick={() => navigate('/files')}>Open Drive</LinkButton>} className="min-h-[260px]">
            <ul className="flex flex-col gap-2">
              {(dash.data?.data.recent_files ?? []).slice(0, 5).map((f) => (
                <li key={f.id}>
                  <button type="button" className="flex w-full items-center gap-3 rounded-[8px] p-1 text-left hover:bg-subtle" onClick={() => navigate(`/files?file=${f.id}`)}>
                    <FileBadge name={f.name} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{f.name}</span>
                    <span className="text-[12px] text-ink-3">{relative(f.at)}</span>
                  </button>
                </li>
              ))}
              {!dash.isLoading && (dash.data?.data.recent_files ?? []).length === 0 ? <Empty icon="folder" title="No recent files" /> : null}
            </ul>
          </Card>
    ) : null,
    summary: (
        <section className="flex min-h-[260px] flex-col rounded-[12px] bg-navy p-5 text-white">
          <h2 className="flex items-center gap-2 text-[15px] font-bold">
            <Icon name="sparkles" size={17} className="text-teal-light" /> {t('home.summary')}
          </h2>
          <p className="mt-3 flex-1 text-[13.5px] leading-relaxed text-navy-ink">
            {summary.isLoading
              ? 'Preparing your summary…'
              : summary.data?.digest.text
                ? summary.data.digest.text
                : summary.error instanceof ApiError && summary.error.forbidden
                  ? 'Your daily summary is built from the company wall, which is not enabled for you.'
                  : (summary.data?.digest.reason ?? `${dueToday.length} task${dueToday.length === 1 ? '' : 's'} due today, ${meetings.length} meeting${meetings.length === 1 ? '' : 's'} and ${unread} unread message${unread === 1 ? '' : 's'}.`)}
          </p>
          <div className="mt-4 flex gap-2">
            {has('ai') ? (
              <button type="button" className="rounded-[8px] bg-teal-light px-3 py-2 text-[13px] font-semibold text-navy hover:opacity-90" onClick={() => openAssistant()}>
                Ask AI
              </button>
            ) : null}
            <button type="button" className="rounded-[8px] border border-white/20 px-3 py-2 text-[13px] font-semibold hover:bg-white/10" onClick={() => navigate('/notifications')}>
              What's new
            </button>
          </div>
        </section>
    ),
  };

  return (
    <div className="h-full overflow-y-auto px-8 py-7 scroll-thin">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[14px] text-ink-3">
              {dayLabel(today)} · {organizationName(orgId)}
            </div>
            <h1 className="mt-1 text-[28px] font-bold tracking-tight text-ink">
              {greeting()}, {user?.name.split(' ')[0] ?? ''}
            </h1>
          </div>
          <div className="relative flex items-center gap-2">
            {offlineAt ? <OfflineNote cachedAt={offlineAt} /> : null}
            <Button size="lg" onClick={() => setCustomizing((v) => !v)} aria-haspopup="dialog" aria-expanded={customizing}>
              Customize
            </Button>
            {customizing ? <Customize layout={layout} onChange={setLayout} onClose={() => setCustomizing(false)} /> : null}
            <Button size="lg" variant="primary" icon="plus" onClick={() => setNewOpen((v) => !v)} aria-haspopup="menu" aria-expanded={newOpen}>
              New
            </Button>
            {newOpen ? (
              <div className="animate-in absolute top-12 right-0 z-20 w-[200px] rounded-[10px] border border-line bg-surface p-1 shadow-xl" role="menu" onMouseLeave={() => setNewOpen(false)}>
                {has('tasks') ? <NewItem icon="tasks" label="Task" onClick={() => navigate('/tasks?new=1')} /> : null}
                {has('mail') ? <NewItem icon="mail" label="Email" onClick={() => navigate('/mail?compose=1')} /> : null}
                {has('crm') ? <NewItem icon="users" label="Lead" onClick={() => navigate('/crm?new=1')} /> : null}
                {has('files') ? <NewItem icon="upload" label="Upload file" onClick={() => navigate('/files?upload=1')} /> : null}
                {has('hr') ? <NewItem icon="calendar-clock" label="Leave request" onClick={() => navigate('/hr?tab=leave&new=1')} /> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {has('tasks') ? <Counter label={t('home.tasksDue')} n={dueToday.length} tone="indigo" onClick={() => navigate('/tasks?filter=today')} /> : null}
          {has('calendar') ? <Counter label={t('home.meetings')} n={meetings.length} tone="teal" onClick={() => navigate(has('meetings') ? '/meetings' : '/calendar')} /> : null}
          {has('hr') && approvals.data ? <Counter label={t('home.approvals')} n={approvals.data.count} tone="amber" onClick={() => navigate('/hr?tab=approvals')} /> : null}
          {has('chat') || has('mail') ? <Counter label={t('home.unread')} n={unread} tone="red" onClick={() => navigate(has('chat') && (unreadChat >= unreadMail || !has('mail')) ? '/chat' : '/mail')} /> : null}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {layout.order.filter((id) => !layout.hidden.includes(id) && cards[id]).map((id) => (
            <Fragment key={id}>{cards[id]}</Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Which cards Home shows, and in what order (QA-015: the button opened
 * Settings › Preferences, which has nothing about Home). Kept on this computer
 * for this person.
 */
function Customize({ layout, onChange, onClose }: { layout: Layout; onChange: (l: Layout) => void; onClose: () => void }) {
  const label = (id: CardId) => CARDS.find((c) => c.id === id)?.label ?? id;
  return (
    <div role="dialog" aria-label="Customize Home" className="animate-in absolute top-12 right-24 z-20 w-[300px] rounded-[12px] border border-line bg-surface p-3 shadow-xl" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-bold text-ink">Cards on Home</span>
        <button type="button" onClick={onClose} className="text-[12.5px] font-semibold text-primary hover:underline">
          Done
        </button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {layout.order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-[8px] px-1.5 py-1 hover:bg-subtle">
            <Checkbox aria-label={`Show ${label(id)}`} checked={!layout.hidden.includes(id)} onChange={() => onChange(toggle(layout, id))} />
            <span className={cx('min-w-0 flex-1 text-[13px]', layout.hidden.includes(id) ? 'text-ink-3' : 'text-ink')}>{label(id)}</span>
            <button type="button" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => onChange(move(layout, id, -1))} className="rounded p-1 text-ink-2 hover:bg-line disabled:opacity-30">
              <Icon name="arrow-up" size={14} />
            </button>
            <button type="button" aria-label={`Move ${label(id)} down`} disabled={i === layout.order.length - 1} onClick={() => onChange(move(layout, id, 1))} className="rounded p-1 text-ink-2 hover:bg-line disabled:opacity-30">
              <Icon name="arrow-down" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 mb-0 text-[11.5px] text-ink-3">Cards for apps you don't have stay hidden. Kept on this computer.</p>
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

function LinkButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] font-semibold text-primary underline hover:no-underline">
      {children}
    </button>
  );
}

function Counter({ label, n, tone, onClick }: { label: string; n: number; tone: 'indigo' | 'teal' | 'amber' | 'red'; onClick: () => void }) {
  const tones = { indigo: 'bg-selection text-primary', teal: 'bg-teal/10 text-teal', amber: 'bg-warning-bg text-warning', red: 'bg-danger-bg text-badge' };
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 text-[14px] font-semibold text-ink hover:border-primary/40">
      {label}
      <span className={cx('min-w-[28px] rounded-full px-2 py-0.5 text-center text-[13px] font-bold tabular', tones[tone])}>{n}</span>
    </button>
  );
}

function TodaysWork({ tasks, today, loading, error }: { tasks: Task[]; today: string; loading: boolean; error: unknown }) {
  const qc = useQueryClient();
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
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (tasks.length === 0) return <Empty icon="check-circle" title="Nothing due today" hint="Enjoy the calm." />;
  return (
    <ul className="flex flex-col gap-3">
      {tasks.map((task) => {
        const done = task.status === 'done';
        const overdue = !done && task.due_date !== null && task.due_date < today;
        return (
          <li key={task.id} className="flex items-start gap-3">
            <Checkbox checked={done} onChange={() => complete.mutate(task)} className="mt-0.5" aria-label={`Mark “${task.title}” ${done ? 'not done' : 'done'}`} />
            <div className="min-w-0">
              <div className={cx('text-[14px] font-semibold', done ? 'text-ink-3 line-through' : 'text-ink')}>{task.title}</div>
              <div className={cx('text-[12.5px]', overdue ? 'text-danger' : 'text-ink-3')}>
                {task.org_name ?? 'Tasks'} · {done ? 'done' : overdue ? `overdue ${Math.max(1, Math.round((Date.parse(today) - Date.parse(task.due_date!)) / 86_400_000))} day(s)` : task.status.replace('_', ' ')}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TodayCalendar({ events, loading }: { events: CalendarEvent[]; loading: boolean }) {
  const [now] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  if (loading) return <Spinner />;
  if (events.length === 0) return <Empty icon="calendar" title="Nothing scheduled today" />;
  const current = events.find((e) => !e.all_day && wallMinutes(e.start_at) <= now + 10 && (e.end_at ? wallMinutes(e.end_at) : wallMinutes(e.start_at) + 60) >= now && e.join_url);
  return (
    <div className="flex h-full flex-col gap-2.5">
      {events.slice(0, 5).map((e) => (
        <div key={`${e.source}:${e.id}:${e.start_at}`} className={cx('flex gap-4 rounded-[10px] px-4 py-3', e === current ? 'bg-selection' : 'bg-subtle')}>
          <span className="w-[56px] shrink-0 font-mono text-[13px] font-semibold text-primary">{e.all_day ? 'All day' : wallTimeLabel(e.start_at)}</span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-ink">{e.title}</span>
            <span className="block truncate text-[12.5px] text-ink-3">{e.location ?? (e.source === 'meeting' ? 'WorkSuite Meet' : e.source)}</span>
          </span>
        </div>
      ))}
      <div className="flex-1" />
      {current?.join_url ? (
        <Button variant="primary" size="lg" icon="video" onClick={() => void call('app:openExternal', { url: current.join_url! })}>
          Join {current.title}
        </Button>
      ) : null}
    </div>
  );
}

/** Invitations to answer, the ones that clash flagged. */
function WaitingInvitations({ items, onOpen }: { items: WaitingInvitation[]; onOpen: (link: string) => void }) {
  return (
    <ul className="mb-3 flex flex-col gap-3">
      {items.slice(0, 4).map((i) => (
        <li key={`${i.source}:${i.id}`} className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="truncate text-[14px] font-semibold text-ink">Invitation · {i.title}</div>
            <div className="truncate text-[12.5px] text-ink-3">{dateLabel(i.start_at)} · {timeLabel(i.start_at)}</div>
            {i.conflicts.length ? <ConflictFlag conflicts={i.conflicts} className="self-start" /> : null}
          </div>
          <Button size="sm" onClick={() => onOpen(i.link)}>
            Answer
          </Button>
        </li>
      ))}
      {items.length > 4 ? <CountBadge n={items.length - 4} tone="muted" /> : null}
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
  if (items.length === 0) return <Empty icon="check-circle" title="Nothing waiting for you" />;
  return (
    <ul className="flex flex-col gap-3">
      {items.slice(0, 5).map((a) => (
        <li key={`${a.kind}:${a.id}`} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-ink">
              {a.what} · {a.who}
            </div>
            <div className="truncate text-[12.5px] text-ink-3">{a.when}</div>
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
      {items.length > 5 ? <CountBadge n={items.length - 5} tone="muted" /> : null}
    </ul>
  );
}
