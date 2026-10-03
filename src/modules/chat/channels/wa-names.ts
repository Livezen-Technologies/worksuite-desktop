import { formatPhone, waToE164 } from '../../../core/phone';
import { contactsFor, type PhoneContact, type PhoneIndex } from '../../contacts/phones';

/**
 * Who a WhatsApp conversation, or a message in a group, is with (worksuite-desktop#176). The name, best first:
 *
 *   1. the contact in Contacts with this number — "Abdul Rahuman", "Konnect BPO" under it — and how many more share it;
 *   2. the name saved for the number on the server (the phone's own address book, from the history import);
 *   3. what they call themselves on WhatsApp, as `~Name`, "Not in contacts";
 *   4. the number as people write it, `+94 76 779 3692`.
 *
 * A group is its subject — never "Group", never its `…@g.us` id.
 *
 * The contacts kept on this computer (`usePhoneIndex`) decide when they have loaded: they are re-read the moment a
 * contact is saved, merged or deleted, so a name follows without a reload. Until then the server's answer stands.
 */
export interface WaDisplay {
  name: string;
  subtitle: string | null;
  source: 'contact' | 'saved' | 'profile' | 'number' | 'group' | 'unnamed_group';
  contact: { id: number; name: string; company: string | null; avatar?: string | null; type?: string; is_favorite?: boolean; updated_at?: string | null } | null;
  contact_count: number;
  contacts: Array<{ id: number; name: string; company: string | null }>;
  in_contacts: boolean;
  wa_profile_name: string | null;
  phone_e164: string | null;
  phone_display: string | null;
}

export interface WaNamed {
  kind?: string;
  wa_id?: string | null;
  /** The number, as an older server sends it on a list row. */
  phone?: string | null;
  subject?: string | null;
  member_count?: number | null;
  /** The server's name for it, and how it got there (absent on an older server). */
  name?: string | null;
  display?: WaDisplay | null;
  phone_e164?: string | null;
  wa_profile_name?: string | null;
  avatar_url?: string | null;
}

export interface WaWho {
  name: string;
  subtitle: string | null;
  source: WaDisplay['source'];
  group: boolean;
  contact: Pick<PhoneContact, 'id' | 'name' | 'company'> & { avatar?: string | null } | null;
  /** Every contact with this number, best first, when there is more than one. */
  candidates: Array<{ id: number; name: string; company: string | null }>;
  profileName: string | null;
  e164: string | null;
  phoneDisplay: string | null;
  /** The pictures to try, in order: the contact's, then the WhatsApp one. */
  avatars: string[];
  /** What the initials are made from: letters only, so a number never shows "+". Empty for an icon. */
  initialsOf: string;
}

const GROUP_ID = /@g\.us$/i;

function clean(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t ? t : null;
}

/** Letters to make initials of; '' when there are none (a number), for which a person icon is shown. */
export function initialsSource(name: string): string {
  const t = name.replace(/^~/, '').trim();
  return /\p{L}/u.test(t) ? t : '';
}

/** A group's name: its subject, or "Unnamed group". */
export function groupName(subject: string | null | undefined): string {
  const s = clean(subject);
  return s && !GROUP_ID.test(s) ? s : 'Unnamed group';
}

/**
 * The conversation's name and what goes under it. `index` is the contacts kept here (undefined until loaded, or for
 * somebody without Contacts); `picked` is the contact chosen when several share the number.
 */
