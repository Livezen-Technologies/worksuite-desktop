import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false },
  safeStorage: {},
  protocol: {},
  session: {},
  shell: {},
  dialog: {},
  Notification: class {},
  nativeImage: {},
  powerMonitor: { isOnBatteryPower: () => false, on: () => undefined },
  systemPreferences: { canPromptTouchID: () => false },
  screen: {},
  BrowserWindow: { getAllWindows: () => [] },
}));

import type { SignInGate } from '@shared/types';
import { SessionController, type SessionHooks } from '../../../electron/main/session';
import { contentSecurityPolicy } from '../../../electron/security/hardening';
import { AuthService } from '../../../electron/services/auth';
import { BootstrapService } from '../../../electron/services/bootstrap';
import { captchaNavigationAllowed, captchaPageUrl, captchaTokenFrom } from '../../../electron/services/captcha-window';
import { Database } from '../../../electron/services/db';
import { DeviceService } from '../../../electron/services/device';
import { HttpClient, type FetchLike } from '../../../electron/services/http';
import type { SecureStore } from '../../../electron/services/secure-store';
import { challengeIsNewDevice, deviceStepFrom, gateFrom, isGateError } from '../../../electron/services/sign-in-gate';
import { Vault } from '../../../electron/services/vault';

/**
 * Sign-in protection in the desktop app (worksuite-desktop#301): the app shows every answer the server's protections
 * give — a CAPTCHA, a wait, a block, a new computer's emailed code, two-factor on a new computer — and remembers a
 * verified computer, so it is not asked again. Nothing is counted or decided here.
 */

const ORIGIN = 'https://ws.example';
const USER = { id: 7, name: 'Ann', email: 'ann@x.lk' };
const DEVICE_TOKEN = 'd'.repeat(64);
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const TOKENS = { access_token: jwt({ sub: 7, sid: 1 }), refresh_token: 'rt1', expires_in: 3600 };

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
const ok = (data: unknown, message = 'OK') => json({ status: 'success', message, data });
const fail = (status: number, message: string, errors: unknown = null, headers: Record<string, string> = {}) => json({ status: 'error', message, errors }, status, headers);

interface Req {
  path: string;
  body: Record<string, unknown>;
  headers: Headers;
}

function memoryStore(kept = new Map<string, string>()): SecureStore {
  return {
    get: (k: string) => kept.get(k) ?? null,
    set: (k: string, v: string) => void kept.set(k, v),
    delete: (k: string) => void kept.delete(k),
    deletePrefix: (p: string) => [...kept.keys()].filter((k) => k.startsWith(p)).map((k) => kept.delete(k)).length,
  } as unknown as SecureStore;
}

/** A server whose answers a test writes; everything after the sign-in (registration, bootstrap) just works. */
function setup(route: (r: Req) => Response | undefined) {
  const log: Req[] = [];
  const fetch: FetchLike = async (url, init) => {
    const r: Req = { path: new URL(url).pathname, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}, headers: new Headers(init.headers) };
    log.push(r);
    const answer = route(r);
    if (answer) return answer;
    switch (r.path) {
      case '/.well-known/worksuite-desktop':
        return new Response('', { status: 404 });
      case '/api/auth/config':
        return ok({});
      case '/api/sync/devices':
        return ok({ device: { id: 'd1' }, token: 'dt' });
      case '/api/auth/me':
        return ok({ user: USER, permissions: [], apps: ['*'] });
      case '/api/tasks/organizations':
        return ok({ organizations: [] });
      case '/api/sync/policy':
        return ok({ allow_offline: true });
      default:
        return ok({});
    }
  };
  const db = new Database(':memory:');
  const kept = new Map<string, string>();
  const secrets = memoryStore(kept);
  const auth = new AuthService(db, secrets, fetch, () => ({}));
  auth.setServer({ origin: ORIGIN, name: 'WS', api: 'core', minimumVersion: null, locked: false, passkey: null });
  return { auth, log, kept, db, secrets, fetch, sent: (path: string) => log.filter((r) => r.path === path) };
}

