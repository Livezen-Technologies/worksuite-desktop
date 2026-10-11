import { describe, expect, it } from 'vitest';
import {
  checkSignInUrl,
  describeSignInUrl,
  explainProviderError,
  foreignScopes,
  isPersonalMicrosoftAddress,
  M365_MAIL_SCOPE,
  mentionsServerLog,
  newReferenceId,
  redactSecrets,
  sameScopes,
} from '../../../shared/mail-oauth';

/**
 * Adding a Microsoft 365 mailbox (Livezen-Technologies/worksuite#154), what the desktop checks itself. The server is
 * the OAuth client; before the app hands its sign-in URL to the browser, the URL must ask for a code with PKCE S256
 * and a state, carry no secret, and ask for the mail scopes only. Microsoft's codes read as words with a next step,
 * and nothing says "check the server log". No real credentials: every value here is made up.
 */

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const url = (over: Record<string, string | null> = {}) => {
  const q = new URLSearchParams();
  const base: Record<string, string | null> = { client_id: 'test-client-id', response_type: 'code', redirect_uri: 'https://ws.example.test/oauth/microsoft/callback', scope: M365_MAIL_SCOPE, state: 'st4te', code_challenge: 'ch4llenge', code_challenge_method: 'S256', ...over };
  for (const [k, v] of Object.entries(base)) if (v !== null) q.set(k, v);
  return `${AUTH}?${q.toString()}`;
};

describe('the sign-in URL, before the browser opens it', () => {
  it('accepts the provider’s page with PKCE S256, a state and the mail scopes', () => {
    expect(checkSignInUrl(url(), 'microsoft')).toEqual({ ok: true, warnings: [] });
    expect(checkSignInUrl(url({ scope: 'https://mail.google.com/ openid email' }).replace(AUTH, 'https://accounts.google.com/o/oauth2/v2/auth'), 'google')).toEqual({ ok: true, warnings: [] });
  });

  it('refuses one without PKCE S256 or without a state', () => {
    expect(checkSignInUrl(url({ code_challenge: null }), 'microsoft')).toEqual({ ok: false, problem: 'no_pkce' });
    expect(checkSignInUrl(url({ code_challenge_method: 'plain' }), 'microsoft')).toEqual({ ok: false, problem: 'no_pkce' });
    expect(checkSignInUrl(url({ state: null }), 'microsoft')).toEqual({ ok: false, problem: 'no_state' });
    expect(checkSignInUrl(url({ response_type: 'token' }), 'microsoft')).toEqual({ ok: false, problem: 'not_code_flow' });
  });

  it('refuses one that carries a client secret', () => {
    expect(checkSignInUrl(url({ client_secret: 'not-a-real-secret' }), 'microsoft')).toEqual({ ok: false, problem: 'client_secret' });
    expect(checkSignInUrl(url({ client_assertion: 'x' }), 'microsoft')).toEqual({ ok: false, problem: 'client_secret' });
  });

  it('refuses a page that is not the provider’s', () => {
    expect(checkSignInUrl(url().replace('login.microsoftonline.com', 'login.example.test'), 'microsoft')).toEqual({ ok: false, problem: 'unknown_host' });
    expect(checkSignInUrl(url().replace('https:', 'http:'), 'microsoft')).toEqual({ ok: false, problem: 'not_https' });
    expect(checkSignInUrl('not a url', 'microsoft')).toEqual({ ok: false, problem: 'invalid_url' });
    expect(checkSignInUrl(url(), 'google')).toEqual({ ok: false, problem: 'unknown_host' });
  });

  it('asks for exactly the IMAP and SMTP scopes, never Graph', () => {
    expect(M365_MAIL_SCOPE).toBe('https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access openid email profile');
    expect(foreignScopes(M365_MAIL_SCOPE)).toEqual([]);
    expect(foreignScopes(`${M365_MAIL_SCOPE} https://graph.microsoft.com/Mail.Send Contacts.Read`)).toEqual(['https://graph.microsoft.com/Mail.Send', 'Contacts.Read']);
    expect(checkSignInUrl(url({ scope: `${M365_MAIL_SCOPE} https://graph.microsoft.com/Mail.Send` }), 'microsoft')).toEqual({ ok: true, warnings: ['graph_scopes_mixed'] });
    expect(checkSignInUrl(url({ scope: 'openid email' }), 'microsoft')).toEqual({ ok: true, warnings: ['unexpected_scopes'] });
    // Exchange Online by its other name, in another order, is the same request.
    expect(sameScopes('profile email openid offline_access https://outlook.office365.com/SMTP.Send https://outlook.office365.com/IMAP.AccessAsUser.All', M365_MAIL_SCOPE)).toBe(true);
  });

  it('describes a URL for the log without its values', () => {
    const d = describeSignInUrl(url());
    expect(d).toBe(`${AUTH} [client_id,code_challenge,code_challenge_method,redirect_uri,response_type,scope,state]`);
    expect(d).not.toContain('st4te');
    expect(d).not.toContain('ch4llenge');
  });
});

