import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false },
  // A store that is there (it encrypts nothing here): writing to it can still fail, as a real one's can.
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
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

import type { ServerApi } from '@shared/types';
import { IpcRouter } from '../../../electron/ipc/router';
import { SessionController, type SessionHooks } from '../../../electron/main/session';
import { AuthService } from '../../../electron/services/auth';
import { BootstrapService } from '../../../electron/services/bootstrap';
import { Database } from '../../../electron/services/db';
import { DeviceService } from '../../../electron/services/device';
import { HttpClient, type FetchLike } from '../../../electron/services/http';
import { LockService } from '../../../electron/services/lock';
import { SecureStore } from '../../../electron/services/secure-store';
import { Vault } from '../../../electron/services/vault';

/**
 * LOGIN-001 — valid credentials sometimes failed in the desktop app and the
 * person was back at the sign-in panel; the same ones worked on the web. The
 * desktop signs in, then registers the computer and loads the bootstrap, while
 * the services of a session that ended keep asking the server — every request
 * about two seconds on the server in question (#265). What sent people back:
 *
 *  - a request sent before the sign-in (no token) and refused after it
 *    refreshed the brand-new session; the refresh rotates, so the tokens the
 *    sign-in's own requests carried stopped working and a refusal ended it;
 *  - a refresh under way for the old session deleted, or overwrote, the new
 *    session's tokens when its answer came;
 *  - two submits signed in twice, and the one that failed forgot the tokens;
 *  - a passing 5xx, rate limit or blip while registering or loading the
 *    bootstrap ended the sign-in at once, and a server that no longer knew the
 *    computer at the bootstrap ended it too;
 *  - a computer removed while nobody was signed in was wiped by every sign-in's
 *    heartbeat without its registration ever being forgotten — every time;
 *  - an administrator's sign-out the heartbeat brought said nothing;
 *  - the app lock, left on when a session expired, refused the sign-in;
 *  - an OS store refusing to save the refresh token failed the sign-in.
 */

const ORIGIN = 'https://ws.example';
const USER = { id: 7, name: 'Ann', email: 'ann@x.lk' };

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const tokensFor = (sid: number) => ({ access_token: jwt({ sub: 7, type: 'access', sid }), refresh_token: `rt${sid}`, expires_in: 3600 });

