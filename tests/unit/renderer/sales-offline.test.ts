import { describe, expect, it, vi } from 'vitest';

const getMeta = vi.hoisted(() => vi.fn());
vi.mock('../../../src/core/api', () => ({
  ApiError: class extends Error {},
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiGetMeta: getMeta,
}));

const { fetchOrders, fetchOrder } = await import('../../../src/modules/sales/api');
const { mayWrite, offlineLine, OFFLINE_WRITE, writeBlock } = await import('../../../src/modules/sales/offline');

/**
 * WS-OMS-SRS-001 FR-DSK-07: recent orders are kept on this computer and read offline, marked so; nothing is written
 * from that copy.
 */
describe('recent orders offline, read only', () => {
  it('says when the list came from this computer’s copy', async () => {
    getMeta.mockResolvedValueOnce({ data: { orders: [{ id: 1, number: 'SO-1' }], total: 1, page: 1, per_page: 50 }, offline: true, cachedAt: '2026-10-14T09:12:00Z' });
    const page = await fetchOrders('', { status: 'confirmed' });
    expect(page.offline).toBe(true);
    expect(page.cachedAt).toBe('2026-10-14T09:12:00Z');
    expect(page.orders).toHaveLength(1);
    expect(getMeta.mock.calls[0]![0]).toBe('/api/oms/orders');
    expect(getMeta.mock.calls[0]![1]).toMatchObject({ status: 'confirmed', page: 1, per_page: 50 });
  });

  it('says so for one order too, and not when the server answered', async () => {
    getMeta.mockResolvedValueOnce({ data: { order: { id: 7, number: 'SO-7' } }, offline: true, cachedAt: '2026-10-14T09:12:00Z' });
    expect(await fetchOrder(7)).toMatchObject({ id: 7, offline: true });
    getMeta.mockResolvedValueOnce({ data: { order: { id: 7, number: 'SO-7' } }, offline: false, cachedAt: null });
    expect(await fetchOrder(7)).toMatchObject({ id: 7, offline: false });
  });

  it('allows no write while offline, or while the screen shows the offline copy', () => {
    expect(mayWrite({ network: 'ONLINE' })).toBe(true);
    expect(mayWrite({ network: 'OFFLINE' })).toBe(false);
    expect(mayWrite({ network: 'ONLINE', servedOffline: true })).toBe(false);
    expect(writeBlock({ network: 'OFFLINE' })).toBe(OFFLINE_WRITE);
    expect(writeBlock({ network: 'DEGRADED' })).toBeNull();
  });

  it('says how old the copy is', () => {
    expect(offlineLine(null)).toBe('Offline · orders as last seen');
    expect(offlineLine('2026-10-14T09:12:00Z')).toMatch(/^Offline · orders as of /);
  });
});
