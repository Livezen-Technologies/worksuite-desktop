/**
 * Focused Inbox (ENH-MAIL-03 WF-DO01, DMO-INB-01): Focused or Other for one
 * message, worked out on this computer from what WorkSuite keeps for the
 * person (overrides, VIPs, people they know, how they moved mail before).
 * Shared by the Mail screen and the main process's new-mail alerts
 * (DMO-NTF-02), so both sort a message the same way.
 */

export interface FocusContext {
  overrides: Array<{ sender: string; target: 'focused' | 'other' }>;
  vips: string[];
  known: string[];
  moves: Record<string, { focused: number; other: number }>;
}

/*
 * Bulk senders (worksuite-desktop#208). `info@` and `hello@` are where most small businesses write from —
 * a registrar's account notice, a supplier's quote — so they are not bulk on their own. A sending
 * subdomain (`@mail.shop.com`, `@em.brand.com`) is; a mail provider's own domain (`@mail.com`,
 * `@mail.ru`, `@email.com`) is people, and is not.
 */
const BULK = /^(no-?reply|do-?not-?reply|newsletters?|news|notifications?|notify|alerts?|mailer(-daemon)?|marketing|promo(tions)?|offers|deals|updates|digest|bounce)[@+._-]/i;
const BULK_DOMAIN = /@(e|em|email|mail|mailer|news|newsletter|marketing|info)\.[^.@\s]+\.[^@\s]+$|@.*(mailchimp|sendgrid|mailgun|amazonses|sparkpost|hubspot|substack|mcsv)\./i;

const lowered = new WeakMap<FocusContext['moves'], Map<string, { focused: number; other: number }>>();
/** Moves by sender, compared without case (the server kept the address as it came), worked out once per context. */
const NO_MOVES: FocusContext['moves'] = {};
function movesOf(ctx: FocusContext): Map<string, { focused: number; other: number }> {
  const src = ctx.moves ?? NO_MOVES;
  let m = lowered.get(src);
  if (!m) {
    m = new Map();
    for (const [k, v] of Object.entries(src)) {
      const key = k.toLowerCase();
      const had = m.get(key);
      m.set(key, had ? { focused: had.focused + v.focused, other: had.other + v.other } : { focused: v.focused, other: v.other });
    }
    lowered.set(src, m);
  }
  return m;
}

/**
 * Focused or Other for one message. In order: the message was moved by hand;
 * an override for the sender, then for their @domain; VIP; somebody the
 * person knows; how the person moved this sender's mail before; a bulk or
 * no-reply sender. Anything else is Focused — if in doubt, show it (WF-DO01
 * "fail open").
 */
export function classifyFocus(m: { from_email?: string | null; focus?: 'focused' | 'other' | null }, ctx: FocusContext | null | undefined): { focus: 'focused' | 'other'; why: string } {
  if (m.focus) return { focus: m.focus, why: 'moved' };
  const from = (m.from_email ?? '').toLowerCase();
  const domain = from.includes('@') ? `@${from.split('@')[1]}` : '';
  const over = ctx?.overrides.find((o) => o.sender === from) ?? (domain ? ctx?.overrides.find((o) => o.sender === domain) : undefined);
  if (over) return { focus: over.target, why: 'override' };
  if (ctx?.vips.includes(from)) return { focus: 'focused', why: 'vip' };
  if (ctx?.known.includes(from)) return { focus: 'focused', why: 'known' };
  const moves = ctx ? movesOf(ctx).get(from) : undefined;
  if (moves && moves.other !== moves.focused) return { focus: moves.other > moves.focused ? 'other' : 'focused', why: 'moves' };
  if (BULK.test(from) || BULK_DOMAIN.test(from)) return { focus: 'other', why: 'bulk' };
  return { focus: 'focused', why: 'default' };
}

/** Which new mail may raise a banner on this computer (DMO-NTF-02). */
export type MailAlerts = 'all' | 'focused' | 'vip' | 'none';

export function mailAlertFor(m: { from_email?: string | null; focus?: 'focused' | 'other' | null }, mode: MailAlerts, ctx: FocusContext | null | undefined): boolean {
  if (mode === 'none') return false;
  if (mode === 'vip') return !!ctx?.vips.includes((m.from_email ?? '').toLowerCase());
  if (mode === 'focused') return classifyFocus(m, ctx).focus === 'focused';
  return true;
}
