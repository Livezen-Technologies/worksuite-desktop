import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { useTabTitle } from '../../core/tab-context';
import { relative } from '../../core/time';
import { Avatar, Empty, ErrorNote, Spinner } from '../../components/ui';
import { VirtualList } from '../../components/VirtualList';
import type { ModuleProps } from '../registry';

/** Activity (analytics.view): the audit trail of what happened across WorkSuite, virtualized. */
interface Row {
  id: number | string;
  action: string;
  description: string | null;
  subject_type: string | null;
  created_at: string;
  user_name: string | null;
}

export default function ActivityPage(_props: ModuleProps) {
  useTabTitle('Activity');
  const [q, setQ] = useState('');
  const feed = useInfiniteQuery({
    queryKey: ['activity', q],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => apiGet<{ items: Row[]; meta: { page: number; pages: number } }>('/api/activity', { page: pageParam, per_page: 100, q: q || undefined }, signal),
    getNextPageParam: (last) => (last.meta.page < last.meta.pages ? last.meta.page + 1 : undefined),
  });
  const rows = (feed.data?.pages ?? []).flatMap((p) => p.items);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <h1 className="text-[20px] font-bold text-ink">Activity</h1>
        <div className="flex-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter activity" aria-label="Filter activity" className="h-8 w-[260px] rounded-[8px] border border-line bg-ground px-3 text-[13px] outline-none focus:border-primary" />
      </div>
      <div className="min-h-0 flex-1">
        {feed.isLoading ? <Spinner /> : feed.error ? <div className="p-6"><ErrorNote error={feed.error} /></div> : rows.length === 0 ? <Empty icon="activity" title="No matching activity" /> : null}
        {rows.length ? (
          <VirtualList
            items={rows}
            estimate={58}
            getKey={(r) => r.id}
            onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
            render={(r) => (
              <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-2.5">
                <Avatar name={r.user_name ?? 'System'} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] text-ink">
                    <span className="font-semibold">{r.user_name ?? 'System'}</span> {r.description ?? r.action}
                  </div>
                  <div className="text-[12px] text-ink-3">
                    {r.action}
                    {r.subject_type ? ` · ${r.subject_type}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] text-ink-3">{relative(r.created_at)}</span>
              </div>
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
