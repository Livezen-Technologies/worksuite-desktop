import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => native.dir, getVersion: () => '0.1.0' }, safeStorage: {}, shell: { openPath: vi.fn(), showItemInFolder: vi.fn() }, nativeImage: {} }));
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { TransferManager, chunkSizeFor } from '../../../electron/services/transfers';
import { DesktopError } from '../../../electron/main/errors';
import { CHAT_RETRY_MS, VOICE_CHUNK_BYTES, VOICE_CHUNKED_FROM } from '../../../shared/uploads';

/**
 * worksuite-desktop#300 — voice messages that go fast and never get lost: small parts above 1 MB, the chat retry
 * schedule (2 s, 5 s, 15 s, 30 s, 60 s, then Retry / Cancel), the upload resumed by the message's id, Cancel throwing
 * the recording away, and a recording that did not go kept — and tried again — across a restart.
 */

let dir: string;
const managers: TransferManager[] = [];
beforeEach(() => {
  native.dir = dir = mkdtempSync(join(tmpdir(), 'ws-voice-300-'));
});
afterEach(() => {
  managers.splice(0).forEach((m) => m.stopAll());
  rmSync(dir, { recursive: true, force: true });
});

type Post = (path: string, body?: Record<string, unknown>) => Promise<unknown>;
function manager(over: Record<string, unknown> = {}, post?: Post) {
  const db = (over.db as Database | undefined) ?? new Database(':memory:');
  const vault = (over.vaultKey as Vault | undefined) ?? new Vault(Vault.generateKey());
  const http = {
    url: (p: string) => `https://ws.example${p}`,
    raw: vi.fn(async () => new Response('{}', { status: 200 })),
    get: vi.fn(async () => ({ received_chunks: [] as number[] })),
    post: vi.fn(post ?? (async (path: string) => (path.endsWith('/init') ? { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 } : { file_id: 1 }))),
  };
  const m = new TransferManager({ db, vault: () => vault, http: http as never, userId: () => 'u1', downloadFolder: () => dir, hash: async () => ({ sha256: 'abc', bytes: 1000 }), canOpenFiles: () => true, audit: () => undefined, retryDelay: () => 5, ...over });
  managers.push(m);
  return { m, http, db, vault };
}
const voice = (id: string) => ({ kind: 'chat' as const, roomId: '12', clientMessageId: id, voice: true, durationMs: 4000 });
const posts = (http: { post: { mock: { calls: unknown[][] } } }, path: string) => (http.post.mock.calls as Array<[string, Record<string, unknown>]>).filter(([p]) => p === path || p.endsWith(path));

describe('voice message parts (#300)', () => {
  it('sends a recording of 1 MB or less in one part, and a larger one in 512 KB parts', () => {
    const v = voice('desktop-a');
    expect(chunkSizeFor(30_000, v)).toBe(256 * 1024);
    expect(chunkSizeFor(VOICE_CHUNKED_FROM, v)).toBe(VOICE_CHUNKED_FROM);
    expect(chunkSizeFor(VOICE_CHUNKED_FROM + 1, v)).toBe(VOICE_CHUNK_BYTES);
    // Any other file is cut as before.
    expect(chunkSizeFor(VOICE_CHUNKED_FROM + 1, { kind: 'chat', roomId: '12' })).toBe(chunkSizeFor(VOICE_CHUNKED_FROM + 1));
  });

  it('asks for the upload by the message id, and carries on with the parts the server already has', async () => {
    const { m, http } = manager({}, async (path) => (path.endsWith('/init') ? { upload_id: 'up9', chunk_size: VOICE_CHUNK_BYTES, total_chunks: 3, received_chunks: [0, 1] } : { file_id: 4 }));
    const file = await m.prepareMedia({ data: new Uint8Array(VOICE_CHUNKED_FROM + 200_000), name: 'Voice message.webm', originalQuality: true });
    await m.upload([file.handle], voice('desktop-resume1'));
    await vi.waitFor(() => expect(m.list()[0]!.state).toBe('done'));
    const [, init] = posts(http, '/api/uploads/init')[0]!;
    expect(init).toMatchObject({ client_key: 'desktop-resume1', chunk_size: VOICE_CHUNK_BYTES });
    // Only the third part goes.
    expect(http.raw).toHaveBeenCalledTimes(1);
    expect(posts(http, '/api/chat/messages/attachments')).toHaveLength(1);
  });

  it('posts at once when the server says the upload it already has is finished', async () => {
    const { m, http } = manager({}, async (path) => (path.endsWith('/init') ? { upload_id: 'up9', chunk_size: 256 * 1024, total_chunks: 1, status: 'completed', file_id: 77 } : { message_id: 5 }));
    const file = await m.prepareMedia({ data: new Uint8Array(4000), name: 'Voice message.webm', originalQuality: true });
    await m.upload([file.handle], voice('desktop-done1'));
    await vi.waitFor(() => expect(m.list()[0]!.state).toBe('done'));
    expect(http.raw).not.toHaveBeenCalled();
    expect(posts(http, '/complete')).toHaveLength(0);
    expect(posts(http, '/api/chat/messages/attachments')[0]![1]).toMatchObject({ upload_id: 'up9', client_message_id: 'desktop-done1', voice: true });
  });
});

