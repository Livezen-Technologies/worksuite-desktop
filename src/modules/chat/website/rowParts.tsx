import type { ReactNode } from 'react';
import type { WebchatRingChat } from '@shared/types';
import { text } from '../../../core/i18n';
import { markdownLine } from '../../../core/markdown';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { conversationStamp, listStamp, parseTs, timeLabel } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { UserAvatar } from '../../../components/UserAvatar';
import { useNow } from '../../calls/parts';
import { lastSaid, ratedLine, waitingSince, waitTone, type WebsiteRow } from './api';
import { clock, waited } from './Ringing';

/**
 * What a website chat's row shows, in both of its lists (CHAT-UI-00, UX-LIST-01): the card list beside an open
 * thread and the full-width table. One set of pieces, so the two can never say different things about a chat.
 */

const TAG = {
  danger: 'bg-danger-bg text-danger',
  indigo: 'bg-selection text-primary',
  warning: 'bg-warning-bg text-[#9A4A06] dark:text-warning',
  muted: 'bg-subtle text-ink-3',
  // "Back on the site" on an offline enquiry (C-05).
  success: 'bg-success-bg text-success',
};

/** A small chip on a row; `chip` is the table's larger status chip. */
export function Tag({ tone, size = 'sm', children }: { tone: keyof typeof TAG; size?: 'sm' | 'chip'; children: ReactNode }) {
  return <span className={cx('shrink-0 font-bold', size === 'chip' ? 'rounded-[8px] px-2 py-0.5 text-[11px]' : 'rounded-[5px] px-1.5 py-px text-[10.5px]', TAG[tone])}>{children}</span>;
}

/**
 * A filter pill, pressed or not: the lists' Open / Mine / Closed, To follow up / Handled (C-04), and the Voice calls
 * list's All / Answered / Missed / Recorded (V-01).
 */
export function FilterPill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx('h-7 rounded-[14px] px-3', on ? 'bg-ink text-surface' : 'border border-line text-ink hover:bg-subtle')}>
      {children}
    </button>
  );
}

/**
 * A chat silenced for me that is still waiting (R-04, RING-UI-04; RING-24): its row is amber, with an amber edge, in
 * the table and the card list alike.
 */
export const ROW_SILENCED = 'bg-warning-bg shadow-[inset_3px_0_0_var(--color-warning)]';

/**
 * The bell on a ringing chat's row; struck through and amber once I silenced it — for me, on all my devices
 * (RING-11, RING-24), so "Silenced for you", not "on this computer".
 */
export function RingBell({ ring }: { ring: WebchatRingChat }) {
  return <Icon name={ring.silenced ? 'bell-off' : 'bell'} size={12} className={ring.silenced ? 'shrink-0 text-warning' : 'shrink-0 text-danger'} label={ring.silenced ? text('Silenced for you') : text('Ringing')} />;
}

/** "Ringing · silenced" in the table's Status column (R-04): it still rings for colleagues, not for me. */
export function SilencedStatus() {
  return (
    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#9A5B10] dark:text-warning">
      <Icon name="bell-off" size={14} className="shrink-0" label={text('Silenced for you')} />
      {text('Ringing · silenced')}
    </span>
  );
}

/** The priorities a card row marks; the table says every one. */
export const PRIORITY_TAG: Record<string, string> = { vip: 'VIP', urgent: 'Urgent', high: 'High' };

/** WHEN on Voice calls and its Call-backs (V-01, V-02): the time today, else the day and the time — "Thu 15:02". */
export function whenLabel(at: string, now = new Date()): string {
  const day = conversationStamp(at, now);
  const time = timeLabel(at);
  return day === time ? time : `${day} ${time}`;
}

/** The signed-in person's id: "with You" on a call's banner, "Assigned to You" on a call-back (V-01, V-02). */
export function useMe(): number | null {
  return useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
}

/** A site's name from a link, as "Came from" says it: no scheme, no www, no path. */
export const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

/** The visitor panels' card and its heading — the thread's dossier and the missed chat's (C-04) — drawn alike. */
export const PANEL_HEADING = 'text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase';
export const PANEL_CARD = 'flex flex-col gap-[7px] rounded-[12px] border border-line bg-surface px-3 py-2.5';

/**
 * The full-width tables' frame, header row and picked row — the conversation lists (C-03, WebsiteTable) and Visitors
 * online (C-07) — drawn alike.
 */
