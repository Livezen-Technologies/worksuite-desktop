import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));
import { CLIENT_TYPE, CLIENT_TYPE_HEADER, HttpClient, type FetchLike } from '../../../electron/services/http';

/**
 * Every request to the WorkSuite server names its client type (`X-WorkSuite-Client: desktop`): the server picks the
 * chat service's scope — poll intervals, realtime transport — per client type from it.
 */
function client(clientHeaders: () => Record<string, string> = () => ({})) {
  const seen: Headers[] = [];
  const fetch: FetchLike = async (_url, init) => {
    seen.push(new Headers(init.headers));
    return new Response(JSON.stringify({ status: 'success', data: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const http = new HttpClient({
    fetch,
    origin: () => 'https://ws.test',
    tokens: { accessToken: () => 'tok', refresh: async () => 'ok' },
    clientHeaders,
    onReachability: () => undefined,
    onAuthLost: () => undefined,
  });
  return { http, seen };
}

describe('X-WorkSuite-Client', () => {
  it('is "desktop"', () => {
    expect(CLIENT_TYPE_HEADER).toBe('X-WorkSuite-Client');
    expect(CLIENT_TYPE).toBe('desktop');
  });

  it('goes with every request: JSON, raw, unauthenticated, and alongside the other client headers', async () => {
    const { http, seen } = client(() => ({ 'X-WS-Client': 'worksuite-desktop/0.1.0 (macos; arm64)' }));
    await http.get('/api/chat/rooms');
    await http.post('/api/chat/rooms/1/messages', { body: 'hi' });
    await http.raw('GET', 'https://ws.test/realtime?stream=x', { auth: false, headers: { Accept: 'text/event-stream' } });
    expect(seen).toHaveLength(3);
    for (const h of seen) {
      expect(h.get('X-WorkSuite-Client')).toBe('desktop');
      expect(h.get('X-WS-Client')).toBe('worksuite-desktop/0.1.0 (macos; arm64)');
    }
    expect(seen[2]!.get('Authorization')).toBeNull();
  });

  it('cannot be overridden by a caller', async () => {
    const { http, seen } = client(() => ({ 'X-WorkSuite-Client': 'web' }));
    await http.get('/api/x', { headers: { 'X-WorkSuite-Client': 'widget' } });
    expect(seen[0]!.get('X-WorkSuite-Client')).toBe('desktop');
  });
});
