import { Fragment } from 'react';
import type { Attachment, Message } from '@shared/support';
import { bytes, timeLabel, stampDayLabel } from '../../core/time';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Avatar, FileBadge, cx } from '../../components/ui';

/**
 * A ticket's conversation (FR-COM-10): every message, oldest first — the requester's, the replies they were sent and
 * the internal notes, which are amber and labelled Internal on every message (§19.2, the as-built rule), so a note
 * is never mistaken for something the customer saw.
 *
 * "New since you last viewed" sits above the first message after my read marker that somebody else wrote. A ticket
 * never opened has no marker and no line: all of it is new.
 */
export function newSinceIndex(messages: Message[], lastRead: number, me: number | null): number {
  if (!lastRead) return -1;
  return messages.findIndex((m) => m.id > lastRead && !(me !== null && m.author?.id === me));
}

/** What a message is, in words: who wrote it and to whom. */
export function messageKind(m: Message): string {
  if (m.internal) return text('Internal note');
  if (m.from === 'requester') return m.channel && m.channel !== 'agent' ? text('via {channel}', { channel: channelWords(m.channel) }) : text('Requester');
  return text('Replied to requester');
}

function channelWords(c: string): string {
  return ({ email: text('email'), chat: text('website chat'), whatsapp: 'WhatsApp', phone: text('phone'), portal: text('portal'), form: text('form'), widget_offline: text('website form') } as Record<string, string>)[c] ?? c;
}

/** Where a public reply got to (G-01): not sent until delivery exists on the server, then emailed and delivered. */
function delivery(m: Message): string | null {
  if (m.internal || m.from !== 'staff' || !m.delivery_status) return null;
  return (
    ({ not_sent: text('Not emailed'), queued: text('Sending'), sent: text('Emailed'), delivered: text('Delivered'), failed: text('Not delivered'), bounced: text('Bounced') } as Record<string, string>)[m.delivery_status] ??
    m.delivery_status
  );
}

export function Thread({
  messages,
  attachments = [],
  lastRead = 0,
  me = null,
  compact = false,
  onOpenAttachment,
  className,
}: {
  messages: Message[];
  attachments?: Attachment[];
  lastRead?: number;
  me?: number | null;
  /** The reading pane's denser form. */
  compact?: boolean;
  onOpenAttachment?: (a: Attachment) => void;
  className?: string;
}) {
  const divider = newSinceIndex(messages, lastRead, me);
  const filesOf = new Map<number, Attachment[]>();
  for (const a of attachments) if (a.message_id !== null) filesOf.set(a.message_id, [...(filesOf.get(a.message_id) ?? []), a]);
  // A day's heading above its first message (not in the reading pane, where the thread is short).
  const dayHeads = new Set<number>();
  let lastDay = '';
  for (const m of messages) {
    const day = m.created_at ? stampDayLabel(m.created_at, 'long') : '';
    if (!compact && day && day !== lastDay) dayHeads.add(m.id);
    if (day) lastDay = day;
  }
  return (
    <ol aria-label={text('Conversation')} className={cx('flex flex-col', compact ? 'gap-2.5' : 'gap-3', className)}>
      {messages.map((m, i) => {
        const day = m.created_at ? stampDayLabel(m.created_at, 'long') : '';
        const newDay = dayHeads.has(m.id);
        const files = filesOf.get(m.id) ?? [];
        const who = m.author?.name ?? m.author_name ?? (m.from === 'requester' ? text('Requester') : text('Staff'));
        const sent = delivery(m);
        // A server that sends no copy list sends no copies.
        const cc = m.cc ?? [];
        return (
          <Fragment key={m.id}>
            {newDay ? (
              <li aria-hidden className="py-1 text-center text-[11px] font-semibold text-ink-3">
                {day}
              </li>
            ) : null}
            {i === divider ? (
              <li data-new-since className="flex items-center gap-2 py-1 text-[11.5px] font-bold text-primary">
                <span className="h-px flex-1 bg-primary/40" />
                {text('New since you last viewed')}
                <span className="h-px flex-1 bg-primary/40" />
              </li>
            ) : null}
            <li
              data-message={m.id}
              data-internal={m.internal || undefined}
              className={cx(
                'rounded-[10px] border',
                compact ? 'px-3 py-2' : 'px-4 py-3',
                m.internal ? 'border-[#F6D7B0] bg-[#FFF8EC] dark:border-[#5A3B14] dark:bg-[#2A1E0C]' : m.from === 'requester' ? 'border-line bg-surface' : 'border-line bg-[#F7F8FC] dark:bg-[#151E3A]',
              )}
            >
              <div className="mb-1 flex min-w-0 items-center gap-2 text-[12px]">
                <Avatar name={who} size={compact ? 20 : 24} />
                <b className="truncate text-ink">{who}</b>
                {m.internal ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-warning-bg px-1.5 text-[11px] font-semibold text-warning-ink">
                    <Icon name="lock" size={11} />
                    {text('Internal')}
                  </span>
                ) : (
                  <span className="truncate text-ink-3">{messageKind(m)}</span>
                )}
                {cc.length && !m.internal ? <span className="truncate text-ink-3">· {text('CC {list}', { list: cc.join(', ') })}</span> : null}
                <span className="ml-auto shrink-0 text-ink-3" title={m.created_at ? stampDayLabel(m.created_at, 'long') : undefined}>
                  {timeLabel(m.created_at)}
                  {sent ? ` · ${sent}` : ''}
                </span>
              </div>
              <p className={cx('break-words whitespace-pre-wrap text-ink', compact ? 'text-[12.5px]' : 'text-[13.5px] leading-relaxed')}>{m.body}</p>
              {files.length ? (
                <ul aria-label={text('Files')} className="mt-2 flex flex-wrap gap-1.5">
                  {files.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        disabled={!onOpenAttachment}
                        onClick={() => onOpenAttachment?.(a)}
                        title={a.scan_status === 'unscanned' ? text('Not scanned for viruses') : undefined}
                        className="flex max-w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2 py-1 text-left text-[12px] hover:bg-subtle disabled:cursor-default"
                      >
                        <FileBadge name={a.name} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink">{a.name}</span>
                          <span className="block text-[11px] text-ink-3">{bytes(a.size)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
