import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RealtimeService } from '../../../electron/services/realtime';
import type { HttpClient } from '../../../electron/services/http';
const ticket = { ticket: 'fixture', enabled: true, url: 'wss://example.com/realtime' };
class Socket {
  static sockets: Socket[] = [];
  onmessage?: (m: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() { Socket.sockets.push(this); }
  frame(type: string) { this.onmessage?.({ data: JSON.stringify({ type }) }); }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const services: RealtimeService[] = [];
function service(get = vi.fn(async () => ticket)) {
  const rt = new RealtimeService({ get } as unknown as HttpClient, () => 'https://example.com', false, Socket as unknown as new (url: string) => WebSocket);
  services.push(rt); return rt;
}
beforeEach(() => { vi.useFakeTimers(); Socket.sockets = []; });
afterEach(() => { services.splice(0).forEach(rt => rt.stop()); vi.useRealTimers(); });
it('coalesces starts and network kicks while a ticket or socket handshake is pending', async () => {
  let resolve!: (value: typeof ticket) => void;
  const get = vi.fn(() => new Promise<typeof ticket>(r => { resolve = r; })); const rt = service(get);
  rt.start(); rt.kick(); rt.kick(); expect(get).toHaveBeenCalledTimes(1);
  resolve(ticket); await flush(); rt.kick(); expect(Socket.sockets).toHaveLength(1);
  expect(rt.getState()).toBe('connecting'); Socket.sockets[0]!.frame('ready'); expect(rt.getState()).toBe('connected');
});
it('discards tickets from a previous stop/start and does not let their finally clear the new attempt', async () => {
  const resolvers: Array<(value: typeof ticket) => void> = [];
  const get = vi.fn(() => new Promise<typeof ticket>(r => resolvers.push(r))); const rt = service(get);
  rt.start(); rt.stop(); rt.start(); resolvers[0]!(ticket); await flush(); rt.kick();
  expect(get).toHaveBeenCalledTimes(2); expect(Socket.sockets).toHaveLength(0);
  resolvers[1]!(ticket); await flush(); expect(Socket.sockets).toHaveLength(1);
});
it('ignores replaced sockets and emits one catch-up for duplicate ready frames', async () => {
  const rt = service(); const event = vi.fn(); const resync = vi.fn(); rt.onEvent = event; rt.onResync = resync;
  rt.start(); await flush(); const old = Socket.sockets[0]!; old.frame('ready');
  vi.setSystemTime(Date.now() + 40_000); rt.kick(); await flush();
  old.frame('chat.message'); old.frame('ready'); expect(event).not.toHaveBeenCalled();
  const current = Socket.sockets[1]!; current.frame('ready'); current.frame('ready'); expect(resync).toHaveBeenCalledTimes(1);
});
it('keeps quiet connections healthy through application heartbeats for multiple watchdog periods', async () => {
  const rt = service(); rt.start(); await flush(); const ws = Socket.sockets[0]!; ws.frame('ready');
  for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(30_000); ws.frame('ping'); }
  expect(ws.close).not.toHaveBeenCalled(); expect(rt.getState()).toBe('connected');
});
it('recovers a handshake that never becomes authenticated, even if close emits no event', async () => {
  const rt = service(); rt.start(); await flush(); const ws = Socket.sockets[0]!;
  await vi.advanceTimersByTimeAsync(30_000); expect(ws.close).toHaveBeenCalled(); expect(rt.getState()).toBe('down');
  await vi.advanceTimersByTimeAsync(2000); expect(Socket.sockets).toHaveLength(2);
});
it('recovers socket errors once and ignores events before authentication', async () => {
  const rt = service(); const event = vi.fn(); rt.onEvent = event; rt.start(); await flush(); const ws = Socket.sockets[0]!;
  ws.frame('chat.message'); expect(event).not.toHaveBeenCalled(); ws.onerror?.(); ws.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(2000); expect(Socket.sockets).toHaveLength(2);
});
