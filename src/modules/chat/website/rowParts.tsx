import type { ReactNode } from 'react';
import type { WebchatRingChat } from '@shared/types';
import { text } from '../../../core/i18n';
import { listStamp, parseTs } from '../../../core/time';
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
};

/** A small chip on a row; `chip` is the table's larger status chip. */
export function Tag({ tone, size = 'sm', children }: { tone: keyof typeof TAG; size?: 'sm' | 'chip'; children: ReactNode }) {
  return <span className={cx('shrink-0 font-bold', size === 'chip' ? 'rounded-[8px] px-2 py-0.5 text-[11px]' : 'rounded-[5px] px-1.5 py-px text-[10.5px]', TAG[tone])}>{children}</span>;
}

/** The priorities a card row marks; the table says every one. */
export const PRIORITY_TAG: Record<string, string> = { vip: 'VIP', urgent: 'Urgent', high: 'High' };

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
