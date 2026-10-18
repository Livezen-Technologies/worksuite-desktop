/**
 * Personal sign-in against a real WorkSuite Cloud account service (worksuite-cloud `api/`, part 8), run on this
 * computer. Opt-in: it needs the API running locally with its migrations on a local database, self sign-up on, and
 * MAIL_WORKER=0 so the sign-up code stays in the outbox, e.g.
 *
 *   PORT=8797 DB_NAME=wscloud_e2e SESSION_SECRET=… PORTAL_ORIGIN=http://127.0.0.1:8797 SITE_URL=http://127.0.0.1:8797 \
 *     MAIL_WORKER=0 npx tsx src/server.ts
 *   WS_ONEAUTH_LIVE_ORIGIN=http://127.0.0.1:8797 WS_ONEAUTH_LIVE_MYSQL='mysql -h127.0.0.1 -P8889 -uroot -proot wscloud_e2e' \
 *     npx vitest run tests/unit/electron/cloud/oneauth-live.test.ts
 *
 * Never point it at production: it creates an account (an example.com address).
 *
 * It drives the app's own code — the discovery pipeline with target 'personal', `fetchMetadata`, `buildAuthorize`,
 * the real loopback listener, `exchangeCode` (id_token iss / aud / nonce checks), `OidcTokenEndpoint` refresh and
 * revoke — and plays the browser itself: it follows /oauth/authorize to the hosted pages' flow and posts the steps
 * those pages post (the person's password is only ever sent there, never to the app).
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { EMPTY_TRUSTED_CONFIG } from '@shared/trusted-config';
import { runDiscovery } from '../../../../electron/services/discovery/pipeline';
import { buildAuthorize, exchangeCode, fetchMetadata, listenLoopback, OidcTokenEndpoint } from '../../../../electron/services/cloud/oidc';

const ORIGIN = process.env.WS_ONEAUTH_LIVE_ORIGIN ?? '';
/** The local database's command-line client, to read the sign-up code from the outbox ("mysql -h… -P… -u… -p… db"). */
const DB = process.env.WS_ONEAUTH_LIVE_MYSQL ?? '';
const fetchImpl = (url: string, init: RequestInit) => globalThis.fetch(url, init);

