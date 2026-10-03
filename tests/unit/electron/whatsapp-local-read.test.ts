import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { OfflineCache } from '../../../electron/services/offline-cache';
import { createApiProxy } from '../../../electron/services/api-proxy';
import type { HttpClient } from '../../../electron/services/http';

function fixture() {
  const db = new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  const cache = new OfflineCache(db, () => vault);
  const raw = vi.fn(async () => new Response(JSON.stringify({ data: { messages: [{ id: 1, body: 'private message' }] } }), { headers: { 'Content-Type': 'application/json' } }));
  let user = 'u1'; let scope = 'https://one.test:org1'; let enabled = true; let allowed = true;
  const proxy = createApiProxy({ http: { raw, url: (p: string) => `https://one.test${p}` } as unknown as HttpClient, cache, userId: () => user, cacheScope: () => scope, cacheModuleFor: () => allowed ? 'chat' : null, cacheLimits: () => ({ enabled, maxBytes: 1024 * 1024 }), mailBodiesCached: () => false });
  const path = '/api/whatsapp/chats/7';
  const read = (local = false) => proxy(new Request(`https://app.test${path}`, { headers: local ? { 'X-WS-Local-Read': '1' } : {} }), path);
  return { db, cache, raw, read, setUser: (v: string) => { user = v; }, setScope: (v: string) => { scope = v; }, disable: () => { enabled = false; }, revoke: () => { allowed = false; } };
}
describe('encrypted local-first WhatsApp reads (#158)', () => {
  it('serves a saved conversation without waiting for the network and stores ciphertext', async () => {
    const f = fixture(); await f.read(); f.raw.mockClear();
    const response = await f.read(true);
    expect(response.status).toBe(200); expect(response.headers.get('X-WS-Offline')).toBe('1');
    expect(await response.text()).toContain('private message'); expect(f.raw).not.toHaveBeenCalled();
    const row = f.db.get<{ payload: string }>('SELECT payload FROM cached_records');
    expect(row?.payload).not.toContain('private message');
  });
  it('does not cross users, servers or organisations', async () => {
    const f = fixture(); await f.read();
    f.setUser('u2'); expect((await f.read(true)).status).toBe(404);
    f.setUser('u1'); f.setScope('https://two.test:org1'); expect((await f.read(true)).status).toBe(404);
    f.setScope('https://one.test:org2'); expect((await f.read(true)).status).toBe(404);
  });
  it('honours cache policy and module access', async () => {
    const f = fixture(); await f.read(); f.disable(); expect((await f.read(true)).status).toBe(404);
    const g = fixture(); await g.read(); g.revoke(); expect((await g.read(true)).status).toBe(404);
  });
  it('purges refused reads and clears stored data on sign-out', async () => {
    const f = fixture(); await f.read();
    f.raw.mockImplementationOnce(async () => new Response('{}', { status: 403 }));
    expect((await f.read()).status).toBe(403); expect((await f.read(true)).status).toBe(404);
    await f.read(); f.cache.clearUser('u1'); expect((await f.read(true)).status).toBe(404);
  });
});
