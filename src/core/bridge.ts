import type { EventChannel, InvokeChannel } from '@shared/ipc/channels';
import { isIpcFailure, type DesktopErrorCode, type InputOf, type Outputs, type PickedFile } from '@shared/ipc/contract';

/**
 * Typed access to `window.worksuite` (§8.4). The preload exposes namespaced
 * functions whose names mirror the channel names ("auth:signIn" →
 * worksuite.auth.signIn); failures come back as values and are turned into
 * `DesktopError`s here, with their codes intact.
 */
export class DesktopError extends Error {
  constructor(
    readonly code: DesktopErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopError';
  }
}

type Fn = (payload?: unknown) => Promise<unknown>;

interface Bridge {
  platform: string;
  files: { registerDropped: (files: File[]) => Promise<unknown> };
  events: { on: (channel: EventChannel, cb: (payload: unknown) => void) => () => void };
  [ns: string]: unknown;
}

declare global {
  interface Window {
    worksuite?: Bridge;
  }
}

export function hasDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.worksuite;
}

export const platform: string = typeof window !== 'undefined' ? (window.worksuite?.platform ?? 'browser') : 'node';
export const isMac = platform === 'darwin';

export async function call<C extends InvokeChannel>(channel: C, ...args: InputOf<C> extends undefined | null ? [input?: InputOf<C>] : [input: InputOf<C>]): Promise<Outputs[C]> {
  const [ns, method] = channel.split(':') as [string, string];
  const target = window.worksuite?.[ns] as Record<string, Fn> | undefined;
  const fn = target?.[method];
  if (typeof fn !== 'function') throw new DesktopError('UNSUPPORTED', 'WorkSuite Desktop is not available.');
  const res = await fn(args[0]);
  if (isIpcFailure(res)) throw new DesktopError(res.code, res.message);
  return res as Outputs[C];
}

export function on<T = unknown>(channel: EventChannel, cb: (payload: T) => void): () => void {
  if (!window.worksuite) return () => undefined;
  return window.worksuite.events.on(channel, cb as (p: unknown) => void);
}

export async function registerDropped(files: File[]): Promise<PickedFile[]> {
  if (!window.worksuite) return [];
  const res = await window.worksuite.files.registerDropped(files);
  if (isIpcFailure(res)) throw new DesktopError(res.code, res.message);
  return res as PickedFile[];
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
