import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dialog = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: class {}, app: { isPackaged: false, getPath: () => tmpdir() }, dialog, protocol: { registerSchemesAsPrivileged: vi.fn() } }));

import { SpeechService, isGgml } from '../../../electron/services/speech';

/** Speech to text on this computer (worksuite-desktop#81): the model the person adds, checked before it is kept. */
describe('the speech model', () => {
  let dir: string;
  let models: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ws-speech-'));
    models = await mkdtemp(join(tmpdir(), 'ws-src-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(models, { recursive: true, force: true });
  });

  it('knows a whisper.cpp model by its first bytes', () => {
    expect(isGgml(Buffer.from([0x6c, 0x6d, 0x67, 0x67, 0, 0]))).toBe(true);
    expect(isGgml(Buffer.from('GGUF'))).toBe(false);
    expect(isGgml(Buffer.alloc(2))).toBe(false);
  });

  it('says there is none, keeps a real one, refuses anything else, and removes it', async () => {
    const s = new SpeechService({ dir, preload: 'x' });
    expect((await s.status()).local).toEqual({ ready: false, model: null, why: expect.stringMatching(/No speech model/) });

    const bad = join(models, 'notes.bin');
    await writeFile(bad, 'hello world');
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [bad] });
    await expect(s.chooseModel(null)).rejects.toThrow(/not a whisper.cpp model/);

    const good = join(models, 'ggml-base-q5_1.bin');
    await writeFile(good, Buffer.concat([Buffer.from([0x6c, 0x6d, 0x67, 0x67]), Buffer.alloc(100)]));
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [good] });
    const after = await s.chooseModel(null);
    expect(after.local).toEqual({ ready: true, model: { name: 'ggml-base-q5_1.bin', size: 104 }, why: null });
    expect((await s.serveModel()).status).toBe(200);

    expect((await s.removeModel()).local.ready).toBe(false);
    expect((await s.serveModel()).status).toBe(404);
  });

  it('does not try to transcribe without a model', async () => {
    const s = new SpeechService({ dir, preload: 'x' });
    await expect(s.transcribe(new Uint8Array(100), 'en')).rejects.toThrow(/No speech model/);
  });
});

/** G-11: the server's speech catalogue, downloaded and checked by SHA-256 before it is kept. */
describe('speech models from the WorkSuite server', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ws-speech-cat-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const file = Buffer.concat([Buffer.from([0x6c, 0x6d, 0x67, 0x67]), Buffer.alloc(64, 1)]);
  const sha = createHash('sha256').update(file).digest('hex');
  const listing = (over: object = {}) => ({ id: 'base-q5_1', name: 'Whisper base', url: 'https://hf.test/ggml-base-q5_1.bin', sha256: sha, bytes: file.length, languages: ['en', 'si', 'ta'], recommendedFor: ['standard'], ...over });
  const server = (models: object[], local = { preferred: false, required: false, catalog: '/api/ai/local/speech-catalog' }) =>
    vi.fn(async (path: string) => (path === '/api/ai/speech/status' ? { online: true, local } : { models, problems: {} })) as never;

  it('lists the server models, off by default, and keeps one only when its hash matches', async () => {
    const s = new SpeechService({ dir, preload: 'x', get: server([listing(), listing({ id: 'bad', url: 'http://plain.test/x' })]), fetch: async () => new Response(file) });
    const cat = await s.catalog();
    expect(cat).toMatchObject({ preferred: false, required: false, error: null });
    expect(cat.models.map((m) => m.id)).toEqual(['base-q5_1']);
    expect((await s.install('base-q5_1')).local.ready).toBe(true);
    expect((await s.catalog()).models[0]!.installed).toBe(true);
  });

  it('refuses a download that is not the file the server named', async () => {
    const s = new SpeechService({ dir, preload: 'x', get: server([listing({ sha256: 'f'.repeat(64) })]), fetch: async () => new Response(file) });
    await s.catalog();
    await expect(s.install('base-q5_1')).rejects.toThrow(/SHA-256/);
    expect((await s.status()).local.ready).toBe(false);
  });

  it('passes on what the company wants', async () => {
    const s = new SpeechService({ dir, preload: 'x', get: server([], { preferred: true, required: true, catalog: '/api/ai/local/speech-catalog' }) });
    expect(await s.catalog()).toMatchObject({ preferred: true, required: true, models: [] });
  });
});
