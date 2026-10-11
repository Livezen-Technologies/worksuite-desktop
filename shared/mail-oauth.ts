/**
 * Microsoft 365 (and Google) mailbox sign-in: the parts the desktop app checks and explains itself
 * (Livezen-Technologies/worksuite#154).
 *
 * THE FLOW. The WorkSuite server is the OAuth client, for the web and the desktop app alike: it builds the authorize
 * URL (PKCE S256, a one-shot state, exactly the IMAP / SMTP scopes), receives the redirect at its registered Web
 * redirect URI, redeems the code, reads the address from the token, tests IMAP before saving, updates a reconnected
 * mailbox in place and marks a refused refresh token "Sign in again". The desktop app opens the URL in the system
 * browser and watches the attempt (src/modules/mail/oauth.ts). It never holds a verifier, a code, a token or a
 * secret, so it runs no loopback listener and keeps no refresh token.
 *
 * What the app does itself, here:
 *  - checkSignInUrl(): before the browser opens, the URL the server answered is the provider's sign-in page, asks for
 *    a code with PKCE S256 and a state, carries no secret, and (Microsoft) asks for the mail scopes only;
 *  - explainProviderError(): Microsoft's AADSTS number or the OAuth `error` in words with a next step, for an older
 *    server that answers with only a code, or with the old "check the server log";
 *  - newReferenceId() and redactSecrets(): a failure the app meets itself is logged under a reference shown under
 *    Details, and nothing secret is logged.
 *
 * Pure: no Electron, no DOM, no network.
 */

/** The scopes a Microsoft 365 mailbox sign-in asks for: Exchange Online IMAP and SMTP, and OpenID. Never Graph. */
export const M365_MAIL_SCOPES = [
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
  'offline_access',
  'openid',
  'email',
  'profile',
] as const;

export const M365_MAIL_SCOPE = M365_MAIL_SCOPES.join(' ');

const OIDC = new Set(['offline_access', 'openid', 'email', 'profile']);
/** Exchange Online, by either of the names Microsoft accepts for it. */
const EXCHANGE = /^https:\/\/outlook\.office(?:365)?\.com\//i;

/** A scope that belongs to another resource than Exchange Online: Microsoft Graph, by URL or by bare name (Mail.Send). */
export function isForeignScope(scope: string): boolean {
  const s = scope.trim();
  if (!s || OIDC.has(s.toLowerCase())) return false;
  return !EXCHANGE.test(s);
}

/** The scopes of a Microsoft sign-in that are not Exchange Online's (Graph mixed into one request fails at the token). */
export function foreignScopes(scope: string): string[] {
  return scope.split(/\s+/).filter(isForeignScope);
}

/** The same scopes, in any order; Exchange Online by either of its names. */
export function sameScopes(a: string, b: string): boolean {
  const norm = (s: string) => s.split(/\s+/).filter(Boolean).map((x) => x.toLowerCase().replace('outlook.office365.com', 'outlook.office.com')).sort().join(' ');
  return norm(a) === norm(b);
}

/** The pages a sign-in may open: Microsoft's (worldwide and national clouds) and Google's. */
const SIGN_IN_HOSTS: Record<string, readonly string[]> = {
  microsoft: ['login.microsoftonline.com', 'login.microsoftonline.us', 'login.partner.microsoftonline.cn', 'login.live.com'],
  google: ['accounts.google.com'],
};

export type SignInUrlProblem = 'invalid_url' | 'not_https' | 'unknown_host' | 'not_code_flow' | 'no_state' | 'no_pkce' | 'client_secret';

export type SignInUrlWarning = 'graph_scopes_mixed' | 'unexpected_scopes';

export type SignInUrlCheck = { ok: true; warnings: SignInUrlWarning[] } | { ok: false; problem: SignInUrlProblem };

/**
 * Whether the sign-in URL the server answered is safe and right to open. A URL that fails is not opened: a page
 * that is not the provider's, a sign-in without PKCE S256 or a state, or one carrying a secret.
 */
