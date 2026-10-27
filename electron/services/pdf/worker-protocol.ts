import type { PdfEngineCapabilities, PdfEngineErrorCode, PdfSearchOptions } from '@shared/pdf';
import { EngineError, ENGINE_MESSAGES, isEngineError, type CancelToken, type EngineCompose, type EngineEditOp, type EngineFile, type PDFEngine, type RenderRequest } from './engine';

/**
 * What the main process and a pdf-worker say to each other. One worker
 * holds one document; requests carry an id and each gets exactly one
 * `result`. Searches and scans also send `progress` under their id until
 * their result; `cancel` stops one between pages.
 */
export type WorkerRequest =
  | { type: 'ping'; n: number }
  | { id: number; op: 'open'; file: EngineFile; password: string | null }
  | { id: number; op: 'render'; req: RenderRequest }
  | { id: number; op: 'search'; query: string; options: PdfSearchOptions }
  | { id: number; op: 'scan' }
  | { id: number; op: 'cancel'; target: number }
  | { id: number; op: 'outline' }
  | { id: number; op: 'links'; page: number }
  | { id: number; op: 'attachments' }
  | { id: number; op: 'annotations'; page: number }
  | { id: number; op: 'apply'; edit: EngineEditOp }
  | { id: number; op: 'textSpan'; page: number; from: [number, number]; to: [number, number] }
  | { id: number; op: 'save' }
  | { id: number; op: 'extract'; pages: number[] }
  | { id: number; op: 'protect'; userPassword: string; ownerPassword: string; permissions: number }
  | { id: number; op: 'unprotect' }
  | { id: number; op: 'pageText'; pages: number[] }
  | { id: number; op: 'compose'; req: EngineCompose }
  | { id: number; op: 'unload' }
  | { id: number; op: 'close' };

export type WorkerMessage =
  | { type: 'ready'; capabilities: PdfEngineCapabilities }
  | { type: 'pong'; n: number; memory: number }
  | { type: 'progress'; id: number; value: unknown }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; code: PdfEngineErrorCode; message: string }
  | { type: 'fatal'; code: PdfEngineErrorCode; message: string };

export interface WorkerEngineLike extends PDFEngine {
  memoryBytes(): number;
}

/**
 * The worker's side, apart from the process: takes requests, runs them on
 * the engine, answers. `pdf-worker.ts` wires it to `process.parentPort`;
 * the unit tests wire it to the main side in one process.
 */
export function workerHandler(engine: Promise<WorkerEngineLike>, post: (m: WorkerMessage) => void): (msg: WorkerRequest) => void {
  const running = new Map<number, CancelToken>();
  let memory = 0;
  void engine.then(
    (e) => {
      memory = e.memoryBytes();
      post({ type: 'ready', capabilities: e.capabilities() });
    },
    () => post({ type: 'fatal', code: 'unknown', message: 'The PDF engine could not start.' }),
  );

  const answer = async (id: number, run: (e: WorkerEngineLike) => Promise<unknown>) => {
    try {
      const e = await engine;
      const value = await run(e);
      memory = e.memoryBytes();
      post({ type: 'result', id, ok: true, value });
    } catch (err) {
      // Only the engine's own codes and fixed sentences leave the worker: never a path, a password or document text.
      const code: PdfEngineErrorCode = isEngineError(err) ? err.code : 'unknown';
      post({ type: 'result', id, ok: false, code, message: isEngineError(err) ? err.message : ENGINE_MESSAGES.unknown });
      if (code === 'memory') post({ type: 'fatal', code, message: ENGINE_MESSAGES.memory });
    } finally {
      running.delete(id);
    }
  };

  return (msg) => {
    if ('type' in msg) {
      post({ type: 'pong', n: msg.n, memory });
      return;
    }
    switch (msg.op) {
      case 'open':
        return void answer(msg.id, (e) => e.open(msg.file, msg.password));
      case 'render':
        return void answer(msg.id, (e) => e.render(msg.req));
      case 'search': {
        const token = { cancelled: false };
        running.set(msg.id, token);
        return void answer(msg.id, (e) => e.search(msg.query, msg.options, (p) => post({ type: 'progress', id: msg.id, value: p }), token));
      }
      case 'scan': {
        const token = { cancelled: false };
        running.set(msg.id, token);
        return void answer(msg.id, (e) => e.scan((s) => post({ type: 'progress', id: msg.id, value: s }), token));
      }
      case 'cancel': {
        const t = running.get(msg.target);
        if (t) t.cancelled = true;
        return void answer(msg.id, async () => !!t);
      }
      case 'outline':
        return void answer(msg.id, (e) => e.outline());
      case 'links':
        return void answer(msg.id, (e) => e.links(msg.page));
      case 'attachments':
        return void answer(msg.id, (e) => e.attachments());
      case 'annotations':
        return void answer(msg.id, (e) => e.annotations(msg.page));
      case 'apply':
        return void answer(msg.id, (e) => e.apply(msg.edit));
      case 'textSpan':
        return void answer(msg.id, (e) => e.textSpan(msg.page, msg.from, msg.to));
      case 'save':
        return void answer(msg.id, (e) => e.save());
      case 'extract':
        return void answer(msg.id, (e) => e.extract(msg.pages));
      case 'protect':
        return void answer(msg.id, (e) => e.protect(msg.userPassword, msg.ownerPassword, msg.permissions));
      case 'unprotect':
        return void answer(msg.id, (e) => e.unprotect());
      case 'pageText':
        return void answer(msg.id, (e) => e.pageText(msg.pages));
      case 'compose':
        return void answer(msg.id, (e) => e.compose(msg.req));
      case 'unload':
        return void answer(msg.id, (e) => e.unload());
      case 'close':
        return void answer(msg.id, (e) => e.close());
      default:
        throw new EngineError('unsupported', ENGINE_MESSAGES.unsupported);
    }
  };
}