describe.skipIf(!ORIGIN || !DB)('Personal sign-in against a local WorkSuite Cloud', () => {
  const email = `desktop-${Date.now()}@example.com`;
  const password = 'example password 2026';

  /** The hosted pages in the system browser: their cookies, their Origin. */
  function browser() {
    const jar = new Map<string, string>();
    return async (method: string, url: string, body?: unknown) => {
      const res = await fetch(url, {
        method,
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const sc of res.headers.getSetCookie()) {
        const [kv] = sc.split(';');
        const i = kv!.indexOf('=');
        jar.set(kv!.slice(0, i), kv!.slice(i + 1));
      }
      return { status: res.status, location: res.headers.get('location'), json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    };
  }

  function codeFromOutbox(to: string): string {
    if (!/^[a-z0-9.@-]+$/.test(to)) throw new Error('unexpected address');
    const [bin, ...args] = DB.split(/\s+/);
    const out = execFileSync(bin!, [...args, '-N', '-e', `SELECT body_text FROM wscloud_mail_outbox WHERE to_email = '${to}' AND template = 'signup_code' ORDER BY id DESC LIMIT 1`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /Your code: (\d{6})/.exec(out);
    if (!m) throw new Error('no sign-up code in the local outbox');
    return m[1]!;
  }

  async function personal(purpose: 'sign-up' | 'sign-in') {
    // 1. Discovery, as the Personal option runs it.
    const run = await runDiscovery(
      { runId: 'live', input: ORIGIN, target: 'personal' },
      { fetch: fetchImpl, trusted: () => EMPTY_TRUSTED_CONFIG, rotatedKeys: () => ({}), existingAccount: () => null, appVersion: '0.3.0', platform: 'macos', isPackaged: false, cloudOrigin: ORIGIN, lookup: async () => ({ address: '127.0.0.1' }) },
      () => undefined,
      AbortSignal.timeout(30_000),
    );
    expect(run.failure).toBeNull();
    expect(run.state).toBe('ok');
    const server = run.server!;
    expect(server.deployment).toBe('CLOUD');
    expect(server.oidc).toMatchObject({ clientId: 'worksuite-desktop' });

    // 2. The authorize URL and the loopback listener (not the default protocol client in a test).
    const meta = await fetchMetadata(server.oidc!.issuer, fetchImpl);
    const loop = await listenLoopback(Date.now() + 60_000);
    const pending = buildAuthorize(meta, { issuer: meta.issuer, clientId: 'worksuite-desktop', redirectUri: loop.redirectUri, purpose, method: null, loginHint: email });

    // 3. The system browser: authorize → hosted page with a flow → the steps → the app's redirect.
    const b = browser();
    const a = await b('GET', pending.url);
    expect(a.status).toBe(302);
    const page = new URL(a.location!);
    expect(page.pathname).toBe(purpose === 'sign-up' ? '/auth/signup/' : '/auth/signin/');
    const flow = page.searchParams.get('flow')!;
    let done: Record<string, unknown> | null;
    if (purpose === 'sign-up') {
      const s = await b('POST', `${ORIGIN}/api/v1/signup`, { flow, firstName: 'Example', lastName: 'Person', email, password, country: 'LK', timezone: 'Asia/Colombo', acceptTerms: true, acceptPrivacy: true });
      expect(s.json).toEqual({ next: 'verify', email });
      done = (await b('POST', `${ORIGIN}/api/v1/signup/verify`, { flow, code: codeFromOutbox(email) })).json;
    } else {
      done = (await b('POST', `${ORIGIN}/api/v1/signin/password`, { flow, email, password })).json;
    }
    expect(done?.next).toBe('done');
    const redirect = String(done?.redirect);
    expect(redirect.startsWith(loop.redirectUri)).toBe(true);
    // The done page sends the browser there; the listener answers its "you can close this tab" page.
    const hit = await fetch(redirect);
    expect(await hit.text()).toMatch(/close this tab/);
    const back = new URL((await loop.result)!);
    expect(back.searchParams.get('state')).toBe(pending.state);

    // 4. Code + verifier for tokens; the id_token is checked by the app's own rules.
    const tokens = await exchangeCode(meta, pending, back.searchParams.get('code')!, 'worksuite-desktop', fetchImpl);
    return { meta, tokens, server };
  }

  const me = (token: string) => fetch(`${ORIGIN}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } });

  it('creates a free account through the browser flow, then signs in again, refreshes, and signs out', async () => {
    const up = await personal('sign-up');
    const r = await me(up.tokens.access_token);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { identity: { email: string }; organizations: unknown[]; account_state: string };
    expect(body.identity.email).toBe(email);
    expect(body.organizations).toHaveLength(1);
    expect(['PROVISIONING', 'ACTIVE']).toContain(body.account_state);

    const inAgain = await personal('sign-in');
    const endpoint = new OidcTokenEndpoint(inAgain.meta, 'worksuite-desktop', fetchImpl);
    const refreshed = await endpoint.refresh(inAgain.tokens.refresh_token);
    expect(refreshed.status).toBe('ok');
    const t2 = (refreshed as { tokens: { access_token: string; refresh_token: string } }).tokens;
    expect((await me(t2.access_token)).status).toBe(200);
    // The old refresh token was rotated out: using it again ends the sign-in, which the app reads as revoked.
    expect((await endpoint.refresh(inAgain.tokens.refresh_token)).status).toBe('revoked');
    expect((await me(t2.access_token)).status).toBe(401);

    // Sign out on the first sign-in: revoke, then nothing works with it.
    await new OidcTokenEndpoint(up.meta, 'worksuite-desktop', fetchImpl).revoke(up.tokens.refresh_token, up.tokens.access_token);
    expect((await me(up.tokens.access_token)).status).toBe(401);
  });

  it('a cancelled browser sign-in leaves nothing: the listener times out, and a forged callback is not a code', async () => {
    const loop = await listenLoopback(Date.now() + 200);
    expect(await loop.result).toBeNull();
    const meta = await fetchMetadata(`${ORIGIN}/oauth`, fetchImpl);
    const pending = buildAuthorize(meta, { issuer: meta.issuer, clientId: 'worksuite-desktop', redirectUri: 'http://127.0.0.1:9/oauth/callback', purpose: 'sign-in', method: null });
    await expect(exchangeCode(meta, pending, 'forged-code-value-0000', 'worksuite-desktop', fetchImpl)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
});
