import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache } from '../../../electron/services/offline-cache';
import { OfflineQueue } from '../../../electron/services/offline-queue';
import { HttpClient, type FetchLike } from '../../../electron/services/http';
import { createZip } from '../../../electron/services/zip';
import { inflateRawSync, crc32 } from 'node:zlib';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('vault (NFR-SEC-03)', () => {
  it('round-trips and detects tampering', () => {
    const v = new Vault(Vault.generateKey());
    const enc = v.encrypt({ secret: 'draft body' });
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('draft body');
    expect(v.decrypt(enc)).toEqual({ secret: 'draft body' });
    const raw = Buffer.from(enc.slice(3), 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0xff;
    expect(v.decrypt(`v1:${raw.toString('base64')}`)).toBeUndefined();
    expect(new Vault(Vault.generateKey()).decrypt(enc)).toBeUndefined();
  });
});

describe('database', () => {
  it('migrates and keeps config', () => {
    const db = new Database(':memory:');
    expect(db.version).toBe(6);
    db.setConfig('server', { origin: 'https://x' });
    expect(db.getConfig<{ origin: string }>('server')?.origin).toBe('https://x');
    expect(db.integrityCheck()).toBe('ok');
  });
  it('answers nothing, rather than throwing, once closed (a late timer while quitting)', () => {
    const db = new Database(':memory:');
    db.close();
    expect(db.isClosed).toBe(true);
    expect(db.run('INSERT INTO config (key, value) VALUES (?, ?)', 'a', 'b')).toEqual({ changes: 0 });
    expect(db.get('SELECT * FROM config')).toBeUndefined();
    expect(db.all('SELECT * FROM config')).toEqual([]);
    expect(() => db.close()).not.toThrow();
  });
});

describe('offline cache (FR-OFF-01)', () => {
  it('stores encrypted answers per user and evicts to the limit', () => {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const cache = new OfflineCache(db, () => vault);
    const limits = { enabled: true, maxBytes: 64 * 1024 * 1024 };
    cache.put('u1', 'tasks', '/api/tasks?filter=mine', { status: 200, contentType: 'application/json', body: '{"data":{"tasks":[]}}' }, limits);
    expect(cache.get('u1', '/api/tasks?filter=mine')?.body).toContain('tasks');
    expect(cache.get('u2', '/api/tasks?filter=mine')).toBeNull();
    const row = db.get<{ payload: string }>('SELECT payload FROM cached_records');
    expect(row?.payload).not.toContain('tasks');
    for (let i = 0; i < 20; i++) cache.put('u1', 'mail', `/api/mail/messages/${i}`, { status: 200, contentType: 'application/json', body: 'x'.repeat(2000) }, limits);
    const removed = cache.evict(10_000);
    expect(removed).toBeGreaterThan(0);
    expect(cache.totalBytes()).toBeLessThanOrEqual(10_000);
  });
  it('writes nothing when policy disables offline storage', () => {
    const db = new Database(':memory:');
    const cache = new OfflineCache(db, () => new Vault(Vault.generateKey()));
    cache.put('u1', 'tasks', '/api/tasks', { status: 200, contentType: 'application/json', body: '{}' }, { enabled: false, maxBytes: 1e9 });
    expect(cache.count()).toBe(0);
  });
});

describe('HTTP client', () => {
  const tokens = (initial: string | null, next: 'ok' | 'offline' | 'lost' = 'ok') => {
    let token = initial;
    return {
      accessToken: () => token,
      refresh: vi.fn(async () => {
        if (next === 'ok') token = 'fresh';
        return next;
      }),
    };
  };
  it('adds the bearer token, refreshes once on 401 and retries', async () => {
    const seen: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
      const auth = new Headers(init.headers).get('Authorization') ?? '';
      seen.push(auth);
      return auth === 'Bearer fresh' ? json(200, { status: 'success', data: { ok: 1 } }) : json(401, { status: 'error', message: 'Invalid or expired token' });
    };
    const t = tokens('stale');
    const http = new HttpClient({ fetch, origin: () => 'https://ws.example', tokens: t, clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: () => undefined });
    await expect(http.get('/api/auth/me')).resolves.toEqual({ ok: 1 });
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(t.refresh).toHaveBeenCalledTimes(1);
  });
  it('keeps the session when a request is refused after a refresh that worked (a wrong folder password)', async () => {
    const lost = vi.fn();
    const t = tokens('stale');
    const http = new HttpClient({ fetch: async () => json(401, { status: 'error', message: 'Incorrect password' }), origin: () => 'https://ws.example', tokens: t, clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: lost });
    const res = await http.raw('POST', 'https://ws.example/api/folders/7/verify');
    expect(res.status).toBe(401);
    expect(t.refresh).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
  });
  it('reports the session lost when refresh is refused', async () => {
    const lost = vi.fn();
    const http = new HttpClient({ fetch: async () => json(401, { status: 'error', message: 'Session ended' }), origin: () => 'https://ws.example', tokens: tokens('x', 'lost'), clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: lost });
    await expect(http.get('/api/auth/me')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(lost).toHaveBeenCalled();
  });
  it('maps statuses to desktop error codes', async () => {
    const make = (status: number, body: unknown) => new HttpClient({ fetch: async () => json(status, body), origin: () => 'https://ws.example', tokens: tokens('x'), clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: () => undefined });
    await expect(make(403, { status: 'error', message: 'no', app: 'crm' }).get('/api/crm/leads')).rejects.toMatchObject({ code: 'APP_ACCESS_DENIED' });
    await expect(make(409, { status: 'error', message: 'changed' }).get('/api/x')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(make(426, { status: 'error', message: 'old', code: 'VERSION_UNSUPPORTED' }).get('/api/x')).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' });
  });
  it('treats network failures as unreachable and says so', async () => {
    const reach = vi.fn();
    const http = new HttpClient({ fetch: async () => { throw new TypeError('fetch failed: net::ERR_INTERNET_DISCONNECTED'); }, origin: () => 'https://ws.example', tokens: tokens('x'), clientHeaders: () => ({}), onReachability: reach, onAuthLost: () => undefined });
    await expect(http.get('/api/x')).rejects.toMatchObject({ code: 'NETWORK_UNREACHABLE', message: 'Cannot reach WorkSuite server. Check your network or company VPN.' });
    expect(reach).toHaveBeenCalledWith(false);
  });
  it('never sends credentials to another origin', () => {
    const http = new HttpClient({ fetch: async () => json(200, {}), origin: () => 'https://ws.example', tokens: tokens('x'), clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: () => undefined });
    expect(() => http.url('//evil.example/api')).toThrow();
  });
  it('recognises certificate errors and never bypasses them', async () => {
    const http = new HttpClient({ fetch: async () => { throw new TypeError('net::ERR_CERT_AUTHORITY_INVALID'); }, origin: () => 'https://ws.example', tokens: tokens('x'), clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: () => undefined });
    await expect(http.get('/api/x')).rejects.toMatchObject({ code: 'TLS_ERROR' });
  });
});

describe('offline mutation queue (FR-OFF-02/03/04, WF-17)', () => {
  function setup(responder: (url: string, init: RequestInit) => Promise<Response>, perm: 'allowed' | 'drafts_only' = 'allowed') {
    const db = new Database(':memory:');
    const vault = new Vault(Vault.generateKey());
    const http = new HttpClient({ fetch: responder, origin: () => 'https://ws.example', tokens: { accessToken: () => 't', refresh: async () => 'ok' }, clientHeaders: () => ({}), onReachability: () => undefined, onAuthLost: () => undefined });
    return { db, queue: new OfflineQueue(db, () => vault, http, () => perm) };
  }
  const input = (id: string, value = 'done') => ({ module: 'tasks', entity: 'task', entityId: id, label: `Complete ${id}`, method: 'PATCH' as const, path: `/api/tasks/${id}`, body: { field: 'status', value }, queueIfOffline: true });

  it('writes only where the API proxy would let a page write (a desk\'s pairing, dot segments)', async () => {
    const sent: string[] = [];
    const { queue } = setup(async (url) => {
      sent.push(url);
      return json(200, { status: 'success', data: { key: 'desk-secret' } });
    });
    for (const path of ['/api/salon/v1/desk/pair', '/api/salon/v1/./desk/pair', '/api/tasks/../salon/v1/desk/pair', '/api/notifications/realtime-ticket']) {
      await expect(queue.submit('u1', { ...input('1'), method: 'POST', path })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    }
    expect(sent).toEqual([]);
    await expect(queue.submit('u1', input('1'))).resolves.toMatchObject({ delivered: true });
  });

  it('queues when offline, durably and encrypted, then replays in order with idempotency keys', async () => {
    let online = false;
    const calls: Array<{ url: string; key: string | null }> = [];
    const { db, queue } = setup(async (url, init) => {
      if (!online) throw new TypeError('fetch failed');
      calls.push({ url, key: new Headers(init.headers).get('Idempotency-Key') });
      return json(200, { status: 'success', data: {} });
    });
    const a = await queue.submit('u1', input('1'));
    const b = await queue.submit('u1', input('2'));
    expect(a.queued && b.queued).toBe(true);
    expect(queue.pendingCount('u1')).toBe(2);
    expect(JSON.stringify(db.all('SELECT payload FROM offline_mutations'))).not.toContain('status');
    online = true;
    const r = await queue.replay('u1');
    expect(r).toMatchObject({ done: 2, conflicts: 0, failed: 0, remaining: 0 });
    expect(calls.map((c) => c.url)).toEqual(['https://ws.example/api/tasks/1', 'https://ws.example/api/tasks/2']);
    expect(calls.every((c) => c.key && c.key.length > 10)).toBe(true);
  });

  it('surfaces a conflict and holds later changes to the same record', async () => {
    let online = false;
    const { queue } = setup(async (url) => {
      if (!online) throw new TypeError('fetch failed');
      return url.endsWith('/1') ? json(409, { status: 'error', message: 'Changed on the server' }) : json(200, { status: 'success' });
    });
    await queue.submit('u1', input('1'));
    await queue.submit('u1', input('1', 'todo'));
    await queue.submit('u1', input('2'));
    online = true;
    const r = await queue.replay('u1');
    expect(r.conflicts).toBe(1);
    expect(r.done).toBe(1);
    const list = queue.list('u1');
    expect(list.map((m) => m.state)).toEqual(['CONFLICT', 'PENDING']);
  });

  it('shows a queued change and the server’s refusal, and edits one still waiting (a module’s outbox: Support D-09)', async () => {
    let online = false;
    const sent: unknown[] = [];
    const { queue } = setup(async (url, init) => {
      if (!online) throw new TypeError('fetch failed');
      sent.push(JSON.parse(String(init.body)));
      return url.endsWith('/1') ? json(409, { status: 'error', message: 'Changed', code: 'VERSION_CONFLICT', errors: { ticket: { id: 1, version: 15 } } }) : json(200, { status: 'success' });
    });
    const a = await queue.submit('u1', input('1'));
    const b = await queue.submit('u1', input('2'));
    expect(queue.detail('u1', b.id!)).toEqual({ body: { field: 'status', value: 'done' }, response: null });
    expect(queue.detail('u2', b.id!)).toBeNull();
    queue.edit('u1', b.id!, { field: 'status', value: 'todo' });
    expect(() => queue.edit('u2', b.id!, {})).toThrow();
    online = true;
    await queue.replay('u1');
    expect(sent).toEqual([{ field: 'status', value: 'done' }, { field: 'status', value: 'todo' }]);
    expect(queue.detail('u1', a.id!)!.response).toMatchObject({ code: 'VERSION_CONFLICT', errors: { ticket: { version: 15 } } });
    // A change that has gone (or is refused) is no longer edited.
    expect(() => queue.edit('u1', a.id!, {})).toThrow();
  });

  it('keeps order: a server error stops the replay rather than letting later changes overtake', async () => {
    let online = false;
    const { queue } = setup(async (url) => {
      if (!online) throw new TypeError('fetch failed');
      return url.endsWith('/1') ? json(503, { status: 'error', message: 'busy' }) : json(200, { status: 'success' });
    });
    await queue.submit('u1', input('1'));
    await queue.submit('u1', input('2'));
    online = true;
    const r = await queue.replay('u1');
    expect(r.done).toBe(0);
    expect(queue.pendingCount('u1')).toBe(2);
  });

  it('refuses to queue on a device limited to drafts (§11.3)', async () => {
    const { queue } = setup(async () => {
      throw new TypeError('fetch failed');
    }, 'drafts_only');
    const r = await queue.submit('u1', input('1'));
    expect(r).toMatchObject({ delivered: false, queued: false, code: 'POLICY_DENIED' });
  });

  it('keeps drafts encrypted, per user', () => {
    const { db, queue } = setup(async () => json(200, {}));
    queue.saveDraft('u1', 'mail', 'compose:new', { to: 'a@b.c', body: 'confidential' });
    expect(queue.getDraft('u1', 'mail', 'compose:new')?.content).toEqual({ to: 'a@b.c', body: 'confidential' });
    expect(queue.getDraft('u2', 'mail', 'compose:new')).toBeNull();
    expect(JSON.stringify(db.all('SELECT content FROM drafts'))).not.toContain('confidential');
  });
});

describe('zip writer (WF-29)', () => {
  it('writes entries a standard reader can inflate', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'logs/b.log', data: Buffer.from('world'.repeat(100)) }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const nameLen = zip.readUInt16LE(26);
    const size = zip.readUInt32LE(18);
    const data = inflateRawSync(zip.subarray(30 + nameLen, 30 + nameLen + size));
    expect(data.toString()).toBe('hello');
    expect(zip.readUInt32LE(14)).toBe(crc32(Buffer.from('hello')) >>> 0);
    const end = zip.subarray(zip.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(10)).toBe(2);
  });
});

describe('upload part size', () => {
  it('sends small files in several parts so their progress moves, and large ones in 8 MB parts', async () => {
    const { chunkSizeFor } = await import('../../../electron/services/transfers');
    expect(chunkSizeFor(0)).toBe(256 * 1024);
    expect(chunkSizeFor(2 * 1024 * 1024)).toBe(256 * 1024);
    // Over 8 MB: full 8 MB parts, several at a time (worksuite-desktop#249).
    expect(chunkSizeFor(20 * 1024 * 1024)).toBe(8 * 1024 * 1024);
    expect(chunkSizeFor(5 * 1024 * 1024)).toBe(256 * 1024);
    expect(chunkSizeFor(2 * 1024 * 1024 * 1024)).toBe(8 * 1024 * 1024);
    expect(Math.ceil((5 * 1024 * 1024) / chunkSizeFor(5 * 1024 * 1024))).toBe(20);
  });
});
