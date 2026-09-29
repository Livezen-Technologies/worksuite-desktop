import { describe, expect, it, vi } from 'vitest';
import { AI_CHANGES_LINK, AiPendingWatcher, type AiPendingDeps } from '../../../electron/services/ai-pending';

/**
 * Waiting changes in the tray and as notifications (WS-AI-SRS-001 DSK-5,
 * AC-AI-27): what was waiting at sign-in is counted, not announced; a new one
 * is announced once; a notification only opens the Changes view — it can
 * confirm nothing, a change that reaches outside least of all.
 */

const card = (id: number, risk: 'R1' | 'R2' = 'R1', status = 'awaiting_confirmation') => ({ id, risk, status, preview: { title: `Change ${id}` } });

function watcher(lists: Array<ReturnType<typeof card>[]>, over: Partial<AiPendingDeps> = {}) {
  let i = 0;
  const deps = {
    get: vi.fn(async () => ({ actions: lists[Math.min(i++, lists.length - 1)] })) as unknown as AiPendingDeps['get'],
    notify: vi.fn(),
    enabled: () => true,
    onCount: vi.fn(),
    every: 3_600_000,
    ...over,
  };
  return { w: new AiPendingWatcher(deps), deps };
}

describe('waiting changes from the assistant', () => {
  it('counts what was already waiting, and announces only what arrives after', async () => {
    const { w, deps } = watcher([[card(1), card(2)], [card(1), card(2), card(3, 'R2')]]);
    w.start();
    await w.refresh();
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.onCount).toHaveBeenLastCalledWith(2);

    w.handle({ type: 'ai.pending.created' });
    await w.refresh();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ai-pending:3',
      link: AI_CHANGES_LINK,
      title: expect.stringMatching(/check it first/),
      body: 'Change 3',
      critical: false,
    }));
    expect(deps.onCount).toHaveBeenLastCalledWith(3);
    w.stop();
  });

  it('never announces the same change twice, and counts only what still waits', async () => {
    const { w, deps } = watcher([[], [card(5)], [card(5), card(6, 'R1', 'succeeded')]]);
    w.start();
    await w.refresh();
    await w.refresh();
    await w.refresh();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.onCount).toHaveBeenLastCalledWith(1);
    w.stop();
    expect(deps.onCount).toHaveBeenLastCalledWith(0);
  });

  it('asks nothing while the assistant is off here, and ignores other events', async () => {
    const { w, deps } = watcher([[card(1)]], { enabled: () => false });
    w.start();
    await w.refresh();
    w.handle({ type: 'chat.message' });
    expect(deps.get).not.toHaveBeenCalled();
    expect(deps.onCount).toHaveBeenLastCalledWith(0);
    w.stop();
  });

  it('announces nothing from a failed read', async () => {
    const get = vi.fn().mockResolvedValueOnce({ actions: [] }).mockRejectedValueOnce(new Error('offline')) as unknown as AiPendingDeps['get'];
    const { w, deps } = watcher([], { get });
    w.start();
    await w.refresh();
    await w.refresh();
    expect(deps.notify).not.toHaveBeenCalled();
    w.stop();
  });
});
