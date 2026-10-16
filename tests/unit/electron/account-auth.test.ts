import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false },
  safeStorage: {},
  protocol: {},
  session: {},
  shell: {},
  dialog: {},
  Notification: class {},
  nativeImage: {},
  powerMonitor: { isOnBatteryPower: () => false },
  screen: {},
  BrowserWindow: { getAllWindows: () => [] },
}));

import { AuthService } from '../../../electron/services/auth';
import { Database } from '../../../electron/services/db';
import type { SecureStore } from '../../../electron/services/secure-store';

/**
 * My account › Security, the main-process half: which of the account's
 * sessions is this app's (the access token's `sid`), and staying signed in
 * after a password change — which ends every session, this one included.
 */
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

function setup(answer: (url: string, body: Record<string, string>) => Response) {
  const secrets = new Map<string, string>();
  const store = { get: (k: string) => secrets.get(k) ?? null, set: (k: string, v: string) => void secrets.set(k, v), delete: (k: string) => void secrets.delete(k) } as unknown as SecureStore;
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
    calls.push({ url, body });
    return answer(url, body);
  });
  const auth = new AuthService(new Database(':memory:'), store, fetch as never, () => ({}));
  auth.setServer({ origin: 'https://ws.example', name: 'WorkSuite', api: 'core', minimumVersion: null, locked: false });
  return { auth, calls, secrets };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ status: status < 400 ? 'success' : 'error', message: status < 400 ? 'OK' : 'Refused', data }), { status, headers: { 'Content-Type': 'application/json' } });
const tokens = (sid: number) => ({ tokens: { access_token: jwt({ sub: 7, type: 'access', sid }), refresh_token: `rt${sid}`, expires_in: 3600 } });

describe('this app’s session', () => {
  it('is the sid of the access token, and none before signing in', async () => {
    const { auth } = setup(() => json(tokens(645)));
    expect(auth.sessionId()).toBeNull();
    await auth.signIn('a@x.lk', 'pw');
    expect(auth.sessionId()).toBe(645);
  });

  it('reads nothing from a token without one', async () => {
    const { auth } = setup(() => json({ tokens: { access_token: 'not-a-jwt', refresh_token: 'rt', expires_in: 3600 } }));
    await auth.signIn('a@x.lk', 'pw');
    expect(auth.sessionId()).toBeNull();
  });
});

describe('staying signed in after a password change', () => {
  it('signs in again with the new password and keeps the new session', async () => {
    let n = 644;
    const { auth, calls, secrets } = setup(() => json(tokens(++n)));
    await auth.signIn('a@x.lk', 'old');
    expect(await auth.renew('a@x.lk', 'new')).toBe('renewed');
    expect(calls[1]).toEqual({ url: 'https://ws.example/api/auth/login', body: { email: 'a@x.lk', password: 'new' } });
    expect(auth.sessionId()).toBe(646);
    expect(secrets.get('auth:refresh')).toBe('rt646');
  });

  it('asks for the code when the account has two-factor, and finishes with it', async () => {
    const { auth, calls } = setup((url) => (url.endsWith('/api/auth/login') ? json({ mfa_required: true, challenge: 'ch-1' }) : json(tokens(700))));
    expect(await auth.renew('a@x.lk', 'new')).toBe('mfa');
    await auth.verifyMfa('123456');
    expect(calls[1]).toEqual({ url: 'https://ws.example/api/auth/mfa', body: { challenge: 'ch-1', code: '123456' } });
    expect(auth.sessionId()).toBe(700);
  });

  it('throws when the server refuses, leaving the session as it was', async () => {
    let first = true;
    const { auth } = setup(() => {
      if (first) return (first = false), json(tokens(1));
      return json(null, 429);
    });
    await auth.signIn('a@x.lk', 'old');
    await expect(auth.renew('a@x.lk', 'new')).rejects.toBeTruthy();
    expect(auth.sessionId()).toBe(1);
  });
});

