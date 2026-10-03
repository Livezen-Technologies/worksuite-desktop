/**
 * Pictures from the web in a message (worksuite-desktop#163): whether they
 * load, whom the person trusts, and what the notice bar above the body says.
 *
 * A remote picture is how a sender learns that, when and where a message was
 * opened, so none loads until the settings or the reader say so — and then
 * only through WorkSuite's image proxy, from the local mail store when it was
 * loaded before. Never on its own in Junk, in mail that failed its
 * authentication checks, or in mail reported as phishing (which goes to Junk).
 *
 * The settings (Settings › Mail › Images & media) are the person's own on
 * every device: kept with Mail's other settings on the server.
 */
import type { MailPrefs } from './types';

export type RemoteImagesMode = 'always' | 'ask' | 'trusted' | 'never';

/** Big free mail providers: never "your organisation's domain", whoever uses them. */
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'qq.com', '163.com', 'hey.com', 'fastmail.com',
]);

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '') : '';
}

/** The person's organisation's domains: those of their own mailboxes and sign-in address, without public mail providers. */
export function ownDomains(addresses: Array<string | null | undefined>): string[] {
  return [...new Set(addresses.map((a) => emailDomain(a ?? '')).filter((d) => d && !PUBLIC_DOMAINS.has(d)))];
}

/** A domain as typed into the trusted list: "@Example.com", "example.com." → "example.com"; null when it is not one. */
export function normaliseDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}

export function normaliseEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,63}$/.test(e) ? e : null;
}

/** A sender's domain is trusted when it, or a domain it is under, is on the list (mail.example.com under example.com). */
function domainListed(domain: string, list: readonly string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export type TrustedBy = 'sender' | 'domain' | 'organisation';

export function trustedBy(email: string, prefs: Pick<MailPrefs, 'imageSenders' | 'imageDomains' | 'trustOwnDomains'>, own: readonly string[]): TrustedBy | null {
  const e = email.trim().toLowerCase();
  const d = emailDomain(e);
  if (!e) return null;
  if ((prefs.imageSenders ?? []).includes(e)) return 'sender';
  if (d && domainListed(d, prefs.imageDomains ?? [])) return 'domain';
  if (d && prefs.trustOwnDomains !== false && domainListed(d, own)) return 'organisation';
  return null;
}

export interface ImageContext {
  mode: RemoteImagesMode;
  /** Remote pictures held back in this message. */
  remote: number;
  trusted: TrustedBy | null;
  /** In Junk (or reported as phishing, which moves it there). */
  junk: boolean;
  /** SPF, DKIM or DMARC failed. */
  authFailed: boolean;
  /** The authentication result is not known yet: nothing loads on its own until it is. */
  pending: boolean;
  /** "Show images" was chosen for this message. */
  asked: boolean;
}

export interface ImageVerdict {
  /** Load the pictures now. */
  load: boolean;
  /** Why, or why not — what the notice bar says. */
  reason: 'none' | 'asked' | 'always' | 'trusted' | 'ask' | 'trusted-only' | 'never' | 'junk' | 'auth' | 'pending';
  /** The bar offers "Show images" (this message only). */
  canShow: boolean;
  /** The bar offers "Always show from…". */
  canTrust: boolean;
}

/** Whether a message's remote pictures load, and what the bar offers. */
export function imageVerdict(c: ImageContext): ImageVerdict {
  if (c.remote <= 0) return { load: false, reason: 'none', canShow: false, canTrust: false };
  if (c.asked) return { load: true, reason: 'asked', canShow: false, canTrust: false };
  if (c.mode === 'never') return { load: false, reason: 'never', canShow: false, canTrust: false };
  // Never on their own in Junk or failed-authentication mail; the reader may still ask for this one.
  if (c.junk) return { load: false, reason: 'junk', canShow: true, canTrust: false };
  if (c.authFailed) return { load: false, reason: 'auth', canShow: true, canTrust: false };
  if (c.pending && (c.mode === 'always' || c.trusted)) return { load: false, reason: 'pending', canShow: true, canTrust: false };
  if (c.mode === 'always') return { load: true, reason: 'always', canShow: false, canTrust: false };
  if (c.trusted) return { load: true, reason: 'trusted', canShow: false, canTrust: false };
  if (c.mode === 'trusted') return { load: false, reason: 'trusted-only', canShow: false, canTrust: true };
  return { load: false, reason: 'ask', canShow: true, canTrust: true };
}

export function isJunkFolder(folder: string): boolean {
  return /(^|:)(spam|junk|junk e-?mail|bulk)$/i.test(folder.trim());
}

/** "Images are hidden to protect your privacy." and its variants, before the buttons. */
export function noticeText(v: ImageVerdict, trackers: number, proxyOff: boolean): string | null {
  if (proxyOff) return 'Pictures are shown only through WorkSuite, and your organisation has turned that off.';
  switch (v.reason) {
    case 'ask':
    case 'pending':
      return 'Images are hidden to protect your privacy.';
    case 'trusted-only':
      return 'Images are hidden: they load only from senders you trust.';
    case 'never':
      return 'Images are turned off in Settings › Mail › Images & media.';
    case 'junk':
      return 'Images are hidden: this message is in Junk.';
    case 'auth':
      return 'Images are hidden: this message failed its authentication checks.';
    default:
      return trackers > 0 ? '' : null;
  }
}

export function trackerText(n: number): string {
  return n === 1 ? '1 tracker blocked' : `${n} trackers blocked`;
}

/** A free mail provider's domain (gmail.com…): never offered as "Always show from <domain>". */
export function isPublicDomain(domain: string): boolean {
  return PUBLIC_DOMAINS.has(domain.trim().toLowerCase());
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/tiff': 'tif', 'image/heic': 'heic',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/html': 'html', 'text/calendar': 'ics', 'text/csv': 'csv', 'message/rfc822': 'eml', 'application/zip': 'zip',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** Only an identifier — a UUID, a bare hash, a Content-ID — not a name anybody gave the file. */
export function isRawId(name: string): boolean {
  const base = name.trim().replace(/\.[a-z0-9]{1,5}$/i, '').toLowerCase();
  return base === '' || base === 'attachment' || /^[0-9a-f]{8}(-?[0-9a-f]{4}){3}-?[0-9a-f]{12}$/.test(base) || /^(?=[0-9a-f]*[a-f])[0-9a-f]{8,64}$/.test(base) || base.includes('@');
}

/**
 * The name an attachment is shown and saved under: its own, or — when it has
 * none, or only an identifier (an older server's answer) — "image-1.png",
 * "attachment-2.pdf", the extension from its type. The server names them so
 * too (#163); this keeps an older server's answer readable.
 */
export function readableName(name: string, mime: string, n: number): string {
  const clean = name.replace(/[\r\n\0/\\]+/g, ' ').trim();
  if (clean && !isRawId(clean)) return clean;
  const type = mime.trim().toLowerCase();
  const ext = EXT[type] ?? /\.([a-z0-9]{1,5})$/i.exec(clean)?.[1]?.toLowerCase() ?? null;
  const kind = type.startsWith('image/') ? 'image' : type.startsWith('message/') ? 'message' : 'attachment';
  return `${kind}-${Math.max(1, n)}${ext ? `.${ext}` : ''}`;
}

/** Add an address or a domain to a trusted list, once, newest last, at most 500. */
export function withTrusted(list: readonly string[] | undefined, value: string): string[] {
  return [...(list ?? []).filter((x) => x !== value), value].slice(-500);
}
