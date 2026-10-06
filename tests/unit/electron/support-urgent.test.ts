import { describe, expect, it, vi } from 'vitest';
import { RING_WINDOW_MS, SupportUrgent, toRing } from '../../../electron/services/support-urgent';
import type { HttpClient } from '../../../electron/services/http';

/**
 * The urgent ticket pop-up's service, D-07 (desktop T25, FR-DSK-03, FR-NTF-03): new unassigned urgent tickets ring —
 * each once, one card at a time, the next when it closes — and a card closes when somebody takes its ticket.
 */
const NOW = Date.parse('2026-10-04T09:43:00Z');
const t = (id: number, over: Record<string, unknown> = {}) => ({ id, priority: 'urgent', assignee: null, deleted_at: null, created_at: new Date(NOW - 2 * 60_000).toISOString(), ...over }) as never;

describe('which tickets ring', () => {
  it('new, unassigned, urgent and not rung yet — oldest first', () => {
    const items = [t(3), t(2, { created_at: new Date(NOW - RING_WINDOW_MS - 1).toISOString() }), t(1, { assignee: { id: 4, name: 'Nimal' } }), t(5, { priority: 'high' }), t(4)];
    expect(toRing(items, new Set(), NOW)).toEqual([4, 3]);
    expect(toRing(items, new Set([4]), NOW)).toEqual([3]);
  });
});

function setup(pages: unknown[][], allowed = () => true) {
  let call = 0;
  const get = vi.fn(async () => ({ items: pages[Math.min(call++, pages.length - 1)] }));
  const ring = vi.fn();
  const close = vi.fn();
  const u = new SupportUrgent({ http: { get } as unknown as HttpClient, allowed, ring, close, now: () => NOW });
  return { u, get, ring, close };
}

describe('the service', () => {
  it('rings one card at a time, each ticket once, and the next when the card closes', async () => {
    const { u, get, ring } = setup([[t(2), t(1)]]);
    u.start();
    await vi.waitFor(() => expect(ring).toHaveBeenCalledWith(1));
    expect(get).toHaveBeenCalledWith('/api/support/v1/tickets', expect.objectContaining({ query: { view: 'unassigned', priority: 'urgent', sort: 'created', limit: 10 } }));
    await u.check();
    expect(ring).toHaveBeenCalledTimes(1);
    u.closed(1);
    await vi.waitFor(() => expect(ring).toHaveBeenLastCalledWith(2));
    u.closed(2);
    await u.check();
    expect(ring).toHaveBeenCalledTimes(2);
    u.stop();
  });

  it('takes the card down when somebody takes its ticket', async () => {
    const { u, ring, close } = setup([[t(1)], []]);
    u.start();
    await vi.waitFor(() => expect(ring).toHaveBeenCalledWith(1));
    await u.check();
    expect(close).toHaveBeenCalled();
    expect(u.current()).toBeNull();
    u.stop();
  });

  it('rings nothing while not allowed (locked, turned off, no desk), and takes a card down', async () => {
    let ok = true;
    const { u, ring, close, get } = setup([[t(1)]], () => ok);
    u.start();
    await vi.waitFor(() => expect(ring).toHaveBeenCalled());
    ok = false;
    await u.check();
    expect(close).toHaveBeenCalled();
    const asked = get.mock.calls.length;
    await u.check();
    expect(get.mock.calls.length).toBe(asked);
    u.stop();
  });

  it('looks again after desk hints, once for a burst, and not for presence', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { u, get } = setup([[]]);
    u.start();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    u.handle({ type: 'support.presence', ticket_id: 1, present: [] } as never);
    u.handle({ type: 'support.changed', organization_id: 10, kind: 'created' } as never);
    u.handle({ type: 'support.changed', organization_id: 10, kind: 'created' } as never);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    u.stop();
    vi.useRealTimers();
  });
});
