import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { VIEW_LABEL, isView, parseSupportRoute, ticketRoute, type SupportView, type Ticket } from '@shared/support';
import { useTab, useTabTitle } from '../../core/tab-context';
import { listStamp } from '../../core/time';
import { text } from '../../core/i18n';
import { useNow } from '../../core/use-now';
import { CountBadge, Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { K, listTickets, views } from './api';
import { ChannelIcon, PriorityChip, Reference, SlaChip, StatusChip, requesterLine } from './parts';

/**
 * The support inbox (D-01): the views down the side with their counts, and the chosen view's tickets, newest change
 * first, a page at a time. A ticket opens in a tab of its own.
 */
export function Inbox({ route }: { route: string; active: boolean }) {
  useTabTitle(text('Support'));
  const { go, navigate } = useTab();
  const r = parseSupportRoute(route);
  const view: SupportView = r.kind === 'inbox' && isView(r.view) ? r.view : 'mine';
  const now = useNow(30_000).getTime();
  const rail = useQuery({ queryKey: K.views(''), queryFn: () => views() });
  const list = useInfiniteQuery({
    queryKey: K.list({ view }),
    queryFn: ({ pageParam, signal }) => listTickets({ view, cursor: pageParam, limit: 50 }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? (last.next_cursor ?? undefined) : undefined),
  });
  const rows: Ticket[] = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex h-full min-h-0 bg-ground">
      <nav aria-label={text('Support views')} className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-rail p-2 scroll-thin">
        <h1 className="px-2 pt-1 pb-2 text-[15px] font-extrabold text-ink">{text('Support')}</h1>
        {(rail.data?.views ?? []).map((v) => (
          <button
            key={v.key}
            type="button"
            aria-current={v.key === view ? 'page' : undefined}
            onClick={() => go(`/support?view=${v.key}`)}
            className={cx('flex h-8 items-center gap-2 rounded-[8px] px-2 text-left text-[13px]', v.key === view ? 'bg-selection font-semibold text-primary' : 'text-ink-2 hover:bg-subtle')}
          >
            <span className="min-w-0 flex-1 truncate">{text(v.label)}</span>
            {v.count ? <CountBadge n={v.count} tone="muted" /> : null}
          </button>
        ))}
      </nav>
      <section aria-label={text(VIEW_LABEL[view])} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-line bg-surface px-4">
          <h2 className="text-[14px] font-bold text-ink">{text(VIEW_LABEL[view])}</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : null}
          {list.error ? (
            <div className="p-3">
              <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : null}
          {list.isSuccess && !rows.length ? <Empty icon="inbox" title={text('No tickets here')} hint={text('Tickets in this view show here as they arrive.')} /> : null}
          <ul role="list">
            {rows.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => navigate(ticketRoute(t.id))} className="flex w-full flex-col gap-0.5 border-b border-line bg-surface px-4 py-2 text-left hover:bg-subtle">
                  <span className="flex items-center gap-2">
                    <ChannelIcon source={t.source} />
                    <Reference>{t.reference}</Reference>
                    <PriorityChip priority={t.priority} quiet />
                    <span className="ml-auto text-[11.5px] text-ink-3">{listStamp(t.updated_at)}</span>
                  </span>
                  <span className={cx('truncate text-[13px] text-ink', t.unread > 0 && 'font-bold')}>{t.subject}</span>
                  <span className="flex items-center gap-2 text-[12px] text-ink-3">
                    <span className="min-w-0 flex-1 truncate">{requesterLine(t.requester)}</span>
                    <SlaChip sla={t.sla} now={now} />
                    <StatusChip status={t.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage ? (
            <button type="button" onClick={() => void list.fetchNextPage()} className="w-full py-3 text-[12.5px] font-semibold text-primary hover:underline">
              {text('Show more')}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
