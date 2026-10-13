import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_SIGNIN_TTL_MS, type CloudMe, type CloudStatus, type ProvisioningStatus } from '../../../../shared/cloud';
import type { AuthStage } from '../../../../shared/types';
import { BrowserSignInFlow, sameSecret } from '../../../../electron/services/cloud/browser-signin';
import { EntitlementStore, TEST_ENTITLEMENT_KEYS, entitlementKeyring, licenceFromClaims, verifyEntitlements } from '../../../../electron/services/cloud/entitlements';
import { buildAuthorize, checkIdToken, s256 } from '../../../../electron/services/cloud/oidc';
import { ProvisioningFlow, readOnlyOf, stageFor } from '../../../../electron/services/cloud/provisioning';
import { QUOTA_HELD_POLL_MS, QUOTA_POLL_MS, QuotaWatcher } from '../../../../electron/services/cloud/quota';
import { DesktopError } from '../../../../electron/main/errors';

/**
 * WorkSuite Cloud's pieces on their own (Connection & Startup §3): the browser sign-in attempt, the entitlement JWS,
 * the quota levels and the provisioning states. The whole flow against the mock is cloud-flow.test.ts.
 */
const fixtures = join(__dirname, '../../../fixtures');
const read = (dir: string, name: string) => readFileSync(join(fixtures, dir, name), 'utf8');
const ORG = 'org_4b2e81';
const KEYS = entitlementKeyring(false);
const testKey = createPrivateKey(read('discovery', 'test-ed25519.key'));
const KID = Object.keys(TEST_ENTITLEMENT_KEYS)[0]!;

function jws(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'EdDSA', kid: KID, typ: 'JWT' }): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${sign(null, Buffer.from(`${h}.${p}`), testKey).toString('base64url')}`;
}
const claims = () => ({ ...JSON.parse(read('cloud', 'entitlements-claims.json')), iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 3600 });

afterEach(() => {
  vi.useRealTimers();
});

describe('OIDC authorize request', () => {
  const meta = { issuer: 'https://auth.worksuitecloud.com', authorization_endpoint: 'https://auth.worksuitecloud.com/authorize', token_endpoint: 'https://auth.worksuitecloud.com/token' };

  it('is PKCE S256 with a fresh 32-byte state and nonce, the idp hint and the login hint', () => {
    const a = buildAuthorize(meta, { issuer: meta.issuer, clientId: 'worksuite-desktop', redirectUri: 'worksuite://auth/oidc', purpose: 'sign-in', method: 'google', loginHint: ' hasarinda@email.example ' });
    const q = new URL(a.url).searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('worksuite-desktop');
    expect(q.get('scope')).toBe('openid profile email offline_access');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBe(s256(a.verifier));
    expect(Buffer.from(a.state, 'base64url')).toHaveLength(32);
    expect(Buffer.from(a.nonce, 'base64url')).toHaveLength(32);
    expect(q.get('state')).toBe(a.state);
    expect(q.get('nonce')).toBe(a.nonce);
    expect(q.get('idp_hint')).toBe('google');
    expect(q.get('login_hint')).toBe('hasarinda@email.example');
    expect(q.get('prompt')).toBeNull();
    // The verifier never travels.
    expect(a.url).not.toContain(a.verifier);
    const b = buildAuthorize(meta, { issuer: meta.issuer, clientId: 'worksuite-desktop', redirectUri: 'worksuite://auth/oidc', purpose: 'sign-in', method: null });
    expect(b.state).not.toBe(a.state);
  });

  it('asks OneAuth to create an account for sign-up', () => {
    const a = buildAuthorize(meta, { issuer: meta.issuer, clientId: 'worksuite-desktop', redirectUri: 'http://127.0.0.1:5000/oauth/callback', purpose: 'sign-up', method: 'email' });
    const q = new URL(a.url).searchParams;
    expect(q.get('prompt')).toBe('create');
    expect(q.get('idp_hint')).toBe('email');
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:5000/oauth/callback');
  });

  it('checks the id_token for issuer, audience, nonce and expiry', () => {
    const now = Date.now();
    const tok = (c: Record<string, unknown>) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(c)).toString('base64url')}.sig`;
    const good = { iss: meta.issuer, aud: 'worksuite-desktop', nonce: 'n1', exp: Math.floor(now / 1000) + 300, iat: Math.floor(now / 1000) };
    const expect_ = { issuer: meta.issuer, clientId: 'worksuite-desktop', nonce: 'n1' };
    expect(checkIdToken(tok(good), expect_, now).nonce).toBe('n1');
    expect(checkIdToken(tok({ ...good, aud: ['other', 'worksuite-desktop'] }), expect_, now)).toBeTruthy();
    expect(() => checkIdToken(tok({ ...good, iss: 'https://evil.example' }), expect_, now)).toThrow(/issuer/);
    expect(() => checkIdToken(tok({ ...good, aud: 'other' }), expect_, now)).toThrow(/audience/);
    expect(() => checkIdToken(tok({ ...good, nonce: 'n2' }), expect_, now)).toThrow(/nonce/);
    expect(() => checkIdToken(tok({ ...good, exp: Math.floor(now / 1000) - 600 }), expect_, now)).toThrow(/expired/);
    expect(() => checkIdToken('not.a.jwt.at.all', expect_, now)).toThrow(/unreadable/);
  });
});

