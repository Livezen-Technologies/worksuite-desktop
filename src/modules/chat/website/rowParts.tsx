import type { ReactNode } from 'react';
import type { WebchatRingChat } from '@shared/types';
import { text } from '../../../core/i18n';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { conversationStamp, listStamp, parseTs, timeLabel } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { useNow } from '../../calls/parts';
import { lastSaid, waitTone, type WebsiteRow } from './api';
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
 * when `quote`), else the page they are reading, else who has the chat, else their email.
 */
export function rowPreview(r: WebsiteRow, { me, myName, ring, quote = false }: { me: number | null; myName: string | null; ring?: WebchatRingChat; quote?: boolean }): string {
  const closed = r.status === 'closed';
  const page = r.current_url ? pathOf(r.current_url) : null;
  const mine = me !== null && r.assigned_to === me;
  if (ring?.preview) return `“${ring.preview}”`;
  if (r.last_message) {
    const said = lastSaid(r.last_message, myName);
    return quote && r.last_message.from === 'visitor' && said ? `“${said}”` : said;
  }
  if (r.online && page && !closed) return text('Reading {page}', { page });
  if (r.agent) return mine ? text('With you') : text('With {name}', { name: r.agent });
  return r.email ?? '';
}

/**
 * How long a visitor has waited, counting while it is under an hour (then when they wrote). Amber once they have
 * waited as long as it takes to be offered a callback, red after it (#223); red throughout on a site without offers.
 */
export function WaitClock({ since, amber, red, size = 'sm' }: { since: string; amber?: number | null; red?: number | null; size?: 'sm' | 'md' }) {
  const now = useNow(1_000);
  const at = parseTs(since).getTime();
  const big = size === 'md';
  if (Number.isNaN(at) || now - at >= 3_600_000) return <span className={cx('shrink-0 text-ink-3', big ? 'text-[12.5px]' : 'text-[11px]')}>{listStamp(since)}</span>;
  const tone = waitTone((now - at) / 1000, amber, red);
  return (
    <span data-tone={tone} title={tone === 'amber' ? text('Offered a callback') : tone === 'red' && (amber || red) ? text('Waiting past the callback offers') : undefined}
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