function json(data: unknown, status = 200, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ status: status < 400 ? 'success' : 'error', message: status < 400 ? 'OK' : `The server answered ${status}.`, data, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

async function tick(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

async function until(done: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (done()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`never happened: ${what}`);
}

function memoryStore(kept = new Map<string, string>()): SecureStore {
  return { get: (k: string) => kept.get(k) ?? null, set: (k: string, v: string) => void kept.set(k, v), delete: (k: string) => void kept.delete(k) } as unknown as SecureStore;
}

interface Req {
  method: string;
  path: string;
  bearer: string | null;
  body: Record<string, unknown>;
}

/**
 * A WorkSuite server as a sign-in meets it. Each sign-in opens a session; a
 * refresh rotates it — the old refresh token and the old session's access
 * tokens stop working at once (the auth filter checks the token's session);
 * everything else needs an access token of a live session. `answer` is what it
 * says now; a test's `route` may hold a request back or answer otherwise.
 */
function fakeServer(api: ServerApi) {
  const live = new Map<number, boolean>();
  let sid = 0;
  const log: Req[] = [];
  let route: ((r: Req) => Response | Promise<Response> | undefined) | null = null;
  const issue = () => {
    sid++;
    live.set(sid, true);
    return tokensFor(sid);
  };
  const sidOf = (bearer: string | null): number | null => {
    const part = bearer?.replace(/^Bearer /, '').split('.')[1];
    return part ? ((JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { sid?: number }).sid ?? null) : null;
  };
  const answer = (r: Req): Response => {
    if (r.path === '/.well-known/worksuite-desktop') {
      return api === 'desktop-v1' ? new Response(JSON.stringify({ api: 'desktop-v1', name: 'WS' }), { status: 200, headers: { 'Content-Type': 'application/json' } }) : new Response('', { status: 404 });
    }
    if (r.path === '/api/auth/config') return json({});
    if (r.path === '/api/auth/login') return json({ user: USER, tokens: issue() });
    if (r.path === '/api/auth/refresh') {
      const n = Number(String(r.body.refresh_token).slice(2));
      if (!live.get(n)) return json(null, 401);
      live.set(n, false);
      return json({ tokens: issue() });
    }
    if (r.path === '/api/auth/logout') return json({});
    const s = sidOf(r.bearer);
    if (s === null || !live.get(s)) return json(null, 401, { message: 'Session ended. Please sign in again.' });
    switch (r.path) {
      case '/api/sync/devices':
        return json({ device: { id: 'd1' }, token: 'dt' });
      case '/desktop/v1/devices/register':
        return json({ device_id: 'new', token: 'dt', trust: 'STANDARD' });
      case '/desktop/v1/devices/heartbeat':
        return json({ directives: {}, commands: [] });
      case '/desktop/v1/bootstrap':
        return json({ user: USER, organizations: [], apps: [], permissions: [] });
      case '/api/auth/me':
        return json({ user: USER, permissions: [], apps: ['*'] });
      case '/api/tasks/organizations':
        return json({ organizations: [] });
      case '/api/sync/policy':
        return json({ allow_offline: true });
      case '/api/sync/fleet':
        return json({ devices: [] });
      default:
        return json({});
    }
  };
  const fetch: FetchLike = async (url, init) => {
    const r: Req = { method: init.method ?? 'GET', path: new URL(url).pathname, bearer: new Headers(init.headers).get('Authorization'), body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} };
    log.push(r);
    return (await route?.(r)) ?? answer(r);
  };
  return {
    fetch,
    answer,
    route: (fn: typeof route) => void (route = fn),
    count: (path: string | RegExp) => log.filter((r) => (typeof path === 'string' ? r.path === path : path.test(r.path))).length,
  };
}

/** The main process's sign-in path as index.ts wires it: auth, the HTTP client, device, bootstrap, session, lock. */
async function harness(api: ServerApi = 'core') {
  const server = fakeServer(api);
  const db = new Database(':memory:');
  const kept = new Map<string, string>();
  const secrets = memoryStore(kept);
  const auth = new AuthService(db, secrets, server.fetch, () => ({}));
  const lock = new LockService();
  lock.enabled = () => session.isReady();
  const ref: { device?: DeviceService } = {};
  const http = new HttpClient({
    fetch: server.fetch,
    origin: () => auth.getServer()?.origin ?? null,
    tokens: { accessToken: () => auth.accessToken(), refresh: () => auth.refresh() },
    clientHeaders: (): Record<string, string> => {
      const d = ref.device?.current();
      return d ? { 'X-WS-Device': d.id } : {};
    },
    onReachability: () => undefined,
    onAuthLost: (reason) => session.expired(reason),
    onDeviceDirective: (code, message) => {
      if (code === 'DEVICE_REVOKED') void session.wipe(message);
    },
  });
  const device = new DeviceService(db, secrets, http);
  ref.device = device;
  const vault = new Vault(Vault.generateKey());
  const bootstrap = new BootstrapService(db, () => vault, http, null);
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
    unlock: vi.fn(() => lock.reset()),
  } satisfies SessionHooks;
  const session = new SessionController(db, auth, device, bootstrap, server.fetch, { source: null }, hooks);
  session.retryDelaysMs = [0, 0];
  await session.setServer(ORIGIN);
  return { server, session, auth, http, kept, hooks, lock };
}

const registration = (id: string) => JSON.stringify({ id, token: null, registeredAt: '2026-10-01T09:00:00.000Z' });

