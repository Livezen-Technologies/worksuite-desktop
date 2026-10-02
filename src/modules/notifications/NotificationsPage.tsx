import { TaskReminderActions } from './TaskReminderActions';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useVisibleIds } from '../../core/access';
import { app, updatePrefs } from '../../core/app-state';
import { apiGet } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dateLabel, relative, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { refOf } from '../chat/cards/recordLinks';
import { RecordCard } from '../chat/cards/RecordCards';
import { act, appOf, bulk, fetchCentre, inView, K, markAllRead, openNotice, quickActions, sectioned, SECTION_LABEL, sectionOf, snoozedLabel, visibleCategories, visibleNotices, type Notice, type View } from './api';
import { NotifRow, SnoozeMenu } from './NotifRow';
import { SidePanel } from '../../components/SidePanel';
import { Checkbox } from '../../components/Checkbox';

const NotificationSettings = lazy(() => import('./Settings'));

/**
 * The notification centre (NotifCenter): the inbox and its views down the
 * side — mentions, approvals, what was assigned to you, snoozed, done — and
 * each app with what is unread in it; a searchable list with a bulk bar;
 * and the selected one in full, with the record it is about as a live card.
 * `/notifications/settings` is its settings.
 */
export default function NotificationsPage(_props: ModuleProps) {
  const { path } = useTab();
  if (path[1] === 'settings') {
    return (
      <Suspense fallback={<Spinner />}>
        <NotificationSettings />
      </Suspense>
    );
  }
  return <Centre />;
}

const VIEWS: Array<{ id: View; label: string; icon: string }> = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'mentions', label: 'Mentions', icon: 'at' },
  { id: 'approvals', label: 'Approvals', icon: 'check-circle' },
  { id: 'assigned', label: 'Assigned to me', icon: 'user-plus' },
  { id: 'snoozed', label: 'Snoozed', icon: 'snooze' },
  { id: 'archived', label: 'Done', icon: 'archive' },
];
const DERIVED: View[] = ['mentions', 'approvals', 'assigned'];

