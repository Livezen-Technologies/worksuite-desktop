import type { EmailTracking, Message, Ticket, TrackingEvent, TrackedLink } from '@shared/support';
import { text } from '../../core/i18n';
import { stampDayLabel, timeLabel } from '../../core/time';

/**
 * What came back about a reply the desk emailed (#335), in words: Sending → Sent → Delivered, or Bounced; then Opened
 * and Clicked. The latest word sits on the right of the message header ("12:04 PM · Opened 12:30 PM · Clicked 1 link"),
 * the whole timeline opens from it, and each link in the reply shows its clicks.
 *
 * HONEST. An open Apple Mail Privacy Protection or an image proxy made for the reader is "Opened (automatic)", never
 * "Opened"; a link checker's click is "Scanned", never a click. Tracking isn't always accurate, and every place that
 * shows it says so.
 */

export const ACCURACY = (): string => text('Open and click tracking isn’t always accurate.');

export type Tone = 'muted' | 'ok' | 'good' | 'warn' | 'bad';

const n = (count: number, one: string, many: string) => text(count === 1 ? one : many, { n: count });

/** Links the requester followed (not scanned). */
export function clickedLinks(t: EmailTracking): TrackedLink[] {
  return t.links.filter((l) => l.clicks > 0);
}

/**
 * The latest word on a staff reply's email, and how it reads: null when there is nothing to say (a note, the
 * requester's own words, a line said in a chat, or a server from before delivery existed).
 */
export function emailStatus(m: Pick<Message, 'delivery_status' | 'tracking' | 'delivery_error'>, at: (iso: string | null) => string = timeLabel): { label: string; tone: Tone } | null {
  const t = m.tracking ?? null;
  const s = m.delivery_status;
  if (s === 'bounced' || t?.state === 'bounced') return { label: text('Bounced'), tone: 'bad' };
  if (s === 'failed') return { label: text('Not delivered'), tone: 'bad' };
  if (s === 'held' || s === 'suppressed' || s === 'cancelled' || s === 'no_address') return { label: text('Not emailed'), tone: 'warn' };
  if (s === 'not_sent') return { label: text('Not emailed'), tone: 'muted' };

  const parts: string[] = [];
  if (t?.opened_at) parts.push(text('Opened {time}', { time: at(t.opened_at) }).trim() + (t.opens > 1 ? ` (${t.opens}×)` : ''));
  else if (t?.auto_opened_at) parts.push(text('Opened (automatic)'));
  else if (t?.delivered_at || s === 'delivered') parts.push(text('Delivered'));
  if (t && t.clicks > 0) parts.push(n(clickedLinks(t).length || 1, 'Clicked {n} link', 'Clicked {n} links'));
  if (parts.length) return { label: parts.join(' · '), tone: t?.opened_at || (t && t.clicks > 0) ? 'good' : 'ok' };

  if (s === 'queued' || s === 'sending') return { label: text('Sending…'), tone: 'muted' };
  if (s === 'sent') return { label: text('Sent'), tone: 'ok' };
  return s ? { label: s, tone: 'muted' } : null;
}

/** Why a reply was not tracked, in words. */
export function untrackedReason(reason: string | null): string {
  switch (reason) {
    case 'agent':
      return text('Tracking was turned off for this email.');
    case 'internal':
      return text('Email between staff is never tracked.');
    case 'opted_out':
      return text('The requester opted out of tracking.');
    case 'off':
      return text('Tracking is off for this desk.');
    default:
      return text('Not tracked.');
  }
}