export function whoIs(c: WaNamed, index?: PhoneIndex, picked?: number | null): WaWho {
  const server = c.display ?? null;
  if (c.kind === 'group') {
    const subject = clean(c.subject) ?? (server && server.source === 'group' ? server.name : null) ?? clean(c.name && c.name !== 'Group' ? c.name : null);
    const members = c.member_count ?? null;
    const name = groupName(subject);
    return { name, subtitle: members ? `${members} members` : null, source: name === 'Unnamed group' ? 'unnamed_group' : 'group', group: true, contact: null, candidates: [], profileName: null, e164: null, phoneDisplay: null, avatars: c.avatar_url ? [c.avatar_url] : [], initialsOf: initialsSource(name) };
  }

  const e164 = c.phone_e164 ?? server?.phone_e164 ?? waToE164(c.wa_id ?? c.phone);
  const local = index ? contactsFor(index, e164) : null;
  let list: Array<{ id: number; name: string; company: string | null; avatar?: string | null }> =
    local ?? (server?.contact ? (server.contacts.length ? server.contacts.map((x) => (x.id === server.contact!.id ? { ...x, avatar: server.contact!.avatar ?? null } : x)) : [server.contact]) : []);
  if (picked && list.some((x) => x.id === picked)) list = [list.find((x) => x.id === picked)!, ...list.filter((x) => x.id !== picked)];
  const best = list[0] ?? null;
  const profileName = clean(c.wa_profile_name) ?? clean(server?.wa_profile_name);
  const phoneDisplay = e164 ? formatPhone(e164) : null;
  const saved = server?.source === 'saved' ? clean(server.name) : null;

  let name: string;
  let subtitle: string | null;
  let source: WaDisplay['source'];
  if (best) [name, subtitle, source] = [best.name, best.company ?? null, 'contact'];
  else if (saved) [name, subtitle, source] = [saved, null, 'saved'];
  // A server from before #176 sends only its own name for the conversation.
  else if (!server && clean(c.name)) [name, subtitle, source] = [clean(c.name)!, null, 'saved'];
  else if (profileName) [name, subtitle, source] = [`~${profileName}`, 'Not in contacts', 'profile'];
  else [name, subtitle, source] = [phoneDisplay || clean(c.name) || 'Unknown number', 'Not in contacts', 'number'];

  return {
    name,
    subtitle,
    source,
    group: false,
    contact: best,
    candidates: list.length > 1 ? list.map(({ id, name: n, company }) => ({ id, name: n, company })) : [],
    profileName,
    e164,
    phoneDisplay,
    avatars: [best?.avatar, c.avatar_url].filter((u): u is string => !!u),
    initialsOf: initialsSource(name),
  };
}

/** Who said a message in a group: their contact, else what the server knew (~their name), else their number. */
export function whoSent(m: { from_wa_id?: string | null; author_name?: string | null; author_e164?: string | null }, index?: PhoneIndex): { name: string; contactId: number | null } | null {
  const e164 = m.author_e164 ?? waToE164(m.from_wa_id);
  const contact = index ? (contactsFor(index, e164)[0] ?? null) : null;
  if (contact) return { name: contact.name, contactId: contact.id };
  const known = clean(m.author_name);
  if (known) return { name: known, contactId: null };
  return e164 ? { name: formatPhone(e164), contactId: null } : null;
}

/** "Abdul Rahuman · Konnect BPO", for a tab title or a notice. */
export function fullName(w: Pick<WaWho, 'name' | 'subtitle' | 'source'>): string {
  return w.source === 'contact' && w.subtitle ? `${w.name} · ${w.subtitle}` : w.name;
}

const MEDIA_NOUNS: Record<string, string> = { Photo: 'image', Video: 'video', 'Voice message': 'mic', Document: 'file-text', Sticker: 'image', Location: 'map-pin', 'Contact card': 'contact' };

/**
 * What the list shows under a name, split so a photo reads as a picture icon and its caption rather than the word
 * "Photo": the server writes a media message as "Photo" or "Photo — caption".
 */
export function previewParts(c: { last_message: string | null; last_direction: 'in' | 'out' | null }): { icon: string | null; text: string; you: boolean } {
  const raw = (c.last_message ?? '').trim();
  const you = c.last_direction === 'out' && raw !== '';
  if (!raw) return { icon: null, text: 'No messages yet', you: false };
  const m = /^(Photo|Video|Voice message|Document|Sticker|Location|Contact card)(?: — (.+))?$/s.exec(raw);
  // A voice message reads as people say it (#155): "Voice note".
  if (m) return { icon: MEDIA_NOUNS[m[1]!] ?? null, text: m[2] ?? (m[1] === 'Voice message' ? 'Voice note' : m[1]!), you };
  return { icon: null, text: raw, you };
}

/** A mention in a group message (`@94767793692`) by the name of the contact with that number, when there is one. */
export function withMentionNames(text: string, index?: PhoneIndex): string {
  if (!index || !text.includes('@')) return text;
  return text.replace(/@(\d{8,15})\b/g, (all, digits: string) => {
    const c = contactsFor(index, `+${digits}`)[0];
    return c ? `@${c.name}` : all;
  });
}
