/**
 * Utility process `ws-local-ai` (WS-SRS-LAI §3.2, LAI-DSK-003): llama.cpp, loaded in this process only, so a
 * crash or an out-of-memory ends this process and not the app, and it can be killed to give the memory back.
 * It reads only the model file the main process names and has no network use of its own.
 */
import { LocalAIEngine } from '../services/local-ai/engine';
import type { FromWorker, ToWorker } from '../services/local-ai/protocol';

const port = process.parentPort;
const engine = new LocalAIEngine();
const running = new Map<string, AbortController>();
const send = (m: FromWorker) => port.postMessage(m);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

port.on('message', (e: { data: ToWorker }) => {
  const msg = e.data;
  switch (msg.type) {
    case 'ping':
      send({ type: 'pong', n: msg.n });
      return;
    case 'init':
      engine.init().then((info) => send({ type: 'ready', info }), (err: unknown) => send({ type: 'error', op: 'init', message: message(err) }));
      return;
    case 'load':
      engine.load(msg.path).then((r) => send({ type: 'loaded', path: msg.path, contextLength: r.contextLength }), (err: unknown) => send({ type: 'error', op: 'load', message: message(err) }));
      return;
    case 'unload':
      void engine.unload().then(() => send({ type: 'unloaded' }));
      return;
    case 'cancel':
      running.get(msg.id)?.abort();
      return;
    case 'generate': {
      const ac = new AbortController();
      running.set(msg.req.id, ac);
      engine
        .generate(msg.req, (text) => send({ type: 'chunk', id: msg.req.id, text }), ac.signal)
        .then((r) => send({ type: 'done', id: msg.req.id, ...r }), (err: unknown) => send({ type: 'error', id: msg.req.id, message: message(err) }))
        .finally(() => running.delete(msg.req.id));
      return;
    }
  }
});
