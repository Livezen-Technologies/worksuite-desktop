import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { LocalAIEngine } from '../../../electron/services/local-ai/engine';

// A tiny random-weight llama model (scripts/make-test-gguf.py): it talks nonsense, but through the real engine.
const MODEL = join(__dirname, '..', '..', 'fixtures', 'local-ai', 'tiny-test.gguf');
const engine = new LocalAIEngine();
afterAll(() => engine.dispose());

describe('Local AI engine (llama.cpp, in-process)', () => {
  it('starts on this computer, on the CPU when no GPU backend works', async () => {
    const info = await engine.init();
    expect(info.cpuCores).toBeGreaterThan(0);
    expect(typeof info.mmap).toBe('boolean');
  }, 60_000);

  it('loads a model, memory-mapped, and says which', async () => {
    expect(await engine.load(MODEL)).toEqual({ contextLength: 2048 });
    expect(engine.loaded()).toBe(MODEL);
  }, 60_000);

  it('streams an answer and stops at the token limit', async () => {
    const chunks: string[] = [];
    const r = await engine.generate({ id: 'req-00000001', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hello' }], maxTokens: 12, temperature: 0 }, (c) => chunks.push(c), new AbortController().signal);
    expect(r.cancelled).toBe(false);
    expect(r.tokens).toBeGreaterThan(0);
    expect(r.tokens).toBeLessThanOrEqual(12);
    expect(chunks.join('')).toBe(r.text);
  }, 60_000);

  it('stops when cancelled, keeping what came so far', async () => {
    const ac = new AbortController();
    let n = 0;
    const r = await engine.generate({ id: 'req-00000002', messages: [{ role: 'user', content: 'Tell me a long story' }], maxTokens: 400 }, () => {
      if (++n === 5) ac.abort();
    }, ac.signal);
    expect(r.cancelled).toBe(true);
    expect(r.tokens).toBeLessThan(400);
  }, 60_000);

  it('takes earlier turns, and one request at a time', async () => {
    const order: string[] = [];
    const a = engine.generate({ id: 'req-00000003', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'Again' }], maxTokens: 4 }, () => undefined, new AbortController().signal).then(() => order.push('a'));
    const b = engine.generate({ id: 'req-00000004', messages: [{ role: 'user', content: 'Second' }], maxTokens: 4 }, () => undefined, new AbortController().signal).then(() => order.push('b'));
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  }, 60_000);

  it('refuses a conversation that does not end with a question, and unloads', async () => {
    await expect(engine.generate({ id: 'req-00000005', messages: [{ role: 'assistant', content: 'x' }], maxTokens: 2 }, () => undefined, new AbortController().signal)).rejects.toThrow(/end with the question/);
    await engine.unload();
    expect(engine.loaded()).toBeNull();
    await expect(engine.generate({ id: 'req-00000006', messages: [{ role: 'user', content: 'x' }] }, () => undefined, new AbortController().signal)).rejects.toThrow(/No model is loaded/);
  }, 60_000);
});
