import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { z } from 'zod';
import { INVOKE_CHANNELS, type InvokeChannel } from '@shared/ipc/channels';
import { contract, type Contract, type DesktopErrorCode, type IpcFailure, type Outputs } from '@shared/ipc/contract';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';

const log = logger('ipc');

/**
 * The IPC request pipeline (§3.4, WF-05):
 *
 *   allow-listed channel → schema → sender origin → lock → session →
 *   permission → rate limit → handler → audit
 *
 * Failures come back as a typed `IpcFailure` value rather than a thrown
 * error, because Electron flattens thrown errors into a string and the
 * renderer would lose the code.
 */
export interface HandlerContext {
  sender: WebContents;
  channel: InvokeChannel;
}

export type Handler<C extends InvokeChannel> = (
  input: z.output<Contract[C]['input']>,
  ctx: HandlerContext,
) => Promise<Outputs[C]> | Outputs[C];

export interface RouterDeps {
  /** True when the sending frame is our top-level shell document. */
  isTrustedSender: (event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>) => boolean;
  isLocked: () => boolean;
  isSignedIn: () => boolean;
  hasPermission: (key: string) => boolean;
  audit: (action: string, details: Record<string, unknown>) => void;
  onAbuse: (sender: WebContents, reason: string) => void;
}

interface IpcMainLike {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

function failure(code: DesktopErrorCode, message: string): IpcFailure {
  return { __wsError: true, code, message };
}

export class IpcRouter {
  private handlers = new Map<InvokeChannel, Handler<InvokeChannel>>();
  private rate = new Map<string, number[]>();
  private violations = new Map<number, number[]>();

  constructor(
    private readonly ipc: IpcMainLike,
    private readonly deps: RouterDeps,
  ) {}

  handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
    if (!(INVOKE_CHANNELS as readonly string[]).includes(channel)) throw new Error(`channel ${channel} is not in the contract`);
    if (this.handlers.has(channel)) throw new Error(`channel ${channel} registered twice`);
    this.handlers.set(channel, handler as unknown as Handler<InvokeChannel>);
  }

  /** Registers every contract channel with ipcMain. Channels without a handler answer UNSUPPORTED. */
  install(): void {
    for (const channel of INVOKE_CHANNELS) {
      this.ipc.removeHandler(channel);
      this.ipc.handle(channel, (event, payload) => this.dispatch(channel, event, payload));
    }
  }

  missingHandlers(): InvokeChannel[] {
    return INVOKE_CHANNELS.filter((c) => !this.handlers.has(c));
  }

  private violation(event: IpcMainInvokeEvent, channel: string, code: DesktopErrorCode, reason: string): IpcFailure {
    log.warn('ipc rejected', { channel, code, reason, url: event.senderFrame?.url?.slice(0, 120) });
    const id = event.sender.id;
    const now = Date.now();
    const list = (this.violations.get(id) ?? []).filter((t) => now - t < 60_000);
    list.push(now);
    this.violations.set(id, list);
    if (list.length > 20) {
      // WF-05: repeated violations from one window → rate-limit, then reload.
      this.violations.set(id, []);
      this.deps.onAbuse(event.sender, `${list.length} rejected IPC calls in a minute`);
    }
    return failure(code, code === 'IPC_VALIDATION_FAILED' ? 'The request was not valid.' : reason);
  }

  private rateOk(senderId: number, channel: InvokeChannel, perSecond: number): boolean {
    const key = `${senderId}:${channel}`;
    const now = Date.now();
    const list = (this.rate.get(key) ?? []).filter((t) => now - t < 1000);
    if (list.length >= perSecond) {
      this.rate.set(key, list);
      return false;
    }
    list.push(now);
    this.rate.set(key, list);
    return true;
  }

  async dispatch(channel: InvokeChannel, event: IpcMainInvokeEvent, payload: unknown): Promise<unknown> {
    const spec = contract[channel];
    if (!spec) return this.violation(event, channel, 'IPC_UNKNOWN_CHANNEL', 'Unknown channel.');

    if (!this.deps.isTrustedSender(event)) {
      return this.violation(event, channel, 'IPC_FORBIDDEN_SENDER', 'Requests are only accepted from the WorkSuite shell.');
    }

    // Structured-clone size guard: files cross IPC by reference, never bytes.
    try {
      if (payload !== undefined && JSON.stringify(payload).length > 1_048_576 && !channel.startsWith('print:')) {
        return this.violation(event, channel, 'IPC_VALIDATION_FAILED', 'Payload too large.');
      }
    } catch {
      return this.violation(event, channel, 'IPC_VALIDATION_FAILED', 'Payload not serialisable.');
    }

    const parsed = spec.input.safeParse(payload);
    if (!parsed.success) return this.violation(event, channel, 'IPC_VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'invalid');

    const opts = spec as { whileLocked?: boolean; session?: boolean; permission?: string; sensitive?: boolean; rate?: number };
    if (this.deps.isLocked() && !opts.whileLocked) return failure('APP_LOCKED', 'WorkSuite is locked.');
    if (opts.session && !this.deps.isSignedIn()) return failure('NOT_SIGNED_IN', 'Sign in to WorkSuite first.');
    if (opts.permission && !this.deps.hasPermission(opts.permission)) {
      return failure('PERMISSION_DENIED', 'Your organization does not allow this on the desktop.');
    }
    if (!this.rateOk(event.sender.id, channel, opts.rate ?? 30)) return failure('IPC_RATE_LIMITED', 'Too many requests; slow down.');

    const handler = this.handlers.get(channel);
    if (!handler) return failure('UNSUPPORTED', 'This action is not available in this version.');

    try {
      const out = await handler(parsed.data as never, { sender: event.sender, channel });
      if (opts.sensitive) this.deps.audit(channel, { ok: true });
      return out;
    } catch (e) {
      if (opts.sensitive) this.deps.audit(channel, { ok: false, code: isDesktopError(e) ? e.code : 'INTERNAL' });
      if (isDesktopError(e)) return failure(e.code, e.message);
      log.error('ipc handler crashed', { channel, error: e });
      return failure('INTERNAL', 'Something went wrong. Details are in Help → Diagnostics.');
    }
  }
}

export function assertDesktopError(e: unknown): DesktopError {
  return isDesktopError(e) ? e : new DesktopError('INTERNAL', String((e as Error)?.message ?? e));
}