describe('the hold across a password change', () => {
  it('makes a refused request wait for the new session instead of spending the revoked refresh token', async () => {
    const { auth, calls } = setup((url) => (url.endsWith('/api/auth/refresh') ? json(null, 401) : json(tokens(9))));
    auth.hold();
    const waiting = auth.refresh();
    expect(calls.some((c) => c.url.endsWith('/api/auth/refresh'))).toBe(false);
    expect(await auth.renew('a@x.lk', 'new')).toBe('renewed');
    expect(await waiting).toBe('ok');
    expect(auth.isHeld()).toBe(false);
    expect(auth.sessionId()).toBe(9);
  });

  it('ends the session when the renewal is given up', async () => {
    const { auth, secrets } = setup(() => json(tokens(3)));
    await auth.signIn('a@x.lk', 'old');
    auth.hold();
    const waiting = auth.refresh();
    auth.release('lost');
    expect(await waiting).toBe('lost');
    expect(secrets.get('auth:refresh')).toBeUndefined();
    expect(auth.sessionId()).toBeNull();
  });

  it('keeps holding through a wrong code, and lets the right one finish', async () => {
    let wrong = true;
    const { auth } = setup((url) => {
      if (url.endsWith('/api/auth/login')) return json({ mfa_required: true, challenge: 'ch' });
      if (url.endsWith('/api/auth/mfa') && wrong) return (wrong = false), new Response(JSON.stringify({ status: 'error', message: 'That code is not valid.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      return json(tokens(12));
    });
    auth.hold();
    expect(await auth.renew('a@x.lk', 'new')).toBe('mfa');
    await expect(auth.renewMfa('000000')).rejects.toBeTruthy();
    expect(auth.isHeld()).toBe(true);
    await auth.renewMfa('123456');
    expect(auth.isHeld()).toBe(false);
    expect(auth.sessionId()).toBe(12);
  });
});

const refused = (status: number, code: string) => new Response(JSON.stringify({ status: 'error', message: 'Refused', errors: { code } }), { status, headers: { 'Content-Type': 'application/json' } });

describe('unlocking with the password: no sign-in, no emailed code', () => {
  it('checks the password against the open session, and signs nothing in', async () => {
    const bearers: Array<string | null> = [];
    const { auth, calls } = setup(() => json(tokens(645)));
    await auth.signIn('a@x.lk', 'pw');
    const fetch = (auth as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
    fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, string> });
      bearers.push(new Headers(init?.headers).get('Authorization'));
      return json({ verified: true });
    });
    const before = calls.length;
    expect(await auth.verifyPassword('a@x.lk', 'pw')).toBe(true);
    // One call, the re-check, with this session's token: no /api/auth/login, so no device code and no sign-in email.
    expect(calls.slice(before)).toEqual([{ url: 'https://ws.example/api/auth/verify-password', body: { password: 'pw' } }]);
    expect(bearers).toEqual([`Bearer ${jwt({ sub: 7, type: 'access', sid: 645 })}`]);
    expect(auth.sessionId()).toBe(645);
  });

  it('says no to a wrong password without signing in, and does not treat it as a session end', async () => {
    const { auth, calls, secrets } = setup((url) => (url.endsWith('/verify-password') ? refused(403, 'invalid_password') : json(tokens(645))));
    await auth.signIn('a@x.lk', 'pw');
    const before = calls.length;
    expect(await auth.verifyPassword('a@x.lk', 'nope')).toBe(false);
    expect(calls.slice(before).map((c) => c.url)).toEqual(['https://ws.example/api/auth/verify-password']);
    expect(secrets.get('auth:refresh')).toBe('rt645');
  });

  it('passes on the server’s other refusals (too many tries) rather than signing in', async () => {
    const { auth, calls } = setup((url) => (url.endsWith('/verify-password') ? refused(429, 'rate_limited') : json(tokens(645))));
    await auth.signIn('a@x.lk', 'pw');
    const before = calls.length;
    await expect(auth.verifyPassword('a@x.lk', 'pw')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls.slice(before).map((c) => c.url)).toEqual(['https://ws.example/api/auth/verify-password']);
  });
});

describe('unlocking on a server without the re-check (QA-002, QA-003)', () => {
  it('signs in to check, keeps this session, and closes the one the check opened with its own tokens', async () => {
    let n = 644;
    const bearers: Array<string | null> = [];
    const { auth, calls, secrets } = setup(() => json(tokens(++n)));
    await auth.signIn('a@x.lk', 'pw');
    expect(auth.sessionId()).toBe(645);
    const fetch = (auth as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
    fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
      calls.push({ url, body });
      bearers.push(new Headers(init?.headers).get('Authorization'));
      // An older server has no /api/auth/verify-password.
      if (url.endsWith('/verify-password')) return json(null, 404);
      return json(tokens(++n));
    });
    expect(await auth.verifyPassword('a@x.lk', 'pw')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    // Signing the old session out with the new token ended the new one too (the server's logout ends its caller's).
    expect(calls.at(-1)).toEqual({ url: 'https://ws.example/api/auth/logout', body: { refresh_token: 'rt646' } });
    expect(bearers.at(-1)).toBe(`Bearer ${jwt({ sub: 7, type: 'access', sid: 646 })}`);
    expect(auth.sessionId()).toBe(645);
    expect(secrets.get('auth:refresh')).toBe('rt645');
  });

  it('with no session to ask, signs in to check and says no to a wrong password', async () => {
    const { auth, calls } = setup((url) => (url.endsWith('/api/auth/login') ? json(null, 401) : json(tokens(1))));
    expect(await auth.verifyPassword('a@x.lk', 'nope')).toBe(false);
    expect(calls.map((c) => c.url)).toEqual(['https://ws.example/api/auth/login']);
  });
});
