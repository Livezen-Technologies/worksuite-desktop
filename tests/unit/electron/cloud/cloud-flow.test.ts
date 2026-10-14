import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AccountRecord, AccountView } from '../../../../shared/accounts';
import type { BrowserSignIn, CloudStatus } from '../../../../shared/cloud';
import type { AuthStage } from '../../../../shared/types';
import { HttpClient } from '../../../../electron/services/http';
import type { LicenceSource } from '../../../../electron/services/bootstrap';
import type { Tokens } from '../../../../electron/services/auth-tokens';
import type { IpcRouter } from '../../../../electron/ipc/router';
import { registerCloudHandlers, type CloudDeps, type CloudHandle } from '../../../../electron/services/cloud/handlers';
import { clearMetadataCache, exchangeCode, fetchMetadata, listenLoopback, OidcTokenEndpoint, buildAuthorize } from '../../../../electron/services/cloud/oidc';

/**
 * Connection & Startup §8.2 e2e #2, in-process: a Personal account added against tests/e2e/mock-cloud.mjs (plain
 * http on 127.0.0.1), signed in through OneAuth with a loopback redirect, then EMAIL_VERIFICATION_PENDING →
 * PROVISIONING_FAILED (retry_at) → ACTIVE, with the signed entitlements feeding the licence and a tampered document
 * ignored.
 */
interface Mock {
  origin: string;
  state: Record<string, unknown>;
  requests: Array<{ method: string; path: string }>;
  reset: () => void;
  close: () => Promise<void>;
}
let mock: Mock;

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(__dirname, '../../../e2e/mock-cloud.mjs')).href)) as { startMockCloud: (o: { tls: 'none' }) => Promise<Mock> };
  mock = await mod.startMockCloud({ tls: 'none' });
});
afterAll(async () => {
  await mock?.close();
});
afterEach(() => {
  mock.reset();
  clearMetadataCache();
});

