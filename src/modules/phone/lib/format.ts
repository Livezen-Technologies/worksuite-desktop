/**
 * How the phone shows numbers, durations, outcomes and money (WS-VOIP-SRS-001 §8: DM Mono for numbers and timers).
 * Pure functions, shared by every phone screen and tested on their own.
 */
import { formatPhone, toE164 } from '../../../core/phone';

export type Direction = 'inbound' | 'outbound' | 'internal';
export type Disposition = 'answered' | 'no_answer' | 'busy' | 'failed' | 'congestion' | 'cancelled';

/** `4:12`, `1:02:09`; a negative or missing value is `0:00`. */
export function clock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** `1h 52m`, `12m`, `45s` — talk time in a tile. */
export function talkTime(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Calls the switch reports as not reaching anybody. */
export function isMissed(d: string | null | undefined): boolean {
  return d === 'no_answer' || d === 'busy' || d === 'cancelled';
}

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  congestion: 'Congestion',
  cancelled: 'Abandoned',
};

export function dispositionLabel(d: string | null | undefined): string {
  return (d && DISPOSITION_LABEL[d as Disposition]) || '—';
}

export type Tone = 'muted' | 'indigo' | 'success' | 'warning' | 'danger' | 'teal';

export function dispositionTone(d: string | null | undefined): Tone {
  if (d === 'answered') return 'success';
  if (d === 'busy') return 'warning';
  if (d === 'failed' || d === 'congestion') return 'muted';
  return 'danger';
}

/** The arrow for a call: in, out or across the office; missed calls are drawn red by the caller. */
export function directionIcon(dir: string | null | undefined): string {
  if (dir === 'inbound') return 'phone-incoming';
  if (dir === 'outbound') return 'phone-outgoing';
  return 'phone';
}

/** The other party of a call as the person using the phone sees it. */
export function otherParty(call: { direction: string | null; from: string | null; to: string | null }): string {
  return (call.direction === 'outbound' ? call.to : call.from) ?? '';
}

/**
 * A number for people: an internal extension (2–8 digits) stays as typed, anything that reads as a phone number is
 * shown in international form (`+94 77 312 4408`), the rest as given.
 */
export function prettyNumber(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (/^\d{2,8}$/.test(s) || /^[*#]/.test(s)) return s;
  const e164 = toE164(s);
  return e164 ? formatPhone(e164) : s;
}

/**
 * What the dial pad may send: the SRS limits dialled numbers to `+ 0-9 * #` (NFR-04), and the server refuses
 * anything else. Spaces, dashes and brackets people paste are dropped; a leading `+` survives.
 */
export function dialable(raw: string): string {
  const t = raw.trim();
  const plus = t.startsWith('+') ? '+' : '';
  return plus + t.replace(/[^0-9*#]/g, '');
}

export function isDialable(raw: string): boolean {
  return /^\+?[0-9*#]{2,32}$/.test(dialable(raw));
}

/**
 * Money only when there is a rate (NFR-10 "no fabricated data"): a call on an unrated trunk has no cost, which is
 * not the same as a cost of zero.
 */
export function money(amount: number | null | undefined, currency = 'LKR', rated = true): string {
  if (!rated || amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  if (Math.abs(amount) >= 1000) return `${currency} ${(amount / 1000).toFixed(1)}K`;
  return `${currency} ${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

/** `5.9 MB`, `512 KB`. */
export function bytes(n: number | null | undefined): string {
  const v = Math.max(0, n ?? 0);
  if (v >= 1024 * 1024 * 1024) return `${(v / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  if (v >= 1024) return `${Math.round(v / 1024)} KB`;
  return `${v} B`;
}

/** A server timestamp (`2026-10-02 10:41:00`, UTC on the wire) as a Date, or null. */
export function parseStamp(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `10:41`, `Yesterday`, `Mon`, `12 Sep` — the "when" column of a recent call. */
export function when(s: string | null | undefined, now: Date = new Date()): string {
  const d = parseStamp(s);
  if (!d) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** `Today 10:41`, `Yesterday 17:44`, `Mon 16:02`, `12 Sep 09:30`. */
export function stamp(s: string | null | undefined, now: Date = new Date()): string {
  const d = parseStamp(s);
  if (!d) return '';
  const w = when(s, now);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return w.includes(':') ? `Today ${t}` : `${w} ${t}`;
}

/** Local `YYYY-MM-DD` for a date filter. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysAgo(n: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

/** Initials for a caller with no picture: a name's, or `#` for a bare number. */
export function callerInitials(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n || /^[+\d\s*#()-]+$/.test(n)) return '#';
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** Letters under each dial-pad key. */
export const KEYPAD: ReadonlyArray<{ d: string; l: string }> = [
  { d: '1', l: '' },
  { d: '2', l: 'ABC' },
  { d: '3', l: 'DEF' },
  { d: '4', l: 'GHI' },
  { d: '5', l: 'JKL' },
  { d: '6', l: 'MNO' },
  { d: '7', l: 'PQRS' },
  { d: '8', l: 'TUV' },
  { d: '9', l: 'WXYZ' },
  { d: '*', l: '' },
  { d: '0', l: '+' },
  { d: '#', l: '' },
];
