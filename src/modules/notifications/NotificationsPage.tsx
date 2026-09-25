import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { NotificationItem } from '@shared/types';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { relative } from '../../core/time';
import { Button, Chip, Empty, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';

/** The full notification centre (§4.2): filter by module, mark read, open the record. */
export default function NotificationsPage(_props: ModuleProps) {
  useTabTitle('Notifications');
  const { openLink, navigate } = useTab();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const q = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => call('notifications:list') });
  const all = q.data?.items ?? [];
  const modules = [...new Set(all.map((n) => n.module))];
  const items = all.filter((n) => filter === 'all' || (filter === 'unread' ? !n.read : n.module === filter));
  const open = (n: NotificationItem) => {
    if (!n.read) void call('notifications:markRead', { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    openLink(n.link);
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <h1 className="text-[20px] font-bold text-ink">Notifications</h1>
        <div className="ml-3 flex flex-wrap gap-1">
          {['all', 'unread', ...modules].map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold capitalize', filter === f ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-subtle')}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button onClick={() => void call('notifications:markAllRead').then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}>Mark all read</Button>
        <Button icon="settings" onClick={() => navigate('/settings/notifications')}>
          Settings
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {q.isLoading ? <Spinner /> : items.length === 0 ? <Empty icon="bell" title="You're all caught up" /> : null}
        <ul className="mx-auto max-w-[900px] py-3">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className="flex w-full gap-3 rounded-[10px] px-4 py-3 text-left hover:bg-surface">
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-[14px]', n.read ? 'text-ink-2' : 'font-semibold text-ink')}>{n.title}</span>
                  {n.body ? <span className="block text-[13px] text-ink-2">{n.body}</span> : null}
                  <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                    <Chip>{n.module}</Chip>
                    {relative(n.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
