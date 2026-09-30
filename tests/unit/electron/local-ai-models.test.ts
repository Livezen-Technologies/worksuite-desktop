import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAIModelManager } from '../../../electron/services/local-ai/models';
import type { LocalAIHardware } from '../../../shared/local-ai';

const MODEL_BYTES = readFileSync(join(__dirname, '..', '..', 'fixtures', 'local-ai', 'tiny-test.gguf'));
const SHA = createHash('sha256').update(MODEL_BYTES).digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const hw: LocalAIHardware = { platform: 'linux', arch: 'x64', memoryBytes: 16 * 1024 ** 3, freeDiskBytes: null, cpuCores: 8, gpu: false, vramBytes: 0, tier: 'good' };

function model(over: object = {}) {
  return {
    id: 'qwen3-4b', version: '1', name: 'Qwen3 4B', family: 'qwen3', purpose: 'chat', url: 'https://cdn.worksuite.test/models/qwen3-4b.gguf', sha256: SHA, bytes: MODEL_BYTES.length,
    quantization: 'Q4_K_M', contextLength: 32768, minMemoryBytes: 6 * 1024 ** 3, tiers: ['good', 'strong'], recommendedFor: ['good'],
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' }, languages: ['en', 'si', 'ta'], toolCalling: true, ...over,
  };
}
function envelope(models: object[], opts: { expires?: string; key?: typeof privateKey; keyId?: string } = {}) {
  const body = JSON.stringify({ schema: 1, issuedAt: '2026-09-30T00:00:00Z', expiresAt: opts.expires ?? '2099-01-01T00:00:00Z', models });
  return { body, signature: sign(null, Buffer.from(body), opts.key ?? privateKey).toString('base64'), keyId: opts.keyId ?? 'ws-2026' };
}

/** A CDN: the catalog, and the model with Range support; `cut` stops a download after that many bytes. */
function cdn(catalog: unknown, file: Buffer = MODEL_BYTES, cut?: number) {
  const calls: Array<{ url: string; range?: string }> = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    calls.push({ url, range: init?.headers?.Range });
    if (url.endsWith('catalog.json')) return new Response(JSON.stringify(catalog), { status: 200 });
    const from = Number(/bytes=(\d+)-/.exec(init?.headers?.Range ?? '')?.[1] ?? 0);
    const rest = file.subarray(from);
    const stop = cut !== undefined ? Math.max(0, cut - from) : rest.length;
    // Delivers what it has, then (when cut) drops the connection on the next read.
    let sent = false;
    const body = new ReadableStream({
      pull(c) {
        if (!sent) {
          sent = true;
          c.enqueue(new Uint8Array(rest.subarray(0, Math.min(stop, rest.length))));
        } else if (stop < rest.length) c.error(new Error('connection reset'));
        else c.close();
      },
    });
    return new Response(body, { status: from ? 206 : 200 });
  };
  return { fetch, calls };
}

function manager(catalog: unknown, file?: Buffer, cut?: number) {
  const root = mkdtempSync(join(tmpdir(), 'ws-lai-'));
  const net = cdn(catalog, file, cut);
  const m = new LocalAIModelManager({ root, catalogUrl: () => 'https://cdn.worksuite.test/local-ai/catalog.json', keys: { 'ws-2026': PUB }, fetch: net.fetch });
  return { m, root, net, done: () => rmSync(root, { recursive: true, force: true }) };
}

describe('Local AI model manager', () => {
  it('takes only a catalog signed by a pinned key, unchanged and unexpired', async () => {
    const good = manager(envelope([model()]));
    await good.m.init();
    await good.m.refresh();
    expect(good.m.catalogState().error).toBeNull();
    expect((await good.m.list(hw)).map((v) => [v.model.id, v.state, v.fits, v.recommended])).toEqual([['qwen3-4b', 'available', true, true]]);
    good.done();

    const tampered = envelope([model()]);
    tampered.body = tampered.body.replace('Qwen3 4B', 'Qwen3 4B!');
    const other = generateKeyPairSync('ed25519').privateKey;
    for (const [raw, why] of [
      [tampered, /signature does not match/],
      [envelope([model()], { key: other }), /signature does not match/],
      [envelope([model()], { keyId: 'someone-else' }), /key this app does not know/],
      [envelope([model()], { expires: '2020-01-01T00:00:00Z' }), /expired/],
    ] as const) {
      const bad = manager(raw);
      await bad.m.init();
      await bad.m.refresh();
      expect(bad.m.catalogState().error).toMatch(why);
      expect(await bad.m.list(hw)).toEqual([]);
      bad.done();
    }
  });

  it('keeps the last good catalog for offline use', async () => {
    const a = manager(envelope([model()]));
    await a.m.init();
    await a.m.refresh();
    const again = new LocalAIModelManager({ root: a.root, catalogUrl: () => null, keys: { 'ws-2026': PUB }, fetch: async () => new Response('', { status: 500 }) });
    await again.init();
    expect((await again.list(hw)).map((v) => v.model.id)).toEqual(['qwen3-4b']);
    a.done();
  });

  it('downloads, resumes where it stopped, verifies, installs and becomes the default', async () => {
    const half = Math.floor(MODEL_BYTES.length / 2);
    const s = manager(envelope([model()]), MODEL_BYTES, half);
    await s.m.init();
    await s.m.refresh();
    await s.m.install('qwen3-4b');
    let [v] = await s.m.list(hw);
    expect(v!.state).toBe('failed');
    expect(v!.received).toBe(half);
    // The connection is back: the rest only, from where it stopped.
    const calls = cdn(envelope([model()]));
    const s3 = new LocalAIModelManager({ root: s.root, catalogUrl: () => 'https://cdn.worksuite.test/local-ai/catalog.json', keys: { 'ws-2026': PUB }, fetch: calls.fetch });
    await s3.init();
    await s3.refresh();
    await s3.install('qwen3-4b');
    expect(calls.calls.at(-1)!.range).toBe(`bytes=${half}-`);
    [v] = await s3.list(hw);
    expect(v!.state).toBe('installed');
    expect(v!.isDefault).toBe(true);
    const path = await s3.path('qwen3-4b');
    expect(createHash('sha256').update(readFileSync(path!)).digest('hex')).toBe(SHA);
    expect(await s3.check('qwen3-4b')).toBe(true);
    await s3.remove('qwen3-4b');
    expect(await s3.path('qwen3-4b')).toBeNull();
    expect(s3.defaultModel()).toBeNull();
    s.done();
  });

  it('never installs a file that does not match the catalog', async () => {
    const wrong = Buffer.from(MODEL_BYTES);
    wrong[1000] = wrong[1000]! ^ 0xff;
    const s = manager(envelope([model()]), wrong);
    await s.m.init();
    await s.m.refresh();
    await s.m.install('qwen3-4b');
    const [v] = await s.m.list(hw);
    expect(v!.state).toBe('failed');
    expect(v!.error).toMatch(/does not match the catalog/);
    expect(await s.m.path('qwen3-4b')).toBeNull();
    expect(existsSync(join(s.root, 'qwen3-4b', '1', 'model.gguf.part'))).toBe(false);
    s.done();
  });

  it('says a model does not suit a smaller computer', async () => {
    const s = manager(envelope([model()]));
    await s.m.init();
    await s.m.refresh();
    const [v] = await s.m.list({ ...hw, memoryBytes: 8 * 1024 ** 3, tier: 'basic' });
    expect([v!.fits, v!.recommended]).toEqual([false, false]);
    s.done();
  });
});