describe('BrowserSignInFlow', () => {
  const setup = () => {
    let now = 1_000_000;
    const opened: string[] = [];
    const copied: string[] = [];
    const changes: Array<unknown> = [];
    const flow = new BrowserSignInFlow({ openExternal: async (u) => (opened.push(u), true), copyText: (t) => void copied.push(t), onChange: (a) => void changes.push(a), now: () => now });
    return { flow, opened, copied, changes, tick: (ms: number) => (now += ms) };
  };
  const STATE = 'S'.repeat(43);
  const start = (s: ReturnType<typeof setup>, extra: Partial<Parameters<BrowserSignInFlow['start']>[0]> = {}) =>
    s.flow.start({ accountId: 'acc_aaaaaaaaaaaaaaaaaaaa', host: 'auth.worksuitecloud.com', url: `https://auth.worksuitecloud.com/authorize?state=${STATE}`, state: STATE, purpose: 'sign-in', method: 'email', callback: 'worksuite://auth/oidc', ...extra });

  it('holds one attempt for ten minutes and opens the browser once', () => {
    const s = setup();
    const a = start(s);
    expect(a.expiresAt - a.startedAt).toBe(BROWSER_SIGNIN_TTL_MS);
    expect(s.opened).toEqual([a.url]);
    expect(s.flow.current()?.attemptId).toBe(a.attemptId);
    s.tick(BROWSER_SIGNIN_TTL_MS);
    expect(s.flow.current()).toBeNull();
    expect(s.changes.at(-1)).toBeNull();
  });

  it('a second start replaces the first; reopen opens the same URL; copy copies only the URL', async () => {
    const s = setup();
    const ended = vi.fn();
    const a = start(s, { onEnd: ended });
    const b = start(s, { state: 'T'.repeat(43), url: 'https://auth.worksuitecloud.com/authorize?x=1' });
    expect(ended).toHaveBeenCalledWith('replaced');
    expect(a.attemptId).not.toBe(b.attemptId);
    expect(await s.flow.reopen(b.attemptId)).toBe(true);
    expect(s.opened.at(-1)).toBe(b.url);
    expect(s.flow.copyLink(b.attemptId)).toEqual({ url: b.url });
    expect(s.copied).toEqual([b.url]);
    expect(() => s.flow.copyLink(a.attemptId)).toThrow(DesktopError);
  });

  it('takes only its own callback (constant-time state), once; strays are ignored', () => {
    const s = setup();
    const ended = vi.fn();
    start(s, { onEnd: ended });
    expect(s.flow.matches(`worksuite://auth/oidc?code=abc&state=${'X'.repeat(43)}`)).toBe(false);
    expect(s.flow.matches(`worksuite://auth/callback?code=abc&state=${STATE}`)).toBe(false);
    expect(s.flow.matches('not a url')).toBe(false);
    const taken = s.flow.take(`worksuite://auth/oidc?code=abc12345&state=${STATE}`);
    expect(taken?.params.get('code')).toBe('abc12345');
    expect(taken?.accountId).toBe('acc_aaaaaaaaaaaaaaaaaaaa');
    expect(s.flow.take(`worksuite://auth/oidc?code=abc12345&state=${STATE}`)).toBeNull();
    expect(ended).not.toHaveBeenCalled();
    expect(sameSecret('a', 'a')).toBe(true);
    expect(sameSecret('a', 'ab')).toBe(false);
  });

  it('cancel discards the attempt and says so', () => {
    const s = setup();
    const ended = vi.fn();
    const a = start(s, { onEnd: ended });
    s.flow.cancel('someone-else');
    expect(s.flow.current()).not.toBeNull();
    s.flow.cancel(a.attemptId);
    expect(s.flow.current()).toBeNull();
    expect(ended).toHaveBeenCalledWith('cancelled');
    expect(s.flow.matches(`worksuite://auth/oidc?code=abc&state=${STATE}`)).toBe(false);
  });
});

