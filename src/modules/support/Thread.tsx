import { FormattedMessage } from '../../components/FormattedMessage';
import { linkReplyUrls, replyHtml } from './richReply';
import { Fragment, useState } from 'react';
import type { Attachment, Message } from '@shared/support';
import { parseTs, timeLabel, stampDayLabel } from '../../core/time';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Avatar, cx } from '../../components/ui';
import { channelIcon, channelLabel } from './parts';
import { MessageFiles, isPicture, onlyFileNames } from './MessageFiles';
import { errorText, messageOriginal, messageTracking } from './api';
import { ACCURACY, emailStatus, eventLine, trackingSummary, untrackedReason, withClickCounts, type Tone } from './tracking';

/**
 * A ticket's conversation (FR-COM-10): every message, oldest first — the requester's, the replies they were sent and
 * the internal notes, which are amber and labelled Internal note on every message (§19.2, the as-built rule), so a
 * note is never mistaken for something the customer saw. Every other message says the channel it came or went by
 * (#298): email, website chat, phone, walk-in…
 *
 * A website chat made a ticket (#332) reads as the chat did: its own lines ("Website chat #12 — visitor details", the
 * visitor left…) are small grey lines across the thread, not messages; its chatbot's answers are the Assistant's;
 * the visitor's lines came "via Website chat" and the agents' were "Sent in chat", not emailed. Only a note the desk
 * wrote is amber. Lines from one person a few minutes apart are one group, with their name and time once.
 *
 * "New since you last viewed" sits above the first message after my read marker that somebody else wrote. A ticket
 * never opened has no marker and no line: all of it is new.
 *
 * The customer channels (#336): a requester's message says "via Form", "via Email", "via Portal" or "via Website
 * chat". A reply from an "Unverified sender" — not the requester, not copied — is an internal note held for review,
 * with Release (into the conversation) and Discard where the tab can act; an email reply cut down to what the
 * customer wrote this time offers "Show original".
 *
 * Email tracking (#335): a reply the desk emailed says the latest word on the right of its header — Sending, Sent,
 * Delivered, "Opened 12:30 PM · Clicked 1 link", Opened (automatic), Bounced — and hovering or clicking it shows the
 * whole timeline with the approximate client. A link the requester followed carries a small click count. A reply that
 * bounced or did not go says why, with Retry and Edit address where the tab can send it again.
 */
export function newSinceIndex(messages: Message[], lastRead: number, me: number | null): number {
  if (!lastRead) return -1;
  return messages.findIndex((m) => m.id > lastRead && !(me !== null && m.author?.id === me));
}

export type Speaker = 'requester' | 'staff' | 'system' | 'assistant';

/** Who a message is from (#332); a server that sends `from` as requester or staff only still marks a chat's events and bot by channel. */
export function speaker(m: Pick<Message, 'from' | 'channel'>): Speaker {
  if (m.from === 'system' || m.channel === 'event') return 'system';
  if (m.from === 'assistant' || m.channel === 'chat_bot') return 'assistant';
  return m.from === 'requester' ? 'requester' : 'staff';
}

/**
 * An internal note: the desk's own words, never the requester's, a chat's events or its bot's (#332) — and a reply held
 * from an unverified sender (#336), which nobody outside the desk has seen and must not look as if they had.
 */
export function isNote(m: Pick<Message, 'from' | 'channel' | 'internal' | 'held'>): boolean {
  return m.internal && (speaker(m) === 'staff' || !!m.held);
}

/** What a message is, in words: who wrote it and to whom. */
export function messageKind(m: Message): string {
  if (isNote(m)) return text('Internal note');
  const who = speaker(m);
  if (who === 'system') return text('Website chat');
  if (who === 'assistant') return text('Assistant');
  if (who === 'requester') return text('Requester');
  return text('Replied to requester');
}

/** Channels that say only who wrote a message (the as-built `agent`, v1's defaults), not how it came. */
const NO_CHANNEL = new Set(['agent', 'staff', 'reply', 'note']);

