import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

import { canonicalJson } from '@shared/canonical-json';
import { IpcRouter } from '../../../electron/ipc/router';
import { isProxyPathAllowed, createApiProxy } from '../../../electron/services/api-proxy';
import { resolveBundlePath } from '../../../electron/protocols/app-protocol';
import { acceptSignedPolicy, capabilitiesFor, normalizePolicy, stricterPrivacy } from '../../../electron/services/policy';
import { verifyManifestSignature } from '../../../electron/updater/updater';
import { normalizeServerUrl, probeServer, toUserSummary } from '../../../electron/services/auth';
import { parseDirectives } from '../../../electron/services/device';
import { inDnd, mapServerNotification, present, utcStamp } from '../../../electron/services/notifications';
import { evaluateBoot } from '../../../electron/main/boot';
import { detachedBounds, fitToDisplays } from '../../../electron/windows/manager';
import { realtimeUrlAllowed } from '../../../electron/services/realtime';
import { HttpClient } from '../../../electron/services/http';
import { OfflineCache } from '../../../electron/services/offline-cache';
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';

function fakeIpc() {
  const handlers = new Map<string, (e: unknown, p: unknown) => unknown>();
  return {
    handlers,
    handle: (ch: string, fn: (e: unknown, p: unknown) => unknown) => handlers.set(ch, fn),
    removeHandler: (ch: string) => handlers.delete(ch),
  };
}
const event = (url = 'app://bundle/index.html', parent: unknown = null) => ({ sender: { id: 1, reload: vi.fn() }, senderFrame: { url, parent } });

describe('IPC pipeline (§3.4, WF-05)', () => {
  const deps = (over: Record<string, unknown> = {}) => ({
    isTrustedSender: (e: { senderFrame: { url: string; parent: unknown } }) => e.senderFrame.url.startsWith('app://bundle') && e.senderFrame.parent === null,
    isLocked: () => false,
    isSignedIn: () => true,
    hasPermission: () => true,
    audit: vi.fn(),
    onAbuse: vi.fn(),
    ...over,
  });

  it('validates payloads and strips unknown keys', async () => {
    const ipc = fakeIpc();
    const router = new IpcRouter(ipc as never, deps() as never);
    const seen: unknown[] = [];
    router.handle('auth:signIn', (input) => {
      seen.push(input);
      return { stage: 'ready' } as never;
    });
    router.install();
    const call = ipc.handlers.get('auth:signIn')!;
    expect(await call(event(), { email: 'a@b.c', password: 'x', extra: 'dropped' })).toEqual({ stage: 'ready' });
    expect(seen[0]).toEqual({ email: 'a@b.c', password: 'x' });
    expect(await call(event(), { email: 5 })).toMatchObject({ __wsError: true, code: 'IPC_VALIDATION_FAILED' });
  });

  it('refuses iframes and foreign origins', async () => {
    const ipc = fakeIpc();
    const router = new IpcRouter(ipc as never, deps() as never);
    router.handle('app:info', () => ({}) as never);
    router.install();
    const call = ipc.handlers.get('app:info')!;
    expect(await call(event('https://evil.example/'), undefined)).toMatchObject({ code: 'IPC_FORBIDDEN_SENDER' });
    expect(await call(event('app://bundle/index.html', {}), undefined)).toMatchObject({ code: 'IPC_FORBIDDEN_SENDER' });
  });

  it('enforces lock, session and permission, and audits sensitive actions', async () => {
    const ipc = fakeIpc();
    let locked = true;
    const d = deps({ isLocked: () => locked, hasPermission: (k: string) => k !== 'desktop.downloads' } as never);
    const router = new IpcRouter(ipc as never, d as never);
    router.handle('offline:status', () => ({}) as never);
    router.handle('transfers:download', () => ({}) as never);
    router.handle('diagnostics:saveBundle', () => null);
    router.install();
    expect(await ipc.handlers.get('offline:status')!(event(), undefined)).toMatchObject({ code: 'APP_LOCKED' });
    locked = false;
    expect(await ipc.handlers.get('offline:status')!(event(), undefined)).toEqual({});
    expect(await ipc.handlers.get('transfers:download')!(event(), { fileId: '1', name: 'a.pdf' })).toMatchObject({ code: 'PERMISSION_DENIED' });
    await ipc.handlers.get('diagnostics:saveBundle')!(event(), undefined);
    expect(d.audit).toHaveBeenCalledWith('diagnostics:saveBundle', { ok: true });
  });

  it('rate-limits a looping window and reloads it after repeated violations', async () => {
    const ipc = fakeIpc();
    const d = deps();
    const router = new IpcRouter(ipc as never, d as never);
    router.handle('auth:setServer', () => ({}) as never);
    router.install();
    const call = ipc.handlers.get('auth:setServer')!;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await call(event(), { url: 'x.example' }));
    expect(results.filter((r) => (r as { code?: string }).code === 'IPC_RATE_LIMITED').length).toBeGreaterThan(0);
    for (let i = 0; i < 25; i++) await call(event('https://evil.example/'), { url: 'x' });
    expect(d.onAbuse).toHaveBeenCalled();
  });

  it('answers UNSUPPORTED for a contract channel without a handler', async () => {
    const ipc = fakeIpc();
    const router = new IpcRouter(ipc as never, deps() as never);
    router.install();
    expect(await ipc.handlers.get('print:printers')!(event(), undefined)).toMatchObject({ code: 'UNSUPPORTED' });
  });
});

