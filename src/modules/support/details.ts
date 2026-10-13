import type { Message, TicketClient } from '@shared/support';
import { cleanAnswer } from '../ai/textTools';

/**
 * The ticket details drawer's own rules (worksuite-desktop#334), kept apart from its screens so they can be read and
 * tested on their own: when the drawer shows and how, the AI brief and its copy on this computer, the details found
 * in the conversation, and how a phone number is checked and written.
 */

/* ── showing the drawer ─────────────────────────────────────────────────── */

/** A ticket's tab opens the drawer by itself from this window width; the inbox (with its list beside) from WIDE_INBOX. */
export const WIDE_TAB = 1280;
export const WIDE_INBOX = 1440;

// Showing it, its width and the shortcut are the shared details drawer's (components/DetailsDrawer), as in Website chats.
export { drawerState, type DrawerChoice } from '../../components/DetailsDrawer';

/** Where the choice and the width were kept before they were kept per person: read once, for a choice made then. */
export const LEGACY_CHOICE_KEY = 'ws.support.drawer';
export const LEGACY_WIDTH_KEY = 'ws.width.support.details';

/* ── the AI brief ───────────────────────────────────────────────────────── */

export interface Brief {
  summary: string;
  facts: string[];
  next: string | null;
  urgency: string | null;
  /** The newest message it read: a newer one makes it out of date. */
  upTo: number;
  at: string;
  /** Who wrote it: the model on this computer, online AI, or the desk's own summary. */
  engine: 'local' | 'online' | 'server';
}

/** The brief's four parts from a model's answer; anything without headings is the summary. */
export function parseBrief(raw: string): Pick<Brief, 'summary' | 'facts' | 'next' | 'urgency'> {
  const text = raw.replace(/\r/g, '');
  const part = (name: string) => {
    const m = new RegExp(`(?:^|\\n)\\s*\\**${name}\\**\\s*:\\**[ \\t]*([\\s\\S]*?)(?=\\n\\s*\\**(?:SUMMARY|FACTS|KEY FACTS|NEXT(?: STEP)?|URGENCY|SENTIMENT)\\**\\s*:|$)`, 'i').exec(text);
    return m ? m[1]!.trim() : null;
  };
  const none = (s: string | null) => (!s || /^(?:-\s*)?(?:none|n\/a|nothing)\.?$/i.test(s.trim()) ? null : s.trim());
  const lines = (s: string | null) =>
    (s ?? '')
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter((l) => l && !/^none\.?$/i.test(l))
      .slice(0, 6);
  const summary = part('SUMMARY');
  return {
    summary: (summary ?? cleanAnswer(text)).trim(),
    facts: lines(part('FACTS') ?? part('KEY FACTS')),
    next: none(part('NEXT') ?? part('NEXT STEP'))?.split('\n')[0]?.replace(/^\s*[-*•]\s*/, '') ?? null,
    urgency: none(part('URGENCY') ?? part('SENTIMENT'))?.split('\n')[0]?.replace(/^\s*[-*•]\s*/, '') ?? null,
  };
}

/** The conversation as the brief reads it: who said what (notes marked), oldest first, the newest 60. */
export function briefInput(messages: readonly Pick<Message, 'from' | 'internal' | 'body' | 'author_name' | 'created_at'>[], requester: string | null): string {
  return messages
    .filter((m) => m.body.trim())
    .slice(-60)
    .map((m) => `${m.internal ? 'Internal note' : m.from === 'requester' ? `Customer${requester ? ` (${requester})` : ''}` : `Agent${m.author_name ? ` (${m.author_name})` : ''}`}${m.created_at ? ` [${m.created_at}]` : ''}: ${m.body.trim().slice(0, 1200)}`)
    .join('\n');
}

/** The newest message a brief must have read to be current. */
export function lastMessageId(messages: readonly Pick<Message, 'id'>[]): number {
  return messages.reduce((n, m) => Math.max(n, m.id > 0 ? m.id : 0), 0);
}

const briefKey = (ticketId: number) => `ws.support.brief.${ticketId}`;

/** The brief kept on this computer for a ticket: shown at once, then brought up to date. */
export function readBrief(ticketId: number): Brief | null {
  try {
    const v = JSON.parse(localStorage.getItem(briefKey(ticketId)) ?? 'null') as Brief | null;
    return v && typeof v.summary === 'string' && Array.isArray(v.facts) ? v : null;
  } catch {
    return null;
  }
}

