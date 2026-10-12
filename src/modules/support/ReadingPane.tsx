import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { text } from '../../core/i18n';
import { stampDayLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { useStore } from '../../core/store';
import { useNow } from '../../core/use-now';
import { Avatar, Button, Empty, ErrorNote, IconButton, Spinner } from '../../components/ui';
import type { TicketShow } from '@shared/support';
import { K, errorText, getTicket, meta, openQuickReply, take } from './api';
import { Composer, type ComposerMode, type InsertRequest } from './Composer';
import { openAttachment } from './files';
import { usePollInterval } from './live';
import { ChannelIcon, OriginLink, PriorityChip, Reference, SlaChip, StatusChip, channelLabel } from './parts';
import { Collision, useTicketPresence } from './presence';
import { useMarkRead } from './reading';
import { useTab } from '../../core/tab-context';
import { WIDE_INBOX } from './details';
import { EditableSubject } from './Subject';
import { DrawerButton, TicketDrawer, useDetailsDrawer } from './TicketDrawer';
import { Thread } from './Thread';

/**
 * The inbox's reading pane (D-01): the chosen ticket's header — reference, channel, when it was opened, its category
 * — its status, priority, assignee and SLA, who else is on it, the conversation with "New since you last viewed",
 * and a reply or a note typed right here (R, N, ⌘↵). Open in tab gives it a tab of its own (D-02).
 *
 * It is fetched with `peek` and read only once it has been shown for a moment (reading.ts); the same moment says I
 * am here (presence.tsx), so passing over a ticket with j/k tells nobody anything.
 */
export function ReadingPane({
  ticketId,
  active,
  focusRequest,
  onOpenTab,
  onResolve,
}: {
  ticketId: number;
  active: boolean;
  focusRequest: { mode: ComposerMode; n: number } | null;
  onOpenTab: (id: number) => void;
  onResolve: (show: TicketShow) => void;
}) {
  const qc = useQueryClient();
  const poll = usePollInterval();
  const q = useQuery({ queryKey: K.ticket(ticketId), queryFn: ({ signal }) => getTicket(ticketId, { peek: true }, signal), refetchInterval: poll });
  const me = Number(useStore(app, (s) => s.auth?.user?.id ?? 0)) || null;
  const now = useNow(30_000).getTime();
  // Settled on this ticket: shown for a moment, not passed over.
  const [settled, setSettled] = useState(false);
  const [typing, setTyping] = useState<ComposerMode | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 1200);
    return () => clearTimeout(t);
  }, []);
  useMarkRead(ticketId, q.data, active);
  const present = useTicketPresence(ticketId, { here: active && settled, typing });
  // The details drawer (#334), as in a ticket's tab: beside the pane on a wide window, over it on a narrower one.
  const drawer = useDetailsDrawer(WIDE_INBOX, active);
  const metaQ = useQuery({ queryKey: K.meta, queryFn: ({ signal }) => meta(signal), staleTime: 5 * 60_000 });
  const { navigate, openLink } = useTab();
  const [insert, setInsert] = useState<InsertRequest | null>(null);

  if (q.isLoading) return <Spinner />;
  if (q.error instanceof ApiError && q.error.status === 404) return <Empty icon="life-buoy" title={text('Ticket not found')} hint={text('It may have been deleted, merged, or moved out of your organizations.')} />;
  if (q.error) {
    return (
      <div className="p-4">
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  if (!q.data) return null;
  const show = q.data;
  const t = show.ticket;
  const canResolve = show.transitions.includes('resolved');
  const canTake = !t.assignee && show.can.reply === true && !show.ticket.merged_into;
  const takeIt = async () => {
    try {
      await take(t.id, t.version || undefined);
      toast('success', text('{ref} is yours.', { ref: t.reference }));
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      void qc.invalidateQueries({ queryKey: K.ticket(t.id) });
      void qc.invalidateQueries({ queryKey: K.lists });
      void qc.invalidateQueries({ queryKey: ['support', 'views'] });
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      <article aria-label={text('Ticket {ref}', { ref: t.reference })} className="flex h-full min-w-0 flex-1 flex-col bg-ground">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-5 pt-3 pb-3">
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-ink-3">
          <Reference className="font-semibold text-ink">{t.reference}</Reference>
          <ChannelIcon source={t.source} />
          <span className="min-w-0 truncate">
            {[channelLabel(t.source), t.opened_at || t.created_at ? text('opened {when}', { when: `${stampDayLabel((t.opened_at ?? t.created_at)!, 'short')}, ${timeLabel(t.opened_at ?? t.created_at)}` }) : null, t.category?.name]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <OriginLink origin={t.origin} />
          <Collision present={present} className="ml-auto" />
        </div>
        <EditableSubject show={show} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={t.status} />
          <PriorityChip priority={t.priority} />
          {t.assignee ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <Avatar name={t.assignee.name} size={20} />
              {t.assignee.name}
            </span>
          ) : (
            <span className="text-[12.5px] text-ink-3">{text('Unassigned')}</span>
          )}
          <SlaChip sla={t.sla} now={now} long />
          <span className="ml-auto flex items-center gap-1.5">
            {canTake ? (
              <Button size="sm" icon="user-plus" onClick={() => void takeIt()}>
                {text('Take it')}
              </Button>
            ) : null}
            {canResolve ? (
              <Button size="sm" icon="check" onClick={() => onResolve(show)} aria-keyshortcuts="E">
                {text('Resolve')}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon="external" onClick={() => onOpenTab(t.id)}>
              {text('Open in tab')}
            </Button>
            {/* The quick-reply window (D-04): this ticket floating over other apps while the desk goes on. */}
            <IconButton icon="app-window" label={text('Quick reply window')} onClick={() => openQuickReply(t.id)} />
            <DrawerButton drawer={drawer} />
          </span>
        </div>
        {t.merged_into ? (
          <p role="status" className="rounded-[8px] bg-warning-bg px-3 py-1.5 text-[12.5px] text-warning-ink">
            {text('Merged into {ref}: it is read-only.', { ref: t.merged_into.reference })}{' '}
            <button type="button" className="font-semibold underline" onClick={() => onOpenTab(t.merged_into!.id)}>
              {text('Open {ref}', { ref: t.merged_into.reference })}
            </button>
          </p>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 scroll-thin">
        <Thread compact messages={show.messages} attachments={show.attachments} lastRead={show.last_read_message_id} me={me} source={show.has_earlier ? null : t.source} onOpenAttachment={(a) => void openAttachment(a)} />
        {show.legacy ? <p className="pt-3 text-center text-[11.5px] text-ink-3">{text('Your WorkSuite server is older: read markers, files and who else is here show once it is updated.')}</p> : null}
      </div>
      {!t.merged_into && !t.deleted_at ? <Composer compact ticket={t} can={show.can} transitions={show.transitions} legacy={show.legacy === true} focusRequest={focusRequest} insertRequest={insert} onTyping={setTyping} /> : null}
      </article>
      <TicketDrawer
        drawer={drawer}
        show={show}
        meta={metaQ.data}
        onResolve={() => onResolve(show)}
        onReply={show.can.reply && !t.merged_into ? (body) => setInsert((x) => ({ text: body, how: 'insert', mode: 'reply', n: (x?.n ?? 0) + 1 })) : undefined}
        onOpenLink={openLink}
        onNavigate={navigate}
      />
    </div>
  );
}