const net = (url: string, init: RequestInit) => fetch(url, init);
const control = (patch: Record<string, unknown>) => fetch(`${mock.origin}/__mock/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });

/** The browser: follows OneAuth's redirect to wherever it points (the loopback listener). */
async function browse(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const back = res.headers.get('location')!;
  const page = await fetch(back);
  expect(await page.text()).toContain('You can close this tab');
  return back;
}

describe('OneAuth against the mock', () => {
  it('reads the metadata, exchanges a code through the loopback listener, refreshes and revokes', async () => {
    const meta = await fetchMetadata(`${mock.origin}/oauth`, net);
    expect(meta.token_endpoint).toBe(`${mock.origin}/oauth/token`);
    const loop = await listenLoopback(Date.now() + 60_000);
    expect(loop.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    const auth = buildAuthorize(meta, { issuer: meta.issuer, clientId: 'worksuite-desktop', redirectUri: loop.redirectUri, purpose: 'sign-up', method: 'email' });
    const back = await browse(auth.url);
    expect(await loop.result).toBe(back);
    // One-shot: the listener is closed after its one hit.
    await expect(fetch(back)).rejects.toThrow();
    const last = (await (await fetch(`${mock.origin}/__mock/last-authorize`)).json()) as Record<string, string>;
    expect(last).toMatchObject({ prompt: 'create', idp_hint: 'email', code_challenge_method: 'S256' });

    const code = new URL(back).searchParams.get('code')!;
    // A wrong nonce is refused even though the token endpoint answered.
    await expect(exchangeCode(meta, { ...auth, nonce: 'other-nonce' }, code, 'worksuite-desktop', net)).rejects.toThrow(/nonce/);
    // The code was spent by that attempt: a fresh sign-in.
    const loop2 = await listenLoopback(Date.now() + 60_000);
    const auth2 = buildAuthorize(meta, { issuer: meta.issuer, clientId: 'worksuite-desktop', redirectUri: loop2.redirectUri, purpose: 'sign-in', method: null });
    const back2 = await browse(auth2.url);
    await loop2.result;
    const tokens = await exchangeCode(meta, auth2, new URL(back2).searchParams.get('code')!, 'worksuite-desktop', net);
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.id_token).toBeTruthy();

    const endpoint = new OidcTokenEndpoint(meta, 'worksuite-desktop', net);
    const r = await endpoint.refresh(tokens.refresh_token);
    expect(r.status).toBe('ok');
    expect(await endpoint.refresh(tokens.refresh_token)).toMatchObject({ status: 'refused' });
    if (r.status === 'ok') {
      await endpoint.revoke(r.tokens.refresh_token);
      expect(await endpoint.refresh(r.tokens.refresh_token)).toMatchObject({ status: 'refused' });
    }
  });

  it('the loopback listener gives up at its deadline and answers nothing else', async () => {
    const loop = await listenLoopback(Date.now() + 50);
    const other = await fetch(loop.redirectUri.replace('/oauth/callback', '/elsewhere'));
    expect(other.status).toBe(404);
    expect(await loop.result).toBeNull();
  });

  it('refuses metadata naming another issuer', async () => {
    await expect(fetchMetadata(`${mock.origin}/other`, net)).rejects.toThrow();
    await expect(fetchMetadata('ftp://example.com', net)).rejects.toThrow(/not valid/);
  });
});

describe('a Personal account from sign-up to ACTIVE', () => {
  const ID = 'acc_personal0000000001';

  function harness() {
    const handlers = new Map<string, (input: unknown) => unknown>();
    const router = { handle: (ch: string, fn: (input: unknown) => unknown) => void handlers.set(ch, fn) } as unknown as IpcRouter;
    const invoke = async <T,>(ch: string, input?: unknown) => (await handlers.get(ch)!(input ?? null)) as T;
    let access: string | null = null;
    const rec: AccountRecord = {
      id: ID,
      kind: 'personal',
      serverOrigin: mock.origin,
      apiOrigin: mock.origin,
      serverId: null,
      serverName: 'WorkSuite Cloud',
      deployment: 'CLOUD',
      organizationId: null,
      organizationName: null,
      user: null,
      branding: { logo: null, accent: null, initials: 'WC' },
      linkHosts: [],
      profileDir: ID,
      partition: `persist:acct-${ID}`,
      managed: false,
      trust: null,
      signInState: 'signed-out',
      addedAt: new Date().toISOString(),
      lastUsedAt: null,
      discoveredAt: null,
      signed: true,
    };
    const http = new HttpClient({
      fetch: net,
      origin: () => mock.origin,
      tokens: { accessToken: () => access, refresh: async () => 'lost' },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: () => undefined,
    });
    const events: Array<[string, unknown]> = [];
    const stages: AuthStage[] = [];
    const opened: string[] = [];
    let licence: LicenceSource | null = null;
    const kv = new Map<string, string>();
    const activated = vi.fn(async () => undefined);
    const accepted: Tokens[] = [];
    const deps: CloudDeps = {
      emit: ((ch: string, p: unknown) => void events.push([ch, p])) as CloudDeps['emit'],
      account: (id) => (id === ID ? rec : null),
      activePersonal: () => rec,
      http: () => (access ? http : null),
      fetchFor: () => net,
      acceptTokens: async (_id, tokens) => {
        accepted.push(tokens);
        access = tokens.access_token;
        rec.signInState = 'signed-in';
        return { ...rec } as unknown as AccountView;
      },
      setLicenceSource: (s) => void (licence = s),
      openExternal: async (u) => (opened.push(u), true),
      copyText: () => undefined,
      isDefaultProtocolClient: () => false,
      focused: () => true,
      onStage: (_id, stage) => void stages.push(stage),
      activated,
      store: () => ({ get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) }),
      isPackaged: false,
    };
    const handle: CloudHandle = registerCloudHandlers(router, deps);
    return { invoke, handle, events, stages, opened, activated, accepted, kv, licence: () => licence, rec };
  }

  it('signs up in the browser, verifies the email, survives a failed setup and gets its signed apps', async () => {
    const h = harness();
    try {
      // Nothing yet: not signed in.
      expect(await h.invoke<CloudStatus>('cloud:status')).toMatchObject({ accountState: null });
      const attempt = await h.invoke<BrowserSignIn>('signin:start', { accountId: ID, method: 'email', purpose: 'sign-up', loginHint: 'hasarinda@email.example' });
      expect(h.stages).toContain('browser');
      expect(attempt.host).toBe(new URL(mock.origin).host);
      expect(h.opened).toEqual([attempt.url]);
      const q = new URL(attempt.url).searchParams;
      expect(q.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
      expect(q.get('prompt')).toBe('create');
      expect(q.get('login_hint')).toBe('hasarinda@email.example');

      await browse(attempt.url);
      await vi.waitFor(() => expect(h.accepted).toHaveLength(1));
      // The id_token was checked and is not handed on.
      expect(h.accepted[0]!.id_token).toBeUndefined();
      await vi.waitFor(() => expect(h.stages.at(-1)).toBe('verify-email'));
      expect(h.events.some(([ch, p]) => ch === 'signin:changed' && p === null)).toBe(true);

      // Verified; workspace setup failed once, Cloud will try again later.
      await control({ account_state: 'PROVISIONING_FAILED', provisioning: 'PROVISIONING_FAILED' });
      let s = await h.invoke<CloudStatus>('cloud:refresh');
      await vi.waitFor(async () => {
        s = await h.invoke<CloudStatus>('cloud:status');
        expect(s.provisioning?.state).toBe('PROVISIONING_FAILED');
      });
      expect(h.stages.at(-1)).toBe('provisioning');
      expect(Date.parse(s.provisioning!.retry_at!)).toBeGreaterThan(Date.now());
      expect(s.accountState).toBe('PROVISIONING_FAILED');

      // Retry now.
      const retried = await h.invoke<{ state: string }>('cloud:retryProvisioning');
      expect(retried.state).toBe('PROVISIONING');

      // Active: the bootstrap goes ahead with the signed entitlements as the licence.
      await control({ account_state: 'ACTIVE', provisioning: 'ACTIVE' });
      await h.invoke('cloud:refresh');
      await vi.waitFor(() => expect(h.activated).toHaveBeenCalledTimes(1));
      expect(h.stages.at(-1)).toBe('ready');
      expect(h.handle.organizationId()).toBe('org_4b2e81');
      const lic = await h.licence()!();
      expect(lic?.locked.sort()).toEqual(['crm', 'payroll']);
      expect(h.kv.has('entitlements:org_4b2e81')).toBe(true);
      s = await h.invoke<CloudStatus>('cloud:status');
      expect(s.entitlements).toMatchObject({ verified: true, stale: false });
      expect(s.storage?.level).toBe('ok');

      // A tampered entitlement document is ignored: CRM stays locked.
      await control({ tamperEntitlements: true });
      await h.invoke('cloud:refresh');
      expect((await h.licence()!())?.locked).toContain('crm');

      // Storage: the account's usage, and full at 100 %.
      await control({ used: 2 * 1024 * 1024 * 1024 });
      const usage = await h.invoke<{ used: number; categories: unknown[] }>('cloud:storage');
      expect(usage.categories.length).toBeGreaterThan(0);
      expect((await h.invoke<CloudStatus>('cloud:status')).storage?.level).toBe('full');
      expect((await h.invoke<Array<{ id: string }>>('cloud:plans')).map((p) => p.id)).toContain('professional-plus');

      // A suspended organization: ready, read-only.
      await control({ account_state: 'SUSPENDED' });
      h.handle.refetchMe();
      await vi.waitFor(async () => expect((await h.invoke<CloudStatus>('cloud:status')).readOnly?.reason).toBe('suspended'));

      expect(await h.invoke('cloud:openWeb', { page: 'storage' })).toBe(true);
      expect(h.opened.at(-1)).toBe(`${mock.origin}/account/storage`);
      const resend = await h.invoke<{ nextAt: number }>('cloud:resendVerification');
      expect(resend.nextAt).toBeGreaterThan(Date.now());
      expect(h.opened.at(-1)).toBe(`${mock.origin}/oauth/verify-email`);
      expect((await h.invoke<{ nextAt: number }>('cloud:resendVerification')).nextAt).toBe(resend.nextAt);

      const endpoint = await h.handle.tokenEndpoint(ID);
      expect(endpoint?.kind).toBe('oidc');
    } finally {
      h.handle.dispose();
    }
  });

  it('cancel ends the attempt and closes the loopback listener; a stray callback is not taken', async () => {
    const h = harness();
    try {
      const attempt = await h.invoke<BrowserSignIn>('signin:start', { accountId: ID, method: 'google', purpose: 'sign-in' });
      const redirect = new URL(attempt.url).searchParams.get('redirect_uri')!;
      expect(h.handle.handleCallback(`worksuite://auth/oidc?code=abcdefgh&state=${'x'.repeat(43)}`)).toBe(false);
      expect(await h.invoke<{ url: string }>('signin:copyLink', { attemptId: attempt.attemptId })).toEqual({ url: attempt.url });
      await h.invoke('signin:cancel', { attemptId: attempt.attemptId });
      expect(h.stages.at(-1)).toBe('signed-out');
      await expect(fetch(redirect)).rejects.toThrow();
      expect(h.accepted).toHaveLength(0);
    } finally {
      h.handle.dispose();
    }
  });
});
