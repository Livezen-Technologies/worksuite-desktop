import type { CSSProperties } from 'react';
import type { Mailbox, MailPrefs } from './types';

/**
 * The account tag (worksuite-desktop#227): the small pill on a row of the combined list that says which account a
 * message came to. Before, it was two letters of the domain in a dark chip ("LI"), so hasarinda@ and acc@ on the
 * same domain looked the same. Now it is the account's first name — "Hasarinda", or "Acc" from acc@ — in a soft tint
 * of the account's own colour, which the person can change per account, along with where it shows.
 */

/** How the tag is drawn: the name in its pill, its colour dot alone, or nothing (Mail › Reading › Account tag). */
export type AccountTagMode = 'name' | 'dot' | 'off';

/** Where an account's tag shows: in the combined views (All Accounts, unified folders), everywhere, or nowhere. */
export type AccountTagShow = 'combined' | 'all' | 'never';

/** One account's own settings, kept with the mail settings (synced across devices). */
export interface AccountTagPref {
  label?: string;
  colour?: string;
  show?: AccountTagShow;
}

/** A tag's colours: tint and text in the light theme, text in the dark one (its tint is that at 16%). AA in both. */
export interface Palette {
  bg: string;
  fg: string;
  dark: string;
}

export const TAG_PRESETS: Array<{ id: string; label: string } & Palette> = [
  { id: 'indigo', label: 'Indigo', bg: '#EEF0FB', fg: '#2F3FB5', dark: '#AEB8FF' },
  { id: 'blue', label: 'Blue', bg: '#E7F0FD', fg: '#1A56B0', dark: '#93C0FF' },
  { id: 'teal', label: 'Teal', bg: '#E2F4F3', fg: '#0B6B63', dark: '#74D6CC' },
  { id: 'green', label: 'Green', bg: '#E5F4E9', fg: '#1B6A35', dark: '#8ED9A2' },
  { id: 'amber', label: 'Amber', bg: '#FCF0DC', fg: '#8A4B00', dark: '#F4C276' },
  { id: 'rose', label: 'Rose', bg: '#FCE8EC', fg: '#A1213F', dark: '#F7A1B5' },
  { id: 'violet', label: 'Violet', bg: '#F1EAFC', fg: '#6430B0', dark: '#CDAEFF' },
  { id: 'slate', label: 'Slate', bg: '#EDF0F3', fg: '#3F4A57', dark: '#C0C9D3' },
];

/** The server's account colours, by the preset nearest each. */
const FROM_SERVER: Record<string, string> = {
  indigo: 'indigo', navy: 'indigo', blue: 'blue', sky: 'blue', teal: 'teal', emerald: 'green', green: 'green',
  amber: 'amber', orange: 'amber', red: 'rose', rose: 'rose', violet: 'violet', purple: 'violet', slate: 'slate',
};

export const TAG_MAX = 12;

/** Display names that say what a mailbox is for rather than who it is: the address names those better. */
const ROLES = new Set([
  'accounts', 'account', 'admin', 'administrator', 'billing', 'careers', 'contact', 'customer', 'enquiries', 'enquiry', 'finance',
  'hello', 'help', 'helpdesk', 'hr', 'info', 'information', 'jobs', 'mail', 'mailer', 'marketing', 'no-reply', 'noreply', 'no',
  'office', 'orders', 'payments', 'postmaster', 'reception', 'sales', 'service', 'services', 'support', 'team', 'the', 'webmaster',
]);

/** At most twelve characters, the twelfth an ellipsis when it was longer. */
export function clip(s: string, max = TAG_MAX): string {
  const t = s.trim();
  return [...t].length > max ? `${[...t].slice(0, max - 1).join('').trimEnd()}…` : t;
}

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * The tag an account gets by itself: the first name of its display name ("Hasarinda <hasarinda@…>" → Hasarinda), or —
 * with no display name, or one naming a role ("Accounts", "Support Team") — the address before the @, capitalised
 * (acc@livezentech.com → Acc). A dotted address takes its first part (john.smith@ → John).
 */
