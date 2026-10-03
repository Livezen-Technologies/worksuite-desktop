import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Phone numbers in the one form every module compares (worksuite-desktop#176): E.164, `+94767793692`.
 *
 * WhatsApp writes `94767793692@s.whatsapp.net`, a contact was typed as `0767 793 692`, `+94 76 779 3692` or
 * `076-7793692` — all the same number, and only equal once each is read the same way. A number with no country code
 * is read in the default region (Sri Lanka, as the server does). Reused by WhatsApp now and by Calls and SMS later.
 */
export const DEFAULT_REGION: CountryCode = 'LK';

/** A group, a broadcast list or an opaque linked-device id is not somebody's number. */
const NOT_A_PHONE = /@(g\.us|broadcast|lid)$/i;

/** The number in E.164, or null when it cannot be read as one. */
export function toE164(raw: string | null | undefined, region: CountryCode = DEFAULT_REGION): string | null {
  let s = (raw ?? '').trim();
  if (!s || NOT_A_PHONE.test(s)) return null;
  // A WhatsApp id carries its country code and no plus: everything before the @ (and any device suffix).
  if (s.includes('@')) {
    const digits = s.split('@')[0]!.split(':')[0]!.replace(/\D+/g, '');
    return digits ? fromParsed(`+${digits}`) : null;
  }
  s = s.replace(/\s*(?:ext\.?|x|#)\s*\d+\s*$/i, '');
  if (/^\s*00/.test(s)) s = `+${s.replace(/^\s*00/, '')}`;
  if (s.startsWith('+')) return fromParsed(s);
  const national = fromParsed(s, region);
  if (national) return national;
  // Digits long enough to already carry a country code, as WhatsApp sends them.
  const digits = s.replace(/\D+/g, '');
  return digits.length >= 11 && !digits.startsWith('0') ? fromParsed(`+${digits}`) : null;
}

function fromParsed(s: string, region?: CountryCode): string | null {
  const n = parsePhoneNumberFromString(s, region);
  return n && n.isPossible() ? n.number : null;
}

/** A WhatsApp `wa_id` (digits with the country code, or a full id) as E.164; null for a group. */
export function waToE164(waId: string | null | undefined): string | null {
  const s = (waId ?? '').trim();
  if (!s || NOT_A_PHONE.test(s)) return null;
  const digits = s.split('@')[0]!.split(':')[0]!.replace(/\D+/g, '');
  return digits ? fromParsed(`+${digits}`) : null;
}

/** How a number is shown when there is no name for it: `+94 76 779 3692`. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const n = parsePhoneNumberFromString(e164);
  return n ? n.formatInternational() : e164;
}

/** The digits WhatsApp and `wa.me` use for a number. */
export function waDigits(e164: string): string {
  return e164.replace(/\D+/g, '');
}
