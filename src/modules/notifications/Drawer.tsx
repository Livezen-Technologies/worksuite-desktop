import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { closeOverlay } from '../../core/ui';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { Popover } from '../../app/overlays/Popover';
import { appOf, fetchCentre, isApproval, isMention, K, markAllRead, sectioned, SECTION_LABEL, type Notice } from './api';
import { NotifRow } from './NotifRow';

/**
 * The bell's drawer (NotifDrawer): what is new, with what needs you first,
 * then today, then earlier; filtered to unread, mentions or approvals, or to
 * one app. Everything a row can do is on the row. "Do not disturb" stops this
 * computer's banners and sounds until tomorrow morning; nothing is lost, the
 * list still fills.
 */
type Filter = 'all' | 'unread' | 'mentions' | 'approvals';
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['mentions', 'Mentions'],
  ['approvals', 'Approvals'],
];

export function NotifDrawer() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [apps, setApps] = useState(false);
  const q = useQuery({
    queryKey: [...K.all, 'drawer', filter === 'unread' ? 'unread' : 'inbox', category],
    queryFn: ({ signal }) => fetchCentre({ view: filter === 'unread' ? 'unread' : 'inbox', category, perPage: 60 }, signal),
    refetchInterval: 60_000,
  });
  const paused = useStore(app, (s) => s.status?.notificationsPausedUntil);
  const unread = q.data?.counts.unread ?? 0;
  const labels = q.data?.categories;
  const list = (q.data?.notifications ?? []).filter((n: Notice) => (filter === 'mentions' ? isMention(n) : filter === 'approvals' ? isApproval(n) : true));
  const groups = sectioned(list);
  const byCat = Object.entries(q.data?.counts.by_category ?? {}).sort((a, b) => b[1].total - a[1].total);

  const readAll = () =>
    void markAllRead().then(
      () => void qc.invalidateQueries({ queryKey: K.all }),
      (e) => toast('error', errorMessage(e)),
    );
  const dnd = (on: boolean) => {
    const until = new Date();
    until.setDate(until.getDate() + 1);
    until.setHours(8, 0, 0, 0);
    void call('notifications:pause', { minutes: on ? Math.max(1, Math.round((until.getTime() - Date.now()) / 60_000)) : null }).catch((e) => toast('error', errorMessage(e)));
  };
  const go = (route: string) => (closeOverlay(), navigate(route));

  return (
    <Popover label="Notifications" width={460} offset={70} className="rounded-[18px] border border-line shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.35)] dark:border-[#26315A] dark:bg-[#111A31] dark:shadow-[0_24px_60px_rgba(0,0,0,.55)]">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-1">
        <h2 className="m-0 text-[18px] font-extrabold text-ink dark:text-[#E8EBF7]">Notifications</h2>
        {unread ? <span className="inline-flex h-5 items-center rounded-[10px] bg-[#5B6CF0] px-[7px] text-[11px] font-bold text-white">{unread} new</span> : null}
        <span className="flex-1" />
        <button type="button" onClick={readAll} disabled={!unread} className="flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-bold text-primary hover:bg-subtle disabled:opacity-40 dark:text-[#AFC0FF] dark:hover:bg-[#1A2442]">
          <Icon name="check-check" size={15} />
          Mark all read
        </button>
        <button type="button" aria-label="Notification settings" title="Notification settings" onClick={() => go('/notifications/settings')} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle dark:text-[#C9CFE6] dark:hover:bg-[#1A2442]">
          <Icon name="settings" size={16} />
        </button>
      </div>
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={cx(
              'h-[30px] rounded-[15px] border px-3 text-[12.5px] font-bold',
              filter === id ? 'border-[#5B6CF0] bg-[#5B6CF0] text-white' : 'border-line text-ink-2 hover:bg-subtle dark:border-[#2D3A66] dark:text-[#C9CFE6] dark:hover:bg-[#1A2442]',
            )}
          >
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <span className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={apps}
            onClick={() => setApps(!apps)}
            className={cx('inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] font-bold whitespace-nowrap', category ? 'border-[#5B6CF0] text-primary dark:text-[#AFC0FF]' : 'border-line text-ink dark:border-[#2D3A66] dark:text-[#E8EBF7]')}
          >
            <Icon name="grid" size={13} />
            {category ? appOf(category, labels).short : 'Apps'}
            <Icon name="chevron-down" size={13} />
          </button>
          {apps ? (
            <AppsMenu
              current={category}
              options={byCat.map(([c, n]) => ({ id: c, label: appOf(c, labels).short, count: n.unread || n.total }))}
              onPick={(c) => (setCategory(c), setApps(false))}
              onClose={() => setApps(false)}
            />
          ) : null}
        </span>
      </div>
      <div className="min-h-[200px] flex-1 overflow-y-auto px-1.5 pb-2 scroll-thin" data-notif-drawer>
        {q.isLoading ? <Spinner /> : null}
        {q.error ? <p className="px-4 py-8 text-center text-[13px] text-ink-3">Notifications could not be loaded. {errorMessage(q.error)}</p> : null}
        {groups.map((g) => (
          <div key={g.section}>
            <div className="flex items-center gap-2 px-4 pt-3.5 pb-1.5">
              <span className={cx('text-[11px] font-extrabold tracking-[.8px] uppercase', g.section === 'needs' ? 'text-[#C2410C] dark:text-[#FFB38A]' : 'text-ink-3 dark:text-[#8D96B8]')}>{SECTION_LABEL[g.section]}</span>
              {g.section === 'needs' ? <span className="inline-flex h-5 items-center rounded-[10px] bg-[#FCE9E4] px-[7px] text-[11px] font-bold text-[#B42318] dark:bg-[#3A1D17] dark:text-[#FF9E86]">{g.items.length}</span> : null}
              <span className="h-px flex-1 bg-line dark:bg-[#1E2848]" />
            </div>
            {g.items.map((n) => (
              <NotifRow key={n.id} n={n} labels={labels} onOpened={closeOverlay} />
            ))}
          </div>
        ))}
        {!q.isLoading && !q.error && !list.length ? (
          <div className="flex flex-col items-center gap-2 px-8 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[#E3F6EE] text-[#1F9D6B] dark:bg-[#12291F] dark:text-[#6FE0B0]">
              <Icon name="check-check" size={26} />
            </span>
            <b className="text-[15px] text-ink dark:text-[#F2F4FB]">You’re all caught up</b>
            <span className="text-[12.5px] text-ink-3 dark:text-[#8D96B8]">{filter === 'all' && !category ? 'Nothing new.' : 'Nothing matches this filter.'}</span>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center border-t border-line bg-well px-4 py-2.5 dark:border-[#1E2848] dark:bg-[#0F1629]">
        <button type="button" onClick={() => go('/notifications')} className="flex items-center gap-1 text-[13px] font-bold text-primary hover:underline dark:text-[#AFC0FF]">
          Open notification center
          <Icon name="chevron-right" size={14} />
        </button>
        <span className="flex-1" />
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-3 dark:text-[#8D96B8]" title={paused ? `No banners or sounds until ${new Date(paused).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'No banners or sounds on this computer until 8:00 tomorrow'}>
          <Icon name="moon" size={14} />
          {paused ? `Until ${new Date(paused).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Do not disturb'}
          <button
            type="button"
            role="switch"
            aria-checked={!!paused}
            aria-label="Do not disturb"
            onClick={() => dnd(!paused)}
            className={cx('relative h-[18px] w-8 rounded-[9px] transition-colors', paused ? 'bg-[#5B6CF0]' : 'bg-line dark:bg-[#2D3A66]')}
          >
            <span className={cx('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-[left]', paused ? 'left-4' : 'left-0.5')} />
          </button>
        </label>
      </div>
    </Popover>
  );
}

function AppsMenu({ current, options, onPick, onClose }: { current: string | null; options: Array<{ id: string; label: string; count: number }>; onPick: (c: string | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  const item = (on: boolean) => cx('flex h-8 w-full items-center justify-between rounded-[8px] px-2.5 text-left text-[13px] font-semibold', on ? 'bg-selection text-primary dark:bg-[#26315A] dark:text-[#E8EBF7]' : 'text-ink hover:bg-subtle dark:text-[#E8EBF7] dark:hover:bg-[#1A2442]');
  return (
    <div ref={ref} role="menu" aria-label="Apps" className="absolute top-9 right-0 z-30 max-h-[340px] w-[220px] overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_14px_30px_rgb(var(--ws-shadow-rgb)/.25)] scroll-thin dark:border-[#2D3A66] dark:bg-[#16203E]">
      <button type="button" role="menuitem" onClick={() => onPick(null)} className={item(current === null)}>
        Every app
      </button>
      {options.map((o) => (
        <button key={o.id} type="button" role="menuitem" onClick={() => onPick(o.id)} className={item(current === o.id)}>
          <span className="truncate">{o.label}</span>
          <span className="text-[11.5px] text-ink-3 dark:text-[#8D96B8]">{o.count}</span>
        </button>
      ))}
    </div>
  );
}
