import { describe, expect, it, vi } from 'vitest';
import { IpcRouter } from '../../../electron/ipc/router';

/**
 * A pasted screenshot crosses IPC as bytes (`transfers:prepareMedia`). The 1 MB size guard measured it as JSON, where
 * every byte is "123,", so anything over about 120 KB was refused as "The request was not valid." before its schema,
 * which caps it at 100 MB, ever saw it.
 */
describe('IPC size guard and bytes', () => {
  const router = () => {
    const r = new IpcRouter({ handle: vi.fn(), removeHandler: vi.fn() }, { isTrustedSender: () => true, isLocked: () => false, isSignedIn: () => true, hasPermission: () => true, audit: vi.fn(), onAbuse: vi.fn() });
    const handler = vi.fn(async () => ({ handle: 'h1', name: 'Screenshot.png', size: 1, kind: 'file' }));
    r.handle('transfers:prepareMedia', handler as never);
    return { r, handler };
  };

  it('takes a 376 KB pasted screenshot', async () => {
    const { r, handler } = router();
    const data = new Uint8Array(376 * 1024).fill(137);
    const out = await r.dispatch('transfers:prepareMedia', { sender: { id: 1 } } as never, { name: 'Screenshot 2026-10-08 06.56.16.png', originalQuality: false, data });
    expect(out).toMatchObject({ handle: 'h1' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('still refuses a JSON payload over 1 MB', async () => {
    const { r, handler } = router();
    const out = await r.dispatch('transfers:prepareMedia', { sender: { id: 1 } } as never, { name: 'x'.repeat(1_100_000), originalQuality: false, handle: 'h1' });
    expect(out).toMatchObject({ code: 'IPC_VALIDATION_FAILED' });
    expect(handler).not.toHaveBeenCalled();
  });
});