async function harness(route: (r: Req) => Response | undefined) {
  const s = setup(route);
  const http = new HttpClient({
    fetch: s.fetch,
    origin: () => s.auth.getServer()?.origin ?? null,
    tokens: { accessToken: () => s.auth.accessToken(), refresh: () => s.auth.refresh() },
    clientHeaders: () => ({}),
    onReachability: () => undefined,
    onAuthLost: () => undefined,
  });
  const device = new DeviceService(s.db, s.secrets, http);
  const bootstrap = new BootstrapService(s.db, () => new Vault(Vault.generateKey()), http, null);
  const hooks = {
    started: vi.fn(),
    stopped: vi.fn(),
    wiped: vi.fn(),
    syncDisabled: vi.fn(),
    changed: vi.fn(),
    bootstrapChanged: vi.fn(),
    minimumVersion: vi.fn(),
    requireUpdate: vi.fn(),
    toast: vi.fn(),
    audit: vi.fn(),
  } satisfies SessionHooks;
  const session = new SessionController(s.db, s.auth, device, bootstrap, s.fetch, { source: null }, hooks);
  session.retryDelaysMs = [0, 0];
  await session.setServer(ORIGIN);
  return { ...s, session };
}

const restricted = (retry = 900) =>
  fail(429, 'Too many attempts. Try again in 15 minutes.', { code: 'restricted', retry_after: retry, wait_total: 900, failures: 5, next_wait: 60, block_after: 10 }, { 'Retry-After': String(retry) });
const blocked = () =>
  fail(423, 'Sign-in to this account is blocked.', {
    code: 'blocked',
    reference: 'LCK-2026-0007',
    failures: 10,
    blocked_at: '2026-10-10T09:00:00+00:00',
    last_place: 'Colombo, LK',
    last_browser: 'Chrome on Windows',
    self_unblock: true,
    link_hours: 24,
  });
