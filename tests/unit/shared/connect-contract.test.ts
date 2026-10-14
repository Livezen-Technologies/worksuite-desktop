import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accountsContract, ACCOUNT_ID } from '@shared/accounts';
import { quotaLevel } from '@shared/cloud';
import { canonicalJson } from '@shared/canonical-json';
import { CHECK_IDS, CHECK_LABELS, discoveryDocumentV1, isWorkSuiteV1, waitingSteps } from '@shared/discovery';
import { ACCOUNTS_EVENT_CHANNELS, ACCOUNTS_INVOKE_CHANNELS } from '@shared/ipc/accounts-channels';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc/channels';
import { contract } from '@shared/ipc/contract';
import { parseSetupLink, SPKI_PIN } from '@shared/trusted-config';

/**
 * Connection & Startup's shared contract (WP0): the discovery schema against the signed fixtures, setup links as
 * WorkSuite Core makes them, the quota levels, and the accounts channels wired like every other feature's.
 */
const fixtures = join(__dirname, '../../fixtures');
const read = (...p: string[]) => readFileSync(join(fixtures, ...p), 'utf8');
const key = createPrivateKey(read('discovery', 'test-ed25519.key'));
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function link(payload: Record<string, unknown>, opts: { sig?: string; d?: string } = {}): string {
  const text = canonicalJson(payload);
  const sig = opts.sig ?? sign(null, Buffer.from(text), key).toString('base64');
  return `worksuite://setup?d=${opts.d ?? b64url(text)}&s=${encodeURIComponent(sig)}`;
}
const v1 = { v: 1, server_url: 'https://worksuite.example.com', server_id: '0f6c1b2a-9d3e-5a47-8b21-5e4d3c2b1a00', name: 'Example', exp: 2_000_000_000 };
const NOW = 1_800_000_000_000;

describe('discovery document v1', () => {
  it('reads both signed fixtures, and their detached JWS verifies over the exact bytes', () => {
    const pub = createPublicKey(key);
    for (const name of ['cloud', 'enterprise']) {
      const bytes = read('discovery', `${name}.json`);
      const doc = discoveryDocumentV1.parse(JSON.parse(bytes));
      expect(isWorkSuiteV1(doc)).toBe(true);
      const [header, empty, sig] = read('discovery', `${name}.jws`).split('.');
      expect(empty).toBe('');
      expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toMatchObject({ alg: 'EdDSA' });
      expect(verify(null, Buffer.from(`${header}.${b64url(bytes)}`), pub, Buffer.from(sig!, 'base64url'))).toBe(true);
      // One byte changed: refused.
      expect(verify(null, Buffer.from(`${header}.${b64url(bytes.replace('WorkSuite', 'WorkSuitE'))}`), pub, Buffer.from(sig!, 'base64url'))).toBe(false);
    }
  });

  it('reads the document current WorkSuite Core serves (no server_version, health or browser sign-in)', () => {
    const core = {
      product: 'WorkSuite',
      schema_version: 1,
      server_id: '0f6c1b2a-9d3e-5a47-8b21-5e4d3c2b1a00',
      server_name: 'WorkSuite',
      deployment: 'ENTERPRISE',
      api_versions: ['v1'],
      base_path: '/',
      endpoints: { api: 'https://ws.example/api', auth: 'https://ws.example/api/auth', realtime: null, files: null, office: null, ai: null, policy: 'https://ws.example/desktop/v1/policies', entitlements: null },
      auth: { mode: 'legacy', signup: false, recovery_url: 'https://ws.example/forgot-password' },
      desktop: { min_version: {} },
      branding: { logo: null, accent: null },
      link_hosts: ['ws.example'],
      plans: null,
      keys: { discovery: null, policy: null },
      legacy: { desktop_api: 'desktop-v1', desktop: '/.well-known/worksuite-desktop', mobile: '/.well-known/worksuite-mobile' },
    };
    const doc = discoveryDocumentV1.parse(core);
    expect(doc.server_version ?? null).toBeNull();
    expect(doc.endpoints.health ?? null).toBeNull();
    expect(doc.auth.browser_sign_in ?? null).toBeNull();
  });

  it('keeps fields it does not know, fills the optional ones, and refuses what the app relies on', () => {
    const base = JSON.parse(read('discovery', 'enterprise.json'));
    expect(discoveryDocumentV1.parse({ ...base, future_field: 1 })).toMatchObject({ future_field: 1 });
    const minimal = discoveryDocumentV1.parse({ ...base, branding: undefined, link_hosts: undefined, keys: undefined, plans: undefined, desktop: undefined });
    expect(minimal.branding).toEqual({ logo: null, accent: null });
    expect(minimal.link_hosts).toEqual([]);
    expect(minimal.keys).toEqual({ discovery: null, policy: null });
    expect(discoveryDocumentV1.safeParse({ ...base, deployment: 'ON_PREM' }).success).toBe(false);
    expect(discoveryDocumentV1.safeParse({ ...base, server_id: 'not-a-uuid' }).success).toBe(false);
    expect(discoveryDocumentV1.safeParse({ ...base, endpoints: { auth: base.endpoints.auth } }).success).toBe(false);
    // Another product parses — the product step says NOT_WORKSUITE, not DISCOVERY_INVALID.
    const other = discoveryDocumentV1.parse({ ...base, product: 'Other' });
    expect(isWorkSuiteV1(other)).toBe(false);
    expect(isWorkSuiteV1({ ...other, product: 'WorkSuite', schema_version: 2 })).toBe(false);
    // A bad accent is dropped rather than failing the document.
    expect(discoveryDocumentV1.parse({ ...base, branding: { logo: null, accent: 'red; background:url(x)' } }).branding.accent).toBeNull();
  });

  it('lists the seven checks of screen 7, in order, all waiting at the start', () => {
    expect(CHECK_IDS).toEqual(['dns', 'tls', 'document', 'signature', 'product', 'version', 'health']);
    expect(Object.keys(CHECK_LABELS)).toHaveLength(7);
    expect(waitingSteps().every((s) => s.status === 'waiting' && s.ms === null)).toBe(true);
  });
});