describe('AADSTS codes, in words', () => {
  const kind = (code: string) => explainProviderError({ description: `AADSTS${code}: something went wrong` }).kind;

  it('maps each code in the issue', () => {
    expect(kind('50011')).toBe('redirect_mismatch');
    expect(kind('700025')).toBe('public_client');
    expect(kind('7000215')).toBe('invalid_secret');
    expect(kind('7000222')).toBe('expired_secret');
    expect(kind('50194')).toBe('single_tenant');
    expect(kind('65001')).toBe('consent_required');
    expect(kind('90094')).toBe('consent_required');
    expect(kind('700016')).toBe('app_not_found');
    expect(kind('53003')).toBe('conditional_access');
    expect(kind('9002331')).toBe('personal_account');
    expect(explainProviderError({ code: 'AADSTS65001' }).code).toBe('AADSTS65001');
    expect(explainProviderError({ code: '700016' }).kind).toBe('app_not_found');
  });

  it('asks for the admin’s approval when consent is needed', () => {
    expect(explainProviderError({ error: 'consent_required', description: 'AADSTS65001: not consented' })).toMatchObject({ code: 'AADSTS65001', admin_consent: true, title: 'Your Microsoft admin needs to approve WorkSuite' });
    expect(explainProviderError({ error: 'consent_required' }).kind).toBe('consent_required');
  });

  it('names the exact Exchange setting when IMAP or SMTP AUTH is off after a good token', () => {
    const imap = explainProviderError({ description: 'A1 NO AUTHENTICATE failed.' });
    expect(imap.kind).toBe('imap_disabled');
    expect(imap.next_step).toContain('Exchange admin center › Mailboxes › the mailbox › Email apps › IMAP / Authenticated SMTP');
    const smtp = explainProviderError({ description: '535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Mailbox.' });
    expect(smtp.kind).toBe('smtp_disabled');
    expect(smtp.next_step).toContain('Email apps › IMAP / Authenticated SMTP');
  });

  it('says sign in again on invalid_grant and an expired sign-in', () => {
    expect(explainProviderError({ error: 'invalid_grant', description: 'AADSTS700082: The refresh token has expired due to inactivity.' }).kind).toBe('sign_in_again');
    expect(explainProviderError({ error: 'invalid_grant' }).kind).toBe('sign_in_again');
    expect(explainProviderError({ error: 'oauth_expired' }).kind).toBe('sign_in_again');
  });

  it('treats a declined sign-in as cancelled', () => {
    expect(explainProviderError({ error: 'access_denied' }).kind).toBe('cancelled');
  });

  it('never points at the server log', () => {
    for (const code of ['50011', '700025', '7000215', '7000222', '50194', '65001', '90094', '700016', '53003', '9002331', '1234567']) {
      const e = explainProviderError({ description: `AADSTS${code}` });
      expect(mentionsServerLog(e.title, e.message, e.next_step, e.for_admin)).toBe(false);
    }
    expect(mentionsServerLog('OAuth sign-in failed — check the server log')).toBe(true);
  });
});

describe('the rest', () => {
  it('knows a personal Microsoft address', () => {
    expect(isPersonalMicrosoftAddress('kasun@outlook.com')).toBe(true);
    expect(isPersonalMicrosoftAddress('kasun@hotmail.co.uk')).toBe(true);
    expect(isPersonalMicrosoftAddress('kasun@live.com')).toBe(true);
    expect(isPersonalMicrosoftAddress('amal@contoso.com')).toBe(false);
    expect(isPersonalMicrosoftAddress('')).toBe(false);
  });

  it('makes a 12-character reference', () => {
    expect(newReferenceId()).toMatch(/^[0-9A-F]{12}$/);
    expect(newReferenceId()).not.toBe(newReferenceId());
  });

  it('cuts tokens, codes and secrets out of what is logged or shown', () => {
    const jwt = 'eyJhbGciOiJub25lIn0.eyJ1cG4iOiJ4QHkueiJ9.sig';
    expect(redactSecrets(`Bearer ${jwt} code=abc&state=1 client_secret=xyz`)).toBe('Bearer [redacted] code=[redacted]&state=1 client_secret=[redacted]');
    expect(redactSecrets(`id ${jwt}`)).toBe('id [redacted]');
    expect(redactSecrets(`XOAUTH2 ${'A'.repeat(20)}`)).toBe('XOAUTH2 [redacted]');
  });
});