describe('entitlements', () => {
  it('accepts the signed fixture with the test key (unpackaged builds only)', () => {
    const v = verifyEntitlements(read('cloud', 'entitlements.jws').trim(), KEYS, ORG, Date.parse('2026-10-13T10:00:00Z'));
    expect(v.ok).toBe(true);
    if (v.ok) expect(licenceFromClaims(v.claims).locked.sort()).toEqual(['crm', 'payroll']);
    expect(entitlementKeyring(true)[KID]).toBeUndefined();
    expect(verifyEntitlements(read('cloud', 'entitlements.jws').trim(), entitlementKeyring(true), ORG).ok).toBe(false);
  });

  it('ignores a tampered document', () => {
    expect(verifyEntitlements(read('cloud', 'entitlements-tampered.jws').trim(), KEYS, ORG)).toEqual({ ok: false, reason: 'signature' });
    const [h, , s] = jws(claims()).split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims(), apps: { crm: true } })).toString('base64url')}.${s}`;
    expect(verifyEntitlements(forged, KEYS, ORG)).toEqual({ ok: false, reason: 'signature' });
  });

  it('checks alg, kid, org, exp and iat', () => {
    expect(verifyEntitlements(jws(claims(), { alg: 'HS256', kid: KID }), KEYS, ORG)).toMatchObject({ reason: 'alg' });
    expect(verifyEntitlements(jws(claims(), { alg: 'EdDSA', kid: 'unknown' }), KEYS, ORG)).toMatchObject({ reason: 'kid' });
    expect(verifyEntitlements(jws(claims()), KEYS, 'org_other')).toMatchObject({ reason: 'org' });
    expect(verifyEntitlements(jws({ ...claims(), exp: Math.floor(Date.now() / 1000) - 1 }), KEYS, ORG)).toMatchObject({ reason: 'expired' });
    expect(verifyEntitlements(jws({ ...claims(), iat: Math.floor(Date.now() / 1000) + 3600 }), KEYS, ORG)).toMatchObject({ reason: 'future' });
    expect(verifyEntitlements('a.b', KEYS, ORG)).toMatchObject({ reason: 'malformed' });
  });

  it('keeps the last valid document over a bad one, and an expired one as stale while offline', async () => {
    let now = Date.now();
    const kv = new Map<string, string>();
    let answer: () => Promise<string> = async () => jws(claims());
    const store = new EntitlementStore({ fetch: () => answer(), keys: () => KEYS, store: () => ({ get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) }), onChange: () => undefined, now: () => now });
    expect((await store.refresh(ORG)).ok).toBe(true);
    expect(kv.has(`entitlements:${ORG}`)).toBe(true);
    expect(store.licence(ORG)?.locked).toContain('crm');

    answer = async () => read('cloud', 'entitlements-tampered.jws').trim();
    expect(await store.refresh(ORG)).toMatchObject({ ok: false, reason: 'signature' });
    expect(store.licence(ORG)?.locked).toContain('crm');
    expect(store.status(ORG)).toMatchObject({ verified: true, stale: false });

    // A new run reads the stored one; Cloud away and the document run out: kept, stale.
    store.stop();
    now += 2 * 3600_000;
    answer = async () => {
      throw new DesktopError('NETWORK_UNREACHABLE', 'offline');
    };
    expect(await store.refresh(ORG)).toMatchObject({ ok: false, reason: 'offline' });
    expect(store.status(ORG)).toMatchObject({ verified: true, stale: true });
    expect(store.licence(ORG)?.locked).toContain('crm');
    store.stop();
  });
});

describe('QuotaWatcher', () => {
  const usage = (used: number, limit = 1000) => ({ used, limit, reserved: 0, categories: [], largest: [] });

  it.each([
    [0, 'ok'],
    [699, 'ok'],
    [700, 'notice'],
    [850, 'warning'],
    [950, 'critical'],
    [1000, 'full'],
    [1200, 'full'],
  ] as const)('%i of 1000 is %s', (used, level) => {
    expect(QuotaWatcher.levelOf({ used, limit: 1000 }).level).toBe(level);
  });

  it('warns once per crossing of 85 %, and polls every 10 minutes (2 while uploads wait for room)', async () => {
    vi.useFakeTimers();
    let used = 600;
    const warn = vi.fn();
    const changes: string[] = [];
    const room = vi.fn();
    const w = new QuotaWatcher({ usage: async () => usage(used), onChange: (s) => void changes.push(s.level), warn, onRoom: room });
    w.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(changes).toEqual(['ok']);
    used = 900;
    await vi.advanceTimersByTimeAsync(QUOTA_POLL_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    used = 960;
    await w.refresh();
    expect(warn).toHaveBeenCalledTimes(1);
    used = 500;
    await w.refresh();
    used = 870;
    await w.refresh();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(changes).toEqual(['ok', 'warning', 'critical', 'ok', 'warning']);

    // QUOTA_EXCEEDED: full at once, asked every 2 minutes, room said as soon as it is below full.
    room.mockClear();
    used = 1000;
    w.exceeded();
    expect(w.current()?.level).toBe('full');
    expect(w.holding()).toBe(true);
    await vi.advanceTimersByTimeAsync(QUOTA_HELD_POLL_MS);
    expect(room).not.toHaveBeenCalled();
    used = 900;
    await vi.advanceTimersByTimeAsync(QUOTA_HELD_POLL_MS);
    expect(room).toHaveBeenCalledTimes(1);
    expect(w.holding()).toBe(false);
    w.stop();
  });
});

describe('ProvisioningFlow', () => {
  const me = (state: CloudMe['account_state'], org: 'ACTIVE' | 'RESTRICTED' | 'PAST_DUE' = 'ACTIVE'): CloudMe => ({
    identity: { id: 'u1', email: 'h@e.example', name: 'H', email_verified: state !== 'EMAIL_VERIFICATION_PENDING' },
    account_state: state,
    organizations: state === 'EMAIL_VERIFICATION_PENDING' ? [] : [{ id: ORG, name: 'W', plan: 'free', state: org }],
    active_organization_id: state === 'EMAIL_VERIFICATION_PENDING' ? null : ORG,
    onboarding: { complete: state === 'ACTIVE' },
  });

  it('maps every account state to its stage, and the read-only ones', () => {
    expect(stageFor({ account_state: 'REGISTERED' })).toBe('verify-email');
    expect(stageFor({ account_state: 'PROVISIONING' })).toBe('provisioning');
    expect(stageFor({ account_state: 'PENDING_DELETION' })).toBe('ready');
    expect(readOnlyOf(me('ACTIVE'))).toBeNull();
    expect(readOnlyOf(me('ACTIVE', 'PAST_DUE'))).toBeNull();
    expect(readOnlyOf(me('SUSPENDED'))?.reason).toBe('suspended');
    expect(readOnlyOf(me('ACTIVE', 'RESTRICTED'))?.reason).toBe('restricted');
    expect(readOnlyOf(me('PENDING_DELETION'))?.reason).toBe('pending_deletion');
  });

  it('polls /me while the email waits (5 s focused, 30 s not), then provisioning from 2 s, to ACTIVE', async () => {
    vi.useFakeTimers();
    let current = me('EMAIL_VERIFICATION_PENDING');
    let prov: ProvisioningStatus = { state: 'PROVISIONING', step: 'drive', attempts: 1, retry_at: null };
    let focused = true;
    const calls = { me: 0, status: 0 };
    const stages: AuthStage[] = [];
    const statuses: CloudStatus[] = [];
    const active = vi.fn(async () => undefined);
    const flow = new ProvisioningFlow({
      me: async () => (calls.me++, current),
      status: async () => (calls.status++, prov),
      retry: async () => (prov = { state: 'PROVISIONING', step: 'drive', attempts: 2, retry_at: null }),
      onChange: (c, s) => void (stages.push(s), statuses.push(c)),
      onActive: active,
      focused: () => focused,
    });
    flow.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(stages.at(-1)).toBe('verify-email');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.me).toBe(2);
    focused = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.me).toBe(3);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls.me).toBe(3);
    current = me('PROVISIONING');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stages.at(-1)).toBe('provisioning');
    expect(calls.status).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls.status).toBe(2);

    // Failed: retry_at for the countdown, polling goes on; Retry now asks again.
    prov = { state: 'PROVISIONING_FAILED', step: 'apps', attempts: 3, retry_at: '2026-10-13T10:04:00Z' };
    await vi.advanceTimersByTimeAsync(3_000);
    expect(flow.status().provisioning?.retry_at).toBe('2026-10-13T10:04:00Z');
    expect(flow.status().accountState).toBe('PROVISIONING_FAILED');
    const n = calls.status;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.status).toBe(n + 1);
    expect((await flow.retryNow()).attempts).toBe(2);
    expect(flow.status().provisioning?.state).toBe('PROVISIONING');

    prov = { state: 'ACTIVE', step: 'done', attempts: 2, retry_at: null };
    current = me('ACTIVE');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stages.at(-1)).toBe('ready');
    expect(active).toHaveBeenCalledTimes(1);
    const after = { ...calls };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(after);
    flow.stop();
  });

  it('a suspended account is ready, read-only; Cloud away is unavailable, not a sign-out', async () => {
    vi.useFakeTimers();
    let fail = true;
    const active = vi.fn(async () => undefined);
    const flow = new ProvisioningFlow({
      me: async () => {
        if (fail) throw new DesktopError('SERVER_ERROR', 'Bad gateway', 503);
        return me('SUSPENDED');
      },
      status: async () => ({ state: 'ACTIVE', step: '', attempts: 0, retry_at: null }),
      retry: async () => ({ state: 'ACTIVE', step: '', attempts: 0, retry_at: null }),
      onChange: () => undefined,
      onActive: active,
      focused: () => true,
    });
    flow.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.status().unavailable).toBe(true);
    fail = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(flow.status()).toMatchObject({ unavailable: false, accountState: 'SUSPENDED', readOnly: { reason: 'suspended' } });
    expect(flow.stage()).toBe('ready');
    expect(active).toHaveBeenCalledTimes(1);
    flow.stop();
  });
});
