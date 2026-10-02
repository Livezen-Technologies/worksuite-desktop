import { LOCAL_CHANNELS } from './local-workspace';
/** The public meeting contract carries no workspace records or account credentials. */
export interface GuestMeetInfo {
  uuid: string;
  origin: string;
  title: string | null;
  host_name: string | null;
  ended: boolean;
  locked: boolean;
  needs_passcode: boolean;
  guests: boolean;
  sfu_url: string;
  chat: 'everyone' | 'hosts' | 'off';
  livestream?: { active: boolean; live: boolean; count: number };
  recording?: { active: boolean; since: string | null };
  /** The Local Profile's display name, when the meeting was opened from it: suggested, still editable. */
  localName?: string;
}
export interface GuestMeetToken { url: string; token: string; identity: string; door: 'waiting_room' | 'no_host' | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function guestDestination(input: string, server: string | null): { origin: string; uuid?: string; code?: string } {
  let value = input.trim();
  let origin = server;
  if (/^https:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password || !/^\/meet\/[0-9a-f-]+\/?$/i.test(url.pathname)) throw new Error('Use a WorkSuite meeting link.');
    origin = url.origin;
    value = url.pathname.split('/')[2]!;
  } else if (/^[a-z]+:\/\//i.test(value)) throw new Error('Meeting links must use HTTPS.');
  if (!origin) throw new Error('Enter your WorkSuite server address, or paste the full meeting link.');
  const url = new URL(origin.includes('://') ? origin : `https://${origin}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Use an HTTPS WorkSuite server address.');
  if (UUID.test(value)) return { origin: url.origin, uuid: value.toLowerCase() };
  const code = value.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{9}$/.test(code)) throw new Error('Enter a valid meeting link or nine-character meeting code.');
  return { origin: url.origin, code };
}

/** A guest window has no account authority, even if a different window signs in. */
export const GUEST_CHANNELS = new Set([
  ...LOCAL_CHANNELS, 'local:open',
  'guest:open', 'guest:info', 'guest:join', 'guest:signIn',
  'media:access', 'media:privacySettings', 'media:screenSources', 'media:screenPick',
  'windows:close', 'windows:state', 'windows:minimize', 'windows:toggleMaximize', 'windows:setFullScreen', 'security:activity',
]);

export function isGuestMeetingHash(hash: string): boolean {
  const query = hash.startsWith('#/window/meet?') ? new URLSearchParams(hash.split('?').slice(1).join('?')) : null;
  return /^\/guest-meet\/[0-9a-f-]{36}(?:[?]|$)/i.test(query?.get('route') ?? '');
}
