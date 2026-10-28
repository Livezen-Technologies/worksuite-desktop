import { DesktopError } from '../../main/errors';
import type { Tokens } from '../auth-tokens';
import { buildAuthorize, exchangeCode, type FetchLike, type OidcMetadata, type PendingAuthorize } from './oidc';

/**
 * Creating a WorkSuite Cloud account without leaving the app (ENH-AUTH-01 §4), when Desktop Management publishes
 * `signup.mode = in_app`.
 *
 * It is the hosted sign-up, driven from here instead of from a browser page:
 *
 *   1. `/oauth/authorize?prompt=create` is asked for, but not opened. Its redirect carries a `flow` token — the
 *      same one the hosted page would have been given — and the PKCE verifier stays in this process.
 *   2. `POST /api/v1/signup` with `headless: true` answers with a `signupToken`, which stands in for the browser
 *      cookie the hosted page would have kept. The code goes to the person's address as it always does.
 *   3. `POST /api/v1/signup/verify` with that token and the code finishes the account and answers with the app's
 *      own redirect URI, carrying an authorization code for the flow opened in step 1.
 *   4. That code is exchanged at the token endpoint with the verifier, exactly as a browser sign-in's would be.
 *
 * So the password is typed once, into this app, to create the account — and is never exchanged for a session
 * directly: the session still comes from an authorization code bound to a PKCE challenge this process made.
 * Rate limits, the disposable-address check, password rules and the terms and privacy versions are the server's,
 * unchanged. [ENH-AUTH-01 §4]
 */

export interface SignUpDetails {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  country: string;
  timezone?: string;
  acceptTerms: true;
  acceptPrivacy: true;
}

export interface Started {
  /** What the server calls this sign-up; held in memory, never written down. */
  signupToken: string;
  /** The OAuth flow the account will be signed in to once the address is verified. */
  pending: PendingAuthorize;
  flow: string;
  email: string;
  /** Seconds the sign-up stays open. */
  expiresIn: number;
}

interface SignupAnswer {
  next?: string;
  email?: string;
  signupToken?: string;
  expiresIn?: number;
}

interface VerifyAnswer {
  next?: string;
  redirect?: string;
}

const failed = (code: string, message: string) => new DesktopError(code as never, message);

/** The `flow` token behind `/oauth/authorize`, read from its redirect rather than opened in a browser. */
export async function openFlow(meta: OidcMetadata, clientId: string, redirectUri: string, email: string, fetch: FetchLike): Promise<{ flow: string; pending: PendingAuthorize }> {
  const pending = buildAuthorize(meta, { issuer: meta.issuer, clientId, redirectUri, purpose: 'sign-up', method: null, loginHint: email });
  const res = await fetch(pending.url, { method: 'GET', redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  if (!location) throw failed('SERVER_ERROR', 'WorkSuite Cloud did not start the sign-up. Try again.');
  let flow = '';
  try {
    flow = new URL(location, pending.url).searchParams.get('flow') ?? '';
  } catch {
    flow = '';
  }
  /* An `error` here is the server refusing sign-up altogether (Desktop Management, part 3). */
  if (!flow) {
    const error = (() => {
      try {
        return new URL(location, pending.url).searchParams.get('error_description');
      } catch {
        return null;
      }
    })();
    throw failed('SIGNUP_CLOSED', error ?? 'Accounts cannot be created from the app on this server.');
  }
  return { flow, pending };
}

/** Step 2: the account's details. The code goes to the address; nothing exists until it is verified. */
export async function startSignUp(apiOrigin: string, flow: string, pending: PendingAuthorize, details: SignUpDetails, fetch: FetchLike): Promise<Started> {
  const res = await fetch(new URL('/api/v1/signup', apiOrigin).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...details, timezone: details.timezone || 'UTC', flow, headless: true }),
  });
  const body = (await res.json().catch(() => null)) as (SignupAnswer & { error?: { code?: string; message?: string; fields?: Record<string, string> } }) | null;
  if (!res.ok || !body?.signupToken) {
    const e = body?.error;
    throw Object.assign(failed(e?.code ?? 'SERVER_ERROR', e?.message ?? 'The account could not be created. Try again.'), { fields: e?.fields ?? null });
  }
  return { signupToken: body.signupToken, pending, flow, email: body.email ?? details.email, expiresIn: body.expiresIn ?? 3600 };
}

/** Another code to the same address. The server decides how often that is allowed. */
export async function resendCode(apiOrigin: string, started: Started, fetch: FetchLike): Promise<void> {
  const res = await fetch(new URL('/api/v1/signup/resend', apiOrigin).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ flow: started.flow, signupToken: started.signupToken }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw failed(body?.error?.code ?? 'SERVER_ERROR', body?.error?.message ?? 'Another code could not be sent. Try again shortly.');
  }
}

/** Steps 3 and 4: the code finishes the account, and its authorization code becomes this app's tokens. */
export async function verifyAndSignIn(apiOrigin: string, meta: OidcMetadata, clientId: string, started: Started, code: string, fetch: FetchLike): Promise<Tokens> {
  const res = await fetch(new URL('/api/v1/signup/verify', apiOrigin).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ flow: started.flow, signupToken: started.signupToken, code: code.replace(/\s+/g, '') }),
  });
  const body = (await res.json().catch(() => null)) as (VerifyAnswer & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok) throw failed(body?.error?.code ?? 'SERVER_ERROR', body?.error?.message ?? 'That code could not be checked. Try again.');
  const redirect = body?.redirect ?? '';
  const authCode = (() => {
    try {
      const u = new URL(redirect);
      return u.searchParams.get('state') === started.pending.state ? (u.searchParams.get('code') ?? '') : '';
    } catch {
      return '';
    }
  })();
  /* The account exists either way; without a code the person signs in as usual rather than being left nowhere. */
  if (!authCode) throw failed('SIGNUP_NEEDS_SIGN_IN', 'Your account is ready. Sign in to finish setting up this computer.');
  return exchangeCode(meta, started.pending, authCode, clientId, fetch);
}
