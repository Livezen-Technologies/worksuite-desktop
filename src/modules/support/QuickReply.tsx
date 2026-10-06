import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ticketIdOf } from '@shared/support';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { call, isMac } from '../../core/bridge';
import { flushDrafts } from '../../core/drafts';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { useTabTitle } from '../../core/tab-context';
import { useNow } from '../../core/use-now';
import { Button, Empty, ErrorNote, Kbd, Spinner } from '../../components/ui';
import { K, getTicket, ticketIdForReference } from './api';
import { Composer, type ComposerMode } from './Composer';
import { openAttachment } from './files';
import { usePollInterval, useSupportLive } from './live';
import { PriorityChip, Reference, SlaChip, StatusChip, requesterLine } from './parts';
import { Collision, useTicketPresence } from './presence';
import { useMarkRead } from './reading';
import { Thread } from './Thread';

/** How many of the newest messages the window shows (D-04: "Last 3 of 10 messages"). */
export const QUICK_CONTEXT = 3;

/** Esc and ⌘O / Ctrl+O, the window's two keys. Not while a picker in the composer has Esc for itself. */
export function quickKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'>, mac = isMac): 'close' | 'open' | null {
  if (e.defaultPrevented) return null;
  if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) return 'close';
  if ((e.key === 'o' || e.key === 'O') && (mac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey) return 'open';
  return null;
}

/** Closes the window once the draft is written: what was typed stays with the ticket. */
async function closeWindow(): Promise<void> {
  await flushDrafts().catch(() => undefined);
  await call('windows:close').catch(() => undefined);
}

/** The ticket's tab in the main window, carrying the draft over (FR-CRT-10): written first, then read there. */
async function openFull(): Promise<void> {
  await flushDrafts().catch(() => undefined);
  await call('windows:toMain', {}).catch(() => undefined);
}

/**
 * The quick-reply mini window (WS-SUPPORT-SRS-001 D-04, FR-DSK-03): a ticket in a small floating window, opened from
 * a notification, the tray (its next SLA due, or "Quick reply to latest") or the global shortcut, without bringing
 * the main window forward or leaving the app in front.
 *
 *  - Context (FR-COM-10, FR-SLA-07): the reference, subject, requester, priority, status and the SLA chip — live —
 *    and the last three messages, internal notes among them, with "New since you last viewed".
 *  - The composer is the desk's own: Reply or Note as two explicit buttons (a note never leaves WorkSuite,
 *    FR-COM-01), "/" for the canned responses filled in for this ticket (FR-COM-05), and the status the ticket moves
 *    to with the message ("Then: Pending customer", FR-STS-03).
 *  - Always on top: the title bar's pin, kept as chosen; the window opens again where it was left, on that display.
 *  - ⌘O / Ctrl+O opens the ticket's tab in the main window and carries the draft over; Esc closes and keeps it. A
 *    message sent closes the window.
 *
 * Shown here is read (as in the reading pane, a moment after it is shown), and the others on the ticket see me on it.
 */
export function QuickReply({ ticketKey }: { ticketKey: string }) {
  useSupportLive();
  const poll = usePollInterval();
  const byId = ticketIdOf(ticketKey);
  const ref = useQuery({ queryKey: K.ref(ticketKey), queryFn: ({ signal }) => ticketIdForReference(ticketKey, signal), enabled: byId === null, staleTime: 5 * 60_000 });
  const id = byId ?? ref.data ?? null;
  const q = useQuery({ queryKey: K.ticket(id ?? 0), queryFn: ({ signal }) => getTicket(id!, { peek: true }, signal), enabled: id !== null, refetchInterval: poll });
  const me = Number(useStore(app, (s) => s.auth?.user?.id ?? 0)) || null;
  const now = useNow(15_000).getTime();
  const [typing, setTyping] = useState<ComposerMode | null>(null);
  const show = q.data;
  useMarkRead(id, show, true);
  const present = useTicketPresence(id, { here: !!show, typing });
  useTabTitle(show ? text('{ref} · Quick reply', { ref: show.ticket.reference }) : text('Quick reply'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = quickKey(e);
      if (!k) return;
      e.preventDefault();
      void (k === 'close' ? closeWindow() : openFull());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if ((byId === null && ref.isLoading) || q.isLoading) return <Spinner />;
  if ((byId === null && ref.data === null) || (q.error instanceof ApiError && q.error.status === 404)) {
    return <Empty icon="life-buoy" title={text('Ticket not found')} hint={text('It may have been deleted, merged, or moved out of your organizations.')} />;
  }
  if (q.error || ref.error) {
    return (
      <div className="p-4">
        <ErrorNote error={q.error ?? ref.error} onRetry={() => void (q.error ? q.refetch() : ref.refetch())} />
      </div>
    );
  }
  if (!show) return null;
  const t = show.ticket;
  const recent = show.messages.slice(-QUICK_CONTEXT);
  const readOnly = !!t.merged_into || !!t.deleted_at;
  const mod = isMac ? '⌘' : 'Ctrl+';

  return (
    <article aria-label={text('Quick reply to {ref}', { ref: t.reference })} className="flex h-full min-w-0 flex-col bg-ground">
      <header className="flex shrink-0 flex-col gap-1 border-b border-line bg-surface px-4 pt-2.5 pb-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-ink-3">
          <Reference className="font-semibold text-ink">{t.reference}</Reference>
          <span className="truncate">{text('Quick reply')}</span>
          <Collision present={present} className="ml-auto" />
        </div>
        <h2 className="truncate text-[15px] leading-snug font-extrabold text-ink" title={t.subject}>
          {t.subject}
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
          <span className="min-w-0 truncate">{requesterLine(t.requester)}</span>
          <PriorityChip priority={t.priority} quiet />
          <SlaChip sla={t.sla} now={now} />
          <StatusChip status={t.status} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5 scroll-thin">
        {show.messages.length > recent.length ? (
          <p className="pb-2 text-[11.5px] font-semibold text-ink-3">{text('Last {n} of {total} messages', { n: recent.length, total: show.messages.length + (show.has_earlier ? '+' : '') })}</p>
        ) : null}
        <Thread compact messages={recent} attachments={show.attachments} lastRead={show.last_read_message_id} me={me} onOpenAttachment={(a) => void openAttachment(a)} />
      </div>
      {readOnly ? (
        <p role="status" className="border-t border-line bg-surface px-4 py-3 text-[12.5px] text-ink-3">
          {t.merged_into ? text('Merged into {ref}: it is read-only.', { ref: t.merged_into.reference }) : text('This ticket is in the trash.')}
        </p>
      ) : (
        <Composer compact ticket={t} can={show.can} transitions={show.transitions} legacy={show.legacy === true} onTyping={setTyping} onSent={() => void closeWindow()} />
      )}
      <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-4 py-1.5 text-[11.5px] text-ink-3">
        <Button size="sm" variant="ghost" icon="external" onClick={() => void openFull()} aria-keyshortcuts={isMac ? 'Meta+O' : 'Control+O'}>
          {text('Open full ticket')}
        </Button>
        <Kbd tone="key">{`${mod}O`}</Kbd>
        <span className="ml-auto">{text('Esc closes · draft kept')}</span>
      </footer>
    </article>
  );
}
