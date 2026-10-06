import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../core/api';
import { useTabTitle } from '../../core/tab-context';
import { listStamp } from '../../core/time';
import { text } from '../../core/i18n';
import { useNow } from '../../core/use-now';
import { Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { ticketIdOf, type Message } from '@shared/support';
import { K, getTicket, ticketIdForReference } from './api';
import { ChannelIcon, PriorityChip, Reference, SlaChip, StatusChip, requesterLine } from './parts';

/** A ticket's key as its route names it: its id, or a reference looked up once. */
export function useTicketId(key: string): { id: number | null; resolving: boolean; missing: boolean } {
  const direct = ticketIdOf(key);
  const ref = useQuery({ queryKey: K.ref(key), queryFn: ({ signal }) => ticketIdForReference(key, signal), enabled: direct === null, staleTime: Infinity });
  if (direct !== null) return { id: direct, resolving: false, missing: false };
  return { id: ref.data ?? null, resolving: ref.isLoading, missing: ref.isSuccess && ref.data === null };
}

/**
 * One ticket in a tab of its own (D-02): opened from the inbox, a deep link (`worksuite://support/ticket/{id}`) or a
 * notification, and brought forward again — not opened twice — when it is asked for while open (core/tabs.ts).
 */
export function TicketTab({ ticketKey }: { ticketKey: string; active: boolean }) {
  const { id, resolving, missing } = useTicketId(ticketKey);
  const q = useQuery({ queryKey: K.ticket(id ?? 0), queryFn: ({ signal }) => getTicket(id!, { peek: true }, signal), enabled: id !== null });
  const now = useNow(30_000).getTime();
  useTabTitle(q.data?.ticket.reference ?? ticketKey);

  if (missing || (q.error instanceof ApiError && q.error.status === 404)) {
    return <Empty icon="life-buoy" title={text('Ticket not found')} hint={text('It may have been deleted, merged, or it is not in your organizations.')} />;
  }
  if (resolving || q.isLoading) return <Spinner />;
  if (q.error) {
    return (
      <div className="p-4">
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  if (!q.data) return null;
  const { ticket: t, messages } = q.data;
  return (
    <div className="flex h-full min-h-0 flex-col bg-ground">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-5 py-3">
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <ChannelIcon source={t.source} />
          <Reference>{t.reference}</Reference>
          <span>·</span>
          <span className="truncate">{requesterLine(t.requester)}</span>
        </div>
        <h1 className="text-[18px] font-extrabold text-ink">{t.subject}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={t.status} />
          <PriorityChip priority={t.priority} />
          <SlaChip sla={t.sla} now={now} long />
          {t.assignee ? <span className="text-[12.5px] text-ink-2">{t.assignee.name}</span> : <span className="text-[12.5px] text-ink-3">{text('Unassigned')}</span>}
        </div>
      </header>
      <ol aria-label={text('Conversation')} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 scroll-thin">
        {messages.map((m) => (
          <MessageItem key={m.id} m={m} />
        ))}
      </ol>
    </div>
  );
}

function MessageItem({ m }: { m: Message }) {
  return (
    <li className={cx('rounded-[10px] border px-4 py-3', m.internal ? 'border-[#F6D7B0] bg-[#FFF8EC] dark:border-[#5A3B14] dark:bg-[#2A1E0C]' : 'border-line bg-surface')}>
      <div className="mb-1 flex items-center gap-2 text-[12px]">
        <b className="text-ink">{m.author?.name ?? m.author_name ?? text('Requester')}</b>
        {m.internal ? <span className="rounded-[5px] bg-warning-bg px-1.5 text-[11px] font-semibold text-warning-ink">{text('Internal')}</span> : null}
        <span className="ml-auto text-ink-3">{listStamp(m.created_at)}</span>
      </div>
      <p className="text-[13px] whitespace-pre-wrap text-ink">{m.body}</p>
    </li>
  );
}
