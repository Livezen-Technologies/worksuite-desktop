import type { LocalAIRequest } from '@shared/local-ai';
import type { EngineInfo } from './engine';

/** Messages between the main process and the `ws-local-ai` utility process. */
export type ToWorker =
  | { type: 'init' }
  | { type: 'load'; path: string }
  | { type: 'unload' }
  | { type: 'generate'; req: LocalAIRequest }
  | { type: 'cancel'; id: string }
  | { type: 'ping'; n: number };

export type FromWorker =
  | { type: 'ready'; info: EngineInfo }
  | { type: 'loaded'; path: string; contextLength: number }
  | { type: 'unloaded' }
  | { type: 'chunk'; id: string; text: string }
  | { type: 'done'; id: string; text: string; tokens: number; ms: number; cancelled: boolean }
  | { type: 'error'; id?: string; op?: 'init' | 'load'; message: string }
  | { type: 'pong'; n: number };