export function checkSignInUrl(raw: string, provider: string): SignInUrlCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, problem: 'invalid_url' };
  }
  if (u.protocol !== 'https:') return { ok: false, problem: 'not_https' };
  if (!(SIGN_IN_HOSTS[provider] ?? []).includes(u.hostname.toLowerCase())) return { ok: false, problem: 'unknown_host' };
  const q = u.searchParams;
  if (q.has('client_secret') || q.has('client_assertion')) return { ok: false, problem: 'client_secret' };
  if (q.get('response_type') !== 'code') return { ok: false, problem: 'not_code_flow' };
  if (!q.get('state')) return { ok: false, problem: 'no_state' };
  if (!q.get('code_challenge') || q.get('code_challenge_method') !== 'S256') return { ok: false, problem: 'no_pkce' };
  const warnings: SignInUrlWarning[] = [];
  if (provider === 'microsoft') {
    const scope = q.get('scope') ?? '';
    if (foreignScopes(scope).length) warnings.push('graph_scopes_mixed');
    else if (!sameScopes(scope, M365_MAIL_SCOPE)) warnings.push('unexpected_scopes');
  }
  return { ok: true, warnings };
}

/** A sign-in page's URL for the log: where it goes and which parameters it has, never their values. */
export function describeSignInUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname} [${[...new Set(u.searchParams.keys())].sort().join(',')}]`;
  } catch {
    return '(not a URL)';
  }
}

/** Microsoft's AADSTS number in a code or a description ("AADSTS65001: The user or administrator…"), or null. */
export function aadstsCode(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    const m = /AADSTS(\d{5,7})\b/i.exec(t ?? '') ?? /^(\d{5,7})$/.exec((t ?? '').trim());
    if (m) return m[1]!;
  }
  return null;
}

export type ProviderErrorKind =
  | 'redirect_mismatch'
  | 'public_client'
  | 'invalid_secret'
  | 'expired_secret'
  | 'single_tenant'
  | 'consent_required'
  | 'app_not_found'
  | 'conditional_access'
  | 'personal_account'
  | 'sign_in_again'
  | 'imap_disabled'
  | 'smtp_disabled'
  | 'cancelled'
  | 'not_configured'
  | 'timeout'
  | 'no_refresh'
  | 'no_email'
  | 'unknown';

export interface ProviderExplanation {
  kind: ProviderErrorKind;
  /** "AADSTS65001", or null when Microsoft sent none. */
  code: string | null;
  title: string;
  message: string;
  next_step: string | null;
  /** For the WorkSuite / Microsoft 365 admin: what to change in the app registration. */
  for_admin: string | null;
  /** The admin can fix it by approving WorkSuite once: offer the admin consent link. */
  admin_consent: boolean;
}

const SETUP = "WorkSuite's Microsoft sign-in isn't set up correctly. Contact your WorkSuite admin and give them the details below.";

/** Exchange admin center › the mailbox › Email apps: where IMAP and Authenticated SMTP are turned on. */
export const EMAIL_APPS_SETTING = 'Exchange admin center › Mailboxes › the mailbox › Email apps › IMAP / Authenticated SMTP';

const KINDS: Record<ProviderErrorKind, Omit<ProviderExplanation, 'kind' | 'code'>> = {
  redirect_mismatch: {
    title: "WorkSuite's Microsoft sign-in isn't set up correctly (redirect address)",
    message: SETUP,
    next_step: null,
    for_admin: "The redirect URI WorkSuite sends isn't registered on the app (AADSTS50011). In Entra ID › App registrations › Authentication, add the redirect URI shown in Admin Center › Mail › Settings › Sign-in apps under the Web platform.",
    admin_consent: false,
  },
  public_client: {
    title: "WorkSuite's Microsoft sign-in isn't set up correctly (app type)",
    message: SETUP,
    next_step: null,
    for_admin: "Microsoft treats the app as a public client, so it refused the client secret (AADSTS700025). WorkSuite's server signs in as a web app: register its redirect URI under Web, not Mobile and desktop applications, and set Allow public client flows to No.",
    admin_consent: false,
  },
  invalid_secret: {
    title: "WorkSuite's Microsoft sign-in isn't set up correctly (secret)",
    message: SETUP,
    next_step: null,
    for_admin: "Microsoft rejected the client secret. Paste the secret's Value (not its Secret ID) from Entra ID › App registrations › Certificates & secrets into Admin Center › Mail › Settings › Sign-in apps.",
    admin_consent: false,
  },
  expired_secret: {
    title: "WorkSuite's Microsoft sign-in needs attention",
    message: "WorkSuite's Microsoft sign-in has stopped working because its secret expired. Contact your WorkSuite admin.",
    next_step: null,
    for_admin: 'Create a new client secret in Entra ID › App registrations › Certificates & secrets and update it in Admin Center › Mail › Settings › Sign-in apps.',
    admin_consent: false,
  },
  single_tenant: {
    title: "This account can't use WorkSuite's Microsoft sign-in",
    message: "WorkSuite's Microsoft app only accepts accounts from its own organisation.",
    next_step: 'Sign in with an account from that organisation, or ask your WorkSuite admin.',
    for_admin: 'The app registration is single-tenant but signs in through /common (AADSTS50194). Make it multi-tenant (Supported account types › Accounts in any organizational directory), or set its tenant in Admin Center › Mail › Settings › Sign-in apps.',
    admin_consent: false,
  },
  consent_required: {
    title: 'Your Microsoft admin needs to approve WorkSuite',
    message: 'Your Microsoft 365 admin needs to approve WorkSuite once before mailboxes in your organisation can be connected.',
    next_step: 'Copy the admin consent link and send it to your Microsoft 365 admin. After they approve, sign in again.',
    for_admin: null,
    admin_consent: true,
  },
  app_not_found: {
    title: "WorkSuite's Microsoft sign-in isn't set up correctly (app ID)",
    message: SETUP,
    next_step: null,
    for_admin: 'Microsoft does not recognise the Application (client) ID (AADSTS700016). Check it in Admin Center › Mail › Settings › Sign-in apps; if people from other organisations sign in, the app must be multi-tenant.',
    admin_consent: false,
  },
  conditional_access: {
    title: "Your organisation's sign-in policy blocked this",
    message: "Your organisation's Conditional Access policy blocked this sign-in, for example because of your location, device or the app.",
    next_step: 'Ask your Microsoft 365 admin to allow WorkSuite in Conditional Access, or sign in from a device your organisation manages.',
    for_admin: null,
    admin_consent: false,
  },
  personal_account: {
    title: "Personal Microsoft accounts can't be used here",
    message: "WorkSuite's Microsoft sign-in only accepts work or school accounts, not personal ones such as Outlook.com or Hotmail.",
    next_step: 'Add a personal Outlook.com mailbox with IMAP / SMTP and an app password instead, or ask your WorkSuite admin to allow personal accounts.',
    for_admin: 'To accept personal Microsoft accounts, the app registration must allow "Accounts in any organizational directory and personal Microsoft accounts".',
    admin_consent: false,
  },
  sign_in_again: {
    title: 'Sign in again',
    message: 'Your Microsoft sign-in for this mailbox has expired or was revoked, for example after a password change.',
    next_step: 'Sign in again. The mailbox keeps its settings and mail.',
    for_admin: null,
    admin_consent: false,
  },
  imap_disabled: {
    title: 'IMAP is turned off for this mailbox',
    message: 'You signed in, but IMAP is turned off for this mailbox in Microsoft 365, so WorkSuite cannot read its mail.',
    next_step: `Ask your Microsoft 365 admin to enable it: ${EMAIL_APPS_SETTING}. Then sign in again.`,
    for_admin: null,
    admin_consent: false,
  },
  smtp_disabled: {
    title: 'Authenticated SMTP is turned off for this mailbox',
    message: 'You signed in, but Authenticated SMTP is turned off for this mailbox in Microsoft 365, so WorkSuite cannot send from it.',
    next_step: `Ask your Microsoft 365 admin to enable it: ${EMAIL_APPS_SETTING}. Then sign in again.`,
    for_admin: null,
    admin_consent: false,
  },
  cancelled: {
    title: 'Sign-in was cancelled',
    message: 'Sign-in was cancelled. Try again when you are ready.',
    next_step: null,
    for_admin: null,
    admin_consent: false,
  },
  not_configured: {
    title: "This sign-in hasn't been set up",
    message: "Your WorkSuite admin hasn't set up signing in with Microsoft yet.",
    next_step: 'You can still add the account with IMAP / SMTP and an app password.',
    for_admin: null,
    admin_consent: false,
  },
  timeout: {
    title: 'The sign-in was not finished in time',
    message: 'The sign-in in your browser was not finished in time.',
    next_step: 'Start the sign-in again.',
    for_admin: null,
    admin_consent: false,
  },
  no_refresh: {
    title: 'Microsoft did not allow a lasting connection',
    message: "You signed in, but Microsoft didn't give WorkSuite permission to stay connected (offline access).",
    next_step: 'Contact your WorkSuite admin and give them the details below.',
    for_admin: 'No refresh token was returned. Add the offline_access delegated permission to the app registration.',
    admin_consent: false,
  },
  no_email: {
    title: "WorkSuite couldn't read your address",
    message: "You signed in, but WorkSuite couldn't read the mailbox address from your Microsoft account.",
    next_step: 'Contact your WorkSuite admin and give them the details below.',
    for_admin: 'The token had no address. Add the openid, email and profile delegated permissions to the app registration.',
    admin_consent: false,
  },
  unknown: {
    title: "The mailbox couldn't be connected",
    message: "Microsoft didn't accept the sign-in.",
    next_step: 'Try again. If it keeps happening, give your admin the details below.',
    for_admin: null,
    admin_consent: false,
  },
};

/** AADSTS number → kind (https://learn.microsoft.com/entra/identity-platform/reference-error-codes). */
const AADSTS: Record<string, ProviderErrorKind> = {
  '50011': 'redirect_mismatch',
  '500113': 'redirect_mismatch',
  '700025': 'public_client',
  '7000215': 'invalid_secret',
  '7000216': 'invalid_secret',
  '7000222': 'expired_secret',
  '50194': 'single_tenant',
  '65001': 'consent_required',
  '90094': 'consent_required',
  '90095': 'consent_required',
  '700016': 'app_not_found',
  '53003': 'conditional_access',
  '53000': 'conditional_access',
  '53001': 'conditional_access',
  '53002': 'conditional_access',
  '530003': 'conditional_access',
  '9002331': 'personal_account',
  '70000': 'sign_in_again',
  '50173': 'sign_in_again',
  '700082': 'sign_in_again',
  '700084': 'sign_in_again',
  '50133': 'sign_in_again',
  '65004': 'cancelled',
};

/** What a mail server says when IMAP or Authenticated SMTP is off for the mailbox, after a good token. */
const IMAP_OFF = /\bAUTHENTICATE failed\b|authenticated but not connected|IMAP (?:is )?(?:disabled|turned off)|imap_disabled/i;
const SMTP_OFF = /SmtpClientAuthentication is disabled|5\.7\.139|SMTP AUTH (?:is )?disabled|smtp_disabled/i;

/**
 * Microsoft's answer — the redirect's or the token endpoint's `error` and `error_description`, or a mail server's
 * refusal after the token worked — in words, with what to do next.
 */
export function explainProviderError(input: { code?: string | null; error?: string | null; description?: string | null }): ProviderExplanation {
  const num = aadstsCode(input.code, input.description, input.error);
  const code = num ? `AADSTS${num}` : null;
  const error = (input.error ?? '').trim().toLowerCase();
  const all = `${input.error ?? ''} ${input.description ?? ''}`;
  let kind: ProviderErrorKind = num ? (AADSTS[num] ?? 'unknown') : 'unknown';
  if (kind === 'unknown') {
    if (error === 'invalid_grant' || error === 'interaction_required' || error === 'login_required') kind = 'sign_in_again';
    else if (error === 'consent_required') kind = 'consent_required';
    else if (error === 'access_denied') kind = 'cancelled';
    else if (error === 'not_configured' || error === 'timeout' || error === 'no_email') kind = error;
    else if (error === 'no_refresh' || error === 'no_refresh_token') kind = 'no_refresh';
    else if (error === 'oauth_expired') kind = 'sign_in_again';
    else if (SMTP_OFF.test(all)) kind = 'smtp_disabled';
    else if (IMAP_OFF.test(all)) kind = 'imap_disabled';
  }
  return { kind, code, ...KINDS[kind] };
}

/** True for "check the server log" and the like: words that send the person to a log they cannot read. */
export function mentionsServerLog(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => /server(?:'s)? log|check the log/i.test(t ?? ''));
}

/** Addresses that are personal Microsoft accounts (Outlook.com, Hotmail, Live, MSN). */
export function isPersonalMicrosoftAddress(email: string | null | undefined): boolean {
  const domain = (email ?? '').trim().toLowerCase().split('@')[1] ?? '';
  return /^(?:outlook|hotmail|live|msn|passport|windowslive)\.[a-z.]{2,}$/.test(domain);
}

/** A reference for a failure the app saw by itself: 12 hex characters, as the server's request IDs are. */
export function newReferenceId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Anything that could be a credential, cut out of text that is logged or shown: a JWT (access or ID token), a Bearer
 * or XOAUTH2 value, `code=` / `client_secret=` / `refresh_token=` parameters and long base64 runs.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/\b(Bearer|XOAUTH2)\s+\S+/gi, '$1 [redacted]')
    .replace(/\b(code|client_secret|refresh_token|access_token|id_token|code_verifier|password)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9+/_-]{80,}={0,2}/g, '[redacted]');
}