export const TABLE_FRAME = 'overflow-hidden rounded-[12px] border border-line bg-surface';
export const TABLE_HEAD = 'border-b border-line bg-subtle px-4 py-2.5 text-[10.5px] font-bold tracking-[0.9px] text-ink-3 uppercase';
export const ROW_PICKED = 'bg-selection/60 shadow-[inset_3px_0_0_var(--color-primary)]';

/** "techubiz.com/shop/coreldraw": where a visitor was, site and page, as Visitors online and Missed chats say it. */
export function siteAndPath(url: string | null | undefined): string {
  if (!url) return '—';
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname === '/' ? '/' : u.pathname}`;
  } catch {
    return url;
  }
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/**
 * A row's one line under the visitor: what is ringing, else what was said last (the visitor's own words in quotes
 * when `quote`) — plain words on one line, never Markdown's marks, and a picture or a file by what it is (#261) — else
 * the page they are reading, else who has the chat, else their email.
 *
 * Never a blank line (worksuite-desktop#261): with nothing in words or a file, what happened last as far as the row
 * tells it — a closed chat's rating ("★★★★★ Rated 5"), else "Visitor left" (they ended it) or "Chat closed"; an open
 * one whose visitor has gone, "Visitor left"; else "Message" for something the row cannot name, or "No messages yet".
 */
export function rowPreview(r: WebsiteRow, { me, myName, ring, quote = false }: { me: number | null; myName: string | null; ring?: WebchatRingChat; quote?: boolean }): string {
  const closed = r.status === 'closed';
  const page = r.current_url ? pathOf(r.current_url) : null;
  const mine = me !== null && r.assigned_to === me;
  const rung = ring?.preview ? markdownLine(ring.preview) : '';
  if (rung) return `“${rung}”`;
  const m = r.last_message;
  if (m) {
    const words = markdownLine(m.body ?? '');
    if (words && quote && m.from === 'visitor') return `“${words}”`;
    const said = lastSaid(m, myName);
    if (said) return said;
  }
  if (closed) return r.rating ? ratedLine(r.rating) : r.closed_reason === 'visitor' ? text('Visitor left') : text('Chat closed');
  if (r.online && page) return text('Reading {page}', { page });
  if (r.agent) return mine ? text('With you') : text('With {name}', { name: r.agent });
  if (r.email) return r.email;
  return !r.online ? text('Visitor left') : m ? `💬 ${text('Message')}` : text('No messages yet');
}

/**
 * How long a visitor has waited, counting while it is under an hour (then when they wrote). Amber once they have
 * waited as long as it takes to be offered a callback, red after it (#223); red throughout on a site without offers.
 */
export function WaitClock({ since, amber, red, size = 'sm', silenced = false }: { since: string; amber?: number | null; red?: number | null; size?: 'sm' | 'md'; silenced?: boolean }) {
  const now = useNow(1_000);
  const at = parseTs(since).getTime();
  const big = size === 'md';
  if (Number.isNaN(at) || now - at >= 3_600_000) return <span className={cx('shrink-0 text-ink-3', big ? 'text-[12.5px]' : 'text-[11px]')}>{listStamp(since)}</span>;
  // Silenced for me, the wait is amber whatever its length (R-04): the row says it waits, not that it rings.
  const tone = silenced ? 'amber' : waitTone((now - at) / 1000, amber, red);
  return (
    <span data-tone={tone} title={silenced ? undefined : tone === 'amber' ? text('Offered a callback') : tone === 'red' && (amber || red) ? text('Waiting past the callback offers') : undefined}
      aria-label={text('waiting {time}', { time: waited(since, now) })}
      className={cx('shrink-0 font-mono tabular-nums', big ? 'text-[13px] font-semibold' : 'text-[11px] font-bold', tone === 'red' ? 'text-danger' : tone === 'amber' ? 'text-[#9A4A06] dark:text-warning' : 'text-ink-2')}>
      {waited(since, now)}
    </span>
  );
}

/** "On a call · 2:14" on a row (VOICE-UI-02): calling, on, or on hold. */
export function CallLine({ call }: { call: NonNullable<WebsiteRow['call']> }) {
  const now = useNow(1_000);
  const at = call.since ? parseTs(call.since).getTime() : NaN;
  const time = Number.isNaN(at) ? '' : ` · ${clock((now - at) / 1000)}`;
  const words = call.status === 'ringing' ? text('Calling') : call.status === 'on_hold' ? text('On hold') : text('On a call');
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[12px] font-semibold text-success">
      <Icon name={call.status === 'ringing' ? 'phone-incoming' : 'phone'} size={12} className={cx('shrink-0', call.status === 'ringing' && 'motion-safe:animate-pulse')} />
      <span className="truncate tabular-nums">{words}{time}</span>
    </span>
  );
}

/** "4m", "1h 5m", "2d": a wait as short as a pill can carry it (worksuite-desktop#239). */
export function shortWait(seconds: number): string {
  const m = Math.max(1, Math.floor(seconds / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * "Waiting 4m" on a list row (worksuite-desktop#239): amber while the visitor waits, red once past the response target —
 * the chat at risk, or past the site's red mark (#223).
 */
export function WaitPill({ r, since }: { r: Pick<WebsiteRow, 'at_risk' | 'wait_red' | 'reply_waiting_since' | 'reply_stage'>; since: string }) {
  const now = useNow(15_000);
  const at = parseTs(since).getTime();
  const seconds = Number.isNaN(at) ? 0 : Math.max(0, (now - at) / 1000);
  const red = r.at_risk || (!!r.wait_red && seconds >= r.wait_red);
  const why = r.at_risk ? text('At risk') : r.reply_waiting_since ? (r.reply_stage === 'team' ? text('Visitor replied · team alerted') : text('Visitor replied')) : undefined;
  return (
    <span data-tone={red ? 'red' : 'amber'} title={why} className={cx('shrink-0 rounded-[5px] px-1.5 py-px text-[10.5px] font-bold tabular-nums', red ? TAG.danger : TAG.warning)}>
      {text('Waiting {time}', { time: shortWait(seconds) })}
    </span>
  );
}

/**
 * "Reopened" on a returning visitor's chat (worksuite-desktop#291): it closed, and they came back and wrote in it again.
 * Nothing on a closed chat, or from a server that does not say.
 */
export function ReopenedTag({ r }: { r: Pick<WebsiteRow, 'reopened_at' | 'status'> }) {
  if (!r.reopened_at || r.status === 'closed') return null;
  return (
    <span title={text('The visitor came back and wrote again, so the chat reopened')} className="flex shrink-0">
      <Tag tone="indigo">{text('Reopened')}</Tag>
    </span>
  );
}

/** A list row's one status pill (worksuite-desktop#239): waiting, else unread, else none — or Closed on a closed chat. */
export function StatusPill({ r, unread }: { r: WebsiteRow; unread: number }) {
  if (r.status === 'closed') return <Tag tone="muted">{text('Closed')}</Tag>;
  const since = waitingSince(r);
  if (r.awaiting_reply && since) return <WaitPill r={r} since={since} />;
  if (unread > 0) return <Tag tone="indigo">{text('Unread')}</Tag>;
  return null;
}

/**
 * Who has a chat, on the right of its row (worksuite-desktop#239): the owner's photo — mine when it is mine — and anyone
 * helping, at most two and "+N"; nothing while nobody has it. Observers are not shown.
 */
export function AssigneeFaces({ r, me }: { r: Pick<WebsiteRow, 'team' | 'assigned_to' | 'agent'>; me: number | null }) {
  const team = (r.team ?? []).filter((p) => p.role !== 'observer');
  const people = team.length ? team : r.assigned_to !== null ? [{ user_id: r.assigned_to, name: r.agent ?? text('Agent'), avatar: null }] : [];
  if (!people.length) return null;
  const label = people.length > 1
    ? text('In this chat: {names}', { names: people.map((p) => p.name).join(', ') })
    : people[0]!.user_id === me ? text('Assigned to you') : text('Assigned to {name}', { name: people[0]!.name });
  const more = people.length - 2;
  return (
    <span role="img" aria-label={label} title={label} className="flex shrink-0 items-center">
      {people.slice(0, 2).map((p, i) => <UserAvatar key={p.user_id} userId={p.user_id} name={p.name} src={p.avatar} size={16} className={cx('ring-2 ring-surface', i > 0 && '-ml-1')} />)}
      {more > 0 ? <span className="ml-0.5 text-[10px] font-semibold text-ink-3">+{more}</span> : null}
    </span>
  );
}