export function writeBrief(ticketId: number, b: Brief): void {
  try {
    localStorage.setItem(briefKey(ticketId), JSON.stringify(b));
  } catch {
    // Only a copy; it is made again.
  }
}

/* ── the client ─────────────────────────────────────────────────────────── */

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * A phone number as it is kept (the server's `TicketDetails::phone`): + and digits, a local number given the default
 * country code ("0770584763" → "+94770584763"). Null when it cannot be one.
 */
export function normalizePhone(raw: string, country = '94'): string | null {
  const s = raw.trim();
  if (!s || !/^\+?[0-9][0-9 ()./-]*$/.test(s)) return null;
  let plus = s.startsWith('+');
  let digits = s.replace(/\D+/g, '');
  if (!plus && digits.startsWith('00')) {
    digits = digits.slice(2);
    plus = true;
  }
  if (!plus) digits = country + digits.replace(/^0+/, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** A number as people read it: "+94 77 058 4763" for Sri Lanka; others in groups after the country code. */
export function formatPhone(raw: string | null | undefined): string {
  const n = raw ? normalizePhone(raw) : null;
  if (!n) return raw ?? '';
  const d = n.slice(1);
  if (d.startsWith('94') && d.length === 11) return `+94 ${d.slice(2, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return `+${d.slice(0, d.length - 9 > 0 ? d.length - 9 : 1)} ${d.slice(-9, -6)} ${d.slice(-6, -3)} ${d.slice(-3)}`.replace(/\s+/g, ' ');
}

/** What is wrong with a field's value, said under it; null when it is fine. */
export function fieldError(field: 'name' | 'email' | 'phone', value: string): string | null {
  const v = value.trim();
  if (field === 'name') return v ? null : 'Enter the client’s name';
  if (!v) return null;
  if (field === 'email') return EMAIL.test(v) && v.length <= 190 ? null : 'Enter a valid email address, like name@example.com';
  return normalizePhone(v) ? null : 'Enter a valid phone number, like +94 77 123 4567';
}

export interface Found {
  field: 'name' | 'email' | 'phone';
  value: string;
  /** As shown: the phone formatted. */
  shown: string;
}

const NAME_SAID = /\b(?:[Mm]y name is|[Tt]his is|I am|I'm|[Ii]m)\s+([A-Z][\p{L}'-]{1,30}(?:\s+[A-Z][\p{L}'-]{1,30})?)/u;

/**
 * The client's details the customer gave in the conversation (worksuite-desktop#334: "my email address is …", "call me
 * on +94770584763", "my name is …") that the client does not have yet — offered as "Found in conversation · Add".
 */
export function foundInConversation(messages: readonly Pick<Message, 'from' | 'internal' | 'body'>[], client: Pick<TicketClient, 'requester' | 'contact'> | null): Found[] {
  const have = {
    email: new Set([client?.requester.email, client?.contact?.email].filter(Boolean).map((x) => x!.toLowerCase())),
    phone: new Set([client?.requester.phone, client?.contact?.phone].map((x) => (x ? normalizePhone(x) : null)).filter(Boolean)),
    name: new Set([client?.requester.name, client?.contact?.name].filter(Boolean).map((x) => x!.toLowerCase())),
  };
  const out: Found[] = [];
  const seen = new Set<string>();
  const add = (f: Found) => {
    const k = `${f.field}:${f.value.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };
  for (const m of messages) {
    if (m.from !== 'requester' || m.internal) continue;
    for (const e of m.body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) {
      if (!have.email.has(e.toLowerCase())) add({ field: 'email', value: e.toLowerCase(), shown: e.toLowerCase() });
    }
    for (const p of m.body.match(/(?:\+|\b0)\d[\d\s-]{7,16}\d/g) ?? []) {
      // An order number is digits too: a phone starts with + or 0.
      const n = normalizePhone(p);
      if (n && !have.phone.has(n)) add({ field: 'phone', value: n, shown: formatPhone(n) });
    }
    const name = NAME_SAID.exec(m.body)?.[1];
    if (name && !have.name.has(name.toLowerCase())) add({ field: 'name', value: name, shown: name });
  }
  return out.slice(0, 6);
}
