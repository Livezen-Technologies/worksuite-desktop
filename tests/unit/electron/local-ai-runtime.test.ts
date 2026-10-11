import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAIEngine } from '../../../electron/services/local-ai/engine';
import { LocalAIRuntime, type WorkerLink } from '../../../electron/services/local-ai/runtime';
import type { FromWorker, ToWorker } from '../../../electron/services/local-ai/protocol';
import type { LocalAIEvent } from '../../../shared/local-ai';

const MODEL = join(__dirname, '..', '..', 'fixtures', 'local-ai', 'tiny-test.gguf');
const root = mkdtempSync(join(tmpdir(), 'ws-lai-rt-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The worker's message handling, in this process, over the real engine; `crash()` ends it as a crash would. */
function inProcess(spawned: Array<{ crash: () => void; posted: ToWorker[] }>): () => WorkerLink {
  return () => {
    const engine = new LocalAIEngine();
    const running = new Map<string, AbortController>();
    let onMsg: (m: FromWorker) => void = () => undefined;
    let onExit: (code: number) => void = () => undefined;
    let dead = false;
    const send = (m: FromWorker) => !dead && queueMicrotask(() => onMsg(m));
    const posted: ToWorker[] = [];
    const end = (code: number) => {
      if (dead) return;
      dead = true;
      void engine.dispose();
      queueMicrotask(() => onExit(code));
    };
    spawned.push({ crash: () => end(139), posted });
    return {
      post(m) {
        posted.push(m);
        if (m.type === 'init') void engine.init({ gpu: false }).then((info) => send({ type: 'ready', info }));
        else if (m.type === 'load') void engine.load(m.path).then((r) => send({ type: 'loaded', path: m.path, contextLength: r.contextLength }), (e: Error) => send({ type: 'error', op: 'load', message: e.message }));
        else if (m.type === 'cancel') running.get(m.id)?.abort();
        else if (m.type === 'generate') {
          const ac = new AbortController();
          running.set(m.req.id, ac);
          void engine.generate(m.req, (text) => send({ type: 'chunk', id: m.req.id, text }), ac.signal).then((r) => send({ type: 'done', id: m.req.id, ...r }), (e: Error) => send({ type: 'error', id: m.req.id, message: e.message }));
        }
      },
      onMessage: (cb) => (onMsg = cb),
      onExit: (cb) => (onExit = cb),
      kill: () => end(0),
    };
  };
}

function setup(installed: boolean, opts: { usable?: boolean; files?: Record<string, string> } = {}) {
  const events: Array<[number, LocalAIEvent]> = [];
  const spawned: Array<{ crash: () => void; posted: ToWorker[] }> = [];
  const models = {
    defaultModel: () => (installed ? 'tiny' : null),
    path: async (id?: string) => (id && opts.files?.[id] ? opts.files[id] : installed ? MODEL : null),
    usable: () => opts.usable ?? true,
  };
  const rt = new LocalAIRuntime({ spawn: inProcess(spawned), models: models as never, modelsRoot: root, emit: (s, e) => events.push([s, e]), idleMs: 60_000 });
  // Waits for the real engine; on a busy machine a load and an answer can take well over ten seconds, so it
  // waits up to 45 s and fails here, by name, rather than giving up quietly and failing a later check instead.
  const until = async (pred: () => boolean, ms = 45_000) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`Timed out after ${ms / 1000} s waiting for the local AI runtime`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  return { rt, events, spawned, until };
}

describe('Local AI runtime (main process side)', () => {
  it('starts on first use, loads the default model, and streams the answer to the window that asked', async () => {
    const { rt, events, spawned, until } = setup(true);
    expect(spawned).toHaveLength(0);
    await rt.ask(7, { id: 'req-aaaaaaaa', messages: [{ role: 'user', content: 'Hello' }], maxTokens: 6 });
    await until(() => events.some(([, e]) => e.type === 'done'));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.posted.map((m) => m.type).slice(0, 3)).toEqual(['init', 'load', 'generate']);
    expect(events.every(([s]) => s === 7)).toBe(true);
    const done = events.find(([, e]) => e.type === 'done')![1] as Extract<LocalAIEvent, { type: 'done' }>;
    expect(done.text).toBe(events.filter(([, e]) => e.type === 'chunk').map(([, e]) => (e as { text: string }).text).join(''));
    // The model stays loaded for the next request.
    await rt.ask(7, { id: 'req-bbbbbbbb', messages: [{ role: 'user', content: 'Again' }], maxTokens: 3 });
    await until(() => events.filter(([, e]) => e.type === 'done').length === 2);
    expect(spawned[0]!.posted.filter((m) => m.type === 'load')).toHaveLength(1);
    expect(rt.status({ at: null, error: null }, null).loaded).toBe('tiny');
    await rt.stop();
  }, 60_000);

  it('cancels, and a window that goes away cancels what it asked', async () => {
    const { rt, events, until } = setup(true);
    await rt.ask(3, { id: 'req-cccccccc', messages: [{ role: 'user', content: 'Long' }], maxTokens: 2000 });
    // Straight away, while the request is certainly still running: the tiny test model can finish its whole answer
    // between two polls, and a finished request has nothing left to cancel.
    rt.senderGone(3);
    await until(() => events.some(([, e]) => e.type === 'done'));
    expect((events.find(([, e]) => e.type === 'done')![1] as { cancelled: boolean }).cancelled).toBe(true);
    await rt.stop();
  }, 60_000);

  it('fails a crashed request with a sentence, starts again on the next, and stops after 3 crashes in 10 minutes', async () => {
    const { rt, events, spawned, until } = setup(true);
    for (let n = 1; n <= 4; n++) {
      await rt.ask(1, { id: `req-crash00${n}`, messages: [{ role: 'user', content: 'x' }], maxTokens: 2000 });
      // Crashed while the request is in flight (see the cancel test above for why not after its first chunk).
      spawned.at(-1)!.crash();
      await until(() => events.some(([, e]) => e.id === `req-crash00${n}` && e.type === 'error'));
    }
    expect(events.filter(([, e]) => e.type === 'error').map(([, e]) => (e as { message: string }).message)).toEqual(Array(4).fill('Local AI stopped unexpectedly. Try again.'));
    expect(rt.status({ at: null, error: null }, null).runtime).toBe('error');
    await expect(rt.ask(1, { id: 'req-crash005', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/stopped 4 times in 10 minutes/);
    await rt.reset();
    expect(rt.status({ at: null, error: null }, null).runtime).toBe('off');
  }, 240_000);

  it('says when no model is installed, without starting anything', async () => {
    const { rt, spawned } = setup(false);
    await expect(rt.ask(1, { id: 'req-nomodel1', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/No model is installed/);
    expect(spawned).toHaveLength(0);
  });

  it('reads this computer for the tier', async () => {
    const { rt } = setup(true);
    const hw = await rt.hardware();
    expect(hw.memoryBytes).toBeGreaterThan(0);
    expect(['minimal', 'basic', 'good', 'strong']).toContain(hw.tier);
  });

  describe('the readiness check (worksuite-desktop#55)', () => {
    it('loads the model and has it answer before it is called ready', async () => {
      const { rt, spawned, events } = setup(true);
      await expect(rt.probe('tiny')).resolves.toBeUndefined();
      expect(spawned[0]!.posted.map((m) => m.type).slice(0, 3)).toEqual(['init', 'load', 'generate']);
      const req = spawned[0]!.posted.find((m) => m.type === 'generate') as Extract<ToWorker, { type: 'generate' }>;
      expect(req.req.maxTokens).toBe(8);
      // Nothing of the check reaches a window.
      expect(events).toHaveLength(0);
      expect(rt.status({ at: null, error: null }, null).runtime).toBe('ready');
      await rt.stop();
    }, 60_000);

    it('fails, with the reason, for a file llama.cpp cannot load, and Local AI keeps working', async () => {
      const bad = join(root, 'not-a-model.gguf');
      writeFileSync(bad, Buffer.alloc(4096, 7));
      const { rt } = setup(true, { files: { broken: bad } });
      await expect(rt.probe('broken')).rejects.toThrow();
      expect(rt.status({ at: null, error: null }, null).runtime).not.toBe('error');
      await expect(rt.probe('tiny')).resolves.toBeUndefined();
      await rt.stop();
    }, 60_000);

    it('times out a model that loads but does not answer', async () => {
      const { rt } = setup(true);
      await expect(rt.probe('tiny', 1)).rejects.toThrow('did not answer in time');
      await rt.stop();
    }, 60_000);

    it('will not answer questions with a model that failed its check', async () => {
      const { rt, spawned } = setup(true, { usable: false });
      await expect(rt.ask(7, { id: 'req-cccccccc', messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow('not ready to use');
      expect(spawned).toHaveLength(0);
    });
  });
});