const captchaInfo = { provider: 'turnstile', site_key: 'k', script: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit' };
const deviceStep = (sent = true) => ok({ device_verification: true, challenge: 'device-challenge', email_hint: 'an*@x.lk', sent, ...(sent ? {} : { message: 'This server cannot send email.' }) }, 'Enter the code we emailed you');

describe('the server’s answers, read (sign-in-gate)', () => {
  it('a wait, with when it ends and what comes next', () => {
    const g = gateFrom(429, { message: 'Too many attempts. Try again in 15 minutes.', errors: { code: 'restricted', retry_after: 900, wait_total: 900, failures: 5, next_wait: 60, block_after: 10 } }, 'ann@x.lk', '900', 1_000);
    expect(g).toEqual({ kind: 'restricted', email: 'ann@x.lk', until: 901_000, total: 900, failures: 5, nextWait: 60, blockAfter: 10, message: 'Too many attempts. Try again in 15 minutes.' });
    // Retry-After alone is enough.
    expect((gateFrom(429, { errors: { code: 'restricted' } }, 'a@b', '120', 0) as Extract<SignInGate, { kind: 'restricted' }>).until).toBe(120_000);
  });

  it('a block, with its details and whether the emailed link is offered', () => {
    const g = gateFrom(423, { message: 'Blocked.', errors: { code: 'blocked', reference: 'LCK-2026-0007', failures: 10, self_unblock: false, link_hours: 24 } }, 'ann@x.lk', null);
    expect(g).toMatchObject({ kind: 'blocked', reference: 'LCK-2026-0007', failures: 10, selfUnblock: false, linkHours: 24 });
  });

  it('a CAPTCHA: after a wrong password (401) or for an attempt without one (400)', () => {
    expect(gateFrom(401, { message: 'Invalid credentials', errors: { code: 'captcha_required', captcha: captchaInfo } }, 'a@b', null)).toMatchObject({ kind: 'captcha', provider: 'turnstile', solved: false, message: expect.stringContaining('don’t match') });
    expect(gateFrom(400, { message: 'Confirm you are not a robot, then sign in again.', errors: { code: 'captcha_required', captcha: { provider: 'evil' } } }, 'a@b', null)).toMatchObject({ kind: 'captcha', provider: null, message: 'Confirm you are not a robot, then sign in again.' });
  });

  it('anything else is not a gate', () => {
    expect(gateFrom(401, { message: 'Invalid credentials', errors: null }, 'a@b', null)).toBeNull();
    expect(gateFrom(429, { message: 'Too many failed attempts. Try again later.' }, 'a@b', null)).toBeNull();
    expect(gateFrom(500, null, 'a@b', null)).toBeNull();
  });

  it('the emailed-code step, and a two-factor challenge for a new computer', () => {
    expect(deviceStepFrom({ device_verification: true, challenge: 'c', email_hint: 'an*@x.lk', sent: true }, 0)).toEqual({
      challenge: 'c',
      step: { emailHint: 'an*@x.lk', sent: true, message: null, expiresAt: 600_000, resendAt: 60_000, attemptsLeft: 5 },
    });
    expect(deviceStepFrom({ user: {} })).toBeNull();
    expect(challengeIsNewDevice(jwt({ type: 'mfa', nd: 1 }))).toBe(true);
    expect(challengeIsNewDevice(jwt({ type: 'mfa', nd: 0 }))).toBe(false);
    expect(challengeIsNewDevice('not-a-jwt')).toBe(false);
  });
});

describe('AuthService', () => {
  it('a wait or a block is a gate, not a failed password', async () => {
    let answer = restricted();
    const { auth } = setup((r) => (r.path === '/api/auth/login' ? answer : undefined));
    const e1 = await auth.signIn('ann@x.lk', 'pw').catch((e: unknown) => e);
    expect(isGateError(e1) && e1.gate.kind).toBe('restricted');
    answer = blocked();
    const e2 = await auth.signIn('ann@x.lk', 'pw').catch((e: unknown) => e);
    expect(isGateError(e2) && e2.gate).toMatchObject({ kind: 'blocked', lastPlace: 'Colombo, LK' });
  });

  it('a solved CAPTCHA goes with the next attempt only, and only for the address it was solved for', async () => {
    const { auth, sent } = setup((r) => (r.path === '/api/auth/login' ? fail(401, 'Invalid credentials', { code: 'captcha_required', captcha: captchaInfo }) : undefined));
    auth.setCaptchaToken('tok-1234567890', 'Ann@x.lk');
    expect(auth.hasCaptchaToken()).toBe(true);
    await auth.signIn('ann@x.lk', 'pw').catch(() => undefined);
    await auth.signIn('ann@x.lk', 'pw').catch(() => undefined);
    auth.setCaptchaToken('tok-other-0000', 'bob@x.lk');
    await auth.signIn('ann@x.lk', 'pw').catch(() => undefined);
    expect(sent('/api/auth/login').map((r) => r.body.captcha_token ?? null)).toEqual(['tok-1234567890', null, null]);
  });

  it('a new computer: the emailed code, a wrong one with the tries left, then remembered and sent back next time', async () => {
    let known = false;
    const { auth, sent } = setup((r) => {
      if (r.path === '/api/auth/login') return known && r.body.device_token === DEVICE_TOKEN && r.headers.get('X-Device-Token') === DEVICE_TOKEN ? ok({ user: USER, tokens: TOKENS }) : deviceStep();
      if (r.path === '/api/auth/device') return r.body.code === '123456' ? ok({ user: USER, tokens: TOKENS, device_token: DEVICE_TOKEN }) : fail(401, 'That code is not right. Check the email and try again.');
      return undefined;
    });
    const first = await auth.signIn('ann@x.lk', 'pw');
    expect(first).toMatchObject({ kind: 'device-code', step: { emailHint: 'an*@x.lk', sent: true, attemptsLeft: 5 } });

    await expect(auth.verifyDevice('000000', true)).rejects.toThrow('That code is not right. Check the email and try again. 4 tries left.');
    expect(auth.deviceStep()?.attemptsLeft).toBe(4);
    const payload = await auth.verifyDevice('123456', true);
    expect(payload.user.id).toBe(7);
    expect(sent('/api/auth/device').at(-1)?.body).toEqual({ challenge: 'device-challenge', code: '123456' });
    expect(auth.deviceHeader()).toEqual({ 'X-Device-Token': DEVICE_TOKEN });

    known = true;
    expect((await auth.signIn('ann@x.lk', 'pw')).kind).toBe('signed-in');
  });

  it('not remembering a computer keeps no token, and the next sign-in is verified again', async () => {
    const { auth, kept } = setup((r) => {
      if (r.path === '/api/auth/login') return deviceStep();
      if (r.path === '/api/auth/device') return ok({ user: USER, tokens: TOKENS, device_token: DEVICE_TOKEN });
      return undefined;
    });
    await auth.signIn('ann@x.lk', 'pw');
    await auth.verifyDevice('123456', false);
    expect([...kept.keys()].some((k) => k.startsWith('auth:device:'))).toBe(false);
    expect(auth.deviceHeader()).toEqual({});
  });

  it('an expired or spent code ends the step; another code waits a minute and gives five more tries', async () => {
    let device = fail(429, 'Too many wrong codes. Sign in again to get a new one.', { code: 'code_spent' });
    const { auth } = setup((r) => {
      if (r.path === '/api/auth/login') return deviceStep();
      if (r.path === '/api/auth/device') return device;
      if (r.path === '/api/auth/device/resend') return ok(null, 'We sent you a new code.');
      return undefined;
    });
    await auth.signIn('ann@x.lk', 'pw');
    await expect(auth.verifyDevice('111111', true)).rejects.toThrow('Too many wrong codes');
    expect(auth.hasDeviceChallenge()).toBe(false);

    await auth.signIn('ann@x.lk', 'pw');
    device = fail(401, 'That code has expired. Sign in again to get a new one.');
    await expect(auth.verifyDevice('111111', true)).rejects.toThrow('expired');
    expect(auth.hasDeviceChallenge()).toBe(false);

    await auth.signIn('ann@x.lk', 'pw');
    const before = Date.now();
    const step = await auth.resendDevice();
    expect(step).toMatchObject({ sent: true, message: 'We sent you a new code.', attemptsLeft: 5 });
    expect(step.resendAt).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('two-factor on a new computer: the code verifies it, and the computer is remembered', async () => {
    const { auth, sent } = setup((r) => {
      if (r.path === '/api/auth/login') return ok({ mfa_required: true, challenge: jwt({ sub: 7, type: 'mfa', nd: 1 }) });
      if (r.path === '/api/auth/mfa') return ok({ user: USER, tokens: TOKENS, device_token: DEVICE_TOKEN });
      return undefined;
    });
    expect(await auth.signIn('ann@x.lk', 'pw')).toEqual({ kind: 'mfa', newDevice: true });
    await auth.verifyMfa('123456', true);
    expect(sent('/api/auth/mfa')[0]?.body.code).toBe('123456');
    expect(auth.deviceHeader()).toEqual({ 'X-Device-Token': DEVICE_TOKEN });
  });

  it('a wait during two-factor ends the challenge as a gate', async () => {
    const { auth } = setup((r) => {
      if (r.path === '/api/auth/login') return ok({ mfa_required: true, challenge: jwt({ type: 'mfa' }) });
      if (r.path === '/api/auth/mfa') return restricted(60);
      return undefined;
    });
    await auth.signIn('ann@x.lk', 'pw');
    const e = await auth.verifyMfa('123456').catch((x: unknown) => x);
    expect(isGateError(e) && e.gate.kind).toBe('restricted');
    expect(auth.hasPendingChallenge()).toBe(false);
  });

  it('asks for the unblock link, and says the same whatever happened', async () => {
    const { auth, sent } = setup((r) => (r.path === '/api/auth/unblock/request' ? ok(null, 'If this account can be unblocked by email, a link is on its way.') : undefined));
    expect(await auth.requestUnblock('ann@x.lk')).toBe('If this account can be unblocked by email, a link is on its way.');
    expect(sent('/api/auth/unblock/request')[0]?.body).toEqual({ email: 'ann@x.lk' });
  });
});

describe('SessionController', () => {
  it('shows a wait as a state on the sign-in screen, instead of an error', async () => {
    const { session } = await harness((r) => (r.path === '/api/auth/login' ? restricted() : undefined));
    const state = await session.signIn('ann@x.lk', 'pw');
    expect(state.stage).toBe('signed-out');
    expect(state.gate).toMatchObject({ kind: 'restricted', email: 'ann@x.lk', failures: 5, nextWait: 60 });
    expect(session.clearGate().gate).toBeNull();
  });

  it('a CAPTCHA, solved, then the sign-in carries it', async () => {
    let n = 0;
    const { session, sent } = await harness((r) => {
      if (r.path !== '/api/auth/login') return undefined;
      n++;
      return n === 1 ? fail(401, 'Invalid credentials', { code: 'captcha_required', captcha: captchaInfo }) : ok({ user: USER, tokens: TOKENS });
    });
    const asked = await session.signIn('ann@x.lk', 'wrong');
    expect(asked.gate).toMatchObject({ kind: 'captcha', solved: false });
    expect(session.captchaSolved('tok-1234567890').gate).toMatchObject({ kind: 'captcha', solved: true });
    const done = await session.signIn('ann@x.lk', 'right');
    expect(done.stage).toBe('ready');
    expect(done.gate).toBeNull();
    expect(sent('/api/auth/login')[1]?.body.captcha_token).toBe('tok-1234567890');
  });

  it('a new computer: the code step, a wrong code (the step stays), the right one signs in', async () => {
    const { session } = await harness((r) => {
      if (r.path === '/api/auth/login') return deviceStep();
      if (r.path === '/api/auth/device') return r.body.code === '123456' ? ok({ user: USER, tokens: TOKENS, device_token: DEVICE_TOKEN }) : fail(401, 'That code is not right.');
      return undefined;
    });
    const step = await session.signIn('ann@x.lk', 'pw');
    expect(step.stage).toBe('device-code');
    expect(step.deviceCode).toMatchObject({ emailHint: 'an*@x.lk', attemptsLeft: 5 });

    await expect(session.verifyDevice('000000', true)).rejects.toThrow('4 tries left');
    expect(session.get()).toMatchObject({ stage: 'device-code', deviceCode: { attemptsLeft: 4 } });

    const done = await session.verifyDevice('123456', true);
    expect(done.stage).toBe('ready');
    expect(done.deviceCode).toBeNull();
  });

  it('a code that cannot be used any more goes back to the password, saying why', async () => {
    const { session } = await harness((r) => {
      if (r.path === '/api/auth/login') return deviceStep();
      if (r.path === '/api/auth/device') return fail(401, 'That code has expired. Sign in again to get a new one.');
      return undefined;
    });
    await session.signIn('ann@x.lk', 'pw');
    const back = await session.verifyDevice('111111', true);
    expect(back).toMatchObject({ stage: 'signed-out', deviceCode: null, message: 'That code has expired. Sign in again to get a new one.' });
  });

  it('two-factor on a new computer says so', async () => {
    const { session } = await harness((r) => (r.path === '/api/auth/login' ? ok({ mfa_required: true, challenge: jwt({ type: 'mfa', nd: 1 }) }) : undefined));
    expect(await session.signIn('ann@x.lk', 'pw')).toMatchObject({ stage: 'mfa', mfaNewDevice: true });
    expect(session.cancelMfa()).toMatchObject({ stage: 'signed-out', mfaNewDevice: false });
  });

  it('a wiped computer forgets every remembered-computer token', async () => {
    const { session, auth, kept } = await harness((r) => {
      if (r.path === '/api/auth/login') return deviceStep();
      if (r.path === '/api/auth/device') return ok({ user: USER, tokens: TOKENS, device_token: DEVICE_TOKEN });
      return undefined;
    });
    await session.signIn('ann@x.lk', 'pw');
    await session.verifyDevice('123456', true);
    expect(auth.deviceHeader()).toEqual({ 'X-Device-Token': DEVICE_TOKEN });
    await session.wipe('Removed.');
    expect([...kept.keys()].some((k) => k.startsWith('auth:device:'))).toBe(false);
    expect(auth.deviceHeader()).toEqual({});
  });
});

describe('the CAPTCHA window', () => {
  it('opens the server’s own page, and may go nowhere but there and the providers’ frames', () => {
    expect(captchaPageUrl(ORIGIN)).toBe('https://ws.example/desktop/captcha');
    expect(captchaNavigationAllowed('https://ws.example/desktop/captcha', true, ORIGIN)).toBe(true);
    expect(captchaNavigationAllowed('https://ws.example/login', true, ORIGIN)).toBe(false);
    expect(captchaNavigationAllowed('https://evil.example/desktop/captcha', true, ORIGIN)).toBe(false);
    expect(captchaNavigationAllowed('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x', true, ORIGIN)).toBe(false);
    for (const frame of ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x', 'https://newassets.hcaptcha.com/captcha/v1/x', 'https://www.google.com/recaptcha/api2/anchor', 'about:blank']) {
      expect(captchaNavigationAllowed(frame, false, ORIGIN)).toBe(true);
    }
    expect(captchaNavigationAllowed('https://evil.example/frame', false, ORIGIN)).toBe(false);
    expect(captchaNavigationAllowed('http://challenges.cloudflare.com/x', false, ORIGIN)).toBe(false);
    expect(captchaNavigationAllowed('https://user:pw@challenges.cloudflare.com/x', false, ORIGIN)).toBe(false);
  });

  it('reads the token from the page’s own fragment, and nowhere else', () => {
    expect(captchaTokenFrom('https://ws.example/desktop/captcha#captcha=0.abc_DEF-123', ORIGIN)).toBe('0.abc_DEF-123');
    expect(captchaTokenFrom('https://ws.example/desktop/captcha', ORIGIN)).toBeNull();
    expect(captchaTokenFrom('https://evil.example/desktop/captcha#captcha=0.abc_DEF-123', ORIGIN)).toBeNull();
    expect(captchaTokenFrom('https://ws.example/other#captcha=0.abc_DEF-123', ORIGIN)).toBeNull();
    expect(captchaTokenFrom('https://ws.example/desktop/captcha#captcha=%3Cscript%3E1234567', ORIGIN)).toBeNull();
  });

  it('leaves the shell’s Content-Security-Policy alone: no provider script ever runs in the app’s pages', () => {
    const csp = contentSecurityPolicy({ server: ORIGIN });
    for (const host of ['cloudflare', 'hcaptcha', 'recaptcha', 'google', 'gstatic']) expect(csp).not.toContain(host);
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  });
});