export function defaultTagLabel(b: Pick<Mailbox, 'email' | 'display_name'>): string {
  const name = (b.display_name ?? '').trim();
  const first = name && !name.includes('@') ? (name.split(/\s+/)[0] ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') : '';
  if (first && !ROLES.has(first.toLowerCase())) return clip(capital(first));
  const local = ((b.email ?? '').split('@')[0] ?? '').split(/[._+-]/).find(Boolean) ?? b.email ?? '';
  return clip(capital(local));
}

export interface AccountTagInfo {
  label: string;
  /** What it would be by itself — for Reset to default and the settings' placeholder. */
  auto: string;
  colour: string;
  palette: Palette;
  show: AccountTagShow;
  /** "hasarinda@livezentech.com · Custom IMAP" */
  title: string;
  /** Another account shows the same label: settings suggests renaming one. */
  clash: boolean;
}

/** A colour id or a #hex as its palette: a preset's, or one made from the hex. */
export function paletteOf(colour: string): Palette {
  const preset = TAG_PRESETS.find((p) => p.id === colour);
  if (preset) return preset;
  if (/^#[0-9a-f]{6}$/i.test(colour)) {
    return { bg: `color-mix(in srgb, ${colour} 12%, white)`, fg: `color-mix(in srgb, ${colour} 72%, black)`, dark: `color-mix(in srgb, ${colour} 45%, white)` };
  }
  return TAG_PRESETS[TAG_PRESETS.length - 1]!;
}

/** What kind of account, for the tooltip. */
export function accountKind(b: Mailbox): string {
  if (b.account_type === 'local_mailbox') return 'WorkSuite Local';
  if (b.shared || b.account_type === 'shared_mailbox') return 'Shared mailbox';
  return `${b.provider_label ?? b.provider ?? 'IMAP'}${b.auth_type === 'oauth' ? ' · OAuth' : ''}`;
}

/**
 * Every account's tag, worked out together so no two share a label or (while there are colours left) a colour:
 * a label already taken gets the first letter of its domain when that tells them apart, else a number
 * ("Hasarinda", "Hasarinda 2"). The person's own label and colour win; their duplicates are only flagged.
 */
export function accountTags(boxes: Mailbox[], prefs: Pick<MailPrefs, 'accountTags'>): Map<number, AccountTagInfo> {
  const own = prefs.accountTags ?? {};
  const sorted = [...boxes].sort((a, b) => a.id - b.id);
  const out = new Map<number, AccountTagInfo>();
  const taken = new Map<string, number>();
  const colours = new Set<string>();
  // Colours chosen by hand first, so the automatic ones go round them.
  for (const b of sorted) if (own[b.id]?.colour) colours.add(own[b.id]!.colour!);

  for (const b of sorted) {
    const mine = own[b.id] ?? {};
    const auto = defaultTagLabel(b);
    let label = mine.label?.trim() ? clip(mine.label) : auto;
    if (!mine.label?.trim() && taken.has(label.toLowerCase())) {
      const first = sorted.find((x) => x.id === taken.get(label.toLowerCase()));
      const domain = ((b.email ?? '').split('@')[1] ?? '')[0]?.toUpperCase() ?? '';
      const otherDomain = ((first?.email ?? '').split('@')[1] ?? '')[0]?.toUpperCase() ?? '';
      const base = clip(auto, TAG_MAX - 3).replace(/…$/, '');
      if (domain && domain !== otherDomain && !taken.has(`${base} ${domain}`.toLowerCase())) label = `${base} ${domain}`;
      else {
        let n = 2;
        while (taken.has(`${base} ${n}`.toLowerCase())) n++;
        label = `${base} ${n}`;
      }
    }
    let colour = mine.colour ?? '';
    if (!colour) {
      const server = FROM_SERVER[(b.colour ?? '').toLowerCase()];
      colour = server && !colours.has(server) ? server : (TAG_PRESETS.find((p) => !colours.has(p.id))?.id ?? TAG_PRESETS[b.id % TAG_PRESETS.length]!.id);
      colours.add(colour);
    }
    const clash = taken.has(label.toLowerCase());
    if (clash) {
      const other = out.get(taken.get(label.toLowerCase())!);
      if (other) other.clash = true;
    } else taken.set(label.toLowerCase(), b.id);
    out.set(b.id, { label, auto, colour, palette: paletteOf(colour), show: mine.show ?? 'combined', title: `${b.email} · ${accountKind(b)}`, clash });
  }
  return out;
}

/** Whether a tag shows in this view. */
export function tagShows(t: AccountTagInfo | null | undefined, mode: AccountTagMode | undefined, combined: boolean): boolean {
  if (!t || mode === 'off' || t.show === 'never') return false;
  return combined || t.show === 'all';
}

/** The palette as the variables the tag's classes read. */
export function tagVars(p: Palette): CSSProperties {
  return { '--tag-bg': p.bg, '--tag-fg': p.fg, '--tag-dk': p.dark } as CSSProperties;
}
