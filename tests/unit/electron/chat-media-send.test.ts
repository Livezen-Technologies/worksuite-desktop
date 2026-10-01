import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferencesPatchSchema, contract } from '../../../shared/ipc/contract';

const native = vi.hoisted(() => ({ dir: '', thumbnail: vi.fn(), jpeg: vi.fn(), png: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => native.dir, getVersion: () => '0.1.0' }, safeStorage: {}, shell: { openPath: vi.fn(), showItemInFolder: vi.fn() }, nativeImage: { createThumbnailFromPath: native.thumbnail } }));
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { TransferManager } from '../../../electron/services/transfers';
import { DesktopError } from '../../../electron/main/errors';

let dir: string;
const managers: TransferManager[] = [];
beforeEach(() => {
  native.dir = dir = mkdtempSync(join(tmpdir(), 'ws-chat-send-'));
  native.jpeg.mockReset().mockReturnValue(Buffer.alloc(100)); native.png.mockReset().mockReturnValue(Buffer.alloc(120));
  native.thumbnail.mockReset().mockResolvedValue({ isEmpty: () => false, resize: () => ({ toDataURL: () => 'data:image/png;base64,eA==' }), toJPEG: native.jpeg, toPNG: native.png });
});
afterEach(() => { managers.splice(0).forEach((m) => m.stopAll()); rmSync(dir, { recursive: true, force: true }); });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function manager(over: Record<string, unknown> = {}) {
  const db = new Database(':memory:'); const vault = new Vault(Vault.generateKey());
  const http = { url: (p: string) => `https://ws.example${p}`, raw: vi.fn(async () => new Response('{}', { status: 200 })), get: vi.fn(async () => ({ received_chunks: [0] })), post: vi.fn(async (path: string) => path.endsWith('/init') ? { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 } : { file_id: 1 }) };
  const m = new TransferManager({ db, vault: () => vault, http: http as never, userId: () => 'u1', downloadFolder: () => dir, hash: async () => ({ sha256: 'abc', bytes: 1000 }), canOpenFiles: () => true, audit: () => undefined, retryDelay: () => 5, ...over });
  managers.push(m); return { m, http, db, vault };
}
async function pick(m: TransferManager, name: string) {
  const file = join(dir, name); writeFileSync(file, Buffer.alloc(1000)); return (await m.register([file]))[0]!;
}