describe('retrying a voice message (#300)', () => {
  it('waits 2 s after the first temporary failure', async () => {
    const { m } = manager({ retryDelay: undefined }, async (path) => {
      if (path.endsWith('/init')) return { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 };
      if (path === '/api/chat/messages/attachments') throw new DesktopError('SERVER_ERROR', 'Busy', 503);
      return { file_id: 1 };
    });
    const file = await m.prepareMedia({ data: new Uint8Array(4000), name: 'Voice message.webm', originalQuality: true });
    const before = Date.now();
    await m.upload([file.handle], voice('desktop-wait1'));
    await vi.waitFor(() => expect(m.list()[0]!.retryAt).toBeTruthy());
    const wait = Date.parse(m.list()[0]!.retryAt!) - before;
    expect(wait).toBeGreaterThanOrEqual(CHAT_RETRY_MS[0] - 50);
    expect(wait).toBeLessThan(CHAT_RETRY_MS[1]);
    expect(m.list()[0]!.state).toBe('queued');
    expect(CHAT_RETRY_MS).toEqual([2000, 5000, 15000, 30000, 60000]);
  });

  it('tries five times by itself, even while the connection is gone, then stops for Retry or Cancel', async () => {
    const { m, http } = manager({}, async (path) => {
      if (path.endsWith('/init')) return { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 };
      if (path === '/api/chat/messages/attachments') throw new DesktopError('NETWORK_UNREACHABLE', 'Connection lost');
      return { file_id: 1 };
    });
    const file = await m.prepareMedia({ data: new Uint8Array(4000), name: 'Voice message.webm', originalQuality: true });
    await m.upload([file.handle], voice('desktop-five'));
    await vi.waitFor(() => expect(m.list()[0]!.state).toBe('failed'));
    // The first try and five more, all with the same message id.
    const tried = posts(http, '/api/chat/messages/attachments');
    expect(tried).toHaveLength(1 + CHAT_RETRY_MS.length);
    expect(new Set(tried.map(([, b]) => b.client_message_id))).toEqual(new Set(['desktop-five']));
  });
});