function Centre() {
  useTabTitle('Notifications');
  const qc = useQueryClient();
  const { navigate } = useTab();
  const [view, setView] = useState<View>('inbox');
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [snoozing, setSnoozing] = useState(false);
  const moduleNotifications = useStore(app, (s) => s.prefs?.moduleNotifications);
  const visible = useVisibleIds();

  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // One inbox read, for the rail's counts of the views the server does not count.
  const overview = useQuery({ queryKey: [...K.all, 'overview'], queryFn: ({ signal }) => fetchCentre({ view: 'inbox', perPage: 100 }, signal), refetchInterval: 60_000 });
  const snoozedCount = useQuery({ queryKey: [...K.all, 'count', 'snoozed'], queryFn: ({ signal }) => fetchCentre({ view: 'snoozed', perPage: 10 }, signal).then((c) => c.total) });
  const list = useInfiniteQuery({
    queryKey: [...K.all, 'centre', view, category, needle],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchCentre({ view, category, q: needle || undefined, page: pageParam }, signal),
    getNextPageParam: (last) => (last.page * last.per_page < last.total && !DERIVED.includes(view) ? last.page + 1 : undefined),
  });
  const labels = overview.data?.categories ?? list.data?.pages[0]?.categories;
  // Only what belongs to apps the person has (visibleNotices), in the list, the counts and the Apps rail.
  const items = useMemo(() => visibleNotices((list.data?.pages ?? []).flatMap((p) => p.notifications), visible), [list.data, visible]);
  const inbox = visibleNotices(overview.data?.notifications ?? [], visible);
  const counts: Partial<Record<View, number>> = {
    inbox: overview.data?.counts.unread,
    mentions: inbox.filter((n) => !n.read && inView(n, 'mentions')).length,
    approvals: inbox.filter((n) => !n.read && inView(n, 'approvals')).length,
    assigned: inbox.filter((n) => !n.read && inView(n, 'assigned')).length,
    snoozed: snoozedCount.data,
  };
  const byCat = visibleCategories(Object.entries(overview.data?.counts.by_category ?? {}), visible).sort((a, b) => b[1].unread - a[1].unread || b[1].total - a[1].total);
  const current = items.find((n) => n.id === selected) ?? null;
  const picked = items.filter((n) => checked.has(n.id));
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });

  const pick = (v: View, c: string | null = null) => {
    setView(v);
    setCategory(c);
    setSelected(null);
    setChecked(new Set());
  };
  const run = async (fn: () => Promise<unknown>, done: string, undo?: () => Promise<unknown>) => {
    try {
      await fn();
      setChecked(new Set());
      refresh();
      toast('info', done, undo ? { label: 'Undo', run: () => void undo().then(refresh, (e) => toast('error', errorMessage(e))) } : undefined);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const ids = picked.map((n) => n.id);
  const sameApp = picked.length && picked.every((n) => n.category === picked[0]!.category) ? picked[0]!.category : null;
  const muted = sameApp ? moduleNotifications?.[`cat:${sameApp}`] === false : false;
  const mute = (c: string, off: boolean): void =>
    void updatePrefs({ moduleNotifications: { ...(moduleNotifications ?? {}), [`cat:${c}`]: !off } }).then(
      () => toast('info', off ? `No desktop alerts from ${appOf(c, labels).short} on this computer. They still arrive here.` : `Desktop alerts from ${appOf(c, labels).short} are back on.`, off ? { label: 'Undo', run: () => mute(c, false) } : undefined),
      (e) => toast('error', errorMessage(e)),
    );
  const title = category ? appOf(category, labels).short : (VIEWS.find((v) => v.id === view)?.label ?? 'Inbox');
  const sections = view === 'archived' || view === 'snoozed' ? [{ section: null, items }] : sectioned(items);
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <div className="flex h-full min-h-0 bg-ground dark:bg-[#0A0F1E]">
      <SidePanel id="notifications" label="the notification views">
        <nav aria-label="Notification views" className="flex w-[232px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface px-3 py-4 scroll-thin dark:border-[#1E2848] dark:bg-[#0F1629]">
          <h1 className="m-0 px-2 pb-3 text-[18px] font-extrabold text-ink dark:text-[#E8EBF7]">Notifications</h1>
          {VIEWS.map((v) => (
            <RailItem key={v.id} icon={v.icon} label={v.label} count={counts[v.id]} on={view === v.id && !category} onClick={() => pick(v.id)} />
          ))}
          {byCat.length ? <div className="px-2 pt-4 pb-1 text-[10.5px] font-extrabold tracking-[.8px] text-ink-3 dark:text-[#6B7496]">APPS</div> : null}
          {byCat.map(([c, n]) => {
            const a = appOf(c, labels);
            return <RailItem key={c} icon={a.icon} tone={a.acc} label={a.short} count={n.unread || undefined} on={category === c} onClick={() => pick('inbox', c)} />;
          })}
          <span className="min-h-4 flex-1" />
          <RailItem icon="settings" label="Settings" onClick={() => navigate('/notifications/settings')} />
        </nav>
      </SidePanel>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-5 py-3 dark:border-[#1E2848] dark:bg-[#0F1629]">
          <h2 className="m-0 min-w-0 shrink-0 truncate text-[16px] font-extrabold text-ink dark:text-[#E8EBF7]">{title}</h2>
          <label className="ml-3 flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 focus-within:border-primary dark:border-[#26315A] dark:bg-[#111A31]">
            <Icon name="search" size={15} className="text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notifications" placeholder="Search notifications" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none dark:text-[#E8EBF7]" />
          </label>
          <Button size="sm" icon="check-check" disabled={!counts.inbox} onClick={() => void markAllRead().then(refresh, (e) => toast('error', errorMessage(e)))}>
            Mark all read
          </Button>
          <Button size="sm" icon="settings" onClick={() => navigate('/notifications/settings')}>
            Settings
          </Button>
        </div>

        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-5 text-[12.5px] dark:border-[#1E2848] dark:bg-[#0F1629]" aria-label="Selection">
          <Checkbox
            aria-label="Select all shown"
            checked={items.length > 0 && picked.length === items.length}
            indeterminate={picked.length > 0 && picked.length < items.length}
            onChange={(e) => setChecked(e.target.checked ? new Set(items.map((n) => n.id)) : new Set())}
          />
          {picked.length ? (
            <>
              <b className="text-ink dark:text-[#E8EBF7]">{picked.length} selected</b>
              <Bar icon="check" label="Mark read" onClick={() => void run(() => bulk(ids, 'read'), 'Marked read')} />
              <Bar icon="mail" label="Mark unread" onClick={() => void run(() => bulk(ids, 'unread'), 'Marked unread')} />
              {view !== 'archived' ? (
                <span className="relative">
                  <Bar icon="snooze" label="Snooze" onClick={() => setSnoozing(!snoozing)} />
                  {snoozing ? (
                    <SnoozeMenu
                      align="left"
                      onClose={() => setSnoozing(false)}
                      onPick={(m) => {
                        setSnoozing(false);
                        void run(() => Promise.all(ids.map((id) => act(id, 'snooze', m))), snoozedLabel(m), () => Promise.all(ids.map((id) => act(id, 'unsnooze'))));
                      }}
                    />
                  ) : null}
                </span>
              ) : null}
              {view === 'archived' ? (
                <Bar icon="undo" label="Back to the inbox" onClick={() => void run(() => Promise.all(ids.map((id) => act(id, 'unarchive'))), 'Back in the inbox')} />
              ) : (
                <Bar icon="archive" label="Done" onClick={() => void run(() => bulk(ids, 'archive'), `${ids.length} moved to Done`, () => Promise.all(ids.map((id) => act(id, 'unarchive'))))} />
              )}
              {sameApp ? <Bar icon={muted ? 'bell' : 'bell-off'} label={muted ? `Desktop alerts from ${appOf(sameApp, labels).short}` : `Mute ${appOf(sameApp, labels).short} on this computer`} onClick={() => mute(sameApp, !muted)} /> : null}
            </>
          ) : (
            <span className="text-ink-3 dark:text-[#8D96B8]">{list.data ? (DERIVED.includes(view) ? `${items.length} among the latest hundred` : `${total} ${total === 1 ? 'notification' : 'notifications'}`) : ''}</span>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto px-3 py-2 scroll-thin" data-notif-list>
            {list.isLoading ? <Spinner /> : null}
            {list.error ? <p className="px-4 py-8 text-center text-[13px] text-ink-3">These could not be loaded. {errorMessage(list.error)}</p> : null}
            {sections.map((g, i) => (
              <div key={g.section ?? i}>
                {g.section ? (
                  <div className="flex items-center gap-2 px-3 pt-3.5 pb-1.5">
                    <span className={cx('text-[11px] font-extrabold tracking-[.8px] uppercase', g.section === 'needs' ? 'text-[#C2410C] dark:text-[#FFB38A]' : 'text-ink-3 dark:text-[#8D96B8]')}>{SECTION_LABEL[g.section]}</span>
                    <span className="text-[11px] font-bold text-ink-3 dark:text-[#6B7496]">{g.items.length}</span>
                    <span className="h-px flex-1 bg-line dark:bg-[#1E2848]" />
                  </div>
                ) : null}
                {g.items.map((n) => (
                  <NotifRow
                    key={n.id}
                    n={n}
                    labels={labels}
                    selected={n.id === selected}
                    onSelect={() => {
                      setSelected(n.id);
                      if (!n.read) void act(n.id, 'read').then(refresh, () => undefined);
                    }}
                    checked={checked.has(n.id)}
                    onCheck={(on) => {
                      const next = new Set(checked);
                      if (on) next.add(n.id);
                      else next.delete(n.id);
                      setChecked(next);
                    }}
                  />
                ))}
              </div>
            ))}
            {!list.isLoading && !list.error && !items.length ? (
              <div className="flex flex-col items-center gap-2 px-8 py-20 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[#E3F6EE] text-[#1F9D6B] dark:bg-[#12291F] dark:text-[#6FE0B0]">
                  <Icon name="check-check" size={26} />
                </span>
                <b className="text-[15px] text-ink dark:text-[#F2F4FB]">{view === 'snoozed' ? 'Nothing is snoozed' : view === 'archived' ? 'Nothing is done yet' : 'You’re all caught up'}</b>
                <span className="text-[12.5px] text-ink-3">{needle ? 'Nothing matches the search.' : 'Nothing here.'}</span>
              </div>
            ) : null}
            {list.hasNextPage ? (
              <div className="flex justify-center py-3">
                <Button size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                  Show more
                </Button>
              </div>
            ) : null}
          </div>
          <Preview key={current?.id ?? 'none'} n={current} labels={labels} onChanged={refresh} />
        </div>
      </section>
    </div>
  );
}

function RailItem({ icon, label, count, on, tone, onClick }: { icon: string; label: string; count?: number; on?: boolean; tone?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      className={cx('flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[9px] px-2 text-left text-[13px] font-semibold', on ? 'bg-selection text-primary dark:bg-[#1A2549] dark:text-[#E8EBF7]' : 'text-ink-2 hover:bg-subtle dark:text-[#C9CFE6] dark:hover:bg-[#141D38]')}
    >
      <span className="flex" style={tone ? { color: tone } : undefined}>
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className={cx('rounded-full px-1.5 text-[11px] font-bold', on ? 'bg-primary text-white' : 'bg-subtle text-ink-2 dark:bg-[#1B2542] dark:text-[#C9CFE6]')}>{count}</span> : null}
    </button>
  );
}

function Bar({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 font-semibold whitespace-nowrap text-ink hover:bg-subtle dark:text-[#E8EBF7] dark:hover:bg-[#1A2442]">
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

interface Delivery {
  channel: string;
  state: string;
  target: string | null;
  reason: string | null;
  sent_at: string | null;
}
const CHANNEL: Record<string, string> = { email: 'by email', web_push: 'to your browser', chat: 'in your System conversation', whatsapp: 'on WhatsApp', sms: 'by text message', webhook: 'to a webhook', slack: 'to Slack', teams: 'to Teams' };

/** The one selected: all of it, the record it is about as its card, and what can be done. */
function Preview({ n, labels, onChanged }: { n: Notice | null; labels?: Record<string, string>; onChanged: () => void }) {
  const [snoozing, setSnoozing] = useState(false);
  const deliveries = useQuery({
    queryKey: [...K.all, 'deliveries', n?.id],
    queryFn: ({ signal }) => apiGet<{ deliveries: Delivery[] }>('/api/notifications/deliveries', { notification_id: n!.id }, signal),
    enabled: !!n,
    staleTime: 60_000,
    retry: false,
  });
  if (!n) {
    return (
      <aside className="hidden w-[380px] shrink-0 flex-col items-center justify-center gap-2 border-l border-line bg-surface px-8 text-center text-[13px] text-ink-3 xl:flex dark:border-[#1E2848] dark:bg-[#0F1629]">
        <Icon name="bell" size={28} />
        Choose a notification to see all of it here.
      </aside>
    );
  }
  const a = appOf(n.category, labels);
  const ref = n.link ? refOf(n.link) : null;
  const q = quickActions(n)[0];
  const sent = (deliveries.data?.deliveries ?? []).filter((d) => d.channel !== 'in_app' && d.state === 'sent').map((d) => CHANNEL[d.channel] ?? d.channel);
  const run = (fn: () => Promise<unknown>, done: string) =>
    void fn().then(
      () => (onChanged(), toast('info', done)),
      (e) => toast('error', errorMessage(e)),
    );
  return (
    <aside aria-label="Notification" className="hidden w-[380px] shrink-0 flex-col border-l border-line bg-surface xl:flex dark:border-[#1E2848] dark:bg-[#0F1629]" data-notif-preview>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-5 scroll-thin">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-3 dark:text-[#8D96B8]">
          <span>{n.archived ? 'Done' : SECTION_LABEL[sectionOf(n)]}</span>
          <Icon name="chevron-right" size={12} />
          <span style={{ color: a.acc }}>{a.short}</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] [background:var(--tl)] dark:[background:var(--td)]" style={{ color: a.acc, ['--tl' as string]: a.tintLight, ['--td' as string]: a.tint }}>
            <Icon name={a.icon} size={19} />
          </span>
          <h3 className="m-0 text-[16px] leading-snug font-extrabold text-ink dark:text-[#F2F4FB]">{n.title}</h3>
        </div>
        {n.body ? <p className="m-0 text-[13px] leading-[1.55] whitespace-pre-wrap text-ink-2 dark:text-[#C9CFE6]">{n.body}</p> : null}
        {n.image_url ? <img src={n.image_url} alt="" className="max-h-[220px] rounded-[10px] border border-line object-cover dark:border-[#26315A]" /> : null}
        {n.count > 1 ? <p className="m-0 text-[12.5px] text-ink-3">{n.count} alike, folded into this one.</p> : null}
        {ref ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-extrabold tracking-[.7px] text-ink-3 dark:text-[#8D96B8]">WHAT IT IS ABOUT</span>
            <RecordCard r={ref} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 border-t border-line px-5 py-3 dark:border-[#1E2848]">
        <div className="flex flex-wrap gap-1.5">
          {q ? (
            <Button variant="primary" size="sm" onClick={() => openNotice(n)}>
              {q.label}
            </Button>
          ) : null}
          <TaskReminderActions notice={n} />
          <Button size="sm" onClick={() => run(() => act(n.id, n.read ? 'unread' : 'read'), n.read ? 'Marked unread' : 'Marked read')}>
            {n.read ? 'Mark unread' : 'Mark read'}
          </Button>
          {!n.archived ? (
            <span className="relative">
              <Button size="sm" onClick={() => setSnoozing(!snoozing)}>
                Snooze
              </Button>
              {snoozing ? (
                <SnoozeMenu
                  align="left"
                  up
                  onClose={() => setSnoozing(false)}
                  onPick={(m) => {
                    setSnoozing(false);
                    run(() => act(n.id, 'snooze', m), snoozedLabel(m));
                  }}
                />
              ) : null}
            </span>
          ) : null}
          {n.archived ? (
            <Button size="sm" onClick={() => run(() => act(n.id, 'unarchive'), 'Back in the inbox')}>
              Back to the inbox
            </Button>
          ) : (
            <Button size="sm" onClick={() => run(() => act(n.id, 'archive'), 'Moved to Done')}>
              Done
            </Button>
          )}
        </div>
        <span className="text-[11.5px] text-ink-3 dark:text-[#8D96B8]">
          Received {relative(n.created_at)} · {dateLabel(n.created_at)} {timeLabel(n.created_at)}
          {sent.length ? ` · also sent ${sent.join(' and ')}` : ''}
        </span>
      </div>
    </aside>
  );
}
