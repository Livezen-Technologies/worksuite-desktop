import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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

import type { ServerInfo } from '@shared/types';
import { AuthService, probeServer } from '../../../electron/services/auth';
import { Database } from '../../../electron/services/db';
import type { SecureStore } from '../../../electron/services/secure-store';

/**
 * Passkey sign-in through the browser (the server's Auth\Libraries\DesktopHandoff).
 *
 * The app's part is small and all of it is about who may finish the sign-in:
 * only the challenge leaves the app, the callback must carry this attempt's
 * state, and the code is exchanged once, with the verifier nobody else saw.
 */
const SERVER: ServerInfo = {
  origin: 'https://ws.example',
  name: 'WorkSuite',
  api: 'desktop-v1',
  minimumVersion: null,
  locked: false,
  passkey: { url: '/desktop/passkey', exchange: '/api/auth/passkeys/desktop/exchange' },
};

const CODE = 'c'.repeat(43);
const s256 = (v: string) => createHash('sha256').update(v).digest('base64url');

function setup(server: ServerInfo = SERVER, answer: (body: Record<string, string>) => Response = () => ok()) {
  const secrets = new Map<string, string>();
  const store = { get: (k: string) => secrets.get(k) ?? null, set: (k: string, v: string) => void secrets.set(k, v), delete: (k: string) => void secrets.delete(k) } as unknown as SecureStore;
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
    calls.push({ url, body });
    return answer(body);
  });
  const auth = new AuthService(new Database(':memory:'), store, fetch as never, () => ({}));
  auth.setServer(server);
  return { auth, calls, secrets };
}

function ok(): Response {
  return new Response(JSON.stringify({ status: 'success', data: { user: { id: 7, name: 'A' }, tokens: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function started(auth: AuthService): { challenge: string; state: string; url: URL } {
  const url = new URL(auth.startPasskey('Test Mac'));
  return { challenge: url.searchParams.get('challenge') ?? '', state: url.searchParams.get('state') ?? '', url };
}

describe('passkey sign-in through the browser', () => {
  it('opens the server\'s own page with a challenge, and exchanges the code with the verifier behind it', async () => {
    const { auth, calls, secrets } = setup();
    const { challenge, state, url } = started(auth);

    expect(url.origin + url.pathname).toBe('https://ws.example/desktop/passkey');
    expect(url.searchParams.get('device')).toBe('Test Mac');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.search).not.toContain('verifier');

    const payload = await auth.completePasskey(CODE, state);

    expect(calls).toHaveLength(1);
    const [exchange] = calls;
    expect(exchange?.url).toBe('https://ws.example/api/auth/passkeys/desktop/exchange');
    expect(exchange?.body.code).toBe(CODE);
    expect(s256(exchange?.body.code_verifier ?? '')).toBe(challenge);
    expect(payload.user.id).toBe(7);
    expect(secrets.get('auth:refresh')).toBe('rt');
    expect(auth.hasPendingPasskey()).toBe(false);
  });

  it('ignores a callback with another attempt\'s state, and the real one still finishes', async () => {
    const { auth, calls } = setup();
    const { state } = started(auth);

    expect(auth.isPendingPasskey('someone-elses-state')).toBe(false);
    expect(auth.isPendingPasskey(state)).toBe(true);
    await expect(auth.completePasskey(CODE, 'someone-elses-state')).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    expect(calls).toHaveLength(0);

    await expect(auth.completePasskey(CODE, state)).resolves.toBeTruthy();
  });

  it('finishes once: the same callback a second time exchanges nothing', async () => {
    const { auth, calls } = setup();
    const { state } = started(auth);

    await auth.completePasskey(CODE, state);
    await expect(auth.completePasskey(CODE, state)).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    expect(calls).toHaveLength(1);
  });

  it('a refused exchange says why, stores nothing, and must be started again', async () => {
    const refused = () =>
      new Response(JSON.stringify({ status: 'error', message: 'That sign-in has expired or was already used. Start again from WorkSuite Desktop.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    const { auth, secrets } = setup(SERVER, refused);
    const { state } = started(auth);

    await expect(auth.completePasskey(CODE, state)).rejects.toMatchObject({ code: 'PASSKEY_FAILED', message: expect.stringContaining('expired') });
    expect(secrets.get('auth:refresh')).toBeUndefined();
    expect(auth.hasPendingPasskey()).toBe(false);
  });

  it('a new start replaces the old one, so an older browser tab cannot finish it', async () => {
    const { auth } = setup();
    const first = started(auth);
    const second = started(auth);

    await expect(auth.completePasskey(CODE, first.state)).rejects.toMatchObject({ code: 'PASSKEY_FAILED' });
    expect(second.challenge).not.toBe(first.challenge);
  });

  it('is not offered by a server that does not announce it', () => {
    const { auth } = setup({ ...SERVER, passkey: null });

    expect(() => auth.startPasskey('Test Mac')).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }));
  });

  it('reads the offer from discovery, and only as paths on the same server', async () => {
    const wk = (passkey: unknown) => async (url: string) =>
      url.endsWith('/.well-known/worksuite-desktop')
        ? new Response(JSON.stringify({ api: 'desktop-v1', api_version: 1, name: 'WS', passkey_sign_in: passkey }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('', { status: 404 });

    expect((await probeServer('https://ws.example', wk({ url: '/desktop/passkey', exchange: '/api/auth/passkeys/desktop/exchange' }))).passkey).toEqual({
      url: '/desktop/passkey',
      exchange: '/api/auth/passkeys/desktop/exchange',
    });
    expect((await probeServer('https://ws.example', wk({ url: 'https://evil.example/p', exchange: '/api/x' }))).passkey).toBeNull();
    expect((await probeServer('https://ws.example', wk(null))).passkey).toBeNull();
  });
});