describe('cancel, keep and start again (#300)', () => {
  it('Cancel stops it, tells the server to throw the parts away, and deletes the recording here', async () => {
    const { m, http } = manager({}, async (path) => (path.endsWith('/init') ? { upload_id: 'up-c', chunk_size: 256 * 1024, total_chunks: 1 } : { file_id: 1 }));
    // The part never arrives: the upload is on its way when Cancel is pressed.
    http.raw.mockImplementation((...args: unknown[]) => new Promise<Response>((_, reject) => {
      (args[2] as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new DesktopError('CANCELLED', 'Cancelled')), { once: true });
    }));
    const file = await m.prepareMedia({ data: new Uint8Array(4000), name: 'Voice message.webm', originalQuality: true });
    const [t] = await m.upload([file.handle], voice('desktop-cancel'));
    const path = m.list()[0]!.source;
    expect(existsSync(path)).toBe(true);
    await vi.waitFor(() => expect(http.raw).toHaveBeenCalled());
    await m.cancel(t!.id);
    expect(m.list()[0]!.state).toBe('cancelled');
    expect(existsSync(path)).toBe(false);
    await vi.waitFor(() => expect(posts(http, '/api/uploads/up-c/abort')).toHaveLength(1));
    expect(posts(http, '/api/chat/messages/attachments')).toHaveLength(0);
  });

  it('keeps a voice message that did not go through Clear finished, and plays it from this computer', async () => {
    const { m } = manager({}, async (path) => {
      if (path.endsWith('/init')) return { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 };
      if (path === '/api/chat/messages/attachments') throw new DesktopError('SERVER_ERROR', 'Refused', 422);
      return { file_id: 1 };
    });
    const file = await m.prepareMedia({ data: new Uint8Array(4000), name: 'Voice message.webm', originalQuality: true });
    await m.upload([file.handle], voice('desktop-kept'));
    await vi.waitFor(() => expect(m.list()[0]!.state).toBe('failed'));
    m.clearFinished();
    const kept = m.list()[0]!;
    expect(kept.chat?.clientMessageId).toBe('desktop-kept');
    expect(existsSync(kept.source)).toBe(true);
    // Its bubble plays the recording here, by an address for this person only.
    const preview = kept.chat!.preview!;
    expect(preview).toMatch(/^app:\/\/bundle\/__local\/chat-media\/[a-f0-9-]{36}$/);
    const res = await m.serveMediaPreview(new Request(preview), new URL(preview).pathname.replace('/__local', ''));
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(4000);
  });

  it('sends again by itself at the next start what stopped on a temporary failure', async () => {
    let online = false;
    const db = new Database(':memory:');
    const key = new Vault(Vault.generateKey());
    const post: Post = async (path) => {
      if (path.endsWith('/init')) return { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 };
      if (path === '/api/chat/messages/attachments' && !online) throw new DesktopError('NETWORK_UNREACHABLE', 'Connection lost');
      return { message_id: 3, file_id: 1 };
    };
    const first = manager({ db, vaultKey: key }, post);
    const file = await first.m.prepareMedia({ data: new Uint8Array(4000), name: 'Voice message.webm', originalQuality: true });
    await first.m.upload([file.handle], voice('desktop-restart'));
    await vi.waitFor(() => expect(first.m.list()[0]!.state).toBe('failed'));
    first.m.stopAll();

    online = true;
    const again = manager({ db, vaultKey: key }, post);
    again.m.recover();
    await vi.waitFor(() => expect(again.m.list()[0]!.state).toBe('done'));
    expect(posts(again.http, '/api/chat/messages/attachments')[0]![1]).toMatchObject({ client_message_id: 'desktop-restart' });
  });

  it('leaves a refused one for the person at the next start', async () => {
    const db = new Database(':memory:');
    const key = new Vault(Vault.generateKey());
    const post: Post = async (path) => {
      if (path.endsWith('/init')) return { upload_id: 'up1', chunk_size: 256 * 1024, total_chunks: 1 };
      if (path === '/api/chat/messages/attachments') throw new DesktopError('SERVER_ERROR', 'A voice message can be at most 10 minutes long.', 422);
      return { file_id: 1 };
    };
    const first = manager({ db, vaultKey: key }, post);
    const file = await first.m.prepareMedia({ data: new Uint8Array(4000), name: 'Voice message.webm', originalQuality: true });
    await first.m.upload([file.handle], voice('desktop-refused'));
    await vi.waitFor(() => expect(first.m.list()[0]!.state).toBe('failed'));
    first.m.stopAll();
    const again = manager({ db, vaultKey: key }, post);
    again.m.recover();
    expect(again.m.list()[0]!.state).toBe('failed');
  });
});

