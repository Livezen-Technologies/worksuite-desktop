import type { Block, Contact, MergeTag } from '../api';

/**
 * Merge tags (MKT-EDT-04): a closed list, written `{{tag}}` or `{{tag|fallback}}`. A tag outside the list is a
 * blocker at the pre-send check, and the required ones (company address, unsubscribe link) must be in the email.
 * Pure functions, shared by the editor, the previews and the tests.
 */

/** The list this desktop knows, used when the server does not list its own (`fetchMergeTags` answers null). */
export const MERGE_TAGS: MergeTag[] = [
  { tag: 'first_name', label: 'First name', required: false, fallback: true },
  { tag: 'last_name', label: 'Last name', required: false, fallback: false },
  { tag: 'name', label: 'Full name', required: false, fallback: false },
  { tag: 'email', label: 'Email address', required: false, fallback: false },
  { tag: 'organisation', label: 'Organisation', required: false, fallback: false },
  { tag: 'sender_name', label: 'Sender name', required: false, fallback: false },
  { tag: 'company_address', label: 'Company postal address', required: true, fallback: false },
  { tag: 'unsubscribe_url', label: 'Unsubscribe link', required: true, fallback: false },
  { tag: 'preferences_url', label: 'Preference centre link', required: false, fallback: false },
];

/** The fallback a click in the palette writes with the tag (`{{first_name|there}}`). */
export const SUGGESTED_FALLBACK: Readonly<Record<string, string>> = { first_name: 'there' };

/**
 * What previews put in place of the tags that are not about the contact. Contact tags are left out on purpose: with
 * no contact chosen, `{{first_name|there}}` reads "there", as the recipient without a first name will see it.
 */
export const TAG_SAMPLE: Readonly<Record<string, string>> = {
  company_address: '[company postal address]',
  unsubscribe_url: '[unsubscribe link]',
  preferences_url: '[preference centre link]',
};

export interface TagUse {
  tag: string;
  /** The text after `|`; null when the tag has none. */
  fallback: string | null;
}

const TAG = /\{\{([^{}]*)\}\}/g;

const own = (rec: Readonly<Record<string, string | null | undefined>>, key: string): string | null => {
  if (!Object.hasOwn(rec, key)) return null;
  const v = rec[key];
  return typeof v === 'string' ? v : null;
};

function split(body: string): TagUse {
  const bar = body.indexOf('|');
  return bar < 0 ? { tag: body.trim(), fallback: null } : { tag: body.slice(0, bar).trim(), fallback: body.slice(bar + 1).trim() };
}

/** Every tag in a text, in order: `Hi {{first_name|there}}` → `[{ tag: 'first_name', fallback: 'there' }]`. */
export function tagsIn(text: string | null | undefined): TagUse[] {
  if (!text) return [];
  return Array.from(text.matchAll(TAG), (m) => split(m[1] ?? ''));
}

/** Tags outside the closed list, each once, in the order they first appear. */
export function unknownTags(texts: Iterable<string | null | undefined>, known: ReadonlyArray<MergeTag | string>): string[] {
  const names = new Set(known.map((k) => (typeof k === 'string' ? k : k.tag)));
  const out: string[] = [];
  for (const t of texts) for (const u of tagsIn(t)) if (!names.has(u.tag) && !out.includes(u.tag)) out.push(u.tag);
  return out;
}

/** Every text of a block a tag may live in: its HTML, a button's label and link, an image's alt text and link. */
export function blockTexts(b: Block): string[] {
  switch (b.type) {
    case 'text':
    case 'footer':
      return [b.html];
    case 'columns':
      return [b.left, b.right];
    case 'button':
      return [b.label, b.url];
    case 'image':
      return [b.alt, b.link ?? '', b.src ?? ''];
    case 'divider':
      return [];
  }
}

/** The required tags (company address, unsubscribe link) that none of these blocks carries. */
export function missingRequired(blocks: readonly Block[], tags: readonly MergeTag[]): string[] {
  const used = new Set<string>();
  for (const b of blocks) for (const t of blockTexts(b)) for (const u of tagsIn(t)) used.add(u.tag);
  return tags.filter((t) => t.required && !used.has(t.tag)).map((t) => t.tag);
}

/** Fills the tags: the value when there is one, else the tag's fallback, else nothing. */
export function renderMerge(text: string, values: Readonly<Record<string, string | null | undefined>>): string {
  return text.replace(TAG, (_m, body: string) => {
    const { tag, fallback } = split(body);
    const v = own(values, tag);
    return v !== null && v.trim() !== '' ? v : (fallback ?? '');
  });
}

/** What a click in the palette inserts: `{{first_name|there}}`, `{{company_address}}`. */
export function tagText(t: Pick<MergeTag, 'tag' | 'fallback'>): string {
  const f = t.fallback ? own(SUGGESTED_FALLBACK, t.tag) : null;
  return f ? `{{${t.tag}|${f}}}` : `{{${t.tag}}}`;
}

/** The values a preview or a test send uses: a chosen contact's, over the samples. */
export function mergeValues(contact: Pick<Contact, 'first_name' | 'last_name' | 'name' | 'email' | 'organisation'> | null, extra: { sender_name?: string | null; company_address?: string | null } = {}): Record<string, string> {
  const v: Record<string, string> = { ...TAG_SAMPLE };
  if (extra.sender_name) v.sender_name = extra.sender_name;
  if (extra.company_address) v.company_address = extra.company_address;
  if (contact) {
    if (contact.first_name) v.first_name = contact.first_name;
    if (contact.last_name) v.last_name = contact.last_name;
    if (contact.name) v.name = contact.name;
    if (contact.email) v.email = contact.email;
    if (contact.organisation) v.organisation = contact.organisation;
  }
  return v;
}