describe('durable chat media sending (#83)', () => {
  it('validates bounded binary media and forbids renderer paths', () => {
    const schema = contract['transfers:prepareMedia'].input;
    expect(schema.safeParse({ name: 'voice.webm', data: new Uint8Array([1]), originalQuality: true }).success).toBe(true);
    for (const input of [{ name: '../secret', data: new Uint8Array([1]), originalQuality: true }, { name: 'x', path: '/etc/passwd', originalQuality: true }, { name: 'x', data: new Uint8Array(), originalQuality: true }]) expect(schema.safeParse(input).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ theme: 'dark' }).success).toBe(true);
  });
  it('optimizes photos asynchronously, keeps Original Quality, preserves PNG transparency and animated GIFs', async () => {
    const { m } = manager();
    const photo = await pick(m, 'photo.jpg');
    const compressed = await m.prepareMedia({ handle: photo.handle, name: photo.name, originalQuality: false });
    expect(compressed.size).toBe(100); expect(compressed.preview).toContain('data:image');
    expect(native.jpeg).toHaveBeenCalledWith(82);
    const original = await pick(m, 'original.jpg');
    expect((await m.prepareMedia({ handle: original.handle, name: original.name, originalQuality: true })).handle).toBe(original.handle);
    const png = await pick(m, 'transparent.png'); await m.prepareMedia({ handle: png.handle, name: png.name, originalQuality: false });
    expect(native.png).toHaveBeenCalled();
    const gif = await pick(m, 'animation.gif');
    expect((await m.prepareMedia({ handle: gif.handle, name: gif.name, originalQuality: false })).handle).toBe(gif.handle);
    native.thumbnail.mockRejectedValueOnce(new Error('thumbnail failed'));
    const fallback = await pick(m, 'fallback.jpg');
    expect((await m.prepareMedia({ handle: fallback.handle, name: fallback.name, originalQuality: false })).handle).toBe(fallback.handle);
  });
  it('keeps voice bytes durable and reports Sent only after the attachment POST confirms', async () => {
    const { m, http, db, vault } = manager();
    const done = deferred<{ file_id: number }>(); const posted = deferred<{ message_id: number }>();
    http.post.mockImplementation(async (path: string) => path.endsWith('/init') ? { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 } : path.endsWith('/complete') ? done.promise : posted.promise as never);
    const file = await m.prepareMedia({ data: new Uint8Array([1, 2, 3]), name: 'voice.webm', originalQuality: true });
    const [t] = await m.upload([file.handle], { kind: 'chat', roomId: '12', clientMessageId: 'desktop-voice1', voice: true, durationMs: 2500 });
    await vi.waitFor(() => expect(m.list()[0]!.phase).toBe('processing'));
    expect(m.list()[0]!.state).toBe('running');
    done.resolve({ file_id: 9 });
    await vi.waitFor(() => expect(m.list()[0]!.phase).toBe('sending'));
    expect(m.list()[0]!.state).not.toBe('done');
    expect(http.post).toHaveBeenCalledWith('/api/chat/messages/attachments', expect.objectContaining({ client_message_id: 'desktop-voice1', voice: true, duration_ms: 2500 }));
    posted.resolve({ message_id: 20 });
    await vi.waitFor(() => expect(m.list()[0]!.state).toBe('done'));
    expect(m.list()[0]!.chat).toEqual(expect.objectContaining({ roomId: '12', clientMessageId: 'desktop-voice1', voice: true }));
    const restored = manager({ db, vault: () => vault }).m;
    expect(restored.list().find((x) => x.id === t!.id)?.chat?.clientMessageId).toBe('desktop-voice1');
    expect((await m.upload([file.handle], { kind: 'chat', roomId: '12', clientMessageId: 'desktop-voice1' }))[0]!.id).toBe(t!.id);
  });
  it('uploads concurrently but posts attachments in selection order on a slow first file', async () => {
    const first = deferred<{ sha256: string; bytes: number }>();
    const { m, http } = manager({ hash: async (path: string) => path.endsWith('large.mp4') ? first.promise : { sha256: 'small', bytes: 1000 } });
    const a = await pick(m, 'large.mp4'), b = await pick(m, 'small.pdf');
    await m.upload([a.handle], { kind: 'chat', roomId: '12', clientMessageId: 'desktop-first' });
    await m.upload([b.handle], { kind: 'chat', roomId: '12', clientMessageId: 'desktop-second' });
    await vi.waitFor(() => expect(m.list().some((t) => t.name === 'small.pdf' && t.phase === 'waiting')).toBe(true));
    expect(http.post.mock.calls.filter(([path]) => path === '/api/chat/messages/attachments')).toHaveLength(0);
    first.resolve({ sha256: 'large', bytes: 1000 });
    await vi.waitFor(() => expect(m.list().every((t) => t.state === 'done')).toBe(true));
    const calls = http.post.mock.calls as unknown as Array<[string, { client_message_id?: string }]>;
    expect(calls.filter(([path]) => path === '/api/chat/messages/attachments').map(([, body]) => body.client_message_id)).toEqual(['desktop-first', 'desktop-second']);
  });
  it('resumes after a lost server confirmation with the same message id and no duplicate chunks', async () => {
    const { m, http } = manager();
    let fail = true;
    http.post.mockImplementation(async (path: string) => {
      if (path.endsWith('/init')) return { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 };
      if (path === '/api/chat/messages/attachments' && fail) { fail = false; throw new DesktopError('NETWORK_UNREACHABLE', 'Connection lost'); }
      return { file_id: 9 };
    });
    const file = await pick(m, 'video.mp4');
    await m.upload([file.handle], { kind: 'chat', roomId: '12', clientMessageId: 'desktop-retry' });
    await vi.waitFor(() => expect(m.list()[0]!.state).toBe('done'));
    expect(http.raw).toHaveBeenCalledTimes(1);
    const calls = http.post.mock.calls as unknown as Array<[string, { client_message_id?: string }]>;
    expect(calls.filter(([p]) => p === '/api/chat/messages/attachments').map(([, b]) => b.client_message_id)).toEqual(['desktop-retry', 'desktop-retry']);
  });
  it('streams local video previews by a picked capability with byte ranges and refuses other users', async () => {
    let uid = 'u1'; const { m } = manager({ userId: () => uid });
    const video = await pick(m, 'preview.mp4');
    const result = await m.prepareMedia({ handle: video.handle, name: video.name, originalQuality: true });
    expect(result.mime).toBe('video/mp4');
    const path = new URL(result.preview!).pathname.replace('/__local', '');
    const response = await m.serveMediaPreview(new Request(result.preview!, { headers: { Range: 'bytes=10-19' } }), path);
    expect(response.status).toBe(206); expect(response.headers.get('Content-Range')).toBe('bytes 10-19/1000');
    expect((await response.arrayBuffer()).byteLength).toBe(10);
    expect((await m.serveMediaPreview(new Request(result.preview!, { headers: { Range: 'bytes=2000-' } }), path)).status).toBe(416);
    uid = 'u2'; expect((await m.serveMediaPreview(new Request(result.preview!), path)).status).toBe(404);
    expect((await m.serveMediaPreview(new Request(result.preview!), '/chat-media/../../etc/passwd')).status).toBe(404);
  });
  it('resumes a real multi-chunk large file from the received chunks after connection loss', async () => {
    const { m, http } = manager();
    const file = join(dir, 'large-video.mp4'); writeFileSync(file, Buffer.alloc(6 * 1024 * 1024));
    const picked = (await m.register([file]))[0]!; let chunks = 0;
    http.post.mockImplementation(async (path: string) => path.endsWith('/init') ? { upload_id: 'large1', chunk_size: 5 * 1024 * 1024, total_chunks: 2 } : { file_id: 9 });
    http.raw.mockImplementation(async (...args: unknown[]) => {
      if (++chunks === 2) return new Promise<Response>((_, reject) => {
        (args[2] as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new DesktopError('NETWORK_UNREACHABLE', 'Connection lost')), { once: true });
      });
      return new Response('{}');
    });
    // Watch chunks; the first is acknowledged by the server, so the reconnect sends only the second.
    http.get.mockResolvedValue({ received_chunks: [0] });
    const [t] = await m.upload([picked.handle], { kind: 'chat', roomId: '12', clientMessageId: 'desktop-large' });
    await vi.waitFor(() => expect(http.raw).toHaveBeenCalledTimes(2));
    m.setOnline(false);
    m.pause(t!.id);
    m.resume(t!.id);
    m.setOnline(true);
    await vi.waitFor(() => expect(m.list().find((x) => x.id === t!.id)?.state).toBe('done'), { timeout: 3000 });
    expect(http.raw).toHaveBeenCalledTimes(3);
    expect(http.post.mock.calls.filter(([path]) => path.endsWith('/init'))).toHaveLength(1);
    expect(m.list()[0]!.total).toBe(6 * 1024 * 1024);
  });

});
