import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
