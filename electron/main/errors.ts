import type { DesktopErrorCode } from '@shared/ipc/contract';

/** An error with a stable code that survives the trip across IPC. */
export class DesktopError extends Error {
  constructor(
    readonly code: DesktopErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly data: unknown = null,
  ) {
    super(message);
    this.name = 'DesktopError';
  }
}

export function isDesktopError(e: unknown): e is DesktopError {
  return e instanceof DesktopError;
}

/** FR-SEC-11: the one message for "the server cannot be reached". */
export const UNREACHABLE_MESSAGE = 'Cannot reach WorkSuite server. Check your network or company VPN.';
