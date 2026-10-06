/**
 * WorkSuite Office asking to use this app's sign-in (worksuite-office#6):
 *
 *   worksuite://office/signin?client=worksuite-office&server=<origin>&uid=<user id>&challenge=<S256>&state=<…>
 *
 * WorkSuite Office opens it when somebody chooses "Continue as <name>" there, having read who this app is
 * signed in as from desktop-accounts.json (electron/services/office-signin.ts). This app asks the person,
 * gets a one-time code for WorkSuite Office with its own session (POST /api/auth/apps/handoff, bound to the
 * PKCE challenge) and hands it back through worksuiteoffice://auth/callback, a fixed address. The verifier
 * never leaves WorkSuite Office, so a code that reaches anybody else exchanges for nothing.
 *
 * Not a page link: it is matched before the link grammar, where `office/:id` would take it for a document,
 * and never logged with its query.
 */

export const OFFICE_CLIENT = 'worksuite-office';
export const OFFICE_CALLBACK = 'worksuiteoffice://auth/callback';

const MAX_LENGTH = 2048;
const KEYS = new Set(['client', 'server', 'uid', 'challenge', 'state']);

export interface OfficeSignInRequest {
  /** The WorkSuite server's origin WorkSuite Office expects this app to be signed in to. */
  server: string;
  /** The user WorkSuite Office expects. */
  uid: string;
  /** PKCE S256 challenge: base64url of 32 bytes. */
  challenge: string;
  /** WorkSuite Office's own value, returned with the code. */
  state: string;
}

export type OfficeSignInParse = { ok: true; request: OfficeSignInRequest } | { ok: false; reason: string };

export function isOfficeSignInLink(url: string): boolean {
  return /^worksuite:\/{2,3}office\/signin\/?(?:[?#]|$)/i.test(url);
}

export function parseOfficeSignIn(url: string): OfficeSignInParse {
  if (url.length > MAX_LENGTH) return { ok: false, reason: 'too-long' };
  if (!isOfficeSignInLink(url)) return { ok: false, reason: 'not-office-signin' };

  const at = url.indexOf('?');
  if (at < 0) return { ok: false, reason: 'no-query' };
  const params = new URLSearchParams(url.slice(at + 1).split('#')[0]);

  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!KEYS.has(key)) return { ok: false, reason: 'unknown-param' };
    if (seen.has(key)) return { ok: false, reason: 'duplicate-param' };
    seen.add(key);
  }

  if (params.get('client') !== OFFICE_CLIENT) return { ok: false, reason: 'client' };

  const challenge = params.get('challenge') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return { ok: false, reason: 'challenge' };

  const state = params.get('state') ?? '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return { ok: false, reason: 'state' };

  const uid = params.get('uid') ?? '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) return { ok: false, reason: 'uid' };

  let server: string;
  try {
    const parsed = new URL(params.get('server') ?? '');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return { ok: false, reason: 'server' };
    }
    server = parsed.origin;
  } catch {
    return { ok: false, reason: 'server' };
  }

  return { ok: true, request: { server, uid, challenge, state } };
}

/** Where the code goes: WorkSuite Office's fixed address, never one the link named. */
export function officeCallback(code: string, state: string): string {
  return `${OFFICE_CALLBACK}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
}
