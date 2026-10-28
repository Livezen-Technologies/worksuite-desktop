import { describe, expect, it, vi } from 'vitest';
import { openFlow, resendCode, startSignUp, verifyAndSignIn } from '../../../../electron/services/cloud/in-app-signup';
import type { OidcMetadata } from '../../../../electron/services/cloud/oidc';

const meta: OidcMetadata = {
  issuer: 'https://worksuitecloud.com/oauth',
  authorization_endpoint: 'https://worksuitecloud.com/oauth/authorize',
  token_endpoint: 'https://worksuitecloud.com/oauth/token',
} as OidcMetadata;

const API = 'https://worksuitecloud.com';
const DETAILS = { firstName: 'Nimali', lastName: 'Perera', email: 'nimali@example.com', password: 'a-long-enough-password', country: 'LK', acceptTerms: true, acceptPrivacy: true } as const;

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('in-app sign-up', () => {
  it('reads the flow token out of the authorize redirect instead of opening a browser', async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      expect(url).toContain('prompt=create');
      expect(url).toContain('code_challenge_method=S256');
      return new Response(null, { status: 302, headers: { location: 'https://account.worksuitecloud.com/auth/signup/?flow=FLOW123&client=desktop' } });
    });
    const { flow, pending } = await openFlow(meta, 'worksuite-desktop', 'worksuite://auth/oidc', DETAILS.email, fetch as never);
    expect(flow).toBe('FLOW123');
    expect(pending.verifier).toBeTruthy();
    expect((fetch.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'manual' });
  });

  it('says so when the server refuses to create accounts from the app', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'worksuite://auth/oidc?error=access_denied&error_description=Creating%20an%20account%20is%20switched%20off%20for%20this%20server.' } }));
    await expect(openFlow(meta, 'worksuite-desktop', 'worksuite://auth/oidc', '', fetch as never)).rejects.toThrow(/switched off/);
  });

  it('carries the sign-up token the server hands back, in place of a cookie', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ headless: true, flow: 'FLOW123', timezone: 'UTC' });
      return reply(200, { next: 'verify', email: DETAILS.email, signupToken: 'TOKEN', expiresIn: 3600 });
    });
    const started = await startSignUp(API, 'FLOW123', { state: 's', nonce: 'n', verifier: 'v', url: 'u', redirectUri: 'r' }, { ...DETAILS }, fetch as never);
    expect(started).toMatchObject({ signupToken: 'TOKEN', email: DETAILS.email });
  });

  it('passes the server’s own field errors back', async () => {
    const fetch = vi.fn(async () => reply(422, { error: { code: 'PASSWORD_WEAK', message: 'Use a longer password.', fields: { password: 'Too short.' } } }));
    await expect(startSignUp(API, 'F', { state: 's', nonce: 'n', verifier: 'v', url: 'u', redirectUri: 'r' }, { ...DETAILS }, fetch as never)).rejects.toMatchObject({ message: 'Use a longer password.' });
  });

  it('asks for another code with the token, not a cookie', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ signupToken: 'TOKEN' });
      return reply(200, { email: DETAILS.email });
    });
    await expect(resendCode(API, { signupToken: 'TOKEN', flow: 'F', email: DETAILS.email, expiresIn: 3600, pending: { state: 's', nonce: 'n', verifier: 'v', url: 'u', redirectUri: 'r' } }, fetch as never)).resolves.toBeUndefined();
  });

  it('refuses a redirect whose state is not the one this process made', async () => {
    const fetch = vi.fn(async () => reply(200, { next: 'done', redirect: 'worksuite://auth/oidc?code=CODE&state=somebody-elses' }));
    const started = { signupToken: 'T', flow: 'F', email: DETAILS.email, expiresIn: 3600, pending: { state: 'mine', nonce: 'n', verifier: 'v', url: 'u', redirectUri: 'r' } };
    await expect(verifyAndSignIn(API, meta, 'worksuite-desktop', started, '123456', fetch as never)).rejects.toThrow(/Sign in to finish/);
  });

  it('turns a wrong code into the server’s own message', async () => {
    const fetch = vi.fn(async () => reply(400, { error: { code: 'CODE_INVALID', message: 'That code is not right. 4 tries left.' } }));
    const started = { signupToken: 'T', flow: 'F', email: DETAILS.email, expiresIn: 3600, pending: { state: 'mine', nonce: 'n', verifier: 'v', url: 'u', redirectUri: 'r' } };
    await expect(verifyAndSignIn(API, meta, 'worksuite-desktop', started, '000000', fetch as never)).rejects.toThrow(/not right/);
  });
});