describe('parseSetupLink', () => {
  it('reads a link exactly as WorkSuite Core makes it, and says what the signature covers', () => {
    const r = parseSetupLink(link(v1), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toMatchObject(v1);
    expect(r.signed).toBe(canonicalJson(v1));
    expect(verify(null, Buffer.from(r.signed), createPublicKey(key), Buffer.from(r.s, 'base64'))).toBe(true);
  });

  it('reads the committed fixtures, v1 and v2 (with the trusted configuration)', () => {
    const links = JSON.parse(read('discovery', 'setup-links.json')) as Record<string, string>;
    const a = parseSetupLink(links.v1!, NOW);
    const b = parseSetupLink(links.v2!, NOW);
    expect(a.ok && a.payload.v).toBe(1);
    expect(b.ok && b.payload.v).toBe(2);
    if (b.ok) {
      expect(b.payload.spki_pins?.every((p) => SPKI_PIN.test(p))).toBe(true);
      expect(b.payload.require_signed).toBe(true);
      expect(b.payload.allow_personal).toBe(false);
    }
    expect(parseSetupLink(links.expired!, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('says expired at the expiry, not before', () => {
    expect(parseSetupLink(link(v1), v1.exp * 1000 - 1).ok).toBe(true);
    expect(parseSetupLink(link(v1), v1.exp * 1000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('keeps a signature pasted with its pluses unencoded', () => {
    const text = canonicalJson(v1);
    const sig = sign(null, Buffer.from(text), key).toString('base64');
    const raw = `worksuite://setup?d=${b64url(text)}&s=${sig}`;
    const r = parseSetupLink(`  ${raw}\n`, NOW);
    expect(r.ok && r.s).toBe(sig);
  });

  it('refuses anything else as malformed', () => {
    const malformed = { ok: false, reason: 'malformed' };
    const good = link(v1);
    for (const bad of [
      '',
      'https://worksuite.example.com',
      good.replace('worksuite://setup', 'worksuite://auth/callback'),
      good.replace('worksuite://setup', 'other://setup'),
      good.replace(/&s=.*/, ''),
      link(v1, { sig: Buffer.alloc(32).toString('base64') }),
      link(v1, { d: '!!!' }),
      link(v1, { d: b64url('not json') }),
      link({ ...v1, server_url: 'http://worksuite.example.com' }),
      link({ ...v1, v: 3 }),
      link({ ...v1, name: '' }),
      link({ ...v1, v: 2, spki_pins: ['md5/abc'] }),
      `worksuite://setup?d=${'A'.repeat(9000)}&s=x`,
    ]) {
      expect(parseSetupLink(bad, NOW), bad.slice(0, 80)).toEqual(malformed);
    }
  });
});

describe('quotaLevel', () => {
  const GB = 1024 ** 3;
  it.each([
    [0, 'ok'],
    [0.69 * 2 * GB, 'ok'],
    [0.7 * 2 * GB, 'notice'],
    [0.849 * 2 * GB, 'notice'],
    [0.85 * 2 * GB, 'warning'],
    [0.95 * 2 * GB, 'critical'],
    [1.95 * GB, 'critical'],
    [2 * GB, 'full'],
    [3 * GB, 'full'],
  ] as const)('%d of 2 GB is %s', (used, level) => {
    expect(quotaLevel(used, 2 * GB)).toBe(level);
  });

  it('never warns without a limit', () => {
    expect(quotaLevel(5 * GB, 0)).toBe('ok');
    expect(quotaLevel(5 * GB, -1)).toBe('ok');
    expect(quotaLevel(5 * GB, Number.NaN)).toBe('ok');
    expect(quotaLevel(Number.NaN, 2 * GB)).toBe('ok');
  });
});

describe('the accounts channels', () => {
  it('are in the allow-lists, once each, and in the contract', () => {
    for (const c of ACCOUNTS_INVOKE_CHANNELS) {
      expect(INVOKE_CHANNELS.filter((x) => x === c)).toHaveLength(1);
      expect(contract[c]).toBeDefined();
    }
    for (const c of ACCOUNTS_EVENT_CHANNELS) expect(EVENT_CHANNELS.filter((x) => x === c)).toHaveLength(1);
    expect(Object.keys(accountsContract).sort()).toEqual([...ACCOUNTS_INVOKE_CHANNELS].sort());
  });

  it('validate their inputs', () => {
    const id = 'acc_0123456789abcdefghij';
    expect(ACCOUNT_ID.test(id)).toBe(true);
    const ok = (c: keyof typeof accountsContract, v: unknown) => accountsContract[c].input.safeParse(v).success;
    expect(ok('accounts:state', undefined)).toBe(true);
    expect(ok('accounts:switch', { accountId: id })).toBe(true);
    expect(ok('accounts:switch', { accountId: 'default' })).toBe(false);
    expect(ok('accounts:startupChoice', { accountId: null })).toBe(true);
    expect(ok('accounts:signOut', { accountId: id, removeCachedData: false, keepOfflineFiles: true, discardUnsynced: false })).toBe(true);
    expect(ok('accounts:signOut', { accountId: id })).toBe(false);
    expect(ok('accounts:addStart', undefined)).toBe(true);
    expect(ok('accounts:addStart', { kind: 'personal' })).toBe(true);
    expect(ok('accounts:health', {})).toBe(true);
    expect(ok('connect:start', { input: 'https://ws.example.com', target: 'enterprise' })).toBe(true);
    expect(ok('connect:start', { input: 'x'.repeat(2049), target: 'enterprise' })).toBe(false);
    expect(ok('connect:start', { input: 'a', target: 'guest' })).toBe(false);
    expect(ok('signin:start', { accountId: id, method: 'google', purpose: 'sign-up' })).toBe(true);
    expect(ok('signin:start', { accountId: id, method: 'facebook', purpose: 'sign-in' })).toBe(false);
    expect(ok('signin:start', { accountId: id, method: null, purpose: 'sign-in', loginHint: 'a@b.c', extra: 1 })).toBe(false);
    expect(ok('cloud:openWeb', { page: 'storage' })).toBe(true);
    expect(ok('cloud:openWeb', { page: 'https://evil.example' })).toBe(false);
  });

  it('carry the flags the plan gives them', () => {
    expect(accountsContract['accounts:state']).toMatchObject({ whileLocked: true });
    expect(accountsContract['accounts:switch']).toMatchObject({ sensitive: true, rate: 2 });
    expect(accountsContract['accounts:signOut']).toMatchObject({ sensitive: true, whileLocked: true });
    expect(accountsContract['connect:confirm']).toMatchObject({ sensitive: true });
    expect(accountsContract['cloud:storage']).toMatchObject({ session: true });
    expect((accountsContract['cloud:status'] as { session?: boolean }).session).toBeUndefined();
  });
});