describe('API proxy (renderer never sees credentials)', () => {
  it('forwards module APIs and refuses credential-bearing ones', () => {
    expect(isProxyPathAllowed('/api/tasks?filter=mine')).toBe(true);
    expect(isProxyPathAllowed('/media/NzkwNy5vcmlnaW5hbA~180geGJ5Vzlmi1I93nu2bYLNujC65W_ZzUpw0xred4w')).toBe(true);
    expect(isProxyPathAllowed('/media/NzkwNy5vcmlnaW5hbA~180geGJ5Vzl?download=1')).toBe(true);
    expect(isProxyPathAllowed('/media/../api/auth/login')).toBe(false);
    expect(isProxyPathAllowed('/media/hls/abc/master.m3u8')).toBe(false);
    expect(isProxyPathAllowed('/fd/token')).toBe(false);
    expect(isProxyPathAllowed('/api/auth/me')).toBe(true);
    for (const p of ['/api/auth/login', '/api/auth/refresh', '/api/notifications/realtime-ticket', '/api/sync/hello', '/api/../admin', '/admin', '/api//x']) {
      expect(isProxyPathAllowed(p), p).toBe(false);
    }
  });

  it('lets My account manage its own sign-in methods, and nothing that answers a sign-in', () => {
    const ok: Array<[string, string]> = [
      ['GET', '/api/auth/mfa'], ['DELETE', '/api/auth/mfa'], ['POST', '/api/auth/mfa/setup'], ['POST', '/api/auth/mfa/confirm'], ['POST', '/api/auth/mfa/backup-codes'],
      ['GET', '/api/auth/passkeys'], ['PATCH', '/api/auth/passkeys/4'], ['DELETE', '/api/auth/passkeys/4'],
      ['GET', '/api/auth/sessions'], ['DELETE', '/api/auth/sessions/645'], ['GET', '/api/auth/sign-ins'], ['GET', '/api/auth/password-policy'],
    ];
    for (const [m, p] of ok) expect(isProxyPathAllowed(p, m), `${m} ${p}`).toBe(true);
    const refused: Array<[string, string]> = [
      ['POST', '/api/auth/mfa'], ['POST', '/api/auth/login'], ['POST', '/api/auth/refresh'], ['POST', '/api/auth/password'],
      ['POST', '/api/auth/passkeys/desktop/exchange'], ['POST', '/api/auth/passkeys/revoke-all'], ['POST', '/api/auth/passkeys/4'],
      ['DELETE', '/api/auth/sessions'], ['GET', '/api/auth/sessions/645'], ['POST', '/api/auth/mfa/setup/../../login'], ['POST', '/media/abcdefgh12'],
    ];
    for (const [m, p] of refused) expect(isProxyPathAllowed(p, m), `${m} ${p}`).toBe(false);
  });
  it('serves the cached answer, marked offline, when the server is unreachable', async () => {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const cache = new OfflineCache(db, () => vault);
    let online = true;
    const http = new HttpClient({
      fetch: async () => {
        if (!online) throw new TypeError('fetch failed');
        return new Response(JSON.stringify({ status: 'success', data: { tasks: [{ id: 1 }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      origin: () => 'https://ws.example',
      tokens: { accessToken: () => 't', refresh: async () => 'ok' },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: () => undefined,
    });
    const proxy = createApiProxy({ http, cache, userId: () => 'u1', cacheModuleFor: (p) => (p.startsWith('/api/tasks') ? 'tasks' : null), cacheLimits: () => ({ enabled: true, maxBytes: 1e8 }), mailBodiesCached: () => true });
    const req = () => new Request('app://bundle/__api/api/tasks?filter=mine', { headers: { Authorization: 'Bearer from-renderer', Cookie: 'x=1' } });
    const live = await proxy(req(), '/api/tasks?filter=mine');
    expect(live.headers.get('x-ws-offline')).toBeNull();
    online = false;
    const cached = await proxy(req(), '/api/tasks?filter=mine');
    expect(cached.headers.get('x-ws-offline')).toBe('1');
    expect(await cached.json()).toMatchObject({ data: { tasks: [{ id: 1 }] } });
    const miss = await proxy(new Request('app://bundle/__api/api/crm/leads'), '/api/crm/leads');
    expect(miss.status).toBe(503);
  });
});

describe('app:// bundle paths', () => {
  it('stays inside the renderer bundle', () => {
    const root = '/app/out/renderer';
    expect(resolveBundlePath(root, '/index.html')).toBe('/app/out/renderer/index.html');
    expect(resolveBundlePath(root, '/')).toBe('/app/out/renderer/index.html');
    expect(resolveBundlePath(root, '/../main/index.js')).toBeNull();
    expect(resolveBundlePath(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveBundlePath(root, '/assets/%00x.js')).toBeNull();
  });
});

describe('signed release manifests (FR-UPD-01)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = { schema: 1, product: 'worksuite-desktop', version: '0.2.0', channel: 'stable', artifacts: [] as unknown[] };
  const signature = sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64');
  it('accepts a manifest signed with the release key', () => {
    expect(verifyManifestSignature({ ...body, signature }, pem)).toBe(true);
  });
  it('rejects any change after signing, and other keys', () => {
    expect(verifyManifestSignature({ ...body, version: '9.9.9', signature }, pem)).toBe(false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyManifestSignature({ ...body, signature }, other)).toBe(false);
    expect(verifyManifestSignature({ ...body }, pem)).toBe(false);
  });
});

describe('desktop policy (§11.2, FR-SEC-09)', () => {
  it('normalises untrusted input onto known keys and ranges', () => {
    const p = normalizePolicy({ app_lock_max_minutes: 999, downloads: 'whatever', notification_min_privacy: 'GENERIC', evil: true }, false);
    expect(p.app_lock_max_minutes).toBe(60);
    expect(p.downloads).toBe('allowed');
    expect(p.notification_min_privacy).toBe('GENERIC');
    expect('evil' in p).toBe(false);
  });
  it('requires a valid signature when a key is pinned, and marks unpinned policies unsigned', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const doc = { version: 14, file_sync: 'disabled' };
    const signature = sign(null, Buffer.from(canonicalJson(doc)), privateKey).toString('base64');
    expect(acceptSignedPolicy({ ...doc, signature }, pem)?.file_sync).toBe('disabled');
    expect(acceptSignedPolicy({ ...doc, file_sync: 'allowed', signature }, pem)).toBeNull();
    expect(acceptSignedPolicy({ ...doc }, pem)).toBeNull();
    // No key pinned in the build: applied, and recorded as unsigned.
    expect(acceptSignedPolicy({ ...doc, signature: null }, null)).toMatchObject({ file_sync: 'disabled', signed: false });
  });
  it('takes the stricter notification privacy', () => {
    expect(stricterPrivacy('FULL', 'SENDER_ONLY')).toBe('SENDER_ONLY');
    expect(stricterPrivacy('GENERIC', 'FULL')).toBe('GENERIC');
  });
  it('gives devices the §11.3 capabilities', () => {
    const p = normalizePolicy({}, false);
    expect(capabilitiesFor('TRUSTED', p).offlineQueue).toBe('allowed');
    expect(capabilitiesFor('STANDARD', p).offlineQueue).toBe('drafts_only');
    expect(capabilitiesFor('RESTRICTED', p)).toEqual({ offlineQueue: 'disabled', offlineCache: false, downloads: 'disabled' });
    expect(capabilitiesFor('TRUSTED', normalizePolicy({ allow_offline: false }, false)).offlineQueue).toBe('disabled');
  });
});

describe('sign-in helpers', () => {
  it('accepts only HTTPS servers (localhost over HTTP in development)', () => {
    expect(normalizeServerUrl('app.worksuite.lk', false)).toBe('https://app.worksuite.lk');
    expect(normalizeServerUrl('https://app.worksuite.lk/some/path?x', false)).toBe('https://app.worksuite.lk');
    expect(() => normalizeServerUrl('http://app.worksuite.lk', false)).toThrow();
    expect(() => normalizeServerUrl('http://localhost:8080', false)).toThrow();
    expect(normalizeServerUrl('http://localhost:8080', true)).toBe('http://localhost:8080');
    expect(() => normalizeServerUrl('https://user:pw@x.example', false)).toThrow();
  });
  it('recognises a WorkSuite server, and says when it is failing', async () => {
    const ok = await probeServer('https://ws.example', async (url) =>
      url.endsWith('/api/auth/config')
        ? new Response(JSON.stringify({ status: 'success', data: { brand: '' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    expect(ok).toMatchObject({ api: 'core', name: 'ws.example' });
    await expect(probeServer('https://ws.example', async () => new Response(JSON.stringify({ status: 'error', message: 'db down' }), { status: 500, headers: { 'Content-Type': 'application/json' } }))).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    await expect(probeServer('https://ws.example', async () => new Response('nope', { status: 200 }))).rejects.toMatchObject({ code: 'NOT_WORKSUITE' });
  });
  it('recognises a desktop-v1 server and reads its own platform\'s minimum version', async () => {
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
    const wk = { api: 'desktop-v1', api_version: 1, name: 'Livezen WorkSuite', minimum_versions: { [platform]: '1.2.0', other: '9.9.9' } };
    const info = await probeServer('https://ws.example', async (url) =>
      url.endsWith('/.well-known/worksuite-desktop')
        ? new Response(JSON.stringify(wk), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('<html>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
    );
    expect(info).toMatchObject({ api: 'desktop-v1', name: 'Livezen WorkSuite', minimumVersion: '1.2.0' });
  });
  it('summarises the WorkSuite user', () => {
    expect(toUserSummary({ id: 7, name: '', email: 'a@b.c', organization: 'Livezen' })).toMatchObject({ id: '7', name: 'a@b.c', organizationName: 'Livezen' });
    // A required profile picture (#46); an older server that says nothing asks for nothing.
    expect(toUserSummary({ id: 7, email: 'a@b.c', picture_required: true }).pictureRequired).toBe(true);
    expect(toUserSummary({ id: 7, email: 'a@b.c' }).pictureRequired).toBe(false);
  });
});

describe('device directives (WF-23/24)', () => {
  it('reads the fleet decisions', () => {
    expect(parseDirectives({ stop: false })).toEqual({ kind: 'none', allowOffline: true });
    expect(parseDirectives({ stop: false, allow_offline: false })).toEqual({ kind: 'none', allowOffline: false });
    expect(parseDirectives({ stop: true, block: true, reason: 'Lost' })).toEqual({ kind: 'block', reason: 'Lost' });
    expect(parseDirectives({ stop: true, wipe: true }).kind).toBe('wipe');
    expect(parseDirectives({ stop: true, update: true, require_version: '2.2.0' })).toMatchObject({ kind: 'require-update', version: '2.2.0' });
  });
});

describe('notifications (FR-NTF-04/06)', () => {
  const n = { id: '1', module: 'chat', title: 'Samali · Garage design', body: 'Can we keep line-level approval?', sender: 'Samali', link: null, critical: false };
  it('applies privacy modes', () => {
    expect(present(n, 'FULL', 'Chat')).toEqual({ title: n.title, body: n.body });
    expect(present(n, 'SENDER_ONLY', 'Chat')).toEqual({ title: 'Chat', body: 'New from Samali' });
    expect(present(n, 'GENERIC', 'Chat')).toEqual({ title: 'WorkSuite', body: 'New WorkSuite notification' });
  });
  it('handles do-not-disturb windows across midnight', () => {
    const at = (h: number, m = 0) => new Date(2026, 8, 25, h, m);
    expect(inDnd('22:00', '07:00', at(23))).toBe(true);
    expect(inDnd('22:00', '07:00', at(6, 59))).toBe(true);
    expect(inDnd('22:00', '07:00', at(12))).toBe(false);
    expect(inDnd('09:00', '17:00', at(12))).toBe(true);
  });
  it('reads naive server stamps as UTC', () => {
    expect(utcStamp('2026-09-25 10:00:00')).toBe('2026-09-25T10:00:00.000Z');
    expect(mapServerNotification({ id: 5, title: 'x', link: '/tasks?task=3', read_at: null, created_at: '2026-09-25 10:00:00' })).toMatchObject({ id: '5', module: 'tasks', read: false });
  });
});

describe('crash recovery (FR-DIAG-03/04)', () => {
  it('offers Safe Mode after three unexpected exits in ten minutes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-boot-'));
    const p = { crashState: join(dir, 'crash.json'), runningMarker: join(dir, 'running.lock'), bootConfig: join(dir, 'boot.json') };
    const t0 = Date.parse('2026-09-25T10:00:00Z');
    writeFileSync(p.runningMarker, '1');
    expect(evaluateBoot(p, [], t0).safeMode).toBe(false);
    expect(evaluateBoot(p, [], t0 + 60_000).uncleanExit).toBe(true);
    const third = evaluateBoot(p, [], t0 + 120_000);
    expect(third.safeMode).toBe(true);
    expect(third.hardwareAcceleration).toBe(false);
    expect(evaluateBoot(p, ['--safe-mode'], t0 + 3_600_000).safeModeReason).toBe('requested');
  });
});

describe('torn-off windows (FR-NAV-05/07)', () => {
  const primary = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  const size = { width: 1100, height: 800 };
  it('opens where the tab was let go, its title bar under the pointer, and on screen', () => {
    expect(detachedBounds({ x: 300, y: 60 }, size, [], [primary], primary)).toEqual({ x: 180, y: 42, width: 1100, height: 800 });
    // Let go at the bottom right: pulled back into view.
    expect(detachedBounds({ x: 1400, y: 880 }, size, [], [primary], primary)).toEqual({ x: 340, y: 100, width: 1100, height: 800 });
  });
  it('without a pointer, steps down from the last one; with neither, keeps its own place', () => {
    expect(detachedBounds(null, size, [{ x: 100, y: 50, width: 900, height: 700 }], [primary], primary)).toEqual({ x: 128, y: 78, width: 900, height: 700 });
    expect(detachedBounds(null, size, [], [primary], primary)).toBeNull();
  });
});

describe('windows (FR-NAV-06)', () => {
  it('brings a window from a missing monitor back into view', () => {
    const primary = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
    expect(fitToDisplays({ x: 3000, y: 200, width: 800, height: 600 }, [primary], primary)).toEqual({ x: 320, y: 150, width: 800, height: 600 });
    expect(fitToDisplays({ x: 100, y: 100, width: 800, height: 600 }, [primary], primary)).toEqual({ x: 100, y: 100, width: 800, height: 600 });
    expect(fitToDisplays({ x: 1000, y: 700, width: 800, height: 600 }, [primary], primary)).toEqual({ x: 640, y: 300, width: 800, height: 600 });
  });
});

describe('realtime endpoint', () => {
  it('only connects to the server’s own domain over wss', () => {
    expect(realtimeUrlAllowed('wss://app.worksuite.lk/ws', 'https://app.worksuite.lk', false)).toBe(true);
    expect(realtimeUrlAllowed('wss://rt.worksuite.lk/v1', 'https://app.worksuite.lk', false)).toBe(true);
    expect(realtimeUrlAllowed('ws://app.worksuite.lk/ws', 'https://app.worksuite.lk', false)).toBe(false);
    expect(realtimeUrlAllowed('wss://evil.example/ws', 'https://app.worksuite.lk', false)).toBe(false);
  });
});