/**
 * The channel a message came or went by (#298), as the API names it: `note` for an internal note; else its own
 * `channel`, or for a staff reply how it went out (`delivery_channel`); and for the thread's first message, which has
 * none on a server from before messages kept one, the ticket's `source` — how it arrived. Null: nothing to say — and
 * for a chat's own lines and its bot's, which say who they are instead.
 */
export function messageChannel(m: Message, first: boolean, source?: string | null): string | null {
  if (isNote(m)) return 'note';
  if (speaker(m) === 'system' || speaker(m) === 'assistant') return null;
  if (m.channel && !NO_CHANNEL.has(m.channel)) return m.channel;
  if (m.from === 'staff' && m.delivery_channel && !NO_CHANNEL.has(m.delivery_channel)) return m.delivery_channel;
  return first && source ? source : null;
}

/** The channels a customer writes in by themselves (#336): their messages say "via …"; a call or a visit is just its name. */
export const VIA_CHANNELS = new Set(['form', 'email', 'portal', 'chat', 'widget_offline', 'whatsapp']);

/** How a channel badge reads (#336): "via Email" for a requester's message by a customer channel, else the channel's name. */
export function channelBadge(who: Speaker, channel: string): string {
  return who === 'requester' && VIA_CHANNELS.has(channel) ? text('via {channel}', { channel: channelLabel(channel) }) : channelLabel(channel);
}

/** What the tab does with a held reply (#336). */
export type HeldAction = 'release' | 'discard';

