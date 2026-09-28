import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { SalonDesk } from '../../../electron/services/salon-desk';
import { createApiProxy, isProxyPathAllowed } from '../../../electron/services/api-proxy';
import { HttpClient } from '../../../electron/services/http';
import { OfflineCache } from '../../../electron/services/offline-cache';
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';

/* The OS credential store, as a map. */
function secrets() {
  const m = new Map<string, string>();
  return {
    m,
    get: (k: string) => m.get(k) ?? null,
    set: (k: string, v: string) => void m.set(k, v),
    delete: (k: string) => void m.delete(k),
    deletePrefix: (p: string) => {
      let n = 0;
      for (const k of [...m.keys()]) if (k.startsWith(p) && m.delete(k)) n++;
      return n;
    },
  };
}

const desk = { id: 12, org_id: 17, location_id: 16, location: 'Colombo 05', name: 'Front desk', status: 'active', device_id: 'desktop-abc', register: null, approved_at: null, revoked_at: null };

describe('salon desk: the key stays in the main process', () => {
  it('keeps the key the server hands over, and gives back only the desk', async () => {
    const s = secrets();
    const request = vi.fn(async () => ({ desk, key: 'k'.repeat(43) }));
    const d = new SalonDesk(s, { request } as never, () => 'https://ws.example');

    const r = await d.pair({ location_id: 16, name: 'Front desk' }, 'desktop-abc', '0.2.41');

    expect(request).toHaveBeenCalledWith('POST', '/api/salon/v1/desk/pair', {
      body: { location_id: 16, name: 'Front desk', device_id: 'desktop-abc', pos_register_id: null, app_version: 'desktop 0.2.41' },
    });
    expect(r).toEqual({ desk, message: 'Front desk is paired.' });
    expect(JSON.stringify(r)).not.toContain('kkkk');
    expect(d.pairing()).toEqual({ desk_id: 12, name: 'Front desk' });
    expect(JSON.stringify(d.pairing())).not.toContain('kkkk');
  });

  it('says a desk that waits for approval is waiting', async () => {
    const d = new SalonDesk(secrets(), { request: async () => ({ desk: { ...desk, status: 'requested' }, key: 'x'.repeat(43) }) } as never, () => 'https://ws.example');

    expect((await d.pair({ location_id: 16, name: 'Front desk' }, 'desktop-abc', '0.2.41')).message).toBe('Front desk is waiting for an owner to approve it.');
  });

  it('hands the key only to SalonMate’s own API', async () => {
    const d = new SalonDesk(secrets(), { request: async () => ({ desk, key: 'the-key' }) } as never, () => 'https://ws.example');
    await d.pair({ location_id: 16, name: 'Front desk' }, 'desktop-abc', '0.2.41');

    expect(d.keyFor('/api/salon/v1/desk/bootstrap?desk=12')).toBe('the-key');
    expect(d.keyFor('/api/salon/v1/visits/5/payments')).toBe('the-key');
    expect(d.keyFor('/api/tasks')).toBeNull();
    expect(d.keyFor('/api/salonx/v1/anything')).toBeNull();
  });

  it('files the desk under the server it came from', async () => {
    let origin = 'https://ws.example';
    const d = new SalonDesk(secrets(), { request: async () => ({ desk, key: 'the-key' }) } as never, () => origin);
    await d.pair({ location_id: 16, name: 'Front desk' }, 'desktop-abc', '0.2.41');

    origin = 'https://other.example';
    expect(d.pairing()).toBeNull();
    expect(d.keyFor('/api/salon/v1/today')).toBeNull();
  });

  it('refuses a pairing the server answered without a key, and keeps nothing', async () => {
    const s = secrets();
    const d = new SalonDesk(s, { request: async () => ({ desk }) } as never, () => 'https://ws.example');

    await expect(d.pair({ location_id: 16, name: 'Front desk' }, 'desktop-abc', '0.2.41')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(s.m.size).toBe(0);
  });

  it('forgets this server’s desk, or every desk on a wipe', async () => {
    const s = secrets();
    let origin = 'https://ws.example';
    const d = new SalonDesk(s, { request: async () => ({ desk, key: 'the-key' }) } as never, () => origin);
    await d.pair({ location_id: 16, name: 'Front desk' }, 'desktop-abc', '0.2.41');
    origin = 'https://other.example';
    await d.pair({ location_id: 16, name: 'Front desk' }, 'desktop-abc', '0.2.41');
    s.set('refresh-token', 'r');

    d.forget();
    expect(d.pairing()).toBeNull();
    origin = 'https://ws.example';
    expect(d.pairing()).not.toBeNull();

    expect(d.forgetAll()).toBe(1);
    expect(d.pairing()).toBeNull();
    expect(s.get('refresh-token')).toBe('r');
  });
});

describe('API proxy and the salon desk key', () => {
  it('refuses pairing through the proxy, where the key would reach the renderer', () => {
    expect(isProxyPathAllowed('/api/salon/v1/desk/pair', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/salon/v1/desk/pair?x=1', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/salon/v1/desk/bootstrap?desk=12')).toBe(true);
    expect(isProxyPathAllowed('/api/salon/v1/desks')).toBe(true);
  });

  it('adds the key the main process holds, and never one the renderer sent', async () => {
    const seen: Array<string | null> = [];
    const http = new HttpClient({
      fetch: async (_url, init) => {
        seen.push(new Headers(init?.headers).get('x-salon-desk-key'));
        return new Response(JSON.stringify({ status: 'success', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      origin: () => 'https://ws.example',
      tokens: { accessToken: () => 't', refresh: async () => 'ok' },
      clientHeaders: () => ({}),
      onReachability: () => undefined,
      onAuthLost: () => undefined,
    });
    const cache = new OfflineCache(new Database(':memory:'), () => new Vault(Vault.generateKey()));
    const proxy = createApiProxy({
      http, cache, userId: () => 'u1', cacheModuleFor: () => null, cacheLimits: () => ({ enabled: false, maxBytes: 0 }), mailBodiesCached: () => true,
      extraHeaders: (p) => (p.startsWith('/api/salon/v1/') ? { 'X-Salon-Desk-Key': 'from-main' } : null),
    });
    const forged = { 'X-Salon-Desk-Key': 'from-renderer' };

    await proxy(new Request('app://bundle/__api/api/salon/v1/desk/bootstrap?desk=12', { headers: forged }), '/api/salon/v1/desk/bootstrap?desk=12');
    await proxy(new Request('app://bundle/__api/api/tasks', { headers: forged }), '/api/tasks');

    expect(seen).toEqual(['from-main', null]);
  });
});
