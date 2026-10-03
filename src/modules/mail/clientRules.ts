import { text } from '../../core/i18n';
import { parseTs } from '../../core/time';
import type { MailFilter } from './MailRules';
import type { MessageRow } from './types';

/**
 * Rules that run on this computer only (ENH-MAIL-03 DMO-RUL-04, WF-DO04
 * step 3): alerts, sounds and moves for mail as it arrives here. They never
 * reach the server; mail that arrived while the app was closed is handled at
 * the next start (up to seven days back), without alerts for old mail.
 */

const DEVICE_KEY = 'ws.mail.device';
const SEEN_KEY = 'ws.mail.clientRules.seen';
const SINCE_KEY = 'ws.mail.clientRules.since';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** This computer's id for "On this computer only" rules. */
export function deviceId(): string {
  const s = storage();
  let id = s?.getItem(DEVICE_KEY) ?? null;
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try {
      s?.setItem(DEVICE_KEY, id);
    } catch {
      // Private window: a fresh id each time, and this computer's rules wait for a stable one.
    }
  }
  return id;
}

/** One condition against a row: From, To, Subject or anywhere; contains, is, or a * pattern. */
export function rowMatches(t: Pick<MailFilter, 'field' | 'op' | 'value'>, m: Pick<MessageRow, 'from_name' | 'from_email' | 'subject'> & { to?: string; conversation_key?: string }): boolean {
  const v = t.value.toLowerCase();
  // An ignored conversation (DMO-INB-10): the row's thread root, exactly.
  if (t.field === 'thread') return v !== '' && (m.conversation_key ?? '').trim().replace(/^<|>$/g, '').toLowerCase() === v;
  const hay = t.field === 'subject' ? [m.subject] : t.field === 'to' ? [m.to ?? ''] : t.field === 'any' ? [`${m.from_name} ${m.from_email}`, m.to ?? '', m.subject] : [`${m.from_name} ${m.from_email}`];
  return hay.some((h) => {
    const s = (h ?? '').toLowerCase();
    if (t.op === 'is') return s === v || s.split(/\s+/).includes(v);
    if (t.op === 'matches') return new RegExp(`^${v.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(s);
    return v !== '' && s.includes(v);
  });
}

/** Does a this-computer rule take this row: condition holds, no exception does. */
export function ruleTakes(f: MailFilter, m: Pick<MessageRow, 'from_name' | 'from_email' | 'subject'> & { conversation_key?: string }): boolean {
  return f.enabled && rowMatches(f, m) && !(f.exceptions ?? []).some((e) => rowMatches(e, m));
}

/** The rules for this computer. */
export function myRules(filters: MailFilter[], me = deviceId()): MailFilter[] {
  return filters.filter((f) => f.run_location === 'client' && f.enabled && (!f.device_id || f.device_id === me));
}

/**
 * The new rows a this-computer rule has not seen: newer than when rules
 * started here (at most seven days back), not handled before.
 */
export function freshRows(rows: MessageRow[], key: (m: MessageRow) => string, now = Date.now()): { rows: MessageRow[]; old: Set<string> } {
  const s = storage();
  const since = Math.max(Number(s?.getItem(SINCE_KEY) ?? 0) || now, now - 7 * 86_400_000);
  if (!s?.getItem(SINCE_KEY)) {
    try {
      s?.setItem(SINCE_KEY, String(now));
    } catch {
      // Nothing to remember with: only mail from now on is handled.
    }
  }
  let seen: string[] = [];
  try {
    seen = JSON.parse(s?.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    seen = [];
  }
  const done = new Set(seen);
  const out = rows.filter((m) => !done.has(key(m)) && parseTs(m.created_at).getTime() >= since - 60_000);
  // Older than ten minutes: handled quietly (no alert for old mail).
  const old = new Set(out.filter((m) => now - parseTs(m.created_at).getTime() > 10 * 60_000).map(key));
  return { rows: out, old };
}

export function markSeen(keys: string[]): void {
  const s = storage();
  if (!s || keys.length === 0) return;
  try {
    const seen = JSON.parse(s.getItem(SEEN_KEY) ?? '[]') as string[];
    s.setItem(SEEN_KEY, JSON.stringify([...seen, ...keys].slice(-2000)));
  } catch {
    // Not remembered: the next look handles them again, which is harmless for alerts and idempotent for moves.
  }
}

/** A short chime for "Play a sound" (no file to ship). */
export function chime(): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    // No audio here: the alert still shows.
  }
}

/** "Show an alert": a desktop notification with the sender and subject. */
export function alertFor(m: Pick<MessageRow, 'from_name' | 'from_email' | 'subject'>, rule: string): void {
  try {
    const N = (window as unknown as { Notification?: typeof Notification }).Notification;
    if (N && N.permission !== 'denied') new N(m.from_name || m.from_email, { body: `${m.subject || text('(no subject)')} · ${rule}` });
  } catch {
    // Notifications refused by the system: nothing else to do.
  }
}