/** "Unverified sender" (#336): who wrote, and Release / Discard when the tab can act on it. */
function HeldBar({ m, onHeld }: { m: Message; onHeld?: (m: Message, action: HeldAction) => void }) {
  return (
    <div data-held={m.held} className="mb-2 flex flex-wrap items-center gap-2 rounded-[8px] bg-surface/80 px-2 py-1.5 text-[12px] text-warning-ink">
      <Icon name="warning" size={13} />
      <span className="min-w-0 flex-1">
        <b>{text('Unverified sender')}</b> · {text('{from} is not the requester or copied on this ticket.', { from: m.held_from ?? text('The sender') })}
      </span>
      {onHeld ? (
        <>
          <button type="button" onClick={() => onHeld(m, 'release')} className="rounded-[6px] bg-warning px-2 py-0.5 font-semibold text-white hover:opacity-90">
            {text('Release')}
          </button>
          <button type="button" onClick={() => onHeld(m, 'discard')} className="rounded-[6px] border border-line px-2 py-0.5 font-semibold text-ink-2 hover:bg-subtle">
            {text('Discard')}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** "Show original" (#336): the whole email, loaded when asked for. */
function Original({ ticketId, m }: { ticketId: number; m: Message }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (body !== null) return;
    try {
      setBody((await messageOriginal(ticketId, m.id)).original);
    } catch (e) {
      setFailed(errorText(e, text('The original could not be loaded.')));
    }
  };
  return (
    <div className="mt-1.5">
      <button type="button" aria-expanded={open} onClick={() => void toggle()} className="text-[11.5px] font-semibold text-ink-3 hover:text-ink-2">
        {open ? text('Hide original') : text('Show original')}
      </button>
      {open ? (
        <pre data-original className="mt-1 max-h-80 overflow-auto rounded-[8px] bg-subtle p-2 font-sans text-[12px] whitespace-pre-wrap text-ink-2 selectable">
          {failed ?? body ?? text('Loading…')}
        </pre>
      ) : null}
    </div>
  );
}

/** Said to the visitor in a website chat (#332): delivered there as it was said, never emailed. */
const saidInChat = (m: Message) => m.delivery_channel === 'chat';

/** Where a public reply got to (G-01): not sent until delivery exists on the server, then emailed and delivered. */
function delivery(m: Message): string | null {
  if (m.local_status) return m.local_status === 'sending' ? text('Sending…') : text('Not sent');
  if (m.internal || speaker(m) !== 'staff') return null;
  if (saidInChat(m)) return text('Sent in chat');
  if (!m.delivery_status) return null;
  // What came back about it (#335), on a server that tracks; an older one keeps its own words.
  if (m.tracking !== undefined || m.delivery_status === 'bounced') return emailStatus(m)?.label ?? null;
  return (
    (
      {
        not_sent: text('Not emailed'),
        queued: text('Queued for delivery'),
        sent: text('Emailed'),
        delivered: text('Delivered'),
        failed: text('Not delivered'),
        bounced: text('Bounced'),
      } as Record<string, string>
    )[m.delivery_status] ?? m.delivery_status
  );
}

const TONE: Record<Tone, string> = {
  muted: 'text-ink-3',
  ok: 'text-ink-3',
  good: 'text-success',
  warn: 'text-warning-ink',
  bad: 'text-danger',
};

/** The latest word on a reply's email (#335): its tooltip says the steps; a click opens the timeline. */
function EmailStatus({ m, ticketId, label }: { m: Message; ticketId?: number; label: string }) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<string[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const tone = emailStatus(m)?.tone ?? 'muted';
  const t = m.tracking ?? null;
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (steps !== null || !ticketId) return;
    try {
      const r = await messageTracking(ticketId, m.id);
      setSteps(r.timeline.map((e) => `${timeLabel(e.at)} · ${eventLine(e)}`));
    } catch (e) {
      setFailed(errorText(e, text('The timeline could not be loaded.')));
    }
  };
  return (
    <span className="relative">
      <button
        type="button"
        data-email-status={t?.state ?? m.delivery_status ?? undefined}
        aria-expanded={open}
        title={trackingSummary(t) || undefined}
        onClick={() => void toggle()}
        className={cx('font-medium hover:underline', TONE[tone])}
      >
        {label}
      </button>
      {open ? (
        <span role="dialog" aria-label={text('Email timeline')} data-email-timeline className="absolute right-0 top-5 z-20 flex w-[300px] flex-col gap-1 rounded-[10px] border border-line bg-surface p-2.5 text-left text-[12px] font-normal text-ink-2 shadow-lg">
          {t && !t.tracked ? <span className="text-ink-3">{untrackedReason(t.untracked_reason)}</span> : null}
          {(steps ?? (t ? trackingSummary(t).split('\n').filter((l) => l !== ACCURACY()) : [])).map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
          {failed ? <span className="text-danger">{failed}</span> : null}
          <span className="mt-1 border-t border-line pt-1 text-[11px] text-ink-3">{ACCURACY()}</span>
        </span>
      ) : null}
    </span>
  );
}

/** A reply whose email bounced or did not go (#335): why, and Retry / Edit address when the tab can send it again. */
function BounceBar({ m, requesterEmail, onResend }: { m: Message; requesterEmail?: string | null; onResend?: (m: Message, email?: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(requesterEmail ?? '');
  const bounced = m.delivery_status === 'bounced' || m.tracking?.state === 'bounced';
  const why = m.delivery_error || m.tracking?.reason || null;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <div data-bounce className="mt-2 flex flex-wrap items-center gap-2 rounded-[8px] bg-danger-bg px-2 py-1.5 text-[12px] text-danger">
      <Icon name="warning" size={13} />
      <span className="min-w-0 flex-1">
        <b>{bounced ? text('The email bounced') : text('The email did not go')}</b>
        {why ? ` · ${why}` : ''}
      </span>
      {onResend && !editing ? (
        <>
          <button type="button" onClick={() => onResend(m)} className="rounded-[6px] border border-line bg-surface px-2 py-0.5 font-semibold text-ink-2 hover:bg-subtle">
            {text('Retry')}
          </button>
          <button type="button" onClick={() => setEditing(true)} className="rounded-[6px] border border-line bg-surface px-2 py-0.5 font-semibold text-ink-2 hover:bg-subtle">
            {text('Edit address')}
          </button>
        </>
      ) : null}
      {onResend && editing ? (
        <form
          className="flex w-full items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onResend(m, email.trim());
            setEditing(false);
          }}
        >
          <input
            aria-label={text('Requester’s email address')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2 text-[12px] text-ink outline-none focus:border-primary"
          />
          <button type="submit" disabled={!valid} className="rounded-[6px] bg-primary px-2 py-0.5 font-semibold text-white disabled:opacity-50">
            {text('Send again')}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="px-1 text-ink-3 hover:text-ink-2">
            {text('Cancel')}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** What a chat calls someone it has no name for: the ticket's requester is named instead (#332). */
const NAMELESS = /^(website\s+)?(visitor|guest|requester|customer|user)(\s*[#-]?\s*\d*)?$/i;

/** Who wrote a message, by name: the requester's own name over a chat's "Visitor". */
export function authorName(m: Message, requester?: string | null): string {
  const named = m.author?.name || m.author_name || null;
  const who = speaker(m);
  if (who === 'requester') return named && !NAMELESS.test(named.trim()) ? named : requester || named || text('Requester');
  if (who === 'assistant') return named || text('Assistant');
  return named || text('Staff');
}

/** Lines from one person this close together are one group: their name and time once (#332). */
export const GROUP_GAP_MS = 5 * 60_000;

const at = (m: Message) => (m.created_at ? parseTs(m.created_at).getTime() : NaN);

/**
 * The messages shown under the one before, without their name and time (#332): the same person, the same way (note,
 * channel, delivery, copies), within GROUP_GAP_MS of the line before. A chat's own line, a new day, the "new since"
 * line and a message still sending or not sent end a group.
 */
export function groupedMessages(messages: Message[], { source = null, breaks = new Set<number>() }: { source?: string | null; breaks?: Set<number> } = {}): Set<number> {
  const grouped = new Set<number>();
  let last: { key: string; at: number } | null = null;
  messages.forEach((m, i) => {
    const who = speaker(m);
    if (who === 'system' || m.local_status) {
      last = null;
      return;
    }
    const key = [who, m.author?.id ?? m.author_name ?? '', isNote(m), messageChannel(m, i === 0, source) ?? '', delivery(m) ?? '', (m.cc ?? []).join(',')].join('|');
    const when = at(m);
    if (last && !breaks.has(m.id) && last.key === key && when - last.at >= 0 && when - last.at <= GROUP_GAP_MS) grouped.add(m.id);
    last = Number.isNaN(when) ? null : { key, at: when };
  });
  return grouped;
}

/** A chat's own line (#332): small and grey across the thread; the visitor details open under it, for the desk alone. */
function SystemLine({ m, files, pictures, onOpenAttachment }: { m: Message; files: Attachment[]; pictures: Attachment[]; onOpenAttachment?: (a: Attachment) => void }) {
  const [open, setOpen] = useState(false);
  const [headline, ...rest] = m.body.trim().split(/\r?\n/);
  const more = rest.join('\n').trim();
  const time = timeLabel(m.created_at);
  return (
    <li data-message={m.id} data-from="system" className="flex flex-col items-center gap-1 py-0.5 text-center">
      <div className="flex max-w-full items-center gap-1.5 text-[11.5px] text-ink-3">
        {m.internal ? (
          <span title={text('Staff only: the requester does not see this')} className="inline-flex shrink-0 items-center">
            <Icon name="lock" size={11} label={text('Staff only')} />
          </span>
        ) : null}
        {more ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-w-0 items-center gap-1 hover:text-ink-2">
            <span className="truncate">{headline}</span>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
        ) : (
          <span className="truncate">{headline}</span>
        )}
        {time ? <span className="shrink-0">· {time}</span> : null}
      </div>
      {open && more ? <div className="max-w-[520px] rounded-[8px] bg-subtle px-3 py-2 text-left text-[12px] whitespace-pre-wrap text-ink-2 selectable">{more}</div> : null}
      {files.length ? <MessageFiles files={files} pictures={pictures} onOpen={onOpenAttachment} /> : null}
    </li>
  );
}

const CARD_TONE: Record<Speaker | 'note', string> = {
  note: 'border-[#F6D7B0] bg-[#FFF8EC] dark:border-[#5A3B14] dark:bg-[#2A1E0C]',
  requester: 'border-line bg-surface',
  staff: 'border-line bg-[#F7F8FC] dark:bg-[#151E3A]',
  assistant: 'border-[#DDD6FE] bg-[#F7F5FF] dark:border-[#3B2F66] dark:bg-[#1A1530]',
  system: 'border-line bg-surface',
};

export function Thread({
  messages,
  attachments = [],
  lastRead = 0,
  me = null,
  source = null,
  requester = null,
  compact = false,
  onOpenAttachment,
  className,
  ticketId,
  onHeld,
  requesterEmail = null,
  onResend,
}: {
  messages: Message[];
  attachments?: Attachment[];
  lastRead?: number;
  me?: number | null;
  /** The ticket's source: the first message's channel when it says none. Given only when the thread starts here. */
  source?: string | null;
  /** The ticket's requester, by name: who a chat's "Visitor" was (#332). */
  requester?: string | null;
  /** The reading pane's denser form. */
  compact?: boolean;
  onOpenAttachment?: (a: Attachment) => void;
  className?: string;
  /** The ticket, for "Show original" (#336). */
  ticketId?: number;
  /** Release or discard a reply held from an unverified sender (#336); without it the bar only says so. */
  onHeld?: (m: Message, action: HeldAction) => void;
  /** The requester's address, for Edit address on a bounced reply (#335). */
  requesterEmail?: string | null;
  /** Send a bounced or failed reply again, to a corrected address when given (#335); without it the bar only says why. */
  onResend?: (m: Message, email?: string) => void;
}) {
  const divider = newSinceIndex(messages, lastRead, me);
  const filesOf = new Map<number, Attachment[]>();
  for (const a of attachments) if (a.message_id !== null) filesOf.set(a.message_id, [...(filesOf.get(a.message_id) ?? []), a]);
  // The thread's pictures, in its order: ‹ › in the viewer goes through them all.
  const pictures = messages.flatMap((m) => (filesOf.get(m.id) ?? []).filter(isPicture));
  // A day's heading above its first message (not in the reading pane, where the thread is short).
  const dayHeads = new Set<number>();
  let lastDay = '';
  for (const m of messages) {
    const day = m.created_at ? stampDayLabel(m.created_at, 'long') : '';
    if (!compact && day && day !== lastDay) dayHeads.add(m.id);
    if (day) lastDay = day;
  }
  const breaks = new Set(dayHeads);
  if (divider >= 0) breaks.add(messages[divider]!.id);
  const grouped = groupedMessages(messages, { source, breaks });
  return (
    <ol aria-label={text('Conversation')} className={cx('flex flex-col', compact ? 'gap-2.5' : 'gap-3', className)}>
      {messages.map((m, i) => {
        const day = m.created_at ? stampDayLabel(m.created_at, 'long') : '';
        const newDay = dayHeads.has(m.id);
        const files = filesOf.get(m.id) ?? [];
        const who = speaker(m);
        const note = isNote(m);
        const head = (
          <>
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
          </>
        );
        if (who === 'system') {
          return (
            <Fragment key={m.id}>
              {head}
              <SystemLine m={m} files={files} pictures={pictures} onOpenAttachment={onOpenAttachment} />
            </Fragment>
          );
        }
        const name = authorName(m, requester);
        const sent = delivery(m);
        // A server that tracks says what came back about the email (#335): the status opens its timeline.
        const tracked = !m.local_status && who === 'staff' && !m.internal && (m.tracking != null || m.delivery_status === 'bounced');
        const failedEmail = !m.local_status && who === 'staff' && !m.internal && !saidInChat(m) && (m.delivery_status === 'bounced' || m.delivery_status === 'failed');
        const channel = messageChannel(m, i === 0, source);
        // A server that sends no copy list sends no copies.
        const cc = m.cc ?? [];
        const inGroup = grouped.has(m.id);
        const hideBody = onlyFileNames(m.body, files) && (!m.body_html || files.length > 0);
        return (
          <Fragment key={m.id}>
            {head}
            <li
              data-message={m.id}
              data-from={who}
              data-internal={note || undefined}
              data-grouped={inGroup || undefined}
              title={inGroup ? timeLabel(m.created_at) || undefined : undefined}
              className={cx('rounded-[10px] border', compact ? 'px-3 py-2' : 'px-4 py-3', inGroup && (compact ? '-mt-1.5 py-1.5' : '-mt-2 py-2'), CARD_TONE[note ? 'note' : who])}
            >
              {inGroup ? null : (
                <div className="mb-1 flex min-w-0 items-center gap-2 text-[12px]">
                  {who === 'assistant' ? (
                    <span
                      aria-hidden
                      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#EDE9FE] text-[#6D28D9] dark:bg-[#2A1F4A] dark:text-[#C4B5FD]"
                      style={{ width: compact ? 20 : 24, height: compact ? 20 : 24 }}
                    >
                      <Icon name="sparkles" size={compact ? 12 : 14} />
                    </span>
                  ) : (
                    <Avatar name={name} size={compact ? 20 : 24} />
                  )}
                  <b className="truncate text-ink">{name}</b>
                  {note ? (
                    <span data-channel="note" className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-warning-bg px-1.5 text-[11px] font-semibold text-warning-ink">
                      <Icon name="lock" size={11} />
                      {text('Internal note')}
                    </span>
                  ) : who === 'assistant' ? (
                    <span data-channel="assistant" className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-[#EDE9FE] px-1.5 text-[11px] font-semibold text-[#6D28D9] dark:bg-[#2A1F4A] dark:text-[#C4B5FD]">
                      <Icon name="sparkles" size={11} />
                      {text('Assistant')}
                    </span>
                  ) : (
                    <>
                      {channel ? (
                        <span data-channel={channel} className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-subtle px-1.5 text-[11px] font-semibold text-ink-3">
                          <Icon name={channelIcon(channel)} size={11} />
                          {channelBadge(who, channel)}
                        </span>
                      ) : null}
                      {/* The channel says how a requester's message came; a reply still says it went to them, unless it was said in the chat. */}
                      {(who === 'staff' && !saidInChat(m)) || !channel ? <span className="truncate text-ink-3">{messageKind(m)}</span> : null}
                    </>
                  )}
                  {cc.length && !m.internal ? <span className="truncate text-ink-3">· {text('CC {list}', { list: cc.join(', ') })}</span> : null}
                  {m.held === 'released' ? <span className="truncate text-success">· {text('Released from review')}</span> : null}
                  {m.held === 'discarded' ? <span className="truncate text-ink-3">· {text('Discarded · unverified sender')}</span> : null}
                  <span className="ml-auto shrink-0 text-ink-3" title={m.created_at ? stampDayLabel(m.created_at, 'long') : undefined}>
                    {timeLabel(m.created_at)}
                    {sent && tracked ? (
                      <>
                        {' · '}
                        <EmailStatus m={m} ticketId={ticketId} label={sent} />
                      </>
                    ) : sent ? (
                      ` · ${sent}`
                    ) : (
                      ''
                    )}
                  </span>
                </div>
              )}
              {m.held === 'unverified' ? <HeldBar m={m} onHeld={onHeld} /> : null}
              {hideBody ? null : (
                <FormattedMessage html={withClickCounts(m.body_html || linkReplyUrls(replyHtml(m.body)), m.tracking?.links)} className={compact ? 'text-[12.5px]' : 'text-[13.5px] leading-relaxed'} />
              )}
              {failedEmail ? <BounceBar m={m} requesterEmail={requesterEmail} onResend={onResend} /> : null}
              {m.local_status === 'failed' && m.retry_input ? (
                <button
                  type="button"
                  className="mt-2 text-primary underline"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('support:retry-message', {
                        detail: {
                          ticketId: m.local_ticket_id ?? 0,
                          input: m.retry_input,
                        },
                      }),
                    )
                  }
                >
                  {text('Retry')}
                </button>
              ) : null}
              {files.length ? <MessageFiles files={files} pictures={pictures} onOpen={onOpenAttachment} className={hideBody ? undefined : 'mt-2'} /> : null}
              {m.has_original && ticketId ? <Original ticketId={ticketId} m={m} /> : null}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