/** One step of the timeline, in words. */
export function eventLine(e: TrackingEvent): string {
  const client = e.client ? ` · ${e.client}` : '';
  const what = e.link ? e.link.label || e.link.url : '';
  switch (e.kind) {
    case 'queued':
      return text('Sent');
    case 'delivered':
      return text('Delivered');
    case 'deferred':
      return e.detail ? text('Delayed — {why}', { why: e.detail }) : text('Delayed');
    case 'bounced':
      return e.detail ? text('Bounced — {why}', { why: e.detail }) : text('Bounced');
    case 'complaint':
      return text('Marked as spam');
    case 'opened':
      return e.automatic ? `${text('Opened (automatic)')}${e.detail ? ` — ${e.detail}` : ''}` : `${text('Opened')}${client}`;
    case 'clicked':
      return e.automatic ? `${text('Scanned {link}', { link: what })}${e.detail ? ` — ${e.detail}` : ''}` : `${text('Clicked {link}', { link: what })}${client}`;
    default:
      return e.kind;
  }
}

/** The summary the status's tooltip carries, before the timeline is loaded. */
export function trackingSummary(t: EmailTracking | null | undefined): string {
  if (!t) return '';
  const when = (iso: string | null) => (iso ? `${stampDayLabel(iso, 'long')} ${timeLabel(iso)}` : '');
  const lines = [
    t.sent_at ? text('Sent {when}', { when: when(t.sent_at) }) : null,
    t.delivered_at ? text('Delivered {when}', { when: when(t.delivered_at) }) : null,
    t.bounced_at ? text('Bounced {when}', { when: when(t.bounced_at) }) + (t.reason ? ` — ${t.reason}` : '') : null,
  ];
  if (!t.tracked) return [...lines, untrackedReason(t.untracked_reason)].filter(Boolean).join('\n');
  return [
    ...lines,
    t.opened_at ? `${text('Opened {when}', { when: when(t.opened_at) })}${t.opens > 1 ? ` · ${n(t.opens, '{n} time', '{n} times')}` : ''}${t.client ? ` · ${t.client}` : ''}` : null,
    t.auto_opens > 0 ? text('Opened (automatic) {n} — an image proxy or privacy protection, not the requester', { n: n(t.auto_opens, '{n} time', '{n} times') }) : null,
    t.clicks > 0 ? n(t.clicks, 'Clicked {n} time', 'Clicked {n} times') : null,
    t.scans > 0 ? text('Scanned {n} by a link checker', { n: n(t.scans, '{n} time', '{n} times') }) : null,
    t.purged ? text('Opens and clicks were purged after the desk’s retention.') : null,
    ACCURACY(),
  ].filter(Boolean).join('\n');
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The reply's HTML with a small click count after each link the requester followed: `<sup data-clicks>2</sup>`.
 * Matched by the link's own address (the stored reply keeps the real addresses; only the email went through `/c/`).
 */
export function withClickCounts(html: string, links: TrackedLink[] | undefined): string {
  const counted = (links ?? []).filter((l) => l.clicks > 0);
  if (!counted.length || !html) return html;
  const byUrl = new Map(counted.map((l) => [l.url, l]));
  return html.replace(/(<a\b[^>]*?\bhref\s*=\s*(["']))(.*?)\2([^>]*>)([\s\S]*?)(<\/a>)/gi, (whole, _open, _q, href: string, _rest, _inner, _close) => {
    const url = href.replace(/&amp;/g, '&').trim();
    const l = byUrl.get(url);
    if (!l) return whole;
    const title = escAttr(n(l.clicks, 'Clicked {n} time', 'Clicked {n} times'));
    return `${whole}<sup data-clicks="${l.clicks}" title="${title}">${l.clicks}</sup>`;
  });
}

/** The list's "opened the latest reply" mark (#335): what the requester did with the latest emailed reply. */
export function latestReplyMark(t: Pick<Ticket, 'latest_reply'>): { label: string; tone: Tone; icon: 'mail-open' | 'link' | 'warning' } | null {
  const r = t.latest_reply;
  if (!r) return null;
  const when = r.at ? ` ${timeLabel(r.at)}` : '';
  if (r.state === 'bounced') return { label: text('The latest reply bounced'), tone: 'bad', icon: 'warning' };
  if (r.state === 'clicked') return { label: text('Clicked a link in the latest reply') + when, tone: 'good', icon: 'link' };
  if (r.state === 'opened') return { label: text('Opened the latest reply') + when, tone: 'good', icon: 'mail-open' };
  return null;
}