describe('a 401 about a token the session has since replaced (HttpClient)', () => {
  it('a request sent before a sign-in and refused after it goes again with the new token, and nothing is refreshed', async () => {
    let token: string | null = null;
    const refresh = vi.fn(async () => 'ok' as const);
    const answered = gate();
    const bearers: Array<string | null> = [];
    const http = new HttpClient({
      fetch: async (_url, init) => {
        const bearer = new Headers(init.headers).get('Authorization');
        bearers.push(bearer);
        if (!bearer) {
          await answered.wait;
          return json(null, 401);
        }
        return json({ n: 1 });
      },
      origin: () => ORIGIN,
      tokens: { accessToken: () => token, refresh },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: vi.fn(),
    });
    const pending = http.get('/api/badges');
    token = 'new-session';
    answered.open();
    await expect(pending).resolves.toEqual({ n: 1 });
    expect(refresh).not.toHaveBeenCalled();
    expect(bearers).toEqual([null, 'Bearer new-session']);
  });

  it('a request refused for a token another request’s refresh replaced goes again with the new one, without a second refresh', async () => {
    let token = 'A';
    const refresh = vi.fn(async () => 'ok' as const);
    const answered = gate();
    const http = new HttpClient({
      fetch: async (_url, init) => {
        if (new Headers(init.headers).get('Authorization') === 'Bearer A') {
          await answered.wait;
          return json(null, 401);
        }
        return json({ ok: true });
      },
      origin: () => ORIGIN,
      tokens: { accessToken: () => token, refresh },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: vi.fn(),
    });
    const pending = http.get('/api/chat/unread');
    token = 'B';
    answered.open();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('still refreshes once for the current token, and a refusal of the refresh still ends the session', async () => {
    const refresh = vi.fn(async () => 'lost' as const);
    const lost = vi.fn();
    const http = new HttpClient({
      fetch: async () => json(null, 401, { message: 'Session ended. Please sign in again.' }),
      origin: () => ORIGIN,
      tokens: { accessToken: () => 'A', refresh },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: lost,
    });
    await expect(http.get('/api/badges')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledWith('Session ended. Please sign in again.');
  });

  it('a 401 after a refresh that worked is still the request’s own answer', async () => {
    let token = 'A';
    const refresh = vi.fn(async () => {
      token = 'B';
      return 'ok' as const;
    });
    const http = new HttpClient({
      fetch: async () => json(null, 401, { message: 'Wrong folder password.' }),
      origin: () => ORIGIN,
      tokens: { accessToken: () => token, refresh },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: vi.fn(),
    });
    await expect(http.get('/api/files/locked')).rejects.toMatchObject({ code: 'SESSION_EXPIRED', message: 'Wrong folder password.' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a refresh answered after the session it was for was replaced (AuthService)', () => {
  function setup(answerRefresh: () => Response) {
    const kept = new Map([['auth:refresh', 'rt-old']]);
    const refreshing = gate();
    const auth = new AuthService(
      new Database(':memory:'),
      memoryStore(kept),
      async (url) => {
        if (url.endsWith('/api/auth/refresh')) {
          await refreshing.wait;
          return answerRefresh();
        }
        return json({ user: USER, tokens: tokensFor(2) });
      },
      () => ({}),
    );
    auth.setServer({ origin: ORIGIN, name: 'WS', api: 'core', minimumVersion: null, locked: false });
    return { auth, kept, refreshing };
  }

  it('refused, it leaves the new sign-in’s tokens alone', async () => {
    const { auth, kept, refreshing } = setup(() => json(null, 401));
    const pending = auth.refresh();
    await auth.signIn('ann@x.lk', 'right');
    refreshing.open();
    expect(await pending).toBe('ok');
    expect(kept.get('auth:refresh')).toBe('rt2');
    expect(auth.sessionId()).toBe(2);
    expect(auth.accessToken()).not.toBeNull();
  });

  it('accepted, it does not put the old session back over the new one', async () => {
    const { auth, kept, refreshing } = setup(() => json({ tokens: tokensFor(9) }));
    const pending = auth.refresh();
    await auth.signIn('ann@x.lk', 'right');
    refreshing.open();
    expect(await pending).toBe('ok');
    expect(kept.get('auth:refresh')).toBe('rt2');
    expect(auth.sessionId()).toBe(2);
  });

  it('after signing out, it brings no session back', async () => {
    const { auth, kept, refreshing } = setup(() => json({ tokens: tokensFor(9) }));
    const pending = auth.refresh();
    auth.forget();
    refreshing.open();
    expect(await pending).toBe('lost');
    expect(kept.has('auth:refresh')).toBe(false);
    expect(auth.accessToken()).toBeNull();
  });
});

describe('the OS store refusing to save the session', () => {
  it('signs in all the same, for this run', async () => {
    // A store that is there, but whose file cannot be written (a keychain prompt denied, a file another program holds).
    const store = new SecureStore(join(tmpdir(), `ws-login-001-${process.pid}-${Date.now()}`, 'missing', 'secrets.json'));
    expect(store.init().persistent).toBe(true);
    const auth = new AuthService(new Database(':memory:'), store, async () => json({ user: USER, tokens: tokensFor(4) }), () => ({}));
    auth.setServer({ origin: ORIGIN, name: 'WS', api: 'core', minimumVersion: null, locked: false });
    await expect(auth.signIn('ann@x.lk', 'right')).resolves.toMatchObject({ kind: 'signed-in' });
    expect(auth.sessionId()).toBe(4);
    expect(store.get('auth:refresh')).toBe('rt4');
  });
});

describe('signing in (SessionController)', () => {
  it('requests from a session that ended, refused just after the sign-in, neither refresh it nor send the person back', async () => {
    const { server, session, http } = await harness('core');
    const badges = gate();
    const unread = gate();
    const firstRegistration = gate();
    const secondRegistration = gate();
    let registrations = 0;
    server.route((r) => {
      if (r.path === '/api/badges' && !r.bearer) return badges.wait.then(() => server.answer(r));
      if (r.path === '/api/chat/unread' && !r.bearer) return unread.wait.then(() => server.answer(r));
      if (r.path === '/api/sync/devices') return (++registrations === 1 ? firstRegistration : secondRegistration).wait.then(() => server.answer(r));
      return undefined;
    });
    // Polls of the session that expired: sent with no token, answered — refused — once the new sign-in is in.
    const stale = [http.get('/api/badges'), http.get('/api/chat/unread')];
    const signingIn = session.signIn('ann@x.lk', 'right').catch((e: unknown) => e);
    await until(() => registrations === 1, 'the computer registers');
    badges.open();
    await tick();
    firstRegistration.open();
    await tick();
    unread.open();
    await tick();
    secondRegistration.open();
    await signingIn;

    expect(session.get()).toMatchObject({ stage: 'ready', message: null });
    expect(server.count('/api/auth/refresh')).toBe(0);
    await expect(Promise.all(stale)).resolves.toEqual([{}, {}]);
  });

  it('two submits while the server is still answering sign in once', async () => {
    const { server, session } = await harness('core');
    const login = gate();
    server.route((r) => (r.path === '/api/auth/login' ? login.wait.then(() => server.answer(r)) : undefined));
    const first = session.signIn('ann@x.lk', 'right');
    const second = session.signIn('ann@x.lk', 'right');
    login.open();
    const [a, b] = await Promise.all([first, second]);
    expect(a.stage).toBe('ready');
    expect(b.stage).toBe('ready');
    expect(server.count('/api/auth/login')).toBe(1);
    expect(server.count('/api/sync/devices')).toBe(1);
  });

  it('a passing failure while registering is asked again, not a trip back to the sign-in panel', async () => {
    const { server, session } = await harness('core');
    let n = 0;
    server.route((r) => (r.path === '/api/sync/devices' && ++n === 1 ? json(null, 502, { message: 'Bad Gateway' }) : undefined));
    await expect(session.signIn('ann@x.lk', 'right')).resolves.toMatchObject({ stage: 'ready' });
    expect(n).toBe(2);
  });

  it('so is a blip in the network while the workspace loads', async () => {
    const { server, session } = await harness('core');
    let n = 0;
    server.route((r) => (r.path === '/api/auth/me' && ++n === 1 ? Promise.reject(new TypeError('fetch failed')) : undefined));
    await expect(session.signIn('ann@x.lk', 'right')).resolves.toMatchObject({ stage: 'ready' });
    expect(n).toBe(2);
  });

  it('a failure that lasts still says why on the sign-in panel', async () => {
    const { server, session } = await harness('core');
    server.route((r) => (r.path === '/api/sync/devices' ? json(null, 503, { message: 'WorkSuite is being updated. Try again in a few minutes.' }) : undefined));
    await expect(session.signIn('ann@x.lk', 'right')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(session.get()).toMatchObject({ stage: 'signed-out', message: 'WorkSuite is being updated. Try again in a few minutes.' });
    expect(server.count('/api/sync/devices')).toBe(3);
  });

  it('keeps a registration whose heartbeat cannot be had just now', async () => {
    const { server, session, kept } = await harness('core');
    kept.set('device:7', registration('d1'));
    server.route((r) => (/\/health$/.test(r.path) ? json(null, 503, { message: 'Service Unavailable' }) : undefined));
    await expect(session.signIn('ann@x.lk', 'right')).resolves.toMatchObject({ stage: 'ready' });
    expect(server.count('/api/sync/devices')).toBe(0);
    expect(server.count(/\/health$/)).toBe(1);
  });

  it('registers again when the server no longer knows this computer at the bootstrap', async () => {
    const { server, session, kept } = await harness('desktop-v1');
    kept.set('device:7', registration('gone'));
    server.route((r) => {
      // The heartbeat out of reach, so the registration is kept; the bootstrap then says it is not known.
      if (r.path === '/desktop/v1/devices/heartbeat') return Promise.reject(new TypeError('fetch failed'));
      if (r.path === '/desktop/v1/bootstrap' && server.count('/desktop/v1/devices/register') === 0) {
        return json(null, 401, { code: 'DEVICE_NOT_REGISTERED', message: 'This computer is not registered.' });
      }
      return undefined;
    });
    await expect(session.signIn('ann@x.lk', 'right')).resolves.toMatchObject({ stage: 'ready' });
    expect(server.count('/desktop/v1/devices/register')).toBe(1);
    expect(JSON.parse(kept.get('device:7')!).id).toBe('new');
  });

  it('a computer removed while signed out says so once, forgets its registration, and the next sign-in registers it anew', async () => {
    const { server, session, kept, hooks } = await harness('desktop-v1');
    kept.set('device:7', registration('old'));
    server.route((r) =>
      r.path === '/desktop/v1/devices/heartbeat' && r.body.device_id === 'old' ? json(null, 401, { code: 'DEVICE_REVOKED', message: 'This computer was removed from WorkSuite.' }) : undefined,
    );
    await expect(session.signIn('ann@x.lk', 'right')).resolves.toMatchObject({ stage: 'revoked', message: 'This computer was removed from WorkSuite.' });
    expect(kept.has('device:7')).toBe(false);
    expect(hooks.wiped).toHaveBeenCalledWith('7', 'cache+offline_files', true);
    expect(server.count('/desktop/v1/bootstrap')).toBe(0);

    // "Sign in again" on the removed screen.
    await session.signOut(false);
    await expect(session.signIn('ann@x.lk', 'right')).resolves.toMatchObject({ stage: 'ready' });
    expect(server.count('/desktop/v1/devices/register')).toBe(1);
    expect(JSON.parse(kept.get('device:7')!).id).toBe('new');
  });

  it('an administrator’s sign-out that the sign-in’s heartbeat brings says so, and goes no further', async () => {
    const { server, session, kept } = await harness('desktop-v1');
    kept.set('device:7', registration('d7'));
    let delivered = false;
    server.route((r) => {
      if (r.path !== '/desktop/v1/devices/heartbeat' || delivered) return undefined;
      delivered = true;
      return json({ directives: {}, commands: [{ id: 'c1', command: 'SIGN_OUT', payload: {} }] });
    });
    await expect(session.signIn('ann@x.lk', 'right')).resolves.toMatchObject({ stage: 'signed-out', message: 'Your administrator signed you out of WorkSuite on this computer.' });
    expect(server.count('/desktop/v1/bootstrap')).toBe(0);
  });

  it('a session that expires behind the app lock leaves a sign-in panel that signs in', async () => {
    const { server, session, http, lock } = await harness('core');
    await session.signIn('ann@x.lk', 'right');
    lock.lock('timeout');
    expect(lock.isLocked()).toBe(true);

    // The server ends the session while the app is locked; the next poll's refresh is refused.
    server.route((r) => (r.path === '/api/auth/refresh' ? json(null, 401) : r.bearer ? json(null, 401, { message: 'Session ended. Please sign in again.' }) : undefined));
    await http.get('/api/badges').catch(() => undefined);
    expect(session.get().stage).toBe('expired');

    // The IPC router as main wires it: while locked, only `whileLocked` channels — and auth:signIn is not one.
    const handlers = new Map<string, (e: unknown, p: unknown) => unknown>();
    const router = new IpcRouter({ handle: (ch: string, fn: (e: unknown, p: unknown) => unknown) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never, {
      isTrustedSender: () => true,
      isLocked: () => lock.isLocked(),
      isSignedIn: () => session.isReady(),
      hasPermission: () => true,
      audit: vi.fn(),
      onAbuse: vi.fn(),
    } as never);
    router.handle('auth:signIn', (input) => session.signIn(input.email, input.password));
    router.install();
    server.route(null);
    const event = { sender: { id: 1, reload: vi.fn() }, senderFrame: { url: 'app://bundle/index.html', parent: null } };
    await expect(handlers.get('auth:signIn')!(event, { email: 'ann@x.lk', password: 'right' })).resolves.toMatchObject({ stage: 'ready' });
  });
});
